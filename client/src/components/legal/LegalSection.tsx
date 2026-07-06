import { ReactNode } from 'react';

/** Karten-Abschnitt für Rechts-/Info-Seiten (einheitlich mit der Dokumentation). */
export default function LegalSection({ icon: Icon, title, children }: { icon: any; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="rounded-lg bg-primary-100 dark:bg-primary-900/40 p-2">
          <Icon className="h-5 w-5 text-primary-600 dark:text-primary-300" />
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white m-0">{title}</h3>
      </div>
      <div className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed space-y-2 [&_a]:text-primary-600 hover:[&_a]:text-primary-700 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_strong]:text-slate-900 dark:[&_strong]:text-white">
        {children}
      </div>
    </section>
  );
}
