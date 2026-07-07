import { Router } from 'express';
import { AbsenceTypeController } from '../controllers/absenceType.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const controller = new AbsenceTypeController();

// Lesen: alle eingeloggten Rollen (Chips/Selects in MyTimes, Zeiten verwalten,
// Export-Mapping brauchen Labels + Farben). Schreiben: nur admin.
router.use(authenticate);

router.get('/', controller.list.bind(controller));
router.post('/', authorize(UserRole.ADMIN), controller.create.bind(controller));
router.put('/:id', authorize(UserRole.ADMIN), controller.update.bind(controller));
router.delete('/:id', authorize(UserRole.ADMIN), controller.remove.bind(controller));

export default router;
