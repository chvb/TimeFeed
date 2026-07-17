import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  AdjustmentsHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SurchargeProfileSection from '../components/SurchargeProfileSection';
import { useConfirm } from '../components/common/ConfirmProvider';
import Select from '../components/common/Select';
import { useAuthStore } from '../store/authStore';
import { useT } from '../i18n';
import { formatMinutes, hhmmToMinutes, minutesToHHMMInput } from '../lib/timeFormat';

type RoundingMode = 'none' | 'up' | 'down' | 'nearest';

const DAY_FIELDS = ['monMinutes', 'tueMinutes', 'wedMinutes', 'thuMinutes', 'friMinutes', 'satMinutes', 'sunMinutes'] as const;
type DayField = typeof DAY_FIELDS[number];
const DAY_KEYS: Record<DayField, string> = {
  monMinutes: 'mon', tueMinutes: 'tue', wedMinutes: 'wed', thuMinutes: 'thu',
  friMinutes: 'fri', satMinutes: 'sat', sunMinutes: 'sun',
};
const ROUNDING_STEPS = [5, 10, 15];

interface TimeModelDto {
  id: number;
  name: string;
  isActive: boolean;
  monMinutes: number;
  tueMinutes: number;
  wedMinutes: number;
  thuMinutes: number;
  friMinutes: number;
  satMinutes: number;
  sunMinutes: number;
  roundingMode: RoundingMode;
  roundingMinutes: number;
}

interface FormState {
  name: string;
  isActive: boolean;
  days: Record<DayField, string>; // HH:MM-Eingaben
  roundingMode: RoundingMode;
  roundingMinutes: number;
}

const emptyForm = (): FormState => ({
  name: '',
  isActive: true,
  days: {
    monMinutes: '08:00', tueMinutes: '08:00', wedMinutes: '08:00', thuMinutes: '08:00',
    friMinutes: '08:00', satMinutes: '00:00', sunMinutes: '00:00',
  },
  roundingMode: 'none',
  roundingMinutes: 5,
});

const weekSum = (m: TimeModelDto) => DAY_FIELDS.reduce((s, f) => s + (m[f] || 0), 0);

