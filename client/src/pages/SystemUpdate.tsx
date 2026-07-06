import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { ArrowPathIcon, ArrowDownTrayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { APP_VERSION } from '../constants/version';
import { useConfirm } from '../components/common/ConfirmProvider';
import { useT } from '../i18n';

interface UpdateInfo {
  currentVersion: string;
  upToDate: boolean;
  behind: number;
  commits: string[];
  current: string;
  remote: string;
}

export default function SystemUpdate() {
  const t = useT();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { confirm } = useConfirm();

  const check = async () => {
    setChecking(true);
    try {
      const { data } = await api.get('/system/update-check');
      setInfo(data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('systemUpdate.checkError'));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { check(); }, []);

  const runUpdate = async () => {
    if (!(await confirm({ title: t('systemUpdate.confirmTitle'), message: t('systemUpdate.confirmMsg'), confirmText: t('systemUpdate.confirmBtn') }))) return;
    setUpdating(true);
    const oldVersion = info?.currentVersion;
    try {
      await api.post('/system/update');
      toast.success(t('systemUpdate.started'));
      // Auf Server-Neustart warten: /health pollen.
      let tries = 0;
      const id = window.setInterval(async () => {
        tries++;
        try {
          const res = await fetch('/health', { cache: 'no-cache' });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.version && data.version !== oldVersion) {
              window.clearInterval(id);
              setUpdating(false);
              toast.success(t('systemUpdate.completed', { version: data.version }));
              check();
            }
          }
        } catch { /* Server startet neu */ }
        if (tries > 60) {
          window.clearInterval(id);
          setUpdating(false);
          toast(t('systemUpdate.maybeReload'), { icon: 'ℹ️' });
        }
      }, 3000);
    } catch (error: any) {
      setUpdating(false);
      toast.error(error.response?.data?.error || t('systemUpdate.startError'));
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-slate-900 mb-4">{t('systemUpdate.heading')}</h1>

      <div className="card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">{t('systemUpdate.installedVersion')}</p>
            <p className="text-2xl font-bold text-slate-900">v{info?.currentVersion || APP_VERSION}</p>
          </div>
          <button onClick={check} disabled={checking || updating} className="btn-secondary inline-flex items-center gap-2">
            <ArrowPathIcon className={`h-5 w-5 ${checking ? 'animate-spin' : ''}`} />
            {t('systemUpdate.checkButton')}
          </button>
        </div>

        {info && info.upToDate && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-4 text-green-800">
            <CheckCircleIcon className="h-5 w-5" />
            {t('systemUpdate.upToDate')}
          </div>
        )}

        {info && !info.upToDate && (
          <div className="space-y-3">
            <div className="rounded-lg bg-primary-50 border border-primary-200 p-4 text-primary-800">
              <p className="font-medium">{t('systemUpdate.updatesAvailable', { count: info.behind })}</p>
              <p className="text-sm">{t('systemUpdate.currentState', { current: info.current, remote: info.remote })}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 mb-1">{t('systemUpdate.changes')}</p>
              <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1 max-h-60 overflow-y-auto">
                {info.commits.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
            <button onClick={runUpdate} disabled={updating} className="btn-primary inline-flex items-center gap-2">
              {updating ? <ArrowPathIcon className="h-5 w-5 animate-spin" /> : <ArrowDownTrayIcon className="h-5 w-5" />}
              {updating ? t('systemUpdate.updateRunning') : t('systemUpdate.updateNow')}
            </button>
          </div>
        )}

        <p className="text-xs text-slate-400">
          {t('systemUpdate.footnote')}
        </p>
      </div>
    </div>
  );
}
