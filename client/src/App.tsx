import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Toaster } from 'react-hot-toast';
import { ConfirmProvider } from './components/common/ConfirmProvider';
import { useAuthStore } from './store/authStore';
import { translate as tr } from './i18n';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AppDocPage from './components/common/AppDocPage';
import ImpressumContent from './components/legal/ImpressumContent';
import DatenschutzContent from './components/legal/DatenschutzContent';
import InfoContent from './components/legal/InfoContent';
import DokumentationContent from './components/legal/DokumentationContent';
import ProtectedRoute from './components/ProtectedRoute';

// Seiten per Code-Splitting laden → kleineres Initial-Bundle, schnellerer Start.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Terminal = lazy(() => import('./pages/Terminal'));
const Terminals = lazy(() => import('./pages/Terminals'));
const MyTimes = lazy(() => import('./pages/MyTimes'));
const ManageTimes = lazy(() => import('./pages/ManageTimes'));
const Presence = lazy(() => import('./pages/Presence'));
const TimeModels = lazy(() => import('./pages/TimeModels'));
const Employees = lazy(() => import('./pages/Employees'));
const Groups = lazy(() => import('./pages/Groups'));
const Companies = lazy(() => import('./pages/Companies'));
const Exports = lazy(() => import('./pages/Exports'));
const Tenants = lazy(() => import('./pages/Tenants'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const SystemUpdate = lazy(() => import('./pages/SystemUpdate'));
const StorageSettings = lazy(() => import('./pages/StorageSettings'));
const Impressum = lazy(() => import('./pages/Impressum'));
const Datenschutz = lazy(() => import('./pages/Datenschutz'));
const Info = lazy(() => import('./pages/Info'));
const Dokumentation = lazy(() => import('./pages/Dokumentation'));

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return (
    <ConfirmProvider>
      <Toaster position="top-right" />
      <Suspense fallback={<div className="p-8 text-sm text-slate-500">{tr('ui.loading')}</div>}>
      <Routes>
        {/* Kiosk-Terminal: eigener Vollbild-Screen ohne Layout/Login (Geräte-Token-Auth). */}
        <Route path="/terminal" element={<Terminal />} />

        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/forgot-password" element={!isAuthenticated ? <ForgotPassword /> : <Navigate to="/dashboard" />} />
        <Route path="/reset-password" element={!isAuthenticated ? <ResetPassword /> : <Navigate to="/dashboard" />} />

        {/* Vor dem Login: eigenständige öffentliche Seiten (Impressum/Datenschutz-Pflicht). */}
        {!isAuthenticated && (
          <>
            <Route path="/impressum" element={<Impressum />} />
            <Route path="/datenschutz" element={<Datenschutz />} />
            <Route path="/info" element={<Info />} />
            <Route path="/dokumentation" element={<Dokumentation />} />
          </>
        )}

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/times" element={<MyTimes />} />
            <Route path="/manage-times" element={<ManageTimes />} />
            <Route path="/presence" element={<Presence />} />
            <Route path="/time-models" element={<TimeModels />} />
            <Route path="/terminals" element={<Terminals />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/system-update" element={<SystemUpdate />} />
            <Route path="/storage" element={<StorageSettings />} />
            {/* Rechts-/Info-Seiten als echte Seiten im App-Layout (statt Popup). */}
            <Route path="/impressum" element={<AppDocPage title="Impressum"><ImpressumContent /></AppDocPage>} />
            <Route path="/datenschutz" element={<AppDocPage title="Datenschutzerklärung"><DatenschutzContent /></AppDocPage>} />
            <Route path="/info" element={<AppDocPage title="Informationen"><InfoContent /></AppDocPage>} />
            <Route path="/dokumentation" element={<AppDocPage title="Dokumentation"><DokumentationContent /></AppDocPage>} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
      </Suspense>
    </ConfirmProvider>
  );
}

export default App;
