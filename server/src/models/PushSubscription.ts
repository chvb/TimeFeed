import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

/** Web-Push-Abo eines Browsers/Geräts. endpoint ist global eindeutig. */
interface PushSubscriptionAttributes {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PushSubscriptionCreationAttributes extends Optional<PushSubscriptionAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class PushSubscription extends Model<PushSubscriptionAttributes, PushSubscriptionCreationAttributes>
  implements PushSubscriptionAttributes {
  public id!: number;
  public userId!: number;
  public endpoint!: string;
  public p256dh!: string;
  public auth!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PushSubscription.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    endpoint: { type: DataTypes.STRING(1024), allowNull: false, unique: true },
    p256dh: { type: DataTypes.STRING, allowNull: false },
    auth: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    modelName: 'PushSubscription',
    tableName: 'push_subscriptions',
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  }
);
