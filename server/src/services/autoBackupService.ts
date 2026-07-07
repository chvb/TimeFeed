import * as fs from 'fs';
import * as path from 'path';
import { createBackupObject } from './backupService';
import storageService from './storageService';
import { SettingsController } from '../controllers/settings.controller';
import { User, UserRole } from '../models/User';
import { EmailSettings } from '../models/EmailSettings';
import emailService, { renderBrandedEmail, escapeHtml } from './emailService';
import { getPublicBaseUrl } from '../utils/baseUrl';

/**
 * Automatisches Backup-System (FotoFeed-Vorbild: backup-daily.sh + last-status):
 * - Täglicher Lauf zur konfigurierten Uhrzeit (autoBackupTime, globale Vorlage)
 *   über setTimeout-Rescheduling (Muster wie timeRecalcJob).
 * - Nutzt den bestehenden backupService (JSON-Vollbackup) → lokale Datei unter
 *   server/backups/ UND — wenn S3 aktiv — Upload über den bestehenden Weg
 *   (inkl. synchroner Sekundär-Spiegelung).
 * - Status-Persistenz in server/backups/last-status.json (atomar geschrieben).
 * - Retention: lokale UND S3-Backups älter als backupRetentionDays löschen
 *   (fehlertolerant, Zähler werden geloggt).
 * - Fehler-Mail an aktive Super-Admins (Fallback: alle aktiven Admins) via
 *   renderBrandedEmail — nur bei aktivem SMTP, maximal EINE Mail pro Tag
 *   (Merker failNotifiedDate in last-status.json), Fehler werden geschluckt.
 */

const settingsController = new SettingsController();

// Konstante relativ zum Server-Verzeichnis: src/services bzw. dist/services
// liegen beide direkt unter server/ → ../../backups = server/backups.
export const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
export const STATUS_FILENAME = 'last-status.json';

// Untergrenze der Aufbewahrung — auch bei fehlerhafter Konfiguration werden
// niemals Backups gelöscht, die jünger als 7 Tage sind.
export const MIN_RETENTION_DAYS = 7;
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_BACKUP_TIME = '02:30';

// Nur echte Auto-Backup-Dateien anfassen (nie last-status.json, .keep o. ä.).
const BACKUP_FILE_RE = /^timefeed-backup-.*\.json$/;

export interface AutoBackupStatus {
  lastRunAt: string;
  ok: boolean;
  target: 'local' | 's3+local';
  sizeBytes: number;
  error?: string;
  durationMs: number;
  /** Merker (YYYY-MM-DD): Fehler-Mail für diesen Tag bereits verschickt. */
  failNotifiedDate?: string;
}

export interface AutoBackupRunResult {
  ok: boolean;
  skipped?: boolean;
  target?: 'local' | 's3+local';
  file?: string;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
  retention?: { localDeleted: number; s3Deleted: number; errors: number };
}

// ---------------------------------------------------------------------------
// Status-Datei (atomar: erst .tmp schreiben, dann rename — FotoFeed-Muster)
// ---------------------------------------------------------------------------

export function readLastStatus(dir: string = BACKUP_DIR): AutoBackupStatus | null {
  try {
    const raw = fs.readFileSync(path.join(dir, STATUS_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.lastRunAt === 'string') {
      return parsed as AutoBackupStatus;
    }
  } catch { /* fehlende/kaputte Datei = kein Status */ }
  return null;
}

export function writeLastStatus(status: AutoBackupStatus, dir: string = BACKUP_DIR): void {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, STATUS_FILENAME);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2), 'utf-8');
  fs.renameSync(tmp, target); // rename ist auf demselben Dateisystem atomar
}

// ---------------------------------------------------------------------------
// Zeitplanung
// ---------------------------------------------------------------------------

/** Nächster Lauf zur Uhrzeit 'HH:MM' (lokale Serverzeit); liegt sie heute in
 *  der Vergangenheit (oder exakt jetzt), wird auf morgen geplant. */
