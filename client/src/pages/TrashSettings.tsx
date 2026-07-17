import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { ArrowUturnLeftIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useConfirm } from '../components/common/ConfirmProvider';
import { useT } from '../i18n';
import SearchInput from '../components/common/SearchInput';
import Select from '../components/common/Select';
import { matchesSearch } from '../lib/normalize';

interface TrashEntry {
  id: number;
  entityType: string;
  typeLabel: string;
  label: string;
  deletedAt: string;
  daysRemaining: number;
}

export default function TrashSettings() {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortField, setSortField] = useState<string>('deletedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { confirm } = useConfirm();
  const t = useT();

  const load = () => {
    setLoading(true);
    api.get('/trash').then((r) => setItems(r.data.items || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const restore = async (it: TrashEntry) => {
    try {
      await api.post(`/trash/${it.id}/restore`);
      toast.success(t('trash.restored', { label: it.label }));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('trash.restoreFailed'));
    }
  };

  const remove = async (it: TrashEntry) => {
    if (!(await confirm({ title: t('trash.deleteTitle'), message: t('trash.deleteMessage', { label: it.label }), confirmText: t('trash.delete'), danger: true }))) return;
    try {
      await api.delete(`/trash/${it.id}`);
      load();
    } catch {
      toast.error(t('trash.deleteFailed'));
    }
  };

  const empty = async () => {
    if (!(await confirm({ title: t('trash.emptyTitle'), message: t('trash.emptyMessage'), confirmText: t('trash.emptyConfirm'), danger: true }))) return;
    try {
      await api.delete('/trash/all');
      toast.success(t('trash.emptied'));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('trash.emptyError'));
    }
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString('de-DE');

  const toggleSort = (f: string) => {
    setSortDir((prev) => (sortField === f ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortField(f);
  };
  const sortArrow = (f: string) => (sortField === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortVal = (it: TrashEntry): any => {
    switch (sortField) {
      case 'type': return (it.typeLabel || '').toLowerCase();
      case 'label': return (it.label || '').toLowerCase();
      case 'deletedAt': return new Date(it.deletedAt).getTime();
      case 'expires': return it.daysRemaining;
      default: return 0;
    }
  };

  const types = Array.from(new Set(items.map((i) => i.typeLabel))).sort();
  const filtered = items
    .filter((it) => (typeFilter ? it.typeLabel === typeFilter : true))
    .filter((it) => (query.trim() ? matchesSearch(`${it.label} ${it.typeLabel}`, query) : true))
    .sort((a, b) => {
      const av = sortVal(a); const bv = sortVal(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium text-slate-900 dark:text-white">{t('trash.title')}</h3>
          <p className="text-sm text-slate-600 dark:text-gray-400">
            {t('trash.description')}
          </p>
        </div>
        {items.length > 0 && (
          <button onClick={empty} className="btn-secondary whitespace-nowrap text-red-600">{t('trash.emptyBtn')}</button>
        )}
      </div>

      {!loading && items.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="w-full sm:w-64">
            <SearchInput value={query} onChange={setQuery} placeholder={t('trash.searchPlaceholder')} />
          </div>
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: '', label: t('trash.allTypes') },
              ...types.map((ty) => ({ value: ty, label: ty })),
            ]}
            className="sm:w-56"
          />
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-sm text-slate-500">{t('trash.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">{t('trash.empty')}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">{t('trash.noMatches')}</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-700">
                <th onClick={() => toggleSort('type')} className="py-2 pr-3 cursor-pointer select-none hover:text-slate-700">{t('trash.colType')}{sortArrow('type')}</th>
                <th onClick={() => toggleSort('label')} className="py-2 pr-3 cursor-pointer select-none hover:text-slate-700">{t('trash.colLabel')}{sortArrow('label')}</th>
                <th onClick={() => toggleSort('deletedAt')} className="py-2 pr-3 cursor-pointer select-none hover:text-slate-700">{t('trash.colDeletedAt')}{sortArrow('deletedAt')}</th>
                <th onClick={() => toggleSort('expires')} className="py-2 pr-3 cursor-pointer select-none hover:text-slate-700">{t('trash.colExpires')}{sortArrow('expires')}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
              {filtered.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-gray-800">
                  <td className="py-2 pr-3"><span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-xs">{it.typeLabel}</span></td>
                  <td className="py-2 pr-3 font-medium text-slate-800 dark:text-gray-200">{it.label}</td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-gray-400">{fmt(it.deletedAt)}</td>
                  <td className="py-2 pr-3">
                    <span className={it.daysRemaining <= 5 ? 'text-red-600 font-medium' : 'text-slate-600 dark:text-gray-400'}>
                      {it.daysRemaining === 1 ? t('trash.daysOne', { count: it.daysRemaining }) : t('trash.daysMany', { count: it.daysRemaining })}
                    </span>
                  </td>
                  <td className="py-2 whitespace-nowrap text-right">
                    <button onClick={() => restore(it)} title={t('trash.restore')} className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-gray-800 rounded inline-flex items-center gap-1">
                      <ArrowUturnLeftIcon className="h-5 w-5" />
                    </button>
                    <button onClick={() => remove(it)} title={t('trash.deletePermanently')} className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-gray-800 rounded">
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
