import { Op } from 'sequelize';
import { MonthClosure } from '../models/MonthClosure';
import { WorkDay } from '../models/WorkDay';

/**
 * monthLockService — zentrale Sperr-Prüfungen für abgeschlossene Monate.
 *
 * Ein Tag ist gesperrt, wenn
 *  a) sein Monat per MonthClosure abgeschlossen ist (Einzelabschluss des Users
 *     ODER Firmenabschluss userId=NULL seiner Firma), oder
 *  b) der zugehörige WorkDay den Status 'locked' trägt.
 * Verwendet von Nachbuchen/Storno/Korrekturanträgen (beide Prüfungen) und dem
 * Stempel-Pfad (nur Closure-Prüfung — normale Stempel heute bleiben unberührt).
 */

/** 'YYYY-MM' eines lokalen Datums 'YYYY-MM-DD'. */
export const monthOf = (date: string): string => date.slice(0, 7);

/**
 * Letzter Kalendertag eines Monats als 'YYYY-MM-DD'. WICHTIG für DATEONLY-
 * Range-Queries: ein pauschales '…-31' würde bei kürzeren Monaten von Sequelize
 * zu 'Invalid date' stringifiziert und der Filter liefe ins Leere.
 */
export function monthEndDate(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** Ist der Monat für diesen User abgeschlossen (eigener oder Firmen-Abschluss)? */
export async function isMonthClosed(userId: number, companyId: number | null, month: string): Promise<boolean> {
  const or: any[] = [{ userId }];
  if (companyId != null) or.push({ companyId, userId: null });
  const closure = await MonthClosure.findOne({ where: { month, [Op.or]: or }, attributes: ['id'] });
  return !!closure;
}

/** Tag gesperrt = Monat abgeschlossen ODER WorkDay 'locked'. */
export async function isDayLocked(userId: number, companyId: number | null, date: string): Promise<boolean> {
  if (await isMonthClosed(userId, companyId, monthOf(date))) return true;
  const wd = await WorkDay.findOne({ where: { userId, date }, attributes: ['id', 'status'] });
  return wd?.status === 'locked';
}

export const MONTH_LOCKED_RESPONSE = {
  error: 'MONTH_LOCKED',
  code: 'MONTH_LOCKED',
  message: 'Der Monat ist abgeschlossen — Änderungen sind nur nach Wiedereröffnung möglich.',
};
