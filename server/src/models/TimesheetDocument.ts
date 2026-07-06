import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

export type TimesheetStorageType = 'local' | 's3';

/**
 * TimesheetDocument — hochgeladener Stundenzettel (PDF/Bild, Phase 4).
 *
 * Ablage je nach Storage-Konfiguration: S3 (storageService aktiv) unter
 * `{attachmentPrefix}tenant-{tid}/company-{cid}/timesheets/{random}.{ext}`
 * oder lokal unter server/uploads/timesheets/. storageKey ist der S3-Key bzw.
 * der lokale Dateiname (ohne Pfad).
 */
interface TimesheetDocumentAttributes {
  id: number;
  companyId?: number | null;
  userId: number;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageType: TimesheetStorageType;
  storageKey: string;
  uploadedById: number;
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TimesheetDocumentCreationAttributes extends Optional<TimesheetDocumentAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'note'> {}

export class TimesheetDocument extends Model<TimesheetDocumentAttributes, TimesheetDocumentCreationAttributes>
  implements TimesheetDocumentAttributes {
  public id!: number;
  public companyId?: number | null;
  public userId!: number;
  public periodStart!: string;
  public periodEnd!: string;
  public fileName!: string;
  public mimeType!: string;
  public size!: number;
  public storageType!: TimesheetStorageType;
  public storageKey!: string;
  public uploadedById!: number;
  public note?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TimesheetDocument.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    periodStart: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    periodEnd: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    storageType: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [['local', 's3']] },
    },
    storageKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    uploadedById: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'TimesheetDocument',
    tableName: 'timesheet_documents',
    underscored: true,
    indexes: [
      { fields: ['user_id', 'period_start'] },
      { fields: ['company_id'] },
    ],
  }
);
