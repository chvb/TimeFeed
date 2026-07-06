import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import api from '../../lib/api';
import { useT } from '../../i18n';

interface Section { title: string; items: string[] }
interface Entry { version: string; date: string; sections: Section[] }

function sectionColor(t: string): string {
  if (/security|sicher/i.test(t)) return 'text-red-600';
  if (/add|neu/i.test(t)) return 'text-green-600';
  if (/fix|bug/i.test(t)) return 'text-amber-600';
  return 'text-primary-600';
}

export default function ChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/changelog')
      .then(({ data }) => setEntries(data.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[70]" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full justify-center p-4 sm:py-10">
            <Dialog.Panel className="relative w-full max-w-2xl card max-h-[85vh] overflow-y-auto">
              <button onClick={onClose} aria-label={t('ui.close')} className="absolute top-3 right-3 p-1.5 rounded-full text-slate-500 hover:bg-slate-100">
                <XMarkIcon className="h-6 w-6" />
              </button>
              <Dialog.Title className="text-2xl font-bold text-slate-900">{t('ui.whatsNew')}</Dialog.Title>
              <p className="text-sm text-slate-500 mb-4">{t('ui.changesTo')}</p>

              {loading ? (
                <p className="text-sm text-slate-500">{t('ui.loading')}</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-slate-500">{t('ui.noChangelog')}</p>
              ) : (
                <div className="space-y-6">
                  {entries.map((e) => (
                    <div key={e.version}>
                      <div className="flex items-baseline gap-2 border-b border-slate-100 pb-1">
                        <span className="font-bold text-slate-900">v{e.version}</span>
                        <span className="text-xs text-slate-400">{e.date}</span>
                      </div>
                      {e.sections.map((s, i) => (
                        <div key={i} className="mt-2">
                          <p className={`text-xs font-semibold uppercase tracking-wide ${sectionColor(s.title)}`}>{s.title}</p>
                          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-0.5 mt-1">
                            {s.items.map((it, j) => <li key={j}>{it}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
