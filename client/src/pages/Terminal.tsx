import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowsPointingOutIcon,
  BackspaceIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  QrCodeIcon,
  SignalSlashIcon,
  WifiIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import Logo from '../components/common/Logo';
import { BRAND_NAME, BRAND_PRIMARY } from '../components/common/brand';
import { useI18n } from '../i18n';
import {
  fetchTerminalInfo,
  terminalIdentify,
  terminalPing,
  terminalStamp,
  verifyTerminalSettings,
  TerminalApiError,
  TerminalNetworkError,
  type IdentifyResult,
  type StampCredential,
  type StampType,
  type TerminalInfo,
} from '../lib/terminalApi';
import { addPendingStamp, countPendingStamps, getPendingStamps, removePendingStamp } from '../lib/terminalQueue';

const TOKEN_KEY = 'tf-terminal-token';
const INFO_KEY = 'tf-terminal-info';

type Screen = 'setup' | 'settingsGate' | 'idle' | 'pin' | 'action' | 'offlineAction' | 'confirm' | 'error';

// Zahnrad-Schutz: nach so vielen Fehlversuchen zurück zum Idle-Screen.
const SETTINGS_MAX_ATTEMPTS = 3;
// Heartbeat-Fallback (Sekunden) — das echte Intervall kommt vom Server
// (SystemSettings.terminalPingSeconds) über die Info-/Ping-Antwort.
const DEFAULT_PING_SECONDS = 20;

interface ConfirmData {
  name: string;
  type: StampType;
  time: string;
  queued: boolean;
}

/** Großer Touch-Nummernblock (0-9, Löschen, OK). */
function Numpad({ onDigit, onDelete, onOk, okDisabled, deleteLabel }: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onOk: () => void;
  okDisabled?: boolean;
  deleteLabel: string;
}) {
  const pad = 'h-16 sm:h-20 rounded-2xl text-3xl font-semibold transition-colors touch-manipulation';
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-xs mx-auto">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} type="button" onClick={() => onDigit(d)} className={clsx(pad, 'bg-white/10 hover:bg-white/20 active:bg-white/30')}>
          {d}
        </button>
      ))}
      <button type="button" onClick={onDelete} aria-label={deleteLabel} className={clsx(pad, 'bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center')}>
        <BackspaceIcon className="h-9 w-9" />
      </button>
      <button type="button" onClick={() => onDigit('0')} className={clsx(pad, 'bg-white/10 hover:bg-white/20 active:bg-white/30')}>
        0
      </button>
      <button type="button" onClick={onOk} disabled={okDisabled} className={clsx(pad, 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-300 disabled:opacity-40 disabled:hover:bg-emerald-500 text-2xl')}>
        OK
      </button>
    </div>
  );
}

/**
 * Kiosk-Terminal-Modus (/terminal): Vollbild-Stempeluhr ohne Login.
 * Auth per Geräte-Token (localStorage), Identifikation via NFC/Code/QR,
 * Offline-Queue in IndexedDB mit Hintergrund-Sync.
 */
