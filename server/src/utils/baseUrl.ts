import { SystemSettings } from '../models/SystemSettings';

// Öffentliche Basis-URL für extern sichtbare Links (QR-Codes, E-Mail-Aktionen, iCal).
// publicUrl ist INSTANZWEIT (einmalig definiert, gilt für alle Firmen/Mandanten) → es wird
// ausschließlich die GLOBALE Vorlage gelesen. Priorität: globale publicUrl → ENV → localhost.
// companyId bleibt aus Kompatibilität in der Signatur, wird aber bewusst ignoriert.
export async function getPublicBaseUrl(_companyId: number | null = null): Promise<string> {
  let configured: string | undefined;
  try {
    const g = (await SystemSettings.findOne({ where: { companyId: null } })) || (await SystemSettings.findOne());
    configured = g?.publicUrl || undefined;
  } catch {
    /* ignore – Fallback unten */
  }
  const base = configured || process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3030';
  return base.replace(/\/+$/, ''); // ggf. abschließende Slashes entfernen
}
