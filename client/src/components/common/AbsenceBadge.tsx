import clsx from 'clsx';
import { useT } from '../../i18n';

// Einheitliche Farbchips für Abwesenheiten: Urlaub blau, Krank violett, Feiertag grün.
const ABSENCE_BADGE: Record<string, string> = {
  vacation: 'bg-blue-100 text-blue-800',
  sick: 'bg-violet-100 text-violet-800',
  holiday: 'bg-green-100 text-green-800',
};

/** Farbiger Chip für WorkDay.absence ('vacation' | 'sick' | 'holiday'). */
export default function AbsenceBadge({ absence }: { absence?: string | null }) {
  const t = useT();
  if (!absence) return null;
  const key = `time.absence.${absence}`;
  const label = t(key) !== key ? t(key) : absence;
  return (
    <span className={clsx('status-badge', ABSENCE_BADGE[absence] || 'bg-primary-100 text-primary-800')}>
      {label}
    </span>
  );
}
