import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

export type ExportFormat = 'lodas' | 'lug' | 'csv' | 'xlsx';
export type PersonalNrSource = 'employeeNumber' | 'userId';
export type OvertimeMode = 'none' | 'balance';

export const EXPORT_FORMATS: ExportFormat[] = ['lodas', 'lug', 'csv', 'xlsx'];
export const PERSONALNR_SOURCES: PersonalNrSource[] = ['employeeNumber', 'userId'];
export const OVERTIME_MODES: OvertimeMode[] = ['none', 'balance'];

/**
 * ExportProfile — Lohn-Export-Konfiguration (Phase 5), EINE Zeile je Firma
 * (companyId unique). Steuert Format (DATEV LODAS / Lohn & Gehalt / CSV / XLSX),
 * Berater-/Mandantennummer, Personalnummern-Quelle, Lohnarten und den
 * Überstunden-Modus:
 *  - overtimeMode 'none':    alle Ist-Stunden auf lohnartNormal.
 *  - overtimeMode 'balance': positiver Monatssaldo wird als Überstunden auf
 *    lohnartOvertime ausgewiesen, Normalstunden = Ist − Überstunden.
 *    Ist lohnartOvertime leer, werden Überstunden NICHT separat exportiert
 *    (alles auf lohnartNormal — keine Stunden gehen verloren).
 */
interface ExportProfileAttributes {
  id: number;
  companyId: number;
  format: ExportFormat;
  beraterNr: string;
  mandantenNr: string;
  personalNrSource: PersonalNrSource;
  lohnartNormal: string;
  lohnartOvertime?: string | null;
  overtimeMode: OvertimeMode;
  // true = Export nur, wenn der Monat für ALLE betroffenen User abgeschlossen ist
  // (409 MONTH_NOT_CLOSED, per force=true übersteuerbar — wird auditiert).
  exportOnlyClosed: boolean;
  // true = Dezimal-KOMMA in LODAS/LuG/CSV (deutsches Format), false = Punkt.
  decimalComma: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ExportProfileCreationAttributes extends Optional<ExportProfileAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'format' | 'beraterNr' | 'mandantenNr'
  | 'personalNrSource' | 'lohnartNormal' | 'lohnartOvertime' | 'overtimeMode'
  | 'exportOnlyClosed' | 'decimalComma'> {}

export class ExportProfile extends Model<ExportProfileAttributes, ExportProfileCreationAttributes>
  implements ExportProfileAttributes {
  public id!: number;
  public companyId!: number;
  public format!: ExportFormat;
  public beraterNr!: string;
  public mandantenNr!: string;
  public personalNrSource!: PersonalNrSource;
  public lohnartNormal!: string;
  public lohnartOvertime?: string | null;
  public overtimeMode!: OvertimeMode;
  public exportOnlyClosed!: boolean;
  public decimalComma!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExportProfile.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    format: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'csv',
      validate: { isIn: [EXPORT_FORMATS] },
    },
    beraterNr: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '',
    },
    mandantenNr: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '',
    },
    personalNrSource: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'employeeNumber',
      validate: { isIn: [PERSONALNR_SOURCES] },
    },
    lohnartNormal: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '200',
    },
    lohnartOvertime: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    overtimeMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'none',
      validate: { isIn: [OVERTIME_MODES] },
    },
    exportOnlyClosed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    decimalComma: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'ExportProfile',
    tableName: 'export_profiles',
    underscored: true,
    indexes: [
      { unique: true, fields: ['company_id'] },
    ],
  }
);
