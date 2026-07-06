import { Op, literal } from 'sequelize';
import { User, UserRole } from '../models/User';
import { Group } from '../models/Group';
import { GroupManager } from '../models/GroupManager';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';

type Actor = { id: number; role: UserRole; companyId?: number | null; tenantId?: number | null; isSuperAdmin?: boolean };

const isAdminOrBuchhaltung = (a: Actor) => a.role === UserRole.ADMIN || a.role === UserRole.BUCHHALTUNG;

// Firmen-Bedingungen aus der Identität des Akteurs (companyId und/oder tenantId).
// tenantId → alle Firmen dieses Tenants (Subquery, hält die Helfer synchron).
function companyConds(actor: Actor): any[] {
  const conds: any[] = [];
  if (actor.companyId) conds.push({ companyId: actor.companyId });
  if (actor.tenantId) conds.push({ companyId: { [Op.in]: literal(`(SELECT id FROM companies WHERE tenant_id = ${Number(actor.tenantId)})`) } });
  return conds;
}

// Uneingeschränkt = sieht alles (Super-Admin oder Admin/Buchhaltung ohne Firma/Tenant).
function isUnrestricted(actor: Actor): boolean {
  if (actor.companyId || actor.tenantId) return false;
  if (actor.isSuperAdmin) return true;
  return isAdminOrBuchhaltung(actor);
}

/**
 * Effektiver Akteur für Listen-/Auswertungs-Ansichten mit Firmen-/Mandanten-Wechsler.
 * - Super-Admin: kann auf eine Firma (companyId) ODER einen Mandanten (tenantId) scopen, sonst alles.
 * - Mandanten-Admin (tenantId, ohne companyId): Auswahl nur INNERHALB des eigenen Tenants
 *   (Firmenwahl wird zusätzlich mit dem Tenant verknüpft → kein Ausbruch möglich).
 * - Firmen-gebundene Nutzer: Auswahl wird ignoriert (immer eigene Firma).
 */
export function getEffectiveActor(actor: Actor, requestedCompanyId?: any, requestedTenantId?: any): Actor {
  const cq = requestedCompanyId != null && requestedCompanyId !== '' ? Number(requestedCompanyId) : NaN;
  const tq = requestedTenantId != null && requestedTenantId !== '' ? Number(requestedTenantId) : NaN;

  if (!Number.isNaN(cq) && cq) {
    // Firmenauswahl: Super-Admin & tenant-/firmenlose Admin/Buchhaltung frei; Tenant-Admin nur innerhalb
    // seines Tenants (tenantId bleibt als zusätzliche Bedingung erhalten → AND-Absicherung).
    if (actor.isSuperAdmin) return { ...actor, companyId: cq, tenantId: null, isSuperAdmin: false };
    if (actor.tenantId) return { ...actor, companyId: cq }; // tenantId bleibt → Firma muss im Tenant liegen
    if (!actor.companyId && isAdminOrBuchhaltung(actor)) return { ...actor, companyId: cq };
    return actor;
  }
  if (!Number.isNaN(tq) && tq) {
    // Mandantenauswahl: Super-Admin frei; Tenant-Admin nur eigener Tenant.
    if (actor.isSuperAdmin) return { ...actor, tenantId: tq, companyId: null, isSuperAdmin: false };
    if (actor.tenantId && actor.tenantId === tq) return { ...actor, tenantId: tq, companyId: null };
    return actor;
  }
  return actor;
}

/** Firmen-Filter für nicht-nutzerbezogene Ressourcen (Feiertage, Sperrzeiten, …). */
export function getCompanyScopeWhere(actor: Actor): Record<string, any> {
  if (isUnrestricted(actor)) return {};
  const conds = companyConds(actor);
  if (conds.length === 0) return {};
  return conds.length === 1 ? conds[0] : { [Op.and]: conds };
}

/** Wie getCompanyScopeWhere, aber GLOBALE Einträge (companyId = null) sind für alle sichtbar. */
export function getCompanyOrGlobalWhere(actor: Actor): Record<string, any> {
  if (isUnrestricted(actor)) return {};
  const conds = companyConds(actor);
  if (conds.length === 0) return {};
  const scope = conds.length === 1 ? conds[0] : { [Op.and]: conds };
  return { [Op.or]: [{ companyId: null }, scope] };
}

/**
 * IDs der Nutzer, die ein Akteur sehen/bearbeiten darf.
 * - Uneingeschränkt (Super-Admin / globaler Admin/Buchhaltung): null
 * - Admin/Buchhaltung mit Firma ODER Mandanten-Admin (Tenant): alle Nutzer der Firma(en)
 * - VERWALTUNG: Mitglieder seiner Gruppen (innerhalb der Firma) + er selbst
 * - MITARBEITER: nur er selbst
 */
