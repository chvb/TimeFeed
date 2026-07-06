import { ReactNode } from 'react';
import { LEGAL_PROSE } from '../legal/contentStyle';

/** Rechts-/Info-Inhalte als echte Seite innerhalb der App (im Layout-Inhaltsbereich). */
export default function AppDocPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{title}</h1>
      <div className={LEGAL_PROSE}>{children}</div>
    </div>
  );
}
