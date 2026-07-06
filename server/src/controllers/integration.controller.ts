import { Request, Response, NextFunction } from 'express';
import { IntegrationSettings } from '../models/IntegrationSettings';
import { Tenant } from '../models/Tenant';
import { AppError } from '../middleware/errorHandler';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { resolveUserTenantId } from './branding.controller';
import { normalizeBaseUrl, pingUrlaubsFeed, syncTenantAbsences } from '../services/absenceSyncService';

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
}

export const integrationController = new IntegrationController();
