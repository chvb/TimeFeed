# Changelog

## 0.1.0
- Projektstart TimeFeed: Grundgerüst aus der Feed-Familie (Vorlage UrlaubsFeed)

## 0.2.0
- Kern-Zeiterfassung: Stempeluhr (Kommen/Gehen/Pause), Zeitmodelle mit Gruppen-Zuordnung und Mitarbeiter-Overrides, Tagesberechnung (Pausenmodi auto/manual/kombiniert, Nachtschichten, Auto-Kappung, ArbZG-Warnungen), Seite "Meine Zeiten", neue Rollen Admin/Buchhaltung/Verwaltung/Mitarbeiter

## 0.3.0
- Terminal-Modus: Kiosk-PWA unter /terminal (NFC, Stempel-Code-Nummernblock, QR-Scan, PIN-Option, Offline-Queue mit Nachsync), Admin-Geräteverwaltung mit Einmal-Token, QR-Badges für Mitarbeiter

## 0.4.0
- Verwaltung & Buchhaltung: Zeiten verwalten (Nachbuchen, Storno mit Begründung), Korrekturanträge mit Genehmigungs-Workflow, Monatsabschluss mit Sperre und Wieder-Öffnen, Stundenzettel-Upload (S3/lokal), druckbarer Monats-Stundenzettel, Live-Anwesenheitstafel

## 0.5.0
- Lohn-Exporte: DATEV LODAS und Lohn & Gehalt (ASCII), CSV und Excel; Exportprofil pro Firma (Berater-/Mandantennr., Lohnarten, Überstunden-Modus, Abschluss-Pflicht), Vorschau mit Warnungen, neue Seite "Lohn-Export"

## 0.6.0
- Sekundärer S3-Backup-Server (Dual-Write, Failover, automatischer Rück-Sync), Aufbewahrungs-/Löschkonzept (ArbZG/DSGVO)
- Branding pro Mandant (Logo, Farbe, Name) mit dynamischem PWA-Manifest, auch am Terminal
- API-Schlüssel-Verwaltung + externe API (/api/external/times), UrlaubsFeed-Kopplung (täglicher Abwesenheits-Import)
- Web-Push-Benachrichtigungen (Korrektur-Entscheidungen, vergessenes Ausstempeln), neue E2E-Testsuite

## [1.1.2] - 2026-07-08

### Fixed
- Terminal: nativer NFC-Fix, Vollbild-Button nur im Browser, Punch-Hole-sichere Header

### Improved
- Terminal-Header: Basis-Zeilenhöhe zusätzlich zum Safe-Area-Inset erhalten
- Session-Dauer konfigurierbar: JWT-Laufzeit aus SystemSettings statt fester Env

## [1.1.1] - 2026-07-07

### Added
- E2E: 8 neue Specs für v1.1.0-Features (53 Tests gesamt, grün)

### Fixed
- Responsive-Audit: 6 Fixes (375px/768px, 53/53 Viewport-Checks grün)
- Terminal-Standort per Karte + Fixes: Body-Limit, Kiosk-Farbe
- Kiosk 24/7-Selbstheilung: nächtlicher Auto-Reload + Fehler-Watchdog

