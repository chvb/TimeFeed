import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

/**
 * AbsenceType — konfigurierbarer Abwesenheitsarten-Katalog (Yellowfox-Parität).
 *
 * Scope-Muster wie LeaveType in UrlaubsFeed: companyId null = globale Vorlage
 * (eingebaute Arten + automatisch aus dem UrlaubsFeed-Sync angelegte Arten),
 * sonst firmenspezifisch. WorkDay.absence trägt den `key` einer Art;
 * 'holiday' bleibt Sonderwert für gesetzliche Feiertage (kein Katalog-Eintrag).
 *
 * `datevKennzeichen` (1 Zeichen) ist das Ausfallschlüssel-Kennzeichen für den
 * DATEV-Lohn&Gehalt-Export (kalendertägliche Bewegungsdaten, Feld 3):
 * Arbeitszeit '1', Urlaub 'U', Krankheit 'K' — je Art konfigurierbar.
 */
interface AbsenceTypeAttributes {
  id: number;
  companyId?: number | null;
  // Stabiler Schlüssel (kebab/snake, wird in WorkDay.absence gespeichert).
  key: string;
  label: string;
  // Hex-Farbe (#rrggbb) für Chips/Badges im Client.
  color: string;
  // DATEV-LuG-Kennzeichen (1 Zeichen, Default '1').
  datevKennzeichen: string;
  isBuiltin: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AbsenceTypeCreationAttributes extends Optional<AbsenceTypeAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'color' | 'datevKennzeichen'
  | 'isBuiltin' | 'isActive' | 'sortOrder'> {}

export class AbsenceType extends Model<AbsenceTypeAttributes, AbsenceTypeCreationAttributes>
  implements AbsenceTypeAttributes {
  public id!: number;
  public companyId?: number | null;
  public key!: string;
  public label!: string;
  public color!: string;
  public datevKennzeichen!: string;
  public isBuiltin!: boolean;
  public isActive!: boolean;
  public sortOrder!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

AbsenceType.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: true },
    key: { type: DataTypes.STRING, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    color: { type: DataTypes.STRING(7), allowNull: false, defaultValue: '#64748b' },
    datevKennzeichen: { type: DataTypes.STRING(1), allowNull: false, defaultValue: '1' },
    isBuiltin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    sequelize,
    modelName: 'AbsenceType',
    tableName: 'absence_types',
    underscored: true,
    indexes: [
      // key eindeutig je Scope (SQLite: mehrere NULL-companyIds wären erlaubt —
      // Seed/CRUD prüfen deshalb zusätzlich per findOne).
      { unique: true, fields: ['company_id', 'key'] },
    ],
  }
);

/** Schlüssel-Format: kebab/snake (a-z, 0-9, '-', '_'), beginnt mit Buchstabe/Ziffer. */
export const ABSENCE_KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Farbpalette für automatisch angelegte Arten (UrlaubsFeed-Sync) und als UI-Vorschlag. */
export const ABSENCE_COLOR_PALETTE = [
  '#2563eb', '#7c3aed', '#0d9488', '#d97706', '#dc2626',
  '#db2777', '#059669', '#4f46e5', '#0891b2', '#b45309',
];

export function randomPaletteColor(): string {
  return ABSENCE_COLOR_PALETTE[Math.floor(Math.random() * ABSENCE_COLOR_PALETTE.length)];
}

// Eingebaute Arten (Yellowfox-Paritätsliste). vacation/sick entsprechen den
// bisherigen festen Werten in WorkDay.absence und bleiben gültig.
export const BUILTIN_ABSENCE_TYPES: Array<Pick<AbsenceTypeAttributes,
  'key' | 'label' | 'color' | 'datevKennzeichen' | 'sortOrder'>> = [
  { key: 'vacation', label: 'Urlaub', color: '#2563eb', datevKennzeichen: 'U', sortOrder: 1 },
  { key: 'sick', label: 'Krank', color: '#7c3aed', datevKennzeichen: 'K', sortOrder: 2 },
  { key: 'child_sick', label: 'Kinder krank', color: '#a855f7', datevKennzeichen: '1', sortOrder: 3 },
  { key: 'doctor', label: 'Arztbesuch', color: '#0d9488', datevKennzeichen: '1', sortOrder: 4 },
  { key: 'business_trip', label: 'Dienstgang', color: '#0891b2', datevKennzeichen: '1', sortOrder: 5 },
  { key: 'training', label: 'Fortbildung', color: '#059669', datevKennzeichen: '1', sortOrder: 6 },
  { key: 'parental_leave', label: 'Elternzeit', color: '#db2777', datevKennzeichen: '1', sortOrder: 7 },
  { key: 'special_leave', label: 'Sonderurlaub', color: '#4f46e5', datevKennzeichen: '1', sortOrder: 8 },
  { key: 'bad_weather', label: 'Schlechtwetter', color: '#64748b', datevKennzeichen: '1', sortOrder: 9 },
  { key: 'k6', label: 'K6', color: '#dc2626', datevKennzeichen: '1', sortOrder: 10 },
  { key: 'school', label: 'Schule (Azubi)', color: '#d97706', datevKennzeichen: '1', sortOrder: 11 },
  { key: 'free', label: 'Frei', color: '#94a3b8', datevKennzeichen: '1', sortOrder: 12 },
  { key: 'unclear', label: 'ungeklärt', color: '#f59e0b', datevKennzeichen: '1', sortOrder: 13 },
];

/**
 * Seedet die eingebauten Arten als globale Vorlagen (companyId null) —
 * idempotent, läuft bei jedem Serverstart. Bestehende Zeilen werden NICHT
 * überschrieben (Label/Farbe/Kennzeichen sind vom Admin anpassbar), nur das
 * isBuiltin-Flag wird ggf. nachgezogen.
 */
export async function seedBuiltinAbsenceTypes(): Promise<void> {
  for (const t of BUILTIN_ABSENCE_TYPES) {
    const existing = await AbsenceType.findOne({ where: { key: t.key, companyId: null } });
    if (!existing) {
      await AbsenceType.create({ ...t, companyId: null, isBuiltin: true, isActive: true });
    } else if (!existing.isBuiltin) {
      await existing.update({ isBuiltin: true });
    }
  }
}
