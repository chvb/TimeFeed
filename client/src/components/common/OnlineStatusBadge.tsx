import { useEffect, useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useT } from '../../i18n';

/**
 * Online-/Offline-Anzeige mit Live-Ping beim Hover (Latenz zum Server,
 * Aktualisierung alle 1,5 s) – analog FotoFeed.
 */
export default function OnlineStatusBadge() {
  const t = useT();
  const { online, uptime30d } = useOnlineStatus();
  const [hovering, setHovering] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    if (!hovering || !online) return;
    let cancelled = false;

    const ping = async () => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch('/ping', { cache: 'no-cache', signal: ctrl.signal });
        clearTimeout(timer);
        if (cancelled) return;
        setMs(res.ok ? Math.round(performance.now() - t0) : null);
      } catch {
        if (!cancelled) setMs(null);
      }
    };

    ping();
    const id = window.setInterval(ping, 1500);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [hovering, online]);

  return (
    <span
      className="relative inline-flex items-center cursor-default"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      title={online ? t('ui.onlineConnected') : t('ui.onlineDisconnected')}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`}
        style={online ? { boxShadow: '0 0 4px #22c55e' } : undefined}
      />
      {hovering && online && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 whitespace-nowrap rounded bg-slate-800 text-white text-[10px] px-2 py-1 shadow-lg text-center">
          {ms != null ? t('ui.serverMs', { ms }) : t('ui.serverMeasuring')}
          {uptime30d != null && <><br />{t('ui.uptime30', { value: uptime30d })}</>}
        </span>
      )}
    </span>
  );
}
