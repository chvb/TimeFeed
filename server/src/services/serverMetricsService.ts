import { Op } from 'sequelize';
import { Heartbeat } from '../models/Heartbeat';

const START = new Date();
const INTERVAL_MS = 5 * 60 * 1000; // 5 Minuten

export function getProcessStart(): Date {
  return START;
}

async function recordHeartbeat(): Promise<void> {
  try { await Heartbeat.create({}); } catch { /* ignore */ }
}

async function pruneOld(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 31 * 86400000);
    await Heartbeat.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
  } catch { /* ignore */ }
}

/** Startet die Heartbeat-Aufzeichnung (für die Uptime-Berechnung). */
export function startHeartbeats(): void {
  recordHeartbeat();
  setInterval(() => { recordHeartbeat(); pruneOld(); }, INTERVAL_MS);
}

// Kurzer Cache, damit /health (häufiger Poll vieler Clients) nicht bei jedem
// Aufruf zwei Queries auslöst.
let uptimeCache: { ts: number; val: number | null } = { ts: 0, val: null };
const UPTIME_CACHE_MS = 5 * 60 * 1000;

/** Gecachte Variante (5 Minuten) für häufige Aufrufe. */
export async function getUptime30dCached(): Promise<number | null> {
  if (Date.now() - uptimeCache.ts < UPTIME_CACHE_MS) return uptimeCache.val;
  const val = await getUptime30d();
  uptimeCache = { ts: Date.now(), val };
  return val;
}

/**
 * Uptime der letzten 30 Tage in % = aufgezeichnete Heartbeats / erwartete
 * Heartbeats im Fenster (ab dem ersten Heartbeat, max. 30 Tage zurück).
 */
export async function getUptime30d(): Promise<number | null> {
  try {
    const now = Date.now();
    const first = await Heartbeat.findOne({ order: [['createdAt', 'ASC']] });
    if (!first) return null;
    const firstTs = new Date((first as any).createdAt).getTime();
    const windowStart = Math.max(firstTs, now - 30 * 86400000);
    const expected = Math.max(1, Math.floor((now - windowStart) / INTERVAL_MS));
    const actual = await Heartbeat.count({ where: { createdAt: { [Op.gte]: new Date(windowStart) } } });
    return Math.min(100, Math.round((actual / expected) * 10000) / 100);
  } catch {
    return null;
  }
}
