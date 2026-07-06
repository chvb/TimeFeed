import { useCallback, useEffect, useState } from 'react';
import { InboxIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../../lib/api';
import ErrorBanner from '../ErrorBanner';
import { useT, useI18n } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { CORRECTION_BADGE, CorrectionRow, proposedOf } from '../manage/CorrectionsAdminTab';

/** „Meine Korrekturanträge": Liste der eigenen Anträge mit Status und Entscheidungsnotiz. */
export default function MyCorrectionsList({ reloadKey }: { reloadKey: number }) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const userId = useAuthStore((s) => s.user?.id);
  const [items, setItems] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // userId mitgeben: Verwalter sehen sonst die Anträge ALLER erreichbaren Mitarbeiter.
      const r = await api.get('/corrections', { params: userId ? { userId } : {} });
      setItems(r.data.corrections || []);
      setLoadError('');
    } catch {
      setLoadError(t('corrections.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t, userId]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={load} />
      {items.length === 0 ? (
        <div className="card text-center py-12">
          <InboxIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400">{t('corrections.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => {
            const proposed = proposedOf(c);
            return (
              <div key={c.id} className="card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-gray-100">{fmtDate(c.date)}</span>
                  <span className={clsx('status-badge', CORRECTION_BADGE[c.status] || 'bg-slate-100 text-slate-700')}>
                    {t(`corrections.status.${c.status}`)}
                  </span>
                  {c.createdAt && (
                    <span className="text-xs text-slate-400">
                      {t('corrections.requestedAt')} {new Date(c.createdAt).toLocaleDateString(locale)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-slate-700 dark:text-gray-300 whitespace-pre-line">{c.message || c.reason || ''}</p>
                {proposed.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {proposed.map((p, i) => (
                      <li key={i} className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 tabular-nums">
                        {t(`time.entryType.${p.type}`)} {p.time}
                      </li>
                    ))}
                  </ul>
                )}
                {c.status !== 'pending' && c.decisionNote && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-gray-400">
                    {t('corrections.decisionNote')}: {c.decisionNote}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
