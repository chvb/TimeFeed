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
  // GPS beim Stempeln verpflichtend? (Altfeld — abgelöst durch gpsMode, bleibt für Bestands-DBs)
  gpsRequired: boolean;
  // GPS-Modus beim Stempeln:
  // 'off'      = Standort weder abfragen noch speichern
  // 'optional' = ohne Standort still akzeptieren (Standard)
  // 'warn'     = akzeptieren, aber Tag markieren + Feed-Karte + nächtliche Sammel-Mail
  // 'required' = ohne Standort keine Buchung
  gpsMode: string;
  // Aufbewahrung (Löschkonzept):
  // retentionMonthsEntries — Aufbewahrung der Zeitdaten (TimeEntries/WorkDays/
  // CorrectionRequests) in Monaten. Minimum 24: § 16 Abs. 2 ArbZG verlangt die
  // Aufbewahrung der Arbeitszeitnachweise für mindestens zwei Jahre.
  retentionMonthsEntries: number;
  // retentionMonthsGps — GPS-Daten (lat/lng/accuracy) sind nach kurzer Zeit
  // nicht mehr erforderlich (Datenminimierung, Art. 5 DSGVO) und werden früher genullt.
  retentionMonthsGps: number;
  // Terminal-Überwachung: Störungs-E-Mail, wenn ein aktives Terminal länger als
  // terminalAlertMinutes nichts gemeldet hat. Empfänger: terminalAlertEmails
  // (Komma-Liste) oder — wenn leer — alle aktiven Admins der Firma.
  terminalAlertEnabled: boolean;
  terminalAlertMinutes: number;
  terminalAlertEmails?: string | null;
  // Heartbeat-Intervall der Kiosk-Terminals in Sekunden (Terminals übernehmen
  // Änderungen live über die Ping-/Info-Antwort).
  terminalPingSeconds: number;
  // Monats-Stundenzettel beim Monatsabschluss automatisch per E-Mail an die
  // Mitarbeiter senden (Firmen-Default; je Nutzer über User.timesheetEmailMode übersteuerbar).
  sendTimesheetOnClose: boolean;
  // Automatisches Backup-System (nur GLOBALE Vorlage relevant, companyId=null):
  // täglicher JSON-Vollbackup-Lauf zur autoBackupTime (lokal + optional S3).
  autoBackupEnabled: boolean;
  autoBackupTime: string;
  backupRetentionDays: number;
  backupNotifyOnFailure: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SystemSettingsCreationAttributes extends Optional<SystemSettingsAttributes, 'id' | 'createdAt' | 'updatedAt' | 'companyId'
  | 'breakMode' | 'breakAfter6hMinutes' | 'breakAfter9hMinutes' | 'autoCapEnabled' | 'autoCapTime'
  | 'arbzgWarningsEnabled' | 'arbzgMaxDailyMinutes' | 'arbzgMinRestMinutes' | 'gpsRequired' | 'gpsMode'
  | 'retentionMonthsEntries' | 'retentionMonthsGps'
  | 'terminalAlertEnabled' | 'terminalAlertMinutes' | 'terminalAlertEmails' | 'terminalPingSeconds'
  | 'sendTimesheetOnClose'
  | 'autoBackupEnabled' | 'autoBackupTime' | 'backupRetentionDays' | 'backupNotifyOnFailure'> {}

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
  public gpsMode!: string;
  public retentionMonthsEntries!: number;
  public retentionMonthsGps!: number;
  public terminalAlertEnabled!: boolean;
  public terminalAlertMinutes!: number;
  public terminalAlertEmails?: string | null;
  public terminalPingSeconds!: number;
  public sendTimesheetOnClose!: boolean;
  public autoBackupEnabled!: boolean;
  public autoBackupTime!: string;
  public backupRetentionDays!: number;
  public backupNotifyOnFailure!: boolean;
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
    gpsMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'optional',
      validate: { isIn: [['off', 'optional', 'warn', 'required']] },
    },
    // Aufbewahrung: min. 24 Monate (§ 16 Abs. 2 ArbZG — Nachweise mind. 2 Jahre).
    retentionMonthsEntries: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 24,
      validate: { min: 24 },
    },
    // GPS-Daten deutlich früher nullen (Datenminimierung).
    retentionMonthsGps: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3,
      validate: { min: 1 },
    },
    // Terminal-Überwachung: Störungs-Mail nach X Minuten Funkstille.
    terminalAlertEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    terminalAlertMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 15,
      validate: { min: 2, max: 1440 },
    },
    terminalAlertEmails: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    terminalPingSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 20,
      validate: { min: 5, max: 600 },
    },
    // Stundenzettel-Versand beim Monatsabschluss (Firmen-Default).
    sendTimesheetOnClose: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Automatisches Backup-System (nur globale Vorlage relevant).
    autoBackupEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    autoBackupTime: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '02:30',
      validate: { is: /^([01]\d|2[0-3]):[0-5]\d$/ },
    },
    backupRetentionDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
      validate: { min: 7 },
    },
    backupNotifyOnFailure: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'SystemSettings',
    tableName: 'system_settings',
  }
);
