import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

export type WorkDayStatus = 'open' | 'incomplete' | 'ok' | 'flagged' | 'approved' | 'locked';

/**
 * Berechnetes Tagesaggregat (Ergebnis von timeCalcService.calcWorkDay).
 * Quelle der Wahrheit bleiben die TimeEntries — WorkDay ist jederzeit
 * reproduzierbar, AUSSER status 'approved'/'locked' (werden nie überschrieben).
 */
interface WorkDayAttributes {
  id: number;
  userId: number;
  companyId?: number | null;
  // Arbeitstag (Kalendertag des 'in' — Nachtschichten zählen zum Tag des Einstempelns).
  date: string;
  targetMinutes: number;
  workedMinutes: number;
  // Gestempelte Pausenminuten.
  breakMinutes: number;
  // Automatisch ergänzte (gesetzliche) Pausenminuten.
  autoBreakMinutes: number;
  balanceMinutes: number;
  status: WorkDayStatus;
  // z. B. ['arbzg_over_10h','arbzg_rest_violation','auto_capped','no_gps','target_credited']
  flags: string[];
  // 'holiday' | 'vacation' | 'sick' | … → Tag zählt als Sollzeit-Gutschrift.
  absence?: string | null;
  // Herkunft der Abwesenheit: 'urlaubsfeed' (per Sync gesetzt, darf vom Sync
  // wieder entfernt werden) | 'manual' | null.
  absenceSource?: string | null;
  firstIn?: Date | null;
  lastOut?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface WorkDayCreationAttributes extends Optional<WorkDayAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'targetMinutes' | 'workedMinutes' | 'breakMinutes'
  | 'autoBreakMinutes' | 'balanceMinutes' | 'status' | 'flags' | 'absence' | 'absenceSource' | 'firstIn' | 'lastOut'> {}

export class WorkDay extends Model<WorkDayAttributes, WorkDayCreationAttributes> implements WorkDayAttributes {
  public id!: number;
  public userId!: number;
  public companyId?: number | null;
  public date!: string;
  public targetMinutes!: number;
  public workedMinutes!: number;
  public breakMinutes!: number;
  public autoBreakMinutes!: number;
  public balanceMinutes!: number;
  public status!: WorkDayStatus;
  public flags!: string[];
  public absence?: string | null;
  public absenceSource?: string | null;
  public firstIn?: Date | null;
  public lastOut?: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

WorkDay.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    targetMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    workedMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    breakMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    autoBreakMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    balanceMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'open',
      validate: { isIn: [['open', 'incomplete', 'ok', 'flagged', 'approved', 'locked']] },
    },
    flags: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    absence: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    absenceSource: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    firstIn: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastOut: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'WorkDay',
    tableName: 'work_days',
    underscored: true,
    indexes: [
      { unique: true, fields: ['user_id', 'date'] },
      { fields: ['company_id', 'date'] },
    ],
  }
);
