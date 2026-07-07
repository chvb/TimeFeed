import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { sequelize } from './db/database';
import { appVersion } from './utils/version';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import groupRoutes from './routes/group.routes';
import holidayRoutes from './routes/holiday.routes';
import departmentRoutes from './routes/department.routes';
import settingsRoutes from './routes/settings.routes';
import auditRoutes from './routes/audit.routes';
import backupRoutes from './routes/backup.routes';
import systemRoutes from './routes/system.routes';
import storageRoutes from './routes/storage.routes';
import changelogRoutes from './routes/changelog.routes';
import trashRoutes from './routes/trash.routes';
import feedRoutes from './routes/feed.routes';
import companyRoutes from './routes/company.routes';
import tenantRoutes from './routes/tenant.routes';
import timeRoutes from './routes/time.routes';
import timeModelRoutes from './routes/timeModel.routes';
import surchargeProfileRoutes from './routes/surchargeProfile.routes';
import terminalRoutes from './routes/terminal.routes';
import terminalApiRoutes from './routes/terminalApi.routes';
import correctionRoutes from './routes/correction.routes';
import timesheetRoutes from './routes/timesheet.routes';
import { exportProfileRouter, exportsRouter } from './routes/export.routes';
import brandingRoutes from './routes/branding.routes';
import apiKeyRoutes from './routes/apiKey.routes';
import externalRoutes from './routes/external.routes';
import integrationRoutes from './routes/integration.routes';
import pushRoutes from './routes/push.routes';
import absenceTypeRoutes from './routes/absenceType.routes';
import reportRoutes from './routes/report.routes';
import { brandingController } from './controllers/branding.controller';
import { errorHandler } from './middleware/errorHandler';
import './models'; // Import models to set up associations

dotenv.config();

// Sicherheits-Guard: ohne JWT_SECRET niemals starten (sonst würden Tokens mit
// einem leeren/Default-Secret signiert und wären fälschbar).
if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET ist nicht gesetzt. Server wird nicht gestartet.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3030;

// Reverse-Proxy-Unterstützung: nötig, damit req.ip die ECHTE Client-IP aus
// X-Forwarded-For nimmt (sonst sieht der Rate-Limiter nur die Proxy-IP und begrenzt
// alle gemeinsam). Per TRUST_PROXY konfigurierbar; sicherer Default 'loopback'
// (vertraut nur einem lokal laufenden Proxy – externe Clients können XFF NICHT fälschen).
// Werte: 'loopback' | 'false' | 'true' | Zahl der Hops (z. B. '1') | IP/CIDR-Liste.
const trustProxyRaw = (process.env.TRUST_PROXY ?? 'loopback').trim();
let trustProxy: boolean | number | string;
if (trustProxyRaw === 'true') trustProxy = true;
else if (trustProxyRaw === 'false') trustProxy = false;
else if (/^\d+$/.test(trustProxyRaw)) trustProxy = Number(trustProxyRaw);
else trustProxy = trustProxyRaw; // 'loopback' oder IP/CIDR-Liste
app.set('trust proxy', trustProxy);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased from 100 to 1000 requests per window
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Strenger Limiter gegen Brute-Force auf Auth-Endpunkte (Login/Forgot/Reset).
// Brute-Force-Bremse für Auth-Endpunkte. max bewusst nicht zu niedrig, da interne
// Tools oft hinter EINER NAT-/Büro-IP liegen (zu strenges Limit sperrt alle aus).
// Loopback (server-lokale Aufrufe, e2e) wird ausgenommen.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip || ''),
});

// Kiosk-Terminals stempeln viele Mitarbeiter über EINE Geräte-IP → eigener,
// großzügiger Limiter (Schutz gegen Token-/Code-Bruteforce bleibt erhalten).
// Loopback (server-lokale Aufrufe, e2e) wird ausgenommen.
const terminalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many terminal requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip || ''),
});

// Explizite Content-Security-Policy für BEIDE Umgebungen (vorher in Nicht-Prod
// komplett aus). Blockt insbesondere Inline-/fremde Skripte (XSS-Verteidigung).
// 'unsafe-inline' nur für styleSrc, da React/Tailwind Inline-Styles nutzen.
const cspDirectives: Record<string, (string)[] | null> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Google Fonts: Stylesheet von fonts.googleapis.com, Schriften von fonts.gstatic.com
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  // OSM-Kartenkacheln (Standort-Wahl der Terminals) + Nominatim-Adresssuche.
  imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
  connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
};
// Sicherheits-Header (COOP/CORP/originAgentCluster = Helmet-Defaults, in JEDEM Modus aktiv).
// Die HTTPS-ERZWINGENDEN Teile (upgrade-insecure-requests + HSTS) NUR bei echtem TLS
// (FORCE_HTTPS=true) – sonst lädt der Browser Assets über https://…:3030 → ERR_SSL_PROTOCOL_ERROR.
// Bewusst von NODE_ENV entkoppelt, damit production-Härtung auch über reines HTTP funktioniert.
const behindTls = process.env.FORCE_HTTPS === 'true';
app.use(helmet({
  contentSecurityPolicy: {
    directives: { ...cspDirectives, ...(behindTls ? {} : { upgradeInsecureRequests: null }) },
  },
  hsts: behindTls,
}));
app.use(compression());
// Erlaubte Origins: localhost-Defaults + per Env konfigurierbare Liste
// (CORS_ORIGIN, komma-getrennt). Keine hartkodierten LAN-IPs im Code.
const allowedOrigins = [
  'http://localhost:3030',
  'http://127.0.0.1:3030',
  ...(process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()),
].filter((origin): origin is string => Boolean(origin));

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
// Body-Limit: Logos (Terminal/Mandant) kommen als Data-URL bis ~500 KB im JSON —
// das Express-Standardlimit (100 KB) würde Uploads mit 500 quittieren.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Dynamisches PWA-Manifest — MUSS vor dem Static-Handler stehen, sonst liefert
// dieser die statische Datei aus. Ohne ?tenant identisch zur statischen Datei,
// mit ?tenant=<id> gebrandet (Name/Farbe/Icons des Mandanten).
app.get('/manifest.webmanifest', (req, res, next) => brandingController.manifest(req, res, next));

