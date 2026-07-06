import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/database';

export interface EmailSettingsAttributes {
  id?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  fromEmail?: string;
  fromName?: string;
  isActive?: boolean;
}

export class EmailSettings extends Model<EmailSettingsAttributes> implements EmailSettingsAttributes {
  public id!: string;
  public smtpHost?: string;
  public smtpPort?: number;
  public smtpUser?: string;
  public smtpPassword?: string;
  public smtpSecure?: boolean;
  public fromEmail?: string;
  public fromName?: string;
  public isActive?: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EmailSettings.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  smtpHost: {
    type: DataTypes.STRING,
    allowNull: true
  },
  smtpPort: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 587
  },
  smtpUser: {
    type: DataTypes.STRING,
    allowNull: true
  },
  smtpPassword: {
    type: DataTypes.STRING,
    allowNull: true
  },
  smtpSecure: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  fromEmail: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fromName: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'TimeFeed'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  sequelize,
  modelName: 'EmailSettings',
  tableName: 'email_settings'
});