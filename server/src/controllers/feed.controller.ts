import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { User } from '../models/User';
import { Holiday } from '../models/Holiday';
import { getEffectiveActor, getAccessibleUserIds, getCompanyOrGlobalWhere } from '../services/accessScope';

/**
 * Zusatzinhalte für den Feed (gescopet): Arbeitsjubiläen, neue Kolleg:innen,
 * anstehende Feiertage.
 */
export async function getFeedExtras(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const in14 = new Date(now); in14.setDate(in14.getDate() + 14);
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
    const ago14 = new Date(now); ago14.setDate(ago14.getDate() - 14);
    const cy = now.getFullYear();

    const actor = getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId);
    const accessibleIds = await getAccessibleUserIds(actor);
    const userWhere: any = { isActive: true };
    if (accessibleIds !== null) userWhere.id = { [Op.in]: accessibleIds };
    const users = await User.findAll({ where: userWhere, attributes: ['id', 'firstName', 'lastName', 'entryDate'] });

    const anniversaries: any[] = [];
    const newJoiners: any[] = [];
    for (const u of users as any[]) {
      if (!u.entryDate) continue;
      const e = new Date(u.entryDate);
      e.setHours(0, 0, 0, 0);
      const name = `${u.firstName} ${u.lastName}`;
      // Neu im Team (Eintritt in den letzten 14 Tagen)
      if (e >= ago14 && e <= now) {
        newJoiners.push({ name, date: e.toISOString() });
      }
      // Arbeitsjubiläum (Jahrestag in den nächsten 14 Tagen, mind. 1 Jahr)
      const years = cy - e.getFullYear();
      if (years >= 1) {
        const ann = new Date(cy, e.getMonth(), e.getDate());
        ann.setHours(0, 0, 0, 0);
        if (ann >= now && ann <= in14) {
          anniversaries.push({ name, years, date: ann.toISOString() });
        }
      }
    }
    anniversaries.sort((a, b) => a.date.localeCompare(b.date));
    newJoiners.sort((a, b) => b.date.localeCompare(a.date));

    const hols = await Holiday.findAll({
      // nur globale + firmen-/mandanteneigene Feiertage
      where: { [Op.and]: [{ startDate: { [Op.between]: [now, in30] } }, getCompanyOrGlobalWhere(actor)] },
      attributes: ['id', 'name', 'startDate', 'endDate', 'type'],
      order: [['startDate', 'ASC']],
    });
    const upcomingHolidays = (hols as any[]).map((h) => ({
      name: h.name, startDate: h.startDate, endDate: h.endDate, type: h.type,
    }));

    res.json({ anniversaries, newJoiners, upcomingHolidays });
  } catch (e) {
    next(e);
  }
}
