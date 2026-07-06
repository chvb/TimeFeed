import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/database';

export interface PasswordResetTokenAttributes {
  id?: string;
  userId: number;
  token: string;
  expiresAt: Date;
  used?: boolean;
}

export class PasswordResetToken extends Model<PasswordResetTokenAttributes> implements PasswordResetTokenAttributes {
  public id!: string;
  public userId!: number;
  public token!: string;
  public expiresAt!: Date;
  public used?: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PasswordResetToken.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  token: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  used: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  sequelize,
  modelName: 'PasswordResetToken',
  tableName: 'password_reset_tokens',
  indexes: [
    {
      fields: ['token']
    },
    {
      fields: ['user_id']
    }
  ]
});