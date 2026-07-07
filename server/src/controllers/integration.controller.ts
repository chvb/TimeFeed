import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { Op, literal, where as sqlWhere, fn, col } from 'sequelize';
import { IntegrationSettings } from '../models/IntegrationSettings';
import { Tenant } from '../models/Tenant';
import { User, UserRole } from '../models/User';
import { EmailSettings } from '../models/EmailSettings';
import { PasswordResetToken } from '../models/PasswordResetToken';
import { AppError } from '../middleware/errorHandler';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { resolveUserTenantId } from './branding.controller';
import { resolveWritableCompanyId } from '../services/accessScope';
import emailService from '../services/emailService';
import { normalizeBaseUrl, pingUrlaubsFeed, syncTenantAbsences, fetchUrlaubsFeedUsers, RemoteUser } from '../services/absenceSyncService';

/**
 * UrlaubsFeed-Kopplung (/api/integrations/urlaubsfeed): Settings je Mandant,
 * Verbindungstest und manueller Sync. Zugriff: Super-Admin (Tenant via ?tenantId)
 * oder Admin des Mandanten. Der API-Key wird NIE zurückgegeben (nur hasKey).
 */

const toDto = (s: IntegrationSettings | null, tenantId: number) => ({
  tenantId,
  urlaubsfeedUrl: s?.urlaubsfeedUrl ?? null,
  hasKey: !!s?.urlaubsfeedApiKey,
  syncEnabled: s?.syncEnabled ?? false,
  lastSyncAt: s?.lastSyncAt ?? null,
  lastSyncResult: s?.lastSyncResult ?? null,
});

/** Mandanten-Scope auflösen: eigener Tenant; Super-Admin darf per ?tenantId wählen. */
async function resolveScopedTenantId(req: Request): Promise<number> {
  const u = req.user!;
  const own = await resolveUserTenantId(u);
  if (own) return own;
  if (u.isSuperAdmin) {
    const requested = Number(req.query.tenantId ?? req.body?.tenantId);
    if (Number.isInteger(requested) && requested > 0) return requested;
    // Fallback: einziger/erster Mandant (typische Single-Tenant-Installation).
    const first = await Tenant.findOne({ order: [['id', 'ASC']] });
    if (first) return first.id;
  }
  throw new AppError(400, 'Kein Mandanten-Kontext (tenantId) auflösbar');
}

/** Alle Nutzer eines Mandanten (über Firmen des Tenants ODER direkt am Tenant hängend). */
async function tenantUserInstances(tenantId: number): Promise<User[]> {
  return User.findAll({
    where: {
      [Op.or]: [
        { companyId: { [Op.in]: literal(`(SELECT id FROM companies WHERE tenant_id = ${Number(tenantId)})`) } },
        { tenantId },
      ],
    },
  });
}

/** Remote-Liste laden (Settings-Pflicht prüfen); Fehler der Gegenstelle → AppError 502. */
async function loadRemoteUsers(tenantId: number): Promise<RemoteUser[]> {
  const settings = await IntegrationSettings.findOne({ where: { tenantId } });
  if (!settings?.urlaubsfeedUrl || !settings.urlaubsfeedApiKey) {
    throw new AppError(400, 'UrlaubsFeed-URL und API-Key müssen zuerst gespeichert werden.');
  }
  try {
    return await fetchUrlaubsFeedUsers(settings.urlaubsfeedUrl, settings.urlaubsfeedApiKey);
  } catch (err: any) {
    throw new AppError(502, err?.message || 'UrlaubsFeed nicht erreichbar');
  }
}

/** Abweichungen Remote → Lokal (nur Felder, die der Import überhaupt aktualisiert). */
function diffRemoteLocal(remote: RemoteUser, local: User): { firstName?: string; lastName?: string; employeeNumber?: string } {
  const diff: { firstName?: string; lastName?: string; employeeNumber?: string } = {};
  if (remote.firstName && remote.firstName !== local.firstName) diff.firstName = remote.firstName;
  if (remote.lastName && remote.lastName !== local.lastName) diff.lastName = remote.lastName;
  if (remote.employeeNumber && remote.employeeNumber !== (local.employeeNumber || null)) diff.employeeNumber = remote.employeeNumber;
  return diff;
}

