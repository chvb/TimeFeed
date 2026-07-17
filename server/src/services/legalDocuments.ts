import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import { Tenant } from '../models/Tenant';

// Rechtsdokumente (AVV/AGB) als Markdown-Vorlagen mit {{PLATZHALTER}}, gefüllt aus den
// Vertragsdaten des Mandanten und gerendert zu HTML. Dynamische (mandanten-editierbare)
// Werte werden VOR dem Rendern HTML-escaped → kein Stored-XSS.
const LEGAL_DIR = path.join(__dirname, '..', '..', 'legal');

const DOCS: Record<'avv' | 'agb', { file: string; title: string }> = {
  avv: { file: 'AVV-TimeFeed.md', title: 'Auftragsverarbeitungsvertrag' },
  agb: { file: 'AGB-TimeFeed.md', title: 'Allgemeine Geschäftsbedingungen' },
};

/** Die editierbaren Vertragsdaten-Felder (alle Freitext). */
export const CONTRACT_FIELDS = [
  'companyName', 'address', 'postalCode', 'city', 'country', 'legalRepresentative',
  'contactEmail', 'jurisdiction', 'smtpProvider', 'smtpProviderLocation', 'smtpDataTransferBasis',
] as const;

export type ContractData = Partial<Record<(typeof CONTRACT_FIELDS)[number], string>>;

export function isLegalDoc(doc: string): doc is 'avv' | 'agb' {
  return doc === 'avv' || doc === 'agb';
}

/** Eingehende Vertragsdaten auf die bekannten String-Felder begrenzen und kappen. */
export function sanitizeContractData(input: any): ContractData {
  const out: ContractData = {};
  if (input && typeof input === 'object') {
    for (const key of CONTRACT_FIELDS) {
      const v = input[key];
      if (v != null) out[key] = String(v).slice(0, 500);
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export async function renderLegalDoc(
  doc: 'avv' | 'agb',
  tenant: Tenant | null,
): Promise<{ doc: string; title: string; html: string; renderedAt: string }> {
  const meta = DOCS[doc];
  const md = fs.readFileSync(path.join(LEGAL_DIR, meta.file), 'utf8');
  const cd: ContractData = (tenant?.contractData as ContractData) || {};

  const plzOrt =
    [cd.postalCode, cd.city].filter(Boolean).map((x) => escapeHtml(String(x))).join(' ') +
    (cd.country ? ', ' + escapeHtml(String(cd.country)) : '');

  const replacements: Record<string, string> = {
    DATUM: new Date().toLocaleDateString('de-DE'),
    ORT: 'Kranenburg',
    KUNDENNAME: escapeHtml(cd.companyName || tenant?.name || ''),
    KUNDENADRESSE: escapeHtml(cd.address || ''),
    'KUNDEN-PLZ-ORT': plzOrt,
    KUNDEN_VERTRETER: escapeHtml(cd.legalRepresentative || ''),
    UNTERSCHRIFT: escapeHtml(cd.legalRepresentative || ''),
    GERICHTSSTAND: escapeHtml(cd.jurisdiction || 'Kleve'),
    SMTP_PROVIDER: escapeHtml(cd.smtpProvider || ''),
    SMTP_SITZ: escapeHtml(cd.smtpProviderLocation || ''),
    ANGEMESSENHEIT_ODER_SCC: escapeHtml(cd.smtpDataTransferBasis || ''),
  };

  const filled = md.replace(/\{\{\s*([A-Z][A-Z0-9_-]*)(?:\s*,\s*[^}]*)?\s*\}\}/g, (_m, key: string) => {
    const v = replacements[key];
    if (v == null || v === '') return `<span class="legal-placeholder">[${key}]</span>`;
    return v;
  });

  const html = await marked.parse(filled);
  return { doc, title: meta.title, html, renderedAt: new Date().toISOString() };
}
