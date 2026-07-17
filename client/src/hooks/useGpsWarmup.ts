import { useCallback, useEffect, useRef } from 'react';

/**
 * „Vorwärmen" des GPS-Fix: Sobald der GPS-Modus bekannt ist (und nicht 'off'), startet ein
 * kontinuierliches watchPosition im Hintergrund und merkt sich fortlaufend die BESTE (genaueste)
 * Position. Beim Stempeln liefert getBestPosition() dann sofort diesen vorgewärmten Fix – sofern
 * er frisch genug und (bei GPS-Pflicht) genau genug ist –, sonst wird ein frischer Fix geholt.
 * So liegt beim Antippen bereits ein Satelliten-genauer Standort vor, statt erst kalt zu starten.
 */
export function useGpsWarmup(gpsMode: string | undefined) {
  const bestRef = useRef<GeolocationPosition | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!gpsMode || gpsMode === 'off') return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const cur = bestRef.current;
        // Übernehmen, wenn genauer als bisher ODER die bisherige Position veraltet ist.
        if (!cur || pos.coords.accuracy <= cur.coords.accuracy || pos.timestamp - cur.timestamp > 15000) {
          bestRef.current = pos;
        }
      },
      () => { /* Ablehnung/Fehler ignorieren – Fallback erfolgt beim Stempeln */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    watchIdRef.current = id;
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [gpsMode]);

  /**
   * Liefert die beste verfügbare Position. `strict` (GPS-Pflicht) verlangt einen frischen und
   * – falls maxAccuracy gesetzt – hinreichend genauen Fix; der vorgewärmte Wert wird genutzt,
   * wenn er passt, sonst wird live nachgeholt.
   */
  const getBestPosition = useCallback((strict = false, maxAccuracy?: number): Promise<GeolocationPosition | null> => {
    return new Promise((resolve) => {
      const warm = bestRef.current;
      const fresh = warm ? Date.now() - warm.timestamp < 30000 : false;
      const accurateEnough = warm ? (maxAccuracy == null || warm.coords.accuracy <= maxAccuracy) : false;
      if (warm && fresh && (!strict || accurateEnough)) { resolve(warm); return; }
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(warm); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => { bestRef.current = pos; resolve(pos); },
        () => resolve(warm), // Fallback: der vorgewärmte (evtl. nicht ganz frische) Fix, falls vorhanden
        { enableHighAccuracy: true, timeout: strict ? 10000 : 3000, maximumAge: strict ? 0 : 60000 }
      );
    });
  }, []);

  return getBestPosition;
}
