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
  return jwt.verify(token, secret, { issuer: 'feedauth' }) as HubHandoff;
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
