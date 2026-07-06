// Zentrale Markendefinition – Logo, Farben, Name, Copyright.
// WICHTIG: Das Logo nur HIER ändern. React (<Logo>) sowie alle Print-/PDF-Ausgaben
// beziehen Markup, Farben und Wortmarke aus dieser einen Quelle.
import { escapeHtml } from '../../lib/escapeHtml';

export const BRAND_NAME = 'TimeFeed';
export const BRAND_GRADIENT_FROM = '#fb923c';
export const BRAND_GRADIENT_TO = '#ea580c';
export const BRAND_PRIMARY = '#ea580c';

export const LOGO_VIEWBOX = '0 0 120 120';

/**
 * Inneres SVG-Markup des Logos (ohne <svg>-Hülle). Gradient-ID: tf-logo-grad.
 * Motiv: abgerundete Kachel im Orange-Verlauf mit Stempeluhr-Zifferblatt
 * (Kommen/Gehen-Zeiger), klar und business-tauglich.
 */
export const LOGO_INNER_SVG = `
<defs><linearGradient id="tf-logo-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${BRAND_GRADIENT_FROM}"/><stop offset="100%" stop-color="${BRAND_GRADIENT_TO}"/></linearGradient></defs>
<rect width="120" height="120" rx="28" fill="url(#tf-logo-grad)"/>
<circle cx="60" cy="60" r="34" fill="#fff"/>
<circle cx="60" cy="30" r="4" fill="#fdba74"/>
<circle cx="90" cy="60" r="4" fill="#fdba74"/>
<circle cx="60" cy="90" r="4" fill="#fdba74"/>
<circle cx="30" cy="60" r="4" fill="#fdba74"/>
<path d="M60 62 L60 40" fill="none" stroke="url(#tf-logo-grad)" stroke-width="7" stroke-linecap="round"/>
<path d="M60 60 L75 69" fill="none" stroke="url(#tf-logo-grad)" stroke-width="7" stroke-linecap="round"/>
<circle cx="60" cy="60" r="5" fill="url(#tf-logo-grad)"/>
`.trim();

/** Vollständiges <svg> als String – für Print-/PDF-/HTML-Ausgaben. */
export function logoSvgString(pixelSize = 40): string {
  return `<svg width="${pixelSize}" height="${pixelSize}" viewBox="${LOGO_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-label="${BRAND_NAME}">${LOGO_INNER_SVG}</svg>`;
}

/** Wortmarke als HTML-String (für Print/PDF). Ohne Farbe = zweifarbig (Time/Feed). */
export function wordmarkHtml(color?: string): string {
  if (color) return `<span style="color:${color};font-weight:700;letter-spacing:-0.02em">${BRAND_NAME}</span>`;
  return `<span style="font-weight:700;letter-spacing:-0.02em"><span style="color:#0f172a">Time</span><span style="color:${BRAND_PRIMARY}">Feed</span></span>`;
}

export function copyrightText(year?: number): string {
  const y = year ?? new Date().getFullYear();
  return `© ${y} ${BRAND_NAME}`;
}

// Optionales Firmen-Branding (Mandant): Logo (Bild-Data-URL/URL) + Name. Wird beim
// Login gesetzt (setCompanyBranding) und in allen Druck-/PDF-Ausgaben verwendet.
let companyBranding: { name?: string; logo?: string } = {};
export function setCompanyBranding(b: { name?: string | null; logo?: string | null }): void {
  companyBranding = { name: b?.name || undefined, logo: b?.logo || undefined };
}

/** Gebrandeter Kopf für Druck-/PDF-HTML (Logo + Wortmarke + Titel, Orange-Linie). */
export function printHeaderHtml(title: string, subtitle = ''): string {
  const logoHtml = companyBranding.logo
    ? `<img src="${escapeHtml(companyBranding.logo)}" alt="" style="height:36px;width:auto;max-width:160px;object-fit:contain"/>`
    : logoSvgString(36);
  const markHtml = companyBranding.name
    ? `<span style="font-weight:700;letter-spacing:-0.02em;color:#0f172a">${escapeHtml(companyBranding.name)}</span>`
    : wordmarkHtml();
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${BRAND_PRIMARY};padding-bottom:10px;margin-bottom:16px;">
    <div style="display:flex;align-items:center;gap:10px;">
      ${logoHtml}
      <span style="font-size:20px;">${markHtml}</span>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-size:11px;color:#64748b;">${escapeHtml(subtitle)}</div>` : ''}
    </div>
  </div>`;
}

/** Gebrandeter Fuß mit Copyright + Erstellungsdatum. */
export function printFooterHtml(): string {
  const d = new Date().toLocaleDateString('de-DE');
  return `
  <div style="margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
    <span>${copyrightText()}</span>
    <span>Erstellt am ${d}</span>
  </div>`;
}
