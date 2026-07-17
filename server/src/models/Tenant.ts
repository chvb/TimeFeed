import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

// Mandant (Tenant): oberste Ebene über den Firmen. Ein Tenant = Kunde/Organisation,
// der mehrere Firmen enthält (Tenant → Firma → Abteilung/Gruppe → Mitarbeiter).
interface TenantAttributes {
  id: number;
  name: string;
  isActive: boolean;
  // Branding (pro Mandant): Anzeigename, Primärfarbe ('#rrggbb') und Logo als
  // Data-URL (PNG/SVG/JPEG/WebP, max. ~500 KB — Validierung im Controller).
  brandName?: string | null;
  brandColor?: string | null;
  brandLogo?: string | null;
  // Zentrales Kiosk-Einstellungs-Passwort (bcrypt): schützt das Zahnrad ALLER
  // Terminals des Mandanten (Geräte-Passwort wirkt zusätzlich als Verschärfung).
  terminalSettingsPasswordHash?: string | null;
  // Vertragsdaten des Mandanten für AVV/AGB-Druck (strukturierte Freitextfelder als JSON).
  contractData?: Record<string, any> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TenantCreationAttributes extends Optional<TenantAttributes, 'id' | 'isActive' | 'brandName' | 'brandColor' | 'brandLogo' | 'terminalSettingsPasswordHash' | 'contractData' | 'createdAt' | 'updatedAt'> {}

export class Tenant extends Model<TenantAttributes, TenantCreationAttributes> implements TenantAttributes {
  public id!: number;
  public name!: string;
  public isActive!: boolean;
  public brandName?: string | null;
  public brandColor?: string | null;
  public brandLogo?: string | null;
  public terminalSettingsPasswordHash?: string | null;
  public contractData?: Record<string, any> | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  /** Antworten ohne Geheimnisse: der Hash verlässt den Server nie. */
  public toJSON(): Record<string, any> {
    const { terminalSettingsPasswordHash: _hash, ...rest } = super.toJSON() as any;
    rest.hasTerminalSettingsPassword = !!this.terminalSettingsPasswordHash;
    return rest;
  }

  // Schema-Nachrüstung (Bestands-DB): sync alteriert bestehende Tabellen nicht,
  // und die zentralen Migrationsdateien werden parallel von Feature-Paketen
  // bearbeitet — deshalb lokal am Modell (Muster TerminalDevice.ensureSchema).
  private static schemaEnsured = false;
  public static async ensureSchema(): Promise<void> {
    if (Tenant.schemaEnsured) return;
    try {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('tenants');
      if (!desc['terminal_settings_password_hash']) {
        await qi.addColumn('tenants', 'terminal_settings_password_hash', {
          type: DataTypes.STRING,
          allowNull: true,
        });
        console.log('Migration: Spalte tenants.terminal_settings_password_hash ergänzt.');
      }
      if (!desc['contract_data']) {
        await qi.addColumn('tenants', 'contract_data', { type: DataTypes.TEXT, allowNull: true });
        console.log('Migration: Spalte tenants.contract_data ergänzt.');
      }
      Tenant.schemaEnsured = true;
    } catch {
      // Tabelle existiert (noch) nicht (frische DB → sync) oder DB gesperrt —
      // nächster Aufruf versucht es erneut.
    }
  }
}

Tenant.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    brandName: { type: DataTypes.STRING, allowNull: true },
    brandColor: {
      type: DataTypes.STRING(7),
      allowNull: true,
      validate: { is: /^#[0-9a-fA-F]{6}$/ },
    },
    brandLogo: { type: DataTypes.TEXT, allowNull: true },
    terminalSettingsPasswordHash: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'terminal_settings_password_hash',
    },
    contractData: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'contract_data',
      // Robust gegen SQLite-Eigenheit: eine per addColumn (TEXT) nachgerüstete
      // Spalte wird beim Lesen NICHT automatisch aus JSON geparst (anders als eine
      // per sync als JSON angelegte Spalte). Getter normalisiert immer auf Objekt.
      get() {
        const raw = this.getDataValue('contractData') as unknown;
        if (typeof raw === 'string') {
          try { return JSON.parse(raw); } catch { return null; }
        }
        return (raw as Record<string, any>) ?? null;
      },
    },
  },
  {
    sequelize,
    tableName: 'tenants',
    timestamps: true,
  }
);

// Beim Modul-Load nachziehen: die Spalte muss vor dem ersten SELECT existieren
// (das Modell deklariert das Attribut — sonst scheitern Bestands-DBs sofort).
void Tenant.ensureSchema();
