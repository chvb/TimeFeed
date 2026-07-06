import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { PushSubscription } from '../models/PushSubscription';
import { getVapidPublicKey } from '../services/pushService';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Web-Push-Abos: alle Endpunkte erfordern einen eingeloggten Nutzer.
router.use(authenticate);

/** GET /api/push/vapid-public-key → { publicKey } */
router.get('/vapid-public-key', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ publicKey: await getVapidPublicKey() });
  } catch (e) { next(e); }
});

/**
 * POST /api/push/subscribe — Body { subscription: { endpoint, keys: { p256dh, auth } } }.
 * Upsert per endpoint (ein Browser-Abo kann den Nutzer wechseln, z. B. Shared Device).
 */
router.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sub = req.body?.subscription;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint.trim() : '';
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
    if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 1024) {
      return next(new AppError(400, 'subscription.endpoint (https-URL) erforderlich'));
    }
    if (!p256dh || !auth) {
      return next(new AppError(400, 'subscription.keys.p256dh und .auth erforderlich'));
    }

    const existing = await PushSubscription.findOne({ where: { endpoint } });
    if (existing) {
      await existing.update({ userId: req.user!.id, p256dh, auth });
      return res.json({ ok: true, subscriptionId: existing.id });
    }
    const created = await PushSubscription.create({ userId: req.user!.id, endpoint, p256dh, auth });
    return res.status(201).json({ ok: true, subscriptionId: created.id });
  } catch (e) { return next(e); }
});

/** DELETE /api/push/subscribe — Body { endpoint }. Löscht nur eigene Abos. */
router.delete('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) return next(new AppError(400, 'endpoint erforderlich'));
    const removed = await PushSubscription.destroy({ where: { endpoint, userId: req.user!.id } });
    return res.json({ ok: true, removed });
  } catch (e) { return next(e); }
});

export default router;
