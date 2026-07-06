import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

interface SystemSettingsAttributes {
  id: number;
  // null = globale Standard-Einstellungen (Vorlage); sonst firmenspezifische Einstellungen.
  companyId?: number | null;
  companyName: string;
  workingDays: string;
  hoursPerWorkday: number;
  emailNotifications: boolean;
  fiscalYearStart: string;
  bundesland: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  publicUrl?: string;
  departments: string;
  // Security settings
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSpecialChars: boolean;
  sessionDurationHours: number;
  passwordExpiryDays: number;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  // Zeiterfassung: Pausenmodus ('auto' = gesetzliche Pause automatisch abziehen,
  // 'manual' = nur gestempelte Pausen, 'combined' = gestempelt + Auffüllen auf Minimum).
  breakMode: string;
  // Gesetzliche Mindestpause bei > 6h bzw. > 9h Arbeitszeit (Minuten).
  breakAfter6hMinutes: number;
  breakAfter9hMinutes: number;
  // Auto-Kappung: vergessene 'out'-Stempelungen nachts automatisch zur Kappungszeit schließen.
  autoCapEnabled: boolean;
  autoCapTime: string;
  // ArbZG-Warnungen: > 10h/Tag und Ruhezeit < 11h markieren.
  arbzgWarningsEnabled: boolean;
  arbzgMaxDailyMinutes: number;
  arbzgMinRestMinutes: number;
  // GPS beim Stempeln verpflichtend? (false = erlaubt, aber als 'no_gps' markiert)
  gpsRequired: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SystemSettingsCreationAttributes extends Optional<SystemSettingsAttributes, 'id' | 'createdAt' | 'updatedAt' | 'companyId'
  | 'breakMode' | 'breakAfter6hMinutes' | 'breakAfter9hMinutes' | 'autoCapEnabled' | 'autoCapTime'
  | 'arbzgWarningsEnabled' | 'arbzgMaxDailyMinutes' | 'arbzgMinRestMinutes' | 'gpsRequired'> {}

export class SystemSettings extends Model<SystemSettingsAttributes, SystemSettingsCreationAttributes> implements SystemSettingsAttributes {
  public id!: number;
  public companyId?: number | null;
  public companyName!: string;
  public workingDays!: string;
  public hoursPerWorkday!: number;
  public emailNotifications!: boolean;
  public fiscalYearStart!: string;
  public bundesland!: string;
  public companyAddress?: string;
  public companyPhone?: string;
  public companyEmail?: string;
  public companyWebsite?: string;
  public publicUrl?: string;
  public departments!: string;
  // Security settings
  public passwordMinLength!: number;
  public passwordRequireUppercase!: boolean;
  public passwordRequireLowercase!: boolean;
  public passwordRequireNumbers!: boolean;
  public passwordRequireSpecialChars!: boolean;
  public sessionDurationHours!: number;
  public passwordExpiryDays!: number;
  public maxLoginAttempts!: number;
  public lockoutDurationMinutes!: number;
  public breakMode!: string;
  public breakAfter6hMinutes!: number;
  public breakAfter9hMinutes!: number;
  public autoCapEnabled!: boolean;
  public autoCapTime!: string;
  public arbzgWarningsEnabled!: boolean;
  public arbzgMaxDailyMinutes!: number;
  public arbzgMinRestMinutes!: number;
  public gpsRequired!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  public getParsedWorkingDays(): string[] {
    return JSON.parse(this.workingDays);
  }

  public getParsedDepartments(): string[] {
    return JSON.parse(this.departments);
  }
}

SystemSettings.init(
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
    companyName: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'TimeFeed GmbH',
    },
    workingDays: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: JSON.stringify(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    },
    hoursPerWorkday: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 8,
    },
    emailNotifications: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    fiscalYearStart: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '01-01',
    },
    bundesland: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'BE',
    },
    companyAddress: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    companyPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    companyEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    companyWebsite: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    publicUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    departments: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: JSON.stringify(['IT', 'Personal', 'Buchhaltung', 'Vertrieb', 'Marketing', 'Produktion']),
    },
    // Security settings
    passwordMinLength: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 8,
    },
    passwordRequireUppercase: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    passwordRequireLowercase: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    passwordRequireNumbers: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    passwordRequireSpecialChars: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    sessionDurationHours: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 8,
    },
    passwordExpiryDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 90,
    },
    maxLoginAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    lockoutDurationMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 15,
    },
    // Zeiterfassung
    breakMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'auto',
      validate: { isIn: [['auto', 'manual', 'combined']] },
    },
    breakAfter6hMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
    },
    breakAfter9hMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 45,
    },
    autoCapEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    autoCapTime: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '23:00',
      validate: { is: /^([01]\d|2[0-3]):[0-5]\d$/ },
    },
    arbzgWarningsEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    arbzgMaxDailyMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 600,
    },
    arbzgMinRestMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 660,
    },
    gpsRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: 'SystemSettings',
    tableName: 'system_settings',
  }
);
