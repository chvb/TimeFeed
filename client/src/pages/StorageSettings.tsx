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
}
interface S3Backup { key: string; size: number; lastModified: string | null; }

const EMPTY: StorageForm = {
  s3Endpoint: '', s3Region: 'eu-central-1', s3Bucket: '',
  s3AccessKey: '', s3SecretKey: '', s3BackupPrefix: 'timefeed/backups/', s3AttachmentPrefix: 'timefeed/attachments/', isActive: false,
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
