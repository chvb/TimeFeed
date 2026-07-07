import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { StorageSettings, StorageSettingsAttributes } from '../models/StorageSettings';
import { pendingSecondary, pendingBackfill } from './secondaryPendingStore';

export interface S3Config {
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3BackupPrefix?: string;
}

/** Override-Konfiguration für den Sekundär-Verbindungstest. */
export interface SecondaryS3Config {
  secondaryEndpoint?: string;
  secondaryRegion?: string;
  secondaryBucket?: string;
  secondaryAccessKey?: string;
  secondarySecretKey?: string;
  secondaryPrefix?: string;
}

/** Blockt interne/private Endpunkte (leichter SSRF-Schutz, da Endpoint konfigurierbar). */
export function isInternalHost(endpoint: string): boolean {
  const host = endpoint.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === '169.254.169.254') return true; // Cloud-Metadata
  return false;
}

interface GenericS3Params {
  endpoint?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
}

function buildGenericClient(p: GenericS3Params): S3Client {
  const config: any = {
    region: p.region || 'eu-central-1',
    credentials: {
      accessKeyId: p.accessKey || '',
      secretAccessKey: p.secretKey || '',
    },
    maxAttempts: 3,
  };
  if (p.endpoint) {
    let ep = p.endpoint.trim();
    if (!/^https?:\/\//.test(ep)) ep = 'https://' + ep;
    if (isInternalHost(ep)) throw new Error('Interner/privater S3-Endpoint ist nicht erlaubt');
    config.endpoint = ep;
    config.forcePathStyle = true; // für S3-kompatible Dienste (Hetzner/MinIO/Wasabi)
  }
  return new S3Client(config);
}

function buildClient(cfg: S3Config): S3Client {
  return buildGenericClient({
    endpoint: cfg.s3Endpoint,
    region: cfg.s3Region,
    accessKey: cfg.s3AccessKey,
    secretKey: cfg.s3SecretKey,
  });
}

function buildSecondaryClient(cfg: SecondaryS3Config): S3Client {
  return buildGenericClient({
    endpoint: cfg.secondaryEndpoint,
    region: cfg.secondaryRegion,
    accessKey: cfg.secondaryAccessKey,
    secretKey: cfg.secondarySecretKey,
  });
}

function normalizePrefix(prefix?: string): string {
  let p = (prefix || '').replace(/^\/+/, '').replace(/\.\./g, '');
  if (p && !p.endsWith('/')) p += '/';
  return p;
}

/** Harter Timeout um ein Promise (Promise.race). Der Verlierer läuft weiter (fire-and-forget). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    if (t.unref) t.unref();
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const stream = body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Lokales Upload-Verzeichnis (letzte Read-Failover-Stufe): <server>/uploads.
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

class StorageService {
  async getSettings(): Promise<StorageSettingsAttributes | null> {
    return StorageSettings.findOne();
  }

  async isActive(): Promise<boolean> {
    const s = await this.getSettings();
    return !!(s && s.isActive && s.s3Bucket && s.s3AccessKey && s.s3SecretKey);
  }

  private cfgFrom(s: StorageSettingsAttributes): S3Config {
    return {
      s3Endpoint: s.s3Endpoint,
      s3Region: s.s3Region,
      s3Bucket: s.s3Bucket,
      s3AccessKey: s.s3AccessKey,
      s3SecretKey: s.s3SecretKey,
      s3BackupPrefix: s.s3BackupPrefix,
    };
  }

  backupKey(filename: string, prefix?: string): string {
    return normalizePrefix(prefix) + filename.replace(/^\/+/, '');
  }

  // ---------------------------------------------------------------------
  // Sekundärer S3 (Backup-/Failover-Spiegel)
  // ---------------------------------------------------------------------

  /** Gate: Failover-/Spiegel-Verhalten NUR wenn Toggle aktiv UND Credentials vollständig. */
  hasSecondary(s: StorageSettingsAttributes | null): s is StorageSettingsAttributes {
    return !!(s && s.secondaryEnabled && s.secondaryBucket && s.secondaryAccessKey && s.secondarySecretKey);
  }

  /** Objekt-Key auf dem Sekundär: secondaryPrefix + kompletter Primär-Key. */
  secondaryObjectKey(key: string, s: StorageSettingsAttributes): string {
    return normalizePrefix(s.secondaryPrefix) + key.replace(/^\/+/, '');
  }

  private failoverTimeoutMs(s: StorageSettingsAttributes): number {
    const ms = Number(s.secondaryFailoverTimeoutMs);
    return Number.isFinite(ms) && ms >= 250 ? ms : 3000;
  }

  /**
   * PUT auf den PRIMÄREN S3 mit Failover:
   * - Wenn Sekundär konfiguriert: harter Timeout (secondaryFailoverTimeoutMs) via Promise.race.
   * - Bei Fehler/Timeout: direkt auf den Sekundär schreiben und den Key in
   *   `.pending-backfill.json` vormerken (secondarySyncService kopiert später zurück).
   * - Nach ERFOLGREICHEM Primär-PUT: fire-and-forget-Spiegelung auf den Sekundär;
   *   Fehler dort werden geschluckt und in `.pending-secondary.json` vorgemerkt.
   */
  private async putObjectDual(
    s: StorageSettingsAttributes,
    key: string,
    body: Buffer | string,
    contentType: string,
    opts?: { awaitSecondary?: boolean }
  ): Promise<{ key: string; storedOn: 'primary' | 'secondary'; secondaryUploaded: boolean }> {
    const client = buildClient(this.cfgFrom(s));
    const hasSecondary = this.hasSecondary(s);

    const doPrimaryPut = async () => {
      const upload = new Upload({
        client,
        params: { Bucket: s.s3Bucket!, Key: key, Body: body, ContentType: contentType },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });
      await upload.done();
    };

    try {
      if (hasSecondary) {
        await withTimeout(doPrimaryPut(), this.failoverTimeoutMs(s), `primary-s3-failover-timeout-${this.failoverTimeoutMs(s)}ms`);
      } else {
        await doPrimaryPut();
      }
    } catch (primaryErr: any) {
      // Write-Failover: direkt auf den Sekundär, Key für Backfill vormerken.
      if (hasSecondary) {
        try {
          await this.putSecondaryObject(key, body, contentType, s);
          pendingBackfill.add(key);
          console.warn(`Storage: Primär-PUT fehlgeschlagen (${primaryErr?.message}) — Failover auf Sekundär für ${key}.`);
          return { key, storedOn: 'secondary', secondaryUploaded: true };
        } catch (secondaryErr: any) {
          console.error(`Storage: Failover-PUT auch fehlgeschlagen: primary=${primaryErr?.message}, secondary=${secondaryErr?.message}`);
        }
      }
      throw primaryErr;
    }

    // Primär erfolgreich → Dual-Write auf den Sekundär.
    let secondaryUploaded = false;
    if (hasSecondary) {
      if (opts?.awaitSecondary) {
        secondaryUploaded = await this.mirrorToSecondary(key, body, contentType, s);
      } else {
        // fire-and-forget: Fehler schlucken, aber vormerken.
        this.mirrorToSecondary(key, body, contentType, s).catch(() => { /* bereits behandelt */ });
      }
    }
    return { key, storedOn: 'primary', secondaryUploaded };
  }

  /** Spiegelt ein Objekt auf den Sekundär; bei Fehler → `.pending-secondary.json`. */
  async mirrorToSecondary(
    key: string,
    body: Buffer | string,
    contentType: string,
    settings?: StorageSettingsAttributes
  ): Promise<boolean> {
    const s = settings ?? (await this.getSettings());
    if (!this.hasSecondary(s)) return false;
    try {
      await this.putSecondaryObject(key, body, contentType, s);
      return true;
    } catch (e: any) {
      console.warn(`Storage: Sekundär-Spiegelung für ${key} fehlgeschlagen (${e?.message}) — vorgemerkt.`);
      pendingSecondary.add(key);
      return false;
    }
  }

  /**
   * GET mit Read-Failover: Primär (harter Timeout) → Sekundär → lokale Datei
   * (server/uploads/**, per Basename). Wirft den Primär-Fehler, wenn alles scheitert.
   */
  private async getObjectBufferWithFailover(s: StorageSettingsAttributes, key: string): Promise<Buffer> {
    const client = buildClient(this.cfgFrom(s));
    const hasSecondary = this.hasSecondary(s);

    const doPrimaryGet = async () => {
      const resp = await client.send(new GetObjectCommand({ Bucket: s.s3Bucket!, Key: key }));
      return streamToBuffer(resp.Body);
    };

    let primaryErr: any;
    try {
      if (hasSecondary) {
        return await withTimeout(doPrimaryGet(), this.failoverTimeoutMs(s), `primary-s3-read-timeout-${this.failoverTimeoutMs(s)}ms`);
      }
      return await doPrimaryGet();
    } catch (e) {
      primaryErr = e;
    }

    // 1. Failover: Sekundär (Failover-Uploads liegen ohnehin nur dort).
    if (hasSecondary) {
      try {
        return await this.getSecondaryObjectBuffer(key, s);
      } catch {
        /* weiter zur lokalen Stufe */
      }
    }

    // 2. Letzte Stufe: lokale Ablage (z. B. Stundenzettel vor der S3-Aktivierung).
    for (const candidate of [
      path.join(UPLOADS_DIR, 'timesheets', path.basename(key)),
      path.join(UPLOADS_DIR, path.basename(key)),
    ]) {
      try {
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
      } catch {
        /* ignore */
      }
    }

    throw primaryErr;
  }

  // --- Roh-Operationen für secondarySyncService --------------------------

  async getPrimaryObjectBuffer(key: string, settings?: StorageSettingsAttributes): Promise<Buffer> {
    const s = settings ?? (await this.getSettings());
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    const resp = await client.send(new GetObjectCommand({ Bucket: s.s3Bucket, Key: key }));
    return streamToBuffer(resp.Body);
  }

  async putPrimaryObject(key: string, body: Buffer | string, contentType: string, settings?: StorageSettingsAttributes): Promise<void> {
    const s = settings ?? (await this.getSettings());
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    await client.send(new PutObjectCommand({ Bucket: s.s3Bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async getSecondaryObjectBuffer(key: string, settings?: StorageSettingsAttributes): Promise<Buffer> {
    const s = settings ?? (await this.getSettings());
    if (!this.hasSecondary(s)) throw new Error('Sekundärer S3 ist nicht konfiguriert');
    const client = buildSecondaryClient(s);
    const resp = await client.send(new GetObjectCommand({ Bucket: s.secondaryBucket!, Key: this.secondaryObjectKey(key, s) }));
    return streamToBuffer(resp.Body);
  }

  async putSecondaryObject(key: string, body: Buffer | string, contentType: string, settings?: StorageSettingsAttributes): Promise<void> {
    const s = settings ?? (await this.getSettings());
    if (!this.hasSecondary(s)) throw new Error('Sekundärer S3 ist nicht konfiguriert');
    const client = buildSecondaryClient(s);
    await client.send(new PutObjectCommand({
      Bucket: s.secondaryBucket!,
      Key: this.secondaryObjectKey(key, s),
      Body: body,
      ContentType: contentType,
    }));
  }

  async deleteSecondaryObject(key: string, settings?: StorageSettingsAttributes): Promise<void> {
    const s = settings ?? (await this.getSettings());
    if (!this.hasSecondary(s)) return;
    const client = buildSecondaryClient(s);
    await client.send(new DeleteObjectCommand({ Bucket: s.secondaryBucket!, Key: this.secondaryObjectKey(key, s) }));
  }

  /** Fire-and-forget-Löschung auf dem Sekundär + Pending-Listen bereinigen. */
  private deleteSecondaryFireAndForget(key: string, s: StorageSettingsAttributes): void {
    pendingSecondary.remove(key);
    pendingBackfill.remove(key);
    if (!this.hasSecondary(s)) return;
    this.deleteSecondaryObject(key, s).catch((e: any) => {
      console.warn(`Storage: Sekundär-Delete für ${key} fehlgeschlagen (${e?.message}).`);
    });
  }

  // ---------------------------------------------------------------------
  // Verbindungstests
  // ---------------------------------------------------------------------

  /** Testet die Verbindung mit übergebenen ODER gespeicherten Settings (ListObjects MaxKeys:1). */
  async testConnection(override?: S3Config): Promise<{ ok: boolean; error?: string }> {
    try {
      const stored = await this.getSettings();
      const cfg: S3Config = { ...(stored ? this.cfgFrom(stored) : {}), ...(override || {}) };
      if (!cfg.s3Bucket || !cfg.s3AccessKey || !cfg.s3SecretKey) {
        return { ok: false, error: 'Bucket, Access-Key und Secret-Key sind erforderlich' };
      }
      const client = buildClient(cfg);
      await client.send(new ListObjectsV2Command({ Bucket: cfg.s3Bucket, MaxKeys: 1, Prefix: normalizePrefix(cfg.s3BackupPrefix) }));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Verbindung fehlgeschlagen' };
    }
  }

  /**
   * Testet den SEKUNDÄREN S3: HeadBucket; wenn der Anbieter HeadBucket nicht
   * erlaubt (403/405), stattdessen PUT+DELETE eines Markers `.timefeed-healthcheck`.
   */
  async testSecondaryConnection(override?: SecondaryS3Config): Promise<{ ok: boolean; error?: string; via?: string }> {
    try {
      const stored = await this.getSettings();
      const cfg: SecondaryS3Config = {
        secondaryEndpoint: stored?.secondaryEndpoint,
        secondaryRegion: stored?.secondaryRegion,
        secondaryBucket: stored?.secondaryBucket,
        secondaryAccessKey: stored?.secondaryAccessKey,
        secondarySecretKey: stored?.secondarySecretKey,
        secondaryPrefix: stored?.secondaryPrefix,
        ...(override || {}),
      };
      if (!cfg.secondaryBucket || !cfg.secondaryAccessKey || !cfg.secondarySecretKey) {
        return { ok: false, error: 'Sekundär: Bucket, Access-Key und Secret-Key sind erforderlich' };
      }
      const client = buildSecondaryClient(cfg);
      try {
        await withTimeout(
          client.send(new HeadBucketCommand({ Bucket: cfg.secondaryBucket })),
          10000,
          'secondary-headbucket-timeout'
        );
        return { ok: true, via: 'HeadBucket' };
      } catch (headErr: any) {
        const status = headErr?.$metadata?.httpStatusCode;
        // Manche S3-kompatible Anbieter beantworten HeadBucket nicht sauber
        // (403/405, teils auch 404/ohne Status trotz korrekter Zugangsdaten) →
        // aussagekräftiger ist der PUT/DELETE-Marker.
        if (status === 403 || status === 405 || status === 404 || status == null) {
          const markerKey = normalizePrefix(cfg.secondaryPrefix) + '.timefeed-healthcheck';
          await client.send(new PutObjectCommand({
            Bucket: cfg.secondaryBucket,
            Key: markerKey,
            Body: `timefeed healthcheck ${new Date().toISOString()}`,
            ContentType: 'text/plain',
          }));
          await client.send(new DeleteObjectCommand({ Bucket: cfg.secondaryBucket, Key: markerKey }));
          return { ok: true, via: 'PutDeleteMarker' };
        }
        throw headErr;
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Sekundär-Verbindung fehlgeschlagen' };
    }
  }

  // ---------------------------------------------------------------------
  // Backups
  // ---------------------------------------------------------------------

  async uploadBackup(
    filename: string,
    body: Buffer | string,
    contentType = 'application/json',
    opts?: { awaitSecondary?: boolean }
  ): Promise<{ key: string; storedOn: 'primary' | 'secondary'; secondaryUploaded: boolean }> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const key = this.backupKey(filename, s.s3BackupPrefix);
    return this.putObjectDual(s, key, body, contentType, opts);
  }

  async listBackups(): Promise<Array<{ key: string; size: number; lastModified: string | null }>> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    const prefix = normalizePrefix(s.s3BackupPrefix);
    const out: Array<{ key: string; size: number; lastModified: string | null }> = [];
    let token: string | undefined;
    do {
      const resp = await client.send(new ListObjectsV2Command({ Bucket: s.s3Bucket, Prefix: prefix, ContinuationToken: token }));
      (resp.Contents || []).forEach((o) => {
        if (o.Key) out.push({ key: o.Key, size: o.Size || 0, lastModified: o.LastModified ? o.LastModified.toISOString() : null });
      });
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
  }

  async downloadBackup(key: string): Promise<string> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const buffer = await this.getObjectBufferWithFailover(s, key);
    return buffer.toString('utf-8');
  }

  async deleteBackup(key: string): Promise<void> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    await client.send(new DeleteObjectCommand({ Bucket: s.s3Bucket, Key: key }));
    this.deleteSecondaryFireAndForget(key, s);
  }

  // ---------------------------------------------------------------------
  // Generische Datei-Operationen (z. B. für Antrags-Anhänge). Key inkl. Präfix vom Aufrufer.
  // ---------------------------------------------------------------------

  async uploadFile(key: string, body: Buffer, contentType: string): Promise<{ key: string }> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const { key: k } = await this.putObjectDual(s, key, body, contentType);
    return { key: k };
  }

  async downloadFileBuffer(key: string): Promise<Buffer> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    return this.getObjectBufferWithFailover(s, key);
  }

  async deleteFile(key: string): Promise<void> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    await client.send(new DeleteObjectCommand({ Bucket: s.s3Bucket, Key: key }));
    this.deleteSecondaryFireAndForget(key, s);
  }
}

export default new StorageService();
