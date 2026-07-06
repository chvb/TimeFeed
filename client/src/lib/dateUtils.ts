/**
 * Formatiert ein Date als YYYY-MM-DD anhand der LOKALEN Datumsbestandteile.
 * Im Gegensatz zu `date.toISOString().split('T')[0]` (UTC) verschiebt sich der
 * Tag dadurch nicht in Zeitzonen mit Offset (z.B. CEST) — wichtig, damit
 * Kalender-Zell-Keys und Server-Datumswerte konsistent matchen.
 */
/**
 * Copyright-Jahresangabe ab 2026: liefert "2026" und ab dem Folgejahr einen
 * Bereich, z.B. "2026–2027".
 */
export function copyrightYears(start = 2026): string {
  const now = new Date().getFullYear();
  return now > start ? `${start}–${now}` : `${start}`;
}

export function toLocalISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
