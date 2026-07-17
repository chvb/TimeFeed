import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, MapPinIcon } from '@heroicons/react/24/outline';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import api from '../../lib/api';
import { useT, useI18n } from '../../i18n';

// Read-only Karte der geolokalisierten Stempelungen eines Monats. Bewusst plain
// Leaflet (gebündelt, CSP-konform) wie LocationPicker; Marker als farbige DivIcons
// je Stempel-Typ. Wird nur beim Öffnen geladen (Lazy-Chunk inkl. Leaflet).
interface StampPoint {
  id: number;
  userId: number;
  name: string;
  type: 'in' | 'out' | 'break_start' | 'break_end';
  timestamp: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  source: string;
  terminalId: number | null;
}

interface Props {
  month: string;
  monthLabel: string;
  userId?: number;
  onClose: () => void;
}

// Farbe je Stempel-Typ (Kommen grün, Gehen rot, Pause bernstein).
const TYPE_COLOR: Record<StampPoint['type'], string> = {
  in: '#16a34a',
  out: '#dc2626',
  break_start: '#d97706',
  break_end: '#d97706',
};

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 20],
    popupAnchor: [0, -18],
  });
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export default function MonthLocationMap({ month, monthLabel, userId, onClose }: Props) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const [points, setPoints] = useState<StampPoint[] | null>(null);
  const [error, setError] = useState('');
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const typeLabel = useMemo(() => ({
    in: t('time.clockIn'),
    out: t('time.clockOut'),
    break_start: t('time.breakStart'),
    break_end: t('time.breakEnd'),
  }), [t]);

  const sourceLabel = useMemo<Record<string, string>>(() => (
    lang === 'en'
      ? { web: 'Web app', terminal: 'Terminal', manual: 'Manual', api: 'API', auto_cap: 'Auto cut-off' }
      : { web: 'Web-App', terminal: 'Terminal', manual: 'Nachbuchung', api: 'API', auto_cap: 'Auto-Kappung' }
  ), [lang]);

  // Stempelungen laden.
  useEffect(() => {
    let active = true;
    setPoints(null);
    setError('');
    api.get('/time/month-locations', { params: { month, ...(userId != null ? { userId } : {}) } })
      .then((r) => { if (active) setPoints(r.data.points || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || t('manage.mapLoadError')); })
      .finally(() => {});
    return () => { active = false; };
  }, [month, userId, t]);

  // Karte aufbauen, sobald Punkte da sind und der Dialog gerendert ist.
  useEffect(() => {
    if (!points || points.length === 0 || !mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Marker in eine Cluster-Gruppe legen: nahe beieinander liegende Stempelungen
    // (z. B. immer derselbe Standort) werden zu einer Blase zusammengefasst und beim
    // Reinzoomen aufgelöst.
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
    });
    const latlngs: [number, number][] = [];
    for (const p of points) {
      const acc = p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : '';
      const srcLabel = sourceLabel[p.source] || p.source;
      const d = new Date(p.timestamp);
      const time = d.toLocaleString(locale, {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      // Sichtbares Datums-Label am Marker (bei Clustern ausgeblendet, beim
      // Aufzoomen/Auffächern sichtbar). Format: TT.MM.
      const dateLabel = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
      cluster.addLayer(
        L.marker([p.lat, p.lng], { icon: pinIcon(TYPE_COLOR[p.type]) })
          .bindTooltip(esc(dateLabel), {
            permanent: true,
            direction: 'top',
            offset: [0, -18],
            className: 'stamp-date-tip',
          })
          .bindPopup(
            `<div style="font-size:12px;line-height:1.5">
              <strong>${esc(p.name)}</strong><br>
              ${esc(typeLabel[p.type])} · ${esc(time)}<br>
              <span style="color:#64748b">${esc(srcLabel)}${esc(acc)}</span>
            </div>`
          )
      );
      latlngs.push([p.lat, p.lng]);
    }
    map.addLayer(cluster);
    const bounds = L.latLngBounds(latlngs);
    if (latlngs.length === 1) map.setView(latlngs[0], 15);
    else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; };
  }, [points, locale, typeLabel, sourceLabel]);

  const legend = [
    { color: TYPE_COLOR.in, label: t('time.clockIn') },
    { color: TYPE_COLOR.out, label: t('time.clockOut') },
    { color: TYPE_COLOR.break_start, label: t('manage.mapLegendBreak') },
  ];

  return (
    <Transition appear show as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
            <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="w-full max-w-4xl rounded-xl bg-white dark:bg-gray-800 shadow-xl flex flex-col" style={{ height: '85vh' }}>
                <style>{`
                  .leaflet-tooltip.stamp-date-tip {
                    font-size: 10px; font-weight: 600; line-height: 1.2;
                    padding: 1px 5px; color: #334155;
                    background: rgba(255,255,255,.92); border: 1px solid #e2e8f0;
                    border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.2);
                  }
                  .leaflet-tooltip.stamp-date-tip::before { display: none; }
                `}</style>
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200 dark:border-gray-700">
                  <Dialog.Title className="text-base font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
                    <MapPinIcon className="h-5 w-5 text-primary-600" /> {t('manage.mapTitle')} · {monthLabel}
                  </Dialog.Title>
                  <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Legende + Anzahl */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-xs text-slate-500 dark:text-gray-400 border-b border-slate-100 dark:border-gray-700">
                  {legend.map((l) => (
                    <span key={l.label} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: l.color }} /> {l.label}
                    </span>
                  ))}
                  {points && <span className="ml-auto">{t('manage.mapCount', { count: points.length })}</span>}
                </div>

                <div className="relative flex-1 min-h-0">
                  {error ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-600">{error}</div>
                  ) : points === null ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">…</div>
                  ) : points.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-slate-500 dark:text-gray-400">
                      <MapPinIcon className="h-10 w-10 text-slate-300" />
                      <p className="text-sm">{t('manage.mapEmpty')}</p>
                    </div>
                  ) : (
                    <div ref={mapDivRef} className="absolute inset-0 rounded-b-xl overflow-hidden" />
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
