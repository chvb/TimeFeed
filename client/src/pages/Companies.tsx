import { useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, PencilIcon, TrashIcon, BuildingOffice2Icon, XMarkIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useConfirm } from '../components/common/ConfirmProvider';
import SearchInput from '../components/common/SearchInput';
import { matchesSearch } from '../lib/normalize';
import { useAuthStore, isTenantAdmin as isTenantAdminFn } from '../store/authStore';
import { useT } from '../i18n';

interface Company {
  id: number;
  name: string;
  tenantId?: number | null;
  tenantName?: string | null;
  bundesland?: string | null;
  logo?: string | null;
  isActive: boolean;
  userCount?: number;
}

const BUNDESLAENDER: Array<[string, string]> = [
  ['', '— kein —'], ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'],
  ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'],
  ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen'],
];

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<{ name: string; bundesland: string; isActive: boolean; logo: string | null; tenantId: number | null }>({ name: '', bundesland: '', isActive: true, logo: null, tenantId: null });
  const [saving, setSaving] = useState(false);
  const { confirm } = useConfirm();
  const { user } = useAuthStore();
  const t = useT();
  const [sortField, setSortField] = useState<'name' | 'tenant' | 'state' | 'employees' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const load = async () => {
    try {
      const res = await api.get('/companies');
      setCompanies(res.data.companies || []);
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('companies.tLoadError'));
    }
  };
  useEffect(() => {
    load();
    // Mandantenliste nur für Super-Admin (für die Mandanten-Zuordnung im Dialog).
    if (user?.isSuperAdmin) {
      api.get('/tenants').then((r) => setTenants((r.data.tenants || []).map((t: any) => ({ id: t.id, name: t.name })))).catch(() => {});
    }
  }, [user?.isSuperAdmin]);

  const openCreate = () => { setEditing(null); setForm({ name: '', bundesland: '', isActive: true, logo: null, tenantId: tenants[0]?.id ?? null }); setModalOpen(true); };
  const openEdit = (c: Company) => { setEditing(c); setForm({ name: c.name, bundesland: c.bundesland || '', isActive: c.isActive, logo: c.logo || null, tenantId: c.tenantId ?? null }); setModalOpen(true); };

  // Logo-Datei → Data-URL (max ~200 KB, wird im Druck/PDF-Kopf verwendet).
  const onLogoFile = (file?: File) => {
    if (!file) return;
    if (file.size > 200 * 1024) { toast.error(t('companies.tLogoTooBig')); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error(t('companies.tNameRequired')); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), bundesland: form.bundesland || null, isActive: form.isActive, logo: form.logo, tenantId: form.tenantId };
      if (editing) await api.put(`/companies/${editing.id}`, payload);
      else await api.post('/companies', payload);
      toast.success(editing ? t('companies.tSaved') : t('companies.tCreated'));
      setModalOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('companies.tSaveError'));
    } finally { setSaving(false); }
  };

  const remove = async (c: Company) => {
    const ok = await confirm({ title: t('companies.delConfirmTitle'), message: t('companies.delConfirmMsg', { name: c.name }), confirmText: t('companies.delConfirmBtn'), danger: true });
    if (!ok) return;
    try {
      await api.delete(`/companies/${c.id}`);
      toast.success(t('companies.tDeleted'));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('companies.tDeleteError'));
    }
  };

  const handleSort = (field: 'name' | 'tenant' | 'state' | 'employees' | 'status') => {
    if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };
  const SortButton = ({ field, children }: { field: 'name' | 'tenant' | 'state' | 'employees' | 'status'; children: React.ReactNode }) => (
    <button onClick={() => handleSort(field)} className="flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer uppercase">
      <span>{children}</span>
      {sortField === field ? (sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />) : <div className="h-4 w-4" />}
    </button>
  );

  const blName = (code?: string | null) => BUNDESLAENDER.find(([k]) => k === (code || ''))?.[1] || '—';
  const filtered = companies.filter((c) => matchesSearch(`${c.name} ${c.bundesland || ''}`, search)).sort((a, b) => {
    let av: any; let bv: any;
    if (sortField === 'tenant') { av = (a.tenantName || '').toLowerCase(); bv = (b.tenantName || '').toLowerCase(); }
    else if (sortField === 'state') { av = blName(a.bundesland).toLowerCase(); bv = blName(b.bundesland).toLowerCase(); }
    else if (sortField === 'employees') { av = a.userCount ?? 0; bv = b.userCount ?? 0; }
    else if (sortField === 'status') { av = a.isActive ? 1 : 0; bv = b.isActive ? 1 : 0; }
    else { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
    if (av < bv) return sortDirection === 'asc' ? -1 : 1;
    if (av > bv) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Zugriff: Super-Admin oder Mandanten-Admin (admin/hr mit Mandant, ohne feste Firma).
  const isTenantAdmin = isTenantAdminFn(user);
  if (!user?.isSuperAdmin && !isTenantAdmin) {
    return <div className="p-8 text-center text-slate-500">{t('companies.noAccess')}</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><BuildingOffice2Icon className="h-8 w-8 text-primary-600" /> {t('companies.title')}</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><PlusIcon className="h-5 w-5" /> {t('companies.new')}</button>
      </div>

      <p className="text-sm text-slate-500 mb-4">{t('companies.subtitle')}</p>

      <div className="mb-3 max-w-sm"><SearchInput value={search} onChange={setSearch} placeholder={t('companies.searchPlaceholder')} /></div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600"><SortButton field="name">{t('companies.colName')}</SortButton></th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600"><SortButton field="tenant">{t('companies.colTenant')}</SortButton></th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600"><SortButton field="state">{t('companies.colState')}</SortButton></th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600"><div className="flex justify-center"><SortButton field="employees">{t('companies.colEmployees')}</SortButton></div></th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600"><div className="flex justify-center"><SortButton field="status">{t('companies.colStatus')}</SortButton></div></th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase">{t('companies.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.tenantName || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{blName(c.bundesland)}</td>
                <td className="px-4 py-3 text-center text-slate-600">{c.userCount ?? 0}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{c.isActive ? t('companies.active') : t('companies.inactive')}</span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(c)} className="text-slate-400 hover:text-primary-600 mr-3" title={t('companies.edit')}><PencilIcon className="h-5 w-5 inline" /></button>
                  <button onClick={() => remove(c)} className="text-slate-400 hover:text-red-600" title={t('companies.delete')}><TrashIcon className="h-5 w-5 inline" /></button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">{t('companies.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Transition appear show={modalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setModalOpen(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title className="text-lg font-semibold text-slate-900">{editing ? t('companies.editTitle') : t('companies.newTitle')}</Dialog.Title>
                    <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="h-5 w-5" /></button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('companies.nameLabel')}</label>
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field w-full" placeholder={t('companies.namePlaceholder')} />
                    </div>
                    {user?.isSuperAdmin && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">{t('companies.tenantLabel')}</label>
                        <select value={form.tenantId ?? ''} onChange={(e) => setForm({ ...form, tenantId: e.target.value ? parseInt(e.target.value) : null })} className="input-field w-full">
                          <option value="">{t('companies.tenantNone')}</option>
                          {tenants.map((tn) => <option key={tn.id} value={tn.id}>{tn.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('companies.stateLabel')}</label>
                      <select value={form.bundesland} onChange={(e) => setForm({ ...form, bundesland: e.target.value })} className="input-field w-full">
                        {BUNDESLAENDER.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('companies.logoLabel')}</label>
                      <div className="flex items-center gap-3">
                        {form.logo && <img src={form.logo} alt="Logo" className="h-10 w-auto max-w-[120px] object-contain border border-slate-200 rounded" />}
                        <input type="file" accept="image/*" onChange={(e) => onLogoFile(e.target.files?.[0])} className="text-sm" />
                        {form.logo && <button type="button" onClick={() => setForm({ ...form, logo: null })} className="text-xs text-red-600 hover:underline">{t('companies.logoRemove')}</button>}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {t('companies.activeLabel')}
                    </label>
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button onClick={() => setModalOpen(false)} className="btn-secondary">{t('companies.cancel')}</button>
                    <button onClick={save} disabled={saving} className="btn-primary">{saving ? t('companies.saving') : t('companies.save')}</button>
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
