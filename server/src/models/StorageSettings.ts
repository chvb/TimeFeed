import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/database';

export interface StorageSettingsAttributes {
  id?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  // Konfigurierbarer Speicherpfad/Prefix im Bucket (z.B. "timefeed/backups/")
  s3BackupPrefix?: string;
  // Separater Pfad/Prefix für hochgeladene Anhänge (PDFs), getrennt von Backups.
  s3AttachmentPrefix?: string;
  isActive?: boolean;
}

export class StorageSettings extends Model<StorageSettingsAttributes> implements StorageSettingsAttributes {
  public id!: string;
  public s3Endpoint?: string;
  public s3Region?: string;
  public s3Bucket?: string;
  public s3AccessKey?: string;
  public s3SecretKey?: string;
  public s3BackupPrefix?: string;
  public s3AttachmentPrefix?: string;
  public isActive?: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StorageSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    s3Endpoint: { type: DataTypes.STRING, allowNull: true },
    s3Region: { type: DataTypes.STRING, allowNull: true, defaultValue: 'eu-central-1' },
    s3Bucket: { type: DataTypes.STRING, allowNull: true },
    s3AccessKey: { type: DataTypes.STRING, allowNull: true },
    s3SecretKey: { type: DataTypes.STRING, allowNull: true },
    s3BackupPrefix: { type: DataTypes.STRING, allowNull: true, defaultValue: 'timefeed/backups/' },
    s3AttachmentPrefix: { type: DataTypes.STRING, allowNull: true, defaultValue: 'timefeed/attachments/' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: 'StorageSettings',
    tableName: 'storage_settings',
    underscored: true,
  }
);
