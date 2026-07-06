import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { Tenant } from '../models/Tenant';
import { TimeEntry, TimeEntryType } from '../models/TimeEntry';
import { TerminalDevice } from '../models/TerminalDevice';
import { SettingsController } from './settings.controller';
import {
  calcWorkDay,
  getUserTimeState,
  validateStampSequence,
  ymdLocal,
} from '../services/timeCalcService';
import { isMonthClosed, monthOf, MONTH_LOCKED_RESPONSE } from '../services/monthLockService';

/**
 * Terminal-API (/api/terminal) — Kiosk-Endpunkte OHNE User-JWT.
 * Auth ausschließlich über die terminalAuth-Middleware (X-Terminal-Token);
 * req.terminal ist hier immer gesetzt.
 */

const settingsController = new SettingsController();

const STAMP_TYPES: TimeEntryType[] = ['in', 'out', 'break_start', 'break_end'];

// Maximales Alter eines nachgereichten Offline-Stempels.
const MAX_CLIENT_TS_AGE_MS = 24 * 3600 * 1000;
// Ab diesem Alter gilt ein clientTimestamp als Offline-Nachsync (note + tolerante Sequenz).
const OFFLINE_SYNC_THRESHOLD_MS = 2 * 60 * 1000;

// Dummy-Hash für konstante Antwortzeiten: JEDER identify/stamp-Pfad führt genau
// EINEN bcrypt-Vergleich aus — sonst wäre über das Timing ableitbar, ob eine
// Kennung existiert (User-Enumeration).
const DUMMY_PIN_HASH = bcrypt.hashSync('timefeed-terminal-dummy-pin', 10);

interface IdentifyFailure {
  status: number;
  code: 'IDENTIFIER_REQUIRED' | 'UNKNOWN_CODE' | 'PIN_REQUIRED' | 'PIN_INVALID';
  message: string;
}

type IdentifyResult = { user: User; failure?: undefined } | { user?: undefined; failure: IdentifyFailure };

/**
 * Identifiziert einen Mitarbeiter der Terminal-Firma über stampCode ODER nfcTagUid.
 * Nur aktive, nicht ausgeschiedene User. PIN-Prüfung gemäß Terminal-Config.
 * Unbekannte Kennungen, deaktivierte und ausgeschiedene User liefern identisch
 * 404 UNKNOWN_CODE (kein Enumeration-Leak über den Wortlaut).
 */
async function identifyUser(terminal: TerminalDevice, body: any): Promise<IdentifyResult> {
  const stampCode = typeof body?.stampCode === 'string' || typeof body?.stampCode === 'number' ? String(body.stampCode).trim() : '';
  const nfcTagUid = typeof body?.nfcTagUid === 'string' ? body.nfcTagUid.trim() : '';
  const pin = body?.pin != null ? String(body.pin) : '';

  if (!stampCode && !nfcTagUid) {
    return { failure: { status: 400, code: 'IDENTIFIER_REQUIRED', message: 'stampCode oder nfcTagUid ist erforderlich.' } };
  }

  const where: any = { companyId: terminal.companyId, isActive: true };
  if (stampCode) where.stampCode = stampCode;
  else where.nfcTagUid = nfcTagUid;

  const user = await User.findOne({ where });
  const exited = !!user?.exitDate && new Date(user.exitDate) <= new Date();

  if (!user || exited) {
    await bcrypt.compare(pin, DUMMY_PIN_HASH); // Timing angleichen
    return { failure: { status: 404, code: 'UNKNOWN_CODE', message: 'Unbekannte Kennung.' } };
  }

  const cfg = terminal.getConfig();
  if (cfg.requirePin && user.pin) {
    if (!pin) {
      await bcrypt.compare('x', DUMMY_PIN_HASH); // Timing angleichen
      return { failure: { status: 401, code: 'PIN_REQUIRED', message: 'PIN erforderlich.' } };
    }
    if (!(await user.comparePin(pin))) {
      return { failure: { status: 401, code: 'PIN_INVALID', message: 'PIN ungültig.' } };
    }
  } else {
    await bcrypt.compare(pin, DUMMY_PIN_HASH); // Timing angleichen
  }

  return { user };
}

