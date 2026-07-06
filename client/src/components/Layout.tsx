import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';
import {
  HomeIcon,
  ClockIcon,
  AdjustmentsHorizontalIcon,
  UsersIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  Bars3Icon,
  XMarkIcon,
  SunIcon,
  MoonIcon,
  ChevronDownIcon,
  BuildingOffice2Icon,
  BuildingLibraryIcon,
  DeviceTabletIcon,
  ClipboardDocumentListIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore, isTenantAdmin as isTenantAdminFn } from '../store/authStore';
import { useT, useI18n } from '../i18n';
import { useState, useEffect, useRef } from 'react';
import { useUpdateAvailable } from '../hooks/useUpdateAvailable';
import UpdateBanner from './common/UpdateBanner';
import api from '../lib/api';
import ChangelogModal from './common/ChangelogModal';
import { APP_VERSION } from '../constants/version';
import clsx from 'clsx';
import Logo from './common/Logo';
import AppFooter from './common/AppFooter';

interface NavChild { name: string; href: string }
interface NavItem { name: string; tKey?: string; href?: string; icon: any; roles?: string[]; superAdmin?: boolean; companyManager?: boolean; children?: NavChild[] }

const navigation: NavItem[] = [
  { name: 'Dashboard', tKey: 'nav.dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Meine Zeiten', tKey: 'nav.myTimes', href: '/times', icon: ClockIcon },
  { name: 'Zeiten verwalten', tKey: 'nav.manageTimes', href: '/manage-times', icon: ClipboardDocumentListIcon, roles: ['admin', 'buchhaltung', 'verwaltung'] },
  { name: 'Anwesenheit', tKey: 'nav.presence', href: '/presence', icon: UserGroupIcon, roles: ['admin', 'buchhaltung', 'verwaltung'] },
  { name: 'Mitarbeiter', tKey: 'nav.employees', href: '/employees', icon: UsersIcon, roles: ['admin', 'buchhaltung', 'verwaltung'] },
  { name: 'Gruppen & Abteilungen', tKey: 'nav.groups', href: '/groups', icon: UserGroupIcon, roles: ['admin', 'buchhaltung', 'verwaltung'] },
  { name: 'Zeitmodelle', tKey: 'nav.timeModels', href: '/time-models', icon: AdjustmentsHorizontalIcon, roles: ['admin'] },
  { name: 'Terminals', tKey: 'nav.terminals', href: '/terminals', icon: DeviceTabletIcon, roles: ['admin'] },
  { name: 'Lohn-Export', tKey: 'nav.exports', href: '/exports', icon: ArrowDownTrayIcon, roles: ['admin', 'buchhaltung'] },
  { name: 'Mandanten', tKey: 'nav.tenants', href: '/tenants', icon: BuildingLibraryIcon, superAdmin: true },
  { name: 'Firmen', tKey: 'nav.companies', href: '/companies', icon: BuildingOffice2Icon, companyManager: true },
  { name: 'Einstellungen', tKey: 'nav.settings', href: '/settings', icon: Cog6ToothIcon, roles: ['admin'] },
];

