import api from './api';

// Einfacher In-Memory-Cache für selten ändernde GET-Daten (Settings, Abwesenheitsarten, Feiertage),
// um Mehrfach-Fetches pro Seitenaufruf zu vermeiden.
const cache = new Map<string, { ts: number; data: any }>();

export async function cachedGet(url: string, ttlMs = 5 * 60 * 1000): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data;
  const res = await api.get(url);
  cache.set(url, { ts: Date.now(), data: res.data });
  return res.data;
}

/** Cache für eine URL (oder komplett) leeren – nach Änderungen aufrufen. */
export function invalidateCache(url?: string): void {
  if (url) cache.delete(url);
  else cache.clear();
}
