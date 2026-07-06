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
    };
  }

  // Ziel-Firma für Einstellungs-Operationen:
  // - Super-Admin → global (Vorlage) oder per ?companyId eine bestimmte Firma
  // - Firmen-Admin/Buchhaltung → eigene Firma
  // - Mandanten-Admin → per ?companyId gewählte Firma SEINES Tenants (validiert); die globale
  //   Vorlage (companyId=null) ist nur für Super-Admin editierbar.
  async resolveSettingsCompanyId(req: Request): Promise<number | null> {
    const u = req.user!;
    if (u.isSuperAdmin) return req.query.companyId ? Number(req.query.companyId) : null;
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
      // publicUrl ist instanzweit (tenant-übergreifend) → immer aus der globalen Vorlage,
      // unabhängig vom gewählten Firmen-Kontext.
      const globalSettings = await this.getOrCreateSettings(null);
      response.publicUrl = globalSettings.publicUrl;
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
        'gpsRequired',
      ];
      const updateData: any = {};
      for (const key of ALLOWED_FIELDS) {
        if (key in req.body) updateData[key] = req.body[key];
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

      await settings.update(updateData);

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
      // publicUrl stets aus der globalen Vorlage (instanzweit) zurückgeben.
      const freshGlobal = await this.getOrCreateSettings(null);
      response.publicUrl = freshGlobal.publicUrl;

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