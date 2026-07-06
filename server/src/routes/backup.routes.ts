import express from 'express';
import * as fs from 'fs';
import multer from 'multer';
import { authenticate, authorizeSuperAdmin } from '../middleware/auth';
import { createBackupObject, restoreBackup } from '../services/backupService';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';

const router = express.Router();
// Upload-Limit (10 MB) + nur JSON akzeptieren — verhindert DoS/Disk-Fill und
// das Einlesen riesiger Dateien in den RAM.
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/json' || file.originalname.toLowerCase().endsWith('.json');
    if (ok) cb(null, true);
    else cb(new Error('Nur JSON-Backups erlaubt'));
  },
});

// Vollständiges System-Backup erstellen (Download).
router.post('/create', authenticate, authorizeSuperAdmin, async (req, res) => {
  try {
    const backup = await createBackupObject();
    await AuditService.log({ userId: req.user!.id, action: AuditAction.EXPORT, category: AuditCategory.IMPORT_EXPORT, entity: 'Backup', additionalData: { kind: 'full-backup' } }, req);
    res.setHeader('Content-Disposition', 'attachment; filename=backup.json');
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// System aus hochgeladenem Backup wiederherstellen (nutzt zentrale Logik in backupService).
router.post('/restore', authenticate, authorizeSuperAdmin, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No backup file provided' });
    }
    let backupData: any;
    try {
      backupData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
    } catch {
      return res.status(400).json({ error: 'Ungültige oder beschädigte Backup-Datei (kein gültiges JSON)' });
    }
    await restoreBackup(backupData); // wirft AppError(400) bei ungültigem Format
    await AuditService.log({ userId: req.user!.id, action: AuditAction.IMPORT, category: AuditCategory.IMPORT_EXPORT, entity: 'Backup', additionalData: { kind: 'full-restore' } }, req);
    return res.json({ message: 'Backup restored successfully' });
  } catch (error: any) {
    console.error('Error restoring backup:', error);
    const status = error?.statusCode || 500;
    return res.status(status).json({ error: error?.message || 'Failed to restore backup' });
  } finally {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  }
});

export default router;
