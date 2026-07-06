import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getFeed, getFeedExtras } from '../controllers/feed.controller';

const router = Router();

router.get('/', authenticate, getFeed);
router.get('/extras', authenticate, getFeedExtras);

export default router;
