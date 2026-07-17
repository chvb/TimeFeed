import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Cog6ToothIcon,
  BuildingOfficeIcon,
  BellIcon,
  ShieldCheckIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArchiveBoxIcon,
  ClipboardDocumentCheckIcon,
  TrashIcon,
  ServerStackIcon,
  GlobeAltIcon,
  ClockIcon,
  LinkIcon,
  CheckCircleIcon,
  UsersIcon, KeyIcon} from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/authStore';
import SystemUpdate from './SystemUpdate';
import StorageSettings from './StorageSettings';
import ApiKeysPage from './ApiKeys';
import TrashSettings from './TrashSettings';
import api from '../lib/api';
import { matchesSearch } from '../lib/normalize';
import { useConfirm } from '../components/common/ConfirmProvider';
import Select from '../components/common/Select';
import AbsenceTypesSection from '../components/settings/AbsenceTypesSection';
import { useT } from '../i18n';

interface SystemSettings {
  companyName: string;
  workingDays: string[];
  hoursPerWorkday: number;
  emailNotifications: boolean;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  publicUrl?: string;
  // Security settings
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSpecialChars: boolean;
  sessionDurationHours: number;
  nfcPinRequired?: boolean;
  passwordExpiryDays: number;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  // Zeiterfassung
  breakMode: 'auto' | 'manual' | 'combined';
  breakAfter6hMinutes: number;
  breakAfter9hMinutes: number;
  autoCapEnabled: boolean;
  autoCapTime: string;
  arbzgWarningsEnabled: boolean;
  arbzgMaxDailyMinutes: number;
  arbzgMinRestMinutes: number;
  gpsRequired: boolean;
  gpsMode?: string;
  gpsMaxAccuracy?: number;
  terminalAlertEnabled?: boolean;
  terminalAlertMinutes?: number;
  terminalAlertEmails?: string | null;
  terminalPingSeconds?: number;
  sendTimesheetOnClose?: boolean;
  // Automatisches Backup-System (nur globale Vorlage relevant)
  autoBackupEnabled?: boolean;
  autoBackupTime?: string;
  backupRetentionDays?: number;
  backupNotifyOnFailure?: boolean;
  // Periodische Berichts-Mails (firmen-scoped)
  reportDailyEnabled?: boolean;
  reportMonthlyEnabled?: boolean;
  reportQuarterlyEnabled?: boolean;
  reportYearlyEnabled?: boolean;
  reportRecipients?: string | null;
}

// Status des automatischen Backup-Systems (GET /api/storage/auto-backup-status)
interface AutoBackupStatusInfo {
  lastStatus: {
    lastRunAt: string;
    ok: boolean;
    target: 'local' | 's3+local';
    sizeBytes: number;
    error?: string;
    durationMs: number;
  } | null;
  nextRunAt: string | null;
  settings: {
    autoBackupEnabled: boolean;
    autoBackupTime: string;
    backupRetentionDays: number;
    backupNotifyOnFailure: boolean;
  };
}

interface EmailSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
  fromEmail: string;
  fromName: string;
  isActive: boolean;
}

interface AuditLog {
  id: number;
  userId?: number;
  action: string;
  category: string;
  entity?: string;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  createdAt: string;
  user?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  };
}

