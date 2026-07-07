import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeNextRun,
  readLastStatus,
  writeLastStatus,
  cleanupOldLocalBackups,
  STATUS_FILENAME,
  MIN_RETENTION_DAYS,
  AutoBackupStatus,
} from './autoBackupService';

const DAY_MS = 24 * 60 * 60 * 1000;

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-autobackup-'));
}

/** Legt eine Datei an und setzt ihre mtime auf `ageDays` Tage vor `now`. */
function touchWithAge(dir: string, name: string, ageDays: number, now: Date): string {
  const full = path.join(dir, name);
  fs.writeFileSync(full, '{}', 'utf-8');
  const t = new Date(now.getTime() - ageDays * DAY_MS);
  fs.utimesSync(full, t, t);
  return full;
}

describe('autoBackupService — Zeitplanung (computeNextRun)', () => {
  test('Uhrzeit liegt heute noch in der Zukunft → heute', () => {
    const now = new Date(2026, 6, 6, 1, 0, 0); // 06.07.2026 01:00 lokal
    const next = computeNextRun('02:30', now);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(6);
    expect(next.getDate()).toBe(6);
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(30);
  });

  test('Uhrzeit bereits vorbei → morgen', () => {
    const now = new Date(2026, 6, 6, 10, 15, 0);
    const next = computeNextRun('02:30', now);
    expect(next.getDate()).toBe(7);
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(30);
  });

  test('Uhrzeit exakt jetzt → morgen (kein Doppel-Lauf)', () => {
    const now = new Date(2026, 6, 6, 2, 30, 0);
    const next = computeNextRun('02:30', now);
    expect(next.getDate()).toBe(7);
  });

  test('Monatswechsel: 31.07. nach Laufzeit → 01.08.', () => {
    const now = new Date(2026, 6, 31, 23, 0, 0);
    const next = computeNextRun('02:30', now);
    expect(next.getMonth()).toBe(7); // August
    expect(next.getDate()).toBe(1);
  });

  test('Ungültiges Format → Fallback 02:30', () => {
    const now = new Date(2026, 6, 6, 1, 0, 0);
    for (const bad of ['', '25:00', '2:3', 'abc', '12:60']) {
      const next = computeNextRun(bad, now);
      expect(next.getHours()).toBe(2);
      expect(next.getMinutes()).toBe(30);
    }
  });
});

describe('autoBackupService — Status-Datei (last-status.json)', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('Erfolgs-Status schreiben und lesen (Roundtrip)', () => {
    const status: AutoBackupStatus = {
      lastRunAt: '2026-07-06T02:30:00.000Z',
      ok: true,
      target: 's3+local',
      sizeBytes: 12345,
      durationMs: 250,
    };
    writeLastStatus(status, dir);
    const read = readLastStatus(dir);
    expect(read).toEqual(status);
  });

  test('Fehler-Status inkl. error + failNotifiedDate', () => {
    const status: AutoBackupStatus = {
      lastRunAt: '2026-07-06T02:30:00.000Z',
      ok: false,
      target: 'local',
      sizeBytes: 0,
      error: 'Platte voll',
      durationMs: 10,
      failNotifiedDate: '2026-07-06',
    };
    writeLastStatus(status, dir);
    const read = readLastStatus(dir);
    expect(read?.ok).toBe(false);
    expect(read?.error).toBe('Platte voll');
    expect(read?.failNotifiedDate).toBe('2026-07-06');
  });

  test('Atomar: keine .tmp-Reste, Überschreiben ersetzt Inhalt vollständig', () => {
    writeLastStatus({ lastRunAt: 'a', ok: false, target: 'local', sizeBytes: 0, error: 'x', durationMs: 1 } as AutoBackupStatus, dir);
    writeLastStatus({ lastRunAt: 'b', ok: true, target: 'local', sizeBytes: 5, durationMs: 2 } as AutoBackupStatus, dir);
    const files = fs.readdirSync(dir);
    expect(files).toEqual([STATUS_FILENAME]); // genau eine Datei, kein *.tmp-*
    const read = readLastStatus(dir);
    expect(read?.ok).toBe(true);
    expect(read?.error).toBeUndefined(); // alter error-Key nicht "durchgeschlagen"
  });

  test('Fehlende/kaputte Datei → null', () => {
    expect(readLastStatus(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, STATUS_FILENAME), 'kein json', 'utf-8');
    expect(readLastStatus(dir)).toBeNull();
  });

  test('Verzeichnis wird bei Bedarf angelegt', () => {
    const nested = path.join(dir, 'neu', 'backups');
    writeLastStatus({ lastRunAt: 'x', ok: true, target: 'local', sizeBytes: 1, durationMs: 1 } as AutoBackupStatus, nested);
    expect(readLastStatus(nested)?.lastRunAt).toBe('x');
  });
});

