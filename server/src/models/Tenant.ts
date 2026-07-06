import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

// Mandant (Tenant): oberste Ebene über den Firmen. Ein Tenant = Kunde/Organisation,
// der mehrere Firmen enthält (Tenant → Firma → Abteilung/Gruppe → Mitarbeiter).
interface TenantAttributes {
  id: number;
  name: string;
  isActive: boolean;
  // Branding (pro Mandant): Anzeigename, Primärfarbe ('#rrggbb') und Logo als
  // Data-URL (PNG/SVG/JPEG/WebP, max. ~500 KB — Validierung im Controller).
  brandName?: string | null;
  brandColor?: string | null;
  brandLogo?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TenantCreationAttributes extends Optional<TenantAttributes, 'id' | 'isActive' | 'brandName' | 'brandColor' | 'brandLogo' | 'createdAt' | 'updatedAt'> {}

export class Tenant extends Model<TenantAttributes, TenantCreationAttributes> implements TenantAttributes {
  public id!: number;
  public name!: string;
  public isActive!: boolean;
  public brandName?: string | null;
  public brandColor?: string | null;
  public brandLogo?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Tenant.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    brandName: { type: DataTypes.STRING, allowNull: true },
    brandColor: {
      type: DataTypes.STRING(7),
      allowNull: true,
      validate: { is: /^#[0-9a-fA-F]{6}$/ },
    },
    brandLogo: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    tableName: 'tenants',
    timestamps: true,
  }
);
