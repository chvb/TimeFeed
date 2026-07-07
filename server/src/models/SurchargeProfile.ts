import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

/**
 * Zuschlagsfenster eines Zuschlagsprofils (JSON-Eintrag in `windows`):
 * Zeitspanne from–to (HH:MM, to <= from = Fenster läuft über Mitternacht),
 * DATEV-Lohnart für die Zuschlagszeilen, prozentualer Zuschlag (informativ,
 * die Bewertung macht die Lohnbuchhaltung über die Lohnart) und ein Label
 * (z. B. „Nachtarbeit") für Vorschau/Export-Quelle.
 */
export interface SurchargeWindow {
  from: string;   // 'HH:MM'
  to: string;     // 'HH:MM' — to <= from bedeutet: über Mitternacht
  lohnart: string;
  percent: number;
  label: string;
}

/**
 * SurchargeProfile — Zuschlagsprofil für gesonderte Zeitspannen
 * (Yellowfox-Parität Paket 2, z. B. Nachtarbeit 20:00–06:00 → Lohnart 1010).
 * Zuordnung nach dem Zeitmodell-Muster: Group.surchargeProfileId (Gruppe)
 * + User.surchargeProfileId (Override je Mitarbeiter).
 */
interface SurchargeProfileAttributes {
  id: number;
  companyId?: number | null;
  name: string;
  isActive: boolean;
  windows: SurchargeWindow[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface SurchargeProfileCreationAttributes extends Optional<SurchargeProfileAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'isActive' | 'windows'> {}

export class SurchargeProfile extends Model<SurchargeProfileAttributes, SurchargeProfileCreationAttributes>
  implements SurchargeProfileAttributes {
  public id!: number;
  public companyId?: number | null;
  public name!: string;
  public isActive!: boolean;
  public windows!: SurchargeWindow[];
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  /** windows defensiv als Array lesen (JSON-Spalte kann als String ankommen). */
  public getParsedWindows(): SurchargeWindow[] {
    const raw: any = this.windows;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    }
    return [];
  }
}

SurchargeProfile.init(
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
    windows: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    sequelize,
    modelName: 'SurchargeProfile',
    tableName: 'surcharge_profiles',
    underscored: true,
    indexes: [{ fields: ['company_id'] }],
  }
);
