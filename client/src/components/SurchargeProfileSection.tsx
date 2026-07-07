import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  MoonIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '../lib/api';
import ErrorBanner from './ErrorBanner';
import { useConfirm } from './common/ConfirmProvider';
import { useT } from '../i18n';

// ---- Contract — Feldnamen exakt wie server/src/models/SurchargeProfile.ts ----

export interface SurchargeWindowDto {
  from: string;   // 'HH:MM'
  to: string;     // 'HH:MM' — to <= from = über Mitternacht
  lohnart: string;
  percent: number;
  label: string;
}

export interface SurchargeProfileDto {
  id: number;
  name: string;
  isActive: boolean;
  windows: SurchargeWindowDto[];
}

interface WindowForm {
  from: string;
  to: string;
  lohnart: string;
  percent: string; // Eingabe als String, wird beim Speichern geparst
  label: string;
}

interface FormState {
  name: string;
  isActive: boolean;
  windows: WindowForm[];
}

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const emptyWindow = (): WindowForm => ({ from: '20:00', to: '06:00', lohnart: '', percent: '25', label: '' });

const emptyForm = (): FormState => ({ name: '', isActive: true, windows: [emptyWindow()] });

/** Kompakte Fenster-Zusammenfassung für Tabelle/Karten (z. B. „20:00–06:00 · 1010 · 25 %"). */
const windowSummary = (w: SurchargeWindowDto) => `${w.from}–${w.to} · ${w.lohnart} · ${w.percent} %`;

/**
 * Zuschlagsprofile (nur Admin): CRUD gegen /api/surcharge-profiles mit
 * Fenster-Editor — eigener Abschnitt auf der Seite „Zeitmodelle", konsistent
 * zu deren Tabelle/Karten-Stil (responsive: Desktop-Tabelle, Mobile-Cards).
 */
