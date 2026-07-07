import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useConfirm } from '../components/common/ConfirmProvider';
import toast from 'react-hot-toast';
import {
  ArrowPathIcon, CloudArrowUpIcon, EyeIcon, EyeSlashIcon, TrashIcon, ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useT } from '../i18n';

interface StorageForm {
  s3Endpoint: string; s3Region: string; s3Bucket: string;
  s3AccessKey: string; s3SecretKey: string; s3BackupPrefix: string; s3AttachmentPrefix: string; isActive: boolean;
  secondaryEnabled: boolean; secondaryEndpoint: string; secondaryRegion: string; secondaryBucket: string;
  secondaryAccessKey: string; secondarySecretKey: string; secondaryPrefix: string; secondaryFailoverTimeoutMs: number;
}
interface S3Backup { key: string; size: number; lastModified: string | null; }

const EMPTY: StorageForm = {
  s3Endpoint: '', s3Region: 'eu-central-1', s3Bucket: '',
  s3AccessKey: '', s3SecretKey: '', s3BackupPrefix: 'timefeed/backups/', s3AttachmentPrefix: 'timefeed/attachments/', isActive: false,
  secondaryEnabled: false, secondaryEndpoint: '', secondaryRegion: 'eu-central-1', secondaryBucket: '',
  secondaryAccessKey: '', secondarySecretKey: '', secondaryPrefix: 'timefeed/', secondaryFailoverTimeoutMs: 3000,
};

