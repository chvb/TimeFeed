// Tests laufen gegen eine In-Memory-SQLite-DB (niemals gegen die echte Datenbank).
process.env.DATABASE_URL = 'sqlite::memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
