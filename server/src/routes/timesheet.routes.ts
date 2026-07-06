import { Router } from 'express';
import multer from 'multer';
import { TimesheetController, TIMESHEET_MIME_EXT } from '../controllers/timesheet.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const controller = new TimesheetController();

// Stundenzettel: PDF/JPG/PNG/WebP, max. 10 MB, im Speicher (Weitergabe an S3/lokal).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (TIMESHEET_MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Nur PDF, JPG, PNG oder WebP erlaubt'));
  },
});

router.use(authenticate);
// Stundenzettel sind ein Verwaltungs-Feature (accessScope prüft der Controller).
router.use(authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG));

router.post('/', upload.single('file'), controller.upload.bind(controller));
router.get('/', controller.list.bind(controller));
router.get('/:id/download', controller.download.bind(controller));
// Löschen nur admin/buchhaltung (hart, inkl. Storage-Objekt; Audit-Log).
router.delete('/:id', authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG), controller.remove.bind(controller));

export default router;
