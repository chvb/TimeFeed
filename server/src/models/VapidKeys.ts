import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

/**
 * VAPID-Schlüsselpaar für Web-Push: wird beim ersten Serverstart generiert und
 * hier persistiert (genau EINE Zeile), damit bestehende Push-Abos einen Neustart
 * überleben (neue Keys würden alle Subscriptions invalidieren).
 */
interface VapidKeysAttributes {
  id: number;
  publicKey: string;
  privateKey: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface VapidKeysCreationAttributes extends Optional<VapidKeysAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class VapidKeys extends Model<VapidKeysAttributes, VapidKeysCreationAttributes> implements VapidKeysAttributes {
  public id!: number;
  public publicKey!: string;
  public privateKey!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

VapidKeys.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    publicKey: { type: DataTypes.STRING, allowNull: false },
    privateKey: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    modelName: 'VapidKeys',
    tableName: 'vapid_keys',
    underscored: true,
  }
);
