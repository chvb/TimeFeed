import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorizeSuperAdmin } from '../middleware/auth';
import { StorageSettings } from '../models/StorageSettings';
import storageService, { isInternalHost } from '../services/storageService';
import { createAndUploadBackupToS3, restoreBackup } from '../services/backupService';
import { getSecondarySyncStatus, runSecondarySync } from '../services/secondarySyncService';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';

// Verhindert Pfad-Traversal/fremde Keys bei restore/delete.
function isSafeBackupKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length < 1024 && !key.includes('..') && !key.startsWith('/');
}

const router = Router();
// S3-/Speicher- und Voll-Backup-Funktionen sind instanzweit → nur Super-Admin.
router.use(authenticate, authorizeSuperAdmin);

const SECRET_MASK = '********';

function maskedDTO(s: StorageSettings) {
  return {
    s3Endpoint: s.s3Endpoint || '',
    s3Region: s.s3Region || '',
    s3Bucket: s.s3Bucket || '',
    s3AccessKey: s.s3AccessKey ? SECRET_MASK : '',
    s3SecretKey: s.s3SecretKey ? SECRET_MASK : '',
    s3BackupPrefix: s.s3BackupPrefix || '',
    s3AttachmentPrefix: s.s3AttachmentPrefix || '',
    isActive: !!s.isActive,
    // Sekundärer S3 (Secrets werden — wie beim Primär — nie zurückgegeben).
    secondaryEnabled: !!s.secondaryEnabled,
    secondaryEndpoint: s.secondaryEndpoint || '',
    secondaryRegion: s.secondaryRegion || '',
    secondaryBucket: s.secondaryBucket || '',
    secondaryAccessKey: s.secondaryAccessKey ? SECRET_MASK : '',
    secondarySecretKey: s.secondarySecretKey ? SECRET_MASK : '',
    secondaryPrefix: s.secondaryPrefix || '',
    secondaryFailoverTimeoutMs: s.secondaryFailoverTimeoutMs ?? 3000,
  };
}

const EMPTY_SETTINGS_DTO = {
  s3Endpoint: '', s3Region: 'eu-central-1', s3Bucket: '', s3AccessKey: '', s3SecretKey: '',
  s3BackupPrefix: 'timefeed/backups/', s3AttachmentPrefix: 'timefeed/attachments/', isActive: false,
  secondaryEnabled: false, secondaryEndpoint: '', secondaryRegion: 'eu-central-1', secondaryBucket: '',
  secondaryAccessKey: '', secondarySecretKey: '', secondaryPrefix: 'timefeed-mirror/', secondaryFailoverTimeoutMs: 3000,
};

// Settings lesen (Secret maskiert)
router.get('/', async (_req: Request, res: Response) => {
  const s = await StorageSettings.findOne();
  return res.json({ settings: s ? maskedDTO(s) : EMPTY_SETTINGS_DTO });
});

// Settings speichern (maskiertes Secret nicht überschreiben)
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [s] = await StorageSettings.findOrCreate({ where: {}, defaults: {} });
    const b = req.body || {};
    // SSRF-Schutz bereits beim Speichern (nicht erst beim Client-Bau).
    if (b.s3Endpoint && isInternalHost(String(b.s3Endpoint))) {
      return res.status(400).json({ error: 'Interner/privater S3-Endpoint ist nicht erlaubt' });
    }
    if (b.s3Endpoint !== undefined) s.s3Endpoint = b.s3Endpoint;
    if (b.s3Region !== undefined) s.s3Region = b.s3Region;
    if (b.s3Bucket !== undefined) s.s3Bucket = b.s3Bucket;
    if (b.s3BackupPrefix !== undefined) s.s3BackupPrefix = b.s3BackupPrefix;
    if (b.s3AttachmentPrefix !== undefined) s.s3AttachmentPrefix = b.s3AttachmentPrefix;
    if (b.isActive !== undefined) s.isActive = !!b.isActive;
    if (b.s3AccessKey !== undefined && b.s3AccessKey !== '' && b.s3AccessKey !== SECRET_MASK) s.s3AccessKey = b.s3AccessKey;
    if (b.s3SecretKey !== undefined && b.s3SecretKey !== '' && b.s3SecretKey !== SECRET_MASK) {
      s.s3SecretKey = b.s3SecretKey;
    }
    // --- Sekundärer S3 ---------------------------------------------------
    if (b.secondaryEndpoint && isInternalHost(String(b.secondaryEndpoint))) {
      return res.status(400).json({ error: 'Interner/privater Sekundär-Endpoint ist nicht erlaubt' });
    }
    if (b.secondaryEnabled !== undefined) s.secondaryEnabled = !!b.secondaryEnabled;
    if (b.secondaryEndpoint !== undefined) s.secondaryEndpoint = b.secondaryEndpoint;
    if (b.secondaryRegion !== undefined) s.secondaryRegion = b.secondaryRegion;
    if (b.secondaryBucket !== undefined) s.secondaryBucket = b.secondaryBucket;
    if (b.secondaryPrefix !== undefined) s.secondaryPrefix = b.secondaryPrefix;
    if (b.secondaryFailoverTimeoutMs !== undefined) {
      const ms = Number(b.secondaryFailoverTimeoutMs);
      if (!Number.isInteger(ms) || ms < 250 || ms > 60000) {
        return res.status(400).json({ error: 'secondaryFailoverTimeoutMs muss zwischen 250 und 60000 liegen' });
      }
      s.secondaryFailoverTimeoutMs = ms;
    }
    // Secrets: Maske/Leerstring nie übernehmen (Muster wie beim Primär-S3).
    if (b.secondaryAccessKey !== undefined && b.secondaryAccessKey !== '' && b.secondaryAccessKey !== SECRET_MASK) {
      s.secondaryAccessKey = b.secondaryAccessKey;
    }
    if (b.secondarySecretKey !== undefined && b.secondarySecretKey !== '' && b.secondarySecretKey !== SECRET_MASK) {
      s.secondarySecretKey = b.secondarySecretKey;
    }
    await s.save();
    await AuditService.log({ userId: req.user!.id, action: AuditAction.SETTINGS_UPDATE, category: AuditCategory.SYSTEM_SETTINGS, entity: 'StorageSettings' }, req);
    return res.json({ settings: maskedDTO(s) });
  } catch (error) {
    return next(error);
  }
});

