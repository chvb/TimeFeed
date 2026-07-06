import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

export type RoundingMode = 'none' | 'up' | 'down' | 'nearest';

/**
 * Zeitmodell (Wochen-Sollzeitplan) — pro Firma anlegbar, Gruppen zuordenbar
 * (Group.timeModelId), pro Mitarbeiter überschreibbar (User.timeModelId).
 * Sollminuten je Wochentag + optionale Rundungsregel für die Tagessumme.
 */
interface TimeModelAttributes {
  id: number;
  companyId?: number | null;
  name: string;
  isActive: boolean;
  monMinutes: number;
  tueMinutes: number;
  wedMinutes: number;
  thuMinutes: number;
  friMinutes: number;
  satMinutes: number;
  sunMinutes: number;
  // Rundung der TAGESSUMME der Ist-Zeit: none | up | down | nearest.
  roundingMode: RoundingMode;
  // Rundungsraster in Minuten (z. B. 5 oder 15); 0/none = keine Rundung.
  roundingMinutes: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TimeModelCreationAttributes extends Optional<TimeModelAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'isActive'
  | 'monMinutes' | 'tueMinutes' | 'wedMinutes' | 'thuMinutes' | 'friMinutes' | 'satMinutes' | 'sunMinutes'
  | 'roundingMode' | 'roundingMinutes'> {}

export class TimeModel extends Model<TimeModelAttributes, TimeModelCreationAttributes> implements TimeModelAttributes {
  public id!: number;
  public companyId?: number | null;
  public name!: string;
  public isActive!: boolean;
  public monMinutes!: number;
  public tueMinutes!: number;
  public wedMinutes!: number;
  public thuMinutes!: number;
  public friMinutes!: number;
  public satMinutes!: number;
  public sunMinutes!: number;
  public roundingMode!: RoundingMode;
  public roundingMinutes!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  /** Sollminuten für einen JS-Wochentag (0=Sonntag … 6=Samstag). */
  public minutesForWeekday(jsDay: number): number {
    switch (jsDay) {
      case 0: return this.sunMinutes;
      case 1: return this.monMinutes;
      case 2: return this.tueMinutes;
      case 3: return this.wedMinutes;
      case 4: return this.thuMinutes;
      case 5: return this.friMinutes;
      case 6: return this.satMinutes;
      default: return 0;
    }
  }
}

TimeModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    monMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 480 },
    tueMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 480 },
    wedMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 480 },
    thuMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 480 },
    friMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 480 },
    satMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sunMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    roundingMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'none',
      validate: { isIn: [['none', 'up', 'down', 'nearest']] },
    },
    roundingMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    modelName: 'TimeModel',
    tableName: 'time_models',
    underscored: true,
    indexes: [{ fields: ['company_id'] }],
  }
);
