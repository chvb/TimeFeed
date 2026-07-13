import { useEffect, useRef, useState } from 'react';
import Logo from '../components/common/Logo';

/**
 * Öffentliche persönliche Stempelseite nach NFC-Scan.
 * Der FeedAuth-Hub leitet hierher weiter: /nfc#<handoff>. Wir tauschen den Handoff
 * gegen eine kurzlebige, aufs Stempeln begrenzte Sitzung und bieten Kommen/Gehen/Pause
 * an — mit Handy-GPS. Kein App-Login nötig.
 */

type StampState = 'out' | 'in' | 'break';
type StampType = 'in' | 'out' | 'break_start' | 'break_end';

interface StatusDto {
  state: StampState;
  breakMode?: string;
  gpsMode?: string;
}

function getPosition(strict: boolean): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: strict ? 8000 : 3000, maximumAge: strict ? 0 : 60000 }
    );
  });
}

export default function NfcStamp() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'done'>('loading');
  const [message, setMessage] = useState('Einen Moment…');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef<string>('');

  async function nfcFetch(path: string, opts: RequestInit = {}) {
    const res = await fetch(`/api/nfc${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}`, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // 1) Handoff aus dem Fragment gegen eine Stempel-Sitzung tauschen.
  useEffect(() => {
    const handoff = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
    // Fragment sofort aus der Adresszeile entfernen (kein Lauschen/Bookmark).
    try { history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
    if (!handoff) { setPhase('error'); setMessage('Kein gültiger Zugang. Bitte Chip erneut scannen.'); return; }

    (async () => {
      try {
        const res = await fetch('/api/nfc/exchange', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handoff }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setPhase('error'); setMessage(data.message || 'Zugang abgelaufen. Bitte Chip erneut scannen.'); return; }
        tokenRef.current = data.token;
        setName(`${data.user?.firstName || ''} ${data.user?.lastName || ''}`.trim());
        await loadStatus();
        setMessage(''); // „Einen Moment…" verwerfen — die rote Zeile ist nur für Stempel-Fehler
        setPhase('ready');
      } catch {
        setPhase('error'); setMessage('Netzwerkfehler. Bitte erneut scannen.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStatus() {
    const r = await nfcFetch('/status');
    if (r.ok) setStatus(r.data);
  }

  async function stamp(type: StampType) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const gpsMode = status?.gpsMode || 'optional';
      const pos = gpsMode === 'off' ? null : await getPosition(gpsMode === 'required');
      const body: Record<string, unknown> = { type };
      if (pos) { body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; body.accuracy = pos.coords.accuracy; }
      const r = await nfcFetch('/stamp', { method: 'POST', body: JSON.stringify(body) });
      if (r.ok) {
        setStatus(r.data);
        const label = type === 'in' ? 'Gekommen' : type === 'out' ? 'Gegangen' : type === 'break_start' ? 'Pause gestartet' : 'Pause beendet';
        setPhase('done');
        setMessage(`${label} um ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}.`);
      } else if (r.data?.error === 'GPS_REQUIRED') {
        setMessage('Standortfreigabe ist fürs Stempeln erforderlich.');
      } else {
        setMessage(r.data?.message || 'Stempeln fehlgeschlagen.');
      }
    } catch {
      setMessage('Netzwerkfehler.');
    } finally {
      setBusy(false);
    }
  }

  // Best-effort: Fenster/Tab schließen. Klappt zuverlässig nur in der installierten
  // App (PWA); ein per NFC geöffneter Browser-Tab lässt sich per Skript oft nicht schließen.
  function tryClose() {
    try { window.close(); } catch { /* ignore */ }
    try { window.open('', '_self'); window.close(); } catch { /* ignore */ }
  }

  const btn = 'w-full py-4 mt-3 rounded-2xl text-white text-lg font-bold disabled:opacity-60';

  return (
    <div className="min-h-screen flex items-center justify-center p-5 sm:p-6 bg-gradient-to-br from-primary-400 to-primary-600">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl shadow-primary-900/20 p-7 text-center">
        <Logo size="large" className="justify-center mb-3" />
        {phase === 'loading' && <h1 className="text-2xl font-bold my-4">{message}</h1>}

        {phase === 'error' && (
          <>
            <h1 className="text-2xl font-bold my-3">Nicht möglich</h1>
            <p className="text-red-600">{message}</p>
          </>
        )}

        {(phase === 'ready' || phase === 'done') && (
          <>
            <h1 className="text-2xl font-bold my-3">Hallo {name}</h1>
            {phase === 'done' ? (
              <p className="text-emerald-600 font-semibold mb-2">{message}</p>
            ) : (
              <p className="text-slate-500 mb-2">Was möchtest du tun?</p>
            )}

            {status?.state === 'out' && (
              <button className={`${btn} bg-emerald-500`} disabled={busy} onClick={() => stamp('in')}>Kommen</button>
            )}
            {status?.state === 'in' && (
              <>
                <button className={`${btn} bg-rose-500`} disabled={busy} onClick={() => stamp('out')}>Gehen</button>
                {status?.breakMode && status.breakMode !== 'auto' && (
                  <button className={`${btn} bg-sky-500`} disabled={busy} onClick={() => stamp('break_start')}>Pause</button>
                )}
              </>
            )}
            {status?.state === 'break' && (
              <button className={`${btn} bg-sky-500`} disabled={busy} onClick={() => stamp('break_end')}>Pause beenden</button>
            )}

            {phase === 'done' && (
              <>
                <button onClick={tryClose} className={`${btn} bg-slate-700 mt-4`}>Fenster schließen</button>
                <p className="text-slate-400 text-sm mt-3">Du kannst das Fenster jetzt schließen.</p>
              </>
            )}
            {phase === 'ready' && message && <p className="text-red-600 text-sm mt-3">{message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
