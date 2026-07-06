import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, InboxIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import ErrorBanner from '../ErrorBanner';
import { useT, useI18n } from '../../i18n';
import { useConfirm } from '../common/ConfirmProvider';

export interface CorrectionRow {
  id: number;
  userId: number;
  date: string;
  message?: string | null;
  reason?: string | null;
  proposedEntries?: { type: string; time: string }[] | null;
  requestedChanges?: { type: string; time: string }[] | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  decisionNote?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  user?: { id: number; firstName?: string; lastName?: string } | null;
  decidedBy?: { firstName?: string; lastName?: string } | null;
}

export const CORRECTION_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

/** Vorgeschlagene Stempelungen eines Antrags (aus proposedEntries bzw. requestedChanges). */
export function proposedOf(c: CorrectionRow): { type: string; time: string }[] {
  const raw = c.proposedEntries ?? c.requestedChanges;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

/** Verwalter-Reiter „Korrekturanträge": Filter offen/alle, Genehmigen/Ablehnen. */
export default function CorrectionsAdminTab({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const { promptInput } = useConfirm();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [items, setItems] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // Verwalter sehen automatisch alle erreichbaren Mitarbeiter (accessScope, Server).
      const params: any = {};
      if (filter === 'open') params.status = 'pending';
      const r = await api.get('/corrections', { params });
      setItems(r.data.corrections || []);
      setLoadError('');
    } catch {
      setLoadError(t('corrections.loadError'));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

  const approve = async (c: CorrectionRow) => {
    const note = await promptInput({
      title: t('corrections.approveNoteTitle'),
      message: t('corrections.approveNoteMessage'),
      placeholder: t('corrections.approveNotePlaceholder'),
    });
    if (note === null) return;
    try {
      await api.post(`/corrections/${c.id}/approve`, note.trim() ? { note: note.trim() } : {});
      toast.success(t('corrections.approveSuccess'));
      load();
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('corrections.approveError'));
    }
  };

  const reject = async (c: CorrectionRow) => {
    const note = await promptInput({
      title: t('corrections.rejectNoteTitle'),
      message: t('corrections.rejectNoteMessage'),
      placeholder: t('corrections.rejectNotePlaceholder'),
      required: true,
    });
    if (note === null || !note.trim()) return;
    try {
      await api.post(`/corrections/${c.id}/reject`, { note: note.trim() });
      toast.success(t('corrections.rejectSuccess'));
      load();
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('corrections.rejectError'));
    }
  };

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={load} />

      {/* Filter offen/alle */}
      <div className="mb-4 inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors',
              filter === f ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-300 hover:bg-slate-50'
            )}
          >
            {t(f === 'open' ? 'corrections.filterOpen' : 'corrections.filterAll')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card">
          <div className="animate-pulse space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-12">
          <InboxIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400">{t('corrections.adminEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => {
            const proposed = proposedOf(c);
            const name = c.user ? `${c.user.firstName || ''} ${c.user.lastName || ''}`.trim() : `#${c.userId}`;
            return (
              <div key={c.id} className="card">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-gray-100">{name}</span>
                      <span className="text-sm text-slate-500 dark:text-gray-400">{fmtDate(c.date)}</span>
                      <span className={clsx('status-badge', CORRECTION_BADGE[c.status] || 'bg-slate-100 text-slate-700')}>
                        {t(`corrections.status.${c.status}`)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700 dark:text-gray-300 whitespace-pre-line">{c.message || c.reason || ''}</p>
                    <div className="mt-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-gray-400 mb-1">{t('corrections.proposedLabel')}</p>
                      {proposed.length === 0 ? (
                        <p className="text-xs text-slate-400">{t('corrections.noProposed')}</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {proposed.map((p, i) => (
                            <li key={i} className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 tabular-nums">
                              {t(`time.entryType.${p.type}`)} {p.time}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {c.status !== 'pending' && c.decisionNote && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-gray-400">
                        {t('corrections.decisionNote')}: {c.decisionNote}
                        {c.decidedBy && ` · ${t('corrections.decidedBy')} ${c.decidedBy.firstName || ''} ${c.decidedBy.lastName || ''}`.trimEnd()}
                      </p>
                    )}
                  </div>
                  {c.status === 'pending' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button type="button" onClick={() => approve(c)} className="btn-primary inline-flex items-center gap-1.5 text-sm">
                        <CheckIcon className="h-4 w-4" /> {t('corrections.approve')}
                      </button>
                      <button type="button" onClick={() => reject(c)} className="btn-secondary inline-flex items-center gap-1.5 text-sm text-red-600">
                        <XMarkIcon className="h-4 w-4" /> {t('corrections.reject')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
