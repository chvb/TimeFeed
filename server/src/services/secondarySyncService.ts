import storageService from './storageService';
import { pendingSecondary, pendingBackfill } from './secondaryPendingStore';

/**
 * Sekundär-Sync (alle 15 Minuten, Start via timeRecalcJob):
 *
 * 1. Mirror-Sync (`.pending-secondary.json`): Objekte, deren fire-and-forget-
 *    Spiegelung fehlschlug, nachspiegeln — GET Primary → PUT Secondary.
 * 2. Backfill (`.pending-backfill.json`): Objekte, die per Write-Failover nur
 *    auf dem Sekundär liegen, zurückkopieren — GET Secondary → PUT Primary,
 *    danach das Sekundär-Objekt löschen (Aufräumen; Muster: FotoFeed
 *    secondaryBackfillService).
 *
 * isRunning-Guard (nur ein Lauf gleichzeitig) + exponentieller Backoff bei
 * wiederholt fehlschlagenden Läufen (max. 4 h Pause).
 */

export interface SecondarySyncResult {
  mirrored: number;
  backfilled: number;
  failed: number;
  skipped?: string;
}

interface SyncState {
  isRunning: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'idle' | 'running' | 'completed' | 'failed' | 'skipped';
  lastResult: SecondarySyncResult | null;
  consecutiveFailures: number;
  nextAllowedRunAt: number; // epoch ms (Backoff-Gate)
}

const BATCH_SIZE = 50;
const BASE_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 4 * 60 * 60 * 1000;

const state: SyncState = {
  isRunning: false,
  lastRunAt: null,
  lastRunStatus: 'idle',
  lastResult: null,
  consecutiveFailures: 0,
  nextAllowedRunAt: 0,
};

export function getSecondarySyncStatus() {
  return {
    ...state,
    pendingSecondary: pendingSecondary.count(),
    pendingBackfill: pendingBackfill.count(),
  };
}

/** Ein Sync-Lauf. `force` ignoriert das Backoff-Gate (manueller Aufruf). */
export async function runSecondarySync(opts?: { force?: boolean }): Promise<SecondarySyncResult> {
  if (state.isRunning) return { mirrored: 0, backfilled: 0, failed: 0, skipped: 'already-running' };
  if (!opts?.force && Date.now() < state.nextAllowedRunAt) {
    return { mirrored: 0, backfilled: 0, failed: 0, skipped: 'backoff' };
  }

  state.isRunning = true;
  state.lastRunAt = new Date().toISOString();
  state.lastRunStatus = 'running';

  try {
    const settings = await storageService.getSettings();
    if (!storageService.hasSecondary(settings)) {
      const result: SecondarySyncResult = { mirrored: 0, backfilled: 0, failed: 0, skipped: 'no-secondary-config' };
      state.lastRunStatus = 'skipped';
      state.lastResult = result;
      return result;
    }

    let mirrored = 0;
    let backfilled = 0;
    let failed = 0;

    // --- 1. Mirror-Sync: Primary → Secondary ---------------------------
    for (const key of pendingSecondary.list().slice(0, BATCH_SIZE)) {
      try {
        const buffer = await storageService.getPrimaryObjectBuffer(key, settings);
        await storageService.putSecondaryObject(key, buffer, 'application/octet-stream', settings);
        pendingSecondary.remove(key);
        mirrored++;
      } catch (e: any) {
        // Objekt existiert auf dem Primär nicht mehr (z. B. gelöscht) → Eintrag verwerfen.
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
          pendingSecondary.remove(key);
        } else {
          failed++;
          console.warn(`SecondarySync: Mirror für ${key} fehlgeschlagen: ${e?.message}`);
        }
      }
    }

    // --- 2. Backfill: Secondary → Primary (danach Sekundär-Objekt löschen) ---
    for (const key of pendingBackfill.list().slice(0, BATCH_SIZE)) {
      try {
        const buffer = await storageService.getSecondaryObjectBuffer(key, settings);
        await storageService.putPrimaryObject(key, buffer, 'application/octet-stream', settings);
        try {
          await storageService.deleteSecondaryObject(key, settings);
        } catch (delErr: any) {
          // Nicht kritisch: Kopie liegt jetzt auf beiden — nur Aufräumen schlug fehl.
          console.warn(`SecondarySync: Sekundär-Objekt ${key} konnte nicht aufgeräumt werden: ${delErr?.message}`);
        }
        pendingBackfill.remove(key);
        backfilled++;
      } catch (e: any) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
          pendingBackfill.remove(key);
        } else {
          failed++;
          console.warn(`SecondarySync: Backfill für ${key} fehlgeschlagen: ${e?.message}`);
        }
      }
    }

    const result: SecondarySyncResult = { mirrored, backfilled, failed };
    state.lastResult = result;

    if (failed > 0 && mirrored === 0 && backfilled === 0) {
      // Kompletter Fehlschlag → Backoff hochfahren.
      state.consecutiveFailures++;
      state.lastRunStatus = 'failed';
      const backoff = Math.min(BASE_INTERVAL_MS * Math.pow(2, state.consecutiveFailures - 1), MAX_BACKOFF_MS);
      state.nextAllowedRunAt = Date.now() + backoff;
      console.warn(`SecondarySync: Lauf fehlgeschlagen (${state.consecutiveFailures}×) — Backoff ${Math.round(backoff / 60000)} Min.`);
    } else {
      state.consecutiveFailures = 0;
      state.nextAllowedRunAt = 0;
      state.lastRunStatus = failed > 0 ? 'failed' : 'completed';
      if (mirrored + backfilled + failed > 0) {
        console.log(`SecondarySync: mirrored=${mirrored} backfilled=${backfilled} failed=${failed}.`);
      }
    }
    return result;
  } catch (e: any) {
    state.consecutiveFailures++;
    state.lastRunStatus = 'failed';
    const backoff = Math.min(BASE_INTERVAL_MS * Math.pow(2, state.consecutiveFailures - 1), MAX_BACKOFF_MS);
    state.nextAllowedRunAt = Date.now() + backoff;
    console.error(`SecondarySync: Lauf abgebrochen (${e?.message}) — Backoff ${Math.round(backoff / 60000)} Min.`);
    return { mirrored: 0, backfilled: 0, failed: 1, skipped: undefined };
  } finally {
    state.isRunning = false;
  }
}

export const SECONDARY_SYNC_INTERVAL_MS = BASE_INTERVAL_MS;
