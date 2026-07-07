import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import { useAuthStore } from '../store/authStore';
import { useI18n } from '../i18n';
import { useAbsenceTypes } from '../hooks/useAbsenceTypes';

// ---- Contract (Phase 5) — Feldnamen exakt wie server/src/models/ExportProfile.ts
// bzw. server/src/services/exportService.ts (ExportData). ----

type ExportFormat = 'lodas' | 'lug' | 'csv' | 'xlsx';
const ALL_FORMATS: ExportFormat[] = ['lodas', 'lug', 'csv', 'xlsx'];

type PersonalNrSource = 'employeeNumber' | 'userId';
type OvertimeMode = 'none' | 'balance';

interface ExportProfile {
  format: ExportFormat;
  beraterNr: string;
  mandantenNr: string;
  personalNrSource: PersonalNrSource;
  lohnartNormal: string;
  lohnartOvertime: string;
  lohnartFeiertag: string;
  feiertagKennzeichen: string;
  // Mapping Abwesenheitsart-Key → Lohnart-Nummer (leer = wird nicht exportiert).
  absenceLohnarten: Record<string, string>;
  overtimeMode: OvertimeMode;
  exportOnlyClosed: boolean;
  decimalComma: boolean;
}

interface PreviewLohnart {
  lohnart: string;
  hours: number;
  source: string; // 'work' | 'overtime' | 'holiday' | Abwesenheits-Key
}

interface PreviewRow {
  personalNr: string;
  name: string;
  sollHours: number;
  istHours: number;
  saldoHours: number;
  overtimeHours: number;
  lohnarten: PreviewLohnart[];
}

interface PreviewData {
  rows: PreviewRow[];
  warnings: string[];
  closedAll: boolean;
}

/** Format-Werte tolerant auf die vier Server-Formate abbilden. */
function normalizeFormat(v: unknown): ExportFormat {
  const s = String(v || '').toLowerCase();
  if ((ALL_FORMATS as string[]).includes(s)) return s as ExportFormat;
  if (s.includes('lodas')) return 'lodas';
  if (s.includes('lohn') || s.includes('lug')) return 'lug';
  if (s.includes('xlsx') || s.includes('excel')) return 'xlsx';
  return 'csv';
}

/** Server-Antwort (GET /export-profile) normalisieren. */
function normalizeProfile(raw: any): ExportProfile {
  const p = raw?.profile ?? raw ?? {};
  const mapping: Record<string, string> = {};
  if (p.absenceLohnarten && typeof p.absenceLohnarten === 'object' && !Array.isArray(p.absenceLohnarten)) {
    for (const [k, v] of Object.entries(p.absenceLohnarten)) {
      if (v != null && String(v).trim()) mapping[k] = String(v);
    }
  }
  return {
    format: normalizeFormat(p.format),
    beraterNr: String(p.beraterNr ?? ''),
    mandantenNr: String(p.mandantenNr ?? ''),
    personalNrSource: p.personalNrSource === 'userId' ? 'userId' : 'employeeNumber',
    lohnartNormal: String(p.lohnartNormal ?? '200'),
    lohnartOvertime: String(p.lohnartOvertime ?? ''),
    lohnartFeiertag: String(p.lohnartFeiertag ?? ''),
    feiertagKennzeichen: String(p.feiertagKennzeichen ?? '1'),
    absenceLohnarten: mapping,
    overtimeMode: (p.overtimeMode === 'balance' ? 'balance' : 'none') as OvertimeMode,
    exportOnlyClosed: !!(p.exportOnlyClosed ?? true),
    decimalComma: p.decimalComma == null ? true : !!p.decimalComma,
  };
}

/** Stunden aus dem Preview lesen — akzeptiert xxxHours oder xxxMinutes (Server rechnet in Minuten). */
function hoursOf(r: any, base: 'soll' | 'ist' | 'saldo' | 'overtime'): number {
  const h = r?.[`${base}Hours`];
  if (h != null && !Number.isNaN(Number(h))) return Number(h);
  const m = r?.[`${base}Minutes`];
  if (m != null && !Number.isNaN(Number(m))) return Number(m) / 60;
  return 0;
}

