import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { LEGAL_PROSE } from './contentStyle';
import ImpressumContent from './ImpressumContent';
import DatenschutzContent from './DatenschutzContent';
import InfoContent from './InfoContent';
import KontaktContent from './KontaktContent';
import DokumentationContent from './DokumentationContent';

export type LegalKey = 'impressum' | 'datenschutz' | 'info' | 'dokumentation' | 'kontakt';

const META: Record<LegalKey, { title: string; Content: React.ComponentType }> = {
  impressum: { title: 'Impressum', Content: ImpressumContent },
  datenschutz: { title: 'Datenschutzerklärung', Content: DatenschutzContent },
  info: { title: 'Informationen', Content: InfoContent },
  dokumentation: { title: 'Dokumentation', Content: DokumentationContent },
  kontakt: { title: 'Kontakt', Content: KontaktContent },
};

interface LegalModalProps {
  openKey: LegalKey | null;
  onClose: () => void;
}

export default function LegalModal({ openKey, onClose }: LegalModalProps) {
  const meta = openKey ? META[openKey] : null;
  const Content = meta?.Content;

  return (
    <Transition appear show={!!openKey} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full justify-center p-4 sm:py-10">
            <Dialog.Panel className="relative w-full max-w-3xl card max-h-[85vh] overflow-y-auto">
              <button
                onClick={onClose}
                aria-label="Schließen"
                className="absolute top-3 right-3 p-1.5 rounded-full text-slate-500 hover:bg-slate-100"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
              {meta && Content && (
                <>
                  <Dialog.Title className="text-2xl font-bold text-slate-900 mb-4 pr-8">{meta.title}</Dialog.Title>
                  <div className={LEGAL_PROSE}>
                    <Content />
                  </div>
                </>
              )}
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
