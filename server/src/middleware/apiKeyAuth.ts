import { Request, Response, NextFunction } from 'express';
import { ApiKey, hashApiKey } from '../models/ApiKey';
import { Tenant } from '../models/Tenant';

// Authentifizierung für die externe API (/api/external) über den Header `X-Api-Key`.
// KEIN JWT: Der Schlüssel wird per SHA-256-Hash nachgeschlagen (Klartext liegt nie in
// der DB), isActive/expiresAt geprüft und der Mandanten-Kontext an den Request gehängt.

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      apiTenantId?: number;
      apiTenantName?: string;
    }
  }
}

// lastUsedAt nur gedrosselt schreiben (max. 1x/Minute pro Schlüssel), damit
// hochfrequente Abrufe nicht bei jedem Request einen DB-Write auslösen.
const LAST_USED_THROTTLE_MS = 60 * 1000;
const lastUsedWrites = new Map<number, number>();

const unauthorized = (res: Response, message: string) =>
  res.status(401).json({ error: message, message });

/**
 * Middleware-Fabrik: prüft den API-Key und (optional) einen benötigten Scope.
 * Bei Erfolg: req.apiKey / req.apiTenantId / req.apiTenantName gesetzt.
 */
export const apiKeyAuth = (requiredScope?: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = req.header('X-Api-Key');
      if (!rawKey || !rawKey.trim()) {
        return unauthorized(res, 'API key required (X-Api-Key header).');
      }

      const apiKey = await ApiKey.findOne({
        where: { keyHash: hashApiKey(rawKey.trim()) },
        include: [{ model: Tenant, as: 'tenant', attributes: ['id', 'name', 'isActive'] }],
      });
      if (!apiKey || !apiKey.isActive) {
        return unauthorized(res, 'Invalid or revoked API key.');
      }
      if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() < Date.now()) {
        return unauthorized(res, 'API key expired.');
      }
      const tenant: any = (apiKey as any).tenant;
      if (!tenant || tenant.isActive === false) {
        return unauthorized(res, 'Tenant inactive.');
      }
      if (requiredScope && !apiKey.hasScope(requiredScope)) {
        return res.status(403).json({ error: 'Insufficient scope.', message: 'Insufficient scope.' });
      }

      // lastUsedAt gedrosselt aktualisieren (fire-and-forget, blockiert den Request nicht).
      const now = Date.now();
      const lastWrite = lastUsedWrites.get(apiKey.id) || 0;
      if (now - lastWrite > LAST_USED_THROTTLE_MS) {
        lastUsedWrites.set(apiKey.id, now);
        apiKey.update({ lastUsedAt: new Date() }).catch(() => { /* unkritisch */ });
      }

      req.apiKey = apiKey;
      req.apiTenantId = apiKey.tenantId;
      req.apiTenantName = tenant.name;
      return next();
    } catch (e) {
      return next(e);
    }
  };
};
