import React from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo';
import AppFooter from './AppFooter';
import { useT } from '../../i18n';

interface PublicPageProps {
  title: string;
  children: React.ReactNode;
}

/** Einfache, öffentlich erreichbare Seitenhülle (Rechts-/Info-Seiten). */
export default function PublicPage({ title, children }: PublicPageProps) {
  const t = useT();
  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" aria-label={t('ui.backToApp')}><Logo size="default" /></Link>
          <Link to="/" className="text-sm text-primary-600 hover:text-primary-700">{t('ui.backToApp')}</Link>
        </div>
        <div className="card">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">{title}</h1>
          <div className="text-sm text-slate-700 leading-relaxed space-y-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-primary-600 hover:[&_a]:text-primary-700">
            {children}
          </div>
        </div>
        <AppFooter className="mt-8" />
      </div>
    </div>
  );
}