### Improved
- Speicher-Einstellungen: Sekundärer-S3-Abschnitt in der UI nachgereicht
- Watchdog: Autostart + Selbstheilung für TimeFeed und UrlaubsFeed
- Mitarbeiter-Abgleich UrlaubsFeed ↔ TimeFeed (Pull mit Auswahl)
- Header: Firmen-/Mandanten-Wechsler überlappt nicht mehr (Muster UrlaubsFeed)
- Betriebs-Scripts: PID-Verifikation statt pattern-kill, Zombie-Erkennung im Update
- E2E: Spec 19 Mitarbeiter-Abgleich (Suite: 19 Specs / 58 Tests grün)
- API-Schlüssel als Tab in den Einstellungen (Super-Admin), Menüpunkt entfernt
- Stempeluhr: laufende Arbeitszeit live anzeigen
- DATEV Paket 1: Abwesenheitsarten-Katalog + Lohnartnummern, LuG kalendertäglich (Yellowfox-Referenz)
- API-Schlüssel: Mandant beim Erzeugen automatisch auflösen
- Terminal-Logo (pro Gerät, Fallback Firmen-Logo/Branding) + Kiosk-Header umgebaut
- DATEV Paket 2: Zuschlagsprofile für Zeitspannen (Nachtarbeit etc.)
- Berichts-Mails: Tag/Monat/Quartal/Jahr pro Firma konfigurierbar
- Auto-Backup-System (FotoFeed-Muster), über die UI verwaltbar
- Mail-Logo eingebettet, Berichts-Empfänger-Fallback, Logo-Limits 2 MB, Sekundär-Test robuster
- TimeFeed Terminal: eigene Android-Kiosk-App (WebView, nativer NFC)
- Terminal-App-Anbindung: native NFC-Brücke, Download-Route, Login-Link
- Login-Seite: Footer wie FotoFeed/UrlaubsFeed, App-Link dezent
- Login: App-Link-Text auf 'Android Terminal App' gekürzt
- Login: App-Link-Text 'Android Terminal-App' (mit Bindestrich)
- Kiosk: Geräte-/Firmen-Logo mittig über der Uhr statt im Header
- Kiosk: Marken-Footer unten mittig (www.timefeed.de / FeedApps.de-Familie)
- Dachmarke: 'Teil der FeedApps.de-Familie' im App-Footer und Mail-Footer
- Betriebs-Scripts: Kill zusätzlich über Port-Inhaber (ss), robust gegen unlesbare /proc-Einträge

## [1.1.0] - 2026-07-06

### Added
- Feed: neue Seite als Aktivitäts-Stream mit Kennzahlen, Filtern und Handlungs-Buttons; Unternehmens-Ebene für Verwaltung/Buchhaltung (Wochen-Bilanz, Monatsabschluss-Fortschritt, Überstunden-Ausreißer, Abwesenheitsquote, Auto-Kappungen, Backup-Status, Austritte, Geburtstage) plus persönliche Wochen-/Monats-Zusammenfassung; Auto-Aktualisierung alle 10 Sekunden
- Monats-Stundenzettel automatisch als PDF per E-Mail beim Monatsabschluss (global pro Firma und je Mitarbeiter einstellbar: Standard/Immer/Nie)
- Sammel-Monatsabschluss: unter „Zeiten verwalten" den Monat für alle Mitarbeiter auf einmal abschließen bzw. wieder öffnen
- GPS-Modus in den Einstellungen: deaktiviert / optional / akzeptieren mit Warnung (Feed-Karte + nächtliche Sammel-Mail) / erforderlich
- Stempel-Journal zeigt jetzt den Terminal-Namen und öffnet den GPS-Standort per Klick auf der Karte
- QR-Badge der Mitarbeiter mit Druckdialog (gebrandeter Ausweis, als PDF speicherbar)
- Terminal: Token-Neuerzeugung mit Einmal-Anzeige, passwortgeschützte Kiosk-Einstellungen (pro Gerät), Heartbeat mit einstellbarem Ping-Intervall (Standard 20 s), Live-Status „Zuletzt gemeldet" mit Ampel in der Geräteliste, Tastatur-/Scanner-Eingabe für Stempel-Code und PIN
- Terminal-Störungsmeldung per E-Mail (Schwelle und Empfänger pro Firma einstellbar, mit Entwarnung)

### Fixed
- Service Worker lieferte bei Serverausfall eine ungültige Antwort (Konsolen-Fehler) — jetzt saubere Offline-Seite

### Improved
- Einheitliches E-Mail-Design für alle Mails: TimeFeed-Logo, Orange, gebrandete Buttons
- Terminal meldet sich nie mehr automatisch ab (Token bleibt erhalten, automatische Neuprüfung)
- API-Schlüssel: nur noch für Super-Admins, im Menü unter den Einstellungen; Dashboard wieder oben im Menü
- v1.1.0 — Feed-Ausbau, Stundenzettel-Mail, Sammel-Abschluss, GPS-Modus, Terminal-Details
- Mail-Design vereinheitlicht, Terminal-Störungsmails + konfigurierbares Ping-Intervall

## [1.0.1] - 2026-07-06

### Improved
- TimeFeed 0.6.0 — Phase 6: S3-Sekundär, Branding, API/Kopplung, Push, E2E
- TimeFeed 0.5.0 — Zeiterfassungs-App (Phasen 1–5)
- Integration: LAN-/Selfhost-URLs für UrlaubsFeed-Kopplung erlauben
