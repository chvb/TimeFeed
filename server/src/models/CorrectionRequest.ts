import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';
import { TimeEntryType } from './TimeEntry';

export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

/** Vorgeschlagene Stempelung eines Korrekturantrags: Typ + lokale Uhrzeit 'HH:MM'. */
export interface ProposedEntry {
  type: TimeEntryType;
  time: string; // 'HH:MM' (lokale Zeit des Antragstags)
}

/**
 * CorrectionRequest — Korrekturantrag eines Mitarbeiters (Phase 4).
 *
 * Mitarbeiter dürfen eigene Stempelungen NICHT direkt ändern/stornieren; sie
 * stellen stattdessen einen Antrag mit den gewünschten Soll-Stempelungen
 * (proposedEntries). Genehmigung durch admin/buchhaltung/verwaltung wendet die
 * Vorschläge als 'manual'-TimeEntries an (createdById = Genehmiger).
 */
interface CorrectionRequestAttributes {
  id: number;
  userId: number;
  companyId?: number | null;
  // Betroffener Arbeitstag (lokales YYYY-MM-DD).
  date: string;
  // Begründung/Beschreibung des Mitarbeiters.
  message: string;
  // JSON-Array [{ type, time: 'HH:MM' }].
  proposedEntries: ProposedEntry[];
  status: CorrectionRequestStatus;
  decidedById?: number | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CorrectionRequestCreationAttributes extends Optional<CorrectionRequestAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'status' | 'decidedById' | 'decidedAt' | 'decisionNote'> {}

export class CorrectionRequest extends Model<CorrectionRequestAttributes, CorrectionRequestCreationAttributes>
  implements CorrectionRequestAttributes {
  public id!: number;
  public userId!: number;
  public companyId?: number | null;
  public date!: string;
  public message!: string;
  public proposedEntries!: ProposedEntry[];
  public status!: CorrectionRequestStatus;
  public decidedById?: number | null;
  public decidedAt?: Date | null;
  public decisionNote?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CorrectionRequest.init(
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
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    proposedEntries: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'pending',
      validate: { isIn: [['pending', 'approved', 'rejected']] },
    },
    decidedById: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    decidedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    decisionNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'CorrectionRequest',
    tableName: 'correction_requests',
    underscored: true,
    indexes: [
      { fields: ['user_id', 'status'] },
      { fields: ['company_id', 'status'] },
      { fields: ['date'] },
    ],
  }
);
