import crypto from 'crypto';
import { User, UserRole } from '../models/User';
import { Group } from '../models/Group';
import { Company } from '../models/Company';
import { Tenant } from '../models/Tenant';

// Seed-Passwort aus Env oder zufällig (kein bekanntes Default wie 'admin123').
const seedPw = (envKey: string): string =>
  process.env[envKey] || crypto.randomBytes(9).toString('base64url');

export const seedDatabase = async () => {
  console.log('Seeding database...');

  const adminPw = seedPw('SEED_ADMIN_PASSWORD');
  const buchhaltungPw = seedPw('SEED_BUCHHALTUNG_PASSWORD');
  const verwaltungPw = seedPw('SEED_VERWALTUNG_PASSWORD');
  const mitarbeiterPw = seedPw('SEED_MITARBEITER_PASSWORD');

  try {
    // Demo-Mandant/-Firma: von der Bestandsmigration angelegt oder hier erzeugen.
    // Alle Demo-User MÜSSEN einer Firma zugeordnet sein, sonst greifen die
    // firmen-gescopten Rechte (Terminals, Zeitmodelle, Settings) nicht.
    let company = await Company.findOne();
    if (!company) {
      const tenant = (await Tenant.findOne()) || (await Tenant.create({ name: 'Hauptmandant', isActive: true }));
      company = await Company.create({ name: 'Hauptfirma', tenantId: tenant.id, isActive: true });
    }
    const companyId = company.id;

    const adminGroup = await Group.create({
      name: 'Administration',
      description: 'Administratoren und Buchhaltung',
      companyId,
    });

    const developmentGroup = await Group.create({
      name: 'Entwicklung',
      description: 'Entwicklerteam',
      companyId,
    });

    await Group.create({
      name: 'Marketing',
      description: 'Marketing und Vertrieb',
      companyId,
    });

    await User.create({
      email: 'admin@timefeed.de',
      password: adminPw,
      firstName: 'Max',
      lastName: 'Mustermann',
      role: UserRole.ADMIN,
      groupId: adminGroup.id,
      companyId,
      isSuperAdmin: true,
      isActive: true,
      startDate: new Date(),
    });

    await User.create({
      email: 'buchhaltung@timefeed.de',
      password: buchhaltungPw,
      firstName: 'Anna',
      lastName: 'Schmidt',
      role: UserRole.BUCHHALTUNG,
      groupId: adminGroup.id,
      companyId,
      isActive: true,
      startDate: new Date(),
    });

    const verwaltungUser = await User.create({
      email: 'verwaltung@timefeed.de',
      password: verwaltungPw,
      firstName: 'Thomas',
      lastName: 'Müller',
      role: UserRole.VERWALTUNG,
      groupId: developmentGroup.id,
      companyId,
      isActive: true,
      startDate: new Date(),
    });

    await User.create({
      email: 'mitarbeiter@timefeed.de',
      password: mitarbeiterPw,
      firstName: 'Lisa',
      lastName: 'Weber',
      role: UserRole.MITARBEITER,
      groupId: developmentGroup.id,
      companyId,
      isActive: true,
      startDate: new Date(),
    });

    developmentGroup.managerId = verwaltungUser.id;
    await developmentGroup.save();

    console.log('Database seeded successfully!');
    console.log('Demo users (Passwörter einmalig — bitte notieren/ändern):');
    console.log(`Admin: admin@timefeed.de / ${adminPw}`);
    console.log(`Buchhaltung: buchhaltung@timefeed.de / ${buchhaltungPw}`);
    console.log(`Verwaltung: verwaltung@timefeed.de / ${verwaltungPw}`);
    console.log(`Mitarbeiter: mitarbeiter@timefeed.de / ${mitarbeiterPw}`);
  } catch (error) {
    console.error('Error seeding database:', error);
  }
};
