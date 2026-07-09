import { DataTypes } from 'sequelize';
import { sequelize } from './database';
import { User } from '../models/User';
import { SystemSettings } from '../models/SystemSettings';
import { StorageSettings } from '../models/StorageSettings';
import { Group } from '../models/Group';
import { Department } from '../models/Department';
import { Company } from '../models/Company';
import { Tenant } from '../models/Tenant';
import { Holiday } from '../models/Holiday';
import { TrashItem } from '../models/TrashItem';

/**
 * Fügt neue Spalten zu bestehenden Tabellen hinzu (SQLite ALTER TABLE ADD COLUMN).
 * sequelize.sync({force:false}) legt nur fehlende TABELLEN an, ergänzt aber keine
 * Spalten in bestehenden Tabellen – das übernimmt dieser idempotente Helfer.
 */
export async function ensureColumns(): Promise<void> {
  const qi = sequelize.getQueryInterface();

  const addIfMissing = async (model: any, column: string, spec: any) => {
    const table = model.getTableName();
    const desc = await qi.describeTable(table);
    if (!desc[column]) {
      await qi.addColumn(table, column, spec);
      const name = typeof table === 'string' ? table : table.tableName;
      console.log(`Migration: Spalte ${name}.${column} ergänzt.`);
    }
  };

  // underscored: Spaltennamen snake_case
  await addIfMissing(User, 'working_days_override', { type: DataTypes.JSON, allowNull: true });
  await addIfMissing(User, 'hours_per_day_override', { type: DataTypes.FLOAT, allowNull: true });
  await addIfMissing(User, 'birth_date', { type: DataTypes.DATEONLY, allowNull: true });
  await addIfMissing(User, 'employment_factor', { type: DataTypes.FLOAT, allowNull: true, defaultValue: 1 });
  await addIfMissing(User, 'exit_date', { type: DataTypes.DATE, allowNull: true });
  await addIfMissing(User, 'token_version', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await addIfMissing(User, 'hub_person_id', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(SystemSettings, 'nfc_pin_required', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(SystemSettings, 'public_url', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(StorageSettings, 's3_attachment_prefix', { type: DataTypes.STRING, allowNull: true, defaultValue: 'timefeed/attachments/' });

  // Mandanten (Unterfirmen)
  await addIfMissing(User, 'company_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(User, 'tenant_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(TrashItem, 'company_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(User, 'is_super_admin', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(Group, 'company_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(Department, 'company_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(Holiday, 'company_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(SystemSettings, 'company_id', { type: DataTypes.INTEGER, allowNull: true });

  await addIfMissing(Company, 'tenant_id', { type: DataTypes.INTEGER, allowNull: true });

  // Zeiterfassung (Phase 2)
  await addIfMissing(User, 'time_model_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(User, 'stamp_code', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(User, 'nfc_tag_uid', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(User, 'pin', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(Group, 'time_model_id', { type: DataTypes.INTEGER, allowNull: true });
  await addIfMissing(SystemSettings, 'break_mode', { type: DataTypes.STRING, allowNull: false, defaultValue: 'auto' });
  await addIfMissing(SystemSettings, 'break_after6h_minutes', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 });
  await addIfMissing(SystemSettings, 'break_after9h_minutes', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 45 });
  await addIfMissing(SystemSettings, 'auto_cap_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  await addIfMissing(SystemSettings, 'auto_cap_time', { type: DataTypes.STRING, allowNull: false, defaultValue: '23:00' });
  await addIfMissing(SystemSettings, 'arbzg_warnings_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  await addIfMissing(SystemSettings, 'arbzg_max_daily_minutes', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 600 });
  await addIfMissing(SystemSettings, 'arbzg_min_rest_minutes', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 660 });
  await addIfMissing(SystemSettings, 'gps_required', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  // Stundenzettel-Mail beim Monatsabschluss: 'inherit' (Firmen-Default) | 'on' | 'off'.
  await addIfMissing(User, 'timesheet_email_mode', { type: DataTypes.STRING, allowNull: false, defaultValue: 'inherit' });

  await migrateRoleNames();
  await ensureCompanyScopedNameUnique();
  await ensureDefaultCompany();
  await ensureDefaultTenant();
  await ensureIndexes();
}

/**
 * Rollen-Umbenennung (Bestandsmigration, idempotent):
 * hr → buchhaltung, manager → verwaltung, employee → mitarbeiter.
 * Läuft bei jedem Start; UPDATEs treffen nur noch vorhandene Alt-Werte.
 */
export async function migrateRoleNames(): Promise<void> {
  const mappings: Array<[string, string]> = [
    ['hr', 'buchhaltung'],
    ['manager', 'verwaltung'],
    ['employee', 'mitarbeiter'],
  ];
  for (const [oldRole, newRole] of mappings) {
    const [, meta]: any = await sequelize.query(
      'UPDATE users SET role = ? WHERE role = ?',
      { replacements: [newRole, oldRole] }
    );
    const changed = Number(meta?.changes ?? 0);
    if (changed > 0) console.log(`Migration: ${changed} Nutzer-Rolle(n) '${oldRole}' → '${newRole}' umgestellt.`);
  }
}

/**
 * Firmen-/Mandanten-Trennung: `groups.name` und `departments.name` waren GLOBAL unique
 * (Altbestand) → zwei Firmen konnten denselben Namen nicht nutzen + Existenz war ableitbar.
 * Diese Migration baut die Tabellen einmalig auf einen zusammengesetzten Unique-Index
 * (company_id, name) um. Idempotent: läuft nur, solange die inline-UNIQUE-Spalte existiert.
 */
async function rebuildWithoutInlineUnique(table: string, colDefs: string, columns: string, idxName: string): Promise<void> {
  const [rows]: any = await sequelize.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}';`);
  const sql: string = rows?.[0]?.sql || '';
  if (!/NOT NULL UNIQUE/i.test(sql)) return; // bereits migriert (keine inline-UNIQUE mehr)

  const before: any = await sequelize.query(`SELECT COUNT(*) AS c FROM ${table};`, { type: (sequelize as any).QueryTypes.SELECT });
  const beforeCount = Number(before?.[0]?.c ?? 0);
  const tmp = `${table}__mig`;

  // WICHTIG: legacy_alter_table=ON, damit SQLite NICHT die FK-Verweise in Kind-Tabellen
  // (z. B. group_managers → groups) umschreibt. Wir bauen eine Temp-Tabelle, droppen die
  // Original- und benennen die Temp-Tabelle auf den Originalnamen um → Kind-FKs (per Name)
  // bleiben gültig.
  //
  // Das Pragma MUSS auf derselben Connection wie die DDL liegen, sonst greift es bei
  // gepooltem Zugriff evtl. gar nicht. Deshalb läuft es mit { transaction: t } in der
  // Transaktion (eine Connection). FK-Enforcement ist app-weit aus (database.ts setzt
  // PRAGMA foreign_keys nie ON), daher ist das Droppen der referenzierten Tabelle sicher
  // und wir müssen foreign_keys nicht extra umschalten.
  const t = await sequelize.transaction();
  try {
    await sequelize.query('PRAGMA legacy_alter_table=ON;', { transaction: t });
    await sequelize.query(`CREATE TABLE \`${tmp}\` (${colDefs});`, { transaction: t });
    await sequelize.query(`INSERT INTO \`${tmp}\` (${columns}) SELECT ${columns} FROM \`${table}\`;`, { transaction: t });
    await sequelize.query(`DROP TABLE \`${table}\`;`, { transaction: t });
    await sequelize.query(`ALTER TABLE \`${tmp}\` RENAME TO \`${table}\`;`, { transaction: t });
    await sequelize.query('PRAGMA legacy_alter_table=OFF;', { transaction: t });
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  const after: any = await sequelize.query(`SELECT COUNT(*) AS c FROM ${table};`, { type: (sequelize as any).QueryTypes.SELECT });
  const afterCount = Number(after?.[0]?.c ?? 0);
  if (afterCount !== beforeCount) {
    throw new Error(`Migration ${table}: Zeilenzahl wich ab (${beforeCount} → ${afterCount}) – abgebrochen.`);
  }
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${idxName} ON \`${table}\` (company_id, name);`);
  console.log(`Migration: ${table}.name auf zusammengesetzten Unique (company_id, name) umgestellt (${afterCount} Zeilen erhalten).`);
}

export async function ensureCompanyScopedNameUnique(): Promise<void> {
  try {
    await rebuildWithoutInlineUnique(
      'groups',
      '`id` INTEGER PRIMARY KEY, `name` VARCHAR(255) NOT NULL, `description` TEXT, `manager_id` INTEGER, `parent_group_id` INTEGER, `created_at` DATETIME NOT NULL, `updated_at` DATETIME NOT NULL, `company_id` INTEGER',
      '`id`, `name`, `description`, `manager_id`, `parent_group_id`, `created_at`, `updated_at`, `company_id`',
      'groups_company_id_name'
    );
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_groups_company ON `groups` (company_id);');
    await rebuildWithoutInlineUnique(
      'departments',
      '`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` VARCHAR(255) NOT NULL, `description` TEXT, `manager_id` INTEGER REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, `is_active` TINYINT(1) NOT NULL DEFAULT 1, `created_at` DATETIME NOT NULL, `updated_at` DATETIME NOT NULL, `company_id` INTEGER',
      '`id`, `name`, `description`, `manager_id`, `is_active`, `created_at`, `updated_at`, `company_id`',
      'departments_company_id_name'
    );
  } catch (e) {
    console.error('Migration company-scoped name-unique fehlgeschlagen:', (e as any)?.message);
  }
}

/**
 * Tenant-Ebene (über Firmen): legt bei Einführung einen Default-Mandanten an und
 * ordnet alle Firmen ohne Tenant ihm zu. Idempotent.
 */
export async function ensureDefaultTenant(): Promise<void> {
  const count = await Tenant.count();
  let tenantId: number | undefined;
  if (count === 0) {
    const t = await Tenant.create({ name: 'Hauptmandant', isActive: true });
    tenantId = t.id;
    console.log(`Migration: Default-Tenant „Hauptmandant" (id=${t.id}) angelegt.`);
  } else {
    const first = await Tenant.findOne({ order: [['id', 'ASC']] });
    tenantId = first?.id;
  }
  if (tenantId) {
    await sequelize.query(`UPDATE companies SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`);
  }
}

/**
 * Erstellt bei der Mandanten-Einführung eine „Hauptfirma" und ordnet alle bestehenden
 * Mitarbeiter/Gruppen/Abteilungen ihr zu. Bestehende Admins werden zu Super-Admins
 * (behalten so den unternehmensweiten Vollzugriff). Idempotent.
 */
export async function ensureDefaultCompany(): Promise<void> {
  const count = await Company.count();
  if (count === 0) {
    let name = 'Hauptfirma';
    try {
      const [rows]: any = await sequelize.query("SELECT company_name FROM system_settings LIMIT 1");
      if (rows && rows[0] && rows[0].company_name) name = rows[0].company_name;
    } catch { /* system_settings evtl. noch leer */ }
    const company = await Company.create({ name, isActive: true });
    console.log(`Migration: Default-Firma „${name}" (id=${company.id}) angelegt.`);
    await sequelize.query(`UPDATE users SET company_id = ${company.id} WHERE company_id IS NULL`);
    await sequelize.query(`UPDATE groups SET company_id = ${company.id} WHERE company_id IS NULL`);
    await sequelize.query(`UPDATE departments SET company_id = ${company.id} WHERE company_id IS NULL`);
    // Bestandsadmins behalten Vollzugriff über alle Firmen.
    await sequelize.query(`UPDATE users SET is_super_admin = 1 WHERE role = 'admin'`);
    console.log('Migration: Bestandsdaten der Hauptfirma zugeordnet, Admins → Super-Admin.');
    // Bestands-Feiertage ohne Firma der Hauptfirma zuordnen – NUR beim Erstlauf,
    // damit später bewusst global angelegte Feiertage nicht bei jedem Start umgehängt werden.
    const first = await Company.findOne({ order: [['id', 'ASC']] });
    if (first) {
      await sequelize.query(`UPDATE holidays SET company_id = ${first.id} WHERE company_id IS NULL`);
    }
  }
}

/**
 * Indizes auf häufig gefilterten Spalten (sync legt für bestehende Tabellen keine
 * Indizes an). Idempotent über CREATE INDEX IF NOT EXISTS (SQLite).
 */
export async function ensureIndexes(): Promise<void> {
  const idx: Array<[string, string, string]> = [
    // [indexName, table, columns]
    ['idx_gm_user', 'group_managers', 'user_id'],
    ['idx_gm_group', 'group_managers', 'group_id'],
    ['idx_hb_created', 'heartbeats', 'created_at'],
    ['idx_trash_type', 'trash_items', 'entity_type'],
    ['idx_trash_created', 'trash_items', 'created_at'],
    ['idx_users_group', 'users', 'group_id'],
    ['idx_users_company', 'users', 'company_id'],
    ['idx_groups_company', 'groups', 'company_id'],
    ['idx_users_active', 'users', 'is_active'],
    ['idx_holidays_start', 'holidays', 'start_date'],
    // Zeiterfassung
    ['idx_te_user_ts', 'time_entries', 'user_id, timestamp'],
    ['idx_te_company', 'time_entries', 'company_id'],
    ['idx_wd_company_date', 'work_days', 'company_id, date'],
    ['idx_time_models_company', 'time_models', 'company_id'],
    // Verwaltung & Buchhaltung (Phase 4)
    ['idx_corr_user_status', 'correction_requests', 'user_id, status'],
    ['idx_corr_company_status', 'correction_requests', 'company_id, status'],
    ['idx_mc_company_month', 'month_closures', 'company_id, month'],
    ['idx_mc_user_month', 'month_closures', 'user_id, month'],
    ['idx_tsd_user_period', 'timesheet_documents', 'user_id, period_start'],
    ['idx_tsd_company', 'timesheet_documents', 'company_id'],
  ];
  for (const [name, table, cols] of idx) {
    try {
      await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols});`);
    } catch (e) {
      console.error(`Index ${name} konnte nicht angelegt werden:`, (e as any)?.message);
    }
  }

  // Firmenspezifische Einstellungen: höchstens EINE Zeile pro Firma. Eventuelle Duplikate
  // (aus früherem parallelem Erstzugriff) bereinigen, dann partiellen Unique-Index anlegen
  // (globale Vorlage mit company_id IS NULL bleibt davon unberührt).
  try {
    await sequelize.query(
      `DELETE FROM system_settings WHERE company_id IS NOT NULL AND id NOT IN ` +
      `(SELECT MIN(id) FROM system_settings WHERE company_id IS NOT NULL GROUP BY company_id);`
    );
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_system_settings_company ON system_settings (company_id) WHERE company_id IS NOT NULL;`
    );
  } catch (e) {
    console.error('Unique-Index system_settings.company_id:', (e as any)?.message);
  }

  // Stempel-Code: eindeutig je Firma (partiell, NULL-Werte ausgenommen).
  try {
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_company_stamp_code ON users (company_id, stamp_code) WHERE stamp_code IS NOT NULL;`
    );
  } catch (e) {
    console.error('Unique-Index users.stamp_code:', (e as any)?.message);
  }

  // WorkDay: genau EINE Zeile pro Nutzer und Tag (Upsert-Ziel von calcWorkDay).
  try {
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_work_days_user_date ON work_days (user_id, date);`
    );
  } catch (e) {
    console.error('Unique-Index work_days.user_date:', (e as any)?.message);
  }
}
