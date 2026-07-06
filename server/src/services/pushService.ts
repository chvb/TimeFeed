import webpush from 'web-push';
import { PushSubscription } from '../models/PushSubscription';
import { VapidKeys } from '../models/VapidKeys';

/**
 * Web-Push: VAPID-Schlüssel werden beim ersten Start generiert und in der Tabelle
 * vapid_keys persistiert (neue Keys würden alle bestehenden Abos invalidieren).
 * notifyUser() verschickt an alle Abos eines Nutzers; 404/410 (gone) → Abo löschen.
 */

let initPromise: Promise<string> | null = null;

/** VAPID-Keys laden bzw. beim ersten Start erzeugen; web-push konfigurieren. */
export async function initPush(): Promise<string> {
  if (!initPromise) {
    initPromise = (async () => {
      let keys = await VapidKeys.findOne();
      if (!keys) {
        const generated = webpush.generateVAPIDKeys();
        keys = await VapidKeys.create({ publicKey: generated.publicKey, privateKey: generated.privateKey });
        console.log('WebPush: VAPID-Schlüsselpaar generiert und gespeichert.');
      }
      const subject = process.env.VAPID_SUBJECT || 'mailto:it@siebers.de';
      webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
      return keys.publicKey;
    })().catch((e) => {
      initPromise = null; // nächster Aufruf versucht es erneut
      throw e;
    });
  }
  return initPromise;
}

export async function getVapidPublicKey(): Promise<string> {
  return initPush();
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface NotifyResult {
  sent: number;
  failed: number;
  removed: number;
}

/** Push an alle Abos eines Nutzers. HTTP 404/410 → Abo ist tot und wird gelöscht. */
export async function notifyUser(userId: number, payload: PushPayload): Promise<NotifyResult> {
  const result: NotifyResult = { sent: 0, failed: 0, removed: 0 };
  try {
    await initPush();
    const subs = await PushSubscription.findAll({ where: { userId } });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || '/' })
        );
        result.sent++;
      } catch (e: any) {
        const status = e?.statusCode;
        if (status === 404 || status === 410) {
          await sub.destroy().catch(() => { /* unkritisch */ });
          result.removed++;
        } else {
          result.failed++;
        }
      }
    }
  } catch (e) {
    console.error('WebPush: notifyUser fehlgeschlagen:', (e as any)?.message);
  }
  return result;
}

/**
 * Benachrichtigt Nutzer, deren Vortag automatisch gekappt wurde (Auto-Kappung im
 * timeRecalcJob). Wird bewusst NICHT hier aufgerufen — der Aufruf-Einzeiler wird
 * nach dem Merge in timeRecalcJob eingebaut.
 */
export async function notifyAutoCappedUsers(userIds: number[]): Promise<void> {
  for (const userId of new Set(userIds)) {
    await notifyUser(userId, {
      title: 'TimeFeed: automatisch ausgestempelt',
      body: 'Du wurdest beim Tagesabschluss automatisch ausgestempelt (Ausstempeln vergessen?). Bitte prüfe deine Zeiten.',
      url: '/',
    });
  }
}
