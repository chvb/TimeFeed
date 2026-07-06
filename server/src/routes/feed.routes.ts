import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getFeedExtras } from '../controllers/feed.controller';

const router = Router();

router.get('/extras', authenticate, getFeedExtras);

export default router;
