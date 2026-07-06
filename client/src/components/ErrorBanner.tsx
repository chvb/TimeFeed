import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useT } from '../i18n';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

/**
 * Einheitliches Fehlerbanner für fehlgeschlagene Ladevorgänge (statt stiller
 * leerer Tabelle). Bietet optional einen "Erneut versuchen"-Button.
 */
export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  const t = useT();
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-4">
      <div className="flex items-center">
        <ExclamationTriangleIcon className="mr-2 h-5 w-5 flex-shrink-0 text-red-500" aria-hidden="true" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-4 inline-flex items-center text-sm font-medium text-red-700 hover:text-red-900"
        >
          <ArrowPathIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('ui.retry')}
        </button>
      )}
    </div>
  );
}
