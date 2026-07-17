import { DataTypes } from 'sequelize';
import { sequelize } from '../db/database';
import { StorageSettings } from '../models/StorageSettings';
import { SystemSettings } from '../models/SystemSettings';

/**
 * Idempotente Spalten-Migration für die Sekundär-S3- und Retention-Features.
 *
 * sequelize.sync({force:false}) legt nur fehlende TABELLEN an; bestehende
 * Tabellen bekommen hier ihre neuen Spalten (gleiche Technik wie
 * db/ensureColumns.ts — bewusst separat gehalten, damit diese Erweiterung
 * keine fremden Dateien anfassen muss). Aufruf beim Start über
 * timeRecalcJob.startTimeRecalcJob().
 */
export async function ensureSecondaryAndRetentionColumns(): Promise<void> {
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

  // storage_settings — sekundärer S3 (underscored → snake_case)
  await addIfMissing(StorageSettings, 'secondary_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(StorageSettings, 'secondary_endpoint', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(StorageSettings, 'secondary_region', { type: DataTypes.STRING, allowNull: true, defaultValue: 'eu-central-1' });
  await addIfMissing(StorageSettings, 'secondary_bucket', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(StorageSettings, 'secondary_access_key', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(StorageSettings, 'secondary_secret_key', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(StorageSettings, 'secondary_prefix', { type: DataTypes.STRING, allowNull: true, defaultValue: 'timefeed-mirror/' });
  await addIfMissing(StorageSettings, 'secondary_failover_timeout_ms', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3000 });

  // system_settings — Aufbewahrung (§ 16 Abs. 2 ArbZG: min. 2 Jahre → Default/Minimum 24 Monate)
  await addIfMissing(SystemSettings, 'retention_months_entries', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 24 });
  await addIfMissing(SystemSettings, 'retention_months_gps', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 });

  // system_settings — Terminal-Überwachung (Störungs-Mail bei Funkstille)
  await addIfMissing(SystemSettings, 'terminal_alert_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(SystemSettings, 'terminal_alert_minutes', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 15 });
  await addIfMissing(SystemSettings, 'terminal_alert_emails', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(SystemSettings, 'terminal_ping_seconds', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 });

  // GPS-Modus (löst gpsRequired ab); Bestandsmapping: gps_required=1 → 'required'.
  const desc = await sequelize.getQueryInterface().describeTable('system_settings');
  if (!desc['gps_mode']) {
    await sequelize.getQueryInterface().addColumn('system_settings', 'gps_mode', { type: DataTypes.STRING, allowNull: false, defaultValue: 'optional' });
    await sequelize.query("UPDATE system_settings SET gps_mode='required' WHERE gps_required = 1");
    console.log('Migration: system_settings.gps_mode ergänzt (gps_required übernommen).');
  }
  // Max. GPS-Genauigkeitsradius (Meter) für gpsMode='required' — pro Firma einstellbar.
  await addIfMissing(SystemSettings, 'gps_max_accuracy', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 });

  // system_settings — Stundenzettel automatisch per E-Mail beim Monatsabschluss (Firmen-Default)
  await addIfMissing(SystemSettings, 'send_timesheet_on_close', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  // system_settings — Automatisches Backup-System (nur globale Vorlage relevant, companyId=null)
  await addIfMissing(SystemSettings, 'auto_backup_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  await addIfMissing(SystemSettings, 'auto_backup_time', { type: DataTypes.STRING, allowNull: false, defaultValue: '02:30' });
  await addIfMissing(SystemSettings, 'backup_retention_days', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 });
  await addIfMissing(SystemSettings, 'backup_notify_on_failure', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });

  // system_settings — Periodische Berichts-Mails (Tag/Monat/Quartal/Jahr, firmen-scoped)
  await addIfMissing(SystemSettings, 'report_daily_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(SystemSettings, 'report_monthly_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(SystemSettings, 'report_quarterly_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(SystemSettings, 'report_yearly_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing(SystemSettings, 'report_recipients', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(SystemSettings, 'report_last_sent', { type: DataTypes.TEXT, allowNull: true });

  // Doppelte Monatsabschlüsse verhindern (best-effort; bei evtl. Alt-Duplikaten scheitert
  // die Index-Anlage stillschweigend, ohne den Start zu blockieren).
  try {
    await sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS month_closures_company_user_month ON month_closures (company_id, user_id, month)'
    );
  } catch (e) {
    console.warn('Unique-Index month_closures nicht angelegt (evtl. Alt-Duplikate):', (e as Error).message);
  }
}
