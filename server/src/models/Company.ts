import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

interface CompanyAttributes {
  id: number;
  name: string;
  // Mandant (Tenant), zu dem die Firma gehört. null = noch keinem Tenant zugeordnet.
  tenantId?: number | null;
  // Optionales Branding für Druck/PDF/QR (SVG-Markup oder Data-URL). Leer = globales Logo.
  logo?: string | null;
  // Bundesland für Feiertage dieser Firma (überschreibt sonst globalen Default).
  bundesland?: string | null;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CompanyCreationAttributes extends Optional<CompanyAttributes, 'id' | 'tenantId' | 'logo' | 'bundesland' | 'isActive' | 'createdAt' | 'updatedAt'> {}

export class Company extends Model<CompanyAttributes, CompanyCreationAttributes> implements CompanyAttributes {
  public id!: number;
  public name!: string;
  public tenantId?: number | null;
  public logo?: string | null;
  public bundesland?: string | null;
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Company.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    logo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    bundesland: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'companies',
    timestamps: true,
  }
);
