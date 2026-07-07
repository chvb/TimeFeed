import clsx from 'clsx';
import { useT } from '../../i18n';
import { useAbsenceTypes } from '../../hooks/useAbsenceTypes';

// Fallback-Farbchips (bisheriges Verhalten), wenn der Katalog (noch) keinen
// Eintrag liefert: Urlaub blau, Krank violett, Feiertag grün.
const ABSENCE_BADGE: Record<string, string> = {
  vacation: 'bg-blue-100 text-blue-800',
  sick: 'bg-violet-100 text-violet-800',
  holiday: 'bg-green-100 text-green-800',
};

/**
 * Farbiger Chip für WorkDay.absence — Label und Farbe kommen aus dem
 * Abwesenheitsarten-Katalog (/api/absence-types); 'holiday' bleibt Sonderwert
 * (Feiertag, i18n). Fallback: bisherige feste Farben bzw. der rohe Key.
 */
export default function AbsenceBadge({ absence }: { absence?: string | null }) {
  const t = useT();
  const { types } = useAbsenceTypes();
  if (!absence) return null;

  const catalog = absence === 'holiday' ? undefined : types.find((x) => x.key === absence);
  const key = `time.absence.${absence}`;
  const label = catalog?.label || (t(key) !== key ? t(key) : absence);

  if (catalog?.color) {
    // Katalog-Farbe: dezenter Hintergrund (Hex + Alpha), kräftige Schrift.
    return (
      <span
        className="status-badge"
        style={{ backgroundColor: `${catalog.color}26`, color: catalog.color }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className={clsx('status-badge', ABSENCE_BADGE[absence] || 'bg-primary-100 text-primary-800')}>
      {label}
    </span>
  );
}
