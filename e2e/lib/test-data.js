// @ts-check
/**
 * Gemeinsame Helfer für e2e-Testdaten: anlegen (Setup) und restlos entfernen
 * (Teardown). Arbeitet direkt auf der DB über die kompilierten Server-Modelle,
 * damit die Bereinigung unabhängig vom Test-Ergebnis garantiert greift.
 *
 * Konvention, an die sich Bereinigung hält:
 *   - Test-User-Mails enden auf  @test.local
 *   - Test-Entitäten (Gruppen/Feiertage/Abteilungen) heißen  e2e-...
 */
const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');
// VOR dem Laden der DB ins server-Verzeichnis wechseln: SQLite-Pfad ist
// relativ zum CWD (DATABASE_URL=sqlite:./database.sqlite).
process.chdir(SERVER_DIR);
try {
  require(path.join(SERVER_DIR, 'node_modules', 'dotenv')).config({
    path: path.join(SERVER_DIR, '.env'),
  });
} catch (_) { /* Fallback: Default-DATABASE_URL in dist/db/database */ }

const { sequelize } = require(path.join(SERVER_DIR, 'dist', 'db', 'database'));
const M = require(path.join(SERVER_DIR, 'dist', 'models'));
const { Op } = require(path.join(SERVER_DIR, 'node_modules', 'sequelize'));

// Passwort aus .env.test (e2e-Root) oder Default — identisch zu helpers.js
function testPassword() {
  if (process.env.E2E_PASSWORD) return process.env.E2E_PASSWORD;
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env.test'), 'utf-8');
    const m = env.match(/^E2E_PASSWORD=(.*)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* ignore */ }
  return 'E2ETestPassword123!';
}

const FIXTURE_USERS = [
  { email: 'e2e-admin@test.local', firstName: 'E2E', lastName: 'Admin', role: 'admin', isSuperAdmin: true },
  { email: 'e2e-hr@test.local', firstName: 'E2E', lastName: 'HR', role: 'hr' },
  { email: 'e2e-manager@test.local', firstName: 'E2E', lastName: 'Manager', role: 'manager' },
  { email: 'e2e-employee@test.local', firstName: 'E2E', lastName: 'Employee', role: 'employee' },
];

async function createTestUsers() {
  await sequelize.authenticate();
  const password = testPassword();
  for (const u of FIXTURE_USERS) {
    const [user, created] = await M.User.findOrCreate({
      where: { email: u.email },
      defaults: {
        ...u,
        password, // beforeCreate-Hook hasht
        vacationDays: 30,
        usedVacationDays: 0,
        plannedVacationDays: 0,
        isActive: true,
      },
    });
    if (!created) {
      user.password = password; // beforeUpdate-Hook hasht
      user.role = u.role;
      user.isActive = true;
      user.vacationDays = 30;
      user.set('usedVacationDays', 0);
      user.set('plannedVacationDays', 0);
      user.set('groupId', null);
      user.set('companyId', null);
      user.set('isSuperAdmin', !!u.isSuperAdmin);
      await user.save();
    }
  }

  // Gruppe für Manager-Scope: Manager verwaltet 'e2e-team', Employee ist Mitglied.
  const manager = await M.User.findOne({ where: { email: 'e2e-manager@test.local' } });
  const employee = await M.User.findOne({ where: { email: 'e2e-employee@test.local' } });
  if (manager && employee) {
    const [group] = await M.Group.findOrCreate({
      where: { name: 'e2e-team' },
      defaults: { name: 'e2e-team', description: 'e2e', managerId: manager.id },
    });
    group.set('managerId', manager.id);
    await group.save();
    if (M.GroupManager) {
      await M.GroupManager.findOrCreate({
        where: { groupId: group.id, userId: manager.id },
        defaults: { groupId: group.id, userId: manager.id },
      });
    }
    employee.set('groupId', group.id);
    await employee.save();
  }
}

/**
 * Entfernt RESTLOS alle von e2e erzeugten Daten:
 * Urlaubsanträge, Krankmeldungen und Audit-Logs der Test-User, alle
 * e2e-Gruppen/-Feiertage/-Abteilungen sowie sämtliche @test.local-User.
 * Jeder Schritt ist best-effort (Teardown darf nicht an einem Detail scheitern).
 */
