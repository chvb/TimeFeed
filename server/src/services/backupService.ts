import { sequelize } from '../db/database';
import {
  User, Department, Group, GroupManager, Holiday,
  SystemSettings, EmailSettings, Company, Tenant,
  TrashItem, AuditLog, StorageSettings,
} from '../models';
import { UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import storageService from './storageService';

// Inkl. password-HASH (kein Klartext) – sonst können sich nach einem Restore
// keine Nutzer mehr anmelden. bulkCreate läuft ohne individualHooks, daher wird
// der bereits gehashte Wert nicht erneut gehasht.
const ALLOWED_USER_FIELDS = [
  'id', 'email', 'password', 'firstName', 'lastName', 'role', 'companyId', 'tenantId', 'isSuperAdmin', 'groupId',
  'workingDaysOverride', 'hoursPerDayOverride', 'employmentFactor', 'exitDate', 'birthDate',
  'isActive', 'phoneNumber', 'department', 'position',
  'startDate', 'entryDate', 'employeeNumber', 'createdAt', 'updatedAt',
];

/**
 * Erstellt das vollständige Backup-Objekt.
 * - User-Passwort-HASH enthalten (für funktionierenden Restore-Login)
 * - SMTP-Klartext-Passwort und S3-Zugangsdaten NICHT enthalten (Sicherheit)
 */
export async function createBackupObject() {
  const [
    users, departments, groups, groupManagers, holidays,
    systemSettings, emailSettings, companies, tenants,
    trashItems, auditLogs, storageSettings,
  ] = await Promise.all([
    User.findAll(),
    Department.findAll(),
    Group.findAll(),
    GroupManager.findAll(),
    Holiday.findAll(),
    SystemSettings.findAll(),
    EmailSettings.findAll({ attributes: { exclude: ['smtpPassword'] } }),
    Company.findAll(),
    Tenant.findAll(),
    TrashItem.findAll(),
    AuditLog.findAll(),
    StorageSettings.findAll({ attributes: { exclude: ['s3SecretKey'] } }), // S3-Secret nicht im Backup
  ]);

  return {
    version: '2.0',
    timestamp: new Date().toISOString(),
    data: {
      tenants, users, departments, groups, groupManagers, holidays,
      systemSettings, emailSettings, companies,
      trashItems, auditLogs, storageSettings,
    },
  };
}

/**
 * Erstellt ein Voll-Backup und lädt es auf den primären S3 hoch; wenn der
 * sekundäre S3 aktiviert ist (secondaryEnabled), wird das Backup zusätzlich —
 * hier bewusst SYNCHRON statt fire-and-forget — auf den Sekundär gespiegelt.
 * Schlägt (nur) die Sekundär-Spiegelung fehl, bleibt das Backup gültig und der
 * Key wird für den secondarySyncService vorgemerkt.
 */
export async function createAndUploadBackupToS3(): Promise<{ key: string; storedOn: 'primary' | 'secondary'; secondaryUploaded: boolean }> {
  const backup = await createBackupObject();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `timefeed-backup-${stamp}.json`;
  return storageService.uploadBackup(filename, JSON.stringify(backup, null, 2), 'application/json', { awaitSecondary: true });
}

/** Stellt aus einem Backup-Objekt wieder her (transaktional, mit Feld-Whitelist für User). */
export async function restoreBackup(backupData: any): Promise<void> {
  if (!backupData || !backupData.data || !backupData.version) {
    throw new AppError(400, 'Invalid backup file format');
  }
  const { data } = backupData;
  // Strukturvalidierung: jede vorhandene Sektion muss ein Array sein.
  for (const key of Object.keys(data)) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new AppError(400, `Invalid backup data: '${key}' is not an array`);
    }
  }

  const transaction = await sequelize.transaction();
  try {
    // Löschen: Kinder vor Eltern.
    await GroupManager.destroy({ where: {}, transaction });
    await TrashItem.destroy({ where: {}, transaction });   // deletedById → users
    await AuditLog.destroy({ where: {}, transaction });     // userId → users
    await StorageSettings.destroy({ where: {}, transaction });
    await User.destroy({ where: {}, transaction });
    await Group.destroy({ where: {}, transaction });
    await Department.destroy({ where: {}, transaction });
    await Holiday.destroy({ where: {}, transaction });
    await SystemSettings.destroy({ where: {}, transaction });
    await EmailSettings.destroy({ where: {}, transaction });
    await Company.destroy({ where: {}, transaction });
    await Tenant.destroy({ where: {}, transaction });

    // Anlegen: Eltern vor Kindern (Mandanten → Firmen → Gruppen/Abteilungen/Nutzer).
    if (data.tenants) await Tenant.bulkCreate(data.tenants, { transaction });
    if (data.companies) await Company.bulkCreate(data.companies, { transaction });
    if (data.departments) await Department.bulkCreate(data.departments, { transaction });
    if (data.groups) await Group.bulkCreate(data.groups, { transaction });
    if (data.users) {
      const validRoles = Object.values(UserRole) as string[];
      const cleanUsers = (data.users as any[]).map((u) => {
        const o: any = {};
        for (const f of ALLOWED_USER_FIELDS) if (u[f] !== undefined) o[f] = u[f];
        if (!validRoles.includes(o.role)) o.role = UserRole.MITARBEITER;
        return o;
      });
      await User.bulkCreate(cleanUsers, { transaction });
    }
    if (data.groupManagers) await GroupManager.bulkCreate(data.groupManagers, { transaction });
    if (data.holidays) await Holiday.bulkCreate(data.holidays, { transaction });
    if (data.systemSettings) await SystemSettings.bulkCreate(data.systemSettings, { transaction });
    if (data.emailSettings) await EmailSettings.bulkCreate(data.emailSettings, { transaction });
    // Nach den Nutzern (FK userId/deletedById):
    if (data.trashItems) await TrashItem.bulkCreate(data.trashItems, { transaction });
    if (data.auditLogs) await AuditLog.bulkCreate(data.auditLogs, { transaction });
    if (data.storageSettings) await StorageSettings.bulkCreate(data.storageSettings, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
