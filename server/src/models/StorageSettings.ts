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
  // --- Sekundärer S3 (Backup-/Failover-Spiegel, Muster: FotoFeed) ---------
  // Nur aktiv, wenn secondaryEnabled UND Bucket + Access-/Secret-Key gesetzt.
  secondaryEnabled?: boolean;
  secondaryEndpoint?: string;
  secondaryRegion?: string;
  secondaryBucket?: string;
  secondaryAccessKey?: string;
  secondarySecretKey?: string;
  // Prefix, unter dem die gespiegelten Objekte (mit ihrem Primär-Key) liegen.
  secondaryPrefix?: string;
  // Harter Timeout für Primär-Operationen, bevor auf Sekundär ausgewichen wird.
  secondaryFailoverTimeoutMs?: number;
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
  public secondaryEnabled?: boolean;
  public secondaryEndpoint?: string;
  public secondaryRegion?: string;
  public secondaryBucket?: string;
  public secondaryAccessKey?: string;
  public secondarySecretKey?: string;
  public secondaryPrefix?: string;
  public secondaryFailoverTimeoutMs?: number;

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
    secondaryEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    secondaryEndpoint: { type: DataTypes.STRING, allowNull: true },
    secondaryRegion: { type: DataTypes.STRING, allowNull: true, defaultValue: 'eu-central-1' },
    secondaryBucket: { type: DataTypes.STRING, allowNull: true },
    secondaryAccessKey: { type: DataTypes.STRING, allowNull: true },
    secondarySecretKey: { type: DataTypes.STRING, allowNull: true },
    secondaryPrefix: { type: DataTypes.STRING, allowNull: true, defaultValue: 'timefeed-mirror/' },
    secondaryFailoverTimeoutMs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3000 },
  },
  {
    sequelize,
    modelName: 'StorageSettings',
    tableName: 'storage_settings',
    underscored: true,
  }
);
