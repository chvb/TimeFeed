import { APP_VERSION } from '../../constants/version';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { SignalIcon, Squares2X2Icon, ArrowPathIcon } from '@heroicons/react/24/outline';
import LegalSection from './LegalSection';

export default function InfoContent() {
  const { online, serverVersion, ping, uptime30d, processUptimeSeconds } = useOnlineStatus();

  const fmtUptime = (s: number | null) => {
    if (s == null) return '–';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return [d ? `${d}T` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
  };

  return (
    <div className="not-prose space-y-5">
      <p className="text-sm text-slate-600 dark:text-gray-400">
        <strong className="text-slate-900 dark:text-white">TimeFeed</strong> ist die Zeiterfassung
        der Feed-Familie – schnell, einfach, übersichtlich.
      </p>

      <LegalSection icon={SignalIcon} title="System-Status">
        <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900/40 p-4 space-y-1">
          <div className="flex items-center justify-between py-1">
            <span>Verbindung</span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span>App-Version (Frontend)</span>
            <span className="font-medium">v{APP_VERSION}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span>Server-Version</span>
            <span className="font-medium">{serverVersion ? `v${serverVersion}` : '–'}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span>Ping</span>
            <span className="font-medium">{ping != null ? `${ping} ms` : '–'}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span>Uptime (letzte 30 Tage)</span>
            <span className="font-medium">{uptime30d != null ? `${uptime30d} %` : '–'}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span>Server-Laufzeit</span>
            <span className="font-medium">{fmtUptime(processUptimeSeconds)}</span>
          </div>
        </div>
      </LegalSection>

      <LegalSection icon={Squares2X2Icon} title="Funktionen">
        <ul>
          <li>Kommen/Gehen-Stempeln direkt vom Dashboard (verfügbar mit dem nächsten Update)</li>
          <li>Zeitmodelle je Gruppe und Auswertungen erfasster Zeiten (in Vorbereitung)</li>
          <li>Benutzer-, Gruppen- und Abteilungsverwaltung</li>
          <li>Mandanten- und Firmenverwaltung mit Kontext-Umschalter</li>
          <li>Papierkorb (30 Tage), Backups (lokal & S3)</li>
          <li>Audit-Log und rollenbasierte Berechtigungen</li>
        </ul>
      </LegalSection>

      <LegalSection icon={ArrowPathIcon} title="Updates">
        <p>
          Neue Versionen werden über das Update-System eingespielt; die aktuelle Version sehen Sie oben und im
          Footer. Änderungen werden im Changelog dokumentiert.
        </p>
      </LegalSection>
    </div>
  );
}
