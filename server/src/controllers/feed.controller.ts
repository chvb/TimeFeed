import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { User, UserRole } from '../models/User';
import { Holiday } from '../models/Holiday';
import { WorkDay } from '../models/WorkDay';
import { TimeEntry, TimeEntryType } from '../models/TimeEntry';
import { CorrectionRequest } from '../models/CorrectionRequest';
import { MonthClosure } from '../models/MonthClosure';
import { TerminalDevice } from '../models/TerminalDevice';
import { TimesheetDocument } from '../models/TimesheetDocument';
import { IntegrationSettings } from '../models/IntegrationSettings';
import { Company } from '../models/Company';
import {
  getEffectiveActor,
  getAccessibleUserIds,
  getCompanyOrGlobalWhere,
  getManagedCompanyIds,
} from '../services/accessScope';
import { getUserTimeState, pairShifts, ymdLocal, addDays, localDayStart } from '../services/timeCalcService';

/**
 * feed.controller — der namensgebende FEED von TimeFeed.
 *
 * GET /api/feed liefert einen rollen-gescopten Aktivitäts-Stream als
 * { items: FeedItem[] }. Die Items enthalten NUR Rohdaten (keine fertigen
 * Texte) — der Client übersetzt type+data via i18n. Rollen-Reichweite strikt
 * über accessScope (Mitarbeiter sehen ausschließlich eigene Daten/Namen).
 */

export type FeedPriority = 'high' | 'normal' | 'low';

export interface FeedItem {
  id: string;
  type: string;
  priority: FeedPriority;
  actionRequired: boolean;
  /** ISO-Zeitpunkt, auf den sich das Item bezieht (Sortierung/Gruppierung im Client). */
  timestamp: string;
  /** Rohdaten für die clientseitige Übersetzung (Namen, Minuten, Daten, …). */
  data: Record<string, any>;
  link?: string;
}

const MANAGE_ROLES = new Set<string>([UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG]);
const ACCOUNTING_ROLES = new Set<string>([UserRole.ADMIN, UserRole.BUCHHALTUNG]);
const ARBZG_FLAGS = ['arbzg_over_10h', 'arbzg_rest_violation'];
const PRIORITY_ORDER: Record<FeedPriority, number> = { high: 0, normal: 1, low: 2 };