/** GET /exports/preview normalisieren (Warnungen: Strings oder Objekte, inkl. NO_LOHNART). */
function normalizePreview(
  raw: any,
  t: (k: string, v?: Record<string, string | number>) => string,
  absenceLabel: (key: string) => string
): PreviewData {
  const rows: PreviewRow[] = (raw?.rows ?? raw?.preview ?? (Array.isArray(raw) ? raw : [])).map((r: any) => ({
    personalNr: String(r.personalNr ?? ''),
    name: String(r.name ?? ''),
    sollHours: hoursOf(r, 'soll'),
    istHours: hoursOf(r, 'ist'),
    saldoHours: hoursOf(r, 'saldo'),
    overtimeHours: hoursOf(r, 'overtime'),
    lohnarten: (Array.isArray(r.lohnarten) ? r.lohnarten : []).map((e: any) => ({
      lohnart: String(e.lohnart ?? ''),
      hours: Number(e.hours) || 0,
      source: String(e.source ?? ''),
    })),
  }));
  const warnings: string[] = (Array.isArray(raw?.warnings) ? raw.warnings : []).map((w: any) => {
    if (typeof w === 'string') return w;
    if (w?.reason === 'NO_EMPLOYEE_NUMBER') return t('exports.warnReason.NO_EMPLOYEE_NUMBER', { name: w.name || '' });
    if (w?.type === 'NO_LOHNART') {
      return t('exports.warnReason.NO_LOHNART', { label: absenceLabel(String(w.absenceKey || '')), days: Number(w.days) || 0 });
    }
    return w?.message || w?.reason || JSON.stringify(w);
  });
  return {
    rows,
    warnings,
    closedAll: raw?.closedAll !== false, // fehlt das Feld → nicht blockieren
  };
}

