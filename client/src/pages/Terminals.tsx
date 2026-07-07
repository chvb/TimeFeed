import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  ArrowPathIcon,
  ClipboardDocumentIcon,
  DeviceTabletIcon,
  LockClosedIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  ShieldCheckIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import { useConfirm } from '../components/common/ConfirmProvider';
import { useAuthStore } from '../store/authStore';
import { useI18n } from '../i18n';

type Method = 'nfc' | 'code' | 'qr';
const ALL_METHODS: Method[] = ['nfc', 'code', 'qr'];

interface TerminalDto {
  id: number;
  name: string;
  locationLabel?: string | null;
  lat?: number | null;
  lng?: number | null;
  isActive: boolean;
  lastSeenAt?: string | null;
  tokenPrefix?: string | null;
  /** Kiosk-Einstellungen (Zahnrad) sind per Passwort geschützt. */
  hasSettingsPassword: boolean;
  /** Geräte-eigenes Logo (Data-URL); null = Firmen-Logo/Branding. */
  logo?: string | null;
  config?: { methods?: Method[]; requirePin?: boolean } | null;
}

interface FormState {
  name: string;
  locationLabel: string;
  lat: string;
  lng: string;
  methods: Method[];
  requirePin: boolean;
  isActive: boolean;
  /** Neues Einstellungs-Passwort ('' = unverändert bzw. kein Schutz beim Anlegen). */
  settingsPassword: string;
  /** Beim Bearbeiten: vorhandenen Schutz entfernen. */
  removeSettingsPassword: boolean;
  /** Geräte-Logo (Data-URL); null = Firmen-Logo/Branding verwenden. */
  logo: string | null;
}

const emptyForm = (): FormState => ({
  name: '',
  locationLabel: '',
  lat: '',
  lng: '',
  methods: ['nfc', 'code', 'qr'],
  requirePin: false,
  isActive: true,
  settingsPassword: '',
  removeSettingsPassword: false,
  logo: null,
});

/** Server-Antworten tolerant normalisieren (config kann JSON-String sein). */
function normalizeTerminal(raw: any): TerminalDto {
  let config = raw.config ?? {};
  if (typeof config === 'string') { try { config = JSON.parse(config) || {}; } catch { config = {}; } }
  return {
    id: raw.id,
    name: raw.name || '',
    locationLabel: raw.locationLabel ?? raw.location ?? null,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    isActive: raw.isActive !== false,
    lastSeenAt: raw.lastSeenAt ?? raw.lastSeen ?? null,
    tokenPrefix: raw.tokenPrefix ?? raw.tokenHint ?? null,
    hasSettingsPassword: !!raw.hasSettingsPassword,
    logo: raw.logo ?? null,
    config: {
      methods: Array.isArray(config.methods) ? config.methods.filter((m: string) => (ALL_METHODS as string[]).includes(m)) : undefined,
      requirePin: !!config.requirePin,
    },
  };
}