const Settings: React.FC = () => {
  const t = useT();
  const { user } = useAuthStore();
  // Firmen-Kontext kommt aus dem globalen Header-Wechsler ('tf-company-context');
  // bearbeitet werden die Einstellungen dieser Firma ('' = globale Vorlage).
  const companyQuery = (() => {
    const cc = localStorage.getItem('tf-company-context') || '';
    // Einstellungen sind firmenspezifisch → nur bei Firmen-Auswahl scopen (Mandant/Alle = globale Vorlage).
    return cc.startsWith('company:') ? `?companyId=${cc.slice(8)}` : '';
  })();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'general');
  // Tab über ?tab=… ansteuerbar (Deep-Link aus dem Einstellungs-Untermenü).
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t) setActiveTab(t);
  }, [searchParams]);
  const [settings, setSettings] = useState<SystemSettings>({
    companyName: 'TimeFeed GmbH',
    workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    hoursPerWorkday: 8,
    emailNotifications: true,
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    companyWebsite: '',
    publicUrl: '',
    // Security defaults
    passwordMinLength: 8,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNumbers: true,
    passwordRequireSpecialChars: true,
    sessionDurationHours: 8,
    nfcPinRequired: false,
    passwordExpiryDays: 90,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    // Zeiterfassung defaults
    breakMode: 'auto',
    breakAfter6hMinutes: 30,
    breakAfter9hMinutes: 45,
    autoCapEnabled: true,
    autoCapTime: '23:00',
    arbzgWarningsEnabled: true,
    arbzgMaxDailyMinutes: 600,
    arbzgMinRestMinutes: 660,
    gpsRequired: false,
    gpsMode: 'optional',
    gpsMaxAccuracy: 100,
    terminalAlertEnabled: false,
    terminalAlertMinutes: 15,
    terminalAlertEmails: '',
    terminalPingSeconds: 20,
    sendTimesheetOnClose: false,
    autoBackupEnabled: true,
    autoBackupTime: '02:30',
    backupRetentionDays: 30,
    backupNotifyOnFailure: true,
    reportDailyEnabled: false,
    reportMonthlyEnabled: false,
    reportQuarterlyEnabled: false,
    reportYearlyEnabled: false,
    reportRecipients: ''
  });
  const [emailSettings, setEmailSettings] = useState<EmailSettings>({
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpSecure: false,
    fromEmail: '',
    fromName: 'TimeFeed',
    isActive: false
  });
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm } = useConfirm();
  const [saved, setSaved] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditActionFilter, setAuditActionFilter] = useState<string>('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<string>('');
  const [expandedAuditEntry, setExpandedAuditEntry] = useState<number | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditSortField, setAuditSortField] = useState<string>('createdAt');
  const [auditSortDir, setAuditSortDir] = useState<'asc' | 'desc'>('desc');
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupRestoring, setBackupRestoring] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  // Automatisches Backup-System (Abschnitt im Tab „Backup"; wirkt IMMER auf die globale Vorlage)
  const [autoBackupStatus, setAutoBackupStatus] = useState<AutoBackupStatusInfo | null>(null);
  const [autoBackupLoading, setAutoBackupLoading] = useState(false);
  const [autoBackupSaving, setAutoBackupSaving] = useState(false);
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);

  // UrlaubsFeed-Kopplung (Tab „Integrationen"). Feldnamen laut Server
  // (integration.controller.ts): urlaubsfeedUrl, urlaubsfeedApiKey, hasKey,
  // syncEnabled, lastSyncAt, lastSyncResult (AbsenceSyncResult).
  interface UfSyncResult {
    ok?: boolean;
    fetched?: number;          // geholte Abwesenheiten
    matchedUsers?: number;     // zugeordnete Mitarbeiter
    unmatchedEmails?: string[]; // unbekannte E-Mails (max. 20)
    error?: string;
    syncedAt?: string;
  }
  const [ufUrl, setUfUrl] = useState('');
  const [ufApiKey, setUfApiKey] = useState('');           // leer = unverändert lassen
  const [ufHasKey, setUfHasKey] = useState(false);
  const [ufSyncEnabled, setUfSyncEnabled] = useState(false);
  const [ufLastSyncAt, setUfLastSyncAt] = useState<string | null>(null);
  const [ufLastResult, setUfLastResult] = useState<UfSyncResult | null>(null);
  const [ufSaving, setUfSaving] = useState(false);
  const [ufTesting, setUfTesting] = useState(false);
  const [ufSyncing, setUfSyncing] = useState(false);

  // Mitarbeiter-Abgleich UrlaubsFeed → TimeFeed (Pull mit Auswahl). Shapes laut
  // Server (integration.controller.ts): listRemoteUsers / importUsers.
  interface UfRemoteUser {
    firstName: string;
    lastName: string;
    email: string;
    employeeNumber?: string | null;
    groupName?: string | null;
    status: 'new' | 'exists' | 'diff';
    diff?: { firstName?: string; lastName?: string; employeeNumber?: string };
  }
  interface UfImportResult {
    created: number;
    updated: number;
    skipped: number;
    errors: { email: string; reason: string }[];
  }
  const [ufUsers, setUfUsers] = useState<UfRemoteUser[] | null>(null);
  const [ufUsersLoading, setUfUsersLoading] = useState(false);
  const [ufSelected, setUfSelected] = useState<Set<string>>(new Set());
  const [ufUpdateExisting, setUfUpdateExisting] = useState(false);
  const [ufSendWelcome, setUfSendWelcome] = useState(false);
  const [ufImporting, setUfImporting] = useState(false);
  const [ufImportResult, setUfImportResult] = useState<UfImportResult | null>(null);
  const [ufCompanies, setUfCompanies] = useState<{ id: number; name: string }[]>([]);
  const [ufCompanyId, setUfCompanyId] = useState('');
  // Akteure ohne feste Firma (Super-Admin/Mandanten-Admin) müssen für NEUE Nutzer
  // eine Zielfirma wählen (Server: resolveWritableCompanyId-Muster wie bei Terminals).
  const ufNeedsCompany = !user?.companyId;

  const loadUfUsers = async (resetResult = true) => {
    setUfUsersLoading(true);
    if (resetResult) setUfImportResult(null);
    try {
      const r = await api.get('/integrations/urlaubsfeed/users');
      const list: UfRemoteUser[] = r.data?.users || [];
      setUfUsers(list);
      // Neue Mitarbeiter vorauswählen — das ist der häufigste Import-Fall.
      setUfSelected(new Set(list.filter((u) => u.status === 'new').map((u) => u.email.toLowerCase())));
      if (ufNeedsCompany && ufCompanies.length === 0) {
        const c = await api.get('/companies/options');
        setUfCompanies(c.data?.companies || []);
      }
    } catch (error: any) {
      const detail = error.response?.data?.message || error.response?.data?.error || '';
      toast.error(detail ? `${t('integrations.userSync.loadError')}: ${detail}` : t('integrations.userSync.loadError'));
    } finally {
      setUfUsersLoading(false);
    }
  };

  const toggleUfUser = (email: string) => {
    setUfSelected((prev) => {
      const next = new Set(prev);
      const key = email.toLowerCase();
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleUfAll = () => {
    setUfSelected((prev) => {
      const all = (ufUsers || []).map((u) => u.email.toLowerCase());
      return prev.size === all.length ? new Set<string>() : new Set(all);
    });
  };

  // Tooltip-Text für den „Abweichend"-Badge: welche Felder weichen ab (Remote-Wert).
  const ufDiffTitle = (diff?: UfRemoteUser['diff']): string | undefined => {
    if (!diff) return undefined;
    const labels: Record<string, string> = {
      firstName: t('integrations.userSync.fieldFirstName'),
      lastName: t('integrations.userSync.fieldLastName'),
      employeeNumber: t('integrations.userSync.fieldEmployeeNumber'),
    };
    return Object.entries(diff).map(([k, v]) => `${labels[k] || k}: ${v}`).join(', ');
  };

  const importUfUsers = async () => {
    const emails = Array.from(ufSelected);
    if (emails.length === 0) return;
    const hasNew = (ufUsers || []).some((u) => u.status === 'new' && ufSelected.has(u.email.toLowerCase()));
    if (hasNew && ufNeedsCompany && !ufCompanyId) {
      toast.error(t('integrations.userSync.companyRequired'));
      return;
    }
    const ok = await confirm({
      title: t('integrations.userSync.confirmTitle'),
      message: t('integrations.userSync.confirmMsg', { count: emails.length }),
      confirmText: t('integrations.userSync.confirmBtn'),
    });
    if (!ok) return;
    setUfImporting(true);
    try {
      const body: Record<string, unknown> = { emails, updateExisting: ufUpdateExisting, sendWelcome: ufSendWelcome };
      if (ufCompanyId) body.companyId = Number(ufCompanyId);
      const r = await api.post('/integrations/urlaubsfeed/import-users', body);
      const result: UfImportResult = r.data || { created: 0, updated: 0, skipped: 0, errors: [] };
      setUfImportResult(result);
      toast.success(t('integrations.userSync.toastDone', { created: result.created ?? 0, updated: result.updated ?? 0 }));
      // Liste neu laden, damit die Status-Badges den neuen Stand zeigen.
      await loadUfUsers(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.response?.data?.error || t('integrations.userSync.importError'));
    } finally {
      setUfImporting(false);
    }
  };

  const applyUfData = (d: any) => {
    setUfUrl(d.urlaubsfeedUrl || '');
    setUfHasKey(!!d.hasKey);
    setUfSyncEnabled(!!d.syncEnabled);
    setUfLastSyncAt(d.lastSyncAt || null);
    setUfLastResult(d.lastSyncResult && typeof d.lastSyncResult === 'object' ? d.lastSyncResult : null);
  };

  const loadIntegration = async () => {
    try {
      const r = await api.get('/integrations/urlaubsfeed');
      applyUfData(r.data || {});
    } catch (error: any) {
      // 404 = noch nicht konfiguriert → leeres Formular, kein Fehler-Toast.
      if (error.response?.status !== 404) {
        toast.error(error.response?.data?.message || error.response?.data?.error || t('integrations.urlaubsfeed.loadError'));
      }
    }
  };

  const saveIntegration = async () => {
    if (ufUrl && !/^https:\/\/.+/i.test(ufUrl.trim())) {
      toast.error(t('integrations.urlaubsfeed.urlInvalid'));
      return;
    }
    setUfSaving(true);
    try {
      const payload: Record<string, unknown> = { urlaubsfeedUrl: ufUrl.trim() || null, syncEnabled: ufSyncEnabled };
      if (ufApiKey) payload.urlaubsfeedApiKey = ufApiKey; // Feld weglassen = Key unverändert
      const r = await api.put('/integrations/urlaubsfeed', payload);
      applyUfData(r.data || {});
      setUfApiKey('');
      toast.success(t('integrations.urlaubsfeed.saved'));
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.response?.data?.error || t('integrations.urlaubsfeed.saveError'));
    } finally {
      setUfSaving(false);
    }
  };

  const testIntegration = async () => {
    setUfTesting(true);
    try {
      // Antwort ist { ok, tenant?, status?, message? } — auch bei ok:false mit HTTP 200.
      const r = await api.post('/integrations/urlaubsfeed/test');
      if (r.data?.ok) {
        const detail = r.data?.tenant ? `Tenant: ${r.data.tenant}` : '';
        toast.success(detail ? `${t('integrations.urlaubsfeed.testSuccess')} (${detail})` : t('integrations.urlaubsfeed.testSuccess'));
      } else {
        const detail = r.data?.message || (r.data?.status ? `HTTP ${r.data.status}` : '');
        toast.error(detail ? `${t('integrations.urlaubsfeed.testError')}: ${detail}` : t('integrations.urlaubsfeed.testError'));
      }
    } catch (error: any) {
      const detail = error.response?.data?.message || error.response?.data?.error || error.message || '';
      toast.error(detail ? `${t('integrations.urlaubsfeed.testError')}: ${detail}` : t('integrations.urlaubsfeed.testError'));
    } finally {
      setUfTesting(false);
    }
  };

  const syncIntegration = async () => {
    setUfSyncing(true);
    try {
      // Antwort ist direkt das AbsenceSyncResult (bei ok:false HTTP 502 → catch).
      const r = await api.post('/integrations/urlaubsfeed/sync');
      setUfLastResult(r.data || null);
      setUfLastSyncAt(r.data?.syncedAt || new Date().toISOString());
      toast.success(t('integrations.urlaubsfeed.syncSuccess'));
    } catch (error: any) {
      const d = error.response?.data;
      if (d && typeof d === 'object' && d.syncedAt) { setUfLastResult(d); setUfLastSyncAt(d.syncedAt); }
      toast.error(d?.error || d?.message || t('integrations.urlaubsfeed.syncError'));
    } finally {
      setUfSyncing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'integrations') loadIntegration();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    // Konfiguration
    { id: 'general', name: 'Allgemein', icon: Cog6ToothIcon },
    { id: 'time', name: 'Zeiterfassung', icon: ClockIcon },
    { id: 'company', name: 'Unternehmen', icon: BuildingOfficeIcon },
    { id: 'email', name: 'E-Mail', icon: EnvelopeIcon, superAdmin: true },
    { id: 'notifications', name: 'Benachrichtigungen', icon: BellIcon },
    { id: 'security', name: 'Sicherheit', icon: ShieldCheckIcon, superAdmin: true },
    { id: 'integrations', name: 'Integrationen', icon: LinkIcon },
    { id: 'apiKeys', name: 'API-Schlüssel', icon: KeyIcon, superAdmin: true },
    // Auswertung & Export
    { id: 'audit', name: 'Audit Log', icon: ClipboardDocumentCheckIcon },
    // System & Wartung
    { id: 'backup', name: 'Backup', icon: ArchiveBoxIcon, superAdmin: true },
    { id: 'storage', name: 'Speicher', icon: ServerStackIcon, superAdmin: true },
    { id: 'system', name: 'System', icon: GlobeAltIcon, superAdmin: true },
    { id: 'trash', name: 'Papierkorb', icon: TrashIcon, superAdmin: true },
    { id: 'updates', name: 'Updates', icon: ArrowPathIcon, superAdmin: true }
  ].filter((tab) => !(tab as any).superAdmin || user?.isSuperAdmin);

  // Direktaufruf eines gesperrten Tabs (z. B. ?tab=trash) für Nicht-Super-Admins abfangen.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab('general');
  }, [activeTab, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settingsResponse, emailResponse] = await Promise.all([
          api.get(`/settings${companyQuery}`),
          // /settings/email ist superAdmin-only → Firmen-Admins bekommen 403.
          // Das darf das Laden der übrigen Einstellungen nicht verhindern
          // (sonst zeigt die Seite für Firmen-Admins nur Defaults an).
          api.get('/settings/email').catch(() => null)
        ]);

        setSettings(settingsResponse.data);
        if (emailResponse) setEmailSettings(emailResponse.data);
      } catch (error: any) {
        console.error('Error loading settings:', error);
        toast.error(error.response?.data?.error || t('settings.loadError'));
      }
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/settings${companyQuery}`, settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast.success(t('settings.savedToast'));
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast.error(error.response?.data?.error || t('settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Berichts-Mails: Testversand („Jetzt senden") -------------------------
  // Sendet den Bericht der jeweils LETZTEN abgelaufenen Periode sofort an die
  // konfigurierten Empfänger (Server setzt den Doppelversand-Merker NICHT).
  const [reportSending, setReportSending] = useState<string | null>(null);
  const sendTestReport = async (period: 'day' | 'month' | 'quarter' | 'year') => {
    setReportSending(period);
    try {
      const body: Record<string, unknown> = { period };
      // Firmen-Kontext aus dem Kopf-Wechsler (Super-/Tenant-Admin) mitgeben.
      const m = companyQuery.match(/companyId=(\d+)/);
      if (m) body.companyId = Number(m[1]);
      const r = await api.post('/reports/send-test', body);
      if (r.data?.sent) {
        toast.success(t('settings.notifications.reports.sendSuccess', { count: r.data.recipients ?? 0 }));
      } else if (r.data?.reason === 'SMTP_INACTIVE') {
        toast.error(t('settings.notifications.reports.smtpInactive'));
      } else if (r.data?.reason === 'NO_RECIPIENTS') {
        toast.error(t('settings.notifications.reports.noRecipients'));
      } else {
        toast.error(t('settings.notifications.reports.sendError'));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.response?.data?.error || t('settings.notifications.reports.sendError'));
    } finally {
      setReportSending(null);
    }
  };

  const handleSaveEmailSettings = async () => {
    setIsSaving(true);
    try {
      await api.put('/settings/email', emailSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving email settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress) return;
    setSendingTestEmail(true);
    try {
      await api.post('/settings/email/test', { email: testEmailAddress });
      toast.success(t('settings.email.testSuccess'));
    } catch (error) {
      console.error('Error sending test email:', error);
      toast.error(t('settings.email.testError'));
    } finally {
      setSendingTestEmail(false);
    }
  };

  const toggleAuditSort = (f: string) => {
    setAuditSortDir((prev) => (auditSortField === f ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setAuditSortField(f);
  };
  const auditArrow = (f: string) => (auditSortField === f ? (auditSortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const auditSortVal = (l: any): any => {
    switch (auditSortField) {
      case 'user': return (l.user ? `${l.user.firstName} ${l.user.lastName}` : '').toLowerCase();
      case 'action': return (l.action || '').toLowerCase();
      case 'category': return (l.category || '').toLowerCase();
      case 'status': return l.success ? 1 : 0;
      case 'createdAt':
      default: return new Date(l.createdAt).getTime();
    }
  };
  const displayedAuditLogs = (auditLogs || [])
    .filter((l: any) => {
      if (!auditSearch.trim()) return true;
      const hay = `${l.user ? l.user.firstName + ' ' + l.user.lastName : ''} ${l.action || ''} ${l.category || ''} ${l.entity || ''}`;
      return matchesSearch(hay, auditSearch);
    })
    .sort((a: any, b: any) => {
      const av = auditSortVal(a); const bv = auditSortVal(b);
      if (av < bv) return auditSortDir === 'asc' ? -1 : 1;
      if (av > bv) return auditSortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const loadAuditLogs = async (page = 1) => {
    try {
      setAuditLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });
      if (auditActionFilter) params.append('action', auditActionFilter);
      if (auditCategoryFilter) params.append('category', auditCategoryFilter);
      
      const response = await api.get(`/audit?${params.toString()}`);
      setAuditLogs(response.data.logs);
      setAuditTotal(response.data.pagination.total);
      setAuditPage(page);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setAuditLoading(false);
    }
  };

  // ---- Automatisches Backup-System (globale Vorlage) -----------------------
  const loadAutoBackupStatus = async (syncForm = false) => {
    setAutoBackupLoading(true);
    try {
      const r = await api.get('/storage/auto-backup-status');
      setAutoBackupStatus(r.data);
      // Formularfelder aus der GLOBALEN Vorlage übernehmen (der allgemeine
      // Settings-Load kann firmenspezifisch gescoped sein).
      if (syncForm && r.data?.settings) {
        setSettings((prev) => ({
          ...prev,
          autoBackupEnabled: r.data.settings.autoBackupEnabled,
          autoBackupTime: r.data.settings.autoBackupTime,
          backupRetentionDays: r.data.settings.backupRetentionDays,
          backupNotifyOnFailure: r.data.settings.backupNotifyOnFailure,
        }));
      }
    } catch (error) {
      console.error('Error loading auto backup status:', error);
    } finally {
      setAutoBackupLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'backup' && user?.isSuperAdmin) loadAutoBackupStatus(true);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveAutoBackup = async () => {
    setAutoBackupSaving(true);
    try {
      // Bewusst OHNE companyQuery: die Felder wirken nur über die globale Vorlage.
      await api.put('/settings', {
        autoBackupEnabled: settings.autoBackupEnabled,
        autoBackupTime: settings.autoBackupTime,
        backupRetentionDays: settings.backupRetentionDays,
        backupNotifyOnFailure: settings.backupNotifyOnFailure,
      });
      toast.success(t('settings.savedToast'));
      await loadAutoBackupStatus();
    } catch (error: any) {
      console.error('Error saving auto backup settings:', error);
      toast.error(error.response?.data?.error || t('settings.saveError'));
    } finally {
      setAutoBackupSaving(false);
    }
  };

  const handleRunAutoBackup = async () => {
    setAutoBackupRunning(true);
    try {
      const r = await api.post('/storage/auto-backup-run');
      if (r.data?.ok) {
        const kb = Math.max(1, Math.round((r.data.sizeBytes || 0) / 1024));
        toast.success(t('settings.backup.auto.runSuccess', { size: String(kb) }));
      } else {
        toast.error(r.data?.error || t('settings.backup.auto.runError'));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('settings.backup.auto.runError'));
    } finally {
      setAutoBackupRunning(false);
      loadAutoBackupStatus();
    }
  };

  const handleCreateBackup = async () => {
    setBackupCreating(true);
    try {
      const response = await api.post('/backup/create', {}, {
        responseType: 'blob'
      });
      
      // Create download link
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `timefeed-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success(t('settings.backup.createSuccess'));
    } catch (error) {
      console.error('Error creating backup:', error);
      toast.error(t('settings.backup.createError'));
    } finally {
      setBackupCreating(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!backupFile) return;
    
    const confirmRestore = await confirm({
      title: t('settings.backup.restoreConfirmTitle'),
      message: t('settings.backup.restoreConfirmMsg'),
      confirmText: t('settings.backup.restoreConfirmBtn'),
      danger: true,
    });

    if (!confirmRestore) return;
    
    setBackupRestoring(true);
    try {
      const formData = new FormData();
      formData.append('backup', backupFile);
      
      await api.post('/backup/restore', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      toast.success(t('settings.backup.restoreSuccess'));
      window.location.reload();
    } catch (error) {
      console.error('Error restoring backup:', error);
      toast.error(t('settings.backup.restoreError'));
    } finally {
      setBackupRestoring(false);
    }
  };

  // Load audit logs when audit tab is selected or filters change
  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab, auditActionFilter, auditCategoryFilter]);

  const weekDays = [
    { id: 'monday', label: t('settings.weekDays.monday') },
    { id: 'tuesday', label: t('settings.weekDays.tuesday') },
    { id: 'wednesday', label: t('settings.weekDays.wednesday') },
    { id: 'thursday', label: t('settings.weekDays.thursday') },
    { id: 'friday', label: t('settings.weekDays.friday') },
    { id: 'saturday', label: t('settings.weekDays.saturday') },
    { id: 'sunday', label: t('settings.weekDays.sunday') }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'updates':
        return <SystemUpdate />;
      case 'storage':
        return <StorageSettings section="config" />;

      case 'apiKeys':
        return <ApiKeysPage embedded />;
      case 'system':
        return (
          <div className="card">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">{t('settings.system.title')}</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.company.publicUrl')}</label>
              <input
                type="url"
                value={settings.publicUrl || ''}
                onChange={(e) => setSettings({ ...settings, publicUrl: e.target.value })}
                disabled={!user?.isSuperAdmin}
                className="input-field disabled:bg-slate-100 disabled:text-slate-500"
                placeholder="https://zeit.meinefirma.de"
              />
              <p className="text-xs text-slate-500 mt-1">{t('settings.company.publicUrlHint')} {t('settings.system.publicUrlGlobal')}</p>
            </div>
          </div>
        );
      case 'trash':
        return <TrashSettings />;
      case 'general':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.general.heading')}
            </h3>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('settings.general.hoursPerDay')}
              </label>
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={settings.hoursPerWorkday}
                onChange={(e) => setSettings({...settings, hoursPerWorkday: parseFloat(e.target.value) || 8})}
                className="input-field w-32"
              />
              <p className="text-xs text-slate-500 mt-1">{t('settings.general.hoursPerDayHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('settings.general.workingDays')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                {weekDays.map((day) => (
                  <label key={day.id} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={settings.workingDays.includes(day.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSettings({
                            ...settings,
                            workingDays: [...settings.workingDays, day.id]
                          });
                        } else {
                          setSettings({
                            ...settings,
                            workingDays: settings.workingDays.filter(d => d !== day.id)
                          });
                        }
                      }}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-slate-700">
                      {day.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
        
      case 'time':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.time.heading')}
            </h3>

            {/* Pausenmodus */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-4">{t('settings.time.breakHeading')}</h4>
              <div className="space-y-3">
                {(['auto', 'manual', 'combined'] as const).map((mode) => (
                  <label key={mode} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="breakMode"
                      value={mode}
                      checked={settings.breakMode === mode}
                      onChange={() => setSettings({ ...settings, breakMode: mode })}
                      className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{t(`settings.time.breakMode.${mode}`)}</span>
                      <span className="block text-sm text-slate-600">{t(`settings.time.breakModeHint.${mode}`)}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.breakAfter6h')}</label>
                  <input
                    type="number"
                    min="0"
                    max="240"
                    value={settings.breakAfter6hMinutes}
                    onChange={(e) => setSettings({ ...settings, breakAfter6hMinutes: parseInt(e.target.value) || 0 })}
                    className="input-field w-32"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.breakAfter9h')}</label>
                  <input
                    type="number"
                    min="0"
                    max="240"
                    value={settings.breakAfter9hMinutes}
                    onChange={(e) => setSettings({ ...settings, breakAfter9hMinutes: parseInt(e.target.value) || 0 })}
                    className="input-field w-32"
                  />
                </div>
              </div>
            </div>

            {/* Auto-Kappung */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-2">{t('settings.time.capHeading')}</h4>
              <label className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  checked={settings.autoCapEnabled}
                  onChange={(e) => setSettings({ ...settings, autoCapEnabled: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="text-sm text-slate-700">{t('settings.time.autoCapEnabled')}</span>
              </label>
              {settings.autoCapEnabled && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.autoCapTime')}</label>
                  <input
                    type="time"
                    value={settings.autoCapTime}
                    onChange={(e) => setSettings({ ...settings, autoCapTime: e.target.value })}
                    className="input-field w-36"
                  />
                  <p className="text-xs text-slate-500 mt-1">{t('settings.time.autoCapHint')}</p>
                </div>
              )}
            </div>

            {/* ArbZG-Warnungen */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-2">{t('settings.time.arbzgHeading')}</h4>
              <label className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  checked={settings.arbzgWarningsEnabled}
                  onChange={(e) => setSettings({ ...settings, arbzgWarningsEnabled: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="text-sm text-slate-700">{t('settings.time.arbzgEnabled')}</span>
              </label>
              {settings.arbzgWarningsEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.arbzgMaxDaily')}</label>
                    <input
                      type="number"
                      min="0"
                      max="1440"
                      value={settings.arbzgMaxDailyMinutes}
                      onChange={(e) => setSettings({ ...settings, arbzgMaxDailyMinutes: parseInt(e.target.value) || 0 })}
                      className="input-field w-32"
                    />
                    <p className="text-xs text-slate-500 mt-1">{t('settings.time.arbzgMaxDailyHint')}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.arbzgMinRest')}</label>
                    <input
                      type="number"
                      min="0"
                      max="1440"
                      value={settings.arbzgMinRestMinutes}
                      onChange={(e) => setSettings({ ...settings, arbzgMinRestMinutes: parseInt(e.target.value) || 0 })}
                      className="input-field w-32"
                    />
                    <p className="text-xs text-slate-500 mt-1">{t('settings.time.arbzgMinRestHint')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* GPS */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-2">{t('settings.time.gpsHeading')}</h4>
              <div className="space-y-3">
                {(['off', 'optional', 'warn', 'required'] as const).map((mode) => (
                  <label key={mode} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="gpsMode"
                      checked={(settings.gpsMode || 'optional') === mode}
                      onChange={() => setSettings({ ...settings, gpsMode: mode })}
                      className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{t(`settings.time.gpsMode.${mode}`)}</span>
                      <span className="block text-xs text-slate-500">{t(`settings.time.gpsMode.${mode}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>

              {(settings.gpsMode || 'optional') === 'required' && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-slate-800 mb-1">{t('settings.time.gpsMaxAccuracy')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="10"
                      max="5000"
                      step="10"
                      value={settings.gpsMaxAccuracy ?? 100}
                      onChange={(e) => setSettings({ ...settings, gpsMaxAccuracy: parseInt(e.target.value) || 0 })}
                      className="input-field w-32"
                    />
                    <span className="text-sm text-slate-500">{t('settings.time.gpsMaxAccuracyUnit')}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('settings.time.gpsMaxAccuracyHint')}</p>
                </div>
              )}
            </div>

            {/* Terminal-Überwachung */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-2">{t('settings.time.terminalHeading')}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.terminalPingSeconds')}</label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={settings.terminalPingSeconds ?? 20}
                    onChange={(e) => setSettings({ ...settings, terminalPingSeconds: parseInt(e.target.value) || 20 })}
                    className="input-field"
                  />
                  <p className="text-xs text-slate-500 mt-1">{t('settings.time.terminalPingHint')}</p>
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.terminalAlertEnabled ?? false}
                  onChange={(e) => setSettings({ ...settings, terminalAlertEnabled: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="text-sm text-slate-700">{t('settings.time.terminalAlertEnabled')}</span>
              </label>
              {settings.terminalAlertEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.terminalAlertMinutes')}</label>
                    <input
                      type="number"
                      min={2}
                      max={1440}
                      value={settings.terminalAlertMinutes ?? 15}
                      onChange={(e) => setSettings({ ...settings, terminalAlertMinutes: parseInt(e.target.value) || 15 })}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.time.terminalAlertEmails')}</label>
                    <input
                      type="text"
                      value={settings.terminalAlertEmails ?? ''}
                      onChange={(e) => setSettings({ ...settings, terminalAlertEmails: e.target.value })}
                      placeholder={t('settings.time.terminalAlertEmailsPlaceholder')}
                      className="input-field"
                    />
                  </div>
                  <p className="text-xs text-slate-500 md:col-span-2">{t('settings.time.terminalAlertHint')}</p>
                </div>
              )}
            </div>

            {/* Stundenzettel-Versand beim Monatsabschluss */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-2">{t('settings.time.timesheetHeading')}</h4>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.sendTimesheetOnClose ?? false}
                  onChange={(e) => setSettings({ ...settings, sendTimesheetOnClose: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="text-sm text-slate-700">{t('settings.time.sendTimesheetOnClose')}</span>
              </label>
              <p className="text-xs text-slate-500 mt-2">{t('settings.time.sendTimesheetOnCloseHint')}</p>
            </div>

            {/* Abwesenheitsarten-Katalog (eigener CRUD-Bereich, speichert direkt) */}
            <AbsenceTypesSection />
          </div>
        );

      case 'company':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.company.heading')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('settings.company.name')}
                </label>
                <input
                  type="text"
                  value={settings.companyName}
                  onChange={(e) => setSettings({...settings, companyName: e.target.value})}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('settings.company.address')}
                </label>
                <textarea
                  value={settings.companyAddress || ''}
                  onChange={(e) => setSettings({...settings, companyAddress: e.target.value})}
                  className="input-field"
                  rows={3}
                  placeholder={t('settings.company.addressPlaceholder')}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('settings.company.phone')}
                </label>
                <input
                  type="tel"
                  value={settings.companyPhone || ''}
                  onChange={(e) => setSettings({...settings, companyPhone: e.target.value})}
                  className="input-field"
                  placeholder={t('settings.company.phonePlaceholder')}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('settings.company.email')}
                </label>
                <input
                  type="email"
                  value={settings.companyEmail || ''}
                  onChange={(e) => setSettings({...settings, companyEmail: e.target.value})}
                  className="input-field"
                  placeholder={t('settings.company.emailPlaceholder')}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('settings.company.website')}
                </label>
                <input
                  type="url"
                  value={settings.companyWebsite || ''}
                  onChange={(e) => setSettings({...settings, companyWebsite: e.target.value})}
                  className="input-field"
                  placeholder={t('settings.company.websitePlaceholder')}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('settings.company.logo')}
              </label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                <div className="space-y-1 text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-slate-500"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="flex text-sm text-slate-600">
                    <label
                      htmlFor="file-upload"
                      className="relative cursor-pointer bg-white rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500"
                    >
                      <span>{t('settings.company.uploadLogo')}</span>
                      <input id="file-upload" name="file-upload" type="file" className="sr-only" accept="image/*" />
                    </label>
                    <p className="pl-1">{t('settings.company.orDragDrop')}</p>
                  </div>
                  <p className="text-xs text-slate-600">{t('settings.company.logoHint')}</p>
                </div>
              </div>
            </div>
          </div>
        );

      case 'email':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.email.heading')}
            </h3>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start">
                <ExclamationTriangleIcon className="h-5 w-5 text-amber-400 mt-0.5 mr-3" />
                <div>
                  <h4 className="text-sm font-medium text-amber-800">{t('settings.email.warnTitle')}</h4>
                  <p className="text-sm text-amber-700 mt-1">
                    {t('settings.email.warnText')}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-slate-900 border-b pb-2">{t('settings.email.smtpServer')}</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('settings.email.smtpHost')}
                  </label>
                  <input
                    type="text"
                    value={emailSettings.smtpHost || ''}
                    onChange={(e) => setEmailSettings({...emailSettings, smtpHost: e.target.value})}
                    placeholder="smtp.gmail.com"
                    className="input-field w-full"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('settings.email.port')}
                    </label>
                    <input
                      type="number"
                      value={emailSettings.smtpPort || 587}
                      onChange={(e) => setEmailSettings({...emailSettings, smtpPort: parseInt(e.target.value) || 0})}
                      className="input-field w-full"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={emailSettings.smtpSecure || false}
                        onChange={(e) => setEmailSettings({...emailSettings, smtpSecure: e.target.checked})}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-slate-700">{t('settings.email.ssl')}</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('settings.email.username')}
                  </label>
                  <input
                    type="text"
                    value={emailSettings.smtpUser || ''}
                    onChange={(e) => setEmailSettings({...emailSettings, smtpUser: e.target.value})}
                    placeholder="your-email@gmail.com"
                    className="input-field w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('settings.email.password')}
                  </label>
                  <input
                    type="password"
                    value={emailSettings.smtpPassword || ''}
                    onChange={(e) => setEmailSettings({...emailSettings, smtpPassword: e.target.value})}
                    placeholder={t('settings.email.passwordPlaceholder')}
                    className="input-field w-full"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-medium text-slate-900 border-b pb-2">{t('settings.email.senderSettings')}</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('settings.email.senderName')}
                  </label>
                  <input
                    type="text"
                    value={emailSettings.fromName || ''}
                    onChange={(e) => setEmailSettings({...emailSettings, fromName: e.target.value})}
                    placeholder="TimeFeed"
                    className="input-field w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('settings.email.senderEmail')}
                  </label>
                  <input
                    type="email"
                    value={emailSettings.fromEmail || ''}
                    onChange={(e) => setEmailSettings({...emailSettings, fromEmail: e.target.value})}
                    placeholder="noreply@timefeed.com"
                    className="input-field w-full"
                  />
                </div>

                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="email-active"
                    checked={emailSettings.isActive || false}
                    onChange={(e) => setEmailSettings({...emailSettings, isActive: e.target.checked})}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="email-active" className="text-sm font-medium text-slate-700">
                    {t('settings.email.systemActive')}
                  </label>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-200">
                  <h5 className="text-sm font-medium text-slate-900 mb-3">{t('settings.email.sendTest')}</h5>
                  <div className="space-y-3">
                    <input
                      type="email"
                      value={testEmailAddress}
                      onChange={(e) => setTestEmailAddress(e.target.value)}
                      placeholder={t('settings.email.testPlaceholder')}
                      className="input-field w-full"
                    />
                    <button
                      onClick={handleSendTestEmail}
                      disabled={sendingTestEmail || !testEmailAddress}
                      className="btn-primary w-full"
                    >
                      {sendingTestEmail ? (
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          {t('settings.email.sendingTest')}
                        </div>
                      ) : (
                        t('settings.email.sendTestButton')
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                onClick={handleSaveEmailSettings}
                className="btn-primary"
              >
                {t('settings.email.saveButton')}
              </button>
            </div>
          </div>
        );

      case 'integrations':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('integrations.heading')}
            </h3>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <LinkIcon className="h-5 w-5 text-primary-600" />
                <h4 className="text-lg font-medium text-slate-900">{t('integrations.urlaubsfeed.title')}</h4>
              </div>
              <p className="text-sm text-slate-600 mb-4">{t('integrations.urlaubsfeed.desc')}</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('integrations.urlaubsfeed.urlLabel')}</label>
                  <input
                    type="url"
                    value={ufUrl}
                    onChange={(e) => setUfUrl(e.target.value)}
                    className="input-field w-full"
                    placeholder={t('integrations.urlaubsfeed.urlPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('integrations.urlaubsfeed.apiKeyLabel')}</label>
                  <input
                    type="password"
                    value={ufApiKey}
                    onChange={(e) => setUfApiKey(e.target.value)}
                    className="input-field w-full"
                    placeholder={t('integrations.urlaubsfeed.apiKeyPlaceholder')}
                    autoComplete="new-password"
                  />
                  <p className={`text-xs mt-1 flex items-center gap-1 ${ufHasKey ? 'text-green-600' : 'text-slate-500'}`}>
                    {ufHasKey && <CheckCircleIcon className="h-4 w-4" />}
                    {ufHasKey ? t('integrations.urlaubsfeed.keyStored') : t('integrations.urlaubsfeed.keyMissing')}
                  </p>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-200">
                  <input
                    type="checkbox"
                    id="uf-sync-enabled"
                    checked={ufSyncEnabled}
                    onChange={(e) => setUfSyncEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="uf-sync-enabled" className="cursor-pointer">
                    <span className="block text-sm font-medium text-slate-900">{t('integrations.urlaubsfeed.syncEnabled')}</span>
                    <span className="block text-sm text-slate-600">{t('integrations.urlaubsfeed.syncEnabledHint')}</span>
                  </label>
                </div>

                <p className="text-xs text-slate-500">{t('integrations.urlaubsfeed.help')}</p>

                <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-gray-200">
                  <button onClick={saveIntegration} disabled={ufSaving} className="btn-primary">
                    {ufSaving ? t('integrations.urlaubsfeed.saving') : t('integrations.urlaubsfeed.save')}
                  </button>
                  <button onClick={testIntegration} disabled={ufTesting} className="btn-secondary">
                    {ufTesting ? t('integrations.urlaubsfeed.testing') : t('integrations.urlaubsfeed.test')}
                  </button>
                  <button onClick={syncIntegration} disabled={ufSyncing || !ufHasKey} className="btn-secondary disabled:opacity-50">
                    {ufSyncing ? t('integrations.urlaubsfeed.syncing') : t('integrations.urlaubsfeed.syncNow')}
                  </button>
                </div>

                <div className="text-sm text-slate-600">
                  <span className="font-medium">{t('integrations.urlaubsfeed.lastSync')}:</span>{' '}
                  {ufLastSyncAt ? new Date(ufLastSyncAt).toLocaleString('de-DE') : t('integrations.urlaubsfeed.lastSyncNever')}
                </div>

                {ufLastResult && (
                  ufLastResult.ok === false ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <h5 className="text-sm font-medium text-red-800 mb-1">{t('integrations.urlaubsfeed.resultTitle')}</h5>
                      <p className="text-sm text-red-700">{ufLastResult.error || t('integrations.urlaubsfeed.syncError')}</p>
                    </div>
                  ) : (
                    <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                      <h5 className="text-sm font-medium text-primary-800 mb-2">{t('integrations.urlaubsfeed.resultTitle')}</h5>
                      <ul className="text-sm text-primary-700 space-y-1">
                        <li>• {t('integrations.urlaubsfeed.resultAbsences', { count: ufLastResult.fetched ?? 0 })}</li>
                        <li>• {t('integrations.urlaubsfeed.resultMatched', { count: ufLastResult.matchedUsers ?? 0 })}</li>
                        <li>• {t('integrations.urlaubsfeed.resultUnknown', { count: ufLastResult.unmatchedEmails?.length ?? 0 })}</li>
                        {!!ufLastResult.unmatchedEmails?.length && (
                          <li className="text-xs break-all text-primary-600">{ufLastResult.unmatchedEmails.join(', ')}</li>
                        )}
                      </ul>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Mitarbeiter-Abgleich: Mitarbeiter aus UrlaubsFeed laden und selektiv importieren. */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <UsersIcon className="h-5 w-5 text-primary-600" />
                <h4 className="text-lg font-medium text-slate-900">{t('integrations.userSync.title')}</h4>
              </div>
              <p className="text-sm text-slate-600 mb-4">{t('integrations.userSync.desc')}</p>

              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <button onClick={() => loadUfUsers()} disabled={ufUsersLoading || !ufHasKey} className="btn-secondary disabled:opacity-50">
                    {ufUsersLoading ? t('integrations.userSync.loading') : t('integrations.userSync.load')}
                  </button>
                  {ufUsers && (
                    <span className="text-sm text-slate-500">{t('integrations.userSync.selected', { count: ufSelected.size })}</span>
                  )}
                </div>

                {ufUsers && ufUsers.length === 0 && (
                  <p className="text-sm text-slate-500">{t('integrations.userSync.empty')}</p>
                )}

                {ufUsers && ufUsers.length > 0 && (
                  <>
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">
                              <input
                                type="checkbox"
                                checked={ufSelected.size === ufUsers.length && ufUsers.length > 0}
                                onChange={toggleUfAll}
                                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                              />
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">{t('integrations.userSync.colName')}</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">{t('integrations.userSync.colEmail')}</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">{t('integrations.userSync.colEmployeeNumber')}</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">{t('integrations.userSync.colGroup')}</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">{t('integrations.userSync.colStatus')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {ufUsers.map((u) => (
                            <tr key={u.email.toLowerCase()} className="hover:bg-gray-50">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={ufSelected.has(u.email.toLowerCase())}
                                  onChange={() => toggleUfUser(u.email)}
                                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                                />
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-slate-900">{u.firstName} {u.lastName}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{u.email}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{u.employeeNumber || '–'}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{u.groupName || '–'}</td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {u.status === 'new' && (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    {t('integrations.userSync.statusNew')}
                                  </span>
                                )}
                                {u.status === 'exists' && (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                    {t('integrations.userSync.statusExists')}
                                  </span>
                                )}
                                {u.status === 'diff' && (
                                  <span
                                    title={ufDiffTitle(u.diff)}
                                    className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 cursor-help"
                                  >
                                    {t('integrations.userSync.statusDiff')}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-200">
                      <input
                        type="checkbox"
                        id="uf-update-existing"
                        checked={ufUpdateExisting}
                        onChange={(e) => setUfUpdateExisting(e.target.checked)}
                        className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <label htmlFor="uf-update-existing" className="cursor-pointer">
                        <span className="block text-sm font-medium text-slate-900">{t('integrations.userSync.optUpdateExisting')}</span>
                        <span className="block text-sm text-slate-600">{t('integrations.userSync.optUpdateExistingHint')}</span>
                      </label>
                    </div>

                    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-200">
                      <input
                        type="checkbox"
                        id="uf-send-welcome"
                        checked={ufSendWelcome}
                        onChange={(e) => setUfSendWelcome(e.target.checked)}
                        className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <label htmlFor="uf-send-welcome" className="cursor-pointer">
                        <span className="block text-sm font-medium text-slate-900">{t('integrations.userSync.optSendWelcome')}</span>
                        <span className="block text-sm text-slate-600">{t('integrations.userSync.optSendWelcomeHint')}</span>
                      </label>
                    </div>

                    {ufNeedsCompany && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">{t('integrations.userSync.companyLabel')}</label>
                        <Select
                          value={ufCompanyId}
                          onChange={setUfCompanyId}
                          options={[
                            { value: '', label: t('integrations.userSync.companyPlaceholder') },
                            ...ufCompanies.map((c) => ({ value: String(c.id), label: c.name })),
                          ]}
                          className="w-full sm:max-w-xs"
                        />
                      </div>
                    )}

                    <div className="pt-4 border-t border-gray-200">
                      <button
                        onClick={importUfUsers}
                        disabled={ufImporting || ufSelected.size === 0}
                        className="btn-primary disabled:opacity-50"
                      >
                        {ufImporting
                          ? t('integrations.userSync.importing')
                          : `${t('integrations.userSync.importBtn')} (${ufSelected.size})`}
                      </button>
                    </div>
                  </>
                )}

                {ufImportResult && (
                  <div className={`border rounded-lg p-4 ${ufImportResult.errors.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-primary-50 border-primary-200'}`}>
                    <h5 className="text-sm font-medium text-slate-800 mb-2">{t('integrations.userSync.resultTitle')}</h5>
                    <ul className="text-sm text-slate-700 space-y-1">
                      <li>• {t('integrations.userSync.resultCreated', { count: ufImportResult.created })}</li>
                      <li>• {t('integrations.userSync.resultUpdated', { count: ufImportResult.updated })}</li>
                      <li>• {t('integrations.userSync.resultSkipped', { count: ufImportResult.skipped })}</li>
                      {ufImportResult.errors.length > 0 && (
                        <li>
                          • {t('integrations.userSync.resultErrors')}:
                          <ul className="mt-1 ml-4 space-y-0.5 text-xs text-amber-800 break-all">
                            {ufImportResult.errors.map((e) => (
                              <li key={e.email}>{e.email}: {e.reason}</li>
                            ))}
                          </ul>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.notifications.heading')}
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-gray-200  rounded-lg">
                <div>
                  <h4 className="text-sm font-medium text-slate-900">
                    {t('settings.notifications.emailTitle')}
                  </h4>
                  <p className="text-sm text-slate-600">
                    {t('settings.notifications.emailDesc')}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.emailNotifications}
                  onChange={(e) => setSettings({...settings, emailNotifications: e.target.checked})}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
              </div>
            </div>

            {/* Periodische Berichts-Mails (Tag/Monat/Quartal/Jahr, pro Firma) */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-1">
                {t('settings.notifications.reports.heading')}
              </h4>
              <p className="text-sm text-slate-600 mb-4">
                {t('settings.notifications.reports.desc')}
              </p>

              <div className="space-y-3">
                {([
                  { period: 'day' as const, field: 'reportDailyEnabled' as const },
                  { period: 'month' as const, field: 'reportMonthlyEnabled' as const },
                  { period: 'quarter' as const, field: 'reportQuarterlyEnabled' as const },
                  { period: 'year' as const, field: 'reportYearlyEnabled' as const },
                ]).map(({ period, field }) => (
                  <div key={period} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border border-gray-200 rounded-lg">
                    <label className="flex items-start gap-3 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label={t(`settings.notifications.reports.${period}Title`)}
                        checked={!!settings[field]}
                        onChange={(e) => setSettings({ ...settings, [field]: e.target.checked })}
                        className="h-4 w-4 mt-0.5 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">
                          {t(`settings.notifications.reports.${period}Title`)}
                        </span>
                        <span className="block text-sm text-slate-600">
                          {t(`settings.notifications.reports.${period}Desc`)}
                        </span>
                      </span>
                    </label>
                    {/* Testversand ist bewusst IMMER möglich (auch bei deaktivierter Periode). */}
                    <button
                      type="button"
                      onClick={() => sendTestReport(period)}
                      disabled={reportSending !== null}
                      className="btn-secondary text-sm whitespace-nowrap self-start sm:self-center disabled:opacity-50"
                    >
                      {reportSending === period
                        ? t('settings.notifications.reports.sending')
                        : t('settings.notifications.reports.sendNow')}
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('settings.notifications.reports.recipients')}
                </label>
                <input
                  type="text"
                  value={settings.reportRecipients || ''}
                  onChange={(e) => setSettings({ ...settings, reportRecipients: e.target.value })}
                  placeholder={t('settings.notifications.reports.recipientsPlaceholder')}
                  className="input-field"
                />
                <p className="text-xs text-slate-500 mt-1">{t('settings.notifications.reports.recipientsHint')}</p>
              </div>

              <p className="text-xs text-slate-500 mt-3">{t('settings.notifications.reports.sendNowHint')}</p>
            </div>
          </div>
        );

      case 'security':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.security.heading')}
            </h3>

            {/* Password Policy Settings */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-4">{t('settings.security.passwordPolicies')}</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('settings.security.minLength')}
                  </label>
                  <input
                    type="number"
                    min="4"
                    max="64"
                    value={settings.passwordMinLength}
                    onChange={(e) => setSettings({...settings, passwordMinLength: parseInt(e.target.value) || 0})}
                    className="input-field"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('settings.security.expiryDays')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={settings.passwordExpiryDays}
                    onChange={(e) => setSettings({...settings, passwordExpiryDays: parseInt(e.target.value) || 0})}
                    className="input-field"
                  />
                  <p className="text-xs text-slate-600 mt-1">{t('settings.security.expiryHint')}</p>
                </div>
              </div>

              <div className="mt-6">
                <h5 className="text-sm font-medium text-slate-700 mb-3">{t('settings.security.requirements')}</h5>
                <div className="space-y-3">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.passwordRequireUppercase}
                      onChange={(e) => setSettings({...settings, passwordRequireUppercase: e.target.checked})}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-slate-700">{t('settings.security.requireUppercase')}</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.passwordRequireLowercase}
                      onChange={(e) => setSettings({...settings, passwordRequireLowercase: e.target.checked})}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-slate-700">{t('settings.security.requireLowercase')}</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.passwordRequireNumbers}
                      onChange={(e) => setSettings({...settings, passwordRequireNumbers: e.target.checked})}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-slate-700">{t('settings.security.requireNumbers')}</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.passwordRequireSpecialChars}
                      onChange={(e) => setSettings({...settings, passwordRequireSpecialChars: e.target.checked})}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-slate-700">{t('settings.security.requireSpecial')}</span>
                  </label>
                </div>
              </div>
            </div>
            
            {/* Session & Login Security */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg font-medium text-slate-900 mb-4">{t('settings.security.sessionLogin')}</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('settings.security.sessionDuration')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="2160"
                    value={settings.sessionDurationHours}
                    onChange={(e) => setSettings({...settings, sessionDurationHours: parseInt(e.target.value) || 0})}
                    className="input-field"
                  />
                  <p className="text-xs text-slate-500 mt-1">{t('settings.security.sessionDurationHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('settings.security.nfcPin')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!settings.nfcPinRequired}
                      onChange={(e) => setSettings({ ...settings, nfcPinRequired: e.target.checked })}
                    />
                    <span className="text-sm text-slate-700">{t('settings.security.nfcPinToggle')}</span>
                  </label>
                  <p className="text-xs text-slate-500 mt-1">{t('settings.security.nfcPinHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('settings.security.maxAttempts')}
                  </label>
                  <input
                    type="number"
                    min="3"
                    max="10"
                    value={settings.maxLoginAttempts}
                    onChange={(e) => setSettings({...settings, maxLoginAttempts: parseInt(e.target.value) || 0})}
                    className="input-field"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('settings.security.lockout')}
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={settings.lockoutDurationMinutes}
                    onChange={(e) => setSettings({...settings, lockoutDurationMinutes: parseInt(e.target.value) || 0})}
                    className="input-field"
                  />
                  <p className="text-xs text-slate-600 mt-1">{t('settings.security.lockoutHint')}</p>
                </div>
              </div>
            </div>
            
            {/* Security Status */}
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-green-800 mb-2">
                {t('settings.security.encryptionTitle')}
              </h4>
              <ul className="text-sm text-green-700 space-y-1">
                <li>{t('settings.security.enc1')}</li>
                <li>{t('settings.security.enc2')}</li>
                <li>{t('settings.security.enc3')}</li>
                <li>{t('settings.security.enc4')}</li>
              </ul>
            </div>
          </div>
        );
        
      case 'audit':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.audit.heading')}
            </h3>

            <div className="card">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                <h4 className="font-medium text-slate-900">
                  {t('settings.audit.systemActivities')}
                </h4>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select
                    value={auditActionFilter}
                    onChange={setAuditActionFilter}
                    options={[
                      { value: '', label: t('settings.audit.allActions') },
                      { value: 'USER_CREATED', label: t('settings.audit.actionUserCreated') },
                      { value: 'USER_UPDATED', label: t('settings.audit.actionUserUpdated') },
                      { value: 'USER_DELETED', label: t('settings.audit.actionUserDeleted') },
                      { value: 'LOGIN', label: t('settings.audit.actionLogin') },
                      { value: 'LOGOUT', label: t('settings.audit.actionLogout') },
                      { value: 'SETTINGS_UPDATED', label: t('settings.audit.actionSettingsUpdated') },
                      { value: 'REPORT_GENERATED', label: t('settings.audit.actionReportGenerated') },
                    ]}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-md text-sm"
                  />
                  <Select
                    value={auditCategoryFilter}
                    onChange={setAuditCategoryFilter}
                    options={[
                      { value: '', label: t('settings.audit.allCategories') },
                      { value: 'AUTH', label: t('settings.audit.catAuth') },
                      { value: 'USERS', label: t('settings.audit.catUsers') },
                      { value: 'SETTINGS', label: t('settings.audit.catSettings') },
                      { value: 'REPORTS', label: t('settings.audit.catReports') },
                      { value: 'SYSTEM', label: t('settings.audit.catSystem') },
                    ]}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-md text-sm"
                  />
                  <button
                    onClick={() => loadAuditLogs()}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm"
                    disabled={auditLoading}
                  >
                    {auditLoading ? t('settings.audit.loading') : t('settings.audit.refresh')}
                  </button>
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder={t('settings.audit.searchPlaceholder')}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-md text-sm"
                  />
                </div>
              </div>
              
              {auditLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th onClick={() => toggleAuditSort('createdAt')} className="px-4 py-3 text-left font-medium text-gray-900 cursor-pointer select-none">{t('settings.audit.colTimestamp')}{auditArrow('createdAt')}</th>
                        <th onClick={() => toggleAuditSort('user')} className="px-4 py-3 text-left font-medium text-gray-900 cursor-pointer select-none">{t('settings.audit.colUser')}{auditArrow('user')}</th>
                        <th onClick={() => toggleAuditSort('action')} className="px-4 py-3 text-left font-medium text-gray-900 cursor-pointer select-none">{t('settings.audit.colAction')}{auditArrow('action')}</th>
                        <th onClick={() => toggleAuditSort('category')} className="px-4 py-3 text-left font-medium text-gray-900 cursor-pointer select-none">{t('settings.audit.colCategory')}{auditArrow('category')}</th>
                        <th onClick={() => toggleAuditSort('status')} className="px-4 py-3 text-left font-medium text-gray-900 cursor-pointer select-none">{t('settings.audit.colStatus')}{auditArrow('status')}</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-900">{t('settings.audit.colDetails')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {displayedAuditLogs.length > 0 ? displayedAuditLogs.map((log) => (
                        <React.Fragment key={log.id}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900">
                              {new Date(log.createdAt).toLocaleString('de-DE')}
                            </td>
                            <td className="px-4 py-3 text-gray-900">
                              {log.user ? `${log.user.firstName} ${log.user.lastName}` : t('settings.audit.system')}
                            </td>
                            <td className="px-4 py-3 text-gray-900">
                              {log.action}
                            </td>
                            <td className="px-4 py-3 text-gray-900">
                              {log.category}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                                log.success 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {log.success ? t('settings.audit.success') : t('settings.audit.error')}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setExpandedAuditEntry(
                                  expandedAuditEntry === log.id ? null : log.id
                                )}
                                className="px-3 py-1 text-xs bg-slate-100 text-slate-700 rounded hover:bg-slate-200 transition-colors"
                              >
                                {expandedAuditEntry === log.id ? t('settings.audit.less') : t('settings.audit.details')}
                              </button>
                            </td>
                          </tr>
                          {expandedAuditEntry === log.id && (
                            <tr>
                              <td colSpan={6} className="px-4 py-3 bg-slate-50">
                                <div className="space-y-2 text-sm">
                                  {log.entity && (
                                    <div><strong>{t('settings.audit.entity')}:</strong> {log.entity}</div>
                                  )}
                                  {log.ipAddress && (
                                    <div><strong>{t('settings.audit.ipAddress')}:</strong> {log.ipAddress}</div>
                                  )}
                                  {log.userAgent && (
                                    <div><strong>{t('settings.audit.userAgent')}:</strong> <span className="break-all">{log.userAgent}</span></div>
                                  )}
                                  {log.oldValues && (
                                    <div>
                                      <strong>{t('settings.audit.oldValues')}:</strong>
                                      <pre className="mt-1 p-2 bg-white border rounded text-xs overflow-x-auto">
                                        {JSON.stringify(log.oldValues, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.newValues && (
                                    <div>
                                      <strong>{t('settings.audit.newValues')}:</strong>
                                      <pre className="mt-1 p-2 bg-white border rounded text-xs overflow-x-auto">
                                        {JSON.stringify(log.newValues, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                            {t('settings.audit.noEntries')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              
              {auditTotal > 50 && (
                <div className="mt-4 flex justify-between items-center">
                  <span className="text-sm text-gray-700">
                    {t('settings.audit.pageOf', { page: auditPage, total: Math.ceil(auditTotal / 50) })}
                  </span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        if (auditPage > 1) {
                          setAuditPage(auditPage - 1);
                          loadAuditLogs(auditPage - 1);
                        }
                      }}
                      disabled={auditPage === 1}
                      className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('settings.audit.prev')}
                    </button>
                    <button
                      onClick={() => {
                        if (auditPage < Math.ceil(auditTotal / 50)) {
                          setAuditPage(auditPage + 1);
                          loadAuditLogs(auditPage + 1);
                        }
                      }}
                      disabled={auditPage >= Math.ceil(auditTotal / 50)}
                      className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('settings.audit.next')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
        
      case 'backup':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-900">
              {t('settings.backup.heading')}
            </h3>

            {/* 1) Lokales Backup (Datei) */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownTrayIcon className="h-5 w-5 text-primary-600" />
                <h4 className="font-semibold text-slate-900">{t('settings.backup.localTitle')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card flex flex-col">
                  <h5 className="font-medium text-slate-900 mb-3">{t('settings.backup.createTitle')}</h5>
                  <p className="text-sm text-slate-600 mb-4 flex-grow">
                    {t('settings.backup.createDesc')}
                  </p>
                  <button onClick={handleCreateBackup} disabled={backupCreating} className="w-full btn-primary mt-auto">
                    {backupCreating ? (
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        {t('settings.backup.creating')}
                      </div>
                    ) : t('settings.backup.download')}
                  </button>
                </div>

                <div className="card flex flex-col">
                  <h5 className="font-medium text-slate-900 mb-3">{t('settings.backup.restoreTitle')}</h5>
                  <p className="text-sm text-slate-600 mb-4">
                    {t('settings.backup.restoreDesc')}
                  </p>
                  <div className="mb-4 flex-grow">
                    <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.backup.selectFile')}</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
                      className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                    />
                  </div>
                  <button onClick={handleRestoreBackup} disabled={backupRestoring || !backupFile} className="w-full btn-primary bg-amber-600 hover:bg-amber-700 mt-auto">
                    {backupRestoring ? (
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        {t('settings.backup.restoring')}
                      </div>
                    ) : t('settings.backup.restoreFile')}
                  </button>
                </div>
              </div>
            </div>

            {/* 2) Automatische Backups (täglicher Lauf, globale Vorlage) */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ClockIcon className="h-5 w-5 text-primary-600" />
                <h4 className="font-semibold text-slate-900">{t('settings.backup.auto.title')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Einstellungen */}
                <div className="card flex flex-col">
                  <p className="text-sm text-slate-600 mb-4">{t('settings.backup.auto.desc')}</p>
                  <label className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      checked={!!settings.autoBackupEnabled}
                      onChange={(e) => setSettings({ ...settings, autoBackupEnabled: e.target.checked })}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-slate-700">{t('settings.backup.auto.enable')}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.backup.auto.time')}</label>
                      <input
                        type="time"
                        value={settings.autoBackupTime || '02:30'}
                        onChange={(e) => setSettings({ ...settings, autoBackupTime: e.target.value })}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">{t('settings.backup.auto.retention')}</label>
                      <input
                        type="number"
                        min="7"
                        max="3650"
                        value={settings.backupRetentionDays ?? 30}
                        onChange={(e) => setSettings({ ...settings, backupRetentionDays: parseInt(e.target.value) || 30 })}
                        className="input-field w-full"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      checked={!!settings.backupNotifyOnFailure}
                      onChange={(e) => setSettings({ ...settings, backupNotifyOnFailure: e.target.checked })}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-slate-700">{t('settings.backup.auto.notify')}</span>
                  </label>
                  <p className="text-xs text-slate-500 mb-4">{t('settings.backup.auto.globalHint')}</p>
                  <button onClick={handleSaveAutoBackup} disabled={autoBackupSaving} className="w-full btn-primary mt-auto">
                    {autoBackupSaving ? t('settings.saving') : t('settings.save')}
                  </button>
                </div>

                {/* Status-Card */}
                <div className="card flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="font-medium text-slate-900">{t('settings.backup.auto.statusTitle')}</h5>
                    <button
                      onClick={() => loadAutoBackupStatus()}
                      disabled={autoBackupLoading}
                      className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                    >
                      <ArrowPathIcon className={`h-4 w-4 ${autoBackupLoading ? 'animate-spin' : ''}`} />
                      {t('settings.backup.auto.refresh')}
                    </button>
                  </div>
                  {autoBackupStatus?.lastStatus ? (
                    <div className="space-y-2 text-sm flex-grow">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">{t('settings.backup.auto.lastRun')}</span>
                        <span className="text-slate-900">{new Date(autoBackupStatus.lastStatus.lastRunAt).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">{t('settings.backup.auto.result')}</span>
                        {autoBackupStatus.lastStatus.ok ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <CheckCircleIcon className="h-3.5 w-3.5" /> {t('settings.backup.auto.badgeOk')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            <ExclamationTriangleIcon className="h-3.5 w-3.5" /> {t('settings.backup.auto.badgeFail')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">{t('settings.backup.auto.size')}</span>
                        <span className="text-slate-900">{Math.max(1, Math.round(autoBackupStatus.lastStatus.sizeBytes / 1024))} KB</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">{t('settings.backup.auto.target')}</span>
                        <span className="text-slate-900">
                          {autoBackupStatus.lastStatus.target === 's3+local'
                            ? t('settings.backup.auto.targetS3Local')
                            : t('settings.backup.auto.targetLocal')}
                        </span>
                      </div>
                      {autoBackupStatus.lastStatus.error && (
                        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 break-all">
                          {autoBackupStatus.lastStatus.error}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">{t('settings.backup.auto.nextRun')}</span>
                        <span className="text-slate-900">
                          {autoBackupStatus.nextRunAt
                            ? new Date(autoBackupStatus.nextRunAt).toLocaleString()
                            : t('settings.backup.auto.disabled')}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 flex-grow">
                      {autoBackupLoading ? t('settings.backup.auto.loading') : t('settings.backup.auto.neverRun')}
                      {autoBackupStatus && !autoBackupStatus.lastStatus && autoBackupStatus.nextRunAt && (
                        <p className="mt-2 text-slate-600">
                          {t('settings.backup.auto.nextRun')}: {new Date(autoBackupStatus.nextRunAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                  <button onClick={handleRunAutoBackup} disabled={autoBackupRunning} className="w-full btn-primary mt-4">
                    {autoBackupRunning ? (
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        {t('settings.backup.auto.running')}
                      </div>
                    ) : t('settings.backup.auto.runNow')}
                  </button>
                </div>
              </div>
            </div>

            {/* 3) S3-Backups (Objektspeicher) – lädt automatisch */}
            <StorageSettings section="backups" />

            {/* 4) Hinweise (gelten für beide) */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start">
                <ExclamationTriangleIcon className="h-5 w-5 text-amber-400 mt-0.5 mr-3" />
                <div>
                  <h4 className="text-sm font-medium text-amber-800">{t('settings.backup.notesTitle')}</h4>
                  <ul className="text-sm text-amber-700 mt-2 space-y-1">
                    <li>• {t('settings.backup.note1')}</li>
                    <li>• {t('settings.backup.note2')}</li>
                    <li>• {t('settings.backup.note3')}</li>
                    <li>• {t('settings.backup.note4')}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-primary-800 mb-2">{t('settings.backup.whatTitle')}</h4>
              <ul className="text-sm text-primary-700 space-y-1">
                <li>• {t('settings.backup.what1')}</li>
                <li>• {t('settings.backup.what2')}</li>
                <li>• {t('settings.backup.what3')}</li>
                <li>• {t('settings.backup.what4')}</li>
                <li>• {t('settings.backup.what5')}</li>
                <li>• {t('settings.backup.what6')}</li>
              </ul>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">{t('settings.title')}</h1>
        <div className="card text-center">
          <ShieldCheckIcon className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            {t('settings.accessDeniedTitle')}
          </h3>
          <p className="text-slate-600">
            {t('settings.accessDeniedText')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <h1 className="text-3xl font-bold text-slate-900">{t('settings.title')}</h1>

        <div className="flex flex-wrap items-center gap-3">
          {user?.isSuperAdmin && (
            <span className="text-xs text-slate-500">
              {companyQuery ? t('settings.editCompanyHint') : t('settings.editGlobalHint')}
            </span>
          )}
          {saved && (
            <div className="text-sm text-green-600  font-medium">
              {t('settings.saved')}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary flex items-center space-x-2"
          >
            {isSaving ? (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
            ) : (
              <Cog6ToothIcon className="h-5 w-5" />
            )}
            <span>{isSaving ? t('settings.saving') : t('settings.save')}</span>
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar with tabs */}
        <div className="lg:col-span-1">
          {/* Mobile/Tablet: horizontal scrollbare Tab-Leiste; Desktop (lg+): vertikale Sidebar */}
          <nav className="flex gap-1 overflow-x-auto pb-2 -mb-2 lg:flex-col lg:gap-0 lg:space-y-1 lg:overflow-visible lg:pb-0 lg:mb-0">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-shrink-0 lg:w-full flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100 '
                  }`}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {t(`settings.tabs.${tab.id}`)}
                </button>
              );
            })}
          </nav>
        </div>
        
        {/* Main content */}
        <div className="lg:col-span-3">
          <div className="card">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;