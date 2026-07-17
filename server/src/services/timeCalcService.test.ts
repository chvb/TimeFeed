import { sequelize } from '../db/database';
import { User, TimeModel, TimeEntry, WorkDay, Holiday, SystemSettings } from '../models';
import { UserRole } from '../models/User';
import { SettingsController } from '../controllers/settings.controller';
import {
  calcWorkDay,
  pairShifts,
  statutoryBreakMinutes,
  applyRounding,
  targetMinutesForDay,
} from './timeCalcService';

// Fester Testtag in der Vergangenheit (Montag), damit der Status-Sonderfall
// „heute noch offen = open" nicht greift und keine Feiertage kollidieren.
const DAY = '2026-06-15'; // Montag
const NEXT = '2026-06-16';

const at = (date: string, h: number, m = 0): Date => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
};

let settings: SystemSettings;
let userSeq = 0;

async function createUser(overrides: Partial<Parameters<typeof User.create>[0]> = {}): Promise<User> {
  userSeq += 1;
  return User.create({
    email: `test${userSeq}@timefeed.de`,
    password: 'Test1234!',
    firstName: 'Test',
    lastName: `User${userSeq}`,
    role: UserRole.MITARBEITER,
    isActive: true,
    startDate: new Date('2025-01-01'),
    ...(overrides as any),
  });
}

async function stamp(userId: number, type: 'in' | 'out' | 'break_start' | 'break_end', ts: Date, extra: any = {}) {
  return TimeEntry.create({ userId, type, timestamp: ts, source: 'web', lat: 52.5, lng: 13.4, ...extra });
}

async function setSettings(patch: Partial<SystemSettings> & Record<string, any>) {
  await settings.update(patch);
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
  settings = await new SettingsController().getOrCreateSettings(null);
});

afterAll(async () => {
  await sequelize.close();
});

beforeEach(async () => {
  // Defaults für jeden Test; einzelne Tests überschreiben gezielt.
  await setSettings({
    breakMode: 'auto',
    breakAfter6hMinutes: 30,
    breakAfter9hMinutes: 45,
    arbzgWarningsEnabled: true,
    arbzgMaxDailyMinutes: 600,
    arbzgMinRestMinutes: 660,
    gpsRequired: false,
  });
});

// ---------------------------------------------------------------------------
// Pure Helfer
// ---------------------------------------------------------------------------

describe('statutoryBreakMinutes', () => {
  const cfg = { breakMode: 'auto', breakAfter6hMinutes: 30, breakAfter9hMinutes: 45 };

  it('unter/exakt 6h: keine Pause; knapp darüber: 30; über 9h: 45', () => {
    expect(statutoryBreakMinutes(359, cfg)).toBe(0);
    expect(statutoryBreakMinutes(360, cfg)).toBe(0); // exakt 6h → noch keine Pflicht
    expect(statutoryBreakMinutes(361, cfg)).toBe(30);
    expect(statutoryBreakMinutes(540, cfg)).toBe(30); // exakt 9h → 30
    expect(statutoryBreakMinutes(541, cfg)).toBe(45);
  });
});

describe('applyRounding', () => {
  it('rundet die Tagessumme nach Modus/Raster', () => {
    expect(applyRounding(427, 'none', 15)).toBe(427);
    expect(applyRounding(427, 'up', 15)).toBe(435);
    expect(applyRounding(427, 'down', 15)).toBe(420);
    expect(applyRounding(427, 'nearest', 15)).toBe(420);
    expect(applyRounding(428, 'nearest', 15)).toBe(435);
    expect(applyRounding(427, 'nearest', 0)).toBe(427); // Raster 0 = keine Rundung
  });
});

describe('pairShifts', () => {
  it('paart in/out und Pausen in zeitlicher Reihenfolge', () => {
    const shifts = pairShifts([
      { type: 'in', timestamp: at(DAY, 8) },
      { type: 'break_start', timestamp: at(DAY, 12) },
      { type: 'break_end', timestamp: at(DAY, 12, 30) },
      { type: 'out', timestamp: at(DAY, 17) },
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].outAt).toEqual(at(DAY, 17));
    expect(shifts[0].stampedBreakMinutes).toBe(30);
  });

  it('ignoriert verwaiste out/break-Stempel', () => {
    const shifts = pairShifts([
      { type: 'out', timestamp: at(DAY, 7) },
      { type: 'break_end', timestamp: at(DAY, 7, 30) },
      { type: 'in', timestamp: at(DAY, 8) },
      { type: 'out', timestamp: at(DAY, 12) },
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].inAt).toEqual(at(DAY, 8));
  });
});

// ---------------------------------------------------------------------------
// calcWorkDay — Pausenmodi
// ---------------------------------------------------------------------------

