// API-Client für den Kiosk-Terminal-Modus (/terminal).
// Bewusst fetch statt axios (lib/api.ts): Das Terminal hat KEIN User-JWT, sondern
// authentifiziert sich per Geräte-Token (Header X-Terminal-Token); der globale
// axios-401-Interceptor (Redirect auf /login) darf hier nicht greifen.

export type TerminalMethod = 'nfc' | 'code' | 'qr';
export type StampType = 'in' | 'out' | 'break_start' | 'break_end';

export interface TerminalInfo {
  name: string;
  companyName: string;
  methods: TerminalMethod[];
  requirePin: boolean;
}

export interface IdentifyResult {
  user: { firstName: string; lastName: string };
  state: 'out' | 'in' | 'break';
  breakMode: 'auto' | 'manual' | 'combined' | string;
}

export interface StampCredential {
  stampCode?: string;
  nfcTagUid?: string;
}

export interface StampPayload extends StampCredential {
  pin?: string;
  type: StampType;
  /** Bei nachgereichten Offline-Stempelungen: Original-Zeitpunkt (ISO). */
  clientTimestamp?: string;
}

/** HTTP-Fehler vom Server (4xx/5xx) mit maschinenlesbarem Code (z. B. PIN_REQUIRED). */
export class TerminalApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message || code || `HTTP ${status}`);
    this.name = 'TerminalApiError';
    this.status = status;
    this.code = code;
  }
}

/** Netzwerkfehler (Server nicht erreichbar / Timeout) → Offline-Queue nutzen. */
export class TerminalNetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'TerminalNetworkError';
  }
}

async function request(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<any> {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    res = await fetch(path, {
      method,
      headers: {
        'X-Terminal-Token': token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch {
    throw new TerminalNetworkError();
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* leere/Nicht-JSON-Antwort */ }
  if (!res.ok) {
    // Server kann {code,message} oder {error} liefern — beides tolerieren.
    const code =
      (typeof data?.code === 'string' && data.code) ||
      (typeof data?.errorCode === 'string' && data.errorCode) ||
      (typeof data?.error === 'string' && /^[A-Z0-9_]+$/.test(data.error) ? data.error : '');
    const message =
      (typeof data?.message === 'string' && data.message) ||
      (typeof data?.error === 'string' ? data.error : '');
    throw new TerminalApiError(res.status, code, message);
  }
  return data ?? {};
}

const VALID_METHODS: TerminalMethod[] = ['nfc', 'code', 'qr'];

/** GET /api/terminal/info — prüft den Token und liefert Gerät + Konfiguration. */
export async function fetchTerminalInfo(token: string): Promise<TerminalInfo> {
  const d = await request('GET', '/api/terminal/info', token);
  const raw = d.terminal || d.device || d;
  let cfg = raw.config ?? d.config ?? {};
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) || {}; } catch { cfg = {}; } }
  const rawMethods = Array.isArray(cfg.methods) ? cfg.methods : Array.isArray(raw.methods) ? raw.methods : [];
  const methods = rawMethods.filter((m: string): m is TerminalMethod => (VALID_METHODS as string[]).includes(m));
  return {
    name: raw.name || '',
    companyName: d.companyName || raw.companyName || d.company?.name || raw.company?.name || '',
    // Ohne explizite Konfiguration alle Methoden anbieten (Gerätefähigkeit filtert ohnehin).
    methods: methods.length ? methods : [...VALID_METHODS],
    requirePin: !!(cfg.requirePin ?? raw.requirePin ?? d.requirePin),
  };
}

/** POST /api/terminal/identify — Mitarbeiter anhand Code/NFC (+ optional PIN) erkennen. */
export async function terminalIdentify(token: string, payload: StampCredential & { pin?: string }): Promise<IdentifyResult> {
  const d = await request('POST', '/api/terminal/identify', token, payload);
  return {
    user: { firstName: d.user?.firstName || '', lastName: d.user?.lastName || '' },
    state: d.state === 'in' || d.state === 'break' ? d.state : 'out',
    breakMode: d.breakMode || 'auto',
  };
}

/** POST /api/terminal/stamp — Stempelung ausführen (ggf. mit clientTimestamp nachgereicht). */
export async function terminalStamp(token: string, payload: StampPayload): Promise<any> {
  return request('POST', '/api/terminal/stamp', token, payload);
}
