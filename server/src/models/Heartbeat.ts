import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/database';

/** Minimaler Heartbeat zur Uptime-Berechnung (ein Eintrag je Intervall). */
export class Heartbeat extends Model {
  public id!: number;
  public readonly createdAt!: Date;
}

Heartbeat.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  { sequelize, modelName: 'Heartbeat', tableName: 'heartbeats', updatedAt: false }
);
