import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { appVersion } from '../utils/version';

const router = Router();

// CHANGELOG.md (Keep-a-Changelog-Format) liegt im Repo-Root.
const CHANGELOG_PATH = join(__dirname, '..', '..', '..', 'CHANGELOG.md');

interface ChangeSection { title: string; items: string[] }
interface ChangeEntry { version: string; date: string; sections: ChangeSection[] }

function parseChangelog(md: string): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  let cur: ChangeEntry | null = null;
  let sec: ChangeSection | null = null;
  for (const line of md.split('\n')) {
    const v = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+)$/);
    if (v) { cur = { version: v[1], date: v[2].trim(), sections: [] }; entries.push(cur); sec = null; continue; }
    const s = line.match(/^###\s+(.+)$/);
    if (s && cur) { sec = { title: s[1].trim(), items: [] }; cur.sections.push(sec); continue; }
    const it = line.match(/^[-*]\s+(.+)$/);
    if (it && sec) { sec.items.push(it[1].trim()); continue; }
  }
  return entries;
}

// Öffentlich (kein Auth) – Changelog enthält keine sensiblen Daten.
router.get('/', (_req: Request, res: Response) => {
  try {
    const md = readFileSync(CHANGELOG_PATH, 'utf-8');
    res.json({ version: appVersion(), entries: parseChangelog(md) });
  } catch {
    res.json({ version: appVersion(), entries: [] });
  }
});

export default router;
