import { useEffect, useState } from 'react';
import { APP_VERSION } from '../constants/version';

/**
 * Erkennt, ob auf dem Server eine neuere Client-Version deployt wurde, indem die
 * im Build eingebettete Version (APP_VERSION) mit der /health-Version verglichen wird.
 * Pollt regelmäßig + beim Zurückkehren in den Tab. Liefert die neue Version (oder null).
 */
export function useUpdateAvailable(pollMs = 60000) {
  const [newVersion, setNewVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch('/health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        const server = String(data?.version || '');
        // Mismatch (≠ eigene Build-Version) → neuer Deploy verfügbar.
        if (server && server !== APP_VERSION) setNewVersion(server);
      } catch { /* offline/timeout – ignorieren */ }
    };

    check();
    const id = window.setInterval(check, pollMs);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);

  return newVersion;
}
