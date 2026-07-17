import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenIcon, InformationCircleIcon, ShieldCheckIcon, IdentificationIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { APP_VERSION } from '../../constants/version';
import { copyrightYears } from '../../lib/dateUtils';
import OnlineStatusBadge from './OnlineStatusBadge';
import type { LegalKey } from '../legal/LegalModal';
import { useT } from '../../i18n';

interface AppFooterProps {
  className?: string;
  /** Wenn gesetzt: Links öffnen In-App-Modal statt zu navigieren. */
  onOpenLegal?: (key: LegalKey) => void;
  /** Wenn gesetzt: Version ist klickbar und öffnet den Changelog („Was ist neu"). */
  onOpenChangelog?: () => void;
  /** Eingeloggter App-Bereich (Sidebar): zeigt auch die appOnly-Links (Doku/Info). */
  appContext?: boolean;
  /** Wird beim Klick auf einen navigierenden Link aufgerufen (z. B. mobiles Menü schließen). */
  onNavigate?: () => void;
  /** Helle Variante für dunkle/orangefarbene Hintergründe (z. B. Sidebar). */
  tone?: 'default' | 'onPrimary';
}

// appOnly: nur im eingeloggten Bereich zeigen (nicht öffentlich/Login) — Dokumentation
// und Informationen sollen nicht ohne Login erreichbar sein (Muster UrlaubsFeed/FotoFeed).
const LINKS: { key: LegalKey; href: string; labelKey: string; icon: any; appOnly?: boolean }[] = [
  { key: 'dokumentation', href: '/dokumentation', labelKey: 'ui.footerDocs', icon: BookOpenIcon, appOnly: true },
  { key: 'info', href: '/info', labelKey: 'ui.footerInfo', icon: InformationCircleIcon, appOnly: true },
  { key: 'kontakt', href: '/kontakt', labelKey: 'ui.footerContact', icon: EnvelopeIcon },
  { key: 'datenschutz', href: '/datenschutz', labelKey: 'ui.footerPrivacy', icon: ShieldCheckIcon },
  { key: 'impressum', href: '/impressum', labelKey: 'ui.footerImprint', icon: IdentificationIcon },
];

/**
 * Gemeinsamer Footer (Feed-Familie): Rechts-/Info-Links, Copyright, Version,
 * Online-Status. In der App (onOpenLegal) öffnen die Links Modals; auf
 * öffentlichen Seiten (ohne Prop) navigieren sie zu den Routen.
 */
export default function AppFooter({ className = '', onOpenLegal, onOpenChangelog, appContext = false, onNavigate, tone = 'default' }: AppFooterProps) {
  const t = useT();
  const onP = tone === 'onPrimary';
  const textCls = onP ? 'text-white/70' : 'text-slate-400';
  const linkCls = onP ? 'text-white/80 hover:text-white transition-colors' : 'hover:text-primary-500 transition-colors';
  const sepCls = onP ? 'text-white/40' : 'text-slate-300';

  return (
    <footer className={`text-center ${className}`}>
      <div className={`flex items-center justify-center flex-wrap gap-x-2 gap-y-1 text-[11px] ${textCls}`}>
        {LINKS.filter((l) => onOpenLegal || appContext || !l.appOnly).map((l, i) => (
          <Fragment key={l.key}>
            {i > 0 && <span className={sepCls}>·</span>}
            {onOpenLegal ? (
              <button type="button" onClick={() => onOpenLegal(l.key)} className={`inline-flex items-center gap-1 ${linkCls}`}>
                <l.icon className="h-3.5 w-3.5" /> {t(l.labelKey)}
              </button>
            ) : (
              <Link to={l.href} onClick={onNavigate} className={`inline-flex items-center gap-1 ${linkCls}`}>
                <l.icon className="h-3.5 w-3.5" /> {t(l.labelKey)}
              </Link>
            )}
          </Fragment>
        ))}
      </div>
      <div className={`flex items-center justify-center flex-wrap gap-x-2 gap-y-1 mt-2 text-[11px] ${textCls}`}>
        <span>© {copyrightYears()} TimeFeed</span>
        <span className={sepCls}>·</span>
        <span className="inline-flex items-center gap-1.5">
          {onOpenChangelog ? (
            <button type="button" onClick={onOpenChangelog} className={linkCls} title={t('ui.whatsNew')}>v{APP_VERSION}</button>
          ) : (
            <span>v{APP_VERSION}</span>
          )}
          <OnlineStatusBadge />
        </span>
      </div>
      {/* Dachmarke der Feed-Familie */}
      <p className={`mt-1 text-[10px] ${onP ? 'text-white/40' : 'text-slate-300'}`}>
        <a href="https://feedapps.de" target="_blank" rel="noopener noreferrer" className={linkCls}>{t('ui.footerFamily')}</a>
      </p>
    </footer>
  );
}