describe('autoBackupService — Retention (cleanupOldLocalBackups)', () => {
  let dir: string;
  const now = new Date(2026, 6, 6, 12, 0, 0);
  beforeEach(() => { dir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('löscht nur Backups STRIKT älter als die Grenze', async () => {
    const oldFile = touchWithAge(dir, 'timefeed-backup-2026-06-01-0230.json', 31, now);
    const boundary = touchWithAge(dir, 'timefeed-backup-2026-06-06-1200.json', 30, now); // exakt an der Grenze
    const fresh = touchWithAge(dir, 'timefeed-backup-2026-07-05-0230.json', 1, now);

    const res = await cleanupOldLocalBackups(30, now, dir);
    expect(res).toEqual({ deleted: 1, errors: 0 });
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(boundary)).toBe(true); // mtime == cutoff → behalten
    expect(fs.existsSync(fresh)).toBe(true);
  });

  test('fasst nur timefeed-backup-*.json an (last-status.json & Fremddateien bleiben)', async () => {
    const status = touchWithAge(dir, STATUS_FILENAME, 100, now);
    const foreign = touchWithAge(dir, 'notizen-alt.txt', 100, now);
    const foreign2 = touchWithAge(dir, 'other-backup-2020.json', 100, now);
    const backup = touchWithAge(dir, 'timefeed-backup-2020-01-01-0000.json', 100, now);

    const res = await cleanupOldLocalBackups(30, now, dir);
    expect(res.deleted).toBe(1);
    expect(fs.existsSync(status)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
    expect(fs.existsSync(foreign2)).toBe(true);
    expect(fs.existsSync(backup)).toBe(false);
  });

  test('Untergrenze: retentionDays < 7 wird auf 7 geklemmt', async () => {
    const young = touchWithAge(dir, 'timefeed-backup-2026-07-03-0230.json', 3, now); // 3 Tage alt
    const old = touchWithAge(dir, 'timefeed-backup-2026-06-20-0230.json', 16, now);

    const res = await cleanupOldLocalBackups(1, now, dir); // absichtlich zu klein
    expect(fs.existsSync(young)).toBe(true);  // < MIN_RETENTION_DAYS → nie löschen
    expect(fs.existsSync(old)).toBe(false);
    expect(res.deleted).toBe(1);
    expect(MIN_RETENTION_DAYS).toBe(7);
  });

  test('Ungültige retentionDays → Default (30) statt Alles-Löschen', async () => {
    const mid = touchWithAge(dir, 'timefeed-backup-2026-06-20-0230.json', 16, now); // 16 Tage
    const old = touchWithAge(dir, 'timefeed-backup-2026-05-01-0230.json', 66, now);

    const res = await cleanupOldLocalBackups(NaN as unknown as number, now, dir);
    expect(fs.existsSync(mid)).toBe(true);   // jünger als 30 Tage → bleibt
    expect(fs.existsSync(old)).toBe(false);
    expect(res.deleted).toBe(1);
  });

  test('nicht existierendes Verzeichnis → kein Fehler, nichts gelöscht', async () => {
    const res = await cleanupOldLocalBackups(30, now, path.join(dir, 'gibt-es-nicht'));
    expect(res).toEqual({ deleted: 0, errors: 0 });
  });
});
