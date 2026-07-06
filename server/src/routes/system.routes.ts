import { Router, Request, Response } from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { authenticate, authorize, authorizeSuperAdmin } from '../middleware/auth';
import { UserRole } from '../models/User';
import { appVersion } from '../utils/version';

const execAsync = promisify(exec);
const REPO_DIR = '/opt/TimeFeed';

const router = Router();
// Authentifiziert + mind. Admin; die instanzweiten Update-/Deploy-/Log-Endpunkte
// zusätzlich nur Super-Admin (plattformweite Operation, kein Mandanten-Scope).
router.use(authenticate, authorize(UserRole.ADMIN));

// Aktuelle Version
router.get('/version', (_req: Request, res: Response) => {
  res.json({ version: appVersion() });
});

// Auf Updates prüfen: fetch + Vergleich HEAD vs origin/master
router.get('/update-check', authorizeSuperAdmin, async (_req: Request, res: Response) => {
  try {
    await execAsync('git fetch origin master', { cwd: REPO_DIR, timeout: 30000 });
    const [{ stdout: local }, { stdout: remote }] = await Promise.all([
      execAsync('git rev-parse HEAD', { cwd: REPO_DIR }),
      execAsync('git rev-parse origin/master', { cwd: REPO_DIR }),
    ]);
    const localC = local.trim();
    const remoteC = remote.trim();
    let commits: string[] = [];
    if (localC !== remoteC) {
      const { stdout } = await execAsync('git log HEAD..origin/master --oneline --no-decorate -20', { cwd: REPO_DIR });
      commits = stdout.trim().split('\n').filter(Boolean);
    }
    res.json({
      currentVersion: appVersion(),
      upToDate: localC === remoteC,
      behind: commits.length,
      commits,
      current: localC.slice(0, 7),
      remote: remoteC.slice(0, 7),
    });
  } catch (error) {
    console.error('Update-check failed:', error);
    res.status(500).json({ error: 'Update-Prüfung fehlgeschlagen' });
  }
});

// Update auslösen: update.sh --auto losgelöst starten (überlebt den Neustart).
router.post('/update', authorizeSuperAdmin, (_req: Request, res: Response) => {
  try {
    const child = spawn('bash', [`${REPO_DIR}/update.sh`, '--auto'], {
      cwd: REPO_DIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    res.json({ started: true, message: 'Update gestartet – der Server wird neu gebaut und neu gestartet.' });
  } catch (error) {
    console.error('Update start failed:', error);
    res.status(500).json({ error: 'Update konnte nicht gestartet werden' });
  }
});

// Letzte Zeilen des Update-Logs
router.get('/update-log', authorizeSuperAdmin, (_req: Request, res: Response) => {
  try {
    const log = readFileSync(`${REPO_DIR}/update.log`, 'utf-8');
    res.json({ log: log.split('\n').slice(-120).join('\n') });
  } catch {
    res.json({ log: '' });
  }
});

export default router;