/** 'YYYY-MM' um n Monate verschieben. */
function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, (mo - 1) + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Lohn-Export (Phase 5): Exportprofil pflegen, Monats-Vorschau prüfen, Datei herunterladen. */
export default function Exports() {
  const { user } = useAuthStore();
  const { t, lang } = useI18n();
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  const { types: absenceTypes } = useAbsenceTypes();

  // Label einer Abwesenheitsart (Katalog; 'holiday' = Feiertag; sonst roher Key).
  const absenceLabel = useCallback((key: string): string => {
    if (key === 'holiday') return t('time.absence.holiday');
    return absenceTypes.find((x) => x.key === key)?.label || key;
  }, [absenceTypes, t]);

  // Quelle einer Lohnarten-Position lesbar machen (work/overtime/holiday/Abwesenheit).
  const sourceLabel = useCallback((source: string): string => {
    if (source === 'work') return t('exports.lohnartSource.work');
    if (source === 'overtime') return t('exports.lohnartSource.overtime');
    return absenceLabel(source);
  }, [absenceLabel, t]);

  const canAccess = !!user && (user.isSuperAdmin || ['admin', 'buchhaltung'].includes(user.role));

  // Firmen-Kontext: firmengebundene Nutzer → eigene Firma; Super-/Mandanten-Admins →
  // Auswahl oben (Optionen wie im Kopfzeilen-Wechsler, Vorbelegung aus tf-company-context).
  const [companyOptions, setCompanyOptions] = useState<{ id: number; name: string }[]>([]);
  const [canSwitchCompany, setCanSwitchCompany] = useState(false);
  const [companyId, setCompanyId] = useState<number | null>(user?.companyId ?? null);

  useEffect(() => {
    if (!canAccess) return;
    api.get('/companies/options')
      .then((r) => {
        const comps: { id: number; name: string }[] = r.data.companies || [];
        if (r.data.canSwitch && comps.length > 0) {
          setCompanyOptions(comps);
          setCanSwitchCompany(true);
          setCompanyId((cur) => {
            if (cur && comps.some((c) => c.id === cur)) return cur;
            const ctx = localStorage.getItem('tf-company-context') || '';
            if (ctx.startsWith('company:')) {
              const id = Number(ctx.slice(8));
              if (comps.some((c) => c.id === id)) return id;
            }
            return comps.length === 1 ? comps[0].id : null;
          });
        }
      })
      .catch(() => {});
  }, [canAccess]);

  // ---- Exportprofil ----
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<ExportProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await api.get('/export-profile', { params: { companyId } });
      setProfile(normalizeProfile(r.data));
      setProfileError('');
    } catch (error) {
      console.error('Error loading export profile:', error);
      setProfile(null);
      setProfileError(t('exports.profileLoadError'));
    }
  }, [companyId, t]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !companyId || savingProfile) return;
    setSavingProfile(true);
    try {
      // Mapping bereinigen: leere Lohnart-Nummern nicht mitschicken.
      const mapping: Record<string, string> = {};
      for (const [k, v] of Object.entries(profile.absenceLohnarten)) {
        if (String(v).trim()) mapping[k] = String(v).trim();
      }
      await api.put(`/export-profile?companyId=${companyId}`, {
        format: profile.format,
        beraterNr: profile.beraterNr.trim(),
        mandantenNr: profile.mandantenNr.trim(),
        personalNrSource: profile.personalNrSource,
        lohnartNormal: profile.lohnartNormal.trim(),
        lohnartOvertime: profile.lohnartOvertime.trim() || null,
        lohnartFeiertag: profile.lohnartFeiertag.trim() || null,
        feiertagKennzeichen: profile.feiertagKennzeichen.trim().slice(0, 1) || '1',
        absenceLohnarten: mapping,
        overtimeMode: profile.overtimeMode,
        exportOnlyClosed: profile.exportOnlyClosed,
        decimalComma: profile.decimalComma,
      });
      toast.success(t('exports.profileSaved'));
      // Vorschau invalidieren — Profiländerungen (Format, Abschluss-Pflicht) wirken auf den Export.
      setPreview(null);
    } catch (error: any) {
      console.error('Error saving export profile:', error);
      const d = error?.response?.data;
      toast.error(d?.errors?.[0]?.msg || d?.message || d?.error || t('exports.profileSaveError'));
    } finally {
      setSavingProfile(false);
    }
  };

  const setP = (patch: Partial<ExportProfile>) => setProfile((p) => (p ? { ...p, ...patch } : p));

  // ---- Export (Vorschau + Download) ----
  const [month, setMonth] = useState(() => shiftMonth(currentMonth(), -1)); // Standard: Vormonat
  const [formatOverride, setFormatOverride] = useState<'' | ExportFormat>('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  // Aufgeklappte Vorschau-Zeile (Lohnarten-Aufschlüsselung je Mitarbeiter).
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [force, setForce] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Kontext-/Monats-/Formatwechsel → alte Vorschau verwerfen.
  useEffect(() => { setPreview(null); setPreviewError(''); setForce(false); setExpandedRow(null); }, [companyId, month, formatOverride]);

  const effectiveFormat: ExportFormat = formatOverride || profile?.format || 'csv';

  const loadPreview = async () => {
    if (!companyId || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const params: Record<string, string | number> = { companyId, month };
      if (formatOverride) params.format = formatOverride;
      const r = await api.get('/exports/preview', { params });
      setPreview(normalizePreview(r.data, t, absenceLabel));
      setForce(false);
    } catch (error: any) {
      console.error('Error loading export preview:', error);
      const d = error?.response?.data;
      setPreview(null);
      setPreviewError(d?.message || d?.error || t('exports.previewError'));
    } finally {
      setPreviewLoading(false);
    }
  };

  // Roter Hinweis + force-Checkbox nur, wenn Abschluss verlangt wird und (mind. ein) Monat offen ist.
  const closedBlocked = !!preview && !preview.closedAll && !!profile?.exportOnlyClosed;

  const runExport = async () => {
    if (!companyId || downloading) return;
    if (!preview) { toast.error(t('exports.previewFirst')); return; }
    setDownloading(true);
    try {
      const params: Record<string, string | number> = { companyId, month };
      if (formatOverride) params.format = formatOverride;
      if (closedBlocked && force) params.force = 'true';
      const r = await api.get('/exports/run', { params, responseType: 'blob' });
      // Dateiname bevorzugt aus Content-Disposition, sonst aus Monat + Format ableiten.
      const cd: string = r.headers['content-disposition'] || '';
      const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const extByFormat: Record<ExportFormat, string> = { lodas: 'txt', lug: 'txt', csv: 'csv', xlsx: 'xlsx' };
      const fallback = `Lohnexport_${month}.${extByFormat[effectiveFormat]}`;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = cdMatch ? decodeURIComponent(cdMatch[1]) : fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('exports.downloadDone'));
    } catch (error: any) {
      console.error('Error running export:', error);
      // Fehlerantwort ist bei responseType 'blob' ein Blob → Text lesen und JSON parsen.
      let data: any = error?.response?.data;
      if (data instanceof Blob) {
        try { data = JSON.parse(await data.text()); } catch { data = null; }
      }
      const code = String(data?.code || data?.error || data?.message || '');
      if (error?.response?.status === 409 || code.includes('MONTH_NOT_CLOSED')) {
        toast.error(t('exports.monthNotClosedError'), { duration: 6000 });
      } else {
        toast.error(data?.message || data?.error || t('exports.downloadError'));
      }
    } finally {
      setDownloading(false);
    }
  };

  const fmtHours = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }, [month, locale]);

  const sums = useMemo(() => {
    const acc = { soll: 0, ist: 0, saldo: 0, overtime: 0 };
    for (const r of preview?.rows || []) {
      acc.soll += r.sollHours; acc.ist += r.istHours; acc.saldo += r.saldoHours; acc.overtime += r.overtimeHours;
    }
    return acc;
  }, [preview]);

  if (!canAccess) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">{t('exports.title')}</h1>
        <div className="card text-center">
          <ShieldCheckIcon className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{t('exports.accessDeniedTitle')}</h3>
          <p className="text-slate-600 dark:text-gray-400">{t('exports.accessDeniedText')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('exports.title')}</h1>
        {canSwitchCompany && (
          <div className="flex items-center gap-2">
            <label htmlFor="exports-company" className="text-sm font-medium text-slate-700 dark:text-gray-300">
              {t('exports.selectCompany')}
            </label>
            <select
              id="exports-company"
              value={companyId ?? ''}
              onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}
              className="input-field w-56"
            >
              <option value="">{t('exports.selectCompanyPlaceholder')}</option>
              {companyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-600 dark:text-gray-400 mb-4">{t('exports.subtitle')}</p>

      {!companyId ? (
        <div className="card text-center py-12">
          <TableCellsIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400">{t('exports.selectCompanyHint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ---- Exportprofil (einklappbar) ---- */}
          <div className="card p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setProfileOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
              aria-expanded={profileOpen}
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('exports.profileTitle')}</h2>
                <p className="text-sm text-slate-600 dark:text-gray-400">{t('exports.profileSubtitle')}</p>
              </div>
              <ChevronDownIcon className={clsx('h-5 w-5 text-slate-500 flex-shrink-0 transition-transform', profileOpen && 'rotate-180')} />
            </button>

            {profileOpen && (
              <div className="px-5 pb-5 border-t border-gray-200 dark:border-gray-700 pt-4">
                <ErrorBanner message={profileError} onRetry={loadProfile} />
                {!profile && !profileError ? (
                  <div className="animate-pulse space-y-3">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />)}
                  </div>
                ) : profile && (
                  <form onSubmit={saveProfile} className="space-y-5">
                    {/* Format */}
                    <div>
                      <p className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-2">{t('exports.format')}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {ALL_FORMATS.map((f) => (
                          <label
                            key={f}
                            className={clsx(
                              'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                              profile.format === f
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                : 'border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800'
                            )}
                          >
                            <input
                              type="radio"
                              name="export-format"
                              checked={profile.format === f}
                              onChange={() => setP({ format: f })}
                              className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                            />
                            <span>
                              <span className="block text-sm font-medium text-slate-800 dark:text-gray-200">{t(`exports.formatOption.${f}`)}</span>
                              <span className="block text-xs text-slate-500 dark:text-gray-400">{t(`exports.formatOption.${f}_hint`)}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* DATEV-Nummern */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">{t('exports.consultantNumber')}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={profile.beraterNr}
                          onChange={(e) => setP({ beraterNr: e.target.value })}
                          className="input-field tabular-nums"
                          placeholder="1234567"
                        />
                        <p className="text-xs text-slate-400 mt-1">{t('exports.consultantNumberHint')}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">{t('exports.clientNumber')}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={profile.mandantenNr}
                          onChange={(e) => setP({ mandantenNr: e.target.value })}
                          className="input-field tabular-nums"
                          placeholder="10001"
                        />
                        <p className="text-xs text-slate-400 mt-1">{t('exports.clientNumberHint')}</p>
                      </div>
                    </div>

                    {/* Personalnummern-Quelle + Lohnarten */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">{t('exports.personnelNumberSource')}</label>
                        <select
                          value={profile.personalNrSource}
                          onChange={(e) => setP({ personalNrSource: e.target.value as PersonalNrSource })}
                          className="input-field"
                        >
                          <option value="employeeNumber">{t('exports.personnelNumberSourceOption.employeeNumber')}</option>
                          <option value="userId">{t('exports.personnelNumberSourceOption.userId')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">{t('exports.wageTypeNormal')}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={profile.lohnartNormal}
                          onChange={(e) => setP({ lohnartNormal: e.target.value })}
                          className="input-field tabular-nums"
                          placeholder="200"
                        />
                        <p className="text-xs text-slate-400 mt-1">{t('exports.wageTypeNormalHint')}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">{t('exports.wageTypeOvertime')}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={profile.lohnartOvertime}
                          onChange={(e) => setP({ lohnartOvertime: e.target.value })}
                          className="input-field tabular-nums"
                          placeholder="210"
                        />
                        <p className="text-xs text-slate-400 mt-1">{t('exports.wageTypeOvertimeHint')}</p>
                      </div>
                    </div>

                    {/* Lohnartnummern je Abwesenheitsart + Feiertage */}
                    <div className="rounded-lg border border-slate-200 dark:border-gray-700 p-4">
                      <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 mb-1">{t('exports.absenceMappingTitle')}</p>
                      <p className="text-xs text-slate-500 dark:text-gray-400 mb-3">{t('exports.absenceMappingHint')}</p>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                          <thead>
                            <tr>
                              <th className="py-2 pr-4 text-left text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colAbsenceType')}</th>
                              <th className="py-2 pr-4 text-left text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colKennzeichen')}</th>
                              <th className="py-2 text-left text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colLohnartNr')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {absenceTypes.filter((x) => x.isActive).map((x) => (
                              <tr key={x.key}>
                                <td className="py-2 pr-4 whitespace-nowrap text-sm text-slate-800 dark:text-gray-200">
                                  <span className="inline-block h-3 w-3 rounded-full mr-2 align-middle" style={{ backgroundColor: x.color }} />
                                  {x.label}
                                </td>
                                <td className="py-2 pr-4 whitespace-nowrap text-sm font-mono text-slate-500 dark:text-gray-400">{x.datevKennzeichen}</td>
                                <td className="py-2">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    aria-label={t('exports.lohnartFor', { label: x.label })}
                                    value={profile.absenceLohnarten[x.key] ?? ''}
                                    onChange={(e) => setP({
                                      absenceLohnarten: { ...profile.absenceLohnarten, [x.key]: e.target.value },
                                    })}
                                    className="input-field tabular-nums w-32"
                                    placeholder="—"
                                  />
                                </td>
                              </tr>
                            ))}
                            {/* Feiertage (Sonderwert 'holiday') */}
                            <tr>
                              <td className="py-2 pr-4 whitespace-nowrap text-sm text-slate-800 dark:text-gray-200">
                                <span className="inline-block h-3 w-3 rounded-full mr-2 align-middle bg-green-500" />
                                {t('exports.holidayRow')}
                              </td>
                              <td className="py-2 pr-4">
                                <input
                                  type="text"
                                  aria-label={t('exports.holidayKennzeichen')}
                                  value={profile.feiertagKennzeichen}
                                  onChange={(e) => setP({ feiertagKennzeichen: e.target.value.slice(0, 1) })}
                                  className="input-field w-16 text-center font-mono"
                                  maxLength={1}
                                />
                              </td>
                              <td className="py-2">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  aria-label={t('exports.wageTypeHoliday')}
                                  value={profile.lohnartFeiertag}
                                  onChange={(e) => setP({ lohnartFeiertag: e.target.value })}
                                  className="input-field tabular-nums w-32"
                                  placeholder="—"
                                />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">{t('exports.wageTypeHolidayHint')}</p>
                    </div>

                    {/* Überstunden-Modus */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">{t('exports.overtimeMode')}</label>
                      <select
                        value={profile.overtimeMode}
                        onChange={(e) => setP({ overtimeMode: e.target.value as OvertimeMode })}
                        className="input-field"
                      >
                        <option value="none">{t('exports.overtimeModeOption.none')}</option>
                        <option value="balance">{t('exports.overtimeModeOption.balance')}</option>
                      </select>
                    </div>

                    {/* Toggles */}
                    <div className="rounded-lg border border-slate-200 dark:border-gray-700 p-4 space-y-4">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={profile.exportOnlyClosed}
                          onChange={(e) => setP({ exportOnlyClosed: e.target.checked })}
                          className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-700 dark:text-gray-300">{t('exports.onlyClosedMonths')}</span>
                          <span className="block text-xs text-slate-400">{t('exports.onlyClosedMonthsHint')}</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={profile.decimalComma}
                          onChange={(e) => setP({ decimalComma: e.target.checked })}
                          className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-700 dark:text-gray-300">{t('exports.decimalComma')}</span>
                          <span className="block text-xs text-slate-400">{t('exports.decimalCommaHint')}</span>
                        </span>
                      </label>
                    </div>

                    <div className="flex justify-end">
                      <button type="submit" disabled={savingProfile} className="btn-primary">
                        {savingProfile ? t('exports.saving') : t('exports.save')}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* ---- Export ---- */}
          <div className="card">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('exports.exportTitle')}</h2>
            <p className="text-sm text-slate-600 dark:text-gray-400 mb-4">{t('exports.exportSubtitle')}</p>

            <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
              <div>
                <label htmlFor="exports-month" className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">
                  {t('exports.month')}
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="btn-secondary p-2" aria-label={t('exports.prevMonth')} title={t('exports.prevMonth')}>
                    <ChevronLeftIcon className="h-5 w-5" />
                  </button>
                  <input
                    id="exports-month"
                    type="month"
                    value={month}
                    onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}
                    className="input-field w-44"
                  />
                  <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="btn-secondary p-2" aria-label={t('exports.nextMonth')} title={t('exports.nextMonth')}>
                    <ChevronRightIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="exports-format-override" className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">
                  {t('exports.formatOverride')}
                </label>
                <select
                  id="exports-format-override"
                  value={formatOverride}
                  onChange={(e) => setFormatOverride(e.target.value as '' | ExportFormat)}
                  className="input-field w-full sm:w-64"
                >
                  <option value="">
                    {t('exports.formatOverrideDefault', { format: t(`exports.formatOption.${profile?.format || 'csv'}`) })}
                  </option>
                  {ALL_FORMATS.map((f) => <option key={f} value={f}>{t(`exports.formatOption.${f}`)}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                <button type="button" onClick={loadPreview} disabled={previewLoading} className="btn-secondary flex items-center gap-1.5">
                  <TableCellsIcon className="h-5 w-5" />
                  {previewLoading ? t('exports.previewLoading') : t('exports.preview')}
                </button>
                <button type="button" onClick={runExport} disabled={downloading || !preview} className="btn-primary flex items-center gap-1.5">
                  <ArrowDownTrayIcon className="h-5 w-5" />
                  {downloading ? t('exports.downloading') : t('exports.download')}
                </button>
              </div>
            </div>

            <ErrorBanner message={previewError} onRetry={loadPreview} />

            {/* Warnungen (z. B. fehlende Personalnummern) */}
            {preview && preview.warnings.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">{t('exports.warningsTitle')}</p>
                    <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-200 space-y-0.5">
                      {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Monat nicht abgeschlossen + force */}
            {closedBlocked && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-700 p-3">
                <div className="flex items-start gap-2">
                  <LockClosedIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">{t('exports.notClosedTitle')}</p>
                    <p className="text-sm text-red-700 dark:text-red-200">{t('exports.notClosedText', { month: monthLabel })}</p>
                    <label className="flex items-center gap-2 mt-3">
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <span className="text-sm font-medium text-red-800 dark:text-red-300">{t('exports.forceLabel')}</span>
                    </label>
                    <p className="text-xs text-red-600 dark:text-red-300 mt-1 ml-6">{t('exports.forceHint')}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Vorschau-Tabelle */}
            {preview && (
              preview.rows.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-gray-400 py-6 text-center">{t('exports.previewEmpty')}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-slate-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colPersonalNr')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colName')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colSoll')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colIst')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colSaldo')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 dark:text-gray-400 uppercase tracking-wider">{t('exports.colOvertime')}</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-transparent divide-y divide-gray-200 dark:divide-gray-700">
                      {preview.rows.map((r, i) => (
                        <React.Fragment key={`${r.personalNr}-${i}`}>
                          <tr
                            className="hover:bg-slate-50 dark:hover:bg-gray-800 cursor-pointer"
                            onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                            title={t('exports.toggleLohnarten')}
                          >
                            <td className="px-4 py-2.5 whitespace-nowrap text-sm font-mono text-slate-700 dark:text-gray-300">{r.personalNr || '–'}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">{r.name}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums text-slate-700 dark:text-gray-300">{fmtHours(r.sollHours)}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums text-slate-700 dark:text-gray-300">{fmtHours(r.istHours)}</td>
                            <td className={clsx('px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums', r.saldoHours < 0 ? 'text-red-600' : 'text-slate-700 dark:text-gray-300')}>{fmtHours(r.saldoHours)}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums text-slate-700 dark:text-gray-300">{fmtHours(r.overtimeHours)}</td>
                            <td className="px-2 py-2.5 text-right">
                              <ChevronDownIcon className={clsx('h-4 w-4 inline text-slate-500 transition-transform', expandedRow === i && 'rotate-180')} />
                            </td>
                          </tr>
                          {expandedRow === i && (
                            <tr>
                              <td colSpan={7} className="px-6 py-3 bg-slate-50 dark:bg-gray-800/50">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-gray-400 mb-2">{t('exports.lohnartenTitle')}</p>
                                {r.lohnarten.length === 0 ? (
                                  <p className="text-sm text-slate-500 dark:text-gray-400">{t('exports.lohnartenEmpty')}</p>
                                ) : (
                                  <table className="text-sm">
                                    <tbody>
                                      {r.lohnarten.map((e, li) => (
                                        <tr key={li} data-testid="lohnart-row">
                                          <td className="pr-6 py-0.5 font-mono text-slate-700 dark:text-gray-300">{t('exports.lohnartPrefix')} {e.lohnart}</td>
                                          <td className="pr-6 py-0.5 text-slate-600 dark:text-gray-400">{sourceLabel(e.source)}</td>
                                          <td className="py-0.5 text-right tabular-nums font-medium text-slate-900 dark:text-gray-100">{fmtHours(e.hours)} h</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-600">
                      <tr>
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-gray-100" colSpan={2}>{t('exports.sumRow')}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums font-semibold text-slate-900 dark:text-gray-100">{fmtHours(sums.soll)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums font-semibold text-slate-900 dark:text-gray-100">{fmtHours(sums.ist)}</td>
                        <td className={clsx('px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums font-semibold', sums.saldo < 0 ? 'text-red-600' : 'text-slate-900 dark:text-gray-100')}>{fmtHours(sums.saldo)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right tabular-nums font-semibold text-slate-900 dark:text-gray-100">{fmtHours(sums.overtime)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
