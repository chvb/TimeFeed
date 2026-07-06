import { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import toast from 'react-hot-toast';
import {
  KeyIcon,
  PlusIcon,
  NoSymbolIcon,
  XMarkIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useConfirm } from '../components/common/ConfirmProvider';
import { useAuthStore } from '../store/authStore';
import { useT, useI18n } from '../i18n';

interface ApiKey {
  id: number;
  name: string;
  keyPrefix?: string;
  isActive: boolean;
  lastUsedAt?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
}

/**
 * Verwaltung der API-Schlüssel (/api-keys): Liste, Erzeugen mit Einmal-Anzeige
 * des Vollschlüssels (tfk_…), Widerrufen. Nur für Admins.
 */
export default function ApiKeys() {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const { user } = useAuthStore();
  const { confirm } = useConfirm();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog „Neuer Schlüssel"
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  // Einmal-Anzeige des frisch erzeugten Vollschlüssels
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const r = await api.get('/api-keys');
      const list = r.data.apiKeys || r.data.keys || (Array.isArray(r.data) ? r.data : []);
      setKeys(list);
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('apiKeys.loadError'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => { setName(''); setExpiresAt(''); setCreateOpen(true); };

  const create = async () => {
    if (!name.trim()) { toast.error(t('apiKeys.nameRequired')); return; }
    setCreating(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim() };
      if (expiresAt) payload.expiresAt = expiresAt;
      // Super-Admin ohne eigenen Mandanten: Tenant aus dem Kontext-Wechsler mitgeben
      // (Server verlangt beim Erzeugen eine tenantId).
      const cc = localStorage.getItem('tf-company-context') || '';
      if (cc.startsWith('tenant:')) payload.tenantId = Number(cc.slice(7));
      const r = await api.post('/api-keys', payload);
      // Antwort: { apiKey: DTO, key: Vollschlüssel } — key nur dieses eine Mal.
      const full = r.data.key || '';
      setCreateOpen(false);
      setCreatedKey(String(full));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('apiKeys.createError'));
    } finally {
      setCreating(false);
    }
  };

  const copyKey = () => {
    if (!createdKey) return;
    navigator.clipboard?.writeText(createdKey).then(
      () => toast.success(t('apiKeys.copied')),
      () => toast.error(t('apiKeys.copyFailed')),
    );
  };

  const revoke = async (k: ApiKey) => {
    const ok = await confirm({
      title: t('apiKeys.revokeConfirmTitle'),
      message: t('apiKeys.revokeConfirmMsg', { name: k.name }),
      confirmText: t('apiKeys.revokeConfirmBtn'),
      danger: true,
    });
    if (!ok) return;
    try {
      // Server: DELETE /api/api-keys/:id = Widerruf (isActive=false, kein Hard-Delete).
      await api.delete(`/api-keys/${k.id}`);
      toast.success(t('apiKeys.revoked_toast'));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('apiKeys.revokeError'));
    }
  };

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '');
  const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString(locale) : '');
  const isExpired = (k: ApiKey) => !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now();

  const statusBadge = (k: ApiKey) => {
    if (!k.isActive) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{t('apiKeys.revoked')}</span>;
    if (isExpired(k)) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{t('apiKeys.expired')}</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{t('apiKeys.active')}</span>;
  };

  if (user?.role !== 'admin' && !user?.isSuperAdmin) {
    return <div className="p-8 text-center text-slate-500">{t('apiKeys.noAccess')}</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <KeyIcon className="h-8 w-8 text-primary-600" /> {t('apiKeys.title')}
        </h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <PlusIcon className="h-5 w-5" /> {t('apiKeys.new')}
        </button>
      </div>

      <p className="text-sm text-slate-500 mb-4">{t('apiKeys.subtitle')}</p>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-10">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <KeyIcon className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">{t('apiKeys.empty')}</p>
            <p className="text-sm text-slate-400 mt-1">{t('apiKeys.emptyHint')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colName')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colKey')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colStatus')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colLastUsed')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colCreated')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colExpires')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase">{t('apiKeys.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{k.name}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono">
                        {k.keyPrefix ? `${k.keyPrefix}…` : '••••••••'}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-center">{statusBadge(k)}</td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : t('apiKeys.never')}</td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{fmtDate(k.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{k.expiresAt ? fmtDate(k.expiresAt) : t('apiKeys.noExpiry')}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {k.isActive && (
                        <button onClick={() => revoke(k)} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-red-600" title={t('apiKeys.revoke')}>
                          <NoSymbolIcon className="h-5 w-5" /> {t('apiKeys.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog: neuen Schlüssel erzeugen */}
      <Transition appear show={createOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setCreateOpen(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title className="text-lg font-semibold text-slate-900">{t('apiKeys.createTitle')}</Dialog.Title>
                    <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="h-5 w-5" /></button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('apiKeys.nameLabel')}</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                        className="input-field w-full"
                        placeholder={t('apiKeys.namePlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('apiKeys.expiresLabel')}</label>
                      <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input-field w-full" />
                      <p className="text-xs text-slate-500 mt-1">{t('apiKeys.expiresHint')}</p>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button onClick={() => setCreateOpen(false)} className="btn-secondary">{t('apiKeys.cancel')}</button>
                    <button onClick={create} disabled={creating} className="btn-primary">{creating ? t('apiKeys.creating') : t('apiKeys.create')}</button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Einmal-Anzeige des Vollschlüssels */}
      <Transition appear show={!!createdKey} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setCreatedKey(null)}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                  <Dialog.Title className="text-lg font-semibold text-slate-900 mb-3">{t('apiKeys.createdTitle')}</Dialog.Title>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">{t('apiKeys.createdWarnTitle')}</p>
                      <p className="text-sm text-amber-700 mt-0.5">{t('apiKeys.createdWarnText')}</p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      readOnly
                      value={createdKey || ''}
                      onFocus={(e) => e.target.select()}
                      className="input-field flex-1 font-mono text-sm"
                    />
                    <button onClick={copyKey} className="btn-primary flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <ClipboardDocumentIcon className="h-5 w-5" /> {t('apiKeys.copy')}
                    </button>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <button onClick={() => setCreatedKey(null)} className="btn-secondary">{t('apiKeys.done')}</button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
