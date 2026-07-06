import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { StorageSettings, StorageSettingsAttributes } from '../models/StorageSettings';

export interface S3Config {
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3BackupPrefix?: string;
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

function buildClient(cfg: S3Config): S3Client {
  const config: any = {
    region: cfg.s3Region || 'eu-central-1',
    credentials: {
      accessKeyId: cfg.s3AccessKey || '',
      secretAccessKey: cfg.s3SecretKey || '',
    },
    maxAttempts: 3,
  };
  if (cfg.s3Endpoint) {
    let ep = cfg.s3Endpoint.trim();
    if (!/^https?:\/\//.test(ep)) ep = 'https://' + ep;
    if (isInternalHost(ep)) throw new Error('Interner/privater S3-Endpoint ist nicht erlaubt');
    config.endpoint = ep;
    config.forcePathStyle = true; // für S3-kompatible Dienste (Hetzner/MinIO/Wasabi)
  }
  return new S3Client(config);
}

function normalizePrefix(prefix?: string): string {
  let p = (prefix || '').replace(/^\/+/, '').replace(/\.\./g, '');
  if (p && !p.endsWith('/')) p += '/';
  return p;
}

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

  async uploadBackup(filename: string, body: Buffer | string, contentType = 'application/json'): Promise<{ key: string }> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    const key = this.backupKey(filename, s.s3BackupPrefix);
    const upload = new Upload({
      client,
      params: { Bucket: s.s3Bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
    return { key };
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
    const client = buildClient(this.cfgFrom(s));
    const resp = await client.send(new GetObjectCommand({ Bucket: s.s3Bucket, Key: key }));
    const stream = resp.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf-8');
  }

  async deleteBackup(key: string): Promise<void> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    await client.send(new DeleteObjectCommand({ Bucket: s.s3Bucket, Key: key }));
  }

  // Generische Datei-Operationen (z. B. für Antrags-Anhänge). Key inkl. Präfix vom Aufrufer.
  async uploadFile(key: string, body: Buffer, contentType: string): Promise<{ key: string }> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    const upload = new Upload({
      client,
      params: { Bucket: s.s3Bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
    return { key };
  }

  async downloadFileBuffer(key: string): Promise<Buffer> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    const resp = await client.send(new GetObjectCommand({ Bucket: s.s3Bucket, Key: key }));
    const stream = resp.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async deleteFile(key: string): Promise<void> {
    const s = await this.getSettings();
    if (!s || !s.s3Bucket) throw new Error('S3 ist nicht konfiguriert');
    const client = buildClient(this.cfgFrom(s));
    await client.send(new DeleteObjectCommand({ Bucket: s.s3Bucket, Key: key }));
  }
}

export default new StorageService();
