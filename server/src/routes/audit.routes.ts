import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const auditController = new AuditController();

// Only admins can access audit logs
router.get('/', authenticate, authorize(UserRole.ADMIN), auditController.getAuditLogs.bind(auditController));
router.get('/stats', authenticate, authorize(UserRole.ADMIN), auditController.getAuditStats.bind(auditController));
router.get('/filters', authenticate, authorize(UserRole.ADMIN), auditController.getAvailableFilters.bind(auditController));

export default router;