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
}
