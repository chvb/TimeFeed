import { Router } from 'express';
import { ExportController } from '../controllers/export.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

/**
 * Lohn-Exporte (Phase 5) — zwei Router aus einem Controller:
 *  - /api/export-profile  GET/PUT  Export-Konfiguration je Firma
 *  - /api/exports         GET /run (Datei-Download), GET /preview (JSON)
 * Beides nur admin/buchhaltung; Firmen-Reichweite prüft der Controller
 * (getManagedCompanyIds / accessScope).
 */

const controller = new ExportController();

export const exportProfileRouter = Router();
exportProfileRouter.use(authenticate);
exportProfileRouter.use(authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG));
exportProfileRouter.get('/', controller.getProfile.bind(controller));
exportProfileRouter.put('/', controller.updateProfile.bind(controller));

export const exportsRouter = Router();
exportsRouter.use(authenticate);
exportsRouter.use(authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG));
exportsRouter.get('/run', controller.run.bind(controller));
exportsRouter.get('/preview', controller.preview.bind(controller));
