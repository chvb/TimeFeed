import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

/**
 * UrlaubsFeed-Kopplung: genau EINE Zeile je Tenant. Der API-Key wird im Klartext
 * gespeichert (er wird für ausgehende Requests benötigt), verlässt den Server aber
 * NIE über die API — GET liefert nur `hasKey: true`.
 */
interface IntegrationSettingsAttributes {
  id: number;
  tenantId: number;
  urlaubsfeedUrl?: string | null;
  urlaubsfeedApiKey?: string | null;
  syncEnabled: boolean;
  lastSyncAt?: Date | null;
  lastSyncResult?: object | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface IntegrationSettingsCreationAttributes extends Optional<IntegrationSettingsAttributes,
  'id' | 'urlaubsfeedUrl' | 'urlaubsfeedApiKey' | 'syncEnabled' | 'lastSyncAt' | 'lastSyncResult' | 'createdAt' | 'updatedAt'> {}

export class IntegrationSettings extends Model<IntegrationSettingsAttributes, IntegrationSettingsCreationAttributes>
  implements IntegrationSettingsAttributes {
  public id!: number;
  public tenantId!: number;
  public urlaubsfeedUrl?: string | null;
  public urlaubsfeedApiKey?: string | null;
  public syncEnabled!: boolean;
  public lastSyncAt?: Date | null;
  public lastSyncResult?: object | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

IntegrationSettings.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: 'tenants', key: 'id' },
    },
    urlaubsfeedUrl: { type: DataTypes.STRING, allowNull: true },
    urlaubsfeedApiKey: { type: DataTypes.STRING, allowNull: true },
    syncEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastSyncAt: { type: DataTypes.DATE, allowNull: true },
    lastSyncResult: { type: DataTypes.JSON, allowNull: true },
  },
  {
    sequelize,
    modelName: 'IntegrationSettings',
    tableName: 'integration_settings',
    underscored: true,
  }
);