export default function StorageSettings({ section = 'all' }: { section?: 'config' | 'backups' | 'all' }) {
  const t = useT();
  const showConfig = section === 'all' || section === 'config';
  const showBackups = section === 'all' || section === 'backups';
  const [form, setForm] = useState<StorageForm>(EMPTY);
  const [showSecret, setShowSecret] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingSecondary, setTestingSecondary] = useState(false);
  const [showSecAccess, setShowSecAccess] = useState(false);
  const [showSecSecret, setShowSecSecret] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ pendingSecondary?: number; pendingBackfill?: number } | null>(null);
  const [backups, setBackups] = useState<S3Backup[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const { confirm } = useConfirm();

  const load = async () => {
    try {
      const { data } = await api.get('/storage');
      setForm({ ...EMPTY, ...data.settings });
      // S3-Backups automatisch laden, wenn die Anbindung aktiv ist.
      if (showBackups && data.settings?.isActive) {
        loadBackups();
      }
      if (data.settings?.secondaryEnabled) loadSyncStatus();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('storage.loadError'));
    }
  };
  useEffect(() => { load(); }, []);

  const set = (k: keyof StorageForm, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/storage', form);
      setForm({ ...EMPTY, ...data.settings });
      toast.success(t('storage.saveSuccess'));
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('storage.saveError'));
    } finally { setSaving(false); }
  };

  const testSecondary = async () => {
    setTestingSecondary(true);
    try {
      await api.post('/storage/test-secondary', form);
      toast.success(t('storage.secondaryTestSuccess'));
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.response?.data?.message || t('storage.secondaryTestError'));
    } finally { setTestingSecondary(false); }
  };

  const loadSyncStatus = async () => {
    try {
      const { data } = await api.get('/storage/secondary-sync');
      setSyncStatus(data || {});
    } catch { /* Anzeige optional */ }
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await api.post('/storage/secondary-sync');
      toast.success(t('storage.secondarySyncStarted'));
      setTimeout(loadSyncStatus, 1500);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('storage.secondarySyncError'));
    } finally { setSyncing(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      await api.post('/storage/test', form);
      toast.success(t('storage.testSuccess'));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('storage.testError'));
    } finally { setTesting(false); }
  };

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const { data } = await api.get('/storage/backups');
      setBackups(data.backups || []);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('storage.backupsLoadError'));
    } finally {
      setLoadingBackups(false);
    }
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      await api.post('/storage/backup');
      toast.success(t('storage.backupCreated'));
      loadBackups();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('storage.backupError'));
    } finally { setBusy(false); }
  };

  const restore = async (key: string) => {
    if (!(await confirm({ title: t('storage.restoreConfirmTitle'), message: t('storage.restoreConfirmMsg'), confirmText: t('storage.restoreConfirmBtn'), danger: true }))) return;
    setBusy(true);
    try {
      await api.post('/storage/backups/restore', { key });
      toast.success(t('storage.restoreSuccess'));
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('storage.restoreError'));
    } finally { setBusy(false); }
  };

  const remove = async (key: string) => {
    if (!(await confirm({ title: t('storage.deleteConfirmTitle'), message: t('storage.deleteConfirmMsg'), confirmText: t('storage.deleteConfirmBtn'), danger: true }))) return;
    try {
      await api.delete('/storage/backups', { data: { key } });
      toast.success(t('storage.deleteSuccess'));
      loadBackups();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('storage.deleteError'));
    }
  };

  const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

  return (
    <div className="max-w-2xl space-y-6">
      {showConfig && (<>
      <h1 className="text-3xl font-bold text-slate-900">{t('storage.heading')}</h1>

      <div className="card space-y-4">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-4 w-4" />
          <span className="font-medium">{t('storage.enable')}</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.endpoint')}</label>
            <input className="input-field" placeholder={t('storage.endpointPlaceholder')} value={form.s3Endpoint} onChange={(e) => set('s3Endpoint', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.region')}</label>
            <input className="input-field" placeholder="eu-central-1" value={form.s3Region} onChange={(e) => set('s3Region', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.bucket')}</label>
            <input className="input-field" value={form.s3Bucket} onChange={(e) => set('s3Bucket', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.backupPrefix')}</label>
            <input className="input-field" placeholder="timefeed/backups/" value={form.s3BackupPrefix} onChange={(e) => set('s3BackupPrefix', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.attachmentPrefix')}</label>
            <input className="input-field" placeholder="timefeed/attachments/" value={form.s3AttachmentPrefix} onChange={(e) => set('s3AttachmentPrefix', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.accessKey')}</label>
            <div className="relative">
              <input className="input-field pr-10" type={showAccess ? 'text' : 'password'} value={form.s3AccessKey} onChange={(e) => set('s3AccessKey', e.target.value)} />
              <button type="button" onClick={() => setShowAccess((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
                {showAccess ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.secretKey')}</label>
            <div className="relative">
              <input className="input-field pr-10" type={showSecret ? 'text' : 'password'} value={form.s3SecretKey} onChange={(e) => set('s3SecretKey', e.target.value)} />
              <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
                {showSecret ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={test} disabled={testing} className="btn-secondary inline-flex items-center gap-2">
            <ArrowPathIcon className={`h-5 w-5 ${testing ? 'animate-spin' : ''}`} /> {t('storage.testConnection')}
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? t('storage.saving') : t('storage.save')}</button>
        </div>
      </div>

      {/* Sekundärer S3-Backup-Server: Dual-Write, Failover, automatischer Rück-Sync */}
      <div className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('storage.secondaryHeading')}</h2>
          <p className="text-sm text-slate-500">{t('storage.secondaryHint')}</p>
        </div>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={form.secondaryEnabled} onChange={(e) => set('secondaryEnabled', e.target.checked)} className="h-4 w-4" />
          <span className="font-medium">{t('storage.secondaryEnable')}</span>
        </label>

        {form.secondaryEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.endpoint')}</label>
              <input className="input-field" placeholder={t('storage.endpointPlaceholder')} value={form.secondaryEndpoint} onChange={(e) => set('secondaryEndpoint', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.region')}</label>
              <input className="input-field" placeholder="eu-central-1" value={form.secondaryRegion} onChange={(e) => set('secondaryRegion', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.bucket')}</label>
              <input className="input-field" value={form.secondaryBucket} onChange={(e) => set('secondaryBucket', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.secondaryPrefix')}</label>
              <input className="input-field" placeholder="timefeed/" value={form.secondaryPrefix} onChange={(e) => set('secondaryPrefix', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.accessKey')}</label>
              <div className="relative">
                <input className="input-field pr-10" type={showSecAccess ? 'text' : 'password'} value={form.secondaryAccessKey} onChange={(e) => set('secondaryAccessKey', e.target.value)} />
                <button type="button" onClick={() => setShowSecAccess((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
                  {showSecAccess ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.secretKey')}</label>
              <div className="relative">
                <input className="input-field pr-10" type={showSecSecret ? 'text' : 'password'} value={form.secondarySecretKey} onChange={(e) => set('secondarySecretKey', e.target.value)} />
                <button type="button" onClick={() => setShowSecSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
                  {showSecSecret ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('storage.secondaryFailover')}</label>
              <input className="input-field" type="number" min={500} max={30000} step={500} value={form.secondaryFailoverTimeoutMs} onChange={(e) => set('secondaryFailoverTimeoutMs', parseInt(e.target.value) || 3000)} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={testSecondary} disabled={testingSecondary || !form.secondaryEnabled} className="btn-secondary inline-flex items-center gap-2">
            <ArrowPathIcon className={`h-5 w-5 ${testingSecondary ? 'animate-spin' : ''}`} /> {t('storage.secondaryTest')}
          </button>
          <button onClick={triggerSync} disabled={syncing || !form.secondaryEnabled} className="btn-secondary inline-flex items-center gap-2">
            <CloudArrowUpIcon className="h-5 w-5" /> {t('storage.secondarySyncNow')}
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? t('storage.saving') : t('storage.save')}</button>
          {syncStatus && (
            <span className="text-xs text-slate-500 ml-auto">
              {t('storage.secondaryPending', { mirror: syncStatus.pendingSecondary ?? 0, backfill: syncStatus.pendingBackfill ?? 0 })}
            </span>
          )}
        </div>
      </div>
      </>)}

      {showBackups && (
      <div className="card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('storage.backupsTitle')}</h2>
            <p className="text-xs text-slate-500">{t('storage.autoLoaded', { count: backups.length, label: backups.length === 1 ? t('storage.backupSingular') : t('storage.backupPlural') })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadBackups} disabled={loadingBackups} className="btn-secondary inline-flex items-center gap-2"><ArrowPathIcon className={`h-5 w-5 ${loadingBackups ? 'animate-spin' : ''}`} /> {t('storage.refresh')}</button>
            <button onClick={createBackup} disabled={busy || !form.isActive} className="btn-primary inline-flex items-center gap-2">
              <CloudArrowUpIcon className="h-5 w-5" /> {t('storage.createBackup')}
            </button>
          </div>
        </div>
        {!form.isActive ? (
          <p className="text-sm text-slate-500">{t('storage.notActive')}</p>
        ) : loadingBackups && backups.length === 0 ? (
          <p className="text-sm text-slate-500">{t('storage.loadingBackups')}</p>
        ) : backups.length === 0 ? (
          <p className="text-sm text-slate-500">{t('storage.noBackups')}</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {backups.map((b) => (
              <li key={b.key} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{b.key.split('/').pop()}</p>
                  <p className="text-xs text-slate-500">{b.lastModified ? new Date(b.lastModified).toLocaleString('de-DE') : ''} · {fmtSize(b.size)}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => restore(b.key)} disabled={busy} title={t('storage.restore')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><ArrowDownTrayIcon className="h-5 w-5" /></button>
                  <button onClick={() => remove(b.key)} title={t('storage.delete')} className="p-1.5 rounded hover:bg-red-50 text-red-600"><TrashIcon className="h-5 w-5" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}