export class IntegrationController {
  /** GET /api/integrations/urlaubsfeed — Settings des Mandanten (Key maskiert). */
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveScopedTenantId(req);
      const settings = await IntegrationSettings.findOne({ where: { tenantId } });
      res.json(toDto(settings, tenantId));
    } catch (e) { next(e); }
  }

  /** PUT /api/integrations/urlaubsfeed — Body { urlaubsfeedUrl?, urlaubsfeedApiKey?, syncEnabled? }. */
  async put(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveScopedTenantId(req);
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) return next(new AppError(404, 'Mandant nicht gefunden'));

      const { urlaubsfeedUrl, urlaubsfeedApiKey, syncEnabled } = req.body ?? {};
      const updateData: any = {};
      if (urlaubsfeedUrl !== undefined) {
        const v = urlaubsfeedUrl === null ? '' : String(urlaubsfeedUrl).trim();
        if (v) {
          try {
            normalizeBaseUrl(v); // Format-/SSRF-Prüfung schon beim Speichern
          } catch (err: any) {
            return next(new AppError(400, err?.message || 'Ungültige UrlaubsFeed-URL'));
          }
        }
        updateData.urlaubsfeedUrl = v || null;
      }
      if (urlaubsfeedApiKey !== undefined) {
        // Leerstring/null löscht den Key; sonst überschreiben.
        const v = urlaubsfeedApiKey === null ? '' : String(urlaubsfeedApiKey).trim();
        updateData.urlaubsfeedApiKey = v || null;
      }
      if (syncEnabled !== undefined) updateData.syncEnabled = !!syncEnabled;

      const [settings] = await IntegrationSettings.findOrCreate({ where: { tenantId }, defaults: { tenantId } });
      await settings.update(updateData);

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.SETTINGS_UPDATE,
        category: AuditCategory.SYSTEM,
        entity: 'IntegrationSettings',
        entityId: settings.id,
        additionalData: { tenantId, urlaubsfeedUrl: settings.urlaubsfeedUrl, hasKey: !!settings.urlaubsfeedApiKey, syncEnabled: settings.syncEnabled },
      }, req);

      res.json(toDto(settings, tenantId));
    } catch (e) { next(e); }
  }

  /** POST /api/integrations/urlaubsfeed/test — Ping mit gespeicherter URL + Key. */
  async test(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveScopedTenantId(req);
      const settings = await IntegrationSettings.findOne({ where: { tenantId } });
      if (!settings?.urlaubsfeedUrl || !settings.urlaubsfeedApiKey) {
        return next(new AppError(400, 'UrlaubsFeed-URL und API-Key müssen zuerst gespeichert werden.'));
      }
      let result;
      try {
        result = await pingUrlaubsFeed(settings.urlaubsfeedUrl, settings.urlaubsfeedApiKey);
      } catch (err: any) {
        // z. B. SSRF-Schutz (interne URL)
        return next(new AppError(400, err?.message || 'Verbindungstest fehlgeschlagen'));
      }
      res.json(result);
    } catch (e) { next(e); }
  }

  /** POST /api/integrations/urlaubsfeed/sync — manueller Sofort-Sync. */
  async sync(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveScopedTenantId(req);
      const result = await syncTenantAbsences(tenantId);
      res.status(result.ok ? 200 : 502).json(result);
    } catch (e) { next(e); }
  }

  /**
   * GET /api/integrations/urlaubsfeed/users — Mitarbeiter-Abgleich (Vorschau).
   * Proxyt {url}/api/external/users der gekoppelten UrlaubsFeed-Instanz und matcht
   * per E-Mail (case-insensitive) gegen die lokalen Nutzer des Mandanten:
   * status 'new' (unbekannt) | 'exists' (identisch) | 'diff' (Name/Personalnr. weichen ab).
   */
  async listRemoteUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveScopedTenantId(req);
      const remote = await loadRemoteUsers(tenantId);
      const locals = await tenantUserInstances(tenantId);
      const localByEmail = new Map<string, User>();
      locals.forEach((u) => localByEmail.set(u.email.toLowerCase(), u));

      const users = remote
        .filter((r) => r.email && String(r.email).includes('@'))
        .map((r) => {
          const local = localByEmail.get(String(r.email).toLowerCase());
          let status: 'new' | 'exists' | 'diff' = 'new';
          let diff: ReturnType<typeof diffRemoteLocal> | undefined;
          if (local) {
            const d = diffRemoteLocal(r, local);
            status = Object.keys(d).length > 0 ? 'diff' : 'exists';
            if (status === 'diff') diff = d;
          }
          return {
            firstName: r.firstName || '',
            lastName: r.lastName || '',
            email: String(r.email),
            employeeNumber: r.employeeNumber || null,
            groupName: r.groupName || null,
            status,
            ...(diff ? { diff } : {}),
          };
        });
      res.json({ users });
    } catch (e) { next(e); }
  }

  /**
   * POST /api/integrations/urlaubsfeed/import-users
   * Body { emails: string[], updateExisting: boolean, sendWelcome: boolean, companyId? }.
   * Lädt die Remote-Liste erneut und importiert NUR die gewählten E-Mails:
   * - Neu → Nutzer anlegen (Rolle 'mitarbeiter', Zufallspasswort, stampCode automatisch
   *   per Model-Hook; Firma via resolveWritableCompanyId — bei mehreren Firmen ist
   *   body.companyId Pflicht, Muster wie bei Terminals).
   * - Vorhanden → nur bei updateExisting Name/Personalnr. aktualisieren
   *   (E-Mail/Rolle/Passwort werden NIE angefasst).
   * - sendWelcome → PasswordResetToken + gebrandete Willkommens-Mail („Passwort
   *   festlegen"); nur bei aktivem SMTP, Versandfehler werden geschluckt.
   */
  async importUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveScopedTenantId(req);
      const { emails, updateExisting, sendWelcome } = req.body ?? {};
      if (!Array.isArray(emails) || emails.length === 0) {
        return next(new AppError(400, 'emails (nicht-leeres Array) erforderlich'));
      }

      const remote = await loadRemoteUsers(tenantId);
      const remoteByEmail = new Map<string, RemoteUser>();
      remote.forEach((r) => { if (r.email) remoteByEmail.set(String(r.email).toLowerCase(), r); });

      const locals = await tenantUserInstances(tenantId);
      const localByEmail = new Map<string, User>();
      locals.forEach((u) => localByEmail.set(u.email.toLowerCase(), u));

      // Gewählte E-Mails normalisieren + deduplizieren.
      const selected = [...new Set(emails.map((e: any) => String(e || '').trim().toLowerCase()).filter(Boolean))];

      // Zielfirma für NEUE Nutzer (resolveWritableCompanyId-Muster wie bei Terminals):
      // wirft 403 bei fremder Firma; null = keine Firma auflösbar → nur dann Fehler,
      // wenn tatsächlich neue Nutzer angelegt werden sollen.
      const companyId = await resolveWritableCompanyId(req.user!, req.body?.companyId);
      const needsCreate = selected.some((e) => remoteByEmail.has(e) && !localByEmail.has(e));
      if (needsCreate && companyId == null) {
        return next(new AppError(400, 'Bitte eine Firma wählen (companyId).'));
      }

      // Willkommens-Mail nur bei aktivem SMTP (sonst still übersprungen).
      const wantWelcome = !!sendWelcome;
      let smtpActive = false;
      if (wantWelcome) {
        const es = await EmailSettings.findOne();
        smtpActive = !!es?.isActive;
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { email: string; reason: string }[] = [];

      for (const email of selected) {
        const r = remoteByEmail.get(email);
        if (!r) { errors.push({ email, reason: 'In UrlaubsFeed nicht gefunden' }); continue; }
        const local = localByEmail.get(email);
        try {
          if (local) {
            // Vorhandene: nur Name/Personalnr., NIE E-Mail/Rolle/Passwort.
            if (!updateExisting) { skipped++; continue; }
            const fields = diffRemoteLocal(r, local);
            if (Object.keys(fields).length === 0) { skipped++; continue; }
            await local.update(fields);
            updated++;
          } else {
            if (!r.firstName || !r.lastName) { errors.push({ email, reason: 'Vor-/Nachname fehlt in UrlaubsFeed' }); continue; }
            // Duplikat außerhalb des Mandanten-Scopes sauber melden statt Unique-Crash.
            const clash = await User.findOne({ where: sqlWhere(fn('lower', col('email')), email) });
            if (clash) { errors.push({ email, reason: 'E-Mail existiert bereits (außerhalb des Mandanten-Kontexts)' }); continue; }
            const newUser = await User.create({
              email,
              // Zufallspasswort (Muster wie CSV-Import) — der Nutzer setzt es per Willkommens-Link neu.
              password: crypto.randomBytes(9).toString('base64') + 'A1!',
              firstName: r.firstName,
              lastName: r.lastName,
              employeeNumber: r.employeeNumber || undefined,
              role: UserRole.MITARBEITER,
              companyId: companyId as number,
              isActive: true,
              startDate: new Date(), // stampCode wird automatisch im beforeCreate-Hook vergeben
            });
            created++;
            if (wantWelcome && smtpActive) {
              try {
                const token = crypto.randomBytes(32).toString('hex');
                await PasswordResetToken.create({
                  userId: newUser.id,
                  token,
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 Tage
                });
                await emailService.sendWelcome(newUser.email, newUser.firstName, token);
              } catch (mailErr: any) {
                // Fehler beim Mail-Versand bewusst schlucken — der Import selbst gilt als erfolgreich.
                console.error(`Willkommens-Mail an ${newUser.email} fehlgeschlagen:`, mailErr?.message || mailErr);
              }
            }
          }
        } catch (e: any) {
          errors.push({ email, reason: e?.message || 'Unbekannter Fehler' });
        }
      }

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.IMPORT,
        category: AuditCategory.IMPORT_EXPORT,
        entity: 'User',
        additionalData: { source: 'urlaubsfeed', tenantId, companyId, created, updated, skipped, errors: errors.length },
      }, req);

      res.json({ created, updated, skipped, errors });
    } catch (e) { next(e); }
  }
}

export const integrationController = new IntegrationController();
