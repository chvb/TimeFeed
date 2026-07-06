import { createContext, useContext, useState, useCallback, Fragment, ReactNode } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { useT } from '../../i18n';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
interface PromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  defaultValue?: string;
  required?: boolean;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  promptInput: (opts: PromptOptions | string) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

interface DialogState {
  mode: 'confirm' | 'prompt';
  opts: ConfirmOptions & PromptOptions;
  resolve: (value: any) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [state, setState] = useState<DialogState | null>(null);
  const [input, setInput] = useState('');

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => { setInput(''); setState({ mode: 'confirm', opts: o, resolve }); });
  }, []);

  const promptInput = useCallback((opts: PromptOptions | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<string | null>((resolve) => { setInput(o.defaultValue || ''); setState({ mode: 'prompt', opts: o as any, resolve }); });
  }, []);

  const finish = (result: any) => { state?.resolve(result); setState(null); };
  const onCancel = () => finish(state?.mode === 'prompt' ? null : false);
  const onConfirm = () => finish(state?.mode === 'prompt' ? input : true);

  const opts = state?.opts || ({} as ConfirmOptions & PromptOptions);
  const isPrompt = state?.mode === 'prompt';
  const danger = !!opts.danger;
  const confirmDisabled = isPrompt && opts.required && !input.trim();

  return (
    <ConfirmContext.Provider value={{ confirm, promptInput }}>
      {children}
      <Transition appear show={!!state} as={Fragment}>
        <Dialog as="div" className="relative z-[100]" onClose={onCancel}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/40" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl">
                  <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 rounded-full p-2 ${danger ? 'bg-red-100 dark:bg-red-900/40' : 'bg-primary-100 dark:bg-primary-900/40'}`}>
                      {danger
                        ? <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
                        : <QuestionMarkCircleIcon className="h-6 w-6 text-primary-600" />}
                    </div>
                    <div className="flex-1">
                      <Dialog.Title className="text-lg font-semibold text-slate-900 dark:text-white">
                        {opts.title || (isPrompt ? t('dialog.inputTitle') : t('dialog.confirmTitle'))}
                      </Dialog.Title>
                      {opts.message && (
                        <p className="mt-1 text-sm text-slate-600 dark:text-gray-400 whitespace-pre-line">{opts.message}</p>
                      )}
                      {isPrompt && (
                        <input
                          autoFocus
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !confirmDisabled) onConfirm(); }}
                          placeholder={opts.placeholder || ''}
                          className="mt-3 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-800">
                      {opts.cancelText || t('dialog.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={onConfirm}
                      disabled={confirmDisabled}
                      className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}
                    >
                      {opts.confirmText || (isPrompt ? t('dialog.ok') : t('dialog.confirm'))}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </ConfirmContext.Provider>
  );
}
