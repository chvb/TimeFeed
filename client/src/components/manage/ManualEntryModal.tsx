import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useT } from '../../i18n';

const ENTRY_TYPES = ['in', 'out', 'break_start', 'break_end'] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  userId: number;
  /** Vorbelegtes Datum (YYYY-MM-DD), z. B. der angeklickte Tag. */
  defaultDate?: string;
  /** Nach erfolgreicher Buchung (Tages-/Monatsdaten neu laden). */
  onBooked: () => void;
}

/** Modal „Nachbuchen": manuelle Stempelung für einen Mitarbeiter (Zeitverwalter). */
export default function ManualEntryModal({ open, onClose, userId, defaultDate, onBooked }: Props) {
  const t = useT();
  const [date, setDate] = useState(defaultDate || '');
  const [time, setTime] = useState('');
  const [type, setType] = useState<string>('in');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(defaultDate || new Date().toISOString().slice(0, 10));
      setTime('');
      setType('in');
      setNote('');
    }
  }, [open, defaultDate]);

  const submit = async () => {
    if (!date || !time) return;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const timestamp = new Date(y, m - 1, d, hh, mm, 0).toISOString();
    try {
      setSaving(true);
      await api.post('/time/manual', { userId, type, timestamp, note: note.trim() || undefined });
      toast.success(t('manage.manualSuccess'));
      onBooked();
      onClose();
    } catch (e: any) {
      if (e.response?.status === 423 || e.response?.data?.error === 'MONTH_LOCKED') {
        toast.error(t('manage.monthLockedError'));
      } else {
        toast.error(e.response?.data?.message || e.response?.data?.error || t('manage.manualError'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl">
                <Dialog.Title className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                  {t('manage.manualTitle')}
                </Dialog.Title>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor="manual-date">{t('manage.manualDate')}</label>
                      <input id="manual-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field w-full" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor="manual-time">{t('manage.manualTime')}</label>
                      <input id="manual-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input-field w-full" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor="manual-type">{t('manage.manualType')}</label>
                    <select id="manual-type" value={type} onChange={(e) => setType(e.target.value)} className="input-field w-full">
                      {ENTRY_TYPES.map((et) => (
                        <option key={et} value={et}>{t(`time.entryType.${et}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor="manual-note">{t('manage.manualNote')}</label>
                    <input id="manual-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('manage.manualNotePlaceholder')} className="input-field w-full" />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={onClose} className="btn-secondary">{t('dialog.cancel')}</button>
                  <button type="button" onClick={submit} disabled={saving || !date || !time} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('manage.manualSubmit')}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
