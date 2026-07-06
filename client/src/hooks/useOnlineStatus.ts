import { useEffect, useState } from 'react';

/**
 * Verbindungsstatus zum Backend: pollt /health (mit Timeout) und beachtet
 * Browser online/offline-Events. Liefert zusätzlich die Server-Version.
 */
export function useOnlineStatus(pollMs = 30000) {
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [uptime30d, setUptime30d] = useState<number | null>(null);
  const [processUptimeSeconds, setProcessUptimeSeconds] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const t0 = performance.now();
        const res = await fetch('/health', { cache: 'no-cache', signal: ctrl.signal });
        const elapsed = Math.round(performance.now() - t0);
        clearTimeout(timer);
        if (cancelled) return;
        if (res.ok) {
          setOnline(true);
          setPing(elapsed);
          try {
            const data = await res.json();
            setServerVersion(data?.version ?? null);
            setUptime30d(typeof data?.uptime30d === 'number' ? data.uptime30d : null);
            setProcessUptimeSeconds(typeof data?.processUptimeSeconds === 'number' ? data.processUptimeSeconds : null);
          } catch { /* ignore */ }
        } else {
          setOnline(false);
        }
      } catch {
        if (!cancelled) { setOnline(false); setPing(null); }
      }
    };

    check();
    const id = window.setInterval(check, pollMs);
    const goOnline = () => { setOnline(true); check(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [pollMs]);

  return { online, serverVersion, ping, uptime30d, processUptimeSeconds };
}
