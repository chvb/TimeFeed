import { DataTypes, Model, Optional } from 'sequelize';
import crypto from 'crypto';
import { sequelize } from '../db/database';
import bcrypt from 'bcryptjs';

/**
 * Erzeugt einen freien 8-stelligen numerischen Stempel-Code. Global (und damit
 * automatisch auch je Firma) eindeutig; Kollisionen werden per Retry aufgelöst.
 */
export async function generateStampCode(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const code = String(crypto.randomInt(10000000, 100000000));
    const clash = await User.findOne({ where: { stampCode: code }, attributes: ['id'] });
    if (!clash) return code;
  }
  throw new Error('Konnte keinen freien Stempel-Code generieren');
}

export enum UserRole {
  ADMIN = 'admin',
  BUCHHALTUNG = 'buchhaltung',
  VERWALTUNG = 'verwaltung',
  MITARBEITER = 'mitarbeiter'
}

interface UserAttributes {
  id: number;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  // Mandant (Unterfirma), dem der Nutzer zugeordnet ist. null = übergreifend (Super-Admin).
  companyId?: number | null;
  // Tenant (Mandanten-Ebene): gesetzt + companyId null + Rolle admin/buchhaltung = Mandanten-Admin
  // (verwaltet alle Firmen DIESES Tenants). null = nicht tenant-gebunden.
  tenantId?: number | null;
  // Instanzweiter Super-Admin: verwaltet alle Tenants/Firmen, nicht gescopet.
  isSuperAdmin?: boolean;
  groupId?: number;
  // Individuelle Arbeitstage (Array von Wochentag-IDs, z. B. ['monday',...]); null = globale Einstellung.
  workingDaysOverride?: string[] | null;
  hoursPerDayOverride?: number | null;
  // Beschäftigungsgrad für Teilzeit (1 = Vollzeit; z. B. 0.6 = 60 %).
  employmentFactor?: number | null;
  // Austrittsdatum (für anteilige Sollzeit im Austrittsjahr).
  exitDate?: Date | null;
  // Zeiterfassung: individuelles Zeitmodell (Override; null = Zeitmodell der Gruppe bzw. Fallback).
  timeModelId?: number | null;
  // Stempel-Code (8-stellig numerisch, eindeutig je Firma; steckt im NFC-Chip/QR).
  stampCode?: string | null;
  // Optionale NFC-Tag-UID (zusätzliche Identifikation am Terminal).
  nfcTagUid?: string | null;
  // Optionale PIN für Code-Eingabe am Terminal (bcrypt-gehasht gespeichert).
  pin?: string | null;
  // Monats-Stundenzettel per E-Mail beim Monatsabschluss:
  // 'inherit' = Firmen-Default (SystemSettings.sendTimesheetOnClose), 'on' = immer, 'off' = nie.
  timesheetEmailMode?: string;
  isActive: boolean;
  phoneNumber?: string;
  department?: string;
  position?: string;
  startDate: Date;
  entryDate?: Date;
  birthDate?: string | null;
  employeeNumber?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'tenantId' | 'isSuperAdmin' | 'workingDaysOverride' | 'hoursPerDayOverride' | 'employmentFactor' | 'exitDate' | 'birthDate' | 'timeModelId' | 'stampCode' | 'nfcTagUid' | 'pin' | 'timesheetEmailMode'> {}

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: number;
  public email!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public role!: UserRole;
  public companyId?: number | null;
  public tenantId?: number | null;
  public isSuperAdmin?: boolean;
  public groupId?: number;
  public workingDaysOverride?: string[] | null;
  public hoursPerDayOverride?: number | null;
  public employmentFactor?: number | null;
  public exitDate?: Date | null;
  public timeModelId?: number | null;
  public stampCode?: string | null;
  public nfcTagUid?: string | null;
  public pin?: string | null;
  public timesheetEmailMode?: string;
  public isActive!: boolean;
  public phoneNumber?: string;
  public department?: string;
  public position?: string;
  public startDate!: Date;
  public entryDate?: Date;
  public birthDate?: string | null;
  public employeeNumber?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  public async comparePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }

  public async comparePin(pin: string): Promise<boolean> {
    if (!this.pin) return false;
    return bcrypt.compare(pin, this.pin);
  }

  public get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...Object.values(UserRole)),
      allowNull: false,
      defaultValue: UserRole.MITARBEITER,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isSuperAdmin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    workingDaysOverride: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    hoursPerDayOverride: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    employmentFactor: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 1,
    },
    exitDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    timeModelId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    stampCode: {
      // Eindeutigkeit je Firma via partiellem Unique-Index (ensureIndexes), nicht inline.
      type: DataTypes.STRING,
      allowNull: true,
    },
    nfcTagUid: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    pin: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Stundenzettel-Mail beim Monatsabschluss: 'inherit' (Firmen-Default) | 'on' | 'off'.
    timesheetEmailMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'inherit',
      validate: { isIn: [['inherit', 'on', 'off']] },
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    department: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    position: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    entryDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    birthDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    employeeNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    underscored: true,
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
        if (user.pin) {
          user.pin = await bcrypt.hash(user.pin, await bcrypt.genSalt(10));
        }
        // Stempel-Code automatisch vergeben (8-stellig numerisch, kollisionfrei).
        if (!user.stampCode) {
          user.stampCode = await generateStampCode();
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
        if (user.changed('pin') && user.pin) {
          user.pin = await bcrypt.hash(user.pin, await bcrypt.genSalt(10));
        }
      },
    },
  }
);