describe('calcWorkDay: auto-Pause an den 6h/9h-Schwellen', () => {
  it('exakt 6h → keine Auto-Pause', async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'out', at(DAY, 14));
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.workedMinutes).toBe(360);
    expect(wd.autoBreakMinutes).toBe(0);
  });

  it('6h + 1min → 30min Auto-Pause', async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'out', at(DAY, 14, 1));
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.autoBreakMinutes).toBe(30);
    expect(wd.workedMinutes).toBe(331);
  });

  it('über 9h → 45min Auto-Pause; gestempelte Pausen werden ignoriert', async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'break_start', at(DAY, 12));
    await stamp(u.id, 'break_end', at(DAY, 12, 20));
    await stamp(u.id, 'out', at(DAY, 17, 1)); // 541 min brutto
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.autoBreakMinutes).toBe(45);
    expect(wd.workedMinutes).toBe(541 - 45);
    expect(wd.breakMinutes).toBe(20); // informativ erfasst, aber nicht abgezogen
  });

  it('gestempelte Pause LÄNGER als die gesetzliche → die längere wird abgezogen (keine Gutschrift von Pausenzeit)', async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'break_start', at(DAY, 12));
    await stamp(u.id, 'break_end', at(DAY, 13)); // 60 min gestempelt
    await stamp(u.id, 'out', at(DAY, 17));       // 540 min brutto (9h) → gesetzlich 30
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.autoBreakMinutes).toBe(60);        // max(30, 60)
    expect(wd.workedMinutes).toBe(480);          // 540 − 60 (nicht 510)
  });
});

describe('calcWorkDay: manual-Modus', () => {
  it('zieht nur gestempelte Pausen ab', async () => {
    await setSettings({ breakMode: 'manual' });
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'break_start', at(DAY, 12));
    await stamp(u.id, 'break_end', at(DAY, 12, 20));
    await stamp(u.id, 'out', at(DAY, 17)); // 540 brutto
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.breakMinutes).toBe(20);
    expect(wd.autoBreakMinutes).toBe(0);
    expect(wd.workedMinutes).toBe(520);
  });
});

describe('calcWorkDay: combined-Modus (gestempelt < Mindestpause)', () => {
  it('füllt die Differenz zur gesetzlichen Mindestpause auf', async () => {
    await setSettings({ breakMode: 'combined' });
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'break_start', at(DAY, 12));
    await stamp(u.id, 'break_end', at(DAY, 12, 15));
    await stamp(u.id, 'out', at(DAY, 16)); // 480 brutto, 15 gestempelt → Basis 465 > 6h
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.breakMinutes).toBe(15);
    expect(wd.autoBreakMinutes).toBe(15); // 30 − 15
    expect(wd.workedMinutes).toBe(450);
  });

  it('genügend gestempelte Pause → kein Zusatzabzug', async () => {
    await setSettings({ breakMode: 'combined' });
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'break_start', at(DAY, 12));
    await stamp(u.id, 'break_end', at(DAY, 12, 45));
    await stamp(u.id, 'out', at(DAY, 17));
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.autoBreakMinutes).toBe(0);
    expect(wd.workedMinutes).toBe(540 - 45);
  });
});

// ---------------------------------------------------------------------------
// Nachtschicht
// ---------------------------------------------------------------------------

describe('calcWorkDay: Nachtschicht über Mitternacht', () => {
  it("rechnet das 'out' nach Mitternacht dem Tag des 'in' zu", async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 22));
    await stamp(u.id, 'out', at(NEXT, 6)); // 480 min brutto
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.workedMinutes).toBe(480 - 30); // auto-Pause > 6h
    expect(wd.status).toBe('ok');
    expect(wd.lastOut).toEqual(at(NEXT, 6));

    // Der Folgetag bekommt die Schicht NICHT noch einmal.
    const wd2 = (await calcWorkDay(u.id, NEXT))!;
    expect(wd2.workedMinutes).toBe(0);
    expect(wd2.status).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// Rundung nach Zeitmodell
// ---------------------------------------------------------------------------

describe('calcWorkDay: Rundung nach TimeModel', () => {
  it('rundet die Tagessumme (nearest/15)', async () => {
    await setSettings({ breakMode: 'manual' });
    const tm = await TimeModel.create({ name: 'Standard 15er', roundingMode: 'nearest', roundingMinutes: 15 });
    const u = await createUser({ timeModelId: tm.id });
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'out', at(DAY, 15, 7)); // 427 min
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.workedMinutes).toBe(420);
  });
});

// ---------------------------------------------------------------------------
// Unvollständiger Tag / ArbZG / Sollzeit
// ---------------------------------------------------------------------------