export async function getAccessibleUserIds(actor: Actor): Promise<number[] | null> {
  if (isUnrestricted(actor)) return null;

  if (isAdminOrBuchhaltung(actor) || actor.tenantId) {
    const conds = companyConds(actor);
    if (conds.length === 0) return null;
    const where = conds.length === 1 ? conds[0] : { [Op.and]: conds };
    const members = await User.findAll({ where, attributes: ['id'] });
    return members.map((u: any) => u.id);
  }

  if (actor.role !== UserRole.VERWALTUNG) return [actor.id];

  const managedGroups = await Group.findAll({ where: { managerId: actor.id }, attributes: ['id'] });
  const gmRows = await GroupManager.findAll({ where: { userId: actor.id }, attributes: ['groupId'] });
  const groupIds = new Set<number>([
    ...managedGroups.map((g: any) => g.id),
    ...gmRows.map((r: any) => r.groupId),
  ]);

  let memberIds: number[] = [];
  if (groupIds.size > 0) {
    const memberWhere: any = { groupId: { [Op.in]: [...groupIds] } };
    if (actor.companyId) memberWhere.companyId = actor.companyId; // Manager nie firmenübergreifend
    const members = await User.findAll({ where: memberWhere, attributes: ['id'] });
    memberIds = members.map((u: any) => u.id);
  }
  return Array.from(new Set<number>([actor.id, ...memberIds]));
}

/**
 * Firmen, die der Akteur VERWALTEN darf. null = alle (Super-Admin oder globaler Admin/Buchhaltung).
 * Firmen-Admin/Buchhaltung → eigene Firma; Mandanten-Admin → alle Firmen seines Tenants; sonst [].
 */
export async function getManagedCompanyIds(actor: Actor): Promise<number[] | null> {
  if (actor.isSuperAdmin) return null;
  if (isAdminOrBuchhaltung(actor) && !actor.companyId && !actor.tenantId) return null; // globaler Admin/Buchhaltung
  if (actor.companyId) return [actor.companyId];
  if (actor.tenantId) {
    const cs = await Company.findAll({ where: { tenantId: actor.tenantId }, attributes: ['id'] });
    return cs.map((c: any) => c.id);
  }
  return [];
}

// Leeres managed-Set: Mandanten-Admin OHNE Firmen → kein Zugriff (deny);
// Manager/Employee (nicht firmen-gescopt) → an Rollen-/Ownership-Prüfung delegieren (erlaubt).
// (Firmen-gebundene Admin/Buchhaltung haben immer [companyId], globale/Super immer null.)
const emptyScopeAllows = (actor: Actor) => !isAdminOrBuchhaltung(actor);

/** Lesen eines firmenbezogenen Datensatzes (companyId null = global → für alle sichtbar). */
export async function canReadCompanyRecord(actor: Actor, companyId?: number | null): Promise<boolean> {
  if (companyId == null) return true;
  const ids = await getManagedCompanyIds(actor);
  if (ids === null) return true;
  if (ids.length === 0) return emptyScopeAllows(actor);
  return ids.includes(companyId);
}

/** Verwalten (Schreiben) eines firmenbezogenen Datensatzes. Globale (null) nur für Uneingeschränkte. */
export async function canManageCompanyRecord(actor: Actor, companyId?: number | null): Promise<boolean> {
  const ids = await getManagedCompanyIds(actor);
  if (ids === null) return true;
  if (ids.length === 0) return emptyScopeAllows(actor);
  if (companyId == null) return false; // globale Datensätze nur Super-/globaler Admin
  return ids.includes(companyId);
}

/**
 * companyId für einen NEU anzulegenden firmenbezogenen Datensatz:
 * - Super-Admin: frei aus dem Body; ohne Angabe eigene Firma (falls vorhanden), sonst global
 * - Firmen-Admin/Buchhaltung: immer eigene Firma
 * - Mandanten-Admin: Firma aus dem Body, MUSS im eigenen Tenant liegen (sonst Fehler)
 */
export async function resolveWritableCompanyId(actor: Actor, bodyCompanyId?: any): Promise<number | null> {
  const cid = bodyCompanyId != null && bodyCompanyId !== '' ? Number(bodyCompanyId) : null;
  // Ohne expliziten Kontext auf die eigene Firma schreiben — sonst entstehen bei
  // Super-Admins MIT companyId (Demo-Seed) companyId=null-Datensätze, die für
  // firmen-gescopte Leser unsichtbar sind (E2E-Befund: „unsichtbare" Zeitmodelle).
  if (actor.isSuperAdmin) return cid ?? actor.companyId ?? null;
  if (actor.companyId) return actor.companyId;
  if (actor.tenantId) {
    if (cid != null && !(await canManageCompanyRecord(actor, cid))) {
      throw new AppError(403, 'Firma liegt außerhalb Ihres Mandanten');
    }
    return cid;
  }
  return null;
}

/** Darf der Akteur auf Daten des Ziel-Nutzers zugreifen? */
export async function canActorAccessUser(actor: Actor, targetUserId: number): Promise<boolean> {
  const ids = await getAccessibleUserIds(actor);
  return ids === null || ids.includes(targetUserId);
}
