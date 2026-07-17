import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Logo from '../components/common/Logo';

// Druckansicht für AVV / AGB eines Mandanten. Lädt das im Backend gerenderte
// HTML (Markdown → HTML inkl. Platzhalter-Ersetzung aus tenant.contractData)
// und stellt es druckfreundlich dar (window.print → PDF).
//
// Sicherheit: Alle mandanten-editierbaren Vertragswerte werden serverseitig
// VOR dem Rendern HTML-escaped (services/legalDocuments.ts); die Vorlage selbst
// ist eine vertrauenswürdige Datei auf dem Server. Das gelieferte HTML ist damit
// unbedenklich für dangerouslySetInnerHTML.
interface LegalData {
  doc: string;
  title: string;
  html: string;
  renderedAt: string;
  tenant?: { id: number; name: string };
}

export default function LegalDocumentPrint() {
  const { doc, tenantId } = useParams<{ doc: string; tenantId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LegalData | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/tenants/${tenantId}/legal/${doc}`)
      .then((res) => { if (active) { setData(res.data); setError(null); } })
      .catch((err) => { if (active) setError(err.response?.data?.message || err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [doc, tenantId]);

  if (loading) return <div className="p-8 text-center text-slate-500">…</div>;
  if (error) return (
    <div className="max-w-3xl mx-auto p-6 text-center">
      <p className="text-red-600">Fehler: {error}</p>
      <button onClick={() => navigate('/tenants')} className="mt-4 px-4 py-2 bg-slate-200 rounded-lg">← Zurück</button>
    </div>
  );
  if (!data) return null;

  return (
    <div className="legal-print-root bg-white">
      <style>{`
        .legal-print-root { min-height: 100vh; padding: 24px; color: #111; }
        .legal-print-root .legal-paper { max-width: 820px; margin: 0 auto; padding: 32px 48px; background: white; box-shadow: 0 0 0 1px #e5e7eb, 0 4px 20px rgba(0,0,0,.06); border-radius: 6px; }
        .legal-print-root .legal-actions { max-width: 820px; margin: 0 auto 16px auto; display: flex; gap: 8px; align-items: center; }
        .legal-print-root .legal-btn { padding: 8px 14px; font-size: 14px; border-radius: 6px; border: 1px solid #d1d5db; background: white; color: #374151; cursor: pointer; }
        .legal-print-root .legal-btn-primary { background: #ea580c; color: white; border-color: #ea580c; }
        .legal-print-root .legal-btn:hover { background: #f3f4f6; }
        .legal-print-root .legal-btn-primary:hover { background: #c2410c; }

        .legal-print-header { display: none; }

        .legal-content h1 { font-size: 22px; font-weight: 700; margin: 0 0 16px 0; color: #111; }
        .legal-content h2 { font-size: 17px; font-weight: 700; margin: 24px 0 8px 0; color: #111; }
        .legal-content h3 { font-size: 14px; font-weight: 600; margin: 16px 0 6px 0; color: #111; }
        .legal-content p { margin: 0 0 10px 0; font-size: 13px; line-height: 1.55; color: #1f2937; }
        .legal-content hr { margin: 20px 0; border: none; border-top: 1px solid #e5e7eb; }
        .legal-content ul, .legal-content ol { font-size: 13px; line-height: 1.55; color: #1f2937; padding-left: 24px; margin: 0 0 10px 0; }
        .legal-content li { margin-bottom: 4px; }
        .legal-content table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0; }
        .legal-content th, .legal-content td { padding: 6px 10px; border: 1px solid #d1d5db; text-align: left; vertical-align: top; }
        .legal-content th { background: #f9fafb; font-weight: 600; }
        .legal-content strong { font-weight: 600; }
        .legal-content code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
        .legal-content blockquote { border-left: 3px solid #fed7aa; padding: 6px 12px; margin: 10px 0; color: #6b7280; font-size: 12px; }
        .legal-content .legal-placeholder { background: #fef3c7; padding: 1px 6px; border-radius: 3px; font-style: italic; color: #92400e; border: 1px dashed #f59e0b; }

        @media print {
          @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
          body { background: white !important; }
          .legal-print-root { padding: 0 !important; }
          .legal-actions { display: none !important; }
          .legal-paper { max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
          .legal-print-header { display: block !important; border-bottom: 2px solid #ea580c; padding-bottom: 8px; margin-bottom: 16px; }
          .legal-print-header .lph-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
          .legal-print-header .lph-meta { font-size: 10px; color: #6b7280; text-align: right; }
          .legal-content { font-size: 11.5px !important; }
          .legal-content h1 { font-size: 18px !important; page-break-after: avoid; }
          .legal-content h2 { font-size: 14px !important; page-break-after: avoid; }
          .legal-content h3 { font-size: 12px !important; page-break-after: avoid; }
          .legal-content p { font-size: 11.5px !important; line-height: 1.45 !important; }
          .legal-content table { font-size: 10.5px !important; }
          .legal-placeholder { background: white !important; border: 1px dashed #b45309 !important; }
        }
      `}</style>

      <div className="legal-actions">
        <button className="legal-btn" onClick={() => navigate('/tenants')}>← Zurück</button>
        <button className="legal-btn legal-btn-primary" onClick={() => window.print()}>🖨️ Drucken / Als PDF speichern</button>
        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
          {data.title}{data.tenant?.name ? ` — ${data.tenant.name}` : ''}
        </span>
      </div>

      <div className="legal-paper">
        <div className="legal-print-header">
          <div className="lph-row">
            <Logo size="small" />
            <div className="lph-meta">
              <div><strong>{data.title}</strong></div>
              {data.tenant?.name && <div>{data.tenant.name}</div>}
              <div>Stand: {new Date(data.renderedAt).toLocaleDateString('de-DE')}</div>
            </div>
          </div>
        </div>

        <div className="legal-content" dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>
    </div>
  );
}