export default function SurchargeProfileSection() {
  const t = useT();
  const { confirm } = useConfirm();
  const [profiles, setProfiles] = useState<SurchargeProfileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SurchargeProfileDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/surcharge-profiles');
      setProfiles(r.data.surchargeProfiles || []);
      setLoadError('');
    } catch (error) {
      console.error('Error loading surcharge profiles:', error);
      setLoadError(t('surcharges.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };

  const openEdit = (p: SurchargeProfileDto) => {
    setEditing(p);
    setForm({
      name: p.name,
      isActive: p.isActive,
      windows: (p.windows || []).map((w) => ({
        from: w.from, to: w.to, lohnart: w.lohnart, percent: String(w.percent ?? 0), label: w.label || '',
      })),
    });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditing(null); };

  const setWindow = (i: number, patch: Partial<WindowForm>) => {
    setForm((f) => ({ ...f, windows: f.windows.map((w, wi) => (wi === i ? { ...w, ...patch } : w)) }));
  };

  const addWindow = () => setForm((f) => ({ ...f, windows: [...f.windows, emptyWindow()] }));
  const removeWindow = (i: number) => setForm((f) => ({ ...f, windows: f.windows.filter((_, wi) => wi !== i) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (form.windows.length === 0) {
      toast.error(t('surcharges.needWindow'));
      return;
    }
    const windows: SurchargeWindowDto[] = [];
    for (let i = 0; i < form.windows.length; i++) {
      const w = form.windows[i];
      const percent = Number(String(w.percent).replace(',', '.'));
      if (!HHMM_RE.test(w.from.trim()) || !HHMM_RE.test(w.to.trim()) || !w.lohnart.trim() || !Number.isFinite(percent)) {
        toast.error(t('surcharges.invalidWindow', { index: i + 1 }));
        return;
      }
      windows.push({ from: w.from.trim(), to: w.to.trim(), lohnart: w.lohnart.trim(), percent, label: w.label.trim() });
    }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), isActive: form.isActive, windows };
      if (editing) {
        await api.put(`/surcharge-profiles/${editing.id}`, payload);
      } else {
        await api.post('/surcharge-profiles', payload);
      }
      toast.success(t('surcharges.saved'));
      closeModal();
      load();
    } catch (error: any) {
      console.error('Error saving surcharge profile:', error);
      const d = error?.response?.data;
      toast.error(d?.errors?.[0]?.msg || d?.message || d?.error || t('surcharges.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: SurchargeProfileDto) => {
    if (!(await confirm({ title: t('surcharges.deleteTitle'), message: t('surcharges.deleteMessage'), confirmText: t('surcharges.delete'), danger: true }))) return;
    try {
      await api.delete(`/surcharge-profiles/${p.id}`);
      toast.success(t('surcharges.deleted'));
      load();
    } catch (error: any) {
      console.error('Error deleting surcharge profile:', error);
      toast.error(error?.response?.data?.message || error?.response?.data?.error || t('surcharges.deleteError'));
    }
  };

  /** Läuft ein Formular-Fenster über Mitternacht? (bis <= von) */
  const spansMidnight = (w: WindowForm) =>
    HHMM_RE.test(w.from.trim()) && HHMM_RE.test(w.to.trim()) && w.to.trim() <= w.from.trim();

  return (
    <div className="mt-10">
      <ErrorBanner message={loadError} onRetry={load} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('surcharges.title')}</h2>
        <button onClick={openCreate} className="btn-primary flex items-center space-x-2">
          <PlusIcon className="h-5 w-5" />
          <span>{t('surcharges.add')}</span>
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-gray-400 mb-4">{t('surcharges.subtitle')}</p>

      {loading ? (
        <div className="card">
          <div className="animate-pulse space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />)}
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="card text-center py-12">
          <MoonIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400 mb-4">{t('surcharges.empty')}</p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center">
            <PlusIcon className="h-4 w-4 mr-2" /> {t('surcharges.addFirst')}
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('surcharges.colName')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('surcharges.colWindows')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('surcharges.colStatus')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('surcharges.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {profiles.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">{p.name}</td>
                      <td className="px-6 py-4 text-sm tabular-nums text-slate-700 dark:text-gray-300">
                        {(p.windows || []).length === 0
                          ? t('surcharges.windowCount', { count: 0 })
                          : (p.windows || []).map((w, i) => (
                            <span key={i} className="block whitespace-nowrap">
                              {w.label ? `${w.label}: ` : ''}{windowSummary(w)}
                            </span>
                          ))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx('status-badge', p.isActive ? 'status-approved' : 'status-rejected')}>
                          {p.isActive ? t('surcharges.active') : t('surcharges.inactive')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => openEdit(p)} className="text-primary-600 hover:text-primary-900 dark:text-primary-400" title={t('surcharges.editTitle')}>
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(p)} className="text-red-600 hover:text-red-900 dark:text-red-400" title={t('surcharges.deleteTitle')}>
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
            {profiles.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-gray-100">{p.name}</p>
                    {(p.windows || []).map((w, i) => (
                      <p key={i} className="text-sm tabular-nums text-slate-600 dark:text-gray-400">
                        {w.label ? `${w.label}: ` : ''}{windowSummary(w)}
                      </p>
                    ))}
                  </div>
                  <span className={clsx('status-badge', p.isActive ? 'status-approved' : 'status-rejected')}>
                    {p.isActive ? t('surcharges.active') : t('surcharges.inactive')}
                  </span>
                </div>
                <div className="mt-3 flex justify-end gap-3">
                  <button onClick={() => openEdit(p)} className="text-primary-600 flex items-center gap-1 text-sm">
                    <PencilIcon className="h-4 w-4" /> {t('common.edit')}
                  </button>
                  <button onClick={() => handleDelete(p)} className="text-red-600 flex items-center gap-1 text-sm">
                    <TrashIcon className="h-4 w-4" /> {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal: Anlegen/Bearbeiten */}
      <Transition appear show={showModal} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeModal}>
          <Transition.Child as={React.Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full justify-center p-4 pt-16">
              <Dialog.Panel className="relative mx-4 p-5 border w-full md:w-3/4 lg:w-2/3 max-h-[90vh] overflow-y-auto shadow-lg rounded-md bg-white">
                <div className="absolute top-3 right-3">
                  <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded-full transition-colors" title={t('surcharges.close')}>
                    <XMarkIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
                  </button>
                </div>
                <div className="mt-3">
                  <h3 className="text-lg font-medium text-slate-900 mb-4">
                    {editing ? t('surcharges.editTitle') : t('surcharges.addTitle')}
                  </h3>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('surcharges.name')}</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="input-field"
                        placeholder={t('surcharges.namePlaceholder')}
                      />
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm font-medium text-slate-700 mb-1">{t('surcharges.windowsTitle')}</p>
                      <p className="text-xs text-slate-400 mb-3">{t('surcharges.windowsHint')}</p>

                      {form.windows.length === 0 && (
                        <p className="text-sm text-slate-500 mb-3">{t('surcharges.windowsEmpty')}</p>
                      )}

                      <div className="space-y-3">
                        {form.windows.map((w, i) => (
                          <div key={i} className="rounded-md border border-slate-200 p-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
                              <div>
                                <label className="block text-sm text-slate-600 mb-1">{t('surcharges.from')}</label>
                                <input
                                  type="time"
                                  required
                                  value={w.from}
                                  onChange={(e) => setWindow(i, { from: e.target.value })}
                                  className="input-field tabular-nums"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-slate-600 mb-1">{t('surcharges.to')}</label>
                                <input
                                  type="time"
                                  required
                                  value={w.to}
                                  onChange={(e) => setWindow(i, { to: e.target.value })}
                                  className="input-field tabular-nums"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-slate-600 mb-1">{t('surcharges.lohnart')}</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  required
                                  value={w.lohnart}
                                  onChange={(e) => setWindow(i, { lohnart: e.target.value })}
                                  className="input-field tabular-nums"
                                  placeholder="1010"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-slate-600 mb-1">{t('surcharges.percent')}</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={1000}
                                  step="0.1"
                                  value={w.percent}
                                  onChange={(e) => setWindow(i, { percent: e.target.value })}
                                  className="input-field tabular-nums"
                                  placeholder="25"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-slate-600 mb-1">{t('surcharges.label')}</label>
                                <input
                                  type="text"
                                  value={w.label}
                                  onChange={(e) => setWindow(i, { label: e.target.value })}
                                  className="input-field"
                                  placeholder={t('surcharges.labelPlaceholder')}
                                />
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-xs text-slate-400">
                                {spansMidnight(w) ? t('surcharges.overMidnight') : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeWindow(i)}
                                className="text-red-600 hover:text-red-800 flex items-center gap-1 text-sm"
                                title={t('surcharges.removeWindow')}
                              >
                                <TrashIcon className="h-4 w-4" /> {t('surcharges.removeWindow')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={addWindow}
                        className="btn-secondary mt-3 inline-flex items-center gap-1"
                      >
                        <PlusIcon className="h-4 w-4" /> {t('surcharges.addWindow')}
                      </button>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <span className="text-sm font-medium text-slate-700">{t('surcharges.isActive')}</span>
                      </label>
                      <p className="text-xs text-slate-400 mt-1">{t('surcharges.isActiveHint')}</p>
                    </div>

                    <div className="flex justify-end space-x-3 pt-2">
                      <button type="button" onClick={closeModal} className="btn-secondary">{t('surcharges.cancel')}</button>
                      <button type="submit" disabled={saving} className="btn-primary">
                        {saving ? t('surcharges.saving') : (editing ? t('surcharges.save') : t('surcharges.addBtn'))}
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
