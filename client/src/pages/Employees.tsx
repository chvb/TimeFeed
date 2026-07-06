import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlusIcon, PencilIcon, TrashIcon, UsersIcon, UserPlusIcon, XMarkIcon, ChevronUpIcon, ChevronDownIcon, PrinterIcon, GiftIcon, ClockIcon, ArrowUpTrayIcon, CakeIcon, ArrowDownTrayIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import SearchInput from '../components/common/SearchInput';
import { useConfirm } from '../components/common/ConfirmProvider';
import SearchableSelect from '../components/common/SearchableSelect';
import api from '../lib/api';
import { useAuthStore, isTenantAdmin as isTenantAdminFn } from '../store/authStore';
import { escapeHtml } from '../lib/escapeHtml';
import { printHeaderHtml, copyrightText } from '../components/common/brand';
import EmployeeDetailModal from '../components/common/EmployeeDetailModal';
import { Dialog, Transition } from '@headlessui/react';
import toast from 'react-hot-toast';
import ErrorBanner from '../components/ErrorBanner';
import clsx from 'clsx';
import { useT } from '../i18n';

interface Employee {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'buchhaltung' | 'verwaltung' | 'mitarbeiter';
  department?: string;
  position?: string;
  phoneNumber?: string;
  isActive: boolean;
  startDate: string;
  entryDate?: string;
  birthDate?: string;
  employeeNumber?: string;
  groupId?: number;
  timeModelId?: number | null;
  stampCode?: string | null;
  nfcTagUid?: string | null;
  group?: {
    name: string;
  };
}

interface EmployeeFormData {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  department?: string;
  position?: string;
  phoneNumber?: string;
  workingDaysOverride?: string[] | null;
  hoursPerDayOverride?: number | null;
  employmentFactor?: number | null;
  exitDate?: string;
  password?: string;
  groupId?: number;
  companyId?: number | null;
  tenantId?: number | null;
  isSuperAdmin?: boolean;
  entryDate?: string;
  birthDate?: string;
  employeeNumber?: string;
  timeModelId?: number | null;
  nfcTagUid?: string;
  pin?: string;
}

