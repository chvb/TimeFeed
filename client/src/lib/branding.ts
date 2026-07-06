// Runtime-Mandanten-Branding: lädt nach dem Login GET /api/branding und wendet
// Name/Farbe/Logo global an (Druckausgaben via brand.ts, CSS-Variable,
// theme-color-Meta, PWA-Manifest je Mandant). Kleiner Publish/Subscribe-Store,
// damit Layout & Co. ohne zusätzliche Abhängigkeit re-rendern (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import api from './api';
import { setCompanyBranding } from '../components/common/brand';

export interface TenantBranding {
  brandName?: string | null;
  brandColor?: string | null;
  brandLogo?: string | null;
  tenantId?: number | null;
}

let current: TenantBranding = {};
const listeners = new Set<() => void>();

export function getBranding(): TenantBranding {
  return current;
}

export function subscribeBranding(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Branding im DOM/Print-Stack anwenden (idempotent, auch mit leerem Objekt = zurücksetzen). */
export function applyBranding(b: TenantBranding): void {
  current = { ...b };

  // 1) Druck-/PDF-Ausgaben (brand.ts) mit Firmenname/-logo füttern.
  setCompanyBranding({ name: b.brandName || undefined, logo: b.brandLogo || undefined });

  // 2) Markenfarbe: CSS-Variable + theme-color-Meta (Browser-UI/PWA).
  const root = document.documentElement;
  if (b.brandColor) {
    root.style.setProperty('--tf-brand-color', b.brandColor);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', b.brandColor);
  } else {
    root.style.removeProperty('--tf-brand-color');
  }

  // 3) Manifest je Mandant (Server liefert gebrandetes Manifest).
  if (b.tenantId != null) {
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', `/manifest.webmanifest?tenant=${b.tenantId}`);
  }

  listeners.forEach((l) => l());
}

/**
 * Nach dem Login aufrufen: Branding vom Server holen und anwenden.
 * Fehler (Endpunkt fehlt / kein Branding gesetzt) werden bewusst geschluckt.
 */
export async function loadBranding(fallbackTenantId?: number | null): Promise<void> {
  try {
    const r = await api.get('/branding');
    const d = r.data?.branding || r.data || {};
    const b: TenantBranding = {
      brandName: d.brandName ?? null,
      brandColor: d.brandColor ?? null,
      brandLogo: d.brandLogo ?? null,
      tenantId: d.tenantId ?? fallbackTenantId ?? null,
    };
    if (b.brandName || b.brandColor || b.brandLogo) applyBranding(b);
  } catch {
    /* kein Branding verfügbar → Standard-Marke behalten */
  }
}

/** React-Hook: aktuelles Branding (re-rendert bei applyBranding). */
export function useBranding(): TenantBranding {
  return useSyncExternalStore(subscribeBranding, getBranding);
}
