import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import dayjs from 'dayjs';
import { Holiday } from '../models/Holiday';
import { moveToTrash } from '../services/trashService';
import { AppError } from '../middleware/errorHandler';
import { getEffectiveActor, getCompanyOrGlobalWhere, canReadCompanyRecord, canManageCompanyRecord, resolveWritableCompanyId } from '../services/accessScope';
import { Company } from '../models/Company';
import { HolidayService } from '../services/holidayService';

export class HolidayController {
  constructor() {
    // Methoden an die Instanz binden, damit sie als Express-Handler ohne
    // .bind() im Router korrekt auf `this` zugreifen.
    const proto = Object.getPrototypeOf(this);
    for (const name of Object.getOwnPropertyNames(proto)) {
      const fn = (this as any)[name];
      if (name !== 'constructor' && typeof fn === 'function') {
        (this as any)[name] = fn.bind(this);
      }
    }
  }

  async getAllHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const { year } = req.query;
      const currentYear = year ? Number(year) : dayjs().year();

      // Get all holidays (including recurring ones from other years).
      // Globale Feiertage (companyId null) + Feiertage der eigenen Firma.
      const baseHolidays = await Holiday.findAll({
        where: getCompanyOrGlobalWhere(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId)),
        order: [['startDate', 'ASC']],
      });

      const holidays: any[] = [];

      baseHolidays.forEach(holiday => {
        const holidayYear = dayjs(holiday.startDate).year();

        // Bewegliche Feiertage NIE per Monat+Tag projizieren (verschieben sich jährlich) –
        // wie nicht-wiederkehrend behandeln, egal welcher Flag gespeichert ist.
        const isProjectable = holiday.isRecurring && !HolidayService.MOVABLE_HOLIDAYS.has(holiday.name);
        if (!isProjectable) {
          // Nur im tatsächlichen Jahr anzeigen.
          if (!year || holidayYear === currentYear) {
            holidays.push(holiday.toJSON());
          }
        } else {
          // Recurring holidays: generate instance for the requested year
          if (year) {
            // Generate for specific year
            const originalDate = dayjs(holiday.startDate);
            const newDate = originalDate.year(currentYear);

            holidays.push({
              ...holiday.toJSON(),
              id: `${holiday.id}-${currentYear}`, // Unique ID for the virtual instance
              startDate: newDate.toDate(),
              endDate: dayjs(holiday.endDate).year(currentYear).toDate(),
              isVirtualRecurring: true,
              originalId: holiday.id
            });
          } else {
            // No year filter: show original and current year instance
            holidays.push(holiday.toJSON());

            if (holidayYear !== currentYear) {
              const originalDate = dayjs(holiday.startDate);
              const newDate = originalDate.year(currentYear);

              holidays.push({
                ...holiday.toJSON(),
                id: `${holiday.id}-${currentYear}`,
                startDate: newDate.toDate(),
                endDate: dayjs(holiday.endDate).year(currentYear).toDate(),
                isVirtualRecurring: true,
                originalId: holiday.id
              });
            }
          }
        }
      });

      // Sort by date
      holidays.sort((a, b) => dayjs(a.startDate).unix() - dayjs(b.startDate).unix());

      res.json({ holidays });
    } catch (error) {
      next(error);
    }
  }

  async getHolidayById(req: Request, res: Response, next: NextFunction) {
    try {
      const holiday = await Holiday.findByPk(req.params.id);

      if (!holiday || !(await canReadCompanyRecord(req.user!, (holiday as any).companyId))) {
        return next(new AppError(404, 'Holiday not found'));
      }

      res.json({ holiday });
    } catch (error) {
      next(error);
    }
  }

  async createHoliday(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        name,
        date,
        startDate,
        endDate,
        type,
        isRecurring,
        description,
      } = req.body;

      // Handle both date formats: single date or start/end dates
      let start: dayjs.Dayjs;
      let end: dayjs.Dayjs;

      if (date) {
        // Single date format from frontend
        start = dayjs(date);
        end = dayjs(date);
      } else if (startDate && endDate) {
        // Range format
        start = dayjs(startDate);
        end = dayjs(endDate);
      } else if (startDate) {
        // Single start date
        start = dayjs(startDate);
        end = dayjs(startDate);
      } else {
        return next(new AppError(400, 'Date is required'));
      }

      if (end.isBefore(start)) {
        return next(new AppError(400, 'End date must be after start date'));
      }

      // Firmenspezifisch (keine globalen Feiertage im Mandantenbetrieb):
      // Firmen-Admin → eigene Firma; Mandanten-Admin → gewählte/erste Firma SEINES Tenants;
      // Super-Admin → body.companyId oder erste Firma.
      let companyId = await resolveWritableCompanyId(req.user!, req.body.companyId);
      if (companyId == null && req.user!.tenantId && !req.user!.isSuperAdmin) {
        // Mandanten-Admin: erste Firma SEINES Tenants – niemals eine fremde.
        companyId = (await Company.findOne({ where: { tenantId: req.user!.tenantId }, order: [['id', 'ASC']] }))?.id ?? null;
        if (companyId == null) return next(new AppError(400, 'Ihrem Mandanten ist noch keine Firma zugeordnet.'));
      }
      // Default-Firma nur für Super-Admin / globalen Admin ohne Firmenwahl.
      if (companyId == null && (req.user!.isSuperAdmin || (!req.user!.companyId && !req.user!.tenantId))) {
        companyId = (await Company.findOne({ order: [['id', 'ASC']] }))?.id ?? null;
      }
      const holiday = await Holiday.create({
        name,
        startDate: start.toDate(),
        endDate: end.toDate(),
        type: type || 'company',
        isRecurring: isRecurring || false,
        description,
        companyId,
      });

      res.status(201).json({
        message: 'Holiday created successfully',
        holiday
      });
    } catch (error) {
      next(error);
    }
  }

  async updateHoliday(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const holiday = await Holiday.findByPk(req.params.id);
      if (!holiday || !(await canManageCompanyRecord(req.user!, (holiday as any).companyId))) {
        return next(new AppError(404, 'Holiday not found'));
      }

      const {
        name,
        date,
        startDate,
        endDate,
        type,
        isRecurring,
        description,
      } = req.body;

      if (name) holiday.name = name;
      if (description !== undefined) holiday.description = description;
      if (type !== undefined) holiday.type = type;
      if (isRecurring !== undefined) holiday.isRecurring = isRecurring;

      // Handle both date formats: single date or start/end dates
      if (date || startDate) {
        let start: dayjs.Dayjs;
        let end: dayjs.Dayjs;

        if (date) {
          // Single date format from frontend
          start = dayjs(date);
          end = dayjs(date);
        } else if (startDate && endDate) {
          // Range format
          start = dayjs(startDate);
          end = dayjs(endDate);
        } else {
          // Single start date
          start = dayjs(startDate);
          end = dayjs(startDate);
        }

        if (end.isBefore(start)) {
          return next(new AppError(400, 'End date must be after start date'));
        }

        holiday.startDate = start.toDate();
        holiday.endDate = end.toDate();
      }

      await holiday.save();

      res.json({
        message: 'Holiday updated successfully',
        holiday
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteHoliday(req: Request, res: Response, next: NextFunction) {
    try {
      const holiday = await Holiday.findByPk(req.params.id);
      if (!holiday || !(await canManageCompanyRecord(req.user!, (holiday as any).companyId))) {
        return next(new AppError(404, 'Holiday not found'));
      }

      await moveToTrash('Holiday', holiday, holiday.name, req.user!.id);
      await holiday.destroy();

      res.json({ message: 'Holiday deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
}