// Downloads (z. B. TimeFeed-Terminal.apk) — liegen AUSSERHALB von public/,
// damit Client-Builds (--emptyOutDir) sie nicht wegräumen.
app.use('/downloads', express.static(path.join(__dirname, '../../downloads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment');
    }
  },
}));

// Statische Assets sind content-hash-benannt → lange cachebar. index.html jedoch
// NIE cachen, damit Clients nach einem Deploy sofort die neuen Bundle-Hashes laden
// (Voraussetzung für das Auto-Update-Banner – kein manuelles Hard-Reload nötig).
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

app.use('/api/', limiter);
// Brute-Force-Schutz für Auth-Endpunkte – standardmäßig aktiv (nicht mehr nur in
// Produktion); nur für Tests/Dev per DISABLE_AUTH_RATE_LIMIT=true abschaltbar.
if (process.env.DISABLE_AUTH_RATE_LIMIT !== 'true') {
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/forgot-password', authLimiter);
  app.use('/api/auth/reset-password', authLimiter);
}
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/corrections', correctionRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/export-profile', exportProfileRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/time-models', timeModelRoutes);
app.use('/api/surcharge-profiles', surchargeProfileRoutes);
app.use('/api/terminals', terminalRoutes);
app.use('/api/terminal', terminalLimiter, terminalApiRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/trash', trashRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/changelog', changelogRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/external', externalRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/absence-types', absenceTypeRoutes);
app.use('/api/reports', reportRoutes);

app.get('/health', async (_req, res) => {
  let uptime30d: number | null = null;
  let startedAt: string | undefined;
  try {
    const m = await import('./services/serverMetricsService');
    uptime30d = await m.getUptime30dCached();
    startedAt = m.getProcessStart().toISOString();
  } catch { /* ignore */ }
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: appVersion(),
    processUptimeSeconds: Math.floor(process.uptime()),
    startedAt,
    uptime30d,
  });
});

// Leichtgewichtiger Ping (für Latenzmessung im Footer, kein DB-Zugriff).
app.get('/ping', (_req, res) => {
  res.json({ ok: true, t: Date.now() });
});

app.get('*', (req, res) => {
  // Unbekannte API-Pfade sauber mit 404 beantworten statt den Request hängen
  // zu lassen (sonst Timeout/offene Sockets).
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ status: 'error', message: 'Not found' });
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    await sequelize.sync({ force: false });
    console.log('Database synchronized.');

    // Spalten der Feature-Erweiterungen (Branding, UrlaubsFeed-Sync) ergänzen.
    // MUSS vor ensureColumns laufen: dessen Bestandsmigration liest bereits das
    // Tenant-Modell inkl. brand_*-Spalten — auf einer Bestands-DB ohne diese
    // Spalten würde der Boot sonst crashen.
    const { ensureFeatureColumns } = await import('./db/ensureFeatureColumns');
    await ensureFeatureColumns();

    // Neue Spalten in bestehenden Tabellen ergänzen (sync alteriert nicht).
    const { ensureColumns } = await import('./db/ensureColumns');
    await ensureColumns();

    // Eingebaute Abwesenheitsarten (globale Vorlagen) seeden — idempotent.
    const { seedBuiltinAbsenceTypes } = await import('./models/AbsenceType');
    await seedBuiltinAbsenceTypes();

    // Web-Push: VAPID-Keys laden bzw. beim ersten Start generieren.
    const { initPush } = await import('./services/pushService');
    await initPush().catch((e) => console.error('WebPush-Init fehlgeschlagen:', e?.message));

    // Heartbeats für die Uptime-Berechnung starten.
    const { startHeartbeats } = await import('./services/serverMetricsService');
    startHeartbeats();

    // Täglicher Zeit-Abschlussjob (Auto-Kappung + Neuberechnung), 02:00 Uhr.
    const { startTimeRecalcJob } = await import('./services/timeRecalcJob');
    startTimeRecalcJob();

    // Automatisches Backup-System: täglicher Lauf zur konfigurierten Uhrzeit
    // (autoBackupTime, globale Vorlage; Default 02:30) inkl. Retention.
    const { startAutoBackupJob } = await import('./services/autoBackupService');
    startAutoBackupJob();

    // Täglicher UrlaubsFeed-Abwesenheits-Sync, 03:00 Uhr.
    const { startAbsenceSyncJob } = await import('./services/absenceSyncService');
    startAbsenceSyncJob();

    // Terminal-Überwachung: Störungs-/Entwarnungs-Mails (pro Firma konfigurierbar).
    const { startTerminalAlertService } = await import('./services/terminalAlertService');
    startTerminalAlertService();

    // Periodische Berichts-Mails (Tag/Monat/Quartal/Jahr, pro Firma): täglicher
    // Tick um 05:00 (nach Recalc 02:00 und Auto-Backup ~02:30).
    const { startReportMailJob } = await import('./services/reportMailService');
    startReportMailJob();
    
    const { seedDatabase } = await import('./db/seedData');
    const userCount = await import('./models/User').then(m => m.User.count());
    if (userCount === 0) {
      await seedDatabase();
    }
    
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
};

startServer();