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
