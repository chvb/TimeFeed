import { User } from './User';
import { Group } from './Group';
import { GroupManager } from './GroupManager';
import { Department } from './Department';
import { EmailSettings } from './EmailSettings';
import { PasswordResetToken } from './PasswordResetToken';
import { SystemSettings } from './SystemSettings';
import { AuditLog } from './AuditLog';
import { StorageSettings } from './StorageSettings';
import { TrashItem } from './TrashItem';
import { Heartbeat } from './Heartbeat';
import { Company } from './Company';
import { Tenant } from './Tenant';
import { Holiday } from './Holiday';
import { TimeModel } from './TimeModel';
import { TimeEntry } from './TimeEntry';
import { WorkDay } from './WorkDay';
import { TerminalDevice } from './TerminalDevice';
import { CorrectionRequest } from './CorrectionRequest';
import { MonthClosure } from './MonthClosure';
import { TimesheetDocument } from './TimesheetDocument';
import { ExportProfile } from './ExportProfile';
import { ApiKey } from './ApiKey';
import { IntegrationSettings } from './IntegrationSettings';
import { PushSubscription } from './PushSubscription';
import { VapidKeys } from './VapidKeys';

// Tenant (Mandant) → Firma.
Tenant.hasMany(Company, { foreignKey: 'tenantId', as: 'companies' });
Company.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

// Mandanten (Unterfirmen): Firma → Abteilung/Gruppe → Mitarbeiter.
Company.hasMany(User, { foreignKey: 'companyId', as: 'users' });
User.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(Group, { foreignKey: 'companyId', as: 'groups' });
Group.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(Department, { foreignKey: 'companyId', as: 'departments' });
Department.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

User.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(User, { foreignKey: 'groupId', as: 'members' });

// Legacy single manager relationship (keep for backward compatibility)
Group.belongsTo(User, { foreignKey: 'managerId', as: 'manager' });
User.hasMany(Group, { foreignKey: 'managerId', as: 'managedGroups' });

// New many-to-many relationship for multiple managers
Group.belongsToMany(User, { through: GroupManager, foreignKey: 'groupId', otherKey: 'userId', as: 'managers' });
User.belongsToMany(Group, { through: GroupManager, foreignKey: 'userId', otherKey: 'groupId', as: 'managingGroups' });

Group.belongsTo(Group, { foreignKey: 'parentGroupId', as: 'parentGroup' });
Group.hasMany(Group, { foreignKey: 'parentGroupId', as: 'subGroups' });

Department.belongsTo(User, { foreignKey: 'managerId', as: 'manager' });
User.hasMany(Department, { foreignKey: 'managerId', as: 'managedDepartments' });

PasswordResetToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(PasswordResetToken, { foreignKey: 'userId', as: 'passwordResetTokens' });

AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });

// Zeiterfassung: Zeitmodelle (Firma → Modelle; Gruppe/Nutzer referenzieren eines).
Company.hasMany(TimeModel, { foreignKey: 'companyId', as: 'timeModels' });
TimeModel.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Group.belongsTo(TimeModel, { foreignKey: 'timeModelId', as: 'timeModel' });
User.belongsTo(TimeModel, { foreignKey: 'timeModelId', as: 'timeModel' });

// Stempelungen (unveränderliches Journal) + berechnete Tagesaggregate.
User.hasMany(TimeEntry, { foreignKey: 'userId', as: 'timeEntries' });
TimeEntry.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TimeEntry.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });
TimeEntry.belongsTo(User, { foreignKey: 'cancelledById', as: 'cancelledBy' });
TimeEntry.belongsTo(TimeEntry, { foreignKey: 'replacesEntryId', as: 'replacesEntry' });

User.hasMany(WorkDay, { foreignKey: 'userId', as: 'workDays' });
WorkDay.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Stempel-Terminals (Kiosk): Firma → Terminals; Terminal-Stempelungen referenzieren das Gerät.
Company.hasMany(TerminalDevice, { foreignKey: 'companyId', as: 'terminals' });
TerminalDevice.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
TimeEntry.belongsTo(TerminalDevice, { foreignKey: 'terminalId', as: 'terminal' });
TerminalDevice.hasMany(TimeEntry, { foreignKey: 'terminalId', as: 'timeEntries' });

// Verwaltung & Buchhaltung (Phase 4): Korrekturanträge, Monatsabschluss, Stundenzettel.
User.hasMany(CorrectionRequest, { foreignKey: 'userId', as: 'correctionRequests' });
CorrectionRequest.belongsTo(User, { foreignKey: 'userId', as: 'user' });
CorrectionRequest.belongsTo(User, { foreignKey: 'decidedById', as: 'decidedBy' });
Company.hasMany(CorrectionRequest, { foreignKey: 'companyId', as: 'correctionRequests' });

Company.hasMany(MonthClosure, { foreignKey: 'companyId', as: 'monthClosures' });
MonthClosure.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
MonthClosure.belongsTo(User, { foreignKey: 'userId', as: 'user' });
MonthClosure.belongsTo(User, { foreignKey: 'closedById', as: 'closedBy' });

User.hasMany(TimesheetDocument, { foreignKey: 'userId', as: 'timesheetDocuments' });
TimesheetDocument.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TimesheetDocument.belongsTo(User, { foreignKey: 'uploadedById', as: 'uploadedBy' });
Company.hasMany(TimesheetDocument, { foreignKey: 'companyId', as: 'timesheetDocuments' });

// Lohn-Exporte (Phase 5): eine Export-Konfiguration je Firma.
Company.hasOne(ExportProfile, { foreignKey: 'companyId', as: 'exportProfile' });
ExportProfile.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

// API-Schlüssel für die externe Schnittstelle (/api/external), je Mandant.
Tenant.hasMany(ApiKey, { foreignKey: 'tenantId', as: 'apiKeys' });
ApiKey.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
ApiKey.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

// UrlaubsFeed-Kopplung: eine Integrations-Konfiguration je Mandant.
Tenant.hasOne(IntegrationSettings, { foreignKey: 'tenantId', as: 'integrationSettings' });
IntegrationSettings.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

// Web-Push-Abos je Nutzer.
User.hasMany(PushSubscription, { foreignKey: 'userId', as: 'pushSubscriptions' });
PushSubscription.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export { User, Group, GroupManager, Department, EmailSettings, PasswordResetToken, SystemSettings, AuditLog, StorageSettings, TrashItem, Heartbeat, Company, Tenant, Holiday, TimeModel, TimeEntry, WorkDay, TerminalDevice, CorrectionRequest, MonthClosure, TimesheetDocument, ExportProfile, ApiKey, IntegrationSettings, PushSubscription, VapidKeys };
