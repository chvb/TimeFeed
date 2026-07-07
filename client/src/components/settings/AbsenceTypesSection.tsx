import React, { useState } from 'react';
import { PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '../../lib/api';
import { useT } from '../../i18n';
import { useConfirm } from '../common/ConfirmProvider';
import { AbsenceTypeItem, absenceTypePalette, useAbsenceTypes } from '../../hooks/useAbsenceTypes';

interface FormState {
  id: number | null; // null = neu
  key: string;
  label: string;
  color: string;
  datevKennzeichen: string;
  isBuiltin: boolean;
}

const EMPTY: FormState = { id: null, key: '', label: '', color: '#2563eb', datevKennzeichen: '1', isBuiltin: false };

/**
 * Einstellungen → Zeiterfassung → „Abwesenheitsarten": Katalog-Tabelle
 * (Farbe, Label, Key, DATEV-Kennzeichen, aktiv) mit CRUD. Eingebaute Arten
 * sind gekennzeichnet: Label/Farbe/Kennzeichen/aktiv änderbar, kein Löschen.
 */
export default function AbsenceTypesSection() {
  const t = useT();
  const { confirm } = useConfirm();
  const { types, reload } = useAbsenceTypes();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    const pal = absenceTypePalette();
    setForm({ ...EMPTY, color: pal[types.length % Math.max(1, pal.length)] || EMPTY.color });
  };
  const openEdit = (x: AbsenceTypeItem) => setForm({
    id: x.id, key: x.key, label: x.label, color: x.color, datevKennzeichen: x.datevKennzeichen, isBuiltin: x.isBuiltin,
  });

  const errText = (e: any, fallback: string) =>
    e?.response?.data?.message || e?.response?.data?.error || fallback;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    try {
      const body = {
        key: form.key.trim().toLowerCase(),
        label: form.label.trim(),
        color: form.color,
        datevKennzeichen: form.datevKennzeichen.trim().slice(0, 1) || '1',
      };
      if (form.id == null) {
        await api.post('/absence-types', body);
      } else {
        await api.put(`/absence-types/${form.id}`, body);
      }
      toast.success(t('settings.absenceTypes.saved'));
      setForm(null);
      await reload();
    } catch (err: any) {
      toast.error(errText(err, t('settings.absenceTypes.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (x: AbsenceTypeItem) => {
    try {
      await api.put(`/absence-types/${x.id}`, { isActive: !x.isActive });
      await reload();
    } catch (err: any) {
      toast.error(errText(err, t('settings.absenceTypes.saveError')));
    }
  };

  const remove = async (x: AbsenceTypeItem) => {
    const ok = await confirm({ message: t('settings.absenceTypes.deleteConfirm', { label: x.label }), danger: true });
    if (!ok) return;
    try {
      await api.delete(`/absence-types/${x.id}`);
      toast.success(t('settings.absenceTypes.deleted'));
      await reload();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        toast.error(t('settings.absenceTypes.inUseError'));
      } else {
        toast.error(errText(err, t('settings.absenceTypes.deleteError')));
      }
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h4 className="text-lg font-medium text-slate-900">{t('settings.absenceTypes.heading')}</h4>
        <button type="button" onClick={openNew} className="btn-secondary inline-flex items-center gap-1.5">
          <PlusIcon className="h-4 w-4" /> {t('settings.absenceTypes.new')}
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">{t('settings.absenceTypes.hint')}</p>

      {form && (
        <form onSubmit={save} className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 p-4">
          <p className="text-sm font-semibold text-slate-800 mb-3">
            {form.id == null ? t('settings.absenceTypes.new') : t('settings.absenceTypes.edit')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="abs-type-label">{t('settings.absenceTypes.colLabel')}</label>
              <input
                id="abs-type-label"
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="abs-type-key">{t('settings.absenceTypes.colKey')}</label>
              <input
                id="abs-type-key"
                type="text"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                className="input-field font-mono disabled:opacity-60"
                pattern="[a-z0-9][a-z0-9_\-]*"
                placeholder="z_b_homeoffice"
                disabled={form.isBuiltin || form.id != null}
                required={form.id == null}
                title={t('settings.absenceTypes.keyHint')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="abs-type-color">{t('settings.absenceTypes.colColor')}</label>
              <input
                id="abs-type-color"
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-10 w-16 rounded border border-gray-300 bg-white p-1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="abs-type-kz">{t('settings.absenceTypes.colKennzeichen')}</label>
              <input
                id="abs-type-kz"
                type="text"
                value={form.datevKennzeichen}
                onChange={(e) => setForm({ ...form, datevKennzeichen: e.target.value.slice(0, 1) })}
                className="input-field w-20 text-center font-mono"
                maxLength={1}
              />
              <p className="text-xs text-slate-400 mt-1">{t('settings.absenceTypes.kennzeichenHint')}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">{t('common.save')}</button>
            <button type="button" onClick={() => setForm(null)} className="btn-secondary">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('settings.absenceTypes.colColor')}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('settings.absenceTypes.colLabel')}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('settings.absenceTypes.colKey')}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('settings.absenceTypes.colKennzeichen')}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('settings.absenceTypes.colActive')}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {types.map((x) => (
              <tr key={x.id} className={clsx(!x.isActive && 'opacity-60')}>
                <td className="px-4 py-2.5">
                  <span className="inline-block h-5 w-5 rounded-full border border-gray-300" style={{ backgroundColor: x.color }} />
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm font-medium text-slate-900">
                  {x.label}
                  {x.isBuiltin && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {t('settings.absenceTypes.builtin')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm font-mono text-slate-600">{x.key}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm font-mono text-slate-600">{x.datevKennzeichen}</td>
                <td className="px-4 py-2.5">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={x.isActive}
                      onChange={() => toggleActive(x)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      aria-label={t('settings.absenceTypes.toggleActive', { label: x.label })}
                    />
                  </label>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-right text-sm">
                  <button
                    type="button"
                    onClick={() => openEdit(x)}
                    className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 hover:underline mr-3"
                  >
                    <PencilSquareIcon className="h-4 w-4" /> {t('common.edit')}
                  </button>
                  {!x.isBuiltin && (
                    <button
                      type="button"
                      onClick={() => remove(x)}
                      className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 hover:underline"
                    >
                      <TrashIcon className="h-4 w-4" /> {t('common.delete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {types.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">{t('common.loading')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
