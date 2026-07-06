import { DataTypes, Model, Optional } from 'sequelize';
import crypto from 'crypto';
import { sequelize } from '../db/database';

// API-Schlüssel für die externe Schnittstelle (/api/external), z. B. für die
// Schwester-App UrlaubsFeed. Der Vollschlüssel (Format: tfk_ + 48 Hex-Zeichen) wird
// NIE gespeichert – nur sein SHA-256-Hash (keyHash) und die ersten 8 Zeichen
// (keyPrefix) zur Wiedererkennung in der Verwaltungs-UI.
export const API_KEY_PREFIX = 'tfk_';
export const API_SCOPE_TIMES_READ = 'times:read';

interface ApiKeyAttributes {
  id: number;
  tenantId: number;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  createdById?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ApiKeyCreationAttributes extends Optional<ApiKeyAttributes, 'id' | 'scopes' | 'isActive' | 'lastUsedAt' | 'expiresAt' | 'createdById' | 'createdAt' | 'updatedAt'> {}

export class ApiKey extends Model<ApiKeyAttributes, ApiKeyCreationAttributes> implements ApiKeyAttributes {
  public id!: number;
  public tenantId!: number;
  public name!: string;
  public keyPrefix!: string;
  public keyHash!: string;
  public scopes!: string[];
  public isActive!: boolean;
  public lastUsedAt?: Date | null;
  public expiresAt?: Date | null;
  public createdById?: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  public hasScope(scope: string): boolean {
    const scopes = Array.isArray(this.scopes) ? this.scopes : [];
    return scopes.includes(scope);
  }
}

/** Erzeugt einen neuen Vollschlüssel (tfk_ + 48 Hex-Zeichen, kryptographisch zufällig). */
export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(24).toString('hex');
}

/** SHA-256-Hex-Hash eines Vollschlüssels (so wird er gespeichert und nachgeschlagen). */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

ApiKey.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'tenants', key: 'id' },
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // Erste 8 Zeichen des Vollschlüssels – nur zur Anzeige/Wiedererkennung.
    keyPrefix: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    // SHA-256-Hex des Vollschlüssels; unique für den Auth-Lookup.
    keyHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    scopes: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [API_SCOPE_TIMES_READ],
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdById: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'ApiKey',
    tableName: 'api_keys',
    underscored: true,
  }
);
