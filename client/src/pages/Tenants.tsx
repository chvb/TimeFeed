import { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import toast from 'react-hot-toast';
import { PlusIcon, PencilIcon, TrashIcon, BuildingLibraryIcon, BuildingOffice2Icon, UserPlusIcon, XMarkIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useConfirm } from '../components/common/ConfirmProvider';
import SearchInput from '../components/common/SearchInput';
import { matchesSearch } from '../lib/normalize';
import { useAuthStore, isTenantAdmin as isTenantAdminFn } from '../store/authStore';
import { loadBranding } from '../lib/branding';
import { useT } from '../i18n';

interface Tenant {
  id: number;
  name: string;
  isActive: boolean;
  companyCount?: number;
  brandName?: string | null;
  brandColor?: string | null;
  brandLogo?: string | null;
}

interface BrandingForm {
  brandName: string;
  brandColor: string;
  brandLogo: string; // Data-URL oder ''
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState<{ name: string; isActive: boolean }>({ name: '', isActive: true });
  const [branding, setBranding] = useState<BrandingForm>({ brandName: '', brandColor: '', brandLogo: '' });
  const [saving, setSaving] = useState(false);
  const { confirm } = useConfirm();
  const { user } = useAuthStore();
  const t = useT();
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<'name' | 'companies' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [companiesView, setCompaniesView] = useState<{ tenant: string; companies: { id: number; name: string }[] } | null>(null);

  const load = async () => {
    try {
      if (user?.isSuperAdmin) {
        const res = await api.get('/tenants');
        setTenants(res.data.tenants || []);
      } else {
        // Mandanten-Admin: GET /tenants ist Super-Admin-only → eigene Zeile aus
        // GET /api/branding (+ Name aus /companies/options) zusammensetzen.
        const [b, opts] = await Promise.all([
          api.get('/branding'),
          api.get('/companies/options').catch(() => ({ data: {} } as any)),
        ]);
        const tid = b.data?.tenantId ?? user?.tenantId;
        if (!tid) { setTenants([]); return; }
        const tn = (opts.data?.tenants || []).find((x: any) => x.id === tid);
        setTenants([{
          id: tid,
          name: tn?.name || b.data?.brandName || `#${tid}`,
          isActive: true,
          brandName: b.data?.brandName ?? null,
          brandColor: b.data?.brandColor ?? null,
          brandLogo: b.data?.brandLogo ?? null,
        }]);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('tenants.tLoadError'));
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', isActive: true });
    setBranding({ brandName: '', brandColor: '', brandLogo: '' });
    setModalOpen(true);
  };

  const openEdit = async (tn: Tenant) => {
    setEditing(tn);
    setForm({ name: tn.name, isActive: tn.isActive });
    setBranding({ brandName: tn.brandName || '', brandColor: tn.brandColor || '', brandLogo: tn.brandLogo || '' });
    setModalOpen(true);
    // Branding-Felder ggf. nachladen (GET /tenants/:id ist Super-Admin-only).
    if (!user?.isSuperAdmin) return;
    try {
      const r = await api.get(`/tenants/${tn.id}`);
      const d = r.data.tenant || r.data;
      setBranding({
        brandName: d.brandName || tn.brandName || '',
        brandColor: d.brandColor || tn.brandColor || '',
        brandLogo: d.brandLogo || tn.brandLogo || '',
      });
    } catch { /* Detail nicht verfügbar → Werte aus der Liste behalten */ }
  };

  const onLogoFile = (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/svg+xml'].includes(file.type)) { toast.error(t('tenants.brandLogoWrongType')); return; }
    if (file.size > 500 * 1024) { toast.error(t('tenants.brandLogoTooBig')); return; }
    const reader = new FileReader();
    reader.onload = () => setBranding((b) => ({ ...b, brandLogo: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error(t('tenants.tNameRequired')); return; }
    if (branding.brandColor && !HEX_RE.test(branding.brandColor)) { toast.error(t('tenants.brandColorInvalid')); return; }
    setSaving(true);
    try {
      let id = editing?.id;
      // Stammdaten (Name/aktiv) darf nur der Super-Admin ändern.
      if (user?.isSuperAdmin) {
        const payload = { name: form.name.trim(), isActive: form.isActive };
        if (editing) await api.put(`/tenants/${editing.id}`, payload);
        else { const r = await api.post('/tenants', payload); id = r.data.tenant?.id ?? r.data.id; }
      }
      // Branding separat speichern (PUT /api/tenants/:id/branding) — nur beim Bearbeiten.
      if (editing && id != null) {
        try {
          await api.put(`/tenants/${id}/branding`, {
            brandName: branding.brandName.trim() || null,
            brandColor: branding.brandColor || null,
            brandLogo: branding.brandLogo || null,
          });
        } catch (e: any) {
          toast.error(e.response?.data?.message || e.response?.data?.error || t('tenants.brandingSaveError'));
        }
        // Eigenes Branding sofort anwenden (Header/Farbe/Manifest live aktualisieren).
        if (user?.tenantId === id) loadBranding(id);
      }
      toast.success(editing ? t('tenants.tSaved') : t('tenants.tCreated'));
      setModalOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('tenants.tSaveError'));
    } finally { setSaving(false); }
  };

  const remove = async (tn: Tenant) => {
    const ok = await confirm({ title: t('tenants.delConfirmTitle'), message: t('tenants.delConfirmMsg', { name: tn.name }), confirmText: t('tenants.delConfirmBtn'), danger: true });
    if (!ok) return;
    try {
      await api.delete(`/tenants/${tn.id}`);
      toast.success(t('tenants.tDeleted'));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('tenants.tDeleteError'));
    }
  };

  // Firmen eines Mandanten nachladen (Liste liefert nur die Anzahl) und anzeigen.
  const showCompanies = async (tn: Tenant) => {
    try {
      const r = await api.get(`/tenants/${tn.id}`);
      setCompaniesView({ tenant: tn.name, companies: r.data.companies || [] });
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('tenants.tLoadError'));
    }
  };

  const handleSort = (field: 'name' | 'companies' | 'status') => {
    if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };
  const SortButton = ({ field, children }: { field: 'name' | 'companies' | 'status'; children: React.ReactNode }) => (
    <button onClick={() => handleSort(field)} className="flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer uppercase">
      <span>{children}</span>
      {sortField === field ? (sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />) : <div className="h-4 w-4" />}
    </button>
  );

  const superAdmin = !!user?.isSuperAdmin;
  const tenantAdmin = isTenantAdminFn(user);

  const filtered = tenants
    // Mandanten-Admin sieht nur den eigenen Mandanten (Branding-Pflege).
    .filter((tn) => superAdmin || tn.id === user?.tenantId)
    .filter((tn) => matchesSearch(tn.name, search)).sort((a, b) => {
    let av: any; let bv: any;
    if (sortField === 'companies') { av = a.companyCount ?? 0; bv = b.companyCount ?? 0; }
    else if (sortField === 'status') { av = a.isActive ? 1 : 0; bv = b.isActive ? 1 : 0; }
    else { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
    if (av < bv) return sortDirection === 'asc' ? -1 : 1;
    if (av > bv) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Mandantenverwaltung: Super-Admin (vollständig) oder Mandanten-Admin (eigener Mandant/Branding).
  if (!superAdmin && !tenantAdmin) {
    return <div className="p-8 text-center text-slate-500">{t('tenants.noAccess')}</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><BuildingLibraryIcon className="h-8 w-8 text-primary-600" /> {t('tenants.title')}</h1>
        {superAdmin && (
          <button onClick={openCreate} className="btn-primary flex items-center gap-2"><PlusIcon className="h-5 w-5" /> {t('tenants.new')}</button>
        )}
      </div>

      <p className="text-sm text-slate-500 mb-4">{t('tenants.subtitle')}</p>

      <div className="mb-3 max-w-sm"><SearchInput value={search} onChange={setSearch} placeholder={t('tenants.searchPlaceholder')} /></div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600"><SortButton field="name">{t('tenants.colName')}</SortButton></th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600"><div className="flex justify-center"><SortButton field="companies">{t('tenants.colCompanies')}</SortButton></div></th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600"><div className="flex justify-center"><SortButton field="status">{t('tenants.colStatus')}</SortButton></div></th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase">{t('tenants.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((tn) => (
              <tr key={tn.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{tn.name}</td>
                <td className="px-4 py-3 text-center text-slate-600">
                  {tn.companyCount ? (
                    <button onClick={() => showCompanies(tn)} className="text-primary-600 hover:underline font-medium" title={t('tenants.colCompanies')}>{tn.companyCount}</button>
                  ) : (<span>0</span>)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tn.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{tn.isActive ? t('tenants.active') : t('tenants.inactive')}</span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {superAdmin && (
                    <button onClick={() => navigate(`/employees?createTenantAdmin=${tn.id}`)} className="text-slate-400 hover:text-primary-600 mr-3" title={t('tenants.createAdmin')}><UserPlusIcon className="h-5 w-5 inline" /></button>
                  )}
                  <button onClick={() => openEdit(tn)} className="text-slate-400 hover:text-primary-600" title={t('tenants.edit')}><PencilIcon className="h-5 w-5 inline" /></button>
                  {superAdmin && (
                    <button onClick={() => remove(tn)} className="text-slate-400 hover:text-red-600 ml-3" title={t('tenants.delete')}><TrashIcon className="h-5 w-5 inline" /></button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">{t('tenants.empty')}</td></tr>
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
                    <Dialog.Title className="text-lg font-semibold text-slate-900">{editing ? t('tenants.editTitle') : t('tenants.newTitle')}</Dialog.Title>
                    <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="h-5 w-5" /></button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t('tenants.nameLabel')}</label>
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!superAdmin} className="input-field w-full disabled:bg-slate-100 disabled:text-slate-500" placeholder={t('tenants.namePlaceholder')} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={form.isActive} disabled={!superAdmin} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {t('tenants.activeLabel')}
                    </label>

                    {/* Branding (nur im Bearbeiten-Dialog) */}
                    {editing && (
                      <div className="pt-4 border-t border-slate-200 space-y-4">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">{t('tenants.brandingHeading')}</h4>
                          <p className="text-xs text-slate-500 mt-0.5">{t('tenants.brandingHint')}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">{t('tenants.brandNameLabel')}</label>
                          <input
                            value={branding.brandName}
                            onChange={(e) => setBranding({ ...branding, brandName: e.target.value })}
                            className="input-field w-full"
                            placeholder={t('tenants.brandNamePlaceholder')}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">{t('tenants.brandColorLabel')}</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={HEX_RE.test(branding.brandColor) ? branding.brandColor : '#ea580c'}
                              onChange={(e) => setBranding({ ...branding, brandColor: e.target.value })}
                              className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer bg-white p-1"
                              aria-label={t('tenants.brandColorLabel')}
                            />
                            <input
                              value={branding.brandColor}
                              onChange={(e) => setBranding({ ...branding, brandColor: e.target.value.trim() })}
                              className="input-field w-32 font-mono text-sm"
                              placeholder="#ea580c"
                              maxLength={7}
                            />
                            {branding.brandColor && (
                              <button type="button" onClick={() => setBranding({ ...branding, brandColor: '' })} className="text-xs text-slate-400 hover:text-red-600">
                                {t('tenants.brandLogoRemove')}
                              </button>
                            )}
                          </div>
                          {branding.brandColor && !HEX_RE.test(branding.brandColor) && (
                            <p className="text-xs text-red-600 mt-1">{t('tenants.brandColorInvalid')}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">{t('tenants.brandLogoLabel')}</label>
                          <div className="flex items-center gap-3">
                            {branding.brandLogo && (
                              <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-white p-1 flex-shrink-0">
                                <img src={branding.brandLogo} alt="" className="max-h-full max-w-full object-contain" />
                              </span>
                            )}
                            <label className="btn-secondary cursor-pointer text-sm">
                              {t('tenants.brandLogoUpload')}
                              <input
                                type="file"
                                accept="image/png,image/svg+xml"
                                className="sr-only"
                                onChange={(e) => { onLogoFile(e.target.files?.[0] || null); e.target.value = ''; }}
                              />
                            </label>
                            {branding.brandLogo && (
                              <button type="button" onClick={() => setBranding({ ...branding, brandLogo: '' })} className="text-xs text-slate-400 hover:text-red-600">
                                {t('tenants.brandLogoRemove')}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button onClick={() => setModalOpen(false)} className="btn-secondary">{t('tenants.cancel')}</button>
                    <button onClick={save} disabled={saving} className="btn-primary">{saving ? t('tenants.saving') : t('tenants.save')}</button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Firmen des Mandanten anzeigen */}
      <Transition appear show={!!companiesView} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setCompaniesView(null)}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title className="text-lg font-semibold text-slate-900">{t('tenants.companiesInTenant', { name: companiesView?.tenant || '' })}</Dialog.Title>
                    <button onClick={() => setCompaniesView(null)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="h-5 w-5" /></button>
                  </div>
                  {companiesView && companiesView.companies.length > 0 ? (
                    <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                      {companiesView.companies.map((c) => (
                        <li key={c.id} className="py-2 flex items-center gap-2 text-slate-800">
                          <BuildingOffice2Icon className="h-4 w-4 text-slate-400" /> {c.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">{t('tenants.noCompanies')}</p>
                  )}
                  <div className="mt-6 flex justify-end">
                    <button onClick={() => setCompaniesView(null)} className="btn-secondary">{t('tenants.close')}</button>
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
