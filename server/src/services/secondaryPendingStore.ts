import * as fs from 'fs';
import * as path from 'path';

/**
 * Persistente Key-Listen für den sekundären S3-Spiegel (JSON-Statusdateien
 * unter server/uploads/, atomar geschrieben via tmp-Datei + rename):
 *
 * - `.pending-secondary.json`: Objekte, die erfolgreich auf den PRIMÄREN S3
 *   geschrieben wurden, deren fire-and-forget-Spiegelung auf den Sekundär
 *   aber fehlschlug → secondarySyncService spiegelt sie später nach
 *   (GET Primary → PUT Secondary).
 * - `.pending-backfill.json`: Objekte, die per Write-Failover NUR auf dem
 *   SEKUNDÄREN S3 gelandet sind → secondarySyncService kopiert sie zurück
 *   (GET Secondary → PUT Primary, danach Sekundär-Objekt löschen).
 *
 * Bewusst KEIN neues Sequelize-Modell (models/index.ts ist für diese Aufgabe
 * tabu). Die Listen sind klein (nur Fehlerfälle); synchrone fs-Operationen
 * sind hier ausreichend und innerhalb des Prozesses race-frei.
 */

// <server>/uploads — funktioniert aus src/services und dist/services.
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

export interface PendingFileFormat {
  keys: string[];
}

export class PendingKeyStore {
  constructor(private readonly filePath: string) {}

  getFilePath(): string {
    return this.filePath;
  }

  /** Liest die Key-Liste; fehlende/korrupte Datei → leere Liste. */
  list(): string[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PendingFileFormat;
      if (parsed && Array.isArray(parsed.keys)) {
        return parsed.keys.filter((k) => typeof k === 'string' && k.length > 0);
      }
    } catch {
      /* fehlt oder korrupt → wie leer behandeln */
    }
    return [];
  }

  /** Fügt einen Key hinzu (dedupliziert). Fehler werden geschluckt (fire-and-forget-Pfad). */
  add(key: string): void {
    if (!key) return;
    try {
      const keys = this.list();
      if (keys.includes(key)) return;
      keys.push(key);
      this.writeAtomic(keys);
    } catch (e: any) {
      console.error(`PendingKeyStore(${path.basename(this.filePath)}): add fehlgeschlagen:`, e?.message);
    }
  }

  /** Entfernt einen Key (z. B. nach erfolgreicher Nachspiegelung oder Delete). */
  remove(key: string): void {
    if (!key) return;
    try {
      const keys = this.list();
      const next = keys.filter((k) => k !== key);
      if (next.length === keys.length) return;
      this.writeAtomic(next);
    } catch (e: any) {
      console.error(`PendingKeyStore(${path.basename(this.filePath)}): remove fehlgeschlagen:`, e?.message);
    }
  }

  count(): number {
    return this.list().length;
  }

  /** Atomar: erst tmp-Datei schreiben, dann rename (POSIX-atomar im selben Verzeichnis). */
  private writeAtomic(keys: string[]): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const payload: PendingFileFormat = { keys };
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }
}

/** Keys, deren Sekundär-Spiegelung nachgeholt werden muss (Primary → Secondary). */
export const pendingSecondary = new PendingKeyStore(path.join(UPLOADS_DIR, '.pending-secondary.json'));

/** Keys, die per Failover nur auf dem Sekundär liegen (Secondary → Primary zurückkopieren). */
export const pendingBackfill = new PendingKeyStore(path.join(UPLOADS_DIR, '.pending-backfill.json'));