/** Admin-Geräteverwaltung: Stempel-Terminals (CRUD gegen /api/terminals). */
export default function Terminals() {
  const { user } = useAuthStore();
  const { t, lang } = useI18n();
  const { confirm } = useConfirm();
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';

  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TerminalDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  // Einmal-Anzeige des Volltokens nach dem Anlegen
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState('');

  // silent = Hintergrund-Refresh (kein Spinner-Flackern der Liste).
  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const r = await api.get('/terminals');
      const list = r.data.terminals || r.data.devices || (Array.isArray(r.data) ? r.data : []);
      setTerminals(list.map(normalizeTerminal));
      setLoadError('');
    } catch (error) {
      console.error('Error loading terminals:', error);
      if (!silent) setLoadError(t('terminals.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Liste alle 30s still aktualisieren (lastSeenAt/Status-Punkt aktuell halten)
  // + Ticker für die relative „Zuletzt gemeldet"-Anzeige.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNowTs(Date.now()), 5_000);
    const refresh = window.setInterval(() => { load(true); }, 5_000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };

  const openEdit = (term: TerminalDto) => {
    setEditing(term);
    setForm({
      name: term.name,
      locationLabel: term.locationLabel || '',
      lat: term.lat != null ? String(term.lat) : '',
      lng: term.lng != null ? String(term.lng) : '',
      methods: term.config?.methods?.length ? term.config.methods : ['nfc', 'code', 'qr'],
      requirePin: !!term.config?.requirePin,
      isActive: term.isActive,
      settingsPassword: '',
      removeSettingsPassword: false,
      logo: term.logo || null,
    });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditing(null); };

  const toggleMethod = (m: Method) => {
    setForm((f) => ({
      ...f,
      methods: f.methods.includes(m) ? f.methods.filter((x) => x !== m) : [...f.methods, m],
    }));
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 500 * 1024) { toast.error(t('terminals.logoTooLarge')); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (form.methods.length === 0) { toast.error(t('terminals.methodRequired')); return; }
    const lat = form.lat.trim() === '' ? null : Number(form.lat.replace(',', '.'));
    const lng = form.lng.trim() === '' ? null : Number(form.lng.replace(',', '.'));
    if ((lat != null && Number.isNaN(lat)) || (lng != null && Number.isNaN(lng))) {
      toast.error(t('terminals.invalidCoords'));
      return;
    }
    if (!form.removeSettingsPassword && form.settingsPassword && form.settingsPassword.length < 4) {
      toast.error(t('terminals.settingsPasswordTooShort'));
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      locationLabel: form.locationLabel.trim() || null,
      lat,
      lng,
      isActive: form.isActive,
      config: { methods: form.methods, requirePin: form.requirePin },
      logo: form.logo,
    };
    // Einstellungs-Passwort: nur mitsenden, wenn es gesetzt/entfernt werden soll
    // (weglassen = unverändert; null = Schutz entfernen).
    if (form.removeSettingsPassword) payload.settingsPassword = null;
    else if (form.settingsPassword) payload.settingsPassword = form.settingsPassword;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/terminals/${editing.id}`, payload);
        toast.success(t('terminals.saved'));
      } else {
        // Super-Admin/Mandanten-Admin: Firma aus dem Firmen-Kontext-Wechsler mitgeben
        // (Terminals sind immer firmengebunden; Firmen-Admins brauchen das nicht).
        const ctx = localStorage.getItem('tf-company-context') || '';
        if (ctx.startsWith('company:')) payload.companyId = Number(ctx.slice(8));
        const r = await api.post('/terminals', payload);
        const token = r.data?.token || r.data?.deviceToken || r.data?.plainToken || r.data?.terminal?.token || null;
        toast.success(t('terminals.saved'));
        if (token) {
          setCreatedToken(token);
          setCreatedName(form.name.trim());
        } else {
          toast.error(t('terminals.tokenMissing'));
        }
      }
      closeModal();
      load();
    } catch (error: any) {
      console.error('Error saving terminal:', error);
      const d = error?.response?.data;
      toast.error(d?.errors?.[0]?.msg || d?.message || d?.error || t('terminals.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (term: TerminalDto) => {
    if (term.isActive) {
      if (!(await confirm({ title: t('terminals.deactivateTitle'), message: t('terminals.deactivateMessage'), confirmText: t('terminals.deactivate'), danger: true }))) return;
    }
    try {
      await api.put(`/terminals/${term.id}`, { isActive: !term.isActive });
      toast.success(t('terminals.statusChanged'));
      load();
    } catch (error: any) {
      console.error('Error toggling terminal:', error);
      toast.error(error?.response?.data?.message || error?.response?.data?.error || t('terminals.statusError'));
    }
  };

  const handleDelete = async (term: TerminalDto) => {
    if (!(await confirm({ title: t('terminals.deleteTitle'), message: t('terminals.deleteMessage'), confirmText: t('terminals.delete'), danger: true }))) return;
    try {
      await api.delete(`/terminals/${term.id}`);
      toast.success(t('terminals.deleted'));
      load();
    } catch (error: any) {
      console.error('Error deleting terminal:', error);
      toast.error(error?.response?.data?.message || error?.response?.data?.error || t('terminals.deleteError'));
    }
  };

  const handleRegenerateToken = async (term: TerminalDto) => {
    if (!(await confirm({ title: t('terminals.regenerateTitle'), message: t('terminals.regenerateMessage', { name: term.name }), confirmText: t('terminals.regenerate'), danger: true }))) return;
    try {
      const r = await api.post(`/terminals/${term.id}/regenerate-token`);
      setCreatedToken(r.data?.token || null);
      toast.success(t('terminals.regenerated'));
      load();
    } catch (error: any) {
      console.error('Error regenerating terminal token:', error);
      toast.error(error?.response?.data?.message || error?.response?.data?.error || t('terminals.regenerateError'));
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      toast.success(t('terminals.tokenCopied'));
    } catch {
      toast.error(t('terminals.tokenCopyError'));
    }
  };

  /* ---------- „Zuletzt gemeldet": relative Anzeige + Status-Punkt ----------
     grün < 90s (Kiosk pingt alle 10s, lastSeenAt ist serverseitig 60s gedrosselt),
     amber < 10 min, grau/rot älter oder nie. */
  type SeenStatus = 'online' | 'recent' | 'offline' | 'never';

  const seenStatus = (v?: string | null): SeenStatus => {
    if (!v) return 'never';
    const diff = nowTs - new Date(v).getTime();
    if (diff < 90_000) return 'online';
    if (diff < 600_000) return 'recent';
    return 'offline';
  };

  const SEEN_DOT: Record<SeenStatus, string> = {
    online: 'bg-emerald-500',
    recent: 'bg-amber-500',
    offline: 'bg-red-400',
    never: 'bg-slate-400',
  };

  const fmtLastSeen = (v?: string | null) => {
    if (!v) return t('terminals.never');
    const diff = Math.max(0, nowTs - new Date(v).getTime());
    if (diff < 90_000) return t('terminals.secondsAgo', { count: Math.max(1, Math.round(diff / 1000)) });
    if (diff < 3_600_000) return t('terminals.minutesAgo', { count: Math.max(1, Math.round(diff / 60_000)) });
    return new Date(v).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  };

  /** Status-Punkt + relative Zeit (Tabelle und Mobile-Cards). */
  const lastSeenCell = (term: TerminalDto) => {
    const status = seenStatus(term.lastSeenAt);
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className={clsx('h-2.5 w-2.5 rounded-full flex-shrink-0', SEEN_DOT[status])}
          title={t(`terminals.seen.${status}`)}
          aria-label={t(`terminals.seen.${status}`)}
        />
        {fmtLastSeen(term.lastSeenAt)}
      </span>
    );
  };

  const methodsLabel = (term: TerminalDto) =>
    (term.config?.methods?.length ? term.config.methods : ALL_METHODS).map((m) => t(`terminals.method.${m}`)).join(', ');

  if (user?.role !== 'admin') {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">{t('terminals.title')}</h1>
        <div className="card text-center">
          <ShieldCheckIcon className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{t('terminals.accessDeniedTitle')}</h3>
          <p className="text-slate-600 dark:text-gray-400">{t('terminals.accessDeniedText')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={() => load()} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('terminals.title')}</h1>
        <button onClick={openCreate} className="btn-primary flex items-center space-x-2">
          <PlusIcon className="h-5 w-5" />
          <span>{t('terminals.add')}</span>
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-gray-400 mb-4">{t('terminals.subtitle')}</p>

      {loading ? (
        <div className="card">
          <div className="animate-pulse space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />)}
          </div>
        </div>
      ) : terminals.length === 0 ? (
        <div className="card text-center py-12">
          <DeviceTabletIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400 mb-4">{t('terminals.empty')}</p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center">
            <PlusIcon className="h-4 w-4 mr-2" /> {t('terminals.addFirst')}
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colName')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colLocation')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colToken')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colMethods')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colLastSeen')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colStatus')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('terminals.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {terminals.map((term) => (
                    <tr key={term.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">
                        <span className="inline-flex items-center gap-1.5">
                          {term.name}
                          {term.hasSettingsPassword && (
                            <span title={t('terminals.settingsPasswordBadge')}>
                              <LockClosedIcon className="h-4 w-4 text-slate-400" aria-label={t('terminals.settingsPasswordBadge')} />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-gray-300">{term.locationLabel || '–'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-700 dark:text-gray-300">{term.tokenPrefix ? `${term.tokenPrefix}…` : '–'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-gray-300">
                        {methodsLabel(term)}
                        {term.config?.requirePin && <span className="ml-2 status-badge status-pending">PIN</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-gray-300">{lastSeenCell(term)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx('status-badge', term.isActive ? 'status-approved' : 'status-rejected')}>
                          {term.isActive ? t('terminals.active') : t('terminals.inactive')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => openEdit(term)} className="text-primary-600 hover:text-primary-900 dark:text-primary-400" title={t('terminals.editTitle')}>
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleRegenerateToken(term)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400" title={t('terminals.regenerateTitle')}>
                            <ArrowPathIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(term)}
                            className={clsx(term.isActive ? 'text-amber-600 hover:text-amber-800' : 'text-emerald-600 hover:text-emerald-800')}
                            title={term.isActive ? t('terminals.deactivate') : t('terminals.activate')}
                          >
                            <PowerIcon className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(term)} className="text-red-600 hover:text-red-900 dark:text-red-400" title={t('terminals.deleteTitle')}>
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
            {terminals.map((term) => (
              <div key={term.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-gray-100 flex items-center gap-1.5">
                      {term.name}
                      {term.hasSettingsPassword && (
                        <span title={t('terminals.settingsPasswordBadge')}>
                          <LockClosedIcon className="h-4 w-4 text-slate-400 flex-shrink-0" aria-label={t('terminals.settingsPasswordBadge')} />
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-gray-400">{term.locationLabel || '–'}</p>
                    <p className="text-sm font-mono text-slate-600 dark:text-gray-400">{term.tokenPrefix ? `${term.tokenPrefix}…` : '–'}</p>
                    <p className="text-sm text-slate-600 dark:text-gray-400">{methodsLabel(term)}{term.config?.requirePin ? ' · PIN' : ''}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-500">{t('terminals.colLastSeen')}: {lastSeenCell(term)}</p>
                  </div>
                  <span className={clsx('status-badge', term.isActive ? 'status-approved' : 'status-rejected')}>
                    {term.isActive ? t('terminals.active') : t('terminals.inactive')}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-x-3 gap-y-2">
                  <button onClick={() => openEdit(term)} className="text-primary-600 flex items-center gap-1 text-sm">
                    <PencilIcon className="h-4 w-4" /> {t('terminals.editTitle')}
                  </button>
                  <button onClick={() => handleRegenerateToken(term)} className="text-indigo-600 flex items-center gap-1 text-sm">
                    <ArrowPathIcon className="h-4 w-4" /> {t('terminals.regenerate')}
                  </button>
                  <button onClick={() => handleToggleActive(term)} className="text-amber-600 flex items-center gap-1 text-sm">
                    <PowerIcon className="h-4 w-4" /> {term.isActive ? t('terminals.deactivate') : t('terminals.activate')}
                  </button>
                  <button onClick={() => handleDelete(term)} className="text-red-600 flex items-center gap-1 text-sm">
                    <TrashIcon className="h-4 w-4" /> {t('terminals.delete')}
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
              <Dialog.Panel className="relative mx-4 p-5 border w-full md:w-2/3 lg:w-1/2 max-h-[90vh] overflow-y-auto shadow-lg rounded-md bg-white">
                <div className="absolute top-3 right-3">
                  <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded-full transition-colors" title={t('terminals.close')}>
                    <XMarkIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
                  </button>
                </div>
                <div className="mt-3">
                  <h3 className="text-lg font-medium text-slate-900 mb-4">
                    {editing ? t('terminals.editTitle') : t('terminals.addTitle')}
                  </h3>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('terminals.name')}</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="input-field"
                        placeholder={t('terminals.namePlaceholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('terminals.locationLabel')}</label>
                      <input
                        type="text"
                        value={form.locationLabel}
                        onChange={(e) => setForm({ ...form, locationLabel: e.target.value })}
                        className="input-field"
                        placeholder={t('terminals.locationPlaceholder')}
                      />
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm font-medium text-slate-700 mb-3">{t('terminals.coords')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-slate-600 mb-1">{t('terminals.lat')}</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.lat}
                            onChange={(e) => setForm({ ...form, lat: e.target.value })}
                            className="input-field tabular-nums"
                            placeholder="51.9607"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-slate-600 mb-1">{t('terminals.lng')}</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.lng}
                            onChange={(e) => setForm({ ...form, lng: e.target.value })}
                            className="input-field tabular-nums"
                            placeholder="7.6261"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm font-medium text-slate-700 mb-1">{t('terminals.methods')}</p>
                      <p className="text-xs text-slate-400 mb-3">{t('terminals.methodsHint')}</p>
                      <div className="flex flex-wrap gap-5">
                        {ALL_METHODS.map((m) => (
                          <label key={m} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={form.methods.includes(m)}
                              onChange={() => toggleMethod(m)}
                              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                            />
                            <span className="text-sm text-slate-700">{t(`terminals.method.${m}`)}</span>
                          </label>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 mt-4">
                        <input
                          type="checkbox"
                          checked={form.requirePin}
                          onChange={(e) => setForm({ ...form, requirePin: e.target.checked })}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <span className="text-sm font-medium text-slate-700">{t('terminals.requirePin')}</span>
                      </label>
                      <p className="text-xs text-slate-400 mt-1">{t('terminals.requirePinHint')}</p>
                    </div>

                    {/* Einstellungs-Passwort (Kiosk): schützt das Zahnrad-Menü am Terminal */}
                    <div className="rounded-lg border border-slate-200 p-4">
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('terminals.settingsPassword')}</label>
                      <input
                        type="password"
                        value={form.settingsPassword}
                        onChange={(e) => setForm({ ...form, settingsPassword: e.target.value })}
                        disabled={form.removeSettingsPassword}
                        autoComplete="new-password"
                        className="input-field disabled:opacity-50"
                        placeholder={
                          editing?.hasSettingsPassword
                            ? t('terminals.settingsPasswordUnchanged')
                            : t('terminals.settingsPasswordPlaceholder')
                        }
                      />
                      <p className="text-xs text-slate-400 mt-1">{t('terminals.settingsPasswordHint')}</p>
                      {editing?.hasSettingsPassword && (
                        <label className="flex items-center gap-2 mt-3">
                          <input
                            type="checkbox"
                            checked={form.removeSettingsPassword}
                            onChange={(e) => setForm({ ...form, removeSettingsPassword: e.target.checked, settingsPassword: e.target.checked ? '' : form.settingsPassword })}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <span className="text-sm font-medium text-slate-700">{t('terminals.settingsPasswordRemove')}</span>
                        </label>
                      )}
                    </div>

                    {/* Geräte-Logo: leer = Firmen-Logo bzw. Mandanten-Branding */}
                    <div className="rounded-lg border border-slate-200 p-4">
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('terminals.logo')}</label>
                      <div className="flex items-center gap-3">
                        {form.logo ? (
                          <img src={form.logo} alt="" className="h-12 w-12 object-contain rounded-lg border border-slate-200 bg-white" />
                        ) : (
                          <div className="h-12 w-12 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-300 text-xs">–</div>
                        )}
                        <label className="btn-secondary text-sm cursor-pointer">
                          {t('terminals.logoUpload')}
                          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFile} />
                        </label>
                        {form.logo && (
                          <button type="button" onClick={() => setForm({ ...form, logo: null })} className="text-sm text-red-600 hover:text-red-800">
                            {t('terminals.logoRemove')}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-2">{t('terminals.logoHint')}</p>
                    </div>

                    {editing && (
                      <div className="rounded-lg border border-slate-200 p-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={form.isActive}
                            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <span className="text-sm font-medium text-slate-700">{t('terminals.isActive')}</span>
                        </label>
                        <p className="text-xs text-slate-400 mt-1">{t('terminals.isActiveHint')}</p>
                      </div>
                    )}

                    <div className="flex justify-end space-x-3 pt-2">
                      <button type="button" onClick={closeModal} className="btn-secondary">{t('terminals.cancel')}</button>
                      <button type="submit" disabled={saving} className="btn-primary">
                        {saving ? t('terminals.saving') : (editing ? t('terminals.save') : t('terminals.addBtn'))}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Modal: Einmal-Anzeige des Geräte-Tokens */}
      <Transition appear show={!!createdToken} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setCreatedToken(null)}>
          <Transition.Child as={React.Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full justify-center p-4 pt-16">
              <Dialog.Panel className="relative mx-4 p-6 border w-full md:w-2/3 lg:w-1/2 shadow-lg rounded-md bg-white">
                <h3 className="text-lg font-medium text-slate-900 mb-1">
                  {t('terminals.tokenTitle')}{createdName ? ` — ${createdName}` : ''}
                </h3>
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                  {t('terminals.tokenOnce')}
                </p>
                <div className="flex items-center gap-2 mb-5">
                  <code className="flex-1 bg-slate-100 border border-slate-200 rounded-lg px-3 py-3 font-mono text-sm break-all select-all">
                    {createdToken}
                  </code>
                  <button type="button" onClick={copyToken} className="btn-secondary flex items-center gap-1.5 flex-shrink-0">
                    <ClipboardDocumentIcon className="h-4 w-4" /> {t('terminals.tokenCopy')}
                  </button>
                </div>
                <div className="rounded-lg border border-slate-200 p-4 mb-5">
                  <p className="text-sm font-medium text-slate-700 mb-2">{t('terminals.tokenInstructionsTitle')}</p>
                  <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1">
                    <li>{t('terminals.tokenInstructions1', { url: `${window.location.origin}/terminal` })}</li>
                    <li>{t('terminals.tokenInstructions2')}</li>
                    <li>{t('terminals.tokenInstructions3')}</li>
                  </ol>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setCreatedToken(null)} className="btn-primary">{t('terminals.close')}</button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