const sendFailure = (res: Response, f: IdentifyFailure) =>
  res.status(f.status).json({ error: f.code, code: f.code, message: f.message });

export class TerminalApiController {
  /** GET /api/terminal/info → { name, companyName, config, breakMode, branding } */
  async info(req: Request, res: Response, next: NextFunction) {
    try {
      const terminal = req.terminal!;
      const [company, settings] = await Promise.all([
        Company.findByPk(terminal.companyId, { attributes: ['id', 'name', 'tenantId'] }),
        settingsController.getOrCreateSettings(terminal.companyId),
      ]);
      // Branding des Mandanten der Terminal-Firma (für gebrandete Kiosk-Oberfläche).
      const tenant = company?.tenantId ? await Tenant.findByPk(company.tenantId) : null;
      res.json({
        name: terminal.name,
        companyName: company?.name ?? null,
        config: terminal.getConfig(),
        breakMode: settings.breakMode,
        // Zahnrad/Einstellungen am Kiosk passwortgeschützt? (nie der Hash selbst)
        settingsProtected: !!terminal.settingsPasswordHash,
        branding: {
          brandName: tenant?.brandName ?? null,
          brandColor: tenant?.brandColor ?? null,
          brandLogo: tenant?.brandLogo ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/terminal/ping — leichter Heartbeat für die Verbindungsanzeige des Kiosks.
   * lastSeenAt wird bereits (gedrosselt) von der terminalAuth-Middleware gepflegt.
   */
  async ping(_req: Request, res: Response) {
    res.json({ ok: true, time: new Date().toISOString() });
  }

  /**
   * POST /api/terminal/verify-settings — body { password }
   * Prüft das Einstellungs-Passwort des Terminals (Zahnrad-Schutz im Kiosk).
   * 200 { ok:true } bei Treffer ODER wenn kein Schutz gesetzt ist,
   * sonst 401 SETTINGS_PASSWORD_INVALID. Wie beim PIN-Muster wird in jedem
   * Pfad genau EIN bcrypt-Vergleich ausgeführt (konstante Antwortzeit).
   */
  async verifySettings(req: Request, res: Response, next: NextFunction) {
    try {
      const terminal = req.terminal!;
      const password = req.body?.password != null ? String(req.body.password) : '';
      const hash = terminal.settingsPasswordHash;
      if (!hash) {
        await bcrypt.compare(password, DUMMY_PIN_HASH); // Timing angleichen
        return res.json({ ok: true });
      }
      if (!(await bcrypt.compare(password, hash))) {
        return res.status(401).json({
          error: 'SETTINGS_PASSWORD_INVALID',
          code: 'SETTINGS_PASSWORD_INVALID',
          message: 'Einstellungs-Passwort ungültig.',
        });
      }
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/terminal/identify — body { stampCode? | nfcTagUid?, pin? }
   * Erfolg: { user: { firstName, lastName }, state: 'out'|'in'|'break', breakMode }
   */
  async identify(req: Request, res: Response, next: NextFunction) {
    try {
      const terminal = req.terminal!;
      const result = await identifyUser(terminal, req.body);
      if (result.failure) return sendFailure(res, result.failure);

      const [st, settings] = await Promise.all([
        getUserTimeState(result.user.id),
        settingsController.getOrCreateSettings(terminal.companyId),
      ]);
      return res.json({
        user: { firstName: result.user.firstName, lastName: result.user.lastName },
        state: st.state,
        breakMode: settings.breakMode,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/terminal/stamp — body { stampCode?|nfcTagUid?, pin?, type, clientTimestamp? }
   * - Live-Stempel: Sequenzvalidierung strikt (409 ALREADY_IN/NOT_IN/BREAK_OPEN/NO_BREAK).
   * - Offline-Nachsync (clientTimestamp > 2 Min alt, max. 24h): note 'offline-sync',
   *   Sequenz TOLERANT gegen den Zustand ZUM clientTimestamp — passt sie nicht, wird
   *   der Stempel trotzdem gespeichert (Offline-Stempel gehen NIE verloren; pairShifts
   *   ignoriert Unpassendes) und die Antwort trägt warning 'SEQUENCE_ADJUSTED'.
   * Erfolg: 201 { user:{firstName,lastName}, state, timestamp } (state NACH der Stempelung).
   */
  async stamp(req: Request, res: Response, next: NextFunction) {
    try {
      const terminal = req.terminal!;
      const { type, clientTimestamp } = req.body || {};
      if (!STAMP_TYPES.includes(type)) {
        return res.status(400).json({
          error: 'INVALID_TYPE', code: 'INVALID_TYPE',
          message: `Ungültiger Stempel-Typ (erlaubt: ${STAMP_TYPES.join(', ')})`,
        });
      }

      const result = await identifyUser(terminal, req.body);
      if (result.failure) return sendFailure(res, result.failure);
      const user = result.user;

      // Zeitstempel: Server-Zeit; bei Offline-Nachsync der mitgelieferte clientTimestamp.
      const now = new Date();
      let ts = now;
      let offlineSync = false;
      if (clientTimestamp != null && clientTimestamp !== '') {
        const t = new Date(String(clientTimestamp));
        const age = now.getTime() - t.getTime();
        if (isNaN(t.getTime()) || age < 0 || age > MAX_CLIENT_TS_AGE_MS) {
          return res.status(400).json({
            error: 'TIMESTAMP_INVALID', code: 'TIMESTAMP_INVALID',
            message: 'clientTimestamp muss ein ISO-Zeitpunkt sein, nicht in der Zukunft liegen und darf max. 24h alt sein.',
          });
        }
        ts = t;
        offlineSync = age > OFFLINE_SYNC_THRESHOLD_MS;
      }

      // Sequenzvalidierung gegen den Zustand ZUM Stempel-Zeitpunkt.
      const state = await getUserTimeState(user.id, ts);

      // Monatsabschluss-Sperre: NUR wenn der Zieltag (Arbeitstag des Stempels)
      // wirklich in einem abgeschlossenen Monat liegt → 423. Normale Stempel auf
      // heute bleiben unberührt, solange der Monat offen ist.
      const targetDay = type === 'in' || !state.shiftStartedAt ? ymdLocal(ts) : ymdLocal(state.shiftStartedAt);
      if (await isMonthClosed(user.id, terminal.companyId, monthOf(targetDay))) {
        return res.status(423).json(MONTH_LOCKED_RESPONSE);
      }

      const conflict = validateStampSequence(state.state, type as TimeEntryType);
      let warning: string | undefined;
      if (conflict) {
        if (!offlineSync) {
          return res.status(409).json({ error: conflict.code, code: conflict.code, message: conflict.message });
        }
        warning = 'SEQUENCE_ADJUSTED'; // Offline-Stempel trotzdem speichern
      }

      await TimeEntry.create({
        userId: user.id,
        companyId: terminal.companyId,
        type,
        timestamp: ts,
        source: 'terminal',
        terminalId: terminal.id,
        // Fester Gerätestandort des Terminals (kein Client-GPS im Kiosk-Modus).
        lat: terminal.lat ?? null,
        lng: terminal.lng ?? null,
        note: offlineSync ? 'offline-sync' : null,
      });

      // Betroffene(n) ARBEITSTAG(e) neu berechnen: bei 'in' der Kalendertag des
      // Stempels, sonst der Tag des zugehörigen Schichtbeginns (Nachtschicht!).
      const shiftDay = type === 'in' || !state.shiftStartedAt ? ymdLocal(ts) : ymdLocal(state.shiftStartedAt);
      await calcWorkDay(user.id, shiftDay);
      const tsDay = ymdLocal(ts);
      if (tsDay !== shiftDay) await calcWorkDay(user.id, tsDay);
      // Nachsync kann die Paarung des heutigen Tages verändert haben.
      const today = ymdLocal(now);
      if (offlineSync && today !== shiftDay && today !== tsDay) await calcWorkDay(user.id, today);

      const after = await getUserTimeState(user.id);
      return res.status(201).json({
        user: { firstName: user.firstName, lastName: user.lastName },
        state: after.state,
        timestamp: ts.toISOString(),
        ...(warning ? { warning } : {}),
      });
    } catch (error) {
      return next(error);
    }
  }
}

// Nur für gezielte Unit-Tests der Identifikationslogik exportiert.
export { identifyUser };
