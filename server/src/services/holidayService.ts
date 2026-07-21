import axios from 'axios';
import { Holiday } from '../models/Holiday';
import { Op } from 'sequelize';

interface FeiertageApiResponse {
  [key: string]: {
    datum: string;
    hinweis?: string;
  };
}

export class HolidayService {
  private static readonly API_BASE_URL = 'https://feiertage-api.de/api';
  // Gültige deutsche Bundesland-Kürzel (für die feiertage-api).
  private static readonly VALID_STATES = [
    'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI',
    'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH', 'NATIONAL',
  ];
  // Oster-/datumsabhängige Feiertage – verschieben sich jährlich, daher NICHT wiederkehrend.
  static readonly MOVABLE_HOLIDAYS = new Set<string>([
    'Gründonnerstag', 'Karfreitag', 'Ostersonntag', 'Ostermontag',
    'Christi Himmelfahrt', 'Pfingstsonntag', 'Pfingstmontag',
    'Fronleichnam', 'Buß- und Bettag',
  ]);

  static async fetchHolidaysForState(state: string, year: number, companyId: number | null = null): Promise<Holiday[]> {
    try {
      // Eingaben gegen feste Liste prüfen und URL-encodieren — verhindert
      // Query-Parameter-Injection in die externe API-URL.
      const safeState = this.VALID_STATES.includes(String(state).toUpperCase())
        ? String(state).toUpperCase()
        : 'NATIONAL';
      const safeYear = Number.parseInt(String(year), 10) || new Date().getFullYear();
      const response = await axios.get<FeiertageApiResponse>(
        `${this.API_BASE_URL}/?jahr=${encodeURIComponent(String(safeYear))}&nur_land=${encodeURIComponent(safeState)}`
      );

      const holidays: Holiday[] = [];
      
      for (const [name, data] of Object.entries(response.data)) {
        // Als LOKALE Mitternacht parsen (konsistent mit dayjs-Konvention; sonst UTC-Off-by-one).
        const holidayDate = new Date(data.datum + 'T00:00:00');
        const holiday = await Holiday.findOrCreate({
          where: {
            name,
            startDate: holidayDate,
            companyId: companyId ?? null,
          },
          defaults: {
            name,
            startDate: holidayDate,
            endDate: holidayDate,
            type: 'national',
            companyId: companyId ?? null,
            // Bewegliche (oster-/datumsabhängige) Feiertage NICHT als wiederkehrend
            // markieren – sonst würden sie per Monat+Tag falsch in andere Jahre projiziert.
            isRecurring: !HolidayService.MOVABLE_HOLIDAYS.has(name),
            description: data.hinweis || `Gesetzlicher Feiertag in ${this.getStateName(state)}`
          }
        });
        
        holidays.push(holiday[0]);
      }

      return holidays;
    } catch (error) {
      console.error(`Error fetching holidays for state ${state}:`, error);
      throw error;
    }
  }

  static async updateHolidaysForState(state: string, year: number, companyId: number | null = null): Promise<Holiday[]> {
    // Nur die automatisch erzeugten gesetzlichen Feiertage DIESER Firma im betreffenden
    // Jahr ersetzen (firmenspezifische freie Tage type 'company' und andere Firmen bleiben unberührt).
    await Holiday.destroy({
      where: {
        companyId: companyId ?? null,
        type: 'national',
        startDate: { [Op.gte]: new Date(year, 0, 1), [Op.lte]: new Date(year, 11, 31, 23, 59, 59) },
      },
    });

    return await this.fetchHolidaysForState(state, year, companyId);
  }