export function computeNextRun(time: string, now: Date = new Date()): Date {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || '').trim());
  const [h, min] = m ? [Number(m[1]), Number(m[2])] : [2, 30]; // Fallback 02:30
  const next = new Date(now);
  next.setHours(h, min, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Lokale Auto-Backups älter als retentionDays löschen (strikt älter als der
 *  Cutoff; Untergrenze MIN_RETENTION_DAYS wird hart geklemmt). */
export async function cleanupOldLocalBackups(
  retentionDays: number,
  now: Date = new Date(),
  dir: string = BACKUP_DIR
): Promise<{ deleted: number; errors: number }> {
  const days = Math.max(MIN_RETENTION_DAYS, Number.isFinite(retentionDays) ? Math.floor(retentionDays) : DEFAULT_RETENTION_DAYS);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  let deleted = 0;
  let errors = 0;
  let files: string[] = [];
  try {
    files = await fs.promises.readdir(dir);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { deleted, errors }; // Verzeichnis existiert noch nicht
    return { deleted, errors: errors + 1 };
  }
  for (const f of files) {
    if (!BACKUP_FILE_RE.test(f)) continue;
    const full = path.join(dir, f);
    try {
      const stat = await fs.promises.stat(full);
      if (stat.mtime < cutoff) {
        await fs.promises.unlink(full);
        deleted++;
      }
    } catch {
      errors++;
    }
  }
  return { deleted, errors };
}

/** S3-Backups älter als retentionDays über die bestehende listBackups/delete-
 *  Logik löschen (fehlertolerant; nur wenn S3 aktiv). */
export async function cleanupOldS3Backups(
  retentionDays: number,
  now: Date = new Date()
): Promise<{ deleted: number; errors: number }> {
  const days = Math.max(MIN_RETENTION_DAYS, Number.isFinite(retentionDays) ? Math.floor(retentionDays) : DEFAULT_RETENTION_DAYS);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  let deleted = 0;
  let errors = 0;
  try {
    if (!(await storageService.isActive())) return { deleted, errors };
    const backups = await storageService.listBackups();
    for (const b of backups) {
      if (!b.lastModified || !BACKUP_FILE_RE.test(path.basename(b.key))) continue;
      if (new Date(b.lastModified) >= cutoff) continue;
      try {
        await storageService.deleteBackup(b.key);
        deleted++;
      } catch {
        errors++;
      }
    }
  } catch {
    errors++;
  }
  return { deleted, errors };
}

// ---------------------------------------------------------------------------
// Fehler-Mail
// ---------------------------------------------------------------------------

/** Gebrandete Fehler-Mail an alle aktiven Admins mit isSuperAdmin (Fallback:
 *  alle aktiven Admins). Nur bei aktivem SMTP; alle Fehler werden geschluckt. */
async function notifyBackupFailure(errorMessage: string): Promise<void> {
  try {
    const mail = await EmailSettings.findOne();
    if (!mail || !mail.isActive) return;

    let admins = await User.findAll({
      where: { isActive: true, role: UserRole.ADMIN, isSuperAdmin: true } as any,
      attributes: ['email'],
    });
    if (admins.length === 0) {
      admins = await User.findAll({
        where: { isActive: true, role: UserRole.ADMIN } as any,
        attributes: ['email'],
      });
    }
    const recipients = admins.map((a) => a.email).filter(Boolean);
    if (recipients.length === 0) return;

    const base = await getPublicBaseUrl();
    const html = await renderBrandedEmail({
      title: 'Automatisches Backup fehlgeschlagen',
      bodyHtml: `
        <p>Das automatische TimeFeed-Backup konnte nicht erstellt werden.</p>
        <div style="background-color:#FEF2F2;border-left:4px solid #DC2626;padding:14px;margin:16px 0;border-radius:0 8px 8px 0;">
          <p style="color:#991B1B;margin:0;font-family:monospace;font-size:13px;word-break:break-all;">${escapeHtml(errorMessage)}</p>
        </div>
        <p>Bitte prüfen Sie die Backup-Einstellungen und den Speicherplatz. Bis zur Behebung wird <strong>kein</strong> aktuelles Backup erzeugt.</p>
        <p style="color:#6B7280;font-size:13px;">Zeitpunkt: ${escapeHtml(new Date().toLocaleString('de-DE'))} · Diese Meldung wird höchstens einmal pro Tag gesendet.</p>`,
      button: { text: 'Backup-Einstellungen öffnen', url: `${base}/settings?tab=backup` },
      footerNote: 'Automatische Benachrichtigung des TimeFeed-Backup-Systems.',
    });
    await emailService.sendEmail(recipients, '⚠️ TimeFeed: Automatisches Backup fehlgeschlagen', html);
    console.log(`AutoBackup: Fehler-Mail an ${recipients.length} Admin(s) gesendet.`);
  } catch (e: any) {
    // Bewusst geschluckt — eine fehlgeschlagene Mail darf den Job nicht stoppen.
    console.warn('AutoBackup: Fehler-Mail konnte nicht gesendet werden:', e?.message);
  }
}

// ---------------------------------------------------------------------------
// Hauptlauf
// ---------------------------------------------------------------------------

let running = false;

function localStamp(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Führt einen Auto-Backup-Lauf aus (JSON-Vollbackup → lokal + optional S3,
 * danach Retention). force=true übergeht den autoBackupEnabled-Schalter
 * (Sofort-Button „Jetzt sichern" + Tests).
 */
export async function runAutoBackup(force = false): Promise<AutoBackupRunResult> {
  if (running) return { ok: false, error: 'Ein Backup-Lauf ist bereits aktiv' };
  running = true;
  const startedAt = Date.now();
  const now = new Date();
  const prev = readLastStatus();
  let target: 'local' | 's3+local' = 'local';

  try {
    const settings = await settingsController.getOrCreateSettings(null); // NUR globale Vorlage
    if (!settings.autoBackupEnabled && !force) {
      return { ok: true, skipped: true };
    }
    const retentionDays = Math.max(MIN_RETENTION_DAYS, Number(settings.backupRetentionDays) || DEFAULT_RETENTION_DAYS);

    try {
      // 1) Vollbackup erzeugen und lokal speichern (atomar via tmp+rename).
      const backup = await createBackupObject();
      const json = JSON.stringify(backup, null, 2);
      const sizeBytes = Buffer.byteLength(json, 'utf-8');
      const filename = `timefeed-backup-${localStamp(now)}.json`;
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const filePath = path.join(BACKUP_DIR, filename);
      const tmpPath = `${filePath}.tmp-${process.pid}`;
      await fs.promises.writeFile(tmpPath, json, 'utf-8');
      await fs.promises.rename(tmpPath, filePath);

      // 2) S3-Upload über den bestehenden Weg (inkl. synchroner Sekundär-Spiegelung),
      //    nur wenn die Speicher-Anbindung aktiv ist.
      if (await storageService.isActive()) {
        await storageService.uploadBackup(filename, json, 'application/json', { awaitSecondary: true });
        target = 's3+local';
      }

      // 3) Retention — fehlertolerant, Zähler loggen.
      const local = await cleanupOldLocalBackups(retentionDays, now);
      const s3 = target === 's3+local'
        ? await cleanupOldS3Backups(retentionDays, now)
        : { deleted: 0, errors: 0 };
      if (local.deleted + s3.deleted + local.errors + s3.errors > 0) {
        console.log(`AutoBackup-Retention: lokal ${local.deleted} gelöscht, S3 ${s3.deleted} gelöscht (${local.errors + s3.errors} Fehler, Grenze ${retentionDays} Tage).`);
      }

      const durationMs = Date.now() - startedAt;
      writeLastStatus({ lastRunAt: now.toISOString(), ok: true, target, sizeBytes, durationMs });
      console.log(`AutoBackup: OK (${target}, ${sizeBytes} Bytes, ${durationMs} ms) → ${filename}`);
      return {
        ok: true, target, file: filename, sizeBytes, durationMs,
        retention: { localDeleted: local.deleted, s3Deleted: s3.deleted, errors: local.errors + s3.errors },
      };
    } catch (e: any) {
      const durationMs = Date.now() - startedAt;
      const error = String(e?.message || e);
      const status: AutoBackupStatus = {
        lastRunAt: now.toISOString(), ok: false, target, sizeBytes: 0, error, durationMs,
        failNotifiedDate: prev?.failNotifiedDate,
      };
      // Fehler-Mail: höchstens EINE pro Tag (Merker in last-status.json).
      const today = now.toISOString().slice(0, 10);
      if (settings.backupNotifyOnFailure && prev?.failNotifiedDate !== today) {
        status.failNotifiedDate = today;
        await notifyBackupFailure(error);
      }
      try { writeLastStatus(status); } catch (werr: any) {
        console.error('AutoBackup: Status-Datei konnte nicht geschrieben werden:', werr?.message);
      }
      console.error('AutoBackup fehlgeschlagen:', error);
      return { ok: false, error, durationMs };
    }
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler (setTimeout-Rescheduling wie timeRecalcJob)
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;
let nextRunAt: Date | null = null;

export function getNextPlannedRunAt(): Date | null {
  return nextRunAt;
}

export function startAutoBackupJob(): void {
  if (timer) return;
  const schedule = async () => {
    let time = DEFAULT_BACKUP_TIME;
    try {
      const settings = await settingsController.getOrCreateSettings(null);
      time = settings.autoBackupTime || DEFAULT_BACKUP_TIME;
    } catch {
      /* Spalten evtl. noch nicht migriert → Default 02:30 */
    }
    const now = new Date();
    const next = computeNextRun(time, now);
    nextRunAt = next;
    timer = setTimeout(async () => {
      timer = null;
      await runAutoBackup().catch((e) => console.error('AutoBackup-Lauf fehlgeschlagen:', e));
      void schedule(); // nächsten Lauf planen (robust gegen DST-/Settings-Änderungen)
    }, next.getTime() - now.getTime());
    if (timer.unref) timer.unref();
    console.log(`AutoBackup-Job geplant (nächster Lauf ${next.toLocaleString('de-DE')}).`);
  };
  void schedule();
}

/** Nach Settings-Änderung (autoBackupTime) den Timer neu planen. */
export function rescheduleAutoBackupJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
  startAutoBackupJob();
}

export function stopAutoBackupJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}

// ---------------------------------------------------------------------------
// Status für die API/UI
// ---------------------------------------------------------------------------

export async function getAutoBackupStatus(): Promise<{
  lastStatus: Omit<AutoBackupStatus, 'failNotifiedDate'> | null;
  nextRunAt: string | null;
  settings: {
    autoBackupEnabled: boolean;
    autoBackupTime: string;
    backupRetentionDays: number;
    backupNotifyOnFailure: boolean;
  };
}> {
  const settings = await settingsController.getOrCreateSettings(null);
  const raw = readLastStatus();
  let lastStatus: Omit<AutoBackupStatus, 'failNotifiedDate'> | null = null;
  if (raw) {
    const { failNotifiedDate: _ignored, ...rest } = raw;
    lastStatus = rest;
  }
  const next = settings.autoBackupEnabled
    ? (nextRunAt || computeNextRun(settings.autoBackupTime || DEFAULT_BACKUP_TIME))
    : null;
  return {
    lastStatus,
    nextRunAt: next ? next.toISOString() : null,
    settings: {
      autoBackupEnabled: !!settings.autoBackupEnabled,
      autoBackupTime: settings.autoBackupTime || DEFAULT_BACKUP_TIME,
      backupRetentionDays: settings.backupRetentionDays ?? DEFAULT_RETENTION_DAYS,
      backupNotifyOnFailure: !!settings.backupNotifyOnFailure,
    },
  };
}