describe("calcWorkDay: fehlendes 'out'", () => {
  it("setzt status 'incomplete' für Vortage", async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 8));
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.status).toBe('incomplete');
    expect(wd.workedMinutes).toBe(0);
    expect(wd.firstIn).toEqual(at(DAY, 8));
  });
});

describe('calcWorkDay: ArbZG-Flags', () => {
  it('markiert > 10h Arbeitszeit', async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 7));
    await stamp(u.id, 'out', at(DAY, 18)); // 660 brutto − 45 = 615 > 600
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.flags).toContain('arbzg_over_10h');
    expect(wd.status).toBe('flagged');
  });

  it('markiert Ruhezeit-Verstoß (lastOut Vortag → firstIn < 11h)', async () => {
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 13));
    await stamp(u.id, 'out', at(DAY, 22));
    await calcWorkDay(u.id, DAY);
    await stamp(u.id, 'in', at(NEXT, 6)); // Ruhezeit nur 8h
    await stamp(u.id, 'out', at(NEXT, 12));
    const wd2 = (await calcWorkDay(u.id, NEXT))!;
    expect(wd2.flags).toContain('arbzg_rest_violation');
  });

  it('keine Flags, wenn arbzgWarningsEnabled=false', async () => {
    await setSettings({ arbzgWarningsEnabled: false });
    const u = await createUser();
    await stamp(u.id, 'in', at(DAY, 7));
    await stamp(u.id, 'out', at(DAY, 19));
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.flags).not.toContain('arbzg_over_10h');
  });
});

describe('Sollzeit: employmentFactor & Zeitmodell', () => {
  it('multipliziert die Wochentagsminuten des Zeitmodells mit dem Beschäftigungsgrad', async () => {
    const tm = await TimeModel.create({ name: 'Vollzeit', monMinutes: 480 });
    const u = await createUser({ timeModelId: tm.id, employmentFactor: 0.5 });
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'out', at(DAY, 12));
    const wd = (await calcWorkDay(u.id, DAY))!; // Montag
    expect(wd.targetMinutes).toBe(240);
    expect(wd.balanceMinutes).toBe(240 - 240); // 240 gearbeitet (4h, keine Pausenpflicht)
  });

  it('Fallback ohne Zeitmodell: SystemSettings (workingDays/hoursPerWorkday)', () => {
    const fakeSettings = {
      hoursPerWorkday: 8,
      getParsedWorkingDays: () => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    };
    const target = targetMinutesForDay(DAY, null, { employmentFactor: 1 } as any, fakeSettings as any);
    expect(target).toBe(480);
    const sunday = targetMinutesForDay('2026-06-14', null, { employmentFactor: 1 } as any, fakeSettings as any);
    expect(sunday).toBe(0);
  });
});

describe('calcWorkDay: Feiertag = Sollzeit-Gutschrift', () => {
  it("setzt absence='holiday', target=0 und Flag 'target_credited'", async () => {
    const u = await createUser();
    await Holiday.create({
      name: 'Testfeiertag',
      startDate: at(DAY, 0),
      endDate: at(DAY, 0),
      type: 'national',
      isRecurring: false,
    });
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.absence).toBe('holiday');
    expect(wd.targetMinutes).toBe(0);
    expect(wd.flags).toContain('target_credited');
    expect(wd.balanceMinutes).toBe(0);
    await Holiday.destroy({ where: { name: 'Testfeiertag' } });
  });
});

describe('calcWorkDay: approved/locked werden nie überschrieben', () => {
  it('lässt einen approved-Tag unangetastet', async () => {
    const u = await createUser();
    await WorkDay.create({ userId: u.id, date: DAY, workedMinutes: 123, targetMinutes: 480, status: 'approved' });
    await stamp(u.id, 'in', at(DAY, 8));
    await stamp(u.id, 'out', at(DAY, 16));
    const wd = (await calcWorkDay(u.id, DAY))!;
    expect(wd.status).toBe('approved');
    expect(wd.workedMinutes).toBe(123);
  });
});

describe('TimeEntry: unveränderliches Journal', () => {
  it('verbietet nachträgliche Änderung von Buchungswerten', async () => {
    const u = await createUser();
    const e = await stamp(u.id, 'in', at(DAY, 8));
    await expect(e.update({ timestamp: at(DAY, 9) } as any)).rejects.toThrow(/unveränderlich/);
    // Storno-Metadaten sind erlaubt (frisch geladene Instanz, ohne den verworfenen Änderungsversuch):
    const fresh = (await TimeEntry.findByPk(e.id))!;
    await expect(fresh.update({ isCancelled: true, cancelReason: 'Test' } as any)).resolves.toBeTruthy();
  });
});