  static async getHolidaysForDateRange(startDate: Date, endDate: Date, companyId: number | null = null): Promise<Holiday[]> {
    // Standard-Overlap-Prädikat: deckt auch Feiertage ab, die den
    // Zeitraum vollständig umschließen (Beginn vor Bereich, Ende nach Bereich).
    // Firmen-Kontext: globale Feiertage (companyId null) + die der eigenen Firma.
    const where: any = {
      startDate: { [Op.lte]: endDate },
      endDate: { [Op.gte]: startDate },
    };
    if (companyId) where[Op.or] = [{ companyId: null }, { companyId }];
    const direct = await Holiday.findAll({ where, order: [['startDate', 'ASC']] });

    // Wiederkehrende gesetzliche Feiertage zusätzlich in die betroffenen Jahre projizieren
    // (wie holiday.controller.getAllHolidays für den Kalender). Sonst erkennt die
    // Zeitberechnung Feiertage in Jahren nicht, für die noch keine API-Zeile existiert,
    // und schreibt dort fälschlich volles Soll/Minus-Saldo.
    const recWhere: any = { isRecurring: true };
    if (companyId) recWhere[Op.or] = [{ companyId: null }, { companyId }];
    const recurring = await Holiday.findAll({ where: recWhere });

    const have = new Set(direct.map((h) => `${this.ymd(h.startDate)}|${h.name}|${h.companyId ?? ''}`));
    const projected: Holiday[] = [];
    const startY = startDate.getFullYear();
    const endY = endDate.getFullYear();
    for (const h of recurring) {
      // Bewegliche (oster-/datumsabhängige) Feiertage NIE per Monat+Tag projizieren.
      if (HolidayService.MOVABLE_HOLIDAYS.has(h.name)) continue;
      for (let y = startY; y <= endY; y++) {
        const s = new Date(h.startDate); s.setFullYear(y);
        const e = new Date(h.endDate); e.setFullYear(y);
        if (s > endDate || e < startDate) continue; // projizierte Instanz nicht im Bereich
        const key = `${this.ymd(s)}|${h.name}|${h.companyId ?? ''}`;
        if (have.has(key)) continue; // physische Zeile existiert schon
        have.add(key);
        projected.push(Holiday.build({
          name: h.name, startDate: s, endDate: e,
          type: (h as any).type, companyId: h.companyId ?? null, isRecurring: true,
        }));
      }
    }

    const all = projected.length ? [...direct, ...projected] : direct;
    all.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return all;
  }

  // Lokales YYYY-MM-DD (ohne UTC-Shift) für robuste Tagesvergleiche.
  private static ymd(d: Date): string {
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  static isWorkingDay(date: Date, holidays: Holiday[], workingDays: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']): boolean {
    const dayOfWeek = date.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    if (!workingDays.includes(dayName)) {
      return false;
    }

    // Vergleich auf Tagesebene (lokale YMD), unabhängig von Uhrzeit/Zeitzone.
    // Nur GESETZLICHE Feiertage (type 'national') zählen hier als arbeitsfrei.
    const dateStr = this.ymd(date);
    const isHoliday = holidays.some(holiday => {
      if ((holiday as any).type === 'company') return false;
      const s = this.ymd(holiday.startDate);
      const e = this.ymd(holiday.endDate);
      return dateStr >= s && dateStr <= e;
    });

    return !isHoliday;
  }

  static calculateWorkingDays(startDate: Date, endDate: Date, holidays: Holiday[], workingDays: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']): number {
    let workingDayCount = 0;
    // Auf lokale Tagesgrenze normalisieren, damit Uhrzeit-Komponenten die
    // Schleifengrenzen nicht verschieben (Off-by-one).
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (currentDate <= end) {
      if (this.isWorkingDay(currentDate, holidays, workingDays)) {
        workingDayCount++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return workingDayCount;
  }

  private static getStateName(stateCode: string): string {
    const stateNames: { [key: string]: string } = {
      'BW': 'Baden-Württemberg',
      'BY': 'Bayern',
      'BE': 'Berlin',
      'BB': 'Brandenburg',
      'HB': 'Bremen',
      'HH': 'Hamburg',
      'HE': 'Hessen',
      'MV': 'Mecklenburg-Vorpommern',
      'NI': 'Niedersachsen',
      'NW': 'Nordrhein-Westfalen',
      'RP': 'Rheinland-Pfalz',
      'SL': 'Saarland',
      'SN': 'Sachsen',
      'ST': 'Sachsen-Anhalt',
      'SH': 'Schleswig-Holstein',
      'TH': 'Thüringen'
    };

    return stateNames[stateCode] || stateCode;
  }
}