/** Zeitmodelle (nur Admin): CRUD gegen /api/time-models. */
export default function TimeModels() {
  const { user } = useAuthStore();
  const t = useT();
  const { confirm } = useConfirm();
  const [models, setModels] = useState<TimeModelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TimeModelDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/time-models');
      const list = r.data.timeModels || r.data.models || (Array.isArray(r.data) ? r.data : []);
      setModels(list);
      setLoadError('');
    } catch (error) {
      console.error('Error loading time models:', error);
      setLoadError(t('timeModels.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };

  const openEdit = (m: TimeModelDto) => {
    setEditing(m);
    setForm({
      name: m.name,
      isActive: m.isActive,
      days: DAY_FIELDS.reduce((acc, f) => ({ ...acc, [f]: minutesToHHMMInput(m[f] || 0) }), {} as Record<DayField, string>),
      roundingMode: m.roundingMode || 'none',
      roundingMinutes: ROUNDING_STEPS.includes(m.roundingMinutes) ? m.roundingMinutes : 5,
    });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditing(null); };

  /** Aktuelle Formular-Wochensumme (nur gültige Eingaben). */
  const formWeekSum = DAY_FIELDS.reduce((s, f) => s + (hhmmToMinutes(form.days[f]) ?? 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      isActive: form.isActive,
      roundingMode: form.roundingMode,
      roundingMinutes: form.roundingMode === 'none' ? 0 : form.roundingMinutes,
    };
    for (const f of DAY_FIELDS) {
      const minutes = hhmmToMinutes(form.days[f]);
      if (minutes == null) {
        toast.error(t('timeModels.invalidTime', { value: form.days[f] }));
        return;
      }
      payload[f] = minutes;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/time-models/${editing.id}`, payload);
      } else {
        await api.post('/time-models', payload);
      }
      toast.success(t('timeModels.saved'));
      closeModal();
      load();
    } catch (error: any) {
      console.error('Error saving time model:', error);
      const d = error?.response?.data;
      toast.error(d?.errors?.[0]?.msg || d?.message || d?.error || t('timeModels.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: TimeModelDto) => {
    if (!(await confirm({ title: t('timeModels.deleteTitle'), message: t('timeModels.deleteMessage'), confirmText: t('timeModels.delete'), danger: true }))) return;
    try {
      await api.delete(`/time-models/${m.id}`);
      toast.success(t('timeModels.deleted'));
      load();
    } catch (error: any) {
      console.error('Error deleting time model:', error);
      toast.error(error?.response?.data?.message || error?.response?.data?.error || t('timeModels.deleteError'));
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">{t('timeModels.title')}</h1>
        <div className="card text-center">
          <ShieldCheckIcon className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{t('timeModels.accessDeniedTitle')}</h3>
          <p className="text-slate-600 dark:text-gray-400">{t('timeModels.accessDeniedText')}</p>
        </div>
      </div>
    );
  }

  const roundingLabel = (m: TimeModelDto) =>
    m.roundingMode === 'none' || !m.roundingMinutes
      ? t('timeModels.roundingMode.none')
      : `${t(`timeModels.roundingMode.${m.roundingMode}`)} · ${t('timeModels.roundingStepMinutes', { count: m.roundingMinutes })}`;

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={load} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('timeModels.title')}</h1>
        <button onClick={openCreate} className="btn-primary flex items-center space-x-2">
          <PlusIcon className="h-5 w-5" />
          <span>{t('timeModels.add')}</span>
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-gray-400 mb-4">{t('timeModels.subtitle')}</p>

      {loading ? (
        <div className="card">
          <div className="animate-pulse space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />)}
          </div>
        </div>
      ) : models.length === 0 ? (
        <div className="card text-center py-12">
          <AdjustmentsHorizontalIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400 mb-4">{t('timeModels.empty')}</p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center">
            <PlusIcon className="h-4 w-4 mr-2" /> {t('timeModels.addFirst')}
          </button>
        </div>
      ) : (
        <>
          {/* Desktop-Tabelle */}
          <div className="card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('timeModels.colName')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('timeModels.colWeekSum')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('timeModels.colRounding')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('timeModels.colStatus')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('timeModels.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {models.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">{m.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm tabular-nums text-slate-700 dark:text-gray-300">{formatMinutes(weekSum(m))}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-gray-300">{roundingLabel(m)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx('status-badge', m.isActive ? 'status-approved' : 'status-rejected')}>
                          {m.isActive ? t('timeModels.active') : t('timeModels.inactive')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => openEdit(m)} className="text-primary-600 hover:text-primary-900 dark:text-primary-400" title={t('timeModels.editTitle')}>
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(m)} className="text-red-600 hover:text-red-900 dark:text-red-400" title={t('timeModels.deleteTitle')}>
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: Card-Liste */}
          <div className="md:hidden space-y-3">
            {models.map((m) => (
              <div key={m.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-gray-100">{m.name}</p>
                    <p className="text-sm tabular-nums text-slate-600 dark:text-gray-400">{t('timeModels.colWeekSum')}: {formatMinutes(weekSum(m))}</p>
                    <p className="text-sm text-slate-600 dark:text-gray-400">{roundingLabel(m)}</p>
                  </div>
                  <span className={clsx('status-badge', m.isActive ? 'status-approved' : 'status-rejected')}>
                    {m.isActive ? t('timeModels.active') : t('timeModels.inactive')}
                  </span>
                </div>
                <div className="mt-3 flex justify-end gap-3">
                  <button onClick={() => openEdit(m)} className="text-primary-600 flex items-center gap-1 text-sm">
                    <PencilIcon className="h-4 w-4" /> {t('common.edit')}
                  </button>
                  <button onClick={() => handleDelete(m)} className="text-red-600 flex items-center gap-1 text-sm">
                    <TrashIcon className="h-4 w-4" /> {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Zuschlagsprofile (Nachtarbeit u. ä.) — zweiter Abschnitt der Seite. */}
      <SurchargeProfileSection />

      {/* Modal: Anlegen/Bearbeiten */}
      <Transition appear show={showModal} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeModal}>
          <Transition.Child as={React.Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full justify-center p-4 pt-16">
              <Dialog.Panel className="relative mx-4 p-5 border w-full md:w-2/3 lg:w-1/2 max-h-[90vh] overflow-y-auto shadow-lg rounded-md bg-white">
                <div className="absolute top-3 right-3">
                  <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded-full transition-colors" title={t('timeModels.close')}>
                    <XMarkIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
                  </button>
                </div>
                <div className="mt-3">
                  <h3 className="text-lg font-medium text-slate-900 mb-4">
                    {editing ? t('timeModels.editTitle') : t('timeModels.addTitle')}
                  </h3>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('timeModels.name')}</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="input-field"
                        placeholder={t('timeModels.namePlaceholder')}
                      />
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm font-medium text-slate-700 mb-1">{t('timeModels.weekPlan')}</p>
                      <p className="text-xs text-slate-400 mb-3">{t('timeModels.weekPlanHint')}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {DAY_FIELDS.map((f) => (
                          <div key={f}>
                            <label className="block text-sm text-slate-600 mb-1">{t(`timeModels.day.${DAY_KEYS[f]}`)}</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="\d{1,2}:[0-5]\d"
                              placeholder="08:00"
                              value={form.days[f]}
                              onChange={(e) => setForm({ ...form, days: { ...form.days, [f]: e.target.value } })}
                              className={clsx('input-field tabular-nums', hhmmToMinutes(form.days[f]) == null && 'border-red-400')}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-sm font-medium text-slate-700 tabular-nums">
                        {t('timeModels.weekSum', { sum: formatMinutes(formWeekSum) })}
                      </p>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm font-medium text-slate-700 mb-3">{t('timeModels.rounding')}</p>
                      <div className="flex flex-wrap gap-4">
                        <Select
                          value={form.roundingMode}
                          onChange={(v) => setForm({ ...form, roundingMode: v as RoundingMode })}
                          options={(['none', 'up', 'down', 'nearest'] as RoundingMode[]).map((mode) => ({ value: mode, label: t(`timeModels.roundingMode.${mode}`) }))}
                          className="w-56"
                        />
                        {form.roundingMode !== 'none' && (
                          <div className="flex items-center gap-2">
                            <label className="text-sm text-slate-600">{t('timeModels.roundingStep')}</label>
                            <Select
                              value={String(form.roundingMinutes)}
                              onChange={(v) => setForm({ ...form, roundingMinutes: parseInt(v) })}
                              options={ROUNDING_STEPS.map((s) => ({ value: String(s), label: t('timeModels.roundingStepMinutes', { count: s }) }))}
                              className="w-40"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <span className="text-sm font-medium text-slate-700">{t('timeModels.isActive')}</span>
                      </label>
                      <p className="text-xs text-slate-400 mt-1">{t('timeModels.isActiveHint')}</p>
                    </div>

                    <div className="flex justify-end space-x-3 pt-2">
                      <button type="button" onClick={closeModal} className="btn-secondary">{t('timeModels.cancel')}</button>
                      <button type="submit" disabled={saving} className="btn-primary">
                        {saving ? t('timeModels.saving') : (editing ? t('timeModels.save') : t('timeModels.addBtn'))}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