// Verbindung testen
router.post('/test', async (req: Request, res: Response) => {
  const override = { ...(req.body || {}) };
  if (override.s3SecretKey === SECRET_MASK || override.s3SecretKey === '') delete override.s3SecretKey;
  if (override.s3AccessKey === SECRET_MASK || override.s3AccessKey === '') delete override.s3AccessKey;
  const result = await storageService.testConnection(override);
  return res.status(result.ok ? 200 : 400).json(result);
});

// Sekundär-Verbindung testen (HeadBucket; bei 403/405 PUT+DELETE-Marker `.timefeed-healthcheck`).
router.post('/test-secondary', async (req: Request, res: Response) => {
  const override = { ...(req.body || {}) };
  if (override.secondarySecretKey === SECRET_MASK || override.secondarySecretKey === '') delete override.secondarySecretKey;
  if (override.secondaryAccessKey === SECRET_MASK || override.secondaryAccessKey === '') delete override.secondaryAccessKey;
  const result = await storageService.testSecondaryConnection(override);
  return res.status(result.ok ? 200 : 400).json(result);
});

// Status des Sekundär-Syncs (Pending-Zähler, letzter Lauf) + manueller Anstoß.
router.get('/secondary-sync', async (_req: Request, res: Response) => {
  return res.json(getSecondarySyncStatus());
});

router.post('/secondary-sync', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runSecondarySync({ force: true });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// Backup erstellen und in S3 hochladen
router.post('/backup', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await storageService.isActive())) {
      return res.status(400).json({ error: 'S3 ist nicht aktiviert/konfiguriert' });
    }
    const { key, storedOn, secondaryUploaded } = await createAndUploadBackupToS3();
    return res.json({ message: 'Backup in S3 gespeichert', key, storedOn, secondaryUploaded });
  } catch (error) {
    return next(error);
  }
});

// S3-Backups auflisten
router.get('/backups', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ backups: await storageService.listBackups() });
  } catch (error) {
    return next(error);
  }
});

// Aus S3-Backup wiederherstellen
router.post('/backups/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.body || {};
    if (!isSafeBackupKey(key)) return res.status(400).json({ error: 'Ungültiger Backup-Key' });
    const content = await storageService.downloadBackup(key);
    await restoreBackup(JSON.parse(content));
    await AuditService.log({ userId: req.user!.id, action: AuditAction.IMPORT, category: AuditCategory.IMPORT_EXPORT, entity: 'Backup', additionalData: { kind: 's3-restore', key } }, req);
    return res.json({ message: 'Backup aus S3 wiederhergestellt' });
  } catch (error) {
    return next(error);
  }
});

// S3-Backup löschen
router.delete('/backups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.body || {};
    if (!isSafeBackupKey(key)) return res.status(400).json({ error: 'Ungültiger Backup-Key' });
    await storageService.deleteBackup(key);
    return res.json({ message: 'Backup gelöscht' });
  } catch (error) {
    return next(error);
  }
});

export default router;
