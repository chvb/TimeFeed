import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useT } from '../../i18n';

/**
 * Standort-Wahl mit Adresssuche (Nominatim/OSM) und verschiebbarem Marker.
 * Bewusst plain Leaflet (gebündelt, CSP-konform): Karte wird erst beim
 * Aufklappen initialisiert (Leaflet braucht einen sichtbaren Container).
 * Marker als DivIcon in Markenfarbe — umgeht die Bundler-Probleme mit den
 * Standard-Icon-Assets von Leaflet.
 */
interface Props {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER: [number, number] = [51.1657, 10.4515]; // Deutschland
const PIN_ICON = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#ea580c;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

export default function LocationPicker({ lat, lng, onChange }: Props) {
  const t = useT();
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const placeMarker = (la: number, ln: number, pan = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([la, ln], { draggable: true, icon: PIN_ICON }).addTo(map);
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLatLng();
        onChangeRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
      });
    } else {
      markerRef.current.setLatLng([la, ln]);
    }
    if (pan) map.setView([la, ln], Math.max(map.getZoom(), 15));
  };

  // Karte initialisieren (Container ist beim Mount sichtbar, da die Komponente
  // nur im aufgeklappten Zustand gerendert wird).
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const start: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
    const map = L.map(mapDivRef.current).setView(start, lat != null ? 15 : 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      placeMarker(e.latlng.lat, e.latlng.lng, false);
      onChangeRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
    mapRef.current = map;
    if (lat != null && lng != null) placeMarker(lat, lng, false);
    // Nach dem Aufklappen die Größe neu bestimmen (Dialog-Animationen).
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Externe Koordinaten-Änderungen (manuelle Eingabe in den Feldern) übernehmen.
  useEffect(() => {
    if (lat != null && lng != null && mapRef.current) placeMarker(lat, lng, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const search = async () => {
    const q = address.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const la = Number(data[0].lat);
        const ln = Number(data[0].lon);
        placeMarker(la, ln);
        onChangeRef.current(Number(la.toFixed(6)), Number(ln.toFixed(6)));
      } else {
        setSearchError(t('terminals.addressNotFound'));
      }
    } catch {
      setSearchError(t('terminals.addressSearchError'));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder={t('terminals.addressPlaceholder')}
          className="input-field flex-1"
        />
        <button type="button" onClick={search} disabled={searching || !address.trim()} className="btn-secondary flex items-center gap-1.5 flex-shrink-0">
          <MagnifyingGlassIcon className="h-4 w-4" /> {searching ? t('terminals.addressSearching') : t('terminals.addressSearch')}
        </button>
      </div>
      {searchError && <p className="text-xs text-red-600">{searchError}</p>}
      <div ref={mapDivRef} className="h-64 w-full rounded-lg border border-slate-200 overflow-hidden z-0" />
      <p className="text-xs text-slate-500">{t('terminals.mapHint')}</p>
    </div>
  );
}
