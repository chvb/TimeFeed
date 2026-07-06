import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PendingKeyStore } from './secondaryPendingStore';

/**
 * Unit-Tests für die JSON-Statusdateien des Sekundär-Spiegels
 * (.pending-secondary.json / .pending-backfill.json).
 */
describe('PendingKeyStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timefeed-pending-'));
    file = path.join(dir, '.pending-secondary.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('liefert eine leere Liste, wenn die Datei fehlt', () => {
    const store = new PendingKeyStore(file);
    expect(store.list()).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('add/list/remove funktionieren und persistieren', () => {
    const store = new PendingKeyStore(file);
    store.add('timefeed/backups/a.json');
    store.add('timefeed/attachments/b.pdf');
    expect(store.list()).toEqual(['timefeed/backups/a.json', 'timefeed/attachments/b.pdf']);

    // Persistenz: neue Instanz auf derselben Datei sieht dieselben Keys.
    const reopened = new PendingKeyStore(file);
    expect(reopened.list()).toEqual(['timefeed/backups/a.json', 'timefeed/attachments/b.pdf']);

    store.remove('timefeed/backups/a.json');
    expect(store.list()).toEqual(['timefeed/attachments/b.pdf']);
    expect(new PendingKeyStore(file).count()).toBe(1);
  });

  it('dedupliziert Keys', () => {
    const store = new PendingKeyStore(file);
    store.add('x');
    store.add('x');
    store.add('x');
    expect(store.list()).toEqual(['x']);
  });

  it('ignoriert leere Keys und remove auf nicht vorhandene Keys', () => {
    const store = new PendingKeyStore(file);
    store.add('');
    expect(store.list()).toEqual([]);
    store.remove('gibt-es-nicht'); // darf nicht werfen
    expect(store.list()).toEqual([]);
  });

  it('behandelt eine korrupte Datei wie leer und erholt sich beim nächsten add', () => {
    fs.writeFileSync(file, '{kaputt::', 'utf-8');
    const store = new PendingKeyStore(file);
    expect(store.list()).toEqual([]);
    store.add('neu');
    expect(store.list()).toEqual(['neu']);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ keys: ['neu'] });
  });

  it('behandelt falsches Schema (keys kein Array) wie leer', () => {
    fs.writeFileSync(file, JSON.stringify({ keys: 'nope' }), 'utf-8');
    expect(new PendingKeyStore(file).list()).toEqual([]);
  });

  it('schreibt atomar (keine tmp-Datei bleibt liegen, Datei ist gültiges JSON)', () => {
    const store = new PendingKeyStore(file);
    for (let i = 0; i < 20; i++) store.add(`key-${i}`);
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(parsed.keys).toHaveLength(20);
  });
});