/** WorkDay.flags robust lesen (JSON-Spalte kann als String ankommen). */
function readFlags(wd: any): string[] {
  const raw = wd?.flags;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

/** 'YYYY-MM' des Vormonats. */
function previousMonth(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * GET /api/feed — ausführlicher, rollen-gescopter Aktivitäts-Stream.
 * Alle Listen werden GEBÜNDELT geladen (keine N+1-Queries) und die
 * Zeitfenster bewusst klein gehalten (48h Stempel, 7/14 Tage Historie).
 */
export async function getFeed(req: Request, res: Response, next: NextFunction) {
  try {
    const me = req.user!;
    const actor = getEffectiveActor(me, req.query.companyId, req.query.tenantId);
    const isManager = !!me.isSuperAdmin || MANAGE_ROLES.has(me.role);
    const isAccounting = !!me.isSuperAdmin || ACCOUNTING_ROLES.has(me.role);

    const now = new Date();
    const todayYmd = ymdLocal(now);
    const todayStart = localDayStart(todayYmd);
    const yesterdayYmd = ymdLocal(addDays(todayStart, -1));
    const in7Ymd = ymdLocal(addDays(todayStart, 7));
    const ago7Ymd = ymdLocal(addDays(todayStart, -7));
    const ago7 = addDays(todayStart, -7);
    const ago14 = addDays(todayStart, -14);
    const in14 = addDays(todayStart, 14);

    // Erreichbarer Mitarbeiterkreis (null = uneingeschränkt). Mitarbeiter → [me.id].
    const accessibleIds = await getAccessibleUserIds(actor);
    const userWhere: any = { isActive: true };
    if (accessibleIds !== null) userWhere.id = { [Op.in]: accessibleIds };
    const users = await User.findAll({
      where: userWhere,
      attributes: ['id', 'firstName', 'lastName', 'entryDate', 'companyId'],
    });
    const userIds = users.map((u) => u.id);
    const nameById = new Map<number, string>(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const teamIdFilter = accessibleIds === null ? {} : { userId: { [Op.in]: userIds } };

    // ---- Gebündelte Abfragen (parallel) ------------------------------------
    const [
      ownState,
      ownBalance,
      ownCorrections,
      ownYesterday,
      teamEntries48h,
      missingOutDays,
      openTeamCorrections,
      flaggedRecentDays,
      terminals,
      recentTimesheets,
      absenceDays,
      holidays,
    ] = await Promise.all([
      getUserTimeState(me.id),
      WorkDay.sum('balanceMinutes', { where: { userId: me.id, date: { [Op.lte]: yesterdayYmd } } }),
      CorrectionRequest.findAll({
        where: {
          userId: me.id,
          [Op.or]: [{ status: 'pending' }, { decidedAt: { [Op.gte]: ago14 } }],
        },
        order: [['updatedAt', 'DESC']],
        limit: 20,
      }),
      WorkDay.findOne({ where: { userId: me.id, date: yesterdayYmd } }),
      // Stempel der letzten 48h des Teams: EINMAL laden, daraus Anwesenheit
      // (pairShifts) UND die heutigen Kommen/Gehen-Ereignisse ableiten.
      isManager && (accessibleIds === null || userIds.length > 0)
        ? TimeEntry.findAll({
          where: {
            ...teamIdFilter,
            isCancelled: false,
            timestamp: { [Op.gte]: new Date(now.getTime() - 48 * 3600 * 1000), [Op.lte]: now },
          },
          attributes: ['userId', 'type', 'timestamp', 'source'],
          order: [['timestamp', 'ASC']],
        })
        : Promise.resolve([] as TimeEntry[]),
      isManager
        ? WorkDay.findAll({ where: { ...teamIdFilter, date: yesterdayYmd, status: 'incomplete' } })
        : Promise.resolve([] as WorkDay[]),
      isManager
        ? CorrectionRequest.findAll({ where: { ...teamIdFilter, status: 'pending' }, order: [['createdAt', 'DESC']], limit: 30 })
        : Promise.resolve([] as CorrectionRequest[]),
      isManager
        ? WorkDay.findAll({ where: { ...teamIdFilter, status: 'flagged', date: { [Op.gte]: ago7Ymd } }, order: [['date', 'DESC']] })
        : Promise.resolve([] as WorkDay[]),
      Promise.resolve(isManager ? null : ([] as TerminalDevice[])).then(async (v) => {
        if (v !== null) return v;
        const managed = await getManagedCompanyIds(actor);
        if (managed !== null && managed.length === 0) return [] as TerminalDevice[];
        const where: any = managed === null ? {} : { companyId: { [Op.in]: managed } };
        return TerminalDevice.findAll({ where, attributes: ['id', 'name', 'locationLabel', 'isActive', 'lastSeenAt'] });
      }),
      isManager
        ? TimesheetDocument.findAll({ where: { ...teamIdFilter, createdAt: { [Op.gte]: ago7 } }, order: [['createdAt', 'DESC']], limit: 20 })
        : Promise.resolve([] as TimesheetDocument[]),
      // Kommende Abwesenheiten (7 Tage) — accessScope regelt, wessen Namen
      // sichtbar sind (Mitarbeiter: nur die eigene Abwesenheit).
      WorkDay.findAll({
        where: {
          ...teamIdFilter,
          date: { [Op.gte]: todayYmd, [Op.lte]: in7Ymd },
          absence: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: 'holiday' }] },
        },
        attributes: ['userId', 'date', 'absence'],
        order: [['date', 'ASC']],
      }),
      Holiday.findAll({
        where: { [Op.and]: [{ startDate: { [Op.between]: [todayStart, in14] } }, getCompanyOrGlobalWhere(actor)] },
        attributes: ['id', 'name', 'startDate', 'endDate', 'type'],
        order: [['startDate', 'ASC']],
      }),
    ]);

    const items: FeedItem[] = [];

    // ---- Für alle: eigener Stempel-Status + heutige Ist-Zeit ----------------
    const ownDay = ownState.shiftStartedAt ? ymdLocal(ownState.shiftStartedAt) : todayYmd;
    const ownToday = await WorkDay.findOne({ where: { userId: me.id, date: ownDay } });
    items.push({
      id: `stamp_status:${me.id}`,
      type: 'stamp_status',
      priority: 'normal',
      actionRequired: false,
      timestamp: (ownState.since ?? now).toISOString(),
      data: {
        state: ownState.state,
        since: ownState.since ? ownState.since.toISOString() : null,
        workedMinutes: ownToday?.workedMinutes ?? 0,
        targetMinutes: ownToday?.targetMinutes ?? 0,
      },
      link: '/times',
    });

    // ---- Für alle: eigener Überstundensaldo ---------------------------------
    items.push({
      id: `balance:${me.id}`,
      type: 'balance',
      priority: 'low',
      actionRequired: false,
      timestamp: now.toISOString(),
      data: { balanceMinutes: Number(ownBalance) || 0, upToDate: yesterdayYmd },
      link: '/times',
    });

    // ---- Für alle: eigene Korrekturanträge (offen + Entscheidungen 14 Tage) --
    for (const c of ownCorrections as CorrectionRequest[]) {
      // Offene eigene Anträge: für Verwalter-Rollen nicht doppelt (erscheinen
      // bereits unter den offenen Team-Anträgen).
      if (c.status === 'pending' && isManager) continue;
      items.push({
        id: `correction_own:${c.id}`,
        type: c.status === 'pending' ? 'correction_own_pending' : 'correction_own_decided',
        priority: 'normal',
        actionRequired: false,
        timestamp: (c.decidedAt ? new Date(c.decidedAt) : new Date(c.createdAt)).toISOString(),
        data: { date: c.date, status: c.status, decisionNote: c.decisionNote ?? null },
        link: '/times',
      });
    }

    // ---- Für alle: eigene Warnung (gestern incomplete/auto_capped) ----------
    if (ownYesterday) {
      const yFlags = readFlags(ownYesterday);
      const incomplete = ownYesterday.status === 'incomplete';
      const capped = yFlags.includes('auto_capped');
      if (incomplete || capped) {
        items.push({
          id: `day_warning:${me.id}:${yesterdayYmd}`,
          type: 'day_warning',
          priority: 'high',
          actionRequired: true,
          timestamp: (ownYesterday.lastOut ? new Date(ownYesterday.lastOut) : addDays(todayStart, 0)).toISOString(),
          data: { date: yesterdayYmd, reason: incomplete ? 'incomplete' : 'auto_capped' },
          link: '/times',
        });
      }
    }

    // ---- Verwalter: Anwesenheit jetzt + heutige Kommen/Gehen-Ereignisse -----
    if (isManager) {
      const byUser = new Map<number, Array<{ type: TimeEntryType; timestamp: Date; source?: string }>>();
      for (const e of teamEntries48h as TimeEntry[]) {
        const list = byUser.get(e.userId) || [];
        list.push({ type: e.type, timestamp: new Date(e.timestamp), source: e.source });
        byUser.set(e.userId, list);
      }
      let present = 0; let onBreak = 0; let absent = 0;
      for (const u of users) {
        const shifts = pairShifts(byUser.get(u.id) || []);
        const last = shifts.length > 0 ? shifts[shifts.length - 1] : null;
        if (last && !last.outAt) {
          if (last.breakOpenSince) onBreak += 1; else present += 1;
        } else {
          absent += 1;
        }
      }
      items.push({
        id: 'presence_summary',
        type: 'presence_summary',
        priority: 'normal',
        actionRequired: false,
        timestamp: now.toISOString(),
        data: { present, onBreak, absent, total: users.length },
        link: '/presence',
      });

      // Heutige Kommen/Gehen-Ereignisse (letzte 20, nur in/out, mit Quelle).
      const todaysEvents = (teamEntries48h as TimeEntry[])
        .filter((e) => (e.type === 'in' || e.type === 'out') && new Date(e.timestamp) >= todayStart)
        .slice(-20);
      for (const e of todaysEvents) {
        items.push({
          id: `stamp_event:${e.userId}:${new Date(e.timestamp).getTime()}:${e.type}`,
          type: 'stamp_event',
          priority: 'low',
          actionRequired: false,
          timestamp: new Date(e.timestamp).toISOString(),
          data: { name: nameById.get(e.userId) ?? `#${e.userId}`, stampType: e.type, source: e.source },
          link: '/presence',
        });
      }

      // Gestern nicht ausgestempelt (Verwalter-Sicht, actionRequired).
      for (const wd of missingOutDays as WorkDay[]) {
        items.push({
          id: `missing_out:${wd.userId}:${wd.date}`,
          type: 'missing_out',
          priority: 'high',
          actionRequired: true,
          timestamp: (wd.firstIn ? new Date(wd.firstIn) : addDays(todayStart, -1)).toISOString(),
          data: { name: nameById.get(wd.userId) ?? `#${wd.userId}`, date: wd.date },
          link: '/manage-times',
        });
      }

      // Offene Korrekturanträge des Teams (actionRequired).
      for (const c of openTeamCorrections as CorrectionRequest[]) {
        items.push({
          id: `correction_open:${c.id}`,
          type: 'correction_open',
          priority: 'high',
          actionRequired: true,
          timestamp: new Date(c.createdAt).toISOString(),
          data: { name: nameById.get(c.userId) ?? `#${c.userId}`, date: c.date, message: c.message },
          link: '/manage-times',
        });
      }

      // ArbZG-Verstöße der letzten 7 Tage.
      for (const wd of flaggedRecentDays as WorkDay[]) {
        const f = readFlags(wd).filter((x) => ARBZG_FLAGS.includes(x));
        if (f.length === 0) continue;
        items.push({
          id: `arbzg:${wd.userId}:${wd.date}`,
          type: 'arbzg_violation',
          priority: 'normal',
          actionRequired: false,
          timestamp: (wd.lastOut ? new Date(wd.lastOut) : localDayStart(wd.date)).toISOString(),
          data: { name: nameById.get(wd.userId) ?? `#${wd.userId}`, date: wd.date, flags: f },
          link: '/manage-times',
        });
      }

      // Terminal-Störungen: inaktiv oder > 24h nicht gesehen.
      const staleBefore = new Date(now.getTime() - 24 * 3600 * 1000);
      for (const t of terminals as TerminalDevice[]) {
        const stale = !t.lastSeenAt || new Date(t.lastSeenAt) < staleBefore;
        if (t.isActive && !stale) continue;
        items.push({
          id: `terminal_issue:${t.id}`,
          type: 'terminal_issue',
          priority: 'high',
          actionRequired: false,
          timestamp: (t.lastSeenAt ? new Date(t.lastSeenAt) : now).toISOString(),
          data: {
            name: t.name,
            location: t.locationLabel ?? null,
            reason: !t.isActive ? 'inactive' : 'stale',
            lastSeenAt: t.lastSeenAt ? new Date(t.lastSeenAt).toISOString() : null,
          },
          link: '/terminals',
        });
      }

      // Neue Stundenzettel-Uploads (7 Tage).
      for (const ts of recentTimesheets as TimesheetDocument[]) {
        items.push({
          id: `timesheet:${ts.id}`,
          type: 'timesheet_upload',
          priority: 'low',
          actionRequired: false,
          timestamp: new Date(ts.createdAt).toISOString(),
          data: {
            name: nameById.get(ts.userId) ?? `#${ts.userId}`,
            fileName: ts.fileName,
            periodStart: ts.periodStart,
            periodEnd: ts.periodEnd,
          },
          link: '/manage-times',
        });
      }
    }

    // ---- Buchhaltung/Admin: Monatsabschluss + UrlaubsFeed-Sync --------------
    if (isAccounting) {
      // Vormonat nach dem 5. noch nicht (firmenweit) abgeschlossen → high.
      if (now.getDate() > 5) {
        const prevMonth = previousMonth(now);
        const managed = await getManagedCompanyIds(actor);
        const companyWhere: any = { isActive: true };
        if (managed !== null) companyWhere.id = { [Op.in]: managed };
        if (managed === null || managed.length > 0) {
          const [companies, closures] = await Promise.all([
            Company.findAll({ where: companyWhere, attributes: ['id', 'name'] }),
            MonthClosure.findAll({ where: { month: prevMonth, userId: null as any }, attributes: ['companyId'] }),
          ]);
          const closedCompanyIds = new Set((closures as MonthClosure[]).map((c) => c.companyId));
          for (const c of companies as Company[]) {
            if (closedCompanyIds.has(c.id)) continue;
            items.push({
              id: `month_open:${c.id}:${prevMonth}`,
              type: 'month_open',
              priority: 'high',
              actionRequired: true,
              timestamp: now.toISOString(),
              data: { month: prevMonth, companyName: (c as any).name },
              link: '/exports',
            });
          }
        }
      }

      // Letztes UrlaubsFeed-Sync-Ergebnis (Fehler → high).
      let tenantIds: number[] | null = null;
      if (actor.tenantId) tenantIds = [actor.tenantId];
      else if (actor.companyId) {
        const comp = await Company.findByPk(actor.companyId, { attributes: ['tenantId'] });
        tenantIds = comp?.tenantId ? [comp.tenantId] : [];
      }
      if (tenantIds === null || tenantIds.length > 0) {
        const syncWhere: any = { lastSyncAt: { [Op.ne]: null } };
        if (tenantIds !== null) syncWhere.tenantId = { [Op.in]: tenantIds };
        const syncRows = await IntegrationSettings.findAll({ where: syncWhere, limit: 5 });
        for (const s of syncRows as IntegrationSettings[]) {
          const r: any = s.lastSyncResult || {};
          items.push({
            id: `sync_result:${s.tenantId}`,
            type: 'sync_result',
            priority: r.ok === false ? 'high' : 'low',
            actionRequired: false,
            timestamp: new Date(s.lastSyncAt as Date).toISOString(),
            data: {
              ok: r.ok !== false,
              daysSet: r.daysSet ?? null,
              daysCleared: r.daysCleared ?? null,
              error: r.error ?? null,
            },
            link: '/settings',
          });
        }
      }
    }

    // ---- Team-Infos: Abwesenheiten (7 Tage), Feiertage, Jubiläen, Neue -------
    // Abwesenheits-Tage je User+Art zu Zeiträumen bündeln.
    const absKey = (uid: number, kind: string) => `${uid}:${kind}`;
    const absRanges = new Map<string, { userId: number; absence: string; start: string; end: string }>();
    for (const wd of absenceDays as WorkDay[]) {
      const key = absKey(wd.userId, wd.absence as string);
      const r = absRanges.get(key);
      if (!r) absRanges.set(key, { userId: wd.userId, absence: wd.absence as string, start: wd.date, end: wd.date });
      else { if (wd.date < r.start) r.start = wd.date; if (wd.date > r.end) r.end = wd.date; }
    }
    for (const r of absRanges.values()) {
      items.push({
        id: `absence:${r.userId}:${r.absence}:${r.start}`,
        type: 'absence',
        priority: 'normal',
        actionRequired: false,
        timestamp: localDayStart(r.start).toISOString(),
        data: {
          name: nameById.get(r.userId) ?? `#${r.userId}`,
          self: r.userId === me.id,
          absence: r.absence,
          startDate: r.start,
          endDate: r.end,
        },
      });
    }

    for (const h of holidays as Holiday[]) {
      items.push({
        id: `holiday:${h.id}`,
        type: 'holiday',
        priority: 'low',
        actionRequired: false,
        timestamp: new Date(h.startDate).toISOString(),
        data: { name: h.name, startDate: h.startDate, endDate: h.endDate, holidayType: (h as any).type },
      });
    }

    // Jubiläen (nächste 14 Tage) + neue Kolleg:innen (letzte 14 Tage) aus der
    // bereits geladenen (gescopten) Userliste — gleiche Logik wie /feed/extras.
    const cy = now.getFullYear();
    for (const u of users as any[]) {
      if (!u.entryDate) continue;
      const e = new Date(u.entryDate);
      e.setHours(0, 0, 0, 0);
      if (e >= ago14 && e <= todayStart) {
        items.push({
          id: `new_colleague:${u.id}`,
          type: 'new_colleague',
          priority: 'low',
          actionRequired: false,
          timestamp: e.toISOString(),
          data: { name: nameById.get(u.id), date: ymdLocal(e) },
        });
      }
      const years = cy - e.getFullYear();
      if (years >= 1) {
        const ann = new Date(cy, e.getMonth(), e.getDate());
        if (ann >= todayStart && ann <= in14) {
          items.push({
            id: `anniversary:${u.id}:${cy}`,
            type: 'anniversary',
            priority: 'low',
            actionRequired: false,
            timestamp: ann.toISOString(),
            data: { name: nameById.get(u.id), years, date: ymdLocal(ann) },
          });
        }
      }
    }

    // ---- Sortierung: Priorität, dann Zeit (neueste zuerst); Deckel 150 ------
    items.sort((a, b) => {
      const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (p !== 0) return p;
      return b.timestamp.localeCompare(a.timestamp);
    });

    res.json({ items: items.slice(0, 150) });
  } catch (e) {
    next(e);
  }
}

