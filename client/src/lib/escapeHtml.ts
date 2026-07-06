/**
 * Escaped HTML-Sonderzeichen für sichere Interpolation in HTML-Strings
 * (z.B. Druckansichten, die per document.write() ausgegeben werden).
 * Verhindert DOM-XSS über Nutzer-Eingaben wie Namen/Feiertagsnamen.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
