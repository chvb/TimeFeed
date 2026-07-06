/**
 * Copyright-Jahresangabe ab 2026: "2026", ab Folgejahr Bereich "2026–2027" usw.
 */
export function copyrightYears(start = 2026): string {
  const now = new Date().getFullYear();
  return now > start ? `${start}–${now}` : `${start}`;
}