function NavGroup({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const location = useLocation();
  const t = useT();
  const childActive = (item.children || []).some((c) => location.pathname === c.href.split('?')[0]);
  const [open, setOpen] = useState(childActive);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center w-full px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200',
          childActive ? 'text-primary-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        )}
      >
        <item.icon className="mr-3 h-5 w-5" />
        {t(item.tKey || item.name)}
        <ChevronDownIcon className={clsx('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 pl-3">
          {(item.children || []).map((c) => (
            <NavLink
              key={c.name}
              to={c.href}
              end
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  'block px-3 py-1.5 text-sm rounded-lg transition-colors',
                  isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-600 hover:bg-slate-100'
                )
              }
            >
              {c.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  const t = useT();
  const { lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  // Auto-Update: neue Version erkennen; beim nächsten Seitenwechsel nahtlos neu laden
  // (kein Datenverlust mitten im Formular), zusätzlich Banner mit Sofort-Button.
  const newVersion = useUpdateAvailable();
  const prevPath = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== prevPath.current) {
      prevPath.current = location.pathname;
      if (newVersion) window.location.reload();
    }
  }, [location.pathname, newVersion]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [changelogOpen, setChangelogOpen] = useState(false);

  // Firmen-Wechsler (Super-Admin / firmenübergreifende HR): Ansichten je Firma filtern.
  const [companyOptions, setCompanyOptions] = useState<{ id: number; name: string; tenantId?: number | null }[]>([]);
  const [tenantOptions, setTenantOptions] = useState<{ id: number; name: string }[]>([]);
  const [canSwitchCompany, setCanSwitchCompany] = useState(false);
  const [companyCtx, setCompanyCtx] = useState<string>(() => localStorage.getItem('tf-company-context') || '');
  useEffect(() => {
    api.get('/companies/options')
      .then((r) => {
        const comps = r.data.companies || []; const tens = r.data.tenants || [];
        setCompanyOptions(comps); setTenantOptions(tens); setCanSwitchCompany(!!r.data.canSwitch);
        // Wer nicht wechseln darf, darf keinen aktiven Firmen-/Mandanten-Filter behalten.
        const cur = localStorage.getItem('tf-company-context') || '';
        const stillValid = !cur
          || (cur.startsWith('company:') && comps.some((c: any) => `company:${c.id}` === cur))
          || (cur.startsWith('tenant:') && tens.some((t: any) => `tenant:${t.id}` === cur));
        if ((!r.data.canSwitch || !stillValid) && cur) {
          // veralteter/ungültiger Kontext (nicht (mehr) in den Optionen) → zurücksetzen
          localStorage.removeItem('tf-company-context'); setCompanyCtx('');
        }
      })
      .catch(() => {});
  }, []);
  const onCompanyCtxChange = (val: string) => {
    setCompanyCtx(val);
    if (val) localStorage.setItem('tf-company-context', val);
    else localStorage.removeItem('tf-company-context');
    window.location.reload(); // alle Ansichten mit neuem Firmen-Kontext neu laden
  };

  // Badge „offene Korrekturanträge" am Nav-Punkt „Zeiten verwalten" (nur Zeitverwalter).
  const isTimeManager = !!user && (user.isSuperAdmin || ['admin', 'buchhaltung', 'verwaltung'].includes(user.role));
  const [openCorrections, setOpenCorrections] = useState(0);
  useEffect(() => {
    if (!isTimeManager) return;
    let active = true;
    const fetchCount = () => {
      api.get('/corrections', { params: { status: 'pending' } })
        .then((r) => {
          if (!active) return;
          setOpenCorrections((r.data.corrections || []).length);
        })
        .catch(() => {});
    };
    fetchCount();
    const iv = window.setInterval(fetchCount, 60_000);
    return () => { active = false; window.clearInterval(iv); };
    // location.pathname: nach Navigation (z. B. nach Entscheidung) Zähler aktualisieren.
  }, [isTimeManager, location.pathname]);

  // „Was ist neu" automatisch zeigen, wenn die Version seit dem letzten Besuch neu ist.
  useEffect(() => {
    if (localStorage.getItem('tf-changelog-seen') !== APP_VERSION) {
      setChangelogOpen(true);
    }
  }, []);
  const closeChangelog = () => {
    setChangelogOpen(false);
    localStorage.setItem('tf-changelog-seen', APP_VERSION);
  };
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('tf-theme', next ? 'dark' : 'light');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isTenantAdmin = isTenantAdminFn(user);
  const filteredNavigation = navigation.filter((item) =>
    item.superAdmin
      ? !!user?.isSuperAdmin
      : item.companyManager
        ? (!!user?.isSuperAdmin || isTenantAdmin)
        : (!item.roles || item.roles.includes(user?.role || ''))
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {newVersion && <UpdateBanner version={newVersion} onReload={() => window.location.reload()} />}
      <ChangelogModal open={changelogOpen} onClose={closeChangelog} />

      {/* Orange Kopfleiste (Feed-Familie) — volle Breite */}
      <header className="flex items-center justify-between h-24 px-6 bg-primary-600 dark:bg-gray-900 text-white shadow-md z-50 flex-shrink-0 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={t('header.menu')}>
            {sidebarOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
          </button>
          <Logo size="large" light />
          <div className="hidden sm:flex items-center gap-3 min-w-0">
            <div className="h-9 w-px bg-white/30" />
            <span className="text-sm text-white/80 tracking-wide truncate">{t('header.slogan')}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canSwitchCompany && companyOptions.length > 0 && (
            <select
              value={companyCtx}
              onChange={(e) => onCompanyCtxChange(e.target.value)}
              title={t('nav.switchScope')}
              className="mr-1 px-2 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors text-sm font-medium max-w-[12rem]"
            >
              <option value="" className="text-slate-900">{t('nav.allCompanies')}</option>
              {tenantOptions.length > 1 ? (
                <>
                  {tenantOptions.map((tn) => (
                    <optgroup key={tn.id} label={tn.name} className="text-slate-900">
                      <option value={`tenant:${tn.id}`} className="text-slate-900">▸ {t('nav.wholeTenant', { name: tn.name })}</option>
                      {companyOptions.filter((c) => c.tenantId === tn.id).map((c) => (
                        <option key={c.id} value={`company:${c.id}`} className="text-slate-900">{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                  {companyOptions.some((c) => !c.tenantId) && (
                    <optgroup label={t('nav.noTenant')} className="text-slate-900">
                      {companyOptions.filter((c) => !c.tenantId).map((c) => (
                        <option key={c.id} value={`company:${c.id}`} className="text-slate-900">{c.name}</option>
                      ))}
                    </optgroup>
                  )}
                </>
              ) : (
                companyOptions.map((c) => <option key={c.id} value={`company:${c.id}`} className="text-slate-900">{c.name}</option>)
              )}
            </select>
          )}
          <button
            onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
            aria-label={t('header.language')}
            title={t('header.language')}
            className="px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-sm font-semibold"
          >
            {lang === 'de' ? 'DE' : 'EN'}
          </button>
          <button onClick={toggleTheme} aria-label={t('header.toggleTheme')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            {dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </button>
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white font-medium text-sm">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <span className="hidden sm:block text-sm font-medium max-w-[10rem] truncate">{user?.firstName} {user?.lastName}</span>
              <ChevronDownIcon className="h-4 w-4 hidden sm:block" />
            </Menu.Button>
            <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
              <Menu.Items className="absolute top-full right-0 mt-2 w-52 bg-white rounded-lg shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none border border-gray-200 z-30">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-slate-800 truncate">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-slate-500">{user?.role ? t(`roles.${user.role}`) : ''}</p>
                </div>
                <Menu.Item>
                  {({ active }) => (
                    <button onClick={() => navigate('/profile')} className={clsx('flex items-center w-full px-4 py-2 text-sm text-slate-700 transition-colors', active ? 'bg-slate-100' : '')}>
                      <UserCircleIcon className="mr-3 h-5 w-5" /> {t('header.profile')}
                    </button>
                  )}
                </Menu.Item>
                <div className="border-t border-gray-200 my-1"></div>
                <Menu.Item>
                  {({ active }) => (
                    <button onClick={handleLogout} className={clsx('flex items-center w-full px-4 py-2 text-sm text-red-600 rounded-b-lg transition-colors', active ? 'bg-slate-100' : '')}>
                      <ArrowRightOnRectangleIcon className="mr-3 h-5 w-5" /> {t('header.logout')}
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      </header>

      {/* Sidebar + Inhalt */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 top-24 bg-black bg-opacity-50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={clsx(
          'fixed top-24 bottom-0 left-0 z-40 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:relative lg:top-0 lg:translate-x-0 border-r border-gray-200 flex-shrink-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}>
          <div className="flex flex-col h-full">
            <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
            {filteredNavigation.map((item) =>
              item.children ? (
                <NavGroup key={item.name} item={item} onNavigate={() => setSidebarOpen(false)} />
              ) : (
                <NavLink
                  key={item.name}
                  to={item.href!}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                      isActive
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    )
                  }
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="mr-3 h-5 w-5" />
                  {t(item.tKey || item.name)}
                  {item.href === '/manage-times' && openCorrections > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold">
                      {openCorrections}
                    </span>
                  )}
                </NavLink>
              )
            )}
          </nav>

          <div className="p-4 border-t border-gray-200 flex-shrink-0">
            <AppFooter onOpenChangelog={() => setChangelogOpen(true)} className="pt-1" />
          </div>
        </div>
      </div>

        {/* Inhalt */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <main className="flex-1 p-4 lg:p-6 bg-gray-50 overflow-y-auto">
            <div className="w-full max-w-none">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}