export default function Terminal() {
  const { t, lang } = useI18n();
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';

  const [screen, setScreen] = useState<Screen>('setup');
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<TerminalInfo | null>(null);

  // Setup
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [setupError, setSetupError] = useState('');

  // Idle / Eingaben
  const [now, setNow] = useState(() => new Date());
  const [codeInput, setCodeInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [busy, setBusy] = useState(false);

  // Identifikation / Aktion
  const [identity, setIdentity] = useState<IdentifyResult | null>(null);
  const [pendingCred, setPendingCred] = useState<StampCredential | null>(null);
  const [pendingPin, setPendingPin] = useState<string | undefined>(undefined);
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Verbindung / Queue
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // Server per Heartbeat erreichbar? navigator.onLine allein reicht nicht —
  // das WLAN kann stehen, während der Server down ist.
  const [serverReachable, setServerReachable] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  // Token vom Server abgelehnt (widerrufen/neu erzeugt/Terminal deaktiviert).
  // Ein angemeldetes Terminal wird NIE automatisch abgemeldet: Token bleibt
  // gespeichert, das Terminal zeigt einen Hinweis und prüft periodisch neu.
  const [tokenInvalid, setTokenInvalid] = useState(false);

  // Zahnrad-Schutz (Einstellungs-Passwort)
  const [settingsPassInput, setSettingsPassInput] = useState('');
  const [settingsGateError, setSettingsGateError] = useState('');
  const settingsAttemptsRef = useRef(0);

  // Scanner-Status
  const [nfcState, setNfcState] = useState<'idle' | 'ready' | 'error'>('idle');
  const [qrState, setQrState] = useState<'idle' | 'active' | 'error'>('idle');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const tokenRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const flushingRef = useRef(false);
  const reachableRef = useRef(true);
  const lastScanRef = useRef<{ v: string; ts: number }>({ v: '', ts: 0 });

  // Läuft die Seite in der nativen TimeFeed-Terminal-App? (User-Agent-Suffix)
  const nativeApp = navigator.userAgent.includes('TimeFeedTerminalApp');
  const nfcSupported = 'NDEFReader' in window || nativeApp;
  const qrSupported = 'BarcodeDetector' in window;
  const methods = info?.methods ?? [];

  const fmtTime = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setScreen('error');
  }, []);

  const resetToIdle = useCallback(() => {
    setCodeInput('');
    setPinInput('');
    setPinError('');
    setIdentity(null);
    setPendingCred(null);
    setPendingPin(undefined);
    setConfirmData(null);
    setErrorMsg('');
    setSettingsPassInput('');
    setSettingsGateError('');
    settingsAttemptsRef.current = 0;
    setScreen(tokenRef.current ? 'idle' : 'setup');
  }, []);

  const refreshPendingCount = useCallback(() => {
    countPendingStamps().then(setPendingCount).catch(() => {});
  }, []);

  /* ---------- Offline-Queue: Hintergrund-Sync ---------- */
  const flushQueue = useCallback(async () => {
    const tok = tokenRef.current;
    if (!tok || flushingRef.current || !navigator.onLine) return;
    flushingRef.current = true;
    try {
      const items = await getPendingStamps();
      for (const item of items) {
        const { id, ...payload } = item;
        try {
          await terminalStamp(tok, payload);
          await removePendingStamp(id);
        } catch (e) {
          if (e instanceof TerminalApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
            // Fachlich abgelehnt (z. B. Duplikat) → aus der Queue entfernen.
            await removePendingStamp(id);
          } else {
            break; // Netz/5xx/429 → später erneut versuchen
          }
        }
      }
    } catch { /* IndexedDB nicht verfügbar */ } finally {
      flushingRef.current = false;
      refreshPendingCount();
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    refreshPendingCount();
    const id = window.setInterval(() => { flushQueue(); }, 30000);
    const onOnline = () => { setIsOnline(true); flushQueue(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushQueue, refreshPendingCount]);

  /* ---------- Start: gespeicherten Token prüfen ---------- */
  useEffect(() => {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (!tok) { setScreen('setup'); return; }
    tokenRef.current = tok;
    setToken(tok);
    // Zwischengespeicherte Geräte-Infos für den Offline-Start anzeigen.
    try {
      const cached = localStorage.getItem(INFO_KEY);
      if (cached) setInfo(JSON.parse(cached));
    } catch { /* Cache defekt → wird gleich neu geladen */ }
    setScreen('idle');
    fetchTerminalInfo(tok)
      .then((inf) => {
        setInfo(inf);
        localStorage.setItem(INFO_KEY, JSON.stringify(inf));
        flushQueue();
      })
      .catch((e) => {
        if (e instanceof TerminalApiError && (e.status === 401 || e.status === 403)) {
          // Token widerrufen/neu erzeugt/Terminal deaktiviert: NICHT abmelden —
          // Hinweis anzeigen, Token behalten, periodische Neuprüfung (unten).
          setTokenInvalid(true);
        }
        // Netzwerkfehler: Idle bleibt nutzbar (Offline-Queue).
      });
    // Persistenten Speicher anfordern, damit der Browser das Geräte-Token
    // (localStorage) bei Speicherdruck nicht wegräumen darf.
    try { (navigator as any).storage?.persist?.(); } catch { /* optional */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Ungültiges Token: alle 60s neu prüfen (z. B. nach Re-Aktivierung
     des Terminals oder wenn ein Admin das alte Token wieder einspielt) ---------- */
  useEffect(() => {
    if (!tokenInvalid) return;
    const id = window.setInterval(() => {
      const tok = tokenRef.current;
      if (!tok) return;
      fetchTerminalInfo(tok)
        .then((inf) => {
          setInfo(inf);
          localStorage.setItem(INFO_KEY, JSON.stringify(inf));
          setTokenInvalid(false);
          flushQueue();
        })
        .catch(() => { /* weiter warten */ });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [tokenInvalid, flushQueue]);

  /* ---------- Heartbeat: alle 10s /api/terminal/ping (Verbindungsanzeige) ----------
     Nur ein TerminalNetworkError bedeutet „Server nicht erreichbar" — jede
     HTTP-Antwort (auch 401 bei ungültigem Token) heißt: Server lebt.
     Fehler bleiben still (kein Toast-Spam); kommt die Verbindung zurück,
     verschwindet der Banner und die Offline-Queue wird sofort geleert. */
  const [pingSeconds, setPingSeconds] = useState(DEFAULT_PING_SECONDS);
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    const doPing = async () => {
      const tok = tokenRef.current;
      if (!tok) return;
      try {
        const r = await terminalPing(tok);
        if (stopped) return;
        // Serverseitig konfiguriertes Intervall live übernehmen.
        const s = Number(r?.pingSeconds);
        if (Number.isFinite(s) && s >= 5 && s <= 600) setPingSeconds(s);
        if (!reachableRef.current) flushQueue(); // Verbindung wieder da → sofort nachreichen
        reachableRef.current = true;
        setServerReachable(true);
      } catch (e) {
        if (stopped) return;
        const unreachable = e instanceof TerminalNetworkError;
        reachableRef.current = !unreachable;
        setServerReachable(!unreachable);
      }
    };
    doPing();
    const id = window.setInterval(doPing, pingSeconds * 1000);
    // Browser drosseln Timer in Hintergrund-Tabs stark — beim Sichtbarwerden
    // sofort pingen, damit sich das Terminal direkt wieder meldet.
    const onVisible = () => { if (document.visibilityState === 'visible') doPing(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [token, flushQueue, pingSeconds]);

  /* ---------- Live-Uhr ---------- */
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);


  /* ---------- 24/7-Selbstheilung ----------
     (1) Nächtlicher Auto-Reload (03:45): räumt Speicherlecks langer Browser-
         Sessions ab und zieht neue App-Versionen — nur am Idle-Screen, damit
         niemand mitten in einer Eingabe unterbrochen wird (sonst nächster Tick).
     (2) Fehler-Zähler: häufen sich unbehandelte JS-Fehler (kaputter Zustand),
         lädt der Kiosk sich selbst neu statt weiß/eingefroren hängenzubleiben. */
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    if (!token) return;
    const RELOAD_HOUR = 3, RELOAD_MINUTE = 45;
    const id = window.setInterval(() => {
      const n = new Date();
      if (n.getHours() === RELOAD_HOUR && n.getMinutes() === RELOAD_MINUTE && screenRef.current === 'idle') {
        window.location.reload();
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [token]);

  useEffect(() => {
    let errorCount = 0;
    let firstErrorAt = 0;
    const onError = () => {
      const n = Date.now();
      if (n - firstErrorAt > 120_000) { errorCount = 0; firstErrorAt = n; }
      errorCount += 1;
      // 8 unbehandelte Fehler binnen 2 Minuten = kaputter Zustand → Neustart der App.
      if (errorCount >= 8) window.location.reload();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
    };
  }, []);



  /* ---------- Wake-Lock (Tablet nicht einschlafen lassen) ---------- */
  useEffect(() => {
    let lock: any = null;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* z. B. Energiesparmodus aktiv */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      try { lock?.release?.(); } catch { /* bereits freigegeben */ }
    };
  }, []);

  /* ---------- Identifikation ---------- */
  const handleIdentify = useCallback(async (cred: StampCredential, pin?: string) => {
    const tok = tokenRef.current;
    if (!tok || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await terminalIdentify(tok, { ...cred, ...(pin ? { pin } : {}) });
      setIdentity(res);
      setPendingCred(cred);
      setPendingPin(pin);
      setCodeInput('');
      setScreen('action');
    } catch (e) {
      if (e instanceof TerminalNetworkError) {
        // Offline: direkten Kommen/Gehen-Modus ohne Namensprüfung anbieten.
        setPendingCred(cred);
        setPendingPin(pin);
        setCodeInput('');
        setScreen('offlineAction');
      } else if (e instanceof TerminalApiError && e.code === 'PIN_REQUIRED') {
        setPendingCred(cred);
        setPinInput('');
        setPinError('');
        setCodeInput('');
        setScreen('pin');
      } else if (e instanceof TerminalApiError && (e.code === 'PIN_INVALID' || (e.status === 401 && pin && !e.code.startsWith('TERMINAL_TOKEN')))) {
        // PIN falsch → auf dem PIN-Screen erneut versuchen lassen.
        setPendingCred(cred);
        setPinInput('');
        setPinError(t('terminal.pinWrong'));
        setScreen('pin');
      } else if (e instanceof TerminalApiError && e.code.startsWith('TERMINAL_TOKEN')) {
        // Geräte-Token abgelehnt: NICHT abmelden — Hinweis, Token bleibt gespeichert.
        setTokenInvalid(true);
        showError(t('terminal.tokenInvalidBanner'));
      } else if (e instanceof TerminalApiError && e.status === 404) {
        showError(t('terminal.unknownCode'));
      } else {
        showError(e instanceof TerminalApiError && e.message ? e.message : t('terminal.identifyError'));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [showError, t]);

  /* ---------- Physische Tastatur für Code-/PIN-Eingabe ----------
     Ziffern/Backspace/Enter am Idle- und PIN-Screen — funktioniert damit auch
     mit USB-/Bluetooth-Scannern, die sich als Tastatur melden (Ziffern + Enter).
     Nicht aktiv, wenn ein echtes Eingabefeld fokussiert ist (Setup/Zahnrad). */
  useEffect(() => {
    if (screen !== 'idle' && screen !== 'pin') return;
    if (screen === 'idle' && !methods.includes('code')) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (busyRef.current) return;
      const setInput = screen === 'idle' ? setCodeInput : setPinInput;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setInput((c) => (c.length < 12 ? c + e.key : c));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInput((c) => c.slice(0, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (screen === 'idle') {
          setCodeInput((c) => {
            if (c) handleIdentify({ stampCode: c });
            return c;
          });
        } else {
          setPinInput((p) => {
            if (pendingCred && p) handleIdentify(pendingCred, p);
            return p;
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, methods, pendingCred, handleIdentify]);

  /* ---------- Native NFC-Brücke (TimeFeed-Terminal-App) ----------
     Die Android-App liest Tags nativ und ruft window.__tfNativeNfc({text, uid})
     auf: Text-Record = Stempel-Code, sonst Tag-UID als nfcTagUid. */
  useEffect(() => {
    (window as any).__tfNativeNfc = (payload: { text?: string | null; uid?: string | null }) => {
      if (busyRef.current || screenRef.current !== 'idle') return;
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      const uid = typeof payload?.uid === 'string' ? payload.uid.trim() : '';
      if (text) handleIdentify({ stampCode: text });
      else if (uid) handleIdentify({ nfcTagUid: uid });
    };
    return () => { delete (window as any).__tfNativeNfc; };
  }, [handleIdentify]);

  // Scan-Quellen (NFC/QR) rufen immer die aktuelle Handler-Version auf,
  // mit Dedupe gegen Mehrfach-Erkennung desselben Tags/Codes.
  const identifyRef = useRef(handleIdentify);
  useEffect(() => { identifyRef.current = handleIdentify; });
  const onScan = useCallback((cred: StampCredential) => {
    const key = cred.stampCode || cred.nfcTagUid || '';
    const ts = Date.now();
    if (!key || (lastScanRef.current.v === key && ts - lastScanRef.current.ts < 4000)) return;
    lastScanRef.current = { v: key, ts };
    identifyRef.current(cred);
  }, []);
  const scanRef = useRef(onScan);
  useEffect(() => { scanRef.current = onScan; });

  /* ---------- NFC-Scan-Loop (Web-NFC, nur wenn verfügbar) ---------- */
  useEffect(() => {
    if (screen !== 'idle' || !methods.includes('nfc') || !('NDEFReader' in window)) return;
    const ctrl = new AbortController();
    let cancelled = false;
    try {
      const reader = new (window as any).NDEFReader();
      reader.onreading = (ev: any) => {
        let text = '';
        try {
          for (const rec of ev.message?.records || []) {
            if (rec.recordType === 'text' && rec.data) {
              text = new TextDecoder(rec.encoding || 'utf-8').decode(rec.data).trim();
              if (text) break;
            }
          }
        } catch { /* unlesbarer Record → Seriennummer nutzen */ }
        const serial = String(ev.serialNumber || '').trim();
        if (text) scanRef.current({ stampCode: text });
        else if (serial) scanRef.current({ nfcTagUid: serial });
      };
      reader.scan({ signal: ctrl.signal })
        .then(() => { if (!cancelled) setNfcState('ready'); })
        .catch(() => { if (!cancelled) setNfcState('error'); });
    } catch {
      setNfcState('error');
    }
    return () => { cancelled = true; ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, info]);

  /* ---------- QR-Scan-Loop (BarcodeDetector + Rückkamera) ---------- */
  useEffect(() => {
    if (screen !== 'idle' || !methods.includes('qr') || !('BarcodeDetector' in window)) return;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        if (!cancelled) setQrState('active');
        timer = window.setInterval(async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2 || busyRef.current) return;
          try {
            const codes = await detector.detect(v);
            const value = String(codes?.[0]?.rawValue || '').trim();
            if (value) scanRef.current({ stampCode: value });
          } catch { /* Frame nicht auswertbar */ }
        }, 500);
      } catch {
        if (!cancelled) setQrState('error');
      }
    })();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      setQrState('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, info]);

  /* ---------- Stempeln ---------- */
  const handleStamp = async (type: StampType) => {
    const tok = tokenRef.current;
    if (!tok || !pendingCred || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const payload = { ...pendingCred, ...(pendingPin ? { pin: pendingPin } : {}), type };
    const name = identity ? `${identity.user.firstName} ${identity.user.lastName}`.trim() : '';
    try {
      await terminalStamp(tok, payload);
      setConfirmData({ name, type, time: fmtTime(new Date()), queued: false });
      setScreen('confirm');
    } catch (e) {
      if (e instanceof TerminalNetworkError) {
        // Netzwerkbedingt fehlgeschlagen → in die Queue, trotzdem bestätigen.
        try { await addPendingStamp({ ...payload, clientTimestamp: new Date().toISOString() }); } catch { /* IndexedDB fehlt */ }
        refreshPendingCount();
        setConfirmData({ name, type, time: fmtTime(new Date()), queued: true });
        setScreen('confirm');
      } else if (e instanceof TerminalApiError && e.status === 409) {
        const key = `terminal.conflict.${e.code}`;
        const mapped = e.code ? t(key) : key;
        showError(mapped !== key ? mapped : (e.message || t('terminal.stampConflict')));
      } else if (e instanceof TerminalApiError && e.code === 'PIN_REQUIRED') {
        setPinInput('');
        setPinError('');
        setScreen('pin');
      } else if (e instanceof TerminalApiError && e.code === 'PIN_INVALID') {
        setPinInput('');
        setPinError(t('terminal.pinWrong'));
        setScreen('pin');
      } else {
        showError(e instanceof TerminalApiError && e.message ? e.message : t('terminal.stampError'));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** Offline-Modus: Stempel ohne Namensprüfung direkt in die Queue. */
  const handleOfflineStamp = async (type: StampType) => {
    if (!pendingCred) return;
    try {
      await addPendingStamp({ ...pendingCred, ...(pendingPin ? { pin: pendingPin } : {}), type, clientTimestamp: new Date().toISOString() });
    } catch { /* IndexedDB fehlt */ }
    refreshPendingCount();
    setConfirmData({ name: '', type, time: fmtTime(new Date()), queued: true });
    setScreen('confirm');
  };

  /* ---------- Setup ---------- */
  const handleConnect = async () => {
    const tok = tokenInput.trim();
    if (!tok || connecting) return;
    setConnecting(true);
    setSetupError('');
    try {
      const inf = await fetchTerminalInfo(tok);
      localStorage.setItem(TOKEN_KEY, tok);
      localStorage.setItem(INFO_KEY, JSON.stringify(inf));
      tokenRef.current = tok;
      setToken(tok);
      setInfo(inf);
      setTokenInput('');
      setScreen('idle');
      flushQueue();
    } catch (e) {
      setSetupError(e instanceof TerminalNetworkError ? t('terminal.setupNetwork') : t('terminal.setupInvalid'));
    } finally {
      setConnecting(false);
    }
  };

  /* ---------- Zahnrad-Schutz: Einstellungs-Passwort ---------- */
  const openSettings = () => {
    if (info?.settingsProtected) {
      // Geschützt: erst Passwort-Screen, Setup erst nach erfolgreicher Prüfung.
      setSettingsPassInput('');
      setSettingsGateError('');
      settingsAttemptsRef.current = 0;
      setScreen('settingsGate');
    } else {
      setSetupError('');
      setScreen('setup');
    }
  };

  const handleVerifySettings = async () => {
    const tok = tokenRef.current;
    if (!tok || !settingsPassInput || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await verifyTerminalSettings(tok, settingsPassInput);
      setSettingsPassInput('');
      setSettingsGateError('');
      settingsAttemptsRef.current = 0;
      setSetupError('');
      setScreen('setup');
    } catch (e) {
      if (e instanceof TerminalNetworkError) {
        // Ohne Server keine Prüfung möglich → Schutz bleibt bestehen.
        setSettingsGateError(t('terminal.setupNetwork'));
      } else {
        settingsAttemptsRef.current += 1;
        if (settingsAttemptsRef.current >= SETTINGS_MAX_ATTEMPTS) {
          resetToIdle(); // 3 Fehlversuche → zurück zu Idle
        } else {
          setSettingsPassInput('');
          setSettingsGateError(t('terminal.settingsGateWrong', { count: SETTINGS_MAX_ATTEMPTS - settingsAttemptsRef.current }));
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    if (!window.confirm(t('terminal.disconnectConfirmText'))) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
    tokenRef.current = null;
    setToken(null);
    setInfo(null);
    setTokenInput('');
    setSetupError('');
  };

  /* ---------- Auto-Rückkehr zu Idle ---------- */
  useEffect(() => {
    if (screen === 'confirm') {
      const id = window.setTimeout(resetToIdle, 4000);
      return () => window.clearTimeout(id);
    }
    if (screen === 'error') {
      const id = window.setTimeout(resetToIdle, 3000);
      return () => window.clearTimeout(id);
    }
    if (screen === 'pin' || screen === 'action' || screen === 'offlineAction' || screen === 'settingsGate') {
      const id = window.setTimeout(resetToIdle, 20000);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [screen, pinInput, settingsPassInput, resetToIdle]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  /* ---------- Render-Helfer ---------- */
  const bigBtn = 'w-full max-w-md h-24 rounded-3xl text-3xl font-bold shadow-lg transition-colors touch-manipulation disabled:opacity-50';

  const actionButtons: { type: StampType; cls: string }[] = [];
  if (identity) {
    if (identity.state === 'out') {
      actionButtons.push({ type: 'in', cls: 'bg-emerald-500 hover:bg-emerald-400' });
    } else if (identity.state === 'in') {
      actionButtons.push({ type: 'out', cls: 'bg-rose-600 hover:bg-rose-500' });
      if (identity.breakMode === 'manual' || identity.breakMode === 'combined') {
        actionButtons.push({ type: 'break_start', cls: 'bg-amber-500 hover:bg-amber-400' });
      }
    } else if (identity.state === 'break') {
      actionButtons.push({ type: 'break_end', cls: 'bg-sky-500 hover:bg-sky-400' });
    }
  }

  const timeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Mandanten-Branding aus GET /api/terminal/info (Header-Logo/-Name/-Farbe im Kiosk).
  const branding = info?.branding || null;
  // Logo-Kette: Geräte-Logo → Firmen-Logo (liefert der Server aufgelöst als info.logo)
  // → Mandanten-Branding → Standard-TimeFeed-Logo.
  const terminalLogo = info?.logo || branding?.brandLogo || null;
  // Einheitlich zur Hauptfarbe der App (Haupt-Header = primary-600) statt Verlauf.
  const headerBg = branding?.brandColor || BRAND_PRIMARY;

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Kopfzeile: orange (Feed-Familie) bzw. Mandanten-Markenfarbe */}
      <header
        className="flex items-center justify-between h-16 px-4 sm:px-6 flex-shrink-0 shadow-md"
        style={{ background: headerBg }}
      >
        {/* Links: App-Logo (Mandanten-Branding oder Standard) + App-Name —
            das Geräte-/Firmen-Logo erscheint mittig auf dem Idle-Screen. */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {branding?.brandLogo ? (
            <span className="flex rounded-2xl bg-white p-1 shadow-sm flex-shrink-0">
              <img src={branding.brandLogo} alt={branding?.brandName || BRAND_NAME} className="h-8 w-8 object-contain" />
            </span>
          ) : (
            <Logo size="small" light iconOnly />
          )}
          <p className="font-bold truncate">{branding?.brandName || BRAND_NAME}</p>
        </div>

        {/* Mitte: Terminal-Name + Firma */}
        <div className="min-w-0 leading-tight text-center px-2 flex-shrink">
          <p className="font-bold truncate">{info?.name || ''}</p>
          {info?.companyName && (
            <p className="text-xs text-white/80 truncate">{info.companyName}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 flex-1">
          {(!isOnline || !serverReachable) && (
            <span className="flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-xs font-semibold">
              <SignalSlashIcon className="h-4 w-4" /> {t('terminal.offline')}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-xs font-semibold" title={t('terminal.pendingSync', { count: pendingCount })}>
              <CloudArrowUpIcon className="h-4 w-4" /> {pendingCount}
            </span>
          )}
          <button type="button" onClick={toggleFullscreen} title={t('terminal.fullscreen')} aria-label={t('terminal.fullscreen')} className="p-2.5 rounded-xl hover:bg-white/15 transition-colors">
            <ArrowsPointingOutIcon className="h-6 w-6" />
          </button>
          {token && screen === 'idle' && (
            <button type="button" onClick={openSettings} title={t('terminal.setupTitle')} aria-label={t('terminal.setupTitle')} className="p-2.5 rounded-xl hover:bg-white/15 transition-colors">
              <Cog6ToothIcon className="h-6 w-6" />
            </button>
          )}
        </div>
      </header>

      {tokenInvalid && (
        <div className="bg-red-600/90 text-white text-center text-sm font-semibold px-4 py-2.5">
          {t('terminal.tokenInvalidBanner')}
        </div>
      )}

      {/* Keine Verbindung (Netz weg ODER Server down): deutlich, aber nicht blockierend —
          Stempeln bleibt über die Offline-Queue möglich. */}
      {token && !tokenInvalid && (!isOnline || !serverReachable) && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 text-slate-950 text-center text-sm font-semibold px-4 py-2.5">
          <SignalSlashIcon className="h-5 w-5 flex-shrink-0" />
          {t('terminal.serverUnreachableBanner')}
        </div>
      )}

      <main className="flex-1 overflow-y-auto flex flex-col">
        {/* ---------- Setup ---------- */}
        {screen === 'setup' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
            <Logo size="xlarge" light />
            <div className="text-center">
              <h1 className="text-3xl font-bold">{t('terminal.setupTitle')}</h1>
              <p className="mt-2 text-white/70 max-w-md">{t('terminal.setupSubtitle')}</p>
            </div>
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
              placeholder={t('terminal.tokenPlaceholder')}
              aria-label={t('terminal.tokenLabel')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full max-w-md rounded-2xl bg-white/10 border border-white/20 px-5 py-4 text-lg font-mono text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            {setupError && (
              <p className="flex items-center gap-2 text-amber-300 text-sm font-medium">
                <ExclamationTriangleIcon className="h-5 w-5" /> {setupError}
              </p>
            )}
            <button
              type="button"
              onClick={handleConnect}
              disabled={!tokenInput.trim() || connecting}
              className="w-full max-w-md rounded-2xl bg-gradient-to-r from-primary-400 to-primary-600 px-8 py-4 text-xl font-bold shadow-lg hover:opacity-90 disabled:opacity-50 transition-opacity touch-manipulation"
            >
              {connecting ? t('terminal.connecting') : t('terminal.connect')}
            </button>
            {token && (
              <div className="flex items-center gap-6 mt-2">
                <button type="button" onClick={() => setScreen('idle')} className="text-white/70 hover:text-white underline underline-offset-4">
                  {t('terminal.backToIdle')}
                </button>
                <button type="button" onClick={handleDisconnect} className="text-rose-300 hover:text-rose-200 underline underline-offset-4">
                  {t('terminal.disconnect')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------- Zahnrad-Schutz: Einstellungs-Passwort ---------- */}
        {screen === 'settingsGate' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
            <LockClosedIcon className="h-16 w-16 text-white/60" />
            <div className="text-center">
              <h2 className="text-3xl font-bold">{t('terminal.settingsGateTitle')}</h2>
              <p className="mt-2 text-white/70 max-w-md">{t('terminal.settingsGateSubtitle')}</p>
            </div>
            <input
              type="password"
              value={settingsPassInput}
              onChange={(e) => setSettingsPassInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVerifySettings(); }}
              placeholder={t('terminal.settingsPasswordPlaceholder')}
              aria-label={t('terminal.settingsPasswordLabel')}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full max-w-md rounded-2xl bg-white/10 border border-white/20 px-5 py-4 text-2xl text-center tracking-widest text-white placeholder-white/40 placeholder:tracking-normal placeholder:text-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            {settingsGateError && (
              <p className="flex items-center gap-2 text-amber-300 font-medium">
                <ExclamationTriangleIcon className="h-5 w-5" /> {settingsGateError}
              </p>
            )}
            <button
              type="button"
              onClick={handleVerifySettings}
              disabled={!settingsPassInput || busy}
              className="w-full max-w-md rounded-2xl bg-gradient-to-r from-primary-400 to-primary-600 px-8 py-4 text-xl font-bold shadow-lg hover:opacity-90 disabled:opacity-50 transition-opacity touch-manipulation"
            >
              {busy ? t('terminal.checking') : t('terminal.settingsGateUnlock')}
            </button>
            <button type="button" onClick={resetToIdle} className="text-white/60 hover:text-white text-lg underline underline-offset-4">
              {t('terminal.cancel')}
            </button>
          </div>
        )}

        {/* ---------- Idle ---------- */}
        {screen === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
            {/* Geräte-/Firmen-Logo: prominent über der Uhr (Kette Gerät → Firma) */}
            {terminalLogo && (
              <div className="flex rounded-3xl bg-white px-6 py-4 shadow-lg">
                <img src={terminalLogo} alt="" className="h-20 sm:h-24 max-w-[16rem] sm:max-w-[20rem] object-contain" />
              </div>
            )}
            <div className="text-center">
              <p className="text-6xl sm:text-8xl font-bold tabular-nums tracking-tight">{timeStr}</p>
              <p className="mt-2 text-xl sm:text-2xl text-white/70 capitalize">{dateStr}</p>
            </div>

            <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 w-full max-w-4xl">
              {/* Code-Eingabe */}
              {methods.includes('code') && (
                <div className="flex flex-col items-center gap-4 w-full max-w-xs">
                  <p className="text-white/70 text-lg">{t('terminal.codeHint')}</p>
                  <div className="h-14 w-full rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-3xl font-mono tabular-nums tracking-[0.3em]">
                    {codeInput || <span className="text-white/30 tracking-normal text-xl">— — —</span>}
                  </div>
                  <Numpad
                    onDigit={(d) => setCodeInput((c) => (c.length < 12 ? c + d : c))}
                    onDelete={() => setCodeInput((c) => c.slice(0, -1))}
                    onOk={() => { if (codeInput) handleIdentify({ stampCode: codeInput }); }}
                    okDisabled={!codeInput || busy}
                    deleteLabel={t('terminal.delete')}
                  />
                </div>
              )}

              {/* NFC / QR Status */}
              {(methods.includes('nfc') || methods.includes('qr')) && (
                <div className="flex flex-col items-center gap-4 w-full max-w-xs">
                  {methods.includes('nfc') && (
                    <div className={clsx('w-full rounded-2xl border p-4 flex items-center gap-3', nfcSupported && nfcState !== 'error' ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/15 bg-white/5')}>
                      <WifiIcon className={clsx('h-8 w-8 flex-shrink-0 rotate-90', nfcSupported && nfcState !== 'error' ? 'text-emerald-300' : 'text-white/40')} />
                      <p className="text-sm">
                        {!nfcSupported ? t('terminal.nfcUnsupported') : nfcState === 'error' ? t('terminal.nfcError') : t('terminal.nfcReady')}
                      </p>
                    </div>
                  )}
                  {methods.includes('qr') && (
                    qrSupported ? (
                      <div className="w-full rounded-2xl border border-white/15 bg-white/5 p-4 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-3 self-start">
                          <QrCodeIcon className="h-8 w-8 text-primary-300 flex-shrink-0" />
                          <p className="text-sm">{qrState === 'error' ? t('terminal.qrCameraError') : t('terminal.qrHint')}</p>
                        </div>
                        <video
                          ref={videoRef}
                          muted
                          playsInline
                          className={clsx('w-full max-w-[240px] rounded-xl bg-black/40', qrState === 'active' ? 'block' : 'hidden')}
                        />
                      </div>
                    ) : (
                      <div className="w-full rounded-2xl border border-white/15 bg-white/5 p-4 flex items-center gap-3">
                        <QrCodeIcon className="h-8 w-8 text-white/40 flex-shrink-0" />
                        <p className="text-sm text-white/60">{t('terminal.qrUnsupported')}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {pendingCount > 0 && (
              <p className="flex items-center gap-2 text-white/50 text-sm">
                <CloudArrowUpIcon className="h-4 w-4" /> {t('terminal.pendingSync', { count: pendingCount })}
              </p>
            )}
            {busy && <p className="text-white/60 text-lg animate-pulse">{t('terminal.checking')}</p>}
          </div>
        )}

        {/* ---------- PIN-Eingabe ---------- */}
        {screen === 'pin' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
            <h2 className="text-3xl font-bold">{t('terminal.pinTitle')}</h2>
            <p className="text-white/70">{t('terminal.pinSubtitle')}</p>
            <div className="h-14 w-full max-w-xs rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-4xl tracking-[0.4em]">
              {pinInput ? '•'.repeat(pinInput.length) : <span className="text-white/30 text-xl tracking-normal">····</span>}
            </div>
            {pinError && (
              <p className="flex items-center gap-2 text-amber-300 font-medium">
                <ExclamationTriangleIcon className="h-5 w-5" /> {pinError}
              </p>
            )}
            <Numpad
              onDigit={(d) => setPinInput((p) => (p.length < 8 ? p + d : p))}
              onDelete={() => setPinInput((p) => p.slice(0, -1))}
              onOk={() => { if (pendingCred && pinInput) handleIdentify(pendingCred, pinInput); }}
              okDisabled={!pinInput || busy}
              deleteLabel={t('terminal.delete')}
            />
            <button type="button" onClick={resetToIdle} className="text-white/60 hover:text-white text-lg underline underline-offset-4">
              {t('terminal.cancel')}
            </button>
          </div>
        )}

        {/* ---------- Aktions-Dialog ---------- */}
        {screen === 'action' && identity && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
            <h2 className="text-4xl sm:text-5xl font-bold text-center">
              {t('terminal.greeting', { name: `${identity.user.firstName} ${identity.user.lastName}`.trim() })}
            </h2>
            <p className="text-white/70 text-xl">{t('terminal.chooseAction')}</p>
            <div className="flex flex-col items-center gap-4 w-full">
              {actionButtons.map((b) => (
                <button key={b.type} type="button" disabled={busy} onClick={() => handleStamp(b.type)} className={clsx(bigBtn, b.cls)}>
                  {t(`terminal.action.${b.type}`)}
                </button>
              ))}
            </div>
            <button type="button" onClick={resetToIdle} className="text-white/60 hover:text-white text-lg underline underline-offset-4 mt-2">
              {t('terminal.cancel')}
            </button>
          </div>
        )}

        {/* ---------- Offline-Aktion (ohne Namensprüfung) ---------- */}
        {screen === 'offlineAction' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
            <span className="flex items-center gap-2 rounded-full bg-amber-400/15 border border-amber-300/40 text-amber-200 px-4 py-2 font-semibold">
              <SignalSlashIcon className="h-5 w-5" /> {t('terminal.offlineTitle')}
            </span>
            <p className="text-white/70 text-lg max-w-md text-center">{t('terminal.offlineText')}</p>
            <div className="flex flex-col items-center gap-4 w-full">
              <button type="button" onClick={() => handleOfflineStamp('in')} className={clsx(bigBtn, 'bg-emerald-500 hover:bg-emerald-400')}>
                {t('terminal.action.in')}
              </button>
              <button type="button" onClick={() => handleOfflineStamp('out')} className={clsx(bigBtn, 'bg-rose-600 hover:bg-rose-500')}>
                {t('terminal.action.out')}
              </button>
            </div>
            <button type="button" onClick={resetToIdle} className="text-white/60 hover:text-white text-lg underline underline-offset-4 mt-2">
              {t('terminal.cancel')}
            </button>
          </div>
        )}

        {/* ---------- Bestätigung ---------- */}
        {screen === 'confirm' && confirmData && (
          <button type="button" onClick={resetToIdle} className="flex-1 flex flex-col items-center justify-center gap-4 p-6 cursor-default">
            <CheckCircleIcon className="h-36 w-36 text-emerald-400" />
            <p className="text-4xl font-bold">{t(`terminal.confirmAction.${confirmData.type}`)}</p>
            {confirmData.name && <p className="text-2xl text-white/80">{confirmData.name}</p>}
            <p className="text-3xl tabular-nums text-white/70">{confirmData.time}</p>
            {confirmData.queued && (
              <p className="flex items-center gap-2 rounded-full bg-amber-400/15 border border-amber-300/40 text-amber-200 px-4 py-2 mt-2">
                <CloudArrowUpIcon className="h-5 w-5" /> {t('terminal.queuedHint')}
              </p>
            )}
          </button>
        )}

        {/* ---------- Fehler ---------- */}
        {screen === 'error' && (
          <button type="button" onClick={resetToIdle} className="flex-1 flex flex-col items-center justify-center gap-5 p-6 cursor-default">
            <ExclamationTriangleIcon className="h-32 w-32 text-amber-400" />
            <p className="text-2xl sm:text-3xl font-semibold text-center max-w-lg">{errorMsg}</p>
          </button>
        )}
      </main>
    </div>
  );
}
