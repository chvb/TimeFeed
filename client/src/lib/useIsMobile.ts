import { useEffect, useState } from 'react';

// Erkennt mobile/Touch-Geräte (für Funktionen wie „Foto aufnehmen", die nur dort sinnvoll sind).
function detect(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const coarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  return uaMobile || (coarse && touch);
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(detect);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setIsMobile(detect());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return isMobile;
}
