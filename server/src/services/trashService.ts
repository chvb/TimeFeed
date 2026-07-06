import { Op } from 'sequelize';
import { sequelize } from '../db/database';
import { TrashItem } from '../models/TrashItem';
import { User } from '../models/User';
import { Group } from '../models/Group';
import { Holiday } from '../models/Holiday';
import { GroupManager } from '../models/GroupManager';
import { AppError } from '../middleware/errorHandler';

export const TRASH_RETENTION_DAYS = 30;

// Für die Wiederherstellung: entityType → Model.
const MODEL_MAP: Record<string, any> = {
  User,
  Group,
  Holiday,
  GroupManager,
};

// Anzeigenamen der Typen (für die UI).
export const TRASH_TYPE_LABELS: Record<string, string> = {
  User: 'Mitarbeiter',
  Group: 'Gruppe',
  Holiday: 'Feiertag',
};

/**
 * Legt einen Snapshot eines zu löschenden Datensatzes im Papierkorb ab.
 * Der Aufrufer löscht danach den Originaldatensatz (ggf. in derselben Transaktion).
 */
export async function moveToTrash(
  entityType: string,
  instance: any,
  label: string,
  actorId?: number,
  options: { transaction?: any; related?: Array<{ entityType: string; records: any[] }> } = {}
): Promise<void> {
  const data = instance.get ? instance.get({ plain: true }) : { ...instance };
  // Verknüpfte Datensätze mit sichern, damit sie bei der Wiederherstellung zurückkommen.
  if (options.related && options.related.some((r) => r.records.length)) {
    data._related = options.related.filter((r) => r.records.length);
  }
  // Firma für den Mandanten-/Firmen-Scope: direkt aus dem Datensatz, sonst über den Nutzer.
  let companyId: number | null = data.companyId ?? null;
  if (companyId == null && data.userId) {
    const owner = await User.findByPk(data.userId, { attributes: ['companyId'], transaction: options.transaction });
    companyId = owner?.companyId ?? null;
  }
  await TrashItem.create(
    { entityType, entityId: data.id, label: label || `${entityType} #${data.id}`, data, companyId, deletedById: actorId ?? null },
    { transaction: options.transaction }
  );
}

// Darf ein Akteur (managed = seine Firmen-IDs, null = alle) auf diesen Eintrag zugreifen?
// Globale Einträge (companyId null) sind nur für Uneingeschränkte (Super-/globaler Admin).
function trashInScope(item: any, managed: number[] | null): boolean {
  if (managed === null) return true;
  return item.companyId != null && managed.includes(item.companyId);
}

/** Stellt einen Eintrag aus dem Papierkorb wieder her. */
export async function restoreTrashItem(id: number, managed: number[] | null = null): Promise<{ entityType: string; label: string }> {
  const item = await TrashItem.findByPk(id);
  if (!item || !trashInScope(item, managed)) throw new AppError(404, 'Eintrag nicht im Papierkorb gefunden');
  const Model = MODEL_MAP[item.entityType];
  if (!Model) throw new AppError(400, 'Unbekannter Eintragstyp');

  const existing = await Model.findByPk(item.entityId);
  if (existing) {
    await item.destroy();
    throw new AppError(409, 'Ein Eintrag mit dieser ID existiert bereits – Wiederherstellung nicht nötig.');
  }

  const { _related, ...mainData } = item.data || {};
  // Transaktional: Hauptdatensatz + verknüpfte Datensätze + Tombstone-Löschung
  // entweder ganz oder gar nicht (kein Teil-Restore bei Fehler).
  await sequelize.transaction(async (transaction) => {
    // hooks:false → bereits gehashte Passwörter o. ä. nicht erneut transformieren.
    await Model.create(mainData, { hooks: false, transaction });
    if (Array.isArray(_related)) {
      for (const group of _related) {
        const RelModel = MODEL_MAP[group.entityType];
        if (RelModel && Array.isArray(group.records) && group.records.length) {
          await RelModel.bulkCreate(group.records, { hooks: false, ignoreDuplicates: true, transaction });
        }
      }
    }
    await item.destroy({ transaction });
  });
  return { entityType: item.entityType, label: item.label };
}

/** Endgültig löschen (aus dem Papierkorb entfernen). */
export async function purgeTrashItem(id: number, managed: number[] | null = null): Promise<void> {
  const item = await TrashItem.findByPk(id);
  if (!item || !trashInScope(item, managed)) throw new AppError(404, 'Eintrag nicht gefunden');
  await item.destroy();
}

/** Papierkorb leeren (nur Einträge der eigenen Firma(en); Super-Admin alles). */
export async function emptyTrash(managed: number[] | null = null): Promise<number> {
  return TrashItem.destroy({ where: managed === null ? {} : { companyId: managed } });
}

/** Liste mit Restdauer in Tagen (auf Firmen/Mandant gescopet; null = alle). */
export async function listTrash(managed: number[] | null = null): Promise<any[]> {
  const where: any = {};
  if (managed !== null) where.companyId = managed; // nur eigene Firmen; global (null) nur für Super-Admin
  const items = await TrashItem.findAll({ where, order: [['createdAt', 'DESC']] });
  const now = Date.now();
  return (items as any[]).map((it) => {
    const deletedAt = new Date(it.createdAt).getTime();
    const expiresAt = deletedAt + TRASH_RETENTION_DAYS * 86400000;
    return {
      id: it.id,
      entityType: it.entityType,
      typeLabel: TRASH_TYPE_LABELS[it.entityType] || it.entityType,
      label: it.label,
      deletedAt: it.createdAt,
      deletedById: it.deletedById,
      daysRemaining: Math.max(0, Math.ceil((expiresAt - now) / 86400000)),
    };
  });
}

/** Entfernt abgelaufene Einträge (älter als 30 Tage) endgültig. */
export async function purgeExpiredTrash(): Promise<number> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400000);
  return TrashItem.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
}
