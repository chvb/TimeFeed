import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL || 'sqlite:./database.sqlite';

export const sequelize = new Sequelize(databaseUrl, {
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  define: {
    timestamps: true,
    underscored: true,
  },
  // SQLite erlaubt nur EINEN Schreiber. Bei kurzzeitig gesperrter DB (SQLITE_BUSY /
  // "database is locked") die Query automatisch ein paar Mal wiederholen statt zu scheitern
  // (verhindert z. B. "Failed to create audit log" bei gleichzeitigen Schreibzugriffen).
  retry: {
    match: [/SQLITE_BUSY/, /database is locked/],
    max: 5,
    backoffBase: 100,
    backoffExponent: 1.3,
  },
});

// Zusätzlich pro Verbindung ein busy_timeout setzen: ein wartender Schreiber blockiert
// bis zu 5s auf die Sperre, statt sofort mit SQLITE_BUSY abzubrechen.
sequelize.addHook('afterConnect', async (connection: any) => {
  try {
    await new Promise<void>((resolve) => {
      connection.run('PRAGMA busy_timeout = 5000;', () => resolve());
    });
  } catch {
    /* ignore – Fallback ist das retry oben */
  }
});