/**
 * Zusatzinhalte für den Feed (gescopet): Arbeitsjubiläen, neue Kolleg:innen,
 * anstehende Feiertage.
 */
export async function getFeedExtras(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const in14 = new Date(now); in14.setDate(in14.getDate() + 14);
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
    const ago14 = new Date(now); ago14.setDate(ago14.getDate() - 14);
    const cy = now.getFullYear();

    const actor = getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId);
    const accessibleIds = await getAccessibleUserIds(actor);
    const userWhere: any = { isActive: true };
    if (accessibleIds !== null) userWhere.id = { [Op.in]: accessibleIds };
    const users = await User.findAll({ where: userWhere, attributes: ['id', 'firstName', 'lastName', 'entryDate'] });

    const anniversaries: any[] = [];
    const newJoiners: any[] = [];
    for (const u of users as any[]) {
      if (!u.entryDate) continue;
      const e = new Date(u.entryDate);
      e.setHours(0, 0, 0, 0);
      const name = `${u.firstName} ${u.lastName}`;
      // Neu im Team (Eintritt in den letzten 14 Tagen)
      if (e >= ago14 && e <= now) {
        newJoiners.push({ name, date: e.toISOString() });
      }
      // Arbeitsjubiläum (Jahrestag in den nächsten 14 Tagen, mind. 1 Jahr)
      const years = cy - e.getFullYear();
      if (years >= 1) {
        const ann = new Date(cy, e.getMonth(), e.getDate());
        ann.setHours(0, 0, 0, 0);
        if (ann >= now && ann <= in14) {
          anniversaries.push({ name, years, date: ann.toISOString() });
        }
      }
    }
    anniversaries.sort((a, b) => a.date.localeCompare(b.date));
    newJoiners.sort((a, b) => b.date.localeCompare(a.date));

    const hols = await Holiday.findAll({
      // nur globale + firmen-/mandanteneigene Feiertage
      where: { [Op.and]: [{ startDate: { [Op.between]: [now, in30] } }, getCompanyOrGlobalWhere(actor)] },
      attributes: ['id', 'name', 'startDate', 'endDate', 'type'],
      order: [['startDate', 'ASC']],
    });
    const upcomingHolidays = (hols as any[]).map((h) => ({
      name: h.name, startDate: h.startDate, endDate: h.endDate, type: h.type,
    }));

    res.json({ anniversaries, newJoiners, upcomingHolidays });
  } catch (e) {
    next(e);
  }
}