async function cleanupTestData() {
  await sequelize.authenticate();
  const swallow = (p) => p.catch((e) => console.warn('  cleanup-Warnung:', e.message));

  const users = await M.User.findAll({ where: { email: { [Op.like]: '%@test.local' } } });
  const ids = users.map((u) => u.id);

  if (ids.length) {
    await swallow(M.VacationRequest.destroy({ where: { userId: { [Op.in]: ids } } }));
    await swallow(M.SickLeave.destroy({ where: { userId: { [Op.in]: ids } } }));
    await swallow(M.AuditLog.destroy({ where: { userId: { [Op.in]: ids } } }));
    if (M.PasswordResetToken) {
      await swallow(M.PasswordResetToken.destroy({ where: { userId: { [Op.in]: ids } } }));
    }
    // Gruppenzuordnung lösen, damit Gruppen sicher löschbar sind
    await swallow(M.User.update({ groupId: null }, { where: { id: { [Op.in]: ids } } }));
  }

  await swallow(M.Group.destroy({ where: { name: { [Op.like]: 'e2e-%' } } }));
  await swallow(M.CompanyHoliday.destroy({ where: { name: { [Op.like]: 'e2e-%' } } }));
  await swallow(M.Department.destroy({ where: { name: { [Op.like]: 'e2e-%' } } }));
  if (M.BlackoutPeriod) await swallow(M.BlackoutPeriod.destroy({ where: { name: { [Op.like]: 'e2e-%' } } }));
  if (M.LeaveType) await swallow(M.LeaveType.destroy({ where: { key: { [Op.like]: 'e2e%' }, isBuiltin: { [Op.not]: true } } }));

  // Test-User selbst
  await swallow(M.User.destroy({ where: { email: { [Op.like]: '%@test.local' } } }));

  // Zuletzt die in Tests angelegten Firmen + Mandanten (Namen sind 'e2e-…' präfixiert).
  // Reihenfolge: Firmen vor Mandanten (Company.tenantId-FK); Nutzer/Gruppen sind oben bereits weg.
  if (M.Company) await swallow(M.Company.destroy({ where: { name: { [Op.like]: 'e2e-%' } } }));
  if (M.Tenant) await swallow(M.Tenant.destroy({ where: { name: { [Op.like]: 'e2e-%' } } }));
}

// Datei, in der der ursprüngliche E-Mail-Zustand gesichert wird, damit der
// Teardown ihn zuverlässig wiederherstellen kann (auch prozessübergreifend).
const EMAIL_STATE_FILE = path.join(__dirname, '..', '.email-state.json');

/**
 * Schaltet E-Mail-Versand für die Testdauer komplett ab:
 *   - SystemSettings.emailNotifications = false  (Controller-Gate für
 *     Urlaubs-Benachrichtigungen etc.)
 *   - EmailSettings.isActive = false             (Transport — verhindert JEDEN
 *     Versand, auch ungated Pfade wie Passwort-Reset)
 * Der Originalzustand wird gesichert und im Teardown wiederhergestellt.
 */
async function disableEmails() {
  await sequelize.authenticate();
  const state = {};
  const sys = await M.SystemSettings.findOne();
  if (sys) {
    state.emailNotifications = sys.emailNotifications;
    sys.set('emailNotifications', false);
    await sys.save();
  }
  const em = await M.EmailSettings.findOne();
  if (em) {
    state.isActive = em.isActive;
    em.set('isActive', false);
    await em.save();
  }
  try { fs.writeFileSync(EMAIL_STATE_FILE, JSON.stringify(state)); } catch (_) { /* ignore */ }
}

async function restoreEmails() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(EMAIL_STATE_FILE, 'utf-8'));
  } catch (_) {
    return; // nichts zu restaurieren
  }
  await sequelize.authenticate();
  if (state.emailNotifications !== undefined) {
    const sys = await M.SystemSettings.findOne();
    if (sys) { sys.set('emailNotifications', state.emailNotifications); await sys.save(); }
  }
  if (state.isActive !== undefined) {
    const em = await M.EmailSettings.findOne();
    if (em) { em.set('isActive', state.isActive); await em.save(); }
  }
  try { fs.unlinkSync(EMAIL_STATE_FILE); } catch (_) { /* ignore */ }
}

async function closeDb() {
  try { await sequelize.close(); } catch (_) { /* ignore */ }
}

module.exports = {
  createTestUsers,
  cleanupTestData,
  disableEmails,
  restoreEmails,
  closeDb,
  testPassword,
  FIXTURE_USERS,
};
