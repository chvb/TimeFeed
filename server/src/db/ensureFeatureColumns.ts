import { DataTypes } from 'sequelize';
import { sequelize } from './database';
import { Tenant } from '../models/Tenant';
import { WorkDay } from '../models/WorkDay';
import { ApiKey, API_SCOPE_USERS_READ } from '../models/ApiKey';

/**
 * Spalten-Migrationen für die Feature-Erweiterungen Branding/API-Keys/UrlaubsFeed-
 * Kopplung/Web-Push. Eigenständige Datei (nicht ensureColumns.ts), damit parallel
 * laufende Arbeiten an ensureColumns.ts nicht kollidieren. Idempotent.
 */
export async function ensureFeatureColumns(): Promise<void> {
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

  // Branding pro Tenant
  await addIfMissing(Tenant, 'brand_name', { type: DataTypes.STRING, allowNull: true });
  await addIfMissing(Tenant, 'brand_color', { type: DataTypes.STRING(7), allowNull: true });
  await addIfMissing(Tenant, 'brand_logo', { type: DataTypes.TEXT, allowNull: true });

  // UrlaubsFeed-Sync: Herkunft einer gesetzten Abwesenheit ('urlaubsfeed' | 'manual').
  await addIfMissing(WorkDay, 'absence_source', { type: DataTypes.STRING, allowNull: true });

  // API-Key-Scopes: Bestands-Schlüssel wurden vor Einführung des Mitarbeiter-Exports
  // (GET /api/external/users) nur mit 'times:read' angelegt. Damit bereits gekoppelte
  // UrlaubsFeed-Instanzen den neuen Endpunkt OHNE manuelles Neu-Ausstellen des
  // Schlüssels nutzen können, wird 'users:read' hier idempotent ergänzt
  // (neue Schlüssel erhalten beide Scopes direkt, siehe apiKey.controller).
  const keys = await ApiKey.findAll();
  for (const key of keys) {
    const scopes = Array.isArray(key.scopes) ? key.scopes : [];
    if (!scopes.includes(API_SCOPE_USERS_READ)) {
      await key.update({ scopes: [...scopes, API_SCOPE_USERS_READ] });
      console.log(`Migration: API-Key ${key.keyPrefix}… um Scope '${API_SCOPE_USERS_READ}' ergänzt.`);
    }
  }
}
