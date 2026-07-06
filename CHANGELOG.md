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

## [1.0.1] - 2026-07-06

### Improved
- TimeFeed 0.6.0 — Phase 6: S3-Sekundär, Branding, API/Kopplung, Push, E2E
- TimeFeed 0.5.0 — Zeiterfassungs-App (Phasen 1–5)
- Integration: LAN-/Selfhost-URLs für UrlaubsFeed-Kopplung erlauben
