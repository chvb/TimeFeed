import jwt from 'jsonwebtoken';

/**
 * Verifiziert einen vom FeedAuth-Hub signierten Einmal-Handoff.
 * Signiert mit dem gemeinsamen TIMEFEED_HANDOFF_SECRET (HMAC), Issuer 'feedauth',
 * kurze Laufzeit. Payload: { pid: hubPersonId, act: 'stamp', jti }.
 */
export interface HubHandoff {
  pid: string;
  act: string;
  jti: string;
  iat: number;
  exp: number;
}

export function verifyHubHandoff(token: string): HubHandoff {
  const secret = process.env.TIMEFEED_HANDOFF_SECRET;
  if (!secret) throw new Error('TIMEFEED_HANDOFF_SECRET nicht konfiguriert');
  return jwt.verify(token, secret, { issuer: 'feedauth', algorithms: ['HS256'] }) as HubHandoff;
}

export type HubResolveResult =
  | { ok: true; pid: string }
  | { ok: false; code: 'UNKNOWN_CODE' | 'NOT_LINKED' | 'PIN_REQUIRED' | 'PIN_INVALID' | 'PIN_NOT_SET' | 'HUB_UNAVAILABLE' };

/**
 * Löst einen von einem NFC-Chip gelesenen Hub-Token (aus der NDEF-URL
 * https://auth.feedapps.de/t/<TOKEN>) server-zu-server beim FeedAuth-Hub auf.
 * Ruft den bestehenden `POST /api/public/handoff` (app='timefeed'), verifiziert den
 * signierten Handoff und liefert die hubPersonId (publicId) zurück. So werden NFC-Chips
 * ausschließlich zentral im Hub gepflegt — TimeFeed kennt keine Chip-UIDs mehr.
 */
export async function resolveHubToken(token: string, pin?: string): Promise<HubResolveResult> {
  const t = String(token || '').trim();
  if (!t) return { ok: false, code: 'UNKNOWN_CODE' };
  const hubUrl = (process.env.HUB_AUDIT_URL || 'http://127.0.0.1:3011').replace(/\/+$/, '');

  let res: Response;
  try {
    res = await fetch(`${hubUrl}/api/public/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t, app: 'timefeed', ...(pin ? { pin } : {}) }),
    });
  } catch {
    return { ok: false, code: 'HUB_UNAVAILABLE' };
  }

  let data: any = {};
  try { data = await res.json(); } catch { /* leerer Body */ }

  if (res.status === 404) return { ok: false, code: 'UNKNOWN_CODE' };
  if (res.status === 403) return { ok: false, code: 'NOT_LINKED' };
  if (data?.code === 'PIN_NOT_SET') return { ok: false, code: 'PIN_NOT_SET' };
  if (data?.code === 'WRONG_PIN') return { ok: false, code: 'PIN_INVALID' };
  if (data?.pinRequired) return { ok: false, code: 'PIN_REQUIRED' };
  if (data?.redirectUrl) {
    const frag = String(data.redirectUrl).split('#')[1] || '';
    if (frag) {
      try {
        const payload = verifyHubHandoff(frag);
        if (payload?.pid) return { ok: true, pid: String(payload.pid) };
      } catch { /* Signaturfehler → unten HUB_UNAVAILABLE */ }
    }
  }
  return { ok: false, code: 'HUB_UNAVAILABLE' };
}

/**
 * Rückkanal: meldet dem Hub die tatsächlich per NFC ausgeführte Aktion fürs zentrale
 * Audit-Log. Signiert mit DEMSELBEN Handoff-Secret, aber Issuer 'feedapp-action'
 * (Hub prüft damit). Best-effort: Fehler werden verschluckt, Stempeln bleibt unberührt.
 */
export function reportNfcActionToHub(publicId: string, action: string, detail?: string): void {
  const secret = process.env.TIMEFEED_HANDOFF_SECRET;
  if (!secret || !publicId) return;
  const hubUrl = (process.env.HUB_AUDIT_URL || 'http://127.0.0.1:3011').replace(/\/+$/, '');
  try {
    const token = jwt.sign({ pid: publicId, action, detail: detail || '' }, secret, {
      issuer: 'feedapp-action', expiresIn: 60,
    });
    void fetch(`${hubUrl}/api/public/nfc-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'timefeed', token }),
    }).catch(() => { /* Best-effort */ });
  } catch { /* ignore */ }
}
