import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

/** Summen-Snapshot eines Abschlusses (redundant zu den WorkDays, für die Historie). */
export interface MonthClosureTotals {
  targetMinutes: number;
  workedMinutes: number;
  balanceMinutes: number;
  users: Array<{
    userId: number;
    name: string;
    targetMinutes: number;
    workedMinutes: number;
    balanceMinutes: number;
  }>;
}

/**
 * MonthClosure — Monatsabschluss (Phase 4).
 *
 * userId NULL = Abschluss der GANZEN Firma für den Monat; sonst Einzelabschluss
 * eines Mitarbeiters. Beim Abschluss werden alle WorkDays des Monats auf
 * 'locked' gesetzt; Stempeln/Nachbuchen/Stornieren in den Monat liefert danach
 * 423 MONTH_LOCKED. Wiedereröffnung (nur admin) löscht die Closure-Zeile.
 */
interface MonthClosureAttributes {
  id: number;
  companyId: number;
  userId?: number | null;
  // 'YYYY-MM'
  month: string;
  closedById: number;
  closedAt: Date;
  totals: MonthClosureTotals;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MonthClosureCreationAttributes extends Optional<MonthClosureAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'userId'> {}

export class MonthClosure extends Model<MonthClosureAttributes, MonthClosureCreationAttributes>
  implements MonthClosureAttributes {
  public id!: number;
  public companyId!: number;
  public userId?: number | null;
  public month!: string;
  public closedById!: number;
  public closedAt!: Date;
  public totals!: MonthClosureTotals;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

MonthClosure.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    month: {
      type: DataTypes.STRING(7),
      allowNull: false,
      validate: { is: /^\d{4}-(0[1-9]|1[0-2])$/ },
    },
    closedById: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    closedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    totals: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    sequelize,
    modelName: 'MonthClosure',
    tableName: 'month_closures',
    underscored: true,
    indexes: [
      { fields: ['company_id', 'month'] },
      { fields: ['user_id', 'month'] },
      // Doppelte Abschlüsse verhindern (Einzelabschluss pro Nutzer/Monat/Firma).
      { fields: ['company_id', 'user_id', 'month'], unique: true },
    ],
  }
);
