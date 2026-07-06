// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

// Nur Zugriffsschutz prüfen — die eigentlichen Aktionen (Cleanup löscht Daten,
// Backup schreibt Dateien) werden in e2e bewusst NICHT ausgelöst, um keine
// Seiteneffekte/Datenmüll zu erzeugen.
test.describe('Cleanup & Backup (nur Berechtigungen)', () => {
  test('Vacation-Cleanup: Employee → 403, ohne Token → 401', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/cleanup/vacation-cleanup', { headers: emp.headers })).status()).toBe(403);
    expect((await request.post('/api/cleanup/vacation-cleanup')).status()).toBe(401);
  });

  test('Backup erstellen: Employee → 403, ohne Token → 401', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/backup/create', { headers: emp.headers })).status()).toBe(403);
    expect((await request.post('/api/backup/create')).status()).toBe(401);
  });

  test('Backup wiederherstellen: Employee → 403, ohne Token → 401', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/backup/restore', { headers: emp.headers })).status()).toBe(403);
    expect((await request.post('/api/backup/restore')).status()).toBe(401);
  });

  test('System/Update: Employee → 403, ohne Token → 401 (kein echtes Update)', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.get('/api/system/update-check', { headers: emp.headers })).status()).toBe(403);
    expect((await request.post('/api/system/update', { headers: emp.headers })).status()).toBe(403);
    expect((await request.get('/api/system/update-check')).status()).toBe(401);
  });

  test('Speicher/S3: Employee → 403, ohne Token → 401', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.get('/api/storage', { headers: emp.headers })).status()).toBe(403);
    expect((await request.post('/api/storage/backup', { headers: emp.headers })).status()).toBe(403);
    expect((await request.get('/api/storage')).status()).toBe(401);
  });

  test('Admin: S3-Settings lesbar (Secret maskiert)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.get('/api/storage', { headers: admin.headers });
    expect(res.ok()).toBeTruthy();
    const { settings } = await res.json();
    expect(settings).toHaveProperty('s3BackupPrefix');
  });
});
