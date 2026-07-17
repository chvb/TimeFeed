import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { Tenant } from '../models/Tenant';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';

// Maximale Größe des Logos als Data-URL-String (~500 KB Binärdaten entsprechen
// ca. 683k Base64-Zeichen; wir kappen den STRING bei 700k Zeichen).
export const MAX_BRAND_LOGO_CHARS = 2_900_000; // ~2 MB Binärdaten als Data-URL

// Erlaubte Logo-Formate (Data-URL-Präfixe). SVG darf base64- ODER utf8/url-kodiert sein.
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/i;

/** Prüft eine Logo-Data-URL; wirft AppError bei Verstößen. */
export function validateBrandLogo(logo: string): void {
  if (logo.length > MAX_BRAND_LOGO_CHARS) {
    throw new AppError(400, 'brandLogo zu groß (max. ~500 KB als Data-URL)');
  }
  if (!LOGO_DATA_URL_RE.test(logo)) {
    throw new AppError(400, 'brandLogo muss eine Data-URL sein (data:image/png|jpeg|webp|svg+xml)');
  }
}

export const BRAND_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Mandanten-Kontext des eingeloggten Nutzers: direkt (tenantId) oder über seine Firma. */
export async function resolveUserTenantId(user: { tenantId?: number | null; companyId?: number | null }): Promise<number | null> {
  if (user.tenantId) return user.tenantId;
  if (user.companyId) {
    const company = await Company.findByPk(user.companyId, { attributes: ['id', 'tenantId'] });
    if (company?.tenantId) return company.tenantId;
  }
  return null;
}

const brandingDto = (t: Tenant | null) => ({
  brandName: t?.brandName ?? null,
  brandColor: t?.brandColor ?? null,
  brandLogo: t?.brandLogo ?? null,
});

// Pfad zum statischen Standard-Manifest (dist/controllers → ../../public).
const DEFAULT_MANIFEST_PATH = path.join(__dirname, '../../public/manifest.webmanifest');
let defaultManifestCache: any | null = null;

function loadDefaultManifest(): any {
  if (!defaultManifestCache) {
    defaultManifestCache = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
  }
  return defaultManifestCache;
}

/** Data-URL zerlegen → { mime, buffer } (bei utf8-SVG wird der Text dekodiert). */
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const isBase64 = !!m[2];
  try {
    const buffer = isBase64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
    return { mime, buffer };
  } catch {
    return null;
  }
}

export class BrandingController {
  /** GET /api/branding — Branding des eigenen Mandanten (authentifiziert). */
  async getOwn(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = await resolveUserTenantId(req.user!);
      // Super-Admin ohne eigenen Mandanten: neutraler Default.
      if (!tenantId) return res.json({ tenantId: null, ...brandingDto(null) });
      const tenant = await Tenant.findByPk(tenantId);
      return res.json({ tenantId, ...brandingDto(tenant) });
    } catch (e) { return next(e); }
  }

  /** GET /api/branding/public?tenant=<id> — öffentlich (Login-Seite/PWA), nur Brand-Felder. */
  async getPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = Number(req.query.tenant);
      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return next(new AppError(400, 'Query-Parameter tenant (Mandanten-ID) erforderlich'));
      }
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant || !tenant.isActive) return next(new AppError(404, 'Mandant nicht gefunden'));
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json(brandingDto(tenant));
    } catch (e) { return next(e); }
  }

  /**
   * GET /api/branding/icon?tenant=<id>&size=192|512 — liefert das Logo als Bild
   * (PNG/JPEG/WebP dekodiert aus der Data-URL; SVG direkt als image/svg+xml).
   * `size` dient nur der Manifest-Icon-Deklaration, skaliert wird nicht.
   */
  async getIcon(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = Number(req.query.tenant);
      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return next(new AppError(400, 'Query-Parameter tenant (Mandanten-ID) erforderlich'));
      }
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant || !tenant.isActive || !tenant.brandLogo) {
        return next(new AppError(404, 'Kein Logo hinterlegt'));
      }
      const decoded = decodeDataUrl(tenant.brandLogo);
      if (!decoded) return next(new AppError(500, 'Logo-Data-URL ungültig'));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', decoded.mime === 'image/svg+xml' ? 'image/svg+xml' : decoded.mime);
      if (decoded.mime === 'image/svg+xml') {
        // Gehärtet: hochgeladenes SVG als isoliertes, inaktives Dokument ausliefern —
        // blockt eingebettete Skripte/Event-Handler unabhängig von der globalen CSP.
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
      return res.send(decoded.buffer);
    } catch (e) { return next(e); }
  }

  /**
   * GET /manifest.webmanifest — dynamisches PWA-Manifest.
   * Ohne ?tenant: Standard-TimeFeed-Manifest (identisch zur statischen Datei).
   * Mit ?tenant=<id>: name/short_name=brandName, theme_color=brandColor und – falls
   * ein Logo hinterlegt ist – Icons über /api/branding/icon.
   */
  async manifest(req: Request, res: Response, next: NextFunction) {
    try {
      res.setHeader('Content-Type', 'application/manifest+json');
      const base = loadDefaultManifest();

      const tenantId = Number(req.query.tenant);
      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.json(base);
      }

      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant || !tenant.isActive) {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.json(base);
      }

      const manifest: any = { ...base };
      if (tenant.brandName) {
        manifest.name = tenant.brandName;
        manifest.short_name = tenant.brandName;
      }
      if (tenant.brandColor) {
        manifest.theme_color = tenant.brandColor;
        manifest.background_color = tenant.brandColor;
      }
      if (tenant.brandLogo) {
        const decoded = decodeDataUrl(tenant.brandLogo);
        if (decoded?.mime === 'image/svg+xml') {
          manifest.icons = [
            { src: `/api/branding/icon?tenant=${tenant.id}`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ];
        } else if (decoded) {
          manifest.icons = [
            { src: `/api/branding/icon?tenant=${tenant.id}&size=192`, sizes: '192x192', type: decoded.mime, purpose: 'any' },
            { src: `/api/branding/icon?tenant=${tenant.id}&size=512`, sizes: '512x512', type: decoded.mime, purpose: 'any' },
          ];
        }
      }
      // PWA-Identität/Start je Mandant trennen, damit mehrere gebrandete
      // Installationen nebeneinander existieren können.
      manifest.id = `/?tenant=${tenant.id}`;
      manifest.start_url = `/?source=pwa&tenant=${tenant.id}`;

      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json(manifest);
    } catch (e) { return next(e); }
  }
}

export const brandingController = new BrandingController();