const Employees: React.FC = () => {
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTenantAdmin = isTenantAdminFn(user);
  const canAssignCompany = !!user?.isSuperAdmin || isTenantAdmin;
  const t = useT();
  const [activeTab, setActiveTab] = useState<'employees' | 'tenure' | 'anniversaries' | 'birthdays'>('employees');
  const [bdaySortField, setBdaySortField] = useState<'name' | 'birthday' | 'turning' | 'next'>('next');
  const [bdaySortDir, setBdaySortDir] = useState<'asc' | 'desc'>('asc');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<{id: number, name: string}[]>([]);
  const [timeModels, setTimeModels] = useState<{id: number, name: string, isActive?: boolean}[]>([]);
  const [companies, setCompanies] = useState<{id: number, name: string}[]>([]);
  const [tenantsList, setTenantsList] = useState<{id: number, name: string}[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { confirm } = useConfirm();
  const [filterRole, setFilterRole] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [hasExternalAccess, setHasExternalAccess] = useState(false);
  const [sortField, setSortField] = useState<'name' | 'role' | 'group' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // Sorting for tenure tab
  const [tenureSortField, setTenureSortField] = useState<'name' | 'startDate' | 'tenure' | 'totalDays'>('tenure');
  const [tenureSortDirection, setTenureSortDirection] = useState<'asc' | 'desc'>('desc');
  // Sorting for anniversary tab  
  const [anniversarySortField, setAnniversarySortField] = useState<'name' | 'startDate' | 'years' | 'anniversaryDate'>('anniversaryDate');
  const [anniversarySortDirection, setAnniversarySortDirection] = useState<'asc' | 'desc'>('asc');
  // Modal tab state
  const [modalTab, setModalTab] = useState<'basic' | 'advanced'>('basic');
  const [formData, setFormData] = useState<EmployeeFormData>({
    email: '',
    firstName: '',
    lastName: '',
    role: 'mitarbeiter',
    department: '',
    position: '',
    phoneNumber: '',
    workingDaysOverride: null,
    hoursPerDayOverride: null,
    employmentFactor: 1,
    exitDate: '',
    password: '',
    groupId: undefined,
    entryDate: '',
    birthDate: '',
    employeeNumber: '',
    timeModelId: null,
    nfcTagUid: '',
    pin: ''
  });

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    filterEmployees();
  }, [employees, searchTerm, filterRole, filterGroup, sortField, sortDirection]);
  
  const handleSort = (field: 'name' | 'role' | 'group' | 'status') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  const SortButton = ({ field, children }: { field: 'name' | 'role' | 'group' | 'status', children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center space-x-1 hover:text-slate-900 transition-colors cursor-pointer"
    >
      <span>{children}</span>
      {sortField === field ? (
        sortDirection === 'asc' ? (
          <ChevronUpIcon className="h-4 w-4" />
        ) : (
          <ChevronDownIcon className="h-4 w-4" />
        )
      ) : (
        <div className="h-4 w-4" />
      )}
    </button>
  );

  const TenureSortButton = ({ field, currentField, direction, onClick, children }: { 
    field: 'name' | 'startDate' | 'tenure' | 'totalDays', 
    currentField: 'name' | 'startDate' | 'tenure' | 'totalDays',
    direction: 'asc' | 'desc',
    onClick: (field: 'name' | 'startDate' | 'tenure' | 'totalDays') => void,
    children: React.ReactNode 
  }) => (
    <button
      onClick={() => onClick(field)}
      className="flex items-center space-x-1 hover:text-slate-900 transition-colors cursor-pointer"
    >
      <span>{children}</span>
      {currentField === field ? (
        direction === 'asc' ? (
          <ChevronUpIcon className="h-4 w-4" />
        ) : (
          <ChevronDownIcon className="h-4 w-4" />
        )
      ) : (
        <div className="h-4 w-4" />
      )}
    </button>
  );

  const AnniversarySortButton = ({ field, currentField, direction, onClick, children }: { 
    field: 'name' | 'startDate' | 'years' | 'anniversaryDate', 
    currentField: 'name' | 'startDate' | 'years' | 'anniversaryDate',
    direction: 'asc' | 'desc',
    onClick: (field: 'name' | 'startDate' | 'years' | 'anniversaryDate') => void,
    children: React.ReactNode 
  }) => (
    <button
      onClick={() => onClick(field)}
      className="flex items-center space-x-1 hover:text-slate-900 transition-colors cursor-pointer"
    >
      <span>{children}</span>
      {currentField === field ? (
        direction === 'asc' ? (
          <ChevronUpIcon className="h-4 w-4" />
        ) : (
          <ChevronDownIcon className="h-4 w-4" />
        )
      ) : (
        <div className="h-4 w-4" />
      )}
    </button>
  );

  const handleTenureSort = (field: 'name' | 'startDate' | 'tenure' | 'totalDays') => {
    if (tenureSortField === field) {
      setTenureSortDirection(tenureSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setTenureSortField(field);
      setTenureSortDirection('asc');
    }
  };


  const handleAnniversarySort = (field: 'name' | 'startDate' | 'years' | 'anniversaryDate') => {
    if (anniversarySortField === field) {
      setAnniversarySortDirection(anniversarySortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setAnniversarySortField(field);
      setAnniversarySortDirection('asc');
    }
  };


  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const [employeesResponse, groupsResponse] = await Promise.all([
        api.get('/users'),
        api.get('/groups')
      ]);
      setEmployees(employeesResponse.data.users || employeesResponse.data);
      setGroups(groupsResponse.data.groups || groupsResponse.data);
      // Zeitmodelle für den Override im Formular (Fehler still ignorieren).
      try {
        const tmr = await api.get('/time-models');
        setTimeModels(tmr.data.timeModels || tmr.data.models || (Array.isArray(tmr.data) ? tmr.data : []));
      } catch { /* ignore */ }
      // Firmenliste nur für Super-Admins (Zuordnung im Formular).
      if (canAssignCompany) {
        try { const cr = await api.get('/companies'); setCompanies(cr.data.companies || []); } catch { /* ignore */ }
      }
      if (user?.isSuperAdmin) {
        try { const tr = await api.get('/tenants'); setTenantsList((tr.data.tenants || []).map((x: any) => ({ id: x.id, name: x.name }))); } catch { /* ignore */ }
      }
      setLoadError('');
    } catch (error) {
      console.error('Error fetching employees:', error);
      setLoadError(t('employees.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const filterEmployees = () => {
    let filtered = employees.filter(employee => {
      const matchesSearch = 
        employee.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        employee.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (employee.department || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesRole = !filterRole || employee.role === filterRole;
      const matchesGroup = !filterGroup || employee.group?.name === filterGroup;
      
      return matchesSearch && matchesRole && matchesGroup;
    });
    
    // Sort filtered employees
    filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortField) {
        case 'name':
          aValue = `${a.lastName} ${a.firstName}`;
          bValue = `${b.lastName} ${b.firstName}`;
          break;
        case 'role':
          aValue = a.role;
          bValue = b.role;
          break;
        case 'group':
          aValue = a.group?.name || a.department || '';
          bValue = b.group?.name || b.department || '';
          break;
        case 'status':
          aValue = a.isActive;
          bValue = b.isActive;
          break;
        default:
          aValue = a.firstName;
          bValue = b.firstName;
      }
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    setFilteredEmployees(filtered);
  };

  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    // Schutz: admin/buchhaltung ohne Firma UND ohne Mandant wäre instanzweit – nur als ausdrücklicher Super-Admin erlaubt.
    if ((formData.role === 'admin' || formData.role === 'buchhaltung') && !formData.companyId && !formData.tenantId && !formData.isSuperAdmin) {
      toast.error(t('employees.instanceAdminWarning'));
      return;
    }
    setSaving(true);
    try {
      // Clean the form data to remove undefined values and ensure proper types
      const cleanedData = {
        ...formData,
        groupId: formData.groupId || null,
        entryDate: formData.entryDate || null,
        employeeNumber: formData.employeeNumber || null,
        department: formData.department || null,
        position: formData.position || null,
        phoneNumber: formData.phoneNumber || null,
        timeModelId: formData.timeModelId || null,
        nfcTagUid: formData.nfcTagUid?.trim() || null
      };

      // Remove password field if empty (for updates)
      if (editingEmployee && !cleanedData.password) {
        delete cleanedData.password;
      }

      // PIN nur senden, wenn neu gesetzt (wird nie angezeigt/zurückgeliefert).
      if (!cleanedData.pin) {
        delete cleanedData.pin;
      }

      // Remove undefined values
      Object.keys(cleanedData).forEach(key => {
        if (cleanedData[key as keyof typeof cleanedData] === undefined) {
          delete cleanedData[key as keyof typeof cleanedData];
        }
      });
      
      if (editingEmployee) {
        await api.put(`/users/${editingEmployee.id}`, cleanedData);
      } else {
        await api.post('/users', cleanedData);
      }
      
      fetchEmployees();
      resetForm();
    } catch (error) {
      console.error('Error saving employee:', error);
      // Validierungsfehler (express-validator) liefern {errors:[{msg}]} – konkrete Meldung zeigen.
      const d = (error as any)?.response?.data;
      const msg = d?.errors?.[0]?.msg || d?.message || d?.error || t('employees.saveError');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const { data } = await api.post('/users/import', { csv: text });
      toast.success(data.errors?.length
        ? t('employees.importResultErrors', { created: data.created, updated: data.updated, errors: data.errors.length })
        : t('employees.importResult', { created: data.created, updated: data.updated }));
      if (data.errors?.length) console.warn('CSV-Import-Fehler:', data.errors);
      fetchEmployees();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('employees.importFailed'));
    }
  };

  // Stempel-Code neu generieren (nur Admin; Server erzeugt und liefert den neuen Code).
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const handleRegenerateStampCode = async () => {
    if (!editingEmployee || regeneratingCode) return;
    setRegeneratingCode(true);
    try {
      const r = await api.post(`/users/${editingEmployee.id}/regenerate-stamp-code`);
      const code = r.data?.stampCode || r.data?.user?.stampCode || null;
      setEditingEmployee({ ...editingEmployee, stampCode: code });
      setEmployees((prev) => prev.map((e) => (e.id === editingEmployee.id ? { ...e, stampCode: code } : e)));
      toast.success(t('employees.stampCodeRegenerated'));
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.response?.data?.error || t('employees.stampCodeError'));
    } finally {
      setRegeneratingCode(false);
    }
  };

  // QR-Badge (Stempel-Code als QR) für einen Mitarbeiter herunterladen (nur Admin).
  const handleDownloadQrBadge = async (employee: Employee) => {
    try {
      const r = await api.get(`/users/${employee.id}/stamp-qr`, { responseType: 'blob' });
      // Dateiname bevorzugt aus Content-Disposition, sonst aus Name + MIME-Typ ableiten.
      const cd: string = r.headers['content-disposition'] || '';
      const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const ct: string = r.headers['content-type'] || 'image/png';
      const ext = ct.includes('pdf') ? 'pdf' : ct.includes('svg') ? 'svg' : ct.includes('jpeg') ? 'jpg' : 'png';
      const fallback = `qr-badge-${employee.firstName}-${employee.lastName}.${ext}`.replace(/\s+/g, '-');
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = cdMatch ? decodeURIComponent(cdMatch[1]) : fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error downloading QR badge:', error);
      toast.error(t('employees.qrBadgeError'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirm({ title: t('employees.deleteTitle'), message: t('employees.deleteMessage'), confirmText: t('employees.delete'), danger: true }))) return;

    try {
      await api.delete(`/users/${id}`);
      toast.success(t('employees.deleted'));
      fetchEmployees();
    } catch (error: any) {
      console.error('Error deleting employee:', error);
      toast.error(error.response?.data?.error || error.response?.data?.message || t('employees.deleteError'));
    }
  };

  const handleEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setHasExternalAccess(!!employee.email);
    setFormData({
      email: employee.email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      role: employee.role,
      department: employee.department || '',
      position: employee.position || '',
      phoneNumber: employee.phoneNumber || '',
      workingDaysOverride: (employee as any).workingDaysOverride ?? null,
      hoursPerDayOverride: (employee as any).hoursPerDayOverride ?? null,
      employmentFactor: (employee as any).employmentFactor ?? 1,
      exitDate: (employee as any).exitDate ? (employee as any).exitDate.split('T')[0] : '',
      groupId: employee.groupId,
      companyId: (employee as any).companyId ?? null,
      tenantId: (employee as any).tenantId ?? null,
      isSuperAdmin: (employee as any).isSuperAdmin ?? false,
      entryDate: employee.entryDate ? employee.entryDate.split('T')[0] : '',
      birthDate: employee.birthDate ? employee.birthDate.split('T')[0] : '',
      employeeNumber: employee.employeeNumber || '',
      timeModelId: employee.timeModelId ?? null,
      nfcTagUid: employee.nfcTagUid || '',
      pin: ''
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setShowModal(false);
    setEditingEmployee(null);
    setHasExternalAccess(false);
    setModalTab('basic');
    setFormData({
      email: '',
      firstName: '',
      lastName: '',
      role: 'mitarbeiter',
      department: '',
      position: '',
      phoneNumber: '',
      workingDaysOverride: null,
      hoursPerDayOverride: null,
      employmentFactor: 1,
      exitDate: '',
      password: '',
      groupId: undefined,
      companyId: null,
      tenantId: null,
      isSuperAdmin: false,
      entryDate: '',
      birthDate: '',
      employeeNumber: '',
      timeModelId: null,
      nfcTagUid: '',
      pin: ''
    });
  };

  // Shortcut von der Mandanten-Seite: Dialog vorausgefüllt für einen Mandanten-Admin öffnen
  // (?createTenantAdmin=<tenantId> → Rolle Admin, Mandant gesetzt, Firma leer).
  useEffect(() => {
    const tId = searchParams.get('createTenantAdmin');
    if (!tId || !user?.isSuperAdmin) return;
    resetForm();
    setModalTab('basic');
    setFormData((prev) => ({ ...prev, role: 'admin', tenantId: parseInt(tId), companyId: null }));
    setShowModal(true);
    searchParams.delete('createTenantAdmin');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.isSuperAdmin]);

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800';
      case 'buchhaltung': return 'bg-purple-100 text-purple-800';
      case 'verwaltung': return 'bg-primary-100 text-primary-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getRoleLabel = (role: string) => {
    const label = t(`roles.${role}`);
    return label !== `roles.${role}` ? label : role;
  };

  const uniqueGroups = groups;

  // Anniversary calculations
  // Tenure calculations
  const getTenureData = () => {
    return filteredEmployees
      .filter(emp => emp.startDate && emp.isActive)
      .map(emp => {
        const startDate = new Date(emp.startDate);
        const today = new Date();
        
        // Calculate years, months, and days
        let years = today.getFullYear() - startDate.getFullYear();
        let months = today.getMonth() - startDate.getMonth();
        let days = today.getDate() - startDate.getDate();
        
        // Adjust for negative days
        if (days < 0) {
          months--;
          const daysInPreviousMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
          days += daysInPreviousMonth;
        }
        
        // Adjust for negative months
        if (months < 0) {
          years--;
          months += 12;
        }
        
        const totalDays = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        
        return {
          ...emp,
          startDate,
          yearsOfService: years,
          monthsOfService: months,
          daysOfService: days,
          totalDays,
          tenureText: formatTenure(years, months, days)
        };
      })
      .sort((a, b) => {
        let aValue: any;
        let bValue: any;
        
        switch (tenureSortField) {
          case 'name':
            aValue = `${a.lastName} ${a.firstName}`;
            bValue = `${b.lastName} ${b.firstName}`;
            break;
          case 'startDate':
            aValue = a.startDate;
            bValue = b.startDate;
            break;
          case 'tenure':
            aValue = a.totalDays;
            bValue = b.totalDays;
            break;
          case 'totalDays':
            aValue = a.totalDays;
            bValue = b.totalDays;
            break;
          default:
            aValue = b.totalDays; // Default: longest tenure first
            bValue = a.totalDays;
        }
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }
        
        if (aValue < bValue) return tenureSortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return tenureSortDirection === 'asc' ? 1 : -1;
        return 0;
      });
  };

  const formatTenure = (years: number, months: number, days: number) => {
    const parts = [];
    if (years > 0) parts.push(`${years} ${t(years > 1 ? 'employees.unitYears' : 'employees.unitYear')}`);
    if (months > 0) parts.push(`${months} ${t(months > 1 ? 'employees.unitMonths' : 'employees.unitMonth')}`);
    if (days > 0 && years === 0) parts.push(`${days} ${t(days > 1 ? 'employees.unitDays' : 'employees.unitDay')}`);
    return parts.join(', ') || `0 ${t('employees.unitDays')}`;
  };

  const handlePrintTenure = () => {
    const tenureData = getTenureData();
    
    // Create print content
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;
    
    let tableRows = '';
    tenureData.forEach(emp => {
      const formattedStartDate = emp.startDate.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      
      tableRows += `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(emp.lastName)}, ${escapeHtml(emp.firstName)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${formattedStartDate}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${emp.tenureText}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${emp.totalDays}</td>
        </tr>
      `;
    });
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${t('employees.tenureHeading')}</title>
        <style>
          @page {
            size: A4;
            margin: 2cm;
            @bottom-right { content: "Seite " counter(page) " / " counter(pages); font-size: 8pt; color: #555; }
          }
          body {
            font-family: Arial, sans-serif; 
            font-size: 12px; 
            margin: 0; 
            padding: 0;
          }
          .header { 
            text-align: center; 
            font-size: 20px; 
            font-weight: bold; 
            margin-bottom: 30px; 
            border-bottom: 2px solid #334155;
            padding-bottom: 10px;
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-bottom: 20px; 
          }
          th {
            background: #f1f5f9;
            padding: 12px 8px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #cbd5e1;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 10px;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        ${printHeaderHtml(t('employees.tenureHeading'))}
        <table>
          <thead>
            <tr>
              <th>${t('employees.colName')}</th>
              <th>${t('employees.colEntryDate')}</th>
              <th>${t('employees.colDuration')}</th>
              <th style="text-align: center;">${t('employees.colTotalDays')}</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <div class="footer">
          ${copyrightText()} · ${t('employees.createdOn', { date: new Date().toLocaleDateString('de-DE') })} | ${t('employees.tenureFooterCount', { count: tenureData.length })}
        </div>
      </body>
      </html>
    `;
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    
    // Print after a short delay to ensure content is loaded
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const getUpcomingBirthdays = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return filteredEmployees
      .filter(emp => (emp as any).birthDate && emp.isActive)
      .map(emp => {
        const bd = new Date(((emp as any).birthDate as string).split('T')[0] + 'T00:00:00');
        const y = today.getFullYear();
        let next = new Date(y, bd.getMonth(), bd.getDate());
        if (next < today) next = new Date(y + 1, bd.getMonth(), bd.getDate());
        const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
        const turning = next.getFullYear() - bd.getFullYear();
        return { ...emp, birthDateObj: bd, nextBirthday: next, daysUntil, turning };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil);
  };

  const toggleBdaySort = (f: 'name' | 'birthday' | 'turning' | 'next') => {
    setBdaySortDir((p) => (bdaySortField === f ? (p === 'asc' ? 'desc' : 'asc') : 'asc'));
    setBdaySortField(f);
  };
  const bdayArrow = (f: string) => (bdaySortField === f ? (bdaySortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const getSortedBirthdays = () => {
    const val = (b: any): any => {
      switch (bdaySortField) {
        case 'name': return `${b.lastName} ${b.firstName}`.toLowerCase();
        case 'birthday': return b.birthDateObj.getMonth() * 100 + b.birthDateObj.getDate();
        case 'turning': return b.turning;
        case 'next': default: return b.daysUntil;
      }
    };
    return [...getUpcomingBirthdays()].sort((a, b) => {
      const av = val(a); const bv = val(b);
      if (av < bv) return bdaySortDir === 'asc' ? -1 : 1;
      if (av > bv) return bdaySortDir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const getCurrentYearAnniversaries = () => {
    const currentYear = new Date().getFullYear();
    const anniversaries = filteredEmployees
      .filter(emp => emp.startDate && emp.isActive)
      .map(emp => {
        const startDate = new Date(emp.startDate);
        const yearsOfService = currentYear - startDate.getFullYear();
        
        // Only show anniversaries for employees with at least 1 year of service
        if (yearsOfService < 1) return null;
        
        // Create anniversary date for current year
        const anniversaryDate = new Date(currentYear, startDate.getMonth(), startDate.getDate());
        
        return {
          ...emp,
          yearsOfService,
          anniversaryDate,
          startDate: startDate,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (!a || !b) return 0;
        
        let aValue: any;
        let bValue: any;
        
        switch (anniversarySortField) {
          case 'name':
            aValue = `${a.lastName} ${a.firstName}`;
            bValue = `${b.lastName} ${b.firstName}`;
            break;
          case 'startDate':
            aValue = a.startDate;
            bValue = b.startDate;
            break;
          case 'years':
            aValue = a.yearsOfService;
            bValue = b.yearsOfService;
            break;
          case 'anniversaryDate':
            aValue = a.anniversaryDate;
            bValue = b.anniversaryDate;
            break;
          default:
            aValue = a.anniversaryDate;
            bValue = b.anniversaryDate;
        }
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }
        
        if (aValue < bValue) return anniversarySortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return anniversarySortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    
    return anniversaries;
  };

  // ICS-Export (Kalenderdatei) – jährlich wiederkehrende Ganztagstermine, respektiert den aktuellen Filter.
  const fmtIcsDate = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const downloadIcs = (filename: string, events: Array<{ uid: string; date: string; summary: string; recurring?: boolean }>) => {
    const esc = (s: string) => String(s).replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TimeFeed//Export//DE', 'CALSCALE:GREGORIAN'];
    events.forEach((ev) => {
      lines.push('BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTART;VALUE=DATE:${ev.date}`);
      if (ev.recurring) lines.push('RRULE:FREQ=YEARLY');
      lines.push(`SUMMARY:${esc(ev.summary)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  };

  const exportBirthdaysIcs = () => {
    const evs = getUpcomingBirthdays().map((b) => ({ uid: `tf-bday-${b.id}@timefeed`, date: fmtIcsDate(b.birthDateObj), summary: `🎂 ${t('employees.birthDate')}: ${b.firstName} ${b.lastName}`, recurring: true }));
    if (evs.length === 0) { toast.error(t('employees.birthdayEmpty')); return; }
    downloadIcs('geburtstage.ics', evs);
  };

  const exportAnniversariesIcs = () => {
    // Jubiläen: einzelne, datierte Termine (KEINE Jahres-Wiederholung), da sich die Dienstjahre jährlich ändern.
    const yr = new Date().getFullYear();
    const evs = getCurrentYearAnniversaries().filter(Boolean).map((a: any) => ({
      uid: `tf-anniv-${a.id}-${yr}@timefeed`,
      date: fmtIcsDate(new Date(a.anniversaryDate)),
      summary: `${t('employees.turningYears', { count: a.yearsOfService })} ${t('employees.anniversaryWord')}: ${a.firstName} ${a.lastName}`,
      recurring: false,
    }));
    if (evs.length === 0) { toast.error(t('employees.anniversaryEmpty')); return; }
    downloadIcs(`jubilaeen-${yr}.ics`, evs);
  };

  // Druckausgabe der Geburtstage (gefiltert), Seitenzahlen wie bei den anderen Listen.
  const handlePrintBirthdays = () => {
    const list = getSortedBirthdays();
    const w = window.open('', '', 'width=800,height=600');
    if (!w) return;
    const rows = list.map((b) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(`${b.lastName}, ${b.firstName}`)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(b.department || b.position || '–')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.birthDateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center">${b.turning}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('employees.birthdayHeading'))}</title>
      <style>@page{size:A4;margin:2cm; @bottom-right{ content:"Seite " counter(page) " / " counter(pages); font-size:8pt; color:#555; }}
      body{font-family:Arial,sans-serif;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#f1f5f9;padding:10px 8px;text-align:left;border-bottom:2px solid #cbd5e1}</style></head><body>
      ${printHeaderHtml(t('employees.birthdayHeading'), `Stand: ${new Date().toLocaleDateString('de-DE')} · ${list.length}`)}
      <table><thead><tr><th>${t('employees.colName')}</th><th>Abteilung</th><th>${t('employees.colBirthday')}</th><th>${t('employees.colTurning')}</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  const handlePrintAnniversaries = () => {
    const anniversaries = getCurrentYearAnniversaries();
    const currentYear = new Date().getFullYear();
    
    // Create print content
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;
    
    let tableRows = '';
    anniversaries.forEach(emp => {
      if (!emp) return;
      const formattedDate = emp.anniversaryDate.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const formattedStartDate = emp.startDate.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      
      tableRows += `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(emp.lastName)}, ${escapeHtml(emp.firstName)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${formattedStartDate}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${emp.yearsOfService}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${formattedDate}</td>
        </tr>
      `;
    });
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${t('employees.jubileePrintTitle')} ${currentYear}</title>
        <style>
          @page {
            size: A4;
            margin: 2cm;
            @bottom-right { content: "Seite " counter(page) " / " counter(pages); font-size: 8pt; color: #555; }
          }
          body {
            font-family: Arial, sans-serif; 
            font-size: 12px; 
            margin: 0; 
            padding: 0;
          }
          .header { 
            text-align: center; 
            font-size: 20px; 
            font-weight: bold; 
            margin-bottom: 30px; 
            border-bottom: 2px solid #334155;
            padding-bottom: 10px;
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-bottom: 20px; 
          }
          th {
            background: #f1f5f9;
            padding: 12px 8px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #cbd5e1;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 10px;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        ${printHeaderHtml(t('employees.jubileePrintTitle'), String(currentYear))}
        <table>
          <thead>
            <tr>
              <th>${t('employees.colName')}</th>
              <th>${t('employees.colEntryDate')}</th>
              <th style="text-align: center;">${t('employees.colYearsInCompany')}</th>
              <th>${t('employees.colAnniversaryYear', { year: currentYear })}</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <div class="footer">
          ${copyrightText()} · ${t('employees.createdOn', { date: new Date().toLocaleDateString('de-DE') })} | ${t('employees.jubileeFooterCount', { count: anniversaries.length })}
        </div>
      </body>
      </html>
    `;
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    
    // Print after a short delay to ensure content is loaded
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  // Client-seitiger Rollen-Guard (API liefert ohnehin 403 — hier saubere Meldung
  // statt Fehlbanner; E2E-Befund). Nav zeigt die Seite nur admin/buchhaltung/verwaltung.
  if (user && !['admin', 'buchhaltung', 'verwaltung'].includes(user.role) && !user.isSuperAdmin) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">{t('employees.title')}</h1>
        <div className="card text-center">
          <p className="text-slate-600 dark:text-gray-400">{t('employees.accessDeniedText')}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">{t('employees.title')}</h1>
        <div className="card">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4"></div>
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={fetchEmployees} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <h1 className="text-3xl font-bold text-slate-900">{t('employees.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {activeTab === 'tenure' && (
            <button
              onClick={handlePrintTenure}
              className="btn-secondary flex items-center space-x-2"
            >
              <PrinterIcon className="h-5 w-5" />
              <span>{t('employees.print')}</span>
            </button>
          )}
          {activeTab === 'anniversaries' && (
            <>
              <button onClick={handlePrintAnniversaries} className="btn-secondary flex items-center space-x-2">
                <PrinterIcon className="h-5 w-5" />
                <span>{t('employees.print')}</span>
              </button>
              <button onClick={exportAnniversariesIcs} className="btn-secondary flex items-center space-x-2">
                <ArrowDownTrayIcon className="h-5 w-5" />
                <span>{t('employees.exportIcs')}</span>
              </button>
            </>
          )}
          {activeTab === 'birthdays' && (
            <>
              <button onClick={handlePrintBirthdays} className="btn-secondary flex items-center space-x-2">
                <PrinterIcon className="h-5 w-5" />
                <span>{t('employees.print')}</span>
              </button>
              <button onClick={exportBirthdaysIcs} className="btn-secondary flex items-center space-x-2">
                <ArrowDownTrayIcon className="h-5 w-5" />
                <span>{t('employees.exportIcs')}</span>
              </button>
            </>
          )}
          {(user?.role === 'admin' || user?.role === 'buchhaltung') && activeTab === 'employees' && (
            <label className="btn-secondary flex items-center space-x-2 cursor-pointer" title={t('employees.importCsvTitle')}>
              <ArrowUpTrayIcon className="h-5 w-5" />
              <span>{t('employees.importCsv')}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCsv} />
            </label>
          )}
          {(user?.role === 'admin' || user?.role === 'buchhaltung') && activeTab === 'employees' && (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex items-center space-x-2"
            >
              <PlusIcon className="h-5 w-5" />
              <span>{t('employees.add')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('employees')}
            className={clsx(
              'pb-2 px-1 border-b-2 font-medium text-sm transition-colors',
              activeTab === 'employees'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-600 hover:text-slate-700 hover:border-gray-300'
            )}
          >
            <div className="flex items-center space-x-2">
              <UsersIcon className="h-5 w-5" />
              <span>{t('employees.tabEmployees', { count: filteredEmployees.length })}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('tenure')}
            className={clsx(
              'pb-2 px-1 border-b-2 font-medium text-sm transition-colors',
              activeTab === 'tenure'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-600 hover:text-slate-700 hover:border-gray-300'
            )}
          >
            <div className="flex items-center space-x-2">
              <ClockIcon className="h-5 w-5" />
              <span>{t('employees.tabTenure', { count: getTenureData().length })}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('anniversaries')}
            className={clsx(
              'pb-2 px-1 border-b-2 font-medium text-sm transition-colors',
              activeTab === 'anniversaries'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-600 hover:text-slate-700 hover:border-gray-300'
            )}
          >
            <div className="flex items-center space-x-2">
              <GiftIcon className="h-5 w-5" />
              <span>{t('employees.tabAnniversaries', { count: getCurrentYearAnniversaries().length })}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('birthdays')}
            className={clsx(
              'pb-2 px-1 border-b-2 font-medium text-sm transition-colors',
              activeTab === 'birthdays'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-600 hover:text-slate-700 hover:border-gray-300'
            )}
          >
            <div className="flex items-center space-x-2">
              <CakeIcon className="h-5 w-5" />
              <span>{t('employees.tabBirthdays', { count: getUpcomingBirthdays().length })}</span>
            </div>
          </button>
        </nav>
      </div>

      {/* Search and Filters - Apply to all tabs */}
      <div className="card mb-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder={t('employees.searchPlaceholder')} />
          
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="input-field"
          >
            <option value="">{t('employees.allRoles')}</option>
            <option value="admin">{t('roles.admin')}</option>
            <option value="buchhaltung">{t('roles.buchhaltung')}</option>
            <option value="verwaltung">{t('roles.verwaltung')}</option>
            <option value="mitarbeiter">{t('roles.mitarbeiter')}</option>
          </select>
          
          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            className="input-field"
          >
            <option value="">{t('employees.allGroups')}</option>
            {uniqueGroups.map(group => (
              <option key={group.id} value={group.name}>{group.name}</option>
            ))}
          </select>
          
          <div className="text-sm text-slate-600 flex items-center">
            {t('employees.countOf', { count: filteredEmployees.length, total: employees.length })}
          </div>
        </div>
      </div>

      {activeTab === 'employees' && (
        <>
        {/* Employee Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="name">{t('employees.colName')}</SortButton>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="role">{t('employees.colRole')}</SortButton>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="group">{t('employees.colGroup')}</SortButton>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="status">{t('employees.colStatus')}</SortButton>
                </th>
                {(user?.role === 'admin' || user?.role === 'buchhaltung') && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">
                    {t('employees.colActions')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEmployees.map((employee) => (
                <tr key={employee.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button type="button" onClick={() => setDetailEmployee(employee)} className="flex items-center text-left group" title={t('employees.showDetails')}>
                      <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm mr-3">
                        {employee.firstName[0]}{employee.lastName[0]}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-gray-100 group-hover:text-primary-600">
                          {employee.firstName} {employee.lastName}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-gray-400">
                          {employee.email}
                        </div>
                      </div>
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`status-badge ${getRoleColor(employee.role)}`}>
                      {getRoleLabel(employee.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {employee.group?.name || employee.department || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={clsx(
                      'status-badge',
                      employee.isActive 
                        ? 'status-approved' 
                        : 'status-rejected'
                    )}>
                      {employee.isActive ? t('employees.active') : t('employees.inactive')}
                    </span>
                  </td>
                  {(user?.role === 'admin' || user?.role === 'buchhaltung') && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        {user?.role === 'admin' && employee.stampCode && (
                          <button
                            onClick={() => handleDownloadQrBadge(employee)}
                            className="text-slate-600 hover:text-slate-900 dark:text-gray-400 dark:hover:text-gray-200"
                            title={t('employees.qrBadge')}
                          >
                            <QrCodeIcon className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(employee)}
                          className="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-400"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(employee.id)}
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          
          {/* Empty State */}
          {filteredEmployees.length === 0 && (
            <div className="text-center py-12">
              <div className="bg-gray-50 rounded-lg p-8">
                <UsersIcon className="mx-auto h-12 w-12 text-slate-500 mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  {t('employees.emptyTitle')}
                </h3>
                <p className="text-slate-600 mb-3">
                  {searchTerm
                    ? t('employees.emptySearch', { term: searchTerm })
                    : t('employees.emptyNone')
                  }
                </p>
                {!searchTerm && (user?.role === 'admin' || user?.role === 'buchhaltung') && (
                  <div className="mt-6">
                    <button
                      onClick={() => {
                        setEditingEmployee(null);
                        setShowModal(true);
                      }}
                      className="btn-primary inline-flex items-center"
                    >
                      <UserPlusIcon className="h-4 w-4 mr-2" />
                      {t('employees.addFirst')}
                    </button>
                  </div>
                )}
                {searchTerm && (
                  <div className="mt-4">
                    <button
                      onClick={() => setSearchTerm('')}
                      className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                    >
                      {t('employees.resetSearch')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {activeTab === 'anniversaries' && (
        <div className="space-y-6">
          {/* Anniversary Summary */}
          <div className="card">
            <div className="flex items-center gap-3 py-1">
              <GiftIcon className="h-7 w-7 text-primary-600 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{t('employees.anniversaryHeading', { year: new Date().getFullYear() })}</h3>
                <p className="text-sm text-slate-600">{t('employees.anniversarySubtitle', { count: getCurrentYearAnniversaries().length })}</p>
              </div>
            </div>
          </div>

          {/* Anniversaries Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <AnniversarySortButton field="name" currentField={anniversarySortField} direction={anniversarySortDirection} onClick={handleAnniversarySort}>
                        {t('employees.colName')}
                      </AnniversarySortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <AnniversarySortButton field="startDate" currentField={anniversarySortField} direction={anniversarySortDirection} onClick={handleAnniversarySort}>
                        {t('employees.colEntryDate')}
                      </AnniversarySortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <AnniversarySortButton field="years" currentField={anniversarySortField} direction={anniversarySortDirection} onClick={handleAnniversarySort}>
                        {t('employees.colYearsInCompany')}
                      </AnniversarySortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <AnniversarySortButton field="anniversaryDate" currentField={anniversarySortField} direction={anniversarySortDirection} onClick={handleAnniversarySort}>
                        {t('employees.colAnniversaryYear', { year: new Date().getFullYear() })}
                      </AnniversarySortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      {t('employees.colStatus')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getCurrentYearAnniversaries().map((anniversary) => {
                    if (!anniversary) return null;
                    
                    const today = new Date();
                    const hasHappened = anniversary.anniversaryDate <= today;
                    const isUpcoming = anniversary.anniversaryDate > today && 
                                     anniversary.anniversaryDate <= new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
                    
                    return (
                      <tr key={anniversary.id} className={clsx(
                        'hover:bg-slate-50',
                        isUpcoming && 'bg-yellow-50'
                      )}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm mr-3">
                              {anniversary.firstName[0]}{anniversary.lastName[0]}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-900">
                                {anniversary.firstName} {anniversary.lastName}
                              </div>
                              <div className="text-sm text-slate-600">
                                {anniversary.department || anniversary.position || '-'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {anniversary.startDate.toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-2xl font-bold text-primary-600 mr-2">
                              {anniversary.yearsOfService}
                            </span>
                            <span className="text-sm text-slate-600">
                              {t('employees.years')}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {anniversary.anniversaryDate.toLocaleDateString('de-DE', {
                            weekday: 'long',
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric'
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={clsx(
                            'px-2 py-1 rounded-full text-xs font-medium',
                            hasHappened 
                              ? 'bg-green-100 text-green-800'
                              : isUpcoming
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-slate-100 text-slate-800'
                          )}>
                            {hasHappened
                              ? t('employees.statusCelebrated')
                              : isUpcoming
                                ? t('employees.statusSoon')
                                : t('employees.statusPlanned')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              
              {/* Empty State for Anniversaries */}
              {getCurrentYearAnniversaries().length === 0 && (
                <div className="text-center py-12">
                  <div className="bg-gray-50 rounded-lg p-8">
                    <GiftIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">
                      {t('employees.anniversaryEmptyTitle', { year: new Date().getFullYear() })}
                    </h3>
                    <p className="text-slate-600">
                      {t('employees.anniversaryEmptyText')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'birthdays' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 py-1">
              <CakeIcon className="h-7 w-7 text-primary-600 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{t('employees.birthdayHeading')}</h3>
                <p className="text-sm text-slate-600">{t('employees.birthdaySubtitle', { count: getUpcomingBirthdays().length })}</p>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              {getUpcomingBirthdays().length === 0 ? (
                <p className="text-sm text-slate-500 p-4">{t('employees.birthdayEmpty')}</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th onClick={() => toggleBdaySort('name')} className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-slate-800">{t('employees.colName')}{bdayArrow('name')}</th>
                      <th onClick={() => toggleBdaySort('birthday')} className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-slate-800">{t('employees.colBirthday')}{bdayArrow('birthday')}</th>
                      <th onClick={() => toggleBdaySort('turning')} className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-slate-800">{t('employees.colTurning')}{bdayArrow('turning')}</th>
                      <th onClick={() => toggleBdaySort('next')} className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-slate-800">{t('employees.colNextBirthday')}{bdayArrow('next')}</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {getSortedBirthdays().map((b) => (
                      <tr key={b.id} className={clsx('hover:bg-slate-50', b.daysUntil <= 7 && 'bg-yellow-50')}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm mr-3">
                              {b.firstName[0]}{b.lastName[0]}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-900">{b.firstName} {b.lastName}</div>
                              <div className="text-sm text-slate-600">{b.department || b.position || '-'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{b.birthDateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{t('employees.turningYears', { count: b.turning })}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={b.daysUntil <= 7 ? 'text-primary-700 font-medium' : 'text-slate-600'}>
                            {b.daysUntil === 0 ? t('employees.birthdayToday') : t('employees.birthdayInDays', { count: b.daysUntil })}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tenure' && (
        <div className="space-y-6">
          {/* Tenure Summary */}
          <div className="card">
            <div className="flex items-center gap-3 py-1">
              <ClockIcon className="h-7 w-7 text-primary-600 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{t('employees.tenureHeading')}</h3>
                <p className="text-sm text-slate-600">{t('employees.tenureSubtitle', { count: getTenureData().length })}</p>
              </div>
            </div>
          </div>

          {/* Tenure Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <TenureSortButton field="name" currentField={tenureSortField} direction={tenureSortDirection} onClick={handleTenureSort}>
                        {t('employees.colName')}
                      </TenureSortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <TenureSortButton field="startDate" currentField={tenureSortField} direction={tenureSortDirection} onClick={handleTenureSort}>
                        {t('employees.colEntryDate')}
                      </TenureSortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <TenureSortButton field="tenure" currentField={tenureSortField} direction={tenureSortDirection} onClick={handleTenureSort}>
                        {t('employees.colDuration')}
                      </TenureSortButton>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                      <TenureSortButton field="totalDays" currentField={tenureSortField} direction={tenureSortDirection} onClick={handleTenureSort}>
                        {t('employees.colTotalDays')}
                      </TenureSortButton>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getTenureData().map((empTenure) => {
                    return (
                      <tr key={empTenure.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm mr-3">
                              {empTenure.firstName[0]}{empTenure.lastName[0]}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-900">
                                {empTenure.firstName} {empTenure.lastName}
                              </div>
                              <div className="text-sm text-slate-600">
                                {empTenure.department || empTenure.position || '-'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {empTenure.startDate.toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-lg font-semibold text-primary-600 mr-2">
                              {empTenure.tenureText}
                            </span>
                          </div>
                          {empTenure.yearsOfService > 0 && (
                            <div className="text-xs text-slate-500">
                              {empTenure.yearsOfService > 1 ? t('employees.yearMany', { count: empTenure.yearsOfService }) : t('employees.yearOne', { count: empTenure.yearsOfService })}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 text-center">
                          {empTenure.totalDays.toLocaleString('de-DE')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              
              {/* Empty State for Tenure */}
              {getTenureData().length === 0 && (
                <div className="text-center py-12">
                  <div className="bg-gray-50 rounded-lg p-8">
                    <ClockIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">
                      {t('employees.tenureEmptyTitle')}
                    </h3>
                    <p className="text-slate-600">
                      {t('employees.tenureEmptyText')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal for Add/Edit Employee */}
      <Transition appear show={showModal} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={resetForm}>
          <Transition.Child as={React.Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full justify-center p-4 pt-20">
              <Dialog.Panel className="relative mx-4 p-5 border w-full md:w-3/4 lg:w-1/2 max-h-[90vh] overflow-y-auto shadow-lg rounded-md bg-white">
            <div className="absolute top-3 right-3">
              <button
                onClick={resetForm}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                title={t('employees.close')}
              >
                <XMarkIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
              </button>
            </div>
            <div className="mt-3">
              <h3 className="text-lg font-medium text-slate-900 mb-4">
                {editingEmployee ? t('employees.editTitle') : t('employees.addTitle')}
              </h3>

              {/* Modal Tabs */}
              <div className="flex flex-wrap gap-1 mb-4">
                <button
                  type="button"
                  onClick={() => setModalTab('basic')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    modalTab === 'basic' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('employees.modalTabBasic')}
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('advanced')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    modalTab === 'advanced' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('employees.modalTabAdvanced')}
                </button>
              </div>
              
              {modalTab === 'advanced' && (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                    <p className="text-sm font-medium text-slate-700">{t('employees.workingDays')}</p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox"
                        checked={formData.workingDaysOverride != null}
                        onChange={(e) => setFormData({ ...formData, workingDaysOverride: e.target.checked ? (formData.workingDaysOverride ?? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) : null })} />
                      <span className="text-sm text-slate-700">{t('employees.customWorkingDays')}</span>
                    </label>
                    {formData.workingDaysOverride != null && (
                      <div className="flex flex-wrap gap-3 pl-1">
                        {[{ id: 'monday', label: t('employees.dayMon') }, { id: 'tuesday', label: t('employees.dayTue') }, { id: 'wednesday', label: t('employees.dayWed') }, { id: 'thursday', label: t('employees.dayThu') }, { id: 'friday', label: t('employees.dayFri') }, { id: 'saturday', label: t('employees.daySat') }, { id: 'sunday', label: t('employees.daySun') }].map((d) => (
                          <label key={d.id} className="flex items-center gap-1.5">
                            <input type="checkbox"
                              checked={(formData.workingDaysOverride || []).includes(d.id)}
                              onChange={(e) => {
                                const cur = formData.workingDaysOverride || [];
                                const next = e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id);
                                setFormData({ ...formData, workingDaysOverride: next });
                              }} />
                            <span className="text-sm text-slate-700">{d.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                    <p className="text-sm font-medium text-slate-700">{t('employees.hoursPerDay')}</p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox"
                        checked={formData.hoursPerDayOverride != null}
                        onChange={(e) => setFormData({ ...formData, hoursPerDayOverride: e.target.checked ? (formData.hoursPerDayOverride ?? 8) : null })} />
                      <span className="text-sm text-slate-700">{t('employees.customHoursPerDay')}</span>
                    </label>
                    {formData.hoursPerDayOverride != null && (
                      <input type="number" min="1" max="24" step="0.5" value={formData.hoursPerDayOverride}
                        onChange={(e) => setFormData({ ...formData, hoursPerDayOverride: parseFloat(e.target.value) || 0 })}
                        className="input-field w-40" />
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                    <p className="text-sm font-medium text-slate-700">{t('employees.partTimeExit')}</p>
                    <div className="flex gap-4 flex-wrap">
                      <div>
                        <label className="block text-sm text-slate-600 mb-1">{t('employees.employmentFactor')}</label>
                        <input type="number" min="0" max="1" step="0.05" value={formData.employmentFactor ?? 1}
                          onChange={(e) => setFormData({ ...formData, employmentFactor: parseFloat(e.target.value) || 1 })}
                          className="input-field w-40" />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-600 mb-1">{t('employees.exitDate')}</label>
                        <input type="date" value={formData.exitDate || ''}
                          onChange={(e) => setFormData({ ...formData, exitDate: e.target.value })}
                          className="input-field w-44" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">{t('employees.partTimeNote')}</p>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-4 space-y-4">
                    <p className="text-sm font-medium text-slate-700">{t('employees.timeTracking')}</p>

                    <div>
                      <label className="block text-sm text-slate-600 mb-1">{t('employees.timeModelOverride')}</label>
                      <select
                        value={formData.timeModelId ?? ''}
                        onChange={(e) => setFormData({ ...formData, timeModelId: e.target.value ? parseInt(e.target.value) : null })}
                        className="input-field"
                      >
                        <option value="">{t('employees.timeModelDefault')}</option>
                        {timeModels.map((tm) => (
                          <option key={tm.id} value={tm.id}>{tm.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-400 mt-1">{t('employees.timeModelOverrideHint')}</p>
                    </div>

                    {editingEmployee && ['admin', 'buchhaltung', 'verwaltung'].includes(user?.role || '') && (
                      <div>
                        <label className="block text-sm text-slate-600 mb-1">{t('employees.stampCode')}</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={editingEmployee.stampCode || '–'}
                            className="input-field w-44 bg-slate-100 text-slate-600 tabular-nums"
                          />
                          {user?.role === 'admin' && (
                            <button
                              type="button"
                              onClick={handleRegenerateStampCode}
                              disabled={regeneratingCode}
                              className="btn-secondary text-sm"
                            >
                              {regeneratingCode ? t('employees.stampCodeRegenerating') : t('employees.regenerateStampCode')}
                            </button>
                          )}
                          {user?.role === 'admin' && editingEmployee.stampCode && (
                            <button
                              type="button"
                              onClick={() => handleDownloadQrBadge(editingEmployee)}
                              className="btn-secondary text-sm flex items-center gap-1.5"
                            >
                              <QrCodeIcon className="h-4 w-4" /> {t('employees.qrBadge')}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{t('employees.stampCodeHint')}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-slate-600 mb-1">{t('employees.nfcTagUid')}</label>
                        <input
                          type="text"
                          value={formData.nfcTagUid || ''}
                          onChange={(e) => setFormData({ ...formData, nfcTagUid: e.target.value })}
                          className="input-field"
                          placeholder={t('employees.nfcTagUidPlaceholder')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-600 mb-1">{t('employees.pin')}</label>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={formData.pin || ''}
                          onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                          className="input-field"
                          placeholder={t('employees.pinPlaceholder')}
                        />
                        <p className="text-xs text-slate-400 mt-1">{t('employees.pinHint')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={resetForm} className="btn-secondary">{t('employees.cancel')}</button>
                    <button type="submit" disabled={saving} className="btn-primary">{saving ? t('employees.saving') : t('employees.save')}</button>
                  </div>
                </form>
              )}

              {modalTab === 'basic' && (
                <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.firstName')}
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.firstName}
                      onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                      className="input-field"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.lastName')}
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.lastName}
                      onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="externalAccess"
                      checked={hasExternalAccess}
                      onChange={(e) => {
                        setHasExternalAccess(e.target.checked);
                        if (!e.target.checked) {
                          setFormData({...formData, email: '', password: ''});
                        }
                      }}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="externalAccess" className="ml-2 text-sm text-slate-700">
                      <span className="font-medium">{t('employees.externalAccess')}</span>
                      <p className="text-slate-600 text-xs mt-1">{t('employees.externalAccessHint')}</p>
                    </label>
                  </div>
                </div>
                
                {hasExternalAccess && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        {t('employees.email')}
                      </label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        className="input-field"
                      />
                    </div>
                    
                    {!editingEmployee && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          {t('employees.password')}
                        </label>
                        <input
                          type="password"
                          required={!editingEmployee}
                          value={formData.password || ''}
                          onChange={(e) => setFormData({...formData, password: e.target.value})}
                          className="input-field"
                        />
                      </div>
                    )}
                  </>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.role')}
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({...formData, role: e.target.value})}
                      className="input-field"
                    >
                      <option value="mitarbeiter">{t('roles.mitarbeiter')}</option>
                      <option value="verwaltung">{t('roles.verwaltung')}</option>
                      <option value="buchhaltung">{t('roles.buchhaltung')}</option>
                      <option value="admin">{t('roles.admin')}</option>
                    </select>
                  </div>
                  
                </div>

                {user?.isSuperAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t('employees.tenantLabel')}</label>
                    <SearchableSelect
                      value={formData.tenantId ? String(formData.tenantId) : ''}
                      onChange={(v) => setFormData({ ...formData, tenantId: v ? parseInt(v) : null })}
                      options={tenantsList.map((tt) => ({ value: String(tt.id), label: tt.name }))}
                      placeholder={t('employees.tenantNone')}
                    />
                  </div>
                )}

                {canAssignCompany && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t('employees.companyLabel')}</label>
                    <SearchableSelect
                      value={formData.companyId ? String(formData.companyId) : ''}
                      onChange={(v) => setFormData({ ...formData, companyId: v ? parseInt(v) : null })}
                      options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
                      placeholder={t('employees.companyPlaceholder')}
                    />
                  </div>
                )}

                {user?.isSuperAdmin && (formData.role === 'admin' || formData.role === 'buchhaltung') && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <input type="checkbox" checked={!!formData.isSuperAdmin}
                        onChange={(e) => setFormData({ ...formData, isSuperAdmin: e.target.checked })} />
                      {t('employees.superAdminLabel')}
                    </label>
                    <p className="text-xs text-amber-700 mt-1">{t('employees.superAdminHint')}</p>
                    {!formData.isSuperAdmin && !formData.companyId && !formData.tenantId && (
                      <p className="text-xs text-red-600 mt-1">{t('employees.instanceAdminWarning')}</p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.group')}
                    </label>
                    <SearchableSelect
                      value={formData.groupId ? String(formData.groupId) : ''}
                      onChange={(v) => setFormData({...formData, groupId: v ? parseInt(v) : undefined})}
                      options={groups.map((group) => ({ value: String(group.id), label: group.name }))}
                      placeholder={t('employees.selectGroup')}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.position')}
                    </label>
                    <input
                      type="text"
                      value={formData.position || ''}
                      onChange={(e) => setFormData({...formData, position: e.target.value})}
                      className="input-field"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('employees.phoneNumber')}
                  </label>
                  <input
                    type="tel"
                    value={formData.phoneNumber || ''}
                    onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                    className="input-field"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.birthDate')}
                    </label>
                    <input
                      type="date"
                      value={formData.birthDate || ''}
                      onChange={(e) => setFormData({...formData, birthDate: e.target.value})}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.entryDate')}
                    </label>
                    <input
                      type="date"
                      value={formData.entryDate || ''}
                      onChange={(e) => setFormData({...formData, entryDate: e.target.value})}
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('employees.employeeNumber')}
                    </label>
                    <input
                      type="text"
                      value={formData.employeeNumber || ''}
                      onChange={(e) => setFormData({...formData, employeeNumber: e.target.value})}
                      className="input-field"
                      placeholder={t('employees.employeeNumberPlaceholder')}
                    />
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="btn-secondary"
                  >
                    {t('employees.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={saving}
                  >
                    {saving ? t('employees.saving') : (editingEmployee ? t('employees.save') : t('employees.addBtn'))}
                  </button>
                </div>
              </form>
              )}
            </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition>

      <EmployeeDetailModal employee={detailEmployee} onClose={() => setDetailEmployee(null)} />
    </div>
  );
};

export default Employees;