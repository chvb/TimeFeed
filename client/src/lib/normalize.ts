/**
 * Normalisiert Text für die Suche: Kleinbuchstaben, ß→ss und Diakritika entfernt
 * (ä→a, ö→o, ü→u, é→e …). So matcht "muller" auch "Müller" und "schafer" → "Schäfer".
 */
export function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** true, wenn `haystack` den normalisierten `needle` enthält (leerer needle = true). */
export function matchesSearch(haystack: string, needle: string): boolean {
  const q = normalizeText(needle).trim();
  if (!q) return true;
  return normalizeText(haystack).includes(q);
}
