// Offline-Queue des Terminals: IndexedDB 'tf-terminal', Store 'pendingStamps'.
// Netzwerkbedingt fehlgeschlagene Stempelungen werden hier gepuffert und vom
// Hintergrund-Sync (Terminal.tsx) mit Original-Zeitstempel nachgereicht.
import type { StampType } from './terminalApi';

const DB_NAME = 'tf-terminal';
const STORE = 'pendingStamps';

export interface PendingStamp {
  id?: number;
  stampCode?: string;
  nfcTagUid?: string;
  pin?: string;
  type: StampType;
  /** Original-Zeitpunkt der Stempelung (ISO), wird beim Nachreichen mitgesendet. */
  clientTimestamp: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function addPendingStamp(item: PendingStamp): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(item);
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** Alle wartenden Stempelungen in Einfüge-Reihenfolge (aufsteigende id). */
export async function getPendingStamps(): Promise<(PendingStamp & { id: number })[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    const items: (PendingStamp & { id: number })[] = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return items.sort((a, b) => a.id - b.id);
  } finally {
    db.close();
  }
}

export async function removePendingStamp(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function countPendingStamps(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    return await new Promise<number>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
