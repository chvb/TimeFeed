import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useT } from '../../i18n';

interface Props {
  version: string;
  onReload: () => void;
}

/**
 * Hinweisleiste, wenn eine neue Version verfügbar ist. Ein Klick lädt die App neu
 * (index.html wird nicht gecacht → neue Bundles werden geladen, kein Hard-Reload nötig).
 */
export default function UpdateBanner({ version, onReload }: Props) {
  const t = useT();
  return (
    <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-[60] bg-primary-600 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-center gap-3 text-sm">
        <ArrowPathIcon className="h-5 w-5 shrink-0" />
        <span className="font-medium">{t('ui.updateNewVersion', { version })}</span>
        <button
          onClick={onReload}
          className="ml-1 inline-flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/30 px-3 py-1 font-semibold transition-colors"
        >
          {t('ui.updateNow')}
        </button>
      </div>
    </div>
  );
}
