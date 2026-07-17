import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useT, useI18n } from '../../i18n';
import Select from '../common/Select';

const ENTRY_TYPES = ['in', 'out', 'break_start', 'break_end'] as const;

interface ProposedEntry { type: string; time: string }

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tag (YYYY-MM-DD), für den die Korrektur beantragt wird. */
  date: string;
  onSubmitted: () => void;
}

/** Modal „Korrektur beantragen": Nachricht (Pflicht) + optionale vorgeschlagene Stempelungen. */
export default function CorrectionRequestModal({ open, onClose, date, onSubmitted }: Props) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const [message, setMessage] = useState('');
  const [proposed, setProposed] = useState<ProposedEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Server verlangt mindestens eine vorgeschlagene Stempelung → mit einer Zeile starten.
    if (open) { setMessage(''); setProposed([{ type: 'in', time: '' }]); }
  }, [open, date]);

  const addRow = () => setProposed((p) => [...p, { type: 'in', time: '' }]);
  const removeRow = (i: number) => setProposed((p) => p.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<ProposedEntry>) =>
    setProposed((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  // Server-Contract: message Pflicht, proposedEntries nicht-leeres Array mit HH:MM-Zeiten.
  const validProposed = proposed.filter((p) => /^\d{2}:\d{2}$/.test(p.time));
  const canSubmit =
    message.trim().length > 0 &&
    proposed.length > 0 &&
    proposed.every((p) => /^\d{2}:\d{2}$/.test(p.time));

  const submit = async () => {
    if (!canSubmit) return;
    try {
      setSaving(true);
      await api.post('/corrections', {
        date,
        message: message.trim(),
        proposedEntries: validProposed,
      });
      toast.success(t('corrections.submitSuccess'));
      onSubmitted();
      onClose();
    } catch (e: any) {
      if (e.response?.status === 423 || e.response?.data?.error === 'MONTH_LOCKED') {
        toast.error(t('corrections.monthLockedError'));
      } else {
        toast.error(e.response?.data?.message || e.response?.data?.error || t('corrections.submitError'));
      }
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl">
                <Dialog.Title className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                  {t('corrections.requestTitle', { date: dateLabel })}
                </Dialog.Title>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor="corr-message">{t('corrections.message')}</label>
                    <textarea
                      id="corr-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={t('corrections.messagePlaceholder')}
                      rows={3}
                      className="input-field w-full resize-y"
                    />
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{t('corrections.proposedEntries')}</p>
                    <div className="space-y-2">
                      {proposed.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex-1">
                            <Select
                              value={p.type}
                              onChange={(v) => updateRow(i, { type: v })}
                              ariaLabel={t('corrections.type')}
                              options={ENTRY_TYPES.map((et) => ({ value: et, label: t(`time.entryType.${et}`) }))}
                            />
                          </div>
                          <input
                            type="time"
                            value={p.time}
                            onChange={(e) => updateRow(i, { time: e.target.value })}
                            className="input-field w-32"
                            aria-label={t('corrections.time')}
                          />
                          <button
                            type="button"
                            onClick={() => removeRow(i)}
                            className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500"
                            title={t('corrections.removeProposed')}
                            aria-label={t('corrections.removeProposed')}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addRow}
                      className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                    >
                      <PlusIcon className="h-4 w-4" /> {t('corrections.addProposed')}
                    </button>
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={onClose} className="btn-secondary">{t('dialog.cancel')}</button>
                  <button type="button" onClick={submit} disabled={saving || !canSubmit} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('corrections.submit')}
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
