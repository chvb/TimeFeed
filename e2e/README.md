# TimeFeed E2E-Tests

API-Tests mit Playwright (request-Fixture, JSON) gegen den laufenden Server.
Decken Auth, Benutzer, Urlaubsanträge, Gruppen, Feiertage, Abteilungen,
Krankmeldungen, Einstellungen/Audit und Rollen-Berechtigungen ab.

## Setup

```bash
cd e2e
npm install          # installiert @playwright/test
```

## Test-User & automatische Bereinigung

Die Suite legt die Test-User über **globalSetup** selbst an und entfernt über
**globalTeardown** nach jedem Lauf **restlos alle** e2e-Daten — unabhängig
davon, ob Tests fehlschlagen. Es bleibt also kein Datenmüll zurück:

- `e2e-*@test.local`-User (admin/hr/manager/employee)
- alle Urlaubsanträge, Krankmeldungen und Audit-Logs dieser User
- alle `e2e-…` benannten Gruppen, Feiertage und Abteilungen

**Kein E-Mail-Versand:** globalSetup deaktiviert für die Testdauer
`SystemSettings.emailNotifications` und `EmailSettings.isActive`, sodass
Urlaubsanträge & Co. **keine Mails** auslösen. globalTeardown stellt den
ursprünglichen Zustand wieder her.

Manuell (nur Dev-Server, normalerweise nicht nötig):
```bash
node setup-test-users.js     # Test-User anlegen
node cleanup-test-data.js    # alles restlos entfernen
```
Die dedizierten `@test.local`-Adressen kollidieren nicht mit echten Accounts.

## Tests ausführen

```bash
# Gegen localhost:3030 (Default)
npm test

# Gegen anderen Host
E2E_BASE_URL=http://localhost:3030 npm test

# Einzelne Datei
npx playwright test 03-vacations

# HTML-Report
npm run test:report
```

## Konvention: für neue Funktionen neue Tests

Bei jeder neuen/erweiterten Funktion wird die passende `*.spec.js` ergänzt
oder eine neue angelegt (durchnummeriert). Tests räumen ihre Testdaten am
Ende wieder auf (Create → Assert → Delete).

## Suiten

| Datei | Bereich |
|-------|---------|
| `01-auth.spec.js` | Health, Login, Token, `/me`, 401 ohne Token |
| `02-users.spec.js` | User-CRUD, Aktivieren/Deaktivieren, Urlaubskonto, RBAC |
| `03-vacations.spec.js` | Antrag anlegen, eigene Anträge, Genehmigen/Ablehnen, Kalender, Statistik |
| `04-groups.spec.js` | Gruppen-CRUD, Mitglieder hinzufügen/entfernen |
| `05-holidays.spec.js` | Feiertage-CRUD |
| `06-departments.spec.js` | Abteilungen-CRUD, RBAC |
| `07-sick-leaves.spec.js` | Krankmeldungen-CRUD, RBAC |
| `08-settings-audit.spec.js` | Systemeinstellungen, Audit-Logs/Stats/Filter, RBAC |
| `09-permissions.spec.js` | Rollenübergreifende Zugriffsbeschränkungen |
