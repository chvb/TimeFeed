import { Request, Response, NextFunction } from 'express';
import { HolidayService } from '../services/holidayService';
import { SystemSettings } from '../models/SystemSettings';
import { AuditService } from '../services/auditService';
import { AppError } from '../middleware/errorHandler';
import { getEffectiveActor, canManageCompanyRecord } from '../services/accessScope';

export class SettingsController {
  // Firmen-Einstellungen mit globalem Fallback:
  // - companyId=null → globale Standard-Einstellungen (Vorlage)
  // - companyId gesetzt → firmenspezifische Zeile; existiert keine, wird sie aus der
  //   globalen Vorlage geklont (Firma startet mit den aktuellen globalen Werten).
  public async getOrCreateSettings(companyId: number | null = null): Promise<SystemSettings> {
    if (companyId) {
      const existing = await SystemSettings.findOne({ where: { companyId } });
      if (existing) return existing;
      const base = await this.getOrCreateSettings(null);
      const clone: any = { ...base.toJSON(), companyId };
      delete clone.id; delete clone.createdAt; delete clone.updatedAt;
      // findOrCreate + Unique-Index (company_id) verhindert doppelte Zeilen bei parallelem Erstzugriff.
      const [settings] = await SystemSettings.findOrCreate({ where: { companyId }, defaults: clone });
      return settings;
    }
    let settings = await SystemSettings.findOne({ where: { companyId: null } });
    if (!settings) settings = await SystemSettings.findOne(); // Bestandszeile ohne companyId
    if (!settings) {
      settings = await SystemSettings.create({
        companyName: 'TimeFeed GmbH',
        workingDays: JSON.stringify(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
        hoursPerWorkday: 8,
        emailNotifications: true,
        fiscalYearStart: '01-01',
        bundesland: 'BE',
        companyAddress: '',
        companyPhone: '',
        companyEmail: '',
        companyWebsite: '',
        departments: JSON.stringify(['IT', 'Personal', 'Buchhaltung', 'Vertrieb', 'Marketing', 'Produktion']),
        // Security defaults
        passwordMinLength: 8,
        passwordRequireUppercase: true,
        passwordRequireLowercase: true,
        passwordRequireNumbers: true,
        passwordRequireSpecialChars: true,
        sessionDurationHours: 8,
        passwordExpiryDays: 90,
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 15
      });
    }
    return settings;
  }

  // Einheitliches Settings-DTO (vorher 3× identisch kopiert).
  private buildSettingsDTO(settings: SystemSettings) {
    return {
      companyName: settings.companyName,
      workingDays: settings.getParsedWorkingDays(),
      hoursPerWorkday: settings.hoursPerWorkday,
      emailNotifications: settings.emailNotifications,
      fiscalYearStart: settings.fiscalYearStart,
      bundesland: settings.bundesland,
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      companyEmail: settings.companyEmail,
      companyWebsite: settings.companyWebsite,
      publicUrl: settings.publicUrl,
      departments: settings.getParsedDepartments(),
      // Security settings
      passwordMinLength: settings.passwordMinLength,
      passwordRequireUppercase: settings.passwordRequireUppercase,
      passwordRequireLowercase: settings.passwordRequireLowercase,
      passwordRequireNumbers: settings.passwordRequireNumbers,
      passwordRequireSpecialChars: settings.passwordRequireSpecialChars,
      sessionDurationHours: settings.sessionDurationHours,
      passwordExpiryDays: settings.passwordExpiryDays,
      maxLoginAttempts: settings.maxLoginAttempts,
      lockoutDurationMinutes: settings.lockoutDurationMinutes,
      // Zeiterfassung
      breakMode: settings.breakMode,
      breakAfter6hMinutes: settings.breakAfter6hMinutes,
      breakAfter9hMinutes: settings.breakAfter9hMinutes,
      autoCapEnabled: settings.autoCapEnabled,
      autoCapTime: settings.autoCapTime,
      arbzgWarningsEnabled: settings.arbzgWarningsEnabled,
      arbzgMaxDailyMinutes: settings.arbzgMaxDailyMinutes,
      arbzgMinRestMinutes: settings.arbzgMinRestMinutes,
      gpsRequired: settings.gpsRequired,
      gpsMode: settings.gpsMode,
      // Aufbewahrung/Löschkonzept
      retentionMonthsEntries: settings.retentionMonthsEntries,
      retentionMonthsGps: settings.retentionMonthsGps,
      // Terminal-Überwachung (Störungs-Mail)
      terminalAlertEnabled: settings.terminalAlertEnabled,
      terminalAlertMinutes: settings.terminalAlertMinutes,
      terminalAlertEmails: settings.terminalAlertEmails,
      terminalPingSeconds: settings.terminalPingSeconds,
      // Stundenzettel-Versand beim Monatsabschluss
      sendTimesheetOnClose: settings.sendTimesheetOnClose,
      // Automatisches Backup-System (nur globale Vorlage relevant)
      autoBackupEnabled: settings.autoBackupEnabled,
      autoBackupTime: settings.autoBackupTime,
      backupRetentionDays: settings.backupRetentionDays,
      backupNotifyOnFailure: settings.backupNotifyOnFailure,
      // Periodische Berichts-Mails (firmen-scoped; reportLastSent bleibt intern)
      reportDailyEnabled: settings.reportDailyEnabled,
      reportMonthlyEnabled: settings.reportMonthlyEnabled,
      reportQuarterlyEnabled: settings.reportQuarterlyEnabled,
      reportYearlyEnabled: settings.reportYearlyEnabled,
      reportRecipients: settings.reportRecipients,
    };
  }

  // Ziel-Firma für Einstellungs-Operationen:
  // - Super-Admin → global (Vorlage) oder per ?companyId eine bestimmte Firma
  // - Firmen-Admin/Buchhaltung → eigene Firma
  // - Mandanten-Admin → per ?companyId gewählte Firma SEINES Tenants (validiert); die globale
  //   Vorlage (companyId=null) ist nur für Super-Admin editierbar.
  async resolveSettingsCompanyId(req: Request): Promise<number | null> {
    const u = req.user!;
    if (u.isSuperAdmin) {
      if (req.query.companyId) return Number(req.query.companyId);
      // Ein Super-Admin, der SELBST zu einer Firma gehört, verwaltet standardmäßig
      // die Einstellungen SEINER Firma — genau die Zeile, die Login und Stempeln zur
      // Laufzeit lesen (getOrCreateSettings(user.companyId)). Früher fiel er ohne
      // ?companyId auf die globale Vorlage (companyId=null) zurück; dort gesetzte
      // Werte (z. B. GPS-Pflicht, Session-Dauer) blieben für die eigenen Nutzer
      // wirkungslos. Die globale Vorlage / andere Firmen bleiben über den
      // Firmen-Wechsler (?companyId) bzw. für reine Plattform-Admins ohne Firma
      // (companyId=null) erreichbar. Instanzweite Felder (publicUrl, autoBackup)
      // landen unabhängig davon immer in der globalen Vorlage (siehe updateSettings).
      return u.companyId ?? null;
    }
    if (u.companyId) return u.companyId;
    if (u.tenantId) {
      const cid = req.query.companyId ? Number(req.query.companyId) : null;
      if (cid == null) throw new AppError(400, 'Bitte zuerst eine Firma im Kopf-Wechsler wählen.');
      if (!(await canManageCompanyRecord(getEffectiveActor(u), cid))) throw new AppError(403, 'Firma liegt außerhalb Ihres Mandanten');
      return cid;
    }
    return null;
  }

  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await this.getOrCreateSettings(await this.resolveSettingsCompanyId(req));
      const response = this.buildSettingsDTO(settings);
      // Instanzweite Felder immer aus der globalen Vorlage, unabhängig vom gewählten
      // Firmen-Kontext: publicUrl (tenant-übergreifend) und die autoBackup-Werte
      // (der Backup-Service liest nur die globale Zeile — sonst zeigt das Formular
      // veraltete Firmen-Klonwerte).
      const globalSettings = await this.getOrCreateSettings(null);
      response.publicUrl = globalSettings.publicUrl;
      response.autoBackupEnabled = globalSettings.autoBackupEnabled;
      response.autoBackupTime = globalSettings.autoBackupTime;
      response.backupRetentionDays = globalSettings.backupRetentionDays;
      response.backupNotifyOnFailure = globalSettings.backupNotifyOnFailure;
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await this.resolveSettingsCompanyId(req);
      const settings = await this.getOrCreateSettings(companyId);
      const previousBundesland = settings.bundesland;

      // Capture old values for audit log
      const oldValues = settings.toJSON();

      // Nur bekannte Felder übernehmen (kein Mass-Assignment von id/role/etc.).
      const ALLOWED_FIELDS = [
        'companyName', 'workingDays', 'hoursPerWorkday',
        'emailNotifications',
        'fiscalYearStart',
        'bundesland', 'companyAddress', 'companyPhone', 'companyEmail', 'companyWebsite',
        'departments', 'passwordMinLength', 'passwordRequireUppercase', 'passwordRequireLowercase',
        'passwordRequireNumbers', 'passwordRequireSpecialChars', 'sessionDurationHours',
        'passwordExpiryDays', 'maxLoginAttempts', 'lockoutDurationMinutes',
        // Zeiterfassung
        'breakMode', 'breakAfter6hMinutes', 'breakAfter9hMinutes',
        'autoCapEnabled', 'autoCapTime',
        'arbzgWarningsEnabled', 'arbzgMaxDailyMinutes', 'arbzgMinRestMinutes',
        'gpsRequired', 'gpsMode',
        // Aufbewahrung/Löschkonzept
        'retentionMonthsEntries', 'retentionMonthsGps',
        // Terminal-Überwachung
        'terminalAlertEnabled', 'terminalAlertMinutes', 'terminalAlertEmails', 'terminalPingSeconds',
        // Stundenzettel-Versand beim Monatsabschluss
        'sendTimesheetOnClose',
        // Automatisches Backup-System (nur globale Vorlage relevant)
        'autoBackupEnabled', 'autoBackupTime', 'backupRetentionDays', 'backupNotifyOnFailure',
        // Periodische Berichts-Mails (firmen-scoped)
        'reportDailyEnabled', 'reportMonthlyEnabled', 'reportQuarterlyEnabled', 'reportYearlyEnabled',
        'reportRecipients',
      ];
      const updateData: any = {};
      for (const key of ALLOWED_FIELDS) {
        if (key in req.body) updateData[key] = req.body[key];
      }
      // Aufbewahrungsfristen validieren: Zeitdaten mind. 24 Monate
      // (§ 16 Abs. 2 ArbZG — Nachweise mindestens zwei Jahre aufbewahren).
      if ('retentionMonthsEntries' in updateData) {
        const v = Number(updateData.retentionMonthsEntries);
        if (!Number.isInteger(v) || v < 24) {
          throw new AppError(400, 'retentionMonthsEntries muss eine ganze Zahl ≥ 24 sein (§ 16 ArbZG: mindestens 2 Jahre)');
        }
        updateData.retentionMonthsEntries = v;
      }
      if ('retentionMonthsGps' in updateData) {
        const v = Number(updateData.retentionMonthsGps);
        if (!Number.isInteger(v) || v < 1) {
          throw new AppError(400, 'retentionMonthsGps muss eine ganze Zahl ≥ 1 sein');
        }
        updateData.retentionMonthsGps = v;
      }
      if ('gpsMode' in updateData && !['off', 'optional', 'warn', 'required'].includes(String(updateData.gpsMode))) {
        throw new AppError(400, "gpsMode muss 'off', 'optional', 'warn' oder 'required' sein");
      }
      // Terminal-Überwachung validieren
      if ('terminalAlertEnabled' in updateData) updateData.terminalAlertEnabled = Boolean(updateData.terminalAlertEnabled);
      if ('sendTimesheetOnClose' in updateData) updateData.sendTimesheetOnClose = Boolean(updateData.sendTimesheetOnClose);
      if ('terminalAlertMinutes' in updateData) {
        const v = Number(updateData.terminalAlertMinutes);
        if (!Number.isInteger(v) || v < 2 || v > 1440) {
          throw new AppError(400, 'terminalAlertMinutes muss eine ganze Zahl zwischen 2 und 1440 sein');
        }
        updateData.terminalAlertMinutes = v;
      }
      if ('terminalPingSeconds' in updateData) {
        const v = Number(updateData.terminalPingSeconds);
        if (!Number.isInteger(v) || v < 5 || v > 600) {
          throw new AppError(400, 'terminalPingSeconds muss eine ganze Zahl zwischen 5 und 600 sein');
        }
        updateData.terminalPingSeconds = v;
      }
      if ('terminalAlertEmails' in updateData) {
        const raw = updateData.terminalAlertEmails;
        if (raw === null || raw === '') {
          updateData.terminalAlertEmails = null;
        } else {
          const list = String(raw).split(',').map((e: string) => e.trim()).filter(Boolean);
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (list.length === 0 || list.some((e: string) => !emailRe.test(e))) {
            throw new AppError(400, 'terminalAlertEmails muss eine Komma-Liste gültiger E-Mail-Adressen sein');
          }
          updateData.terminalAlertEmails = list.join(', ');
        }
      }
      // Periodische Berichts-Mails validieren (Toggles + Empfänger-Liste wie terminalAlertEmails).
      for (const f of ['reportDailyEnabled', 'reportMonthlyEnabled', 'reportQuarterlyEnabled', 'reportYearlyEnabled']) {
        if (f in updateData) updateData[f] = Boolean(updateData[f]);
      }
      if ('reportRecipients' in updateData) {
        const raw = updateData.reportRecipients;
        if (raw === null || raw === '') {
          updateData.reportRecipients = null;
        } else {
          const list = String(raw).split(',').map((e: string) => e.trim()).filter(Boolean);
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (list.length === 0 || list.some((e: string) => !emailRe.test(e))) {
            throw new AppError(400, 'reportRecipients muss eine Komma-Liste gültiger E-Mail-Adressen sein');
          }
          updateData.reportRecipients = list.join(', ');
        }
      }
      // Automatisches Backup-System validieren (Felder wirken nur über die globale Vorlage).
      if ('autoBackupEnabled' in updateData) updateData.autoBackupEnabled = Boolean(updateData.autoBackupEnabled);
      if ('backupNotifyOnFailure' in updateData) updateData.backupNotifyOnFailure = Boolean(updateData.backupNotifyOnFailure);
      if ('autoBackupTime' in updateData) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(updateData.autoBackupTime))) {
          throw new AppError(400, "autoBackupTime muss im Format 'HH:MM' vorliegen (z. B. '02:30')");
        }
        updateData.autoBackupTime = String(updateData.autoBackupTime);
      }
      if ('backupRetentionDays' in updateData) {
        const v = Number(updateData.backupRetentionDays);
        if (!Number.isInteger(v) || v < 7 || v > 3650) {
          throw new AppError(400, 'backupRetentionDays muss eine ganze Zahl zwischen 7 und 3650 sein');
        }
        updateData.backupRetentionDays = v;
      }
      if (Array.isArray(updateData.workingDays)) {
        updateData.workingDays = JSON.stringify(updateData.workingDays);
      }
      if (Array.isArray(updateData.departments)) {
        updateData.departments = JSON.stringify(updateData.departments);
      }
      // Sicherheits-/Passwortrichtlinien sind instanzweit (Tab „Sicherheit“) → nur Super-Admin.
      // Bei Nicht-Super-Admins werden diese Felder ignoriert (der allgemeine Save sendet sie ggf. mit).
      if (!req.user!.isSuperAdmin) {
        for (const f of ['passwordMinLength', 'passwordRequireUppercase', 'passwordRequireLowercase',
          'passwordRequireNumbers', 'passwordRequireSpecialChars', 'sessionDurationHours',
          'passwordExpiryDays', 'maxLoginAttempts', 'lockoutDurationMinutes']) {
          delete updateData[f];
        }
      }

      // Automatisches Backup ist INSTANZWEIT: Der Backup-Service liest ausschließlich
      // die globale Vorlage (getOrCreateSettings(null)). Diese Felder daher immer dort
      // speichern — sonst blieben sie wirkungslos, sobald der Scope eine Firma ist
      // (z. B. Super-Admin, der jetzt standardmäßig seine eigene Firma verwaltet).
      const BACKUP_FIELDS = ['autoBackupEnabled', 'autoBackupTime', 'backupRetentionDays', 'backupNotifyOnFailure'];
      const backupUpdate: any = {};
      for (const f of BACKUP_FIELDS) {
        if (f in updateData) {
          backupUpdate[f] = updateData[f];
          if (companyId !== null) delete updateData[f]; // nicht in die Firmen-Zeile schreiben
        }
      }

      await settings.update(updateData);

      if (Object.keys(backupUpdate).length && req.user!.isSuperAdmin) {
        const globalSettings = companyId === null ? settings : await this.getOrCreateSettings(null);
        if (globalSettings !== settings) await globalSettings.update(backupUpdate);
        // Geänderte Auto-Backup-Zeit/-Schalter sofort wirksam machen: Timer neu planen.
        // Dynamischer Import, um einen Zyklus autoBackupService ↔ settings.controller zu vermeiden.
        if ('autoBackupTime' in backupUpdate || 'autoBackupEnabled' in backupUpdate) {
          import('../services/autoBackupService')
            .then((m) => m.rescheduleAutoBackupJob())
            .catch(() => { /* Job läuft ggf. nicht (Tests) — unkritisch */ });
        }
      }

      // publicUrl ist INSTANZWEIT (tenant-übergreifend): immer in der globalen Vorlage
      // speichern (einmalig definiert, gilt für alle). Nur Super-Admin darf ihn ändern;
      // bei Nicht-Super-Admins wird das Feld ignoriert (kein Fehler – der allgemeine Save
      // sendet publicUrl immer mit, soll für Firmen-Admins aber funktionieren).
      if ('publicUrl' in req.body && req.user!.isSuperAdmin) {
        const globalSettings = await this.getOrCreateSettings(null);
        await globalSettings.update({ publicUrl: (typeof req.body.publicUrl === 'string' ? req.body.publicUrl.trim() : '') || null });
      }

      // Log the settings change
      await AuditService.logSettingsChange(
        req.user!.id,
        oldValues,
        settings.toJSON(),
        req
      );

      if (req.body.bundesland && req.body.bundesland !== previousBundesland) {
        const currentYear = new Date().getFullYear();
        try {
          await HolidayService.updateHolidaysForState(req.body.bundesland, currentYear, companyId);
          console.log(`Updated holidays for state: ${req.body.bundesland} (Firma ${companyId ?? 'global'})`);
        } catch (error) {
          console.error('Error updating holidays:', error);
        }
      }

      // Frisch nachladen, damit die Antwort garantiert alle persistierten Werte
      // (auch neu ergänzte Spalten wie publicUrl) widerspiegelt.
      const fresh = await this.getOrCreateSettings(companyId);
      const response = this.buildSettingsDTO(fresh);
      // Instanzweite Felder stets aus der globalen Vorlage zurückgeben (publicUrl +
      // autoBackup — dort werden sie auch gespeichert und vom Backup-Service gelesen).
      const freshGlobal = await this.getOrCreateSettings(null);
      response.publicUrl = freshGlobal.publicUrl;
      response.autoBackupEnabled = freshGlobal.autoBackupEnabled;
      response.autoBackupTime = freshGlobal.autoBackupTime;
      response.backupRetentionDays = freshGlobal.backupRetentionDays;
      response.backupNotifyOnFailure = freshGlobal.backupNotifyOnFailure;

      res.json({
        message: 'Settings updated successfully',
        settings: response
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const { year } = req.query;
      const targetYear = year ? parseInt(year as string) : new Date().getFullYear();

      const companyId = await this.resolveSettingsCompanyId(req);
      const settings = await this.getOrCreateSettings(companyId);
      const holidays = await HolidayService.updateHolidaysForState(
        settings.bundesland,
        targetYear,
        companyId
      );

      // Log the holiday refresh action
      await AuditService.logHolidayRefresh(
        req.user!.id,
        targetYear,
        holidays.length,
        req
      );

      res.json({
        message: `Successfully updated ${holidays.length} holidays for ${targetYear}`,
        holidays: holidays.map(h => ({
          name: h.name,
          date: h.startDate,
          description: h.description
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  async getSystemSettings(companyId: number | null = null) {
    const settings = await this.getOrCreateSettings(companyId);
    return this.buildSettingsDTO(settings);
  }
}