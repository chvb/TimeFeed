import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import api from '../../lib/api';
import { useT } from '../../i18n';

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-slate-500 dark:text-gray-400">{label}: </span>
      <span className="font-medium text-slate-800 dark:text-gray-200">{value}</span>
    </div>
  );
}

export default function EmployeeDetailModal({ employee, onClose }: { employee: any | null; onClose: () => void }) {
  const t = useT();
  const [enriched, setEnriched] = useState<any>(null);
  const emp = (enriched && enriched.id === employee?.id) ? enriched : employee;

  useEffect(() => {
    if (!employee) { setEnriched(null); return; }
    setEnriched(null);
    // Volle Userdaten best-effort nachladen; bei fehlender Berechtigung Fallback auf übergebenes Objekt.
    api.get(`/users/${employee.id}`).then((r) => setEnriched(r.data.user || r.data)).catch(() => {});
  }, [employee]);

  return (
    <Transition appear show={!!employee} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl">
                {emp && (
                  <>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-primary-600 rounded-full flex items-center justify-center text-white font-semibold">
                          {emp.firstName?.[0]}{emp.lastName?.[0]}
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{emp.firstName} {emp.lastName}</h3>
                          <p className="text-sm text-slate-500 dark:text-gray-400">{emp.email}</p>
                        </div>
                      </div>
                      <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><XMarkIcon className="h-6 w-6" /></button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <Info label={t('widgets.labelRole')} value={t(`widgets.role.${emp.role}`) !== `widgets.role.${emp.role}` ? t(`widgets.role.${emp.role}`) : emp.role} />
                      <Info label={t('widgets.labelEmployeeNumber')} value={emp.employeeNumber || '–'} />
                      <Info label={t('widgets.labelDepartment')} value={emp.group?.name || emp.department || '–'} />
                      <Info label={t('widgets.labelPosition')} value={emp.position || '–'} />
                      <Info label={t('widgets.labelEntry')} value={emp.entryDate ? new Date(emp.entryDate).toLocaleDateString('de-DE') : '–'} />
                      <Info label={t('widgets.labelStatus')} value={emp.isActive ? t('widgets.active') : t('widgets.inactive')} />
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
