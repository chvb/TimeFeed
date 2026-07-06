# TimeFeed – Technisches Konzept

Stand: 2026-07-06. Grundlage: Feed-Familien-Architektur (Vorlage UrlaubsFeed), Domain https://timefeed.de, Port 3030.

## Rollen

`superadmin` (Flag `isSuperAdmin`), `admin`, `buchhaltung`, `verwaltung`, `mitarbeiter`.
Hierarchie/Scoping unverändert aus der Vorlage: Tenant → Company → Group → User (`services/accessScope.ts`).

## Domänenmodell (Phase 2–6)

### TimeModel (Zeitmodell)
Pro Firma anlegbar, Gruppen zuordenbar, pro Mitarbeiter überschreibbar.
- `companyId`, `name`, `isActive`
- Wochenplan: `monMinutes` … `sunMinutes` (Sollzeit pro Wochentag)
- `roundingMode` (none|up|down|nearest), `roundingMinutes` (z. B. 5/15)
- Zuordnung: `Group.timeModelId`; Override: `User.timeModelId` (nullable)

### TimeEntry (Stempelung — unveränderliches Journal)
- `userId`, `companyId`, `type` (`in` | `out` | `break_start` | `break_end`)
- `timestamp` (UTC), `source` (`web` | `terminal` | `manual` | `api` | `auto_cap`)
- `terminalId` (nullable), GPS: `lat`, `lng`, `accuracy` (null wenn Browser-Freigabe fehlt → Eintrag wird als „ohne Standort" markiert)
- Versionierung statt Überschreiben: `replacesEntryId` (nullable), `isCancelled`, `cancelledById/At/Reason`, `createdById` (bei Nachbuchung ≠ userId), `note`
- Original-Stempelungen werden NIE gelöscht/geändert — Korrektur = Storno + neuer Eintrag.

### WorkDay (Tagesaggregat, berechnet)
- `userId`, `date`, `targetMinutes`, `workedMinutes`, `breakMinutes` (gestempelt), `autoBreakMinutes` (ergänzt), `balanceMinutes`
- `status`: `open` | `incomplete` (Ausstempeln vergessen) | `ok` | `flagged` | `approved` | `locked`
- `flags` (JSON): `arbzg_over_10h`, `arbzg_rest_violation`, `auto_capped`, `no_gps`, …
- `absence` (nullable): `holiday` | `vacation` | `sick` | … (aus Feiertagsservice bzw. UrlaubsFeed-API) → zählt als Sollzeit-Gutschrift
- Nachtschichten: ein `out` nach Mitternacht wird dem Arbeitstag des zugehörigen `in` zugerechnet (Zuordnung über Schichtlogik, nicht Kalendertag).
- Nächtlicher Recalc-Job (analog VacationCleanup-Muster): Tagesabschluss, Auto-Kappung zur konfigurierten Uhrzeit, ArbZG-Prüfung, Saldo-Fortschreibung.

### CorrectionRequest (Korrekturantrag Mitarbeiter)
- `userId`, `date`, `requestedChanges` (JSON), `reason`, `status` (pending|approved|rejected), `decidedById/At`, `decisionNote`
- Genehmigung durch Rolle `verwaltung`/`buchhaltung`/`admin` → erzeugt Storno+Neueinträge.

### TerminalDevice (Stempel-Terminal)
- `companyId`, `name`, `tokenHash` (Geräte-Token, wird bei Registrierung einmalig angezeigt), `locationLabel`, `lat`, `lng`, `isActive`, `lastSeenAt`
- `config` (JSON): erlaubte Identifikationsarten (nfc|code|qr), Anzeige-Optionen
- Kiosk-Route `/terminal`: Geräte-Token-Auth (kein User-JWT). Identifikation: NFC (Web-NFC, Android/Chrome; Chip enthält Stempel-Code), Code-Eingabe (Nummernblock), QR-Scan (iOS). Danach Dialog „Kommen/Gehen".
- Offline-Queue: IndexedDB im Client, Sync-Endpoint nimmt nachgereichte Stempelungen mit Original-Zeitstempel an (`source='terminal'`, Flag `synced_late`).

### User-Erweiterungen
- `stampCode` (eindeutig je Firma, steckt im NFC-Chip/QR), `nfcTagUid` (optional zusätzlich), `pin` (optional für Code-Eingabe)
- `timeModelId` (Override), `employeeNumber` (für DATEV)

### TimesheetDocument (Stundenzettel-PDF)
- `companyId`, `userId`, `periodStart`, `periodEnd`, `fileName`, `mimeType`, `size`, `storageType`, `storageKey`, `uploadedById`, `note`
- Upload → S3 (Dual-Write auf Sekundär), Verknüpfung in Monatsansicht.

### MonthClosure (Monatsabschluss)
- `companyId`, `userId` (null = ganze Firma), `month`, `closedById/At`, `totals` (JSON-Snapshot)
- Abgeschlossene Monate: WorkDays → `locked`; Änderung nur per Storno-Workflow mit Audit.

### ExportProfile (DATEV, pro Tenant/Firma)
- `format` (`lodas` | `lug` | `csv` | `xlsx`), `beraterNr`, `mandantenNr`, `personalNrQuelle` (employeeNumber|stampCode)
- `lohnartMapping` (JSON): Normalstunden, Überstunden, Zuschläge → Lohnart-Nummern
- Alles über Admin-UI pflegbar.

### ApiKey (System-Kopplung, Phase 6)
- `tenantId`, `name`, `keyHash`, `scopes` (JSON), `isActive`, `lastUsedAt`, `createdById`
- Verwaltung im Admin-Panel (Generieren/Widerrufen, Key nur einmal sichtbar). Gleiches Modul wird in UrlaubsFeed nachgerüstet; TimeFeed pollt dort `GET /api/external/absences` (Urlaub/Krank) und schreibt sie in `WorkDay.absence`.

## SystemSettings-Erweiterungen (pro Firma, global als Vorlage)
- Pausen: `breakMode` (`auto` | `manual` | `combined`), Schwellen (`breakAfter6hMinutes`=30, `breakAfter9hMinutes`=45)
- Kappung: `autoCapEnabled`, `autoCapTime` (z. B. 23:00), Benachrichtigung an Mitarbeiter/Verwaltung
- ArbZG: `arbzgWarningsEnabled`, `arbzgMaxDailyMinutes` (600), `arbzgMinRestMinutes` (660)
- GPS: `gpsRequired` (Stempeln ohne Freigabe erlaubt, aber markiert)
- Aufbewahrung: `retentionMonthsEntries` (Default 24+, §16 ArbZG), `retentionMonthsGps` (kürzer möglich, DSGVO)
- Branding (Tenant): `brandName`, `brandLogo`, `brandColor` → dynamisches PWA-Manifest `/manifest.webmanifest?tenant=…`

## PWA
- `client/public/manifest.webmanifest`, `client/public/sw.js` (App-Shell-Cache; `/api/` nie cachen), Icons unter `client/public/icons/`
- SW-Registrierung in `main.tsx`. Terminal-Offline-Queue liegt in der App (IndexedDB), nicht im SW.

## i18n
Alle UI-Texte über `client/src/i18n/` (DE + EN pflegen) — keine hartkodierten Strings, gilt für alle Phasen.

## Phasenplan
1. Grundgerüst (Kopie, Rebranding, Domäne raus, PWA-Basis) ✅ in Arbeit
2. Kern-Zeiterfassung (TimeEntry, TimeModel, WorkDay, Mitarbeiter-UI)
3. Terminal-Modus (Kiosk, NFC/Code/QR, Offline-Queue)
4. Verwaltung & Buchhaltung (Korrekturen, Monatsabschluss, PDF-Upload, Anwesenheitstafel)
5. Exporte (DATEV LODAS / Lohn & Gehalt / CSV, Konfig-UI)
6. Infra (S3-Sekundär nach FotoFeed-Muster, Tenant-Branding, API-Kopplung UrlaubsFeed, Push, Retention, E2E)
