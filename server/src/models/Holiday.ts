import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

// Gesetzliche Feiertage (und firmenspezifische freie Tage) – Grundlage der Sollzeit-Berechnung.
interface HolidayAttributes {
  id: number;
  name: string;
  startDate: Date;
  endDate: Date;
  // 'national' = gesetzlicher Feiertag, 'company' = firmenspezifischer freier Tag.
  type: string;
  // Wiederkehrend (fester Monat+Tag, z. B. Neujahr). Bewegliche Feiertage: false.
  isRecurring: boolean;
  description?: string | null;
  // null = global (alle Firmen), sonst firmenspezifisch.
  companyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface HolidayCreationAttributes extends Optional<HolidayAttributes, 'id' | 'createdAt' | 'updatedAt' | 'description' | 'companyId' | 'isRecurring' | 'type'> {}

export class Holiday extends Model<HolidayAttributes, HolidayCreationAttributes> implements HolidayAttributes {
  public id!: number;
  public name!: string;
  public startDate!: Date;
  public endDate!: Date;
  public type!: string;
  public isRecurring!: boolean;
  public description?: string | null;
  public companyId?: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Holiday.init(
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
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    endDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'national',
    },
    isRecurring: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Holiday',
    tableName: 'holidays',
    underscored: true,
  }
);
