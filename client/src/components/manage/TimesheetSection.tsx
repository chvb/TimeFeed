import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownTrayIcon, DocumentIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useT, useI18n } from '../../i18n';
import { useConfirm } from '../common/ConfirmProvider';

interface TimesheetDoc {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  periodStart: string;
  periodEnd: string;
  note?: string | null;
  createdAt?: string;
  uploadedBy?: { firstName?: string; lastName?: string } | null;
}

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Stundenzettel-Abschnitt der Detail-Ansicht: Upload, Liste, Download, Löschen. */
export default function TimesheetSection({ userId, month, canDelete }: { userId: number; month: string; canDelete: boolean }) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const { confirm } = useConfirm();
  const [docs, setDocs] = useState<TimesheetDoc[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [periodStart, setPeriodStart] = useState(`${month}-01`);
  const [periodEnd, setPeriodEnd] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      // Server-Contract: Antwort { documents }
      const r = await api.get('/timesheets', { params: { userId, month } });
      setDocs(r.data.documents || []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [userId, month]);

  useEffect(() => {
    // Zeitraum auf den gewählten Monat vorbelegen (Monatsende korrekt berechnen).
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    setPeriodStart(`${month}-01`);
    setPeriodEnd(`${month}-${String(lastDay).padStart(2, '0')}`);
    load();
  }, [month, load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !periodStart || !periodEnd) return;
    if (file.size > MAX_SIZE) { toast.error(t('manage.timesheetTooLarge')); return; }
    if (!ALLOWED.includes(file.type)) { toast.error(t('manage.timesheetWrongType')); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('userId', String(userId));
    fd.append('periodStart', periodStart);
    fd.append('periodEnd', periodEnd);
    if (note.trim()) fd.append('note', note.trim());
    try {
      setUploading(true);
      await api.post('/timesheets', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(t('manage.timesheetUploadSuccess'));
      setNote('');
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('manage.timesheetUploadError'));
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc: TimesheetDoc) => {
    try {
      const r = await api.get(`/timesheets/${doc.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('manage.timesheetDownloadError'));
    }
  };

  const remove = async (doc: TimesheetDoc) => {
    const ok = await confirm({ message: t('manage.timesheetDeleteConfirm', { name: doc.fileName }), danger: true });
    if (!ok) return;
    try {
      await api.delete(`/timesheets/${doc.id}`);
      toast.success(t('manage.timesheetDeleteSuccess'));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('manage.timesheetDeleteError'));
    }
  };

  const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(locale);

  return (
    <div className="card mt-4">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">{t('manage.timesheetsTitle')}</h2>

      {/* Upload-Formular */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end mb-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor={`ts-file-${userId}`}>{t('manage.timesheetFile')}</label>
          <input id={`ts-file-${userId}`} ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm text-slate-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 file:text-sm file:font-medium hover:file:bg-primary-100" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor={`ts-start-${userId}`}>{t('manage.timesheetPeriodStart')}</label>
          <input id={`ts-start-${userId}`} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="input-field w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1" htmlFor={`ts-end-${userId}`}>{t('manage.timesheetPeriodEnd')}</label>
          <input id={`ts-end-${userId}`} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="input-field w-full" />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('manage.timesheetNotePlaceholder')}
            className="input-field w-full"
            aria-label={t('manage.timesheetNote')}
          />
          <button type="button" onClick={upload} disabled={uploading} className="btn-primary whitespace-nowrap disabled:opacity-50">
            {t('manage.timesheetUpload')}
          </button>
        </div>
      </div>

      {/* Liste */}
      {loadError ? (
        <p className="text-sm text-red-600">{t('manage.timesheetLoadError')}</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-gray-400">{t('manage.timesheetEmpty')}</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {docs.map((doc) => (
            <li key={doc.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <DocumentIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{doc.fileName}</p>
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  {fmtDate(doc.periodStart)} – {fmtDate(doc.periodEnd)} · {fmtSize(doc.size)}
                  {doc.uploadedBy && ` · ${t('manage.timesheetUploadedBy')} ${doc.uploadedBy.firstName || ''} ${doc.uploadedBy.lastName || ''}`.trimEnd()}
                  {doc.note && ` · ${doc.note}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => download(doc)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500" title={t('manage.timesheetDownload')} aria-label={t('manage.timesheetDownload')}>
                  <ArrowDownTrayIcon className="h-5 w-5" />
                </button>
                {canDelete && (
                  <button type="button" onClick={() => remove(doc)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500" title={t('manage.timesheetDelete')} aria-label={t('manage.timesheetDelete')}>
                    <TrashIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
