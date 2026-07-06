import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

// Mandant (Tenant): oberste Ebene über den Firmen. Ein Tenant = Kunde/Organisation,
// der mehrere Firmen enthält (Tenant → Firma → Abteilung/Gruppe → Mitarbeiter).
interface TenantAttributes {
  id: number;
  name: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TenantCreationAttributes extends Optional<TenantAttributes, 'id' | 'isActive' | 'createdAt' | 'updatedAt'> {}

export class Tenant extends Model<TenantAttributes, TenantCreationAttributes> implements TenantAttributes {
  public id!: number;
  public name!: string;
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Tenant.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    tableName: 'tenants',
    timestamps: true,
  }
);
