import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  PASSWORD_CHANGE = 'password_change',
  PASSWORD_RESET = 'password_reset',
  SETTINGS_UPDATE = 'settings_update',
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DELETED = 'user_deleted',
  HOLIDAY_CREATED = 'holiday_created',
  HOLIDAY_UPDATED = 'holiday_updated',
  HOLIDAY_DELETED = 'holiday_deleted',
  HOLIDAY_REFRESH = 'holiday_refresh',
  EMAIL_SENT = 'email_sent',
  CLEANUP = 'cleanup',
  EXPORT = 'export',
  IMPORT = 'import'
}

export enum AuditCategory {
  AUTHENTICATION = 'authentication',
  USER_MANAGEMENT = 'user_management',
  HOLIDAYS = 'holidays',
  SYSTEM_SETTINGS = 'system_settings',
  SYSTEM = 'system',
  SECURITY = 'security',
  DATA_MANAGEMENT = 'data_management',
  EMAIL = 'email',
  IMPORT_EXPORT = 'import_export'
}

interface AuditLogAttributes {
  id: number;
  userId?: number;
  action: AuditAction;
  category: AuditCategory;
  entity?: string;
  entityId?: number;
  oldValues?: string;
  newValues?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  additionalData?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AuditLogCreationAttributes extends Optional<AuditLogAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class AuditLog extends Model<AuditLogAttributes, AuditLogCreationAttributes> implements AuditLogAttributes {
  public id!: number;
  public userId?: number;
  public action!: AuditAction;
  public category!: AuditCategory;
  public entity?: string;
  public entityId?: number;
  public oldValues?: string;
  public newValues?: string;
  public ipAddress?: string;
  public userAgent?: string;
  public success!: boolean;
  public errorMessage?: string;
  public additionalData?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  public getParsedOldValues(): any {
    return this.oldValues ? JSON.parse(this.oldValues) : null;
  }

  public getParsedNewValues(): any {
    return this.newValues ? JSON.parse(this.newValues) : null;
  }

  public getParsedAdditionalData(): any {
    return this.additionalData ? JSON.parse(this.additionalData) : null;
  }
}

AuditLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'user_id',
      references: {
        model: 'users',
        key: 'id',
      },
    },
    action: {
      type: DataTypes.ENUM(...Object.values(AuditAction)),
      allowNull: false,
    },
    category: {
      type: DataTypes.ENUM(...Object.values(AuditCategory)),
      allowNull: false,
    },
    entity: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'entity_id',
    },
    oldValues: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'old_values',
    },
    newValues: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'new_values',
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'ip_address',
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'user_agent',
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'error_message',
    },
    additionalData: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'additional_data',
    },
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
    indexes: [
      {
        fields: ['user_id'],
      },
      {
        fields: ['action'],
      },
      {
        fields: ['category'],
      },
      {
        fields: ['created_at'],
      },
      {
        fields: ['entity', 'entity_id'],
      },
    ],
  }
);