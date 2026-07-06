import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

export type TimeEntryType = 'in' | 'out' | 'break_start' | 'break_end';
export type TimeEntrySource = 'web' | 'terminal' | 'manual' | 'api' | 'auto_cap';

/**
 * Stempelung — UNVERÄNDERLICHES Journal.
 *
 * Buchungswerte (type/timestamp/…) werden nach dem Anlegen NIE geändert oder
 * gelöscht. Korrektur = Storno (isCancelled + cancelledById/At/Reason) plus
 * neuer Eintrag, der per replacesEntryId auf den stornierten verweist.
 * Ein beforeUpdate-Hook erzwingt das auf Modell-Ebene.
 */
interface TimeEntryAttributes {
  id: number;
  userId: number;
  companyId?: number | null;
  type: TimeEntryType;
  // Server-Zeitstempel (UTC).
  timestamp: Date;
  source: TimeEntrySource;
  // Terminal-Gerät (Phase 3: FK auf terminal_devices; bis dahin nur die ID).
  terminalId?: number | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  note?: string | null;
  // Bei Nachbuchung/Korrektur: wer den Eintrag angelegt hat (≠ userId).
  createdById?: number | null;
  // Verweis auf den stornierten Eintrag, den dieser ersetzt (Self-FK).
  replacesEntryId?: number | null;
  isCancelled: boolean;
  cancelledById?: number | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TimeEntryCreationAttributes extends Optional<TimeEntryAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'terminalId' | 'lat' | 'lng' | 'accuracy'
  | 'note' | 'createdById' | 'replacesEntryId' | 'isCancelled' | 'cancelledById' | 'cancelledAt' | 'cancelReason'> {}

// Felder, die nach dem Anlegen noch geändert werden dürfen (nur Storno-Metadaten).
const MUTABLE_FIELDS = new Set(['isCancelled', 'cancelledById', 'cancelledAt', 'cancelReason', 'updatedAt']);

export class TimeEntry extends Model<TimeEntryAttributes, TimeEntryCreationAttributes> implements TimeEntryAttributes {
  public id!: number;
  public userId!: number;
  public companyId?: number | null;
  public type!: TimeEntryType;
  public timestamp!: Date;
  public source!: TimeEntrySource;
  public terminalId?: number | null;
  public lat?: number | null;
  public lng?: number | null;
  public accuracy?: number | null;
  public note?: string | null;
  public createdById?: number | null;
  public replacesEntryId?: number | null;
  public isCancelled!: boolean;
  public cancelledById?: number | null;
  public cancelledAt?: Date | null;
  public cancelReason?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TimeEntry.init(
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
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [['in', 'out', 'break_start', 'break_end']] },
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'web',
      validate: { isIn: [['web', 'terminal', 'manual', 'api', 'auto_cap']] },
    },
    terminalId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    lat: { type: DataTypes.FLOAT, allowNull: true },
    lng: { type: DataTypes.FLOAT, allowNull: true },
    accuracy: { type: DataTypes.FLOAT, allowNull: true },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdById: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    replacesEntryId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isCancelled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    cancelledById: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'TimeEntry',
    tableName: 'time_entries',
    underscored: true,
    indexes: [
      { fields: ['user_id', 'timestamp'] },
      { fields: ['company_id'] },
    ],
    hooks: {
      // Journal-Schutz: nach dem Anlegen sind nur Storno-Metadaten änderbar.
      beforeUpdate: (entry) => {
        const changed = (entry.changed() || []) as string[];
        const illegal = changed.filter((f) => !MUTABLE_FIELDS.has(f));
        if (illegal.length > 0) {
          throw new Error(`TimeEntry ist unveränderlich (Korrektur = Storno + neuer Eintrag). Unzulässige Änderung: ${illegal.join(', ')}`);
        }
      },
      beforeDestroy: () => {
        throw new Error('TimeEntry darf nicht gelöscht werden (unveränderliches Journal).');
      },
    },
  }
);
