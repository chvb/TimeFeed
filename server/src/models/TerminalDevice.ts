import { DataTypes, Model, Optional } from 'sequelize';
import crypto from 'crypto';
import { sequelize } from '../db/database';

/**
 * TerminalDevice — Stempel-Terminal (Kiosk-Modus, Phase 3).
 *
 * Authentifizierung über ein Geräte-Token (`tft_` + 48 Hex-Zeichen), das nur bei
 * der Registrierung EINMALIG im Klartext ausgegeben wird. Gespeichert wird
 * ausschließlich der SHA-256-Hash; `tokenPrefix` (erste 8 Zeichen) dient der
 * Wiedererkennung in der Admin-UI.
 */

export const TERMINAL_METHODS = ['nfc', 'code', 'qr'] as const;
export type TerminalMethod = (typeof TERMINAL_METHODS)[number];

export interface TerminalConfig {
  /** Erlaubte Identifikationsarten am Gerät. */
  methods: TerminalMethod[];
  /** PIN-Pflicht bei der Identifikation (greift nur, wenn der User eine PIN hat). */
  requirePin: boolean;
}

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  methods: ['nfc', 'code', 'qr'],
  requirePin: false,
};

/** Neues Geräte-Token: `tft_` + 48 Hex-Zeichen (24 Zufallsbytes). */
export function generateTerminalToken(): string {
  return `tft_${crypto.randomBytes(24).toString('hex')}`;
}

/** SHA-256-Hex eines Geräte-Tokens (Lookup-Schlüssel in der DB). */
export function hashTerminalToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface TerminalDeviceAttributes {
  id: number;
  // Firma, zu der das Terminal gehört (Pflicht — Terminals sind nie global).
  companyId: number;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  locationLabel?: string | null;
  // Fester Gerätestandort — wird bei Terminal-Stempelungen als lat/lng übernommen.
  lat?: number | null;
  lng?: number | null;
  isActive: boolean;
  lastSeenAt?: Date | null;
  config: TerminalConfig;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TerminalDeviceCreationAttributes extends Optional<TerminalDeviceAttributes,
  'id' | 'locationLabel' | 'lat' | 'lng' | 'isActive' | 'lastSeenAt' | 'config' | 'createdAt' | 'updatedAt'> {}

export class TerminalDevice extends Model<TerminalDeviceAttributes, TerminalDeviceCreationAttributes> implements TerminalDeviceAttributes {
  public id!: number;
  public companyId!: number;
  public name!: string;
  public tokenHash!: string;
  public tokenPrefix!: string;
  public locationLabel?: string | null;
  public lat?: number | null;
  public lng?: number | null;
  public isActive!: boolean;
  public lastSeenAt?: Date | null;
  public config!: TerminalConfig;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  /** Normalisierte Config (robust gegen fehlende/kaputte Werte in der DB). */
  public getConfig(): TerminalConfig {
    let raw: any = this.config;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    const methods = Array.isArray(raw?.methods)
      ? raw.methods.filter((m: any): m is TerminalMethod => (TERMINAL_METHODS as readonly string[]).includes(m))
      : [];
    return {
      methods: methods.length > 0 ? methods : [...DEFAULT_TERMINAL_CONFIG.methods],
      requirePin: raw?.requirePin === true,
    };
  }

  /** Darstellung ohne Geheimnis (tokenHash wird NIE ausgeliefert). */
  public toSafeJSON(): Record<string, any> {
    const { tokenHash: _tokenHash, ...rest } = this.toJSON() as any;
    rest.config = this.getConfig();
    return rest;
  }
}

TerminalDevice.init(
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
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tokenHash: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    tokenPrefix: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    locationLabel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    lat: { type: DataTypes.FLOAT, allowNull: true },
    lng: { type: DataTypes.FLOAT, allowNull: true },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    config: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: DEFAULT_TERMINAL_CONFIG,
    },
  },
  {
    sequelize,
    modelName: 'TerminalDevice',
    tableName: 'terminal_devices',
    underscored: true,
    indexes: [
      { fields: ['company_id'] },
    ],
  }
);
