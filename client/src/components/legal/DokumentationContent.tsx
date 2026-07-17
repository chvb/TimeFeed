import { useMemo, useState } from 'react';
import SearchInput from '../common/SearchInput';
import { useI18n } from '../../i18n';
import {
  ArrowRightOnRectangleIcon, UserGroupIcon, HomeIcon, ClockIcon, UsersIcon,
  TrashIcon, Cog6ToothIcon, UserCircleIcon, SparklesIcon, FingerPrintIcon,
  DeviceTabletIcon, MapPinIcon, PencilSquareIcon, CheckCircleIcon,
  ClipboardDocumentListIcon, AdjustmentsHorizontalIcon, ArrowDownTrayIcon,
  TagIcon, BuildingLibraryIcon, ShieldCheckIcon,
  BanknotesIcon, ServerStackIcon, KeyIcon, ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';

interface DocEntry { term?: string; text: string }
interface DocSection { id: string; title: string; icon: any; intro?: string; entries: DocEntry[] }

const SECTIONS_DE: DocSection[] = [
  {
    id: 'erste-schritte', title: 'Erste Schritte & Anmeldung', icon: ArrowRightOnRectangleIcon,
    intro: 'So melden Sie sich an und finden sich zurecht.',
    entries: [
      { text: 'Anmeldung mit E-Mail und Passwort. „Passwort vergessen?" sendet einen Reset-Link per E-Mail (1 Stunde gültig).' },
      { text: 'Oben die orange Kopfleiste (Logo, Firmen-/Mandanten-Wechsler, Sprache DE/EN, Hell/Dunkel-Umschalter, Benutzer-Menü), links die Navigation. Auf Mobilgeräten klappt das Menü über das Burger-Symbol auf.' },
      { text: 'TimeFeed ist eine PWA – über „Zum Startbildschirm hinzufügen" wie eine App nutzbar, auch offline-tauglich am Terminal.' },
    ],
  },
  {
    id: 'rollen', title: 'Rollen & Berechtigungen', icon: UserGroupIcon,
    intro: 'Welche Rolle was darf.',
    entries: [
      { term: 'Mitarbeiter', text: 'Stempelt die eigene Zeit, sieht die eigenen Zeiten und das eigene Profil und kann Korrekturen beantragen.' },
      { term: 'Verwaltung', text: 'Zusätzlich: verwaltet Zeiten, Mitarbeiter, Gruppen und Anwesenheit, entscheidet über Korrekturanträge und schließt Monate ab.' },
      { term: 'Buchhaltung', text: 'Wie Verwaltung und zusätzlich Zugriff auf den Lohn-Export (DATEV / Lohn & Gehalt).' },
      { term: 'Admin', text: 'Vollzugriff inkl. Zeitmodelle, Terminals, aller Systemeinstellungen, Backup, Speicher (S3) und Updates.' },
      { term: 'Super-Admin / Mandanten-Admin', text: 'Verwaltet Mandanten und Firmen mandantenübergreifend bzw. das eigene Mandanten-Branding und die AVV/AGB.' },
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard', icon: HomeIcon,
    entries: [
      { text: 'Begrüßung, aktuelles Datum und eine große Live-Uhr.' },
      { text: 'Schnellzugriff auf das Stempeln sowie ein Überblick über den aktuellen Status.' },
    ],
  },
  {
    id: 'stempeln', title: 'Stempeln (Zeiterfassung)', icon: ClockIcon,
    intro: 'Kommen, Gehen und Pausen erfassen – am Rechner, per NFC oder am Terminal.',
    entries: [
      { term: 'Web-App', text: 'Über die Stempelseite Kommen / Gehen / Pause / Pause beenden mit einem Klick. Der aktuelle Status wird angezeigt.' },
      { term: 'Reihenfolge', text: 'Es sind nur sinnvolle Aktionen möglich (z. B. „Gehen" erst nach „Kommen"). Unmögliche Aktionen sind gesperrt.' },
      { term: 'Pausenregelung', text: 'Pro Firma einstellbar: automatischer Pausenabzug (gesetzliche Pausen), Pausen selbst stempeln oder eine Kombination aus beidem.' },
      { term: 'Automatische Kappung', text: 'Vergessene Ausstempelungen werden nachts zur eingestellten Kappungszeit automatisch geschlossen.' },
      { term: 'ArbZG-Warnungen', text: 'Überschreitungen der maximalen Tagesarbeitszeit oder Unterschreitungen der Mindestruhezeit werden markiert.' },
    ],
  },
  {
    id: 'nfc', title: 'NFC-Chip', icon: FingerPrintIcon,
    intro: 'Persönliches Stempeln per NFC – ohne Login.',
    entries: [
      { text: 'Jedem Mitarbeiter kann ein persönlicher NFC-Chip zugeordnet werden. Beim Scannen öffnet sich die persönliche Stempelseite direkt (Handoff über den FeedAuth-Hub).' },
      { text: 'Ideal für schnelles Kommen/Gehen unterwegs oder am gemeinsamen Gerät, ohne jedes Mal das Passwort einzugeben.' },
      { text: 'Voraussetzung: ein NFC-fähiges Gerät und ein Browser, der Web-NFC unterstützt.' },
    ],
  },
  {
    id: 'terminal', title: 'Kiosk-Terminal', icon: DeviceTabletIcon,
    intro: 'Ein festes Gerät als Stempeluhr für alle.',
    entries: [
      { text: 'Ein Tablet/Rechner läuft als Terminal im Vollbild (Geräte-Token-Anmeldung, kein persönlicher Login).' },
      { term: 'Ausweisen', text: 'Mitarbeiter stempeln per NFC-Ausweis oder persönlicher PIN am Gerät.' },
      { term: 'Offline-Modus', text: 'Fällt das Netz aus, puffert das Terminal die Stempelungen und synchronisiert sie später.' },
      { term: 'Überwachung', text: 'Terminals melden sich per Ping; bleibt ein Gerät zu lange stumm, geht optional eine Störungsmeldung per E-Mail raus.' },
      { term: 'Einstellungs-Schutz', text: 'Das Zahnrad-Menü aller Terminals eines Mandanten lässt sich mit einem zentralen Terminal-Einstellungs-Passwort schützen.' },
    ],
  },
  {
    id: 'gps', title: 'Standort (GPS)', icon: MapPinIcon,
    intro: 'Optionale Standorterfassung beim Stempeln – pro Firma konfigurierbar.',
    entries: [
      { term: 'Modi', text: 'Deaktiviert (kein Standort), Optional (Standard), Akzeptieren mit Warnung oder GPS erforderlich (ohne echten Standort ist kein Stempeln möglich).' },
      { term: 'Genauigkeit', text: 'Ein maximaler Genauigkeitsradius (in Metern) kann verlangt werden, damit ungenaue Ortungen abgewiesen werden.' },
      { text: 'Der GPS-Fix wird beim Öffnen der Stempelseite vorgewärmt, damit das Stempeln nicht wartet. Datenschutz/Mitbestimmung liegen beim Betreiber.' },
    ],
  },
  {
    id: 'meine-zeiten', title: 'Meine Zeiten', icon: ClipboardDocumentListIcon,
    intro: 'Der eigene Überblick.',
    entries: [
      { text: 'Zeigt die eigenen Stempelungen, die Tagesbilanz und die berechnete Arbeitszeit je Tag.' },
      { text: 'Der Zeitkonto-Saldo (Ist gegen Soll, Über-/Minusstunden) wird laufend fortgeschrieben.' },
      { text: 'Für abgeschlossene oder fehlerhafte Tage kann direkt eine Korrektur beantragt werden.' },
    ],
  },
  {
    id: 'zeiten-verwalten', title: 'Zeiten verwalten', icon: PencilSquareIcon,
    intro: 'Für Verwaltung, Buchhaltung und Admin.',
    entries: [
      { term: 'Nachbuchen & stornieren', text: 'Fehlende Stempelungen manuell nachbuchen, fehlerhafte stornieren – nachvollziehbar protokolliert.' },
      { term: 'Korrekturanträge', text: 'Eigener Tab mit offenen Anträgen; ein Zähler-Badge am Menüpunkt zeigt unbearbeitete Anträge.' },
      { term: 'Stundenzettel', text: 'Monats-Stundenzettel je Mitarbeiter als Druck-/PDF-Ansicht.' },
    ],
  },
  {
    id: 'korrekturen', title: 'Korrekturanträge', icon: CheckCircleIcon,
    intro: 'Sauberer Workflow statt stiller Änderungen.',
    entries: [
      { text: 'Mitarbeiter stellen einen Korrekturantrag mit Pflicht-Begründung (z. B. „Ausstempeln vergessen").' },
      { text: 'Verwaltung/Buchhaltung/Admin genehmigen oder lehnen ab – jeweils mit optionaler Notiz. Erst dann ändert sich die Zeit.' },
      { text: 'In einem bereits abgeschlossenen Monat sind keine Korrekturen möglich; der Monat muss zuerst wieder geöffnet werden.' },
    ],
  },
  {
    id: 'monatsabschluss', title: 'Monatsabschluss', icon: ClipboardDocumentListIcon,
    intro: 'Monate sauber schließen, bevor exportiert wird.',
    entries: [
      { text: 'Der Monat lässt sich für alle Mitarbeiter abschließen; danach sind die Zeiten gesperrt.' },
      { text: 'Der Abschluss wird blockiert, solange es unvollständige Tage gibt (z. B. Kommen ohne Gehen) – diese werden aufgelistet.' },
      { text: 'Ein abgeschlossener Monat kann bei Bedarf wieder geöffnet werden.' },
    ],
  },
  {
    id: 'anwesenheit', title: 'Anwesenheit', icon: UserGroupIcon,
    entries: [
      { text: 'Live-Übersicht, wer aktuell anwesend, in Pause oder abwesend ist – gefiltert nach Firma/Mandant.' },
    ],
  },
  {
    id: 'mitarbeiter', title: 'Mitarbeiter, Gruppen & Abteilungen', icon: UsersIcon,
    entries: [
      { text: 'Mitarbeiter-Stammdaten pflegen: Name, Personalnummer, Rolle, Firma/Gruppe, Zeitmodell und NFC-Chip.' },
      { text: 'Gruppen und Abteilungen strukturieren die Mitarbeiter und steuern Sichtbarkeit und Auswertungen.' },
      { text: 'Ausgeschiedene Mitarbeiter zeitnah deaktivieren – gelöschte Datensätze landen im Papierkorb.' },
    ],
  },
  {
    id: 'zeitmodelle', title: 'Zeitmodelle', icon: AdjustmentsHorizontalIcon,
    intro: 'Die Sollzeit-Grundlage jedes Mitarbeiters.',
    entries: [
      { text: 'Ein Zeitmodell definiert die Sollzeit je Wochentag (HH:MM) – Grundlage für Saldo und Überstunden.' },
      { text: 'Inaktive Modelle werden bei der Sollzeit-Berechnung ignoriert.' },
    ],
  },
  {
    id: 'zuschlaege', title: 'Zuschlagsprofile', icon: BanknotesIcon,
    intro: 'Automatische Zuschläge für Nacht-, Sonn- und Feiertagsarbeit.',
    entries: [
      { text: 'Ein Zuschlagsprofil (z. B. „Nachtzuschlag") enthält ein oder mehrere Zeitfenster mit Prozentsatz – Fenster über Mitternacht werden unterstützt.' },
      { text: 'Jedem Profil lässt sich eine Lohnart zuordnen, sodass die Zuschläge im Lohn-Export erscheinen.' },
      { text: 'Inaktive Profile werden bei der Zuschlags-Berechnung ignoriert.' },
    ],
  },
  {
    id: 'abwesenheitsarten', title: 'Abwesenheitsarten', icon: TagIcon,
    entries: [
      { text: 'Abwesenheitsarten (z. B. Urlaub, Krankheit, Homeoffice) mit Farbe und Bezeichnung – teils eingebaut, teils eigene.' },
      { text: 'Je Art ein DATEV- bzw. Lohn-&-Gehalt-Kennzeichen (1 Zeichen) für den Export.' },
    ],
  },
  {
    id: 'export', title: 'Lohn-Export (DATEV / LuG)', icon: ArrowDownTrayIcon,
    intro: 'Für Buchhaltung und Admin.',
    entries: [
      { term: 'DATEV', text: 'Export im DATEV-Format mit Berater- und Mandantennummer.' },
      { term: 'Lohn & Gehalt (LuG)', text: 'Kalendertägliches LuG-Format mit Kennzeichen und Lohnart-Nummer je Abwesenheitsart.' },
      { term: 'Werte', text: 'Soll- und Überstunden je Monat; positiver Monatssaldo optional separat als Überstunden.' },
      { text: 'Die Lohnartnummern je Abwesenheitsart werden zentral hinterlegt und in den Export übernommen.' },
    ],
  },
  {
    id: 'integrationen', title: 'Integrationen & Mitarbeiter-Abgleich', icon: ArrowsRightLeftIcon,
    entries: [
      { text: 'Mitarbeiter lassen sich importieren bzw. mit anderen Systemen abgleichen; das letzte Sync-Ergebnis wird angezeigt.' },
      { text: 'Kopplung mit UrlaubsFeed, damit Abwesenheiten/Urlaube zusammenpassen.' },
    ],
  },
  {
    id: 'mandanten-firmen', title: 'Mandanten & Firmen', icon: BuildingLibraryIcon,
    intro: 'Struktur: Mandant → Firma → Abteilung/Gruppe → Mitarbeiter.',
    entries: [
      { term: 'Mandanten', text: 'Super-Admin verwaltet Mandanten; je Mandant Branding (Name, Farbe, Logo), AVV/AGB und das zentrale Terminal-Passwort.' },
      { term: 'AVV/AGB', text: 'Pro Mandant lassen sich Vertragsdaten pflegen und ein druckbarer Auftragsverarbeitungsvertrag sowie AGB erzeugen.' },
      { term: 'Firmen', text: 'Je Firma u. a. das Bundesland (für Feiertage). Einstellungen gibt es als globale Vorlage und pro Firma.' },
    ],
  },
  {
    id: 'einstellungen', title: 'Einstellungen (Admin)', icon: Cog6ToothIcon,
    intro: 'Zentrale Systemsteuerung mit Reitern.',
    entries: [
      { text: 'Reiter: Allgemein, Zeiterfassung, Unternehmen, E-Mail, Benachrichtigungen, Sicherheit, Integrationen, API-Schlüssel, Audit-Log, Backup, Speicher, Papierkorb, Updates, System.' },
      { term: 'Stundenzettel-Versand', text: 'Automatischer E-Mail-Versand der Monats-Stundenzettel an die eingestellten Empfänger.' },
      { term: 'Firmen-Kontext', text: 'Super-Admin/firmenübergreifende Rollen bearbeiten wahlweise die globale Vorlage oder die Zeile einer bestimmten Firma.' },
    ],
  },
  {
    id: 'backup-speicher', title: 'Backup, Speicher & Papierkorb', icon: ServerStackIcon,
    entries: [
      { term: 'Backup', text: 'Automatische tägliche Datensicherungen mit definierter Aufbewahrung; Restore aus Backup möglich.' },
      { term: 'Speicher (S3)', text: 'Optionaler Sekundärspeicher (S3) für Auslagerung/Redundanz.' },
      { term: 'Papierkorb', text: 'Gelöschte Datensätze landen zuerst im Papierkorb und lassen sich wiederherstellen, bis sie endgültig entfernt werden.' },
    ],
  },
  {
    id: 'sicherheit', title: 'Sicherheit', icon: ShieldCheckIcon,
    entries: [
      { text: 'Konto-Sperre nach zu vielen Fehlversuchen; Passwörter nur als bcrypt-Hash gespeichert.' },
      { text: '„Auf allen Geräten abmelden" entwertet bestehende Sitzungen; die Session-Dauer ist einstellbar.' },
      { text: 'Audit-Log protokolliert sicherheitsrelevante Aktionen mit Zeitstempel.' },
    ],
  },
  {
    id: 'api', title: 'API-Schlüssel', icon: KeyIcon,
    entries: [
      { text: 'Für Anbindungen an Dritt-Systeme lassen sich API-Schlüssel erzeugen und wieder widerrufen.' },
    ],
  },
  {
    id: 'profil', title: 'Profil, Passwort & Dark-Mode', icon: UserCircleIcon,
    entries: [
      { text: 'Im Profil das eigene Passwort ändern und persönliche Angaben pflegen.' },
      { text: 'Sprache (DE/EN) und Hell-/Dunkel-Modus jederzeit über die Kopfleiste umschalten.' },
    ],
  },
  {
    id: 'neuigkeiten', title: 'Feed & Neuigkeiten (Changelog)', icon: SparklesIcon,
    entries: [
      { text: 'Der Feed bündelt Neuigkeiten und Hinweise.' },
      { text: 'Nach einem Update zeigt „Was ist neu" automatisch die Änderungen; die Versionsnummer unten im Menü öffnet den Changelog erneut.' },
    ],
  },
  {
    id: 'papierkorb', title: 'Daten löschen & wiederherstellen', icon: TrashIcon,
    entries: [
      { text: 'Löschungen sind reversibel: Mitarbeiter, Stundenzettel und weitere Datensätze lassen sich aus dem Papierkorb zurückholen, bis sie nach Fristablauf endgültig entfernt werden.' },
    ],
  },
];

const SECTIONS_EN: DocSection[] = [
  {
    id: 'erste-schritte', title: 'Getting started & sign-in', icon: ArrowRightOnRectangleIcon,
    intro: 'How to sign in and find your way around.',
    entries: [
      { text: 'Sign in with your email and password. “Forgot password?” sends a reset link by email (valid for 1 hour).' },
      { text: 'The orange header on top holds the logo, the company/tenant switcher, the DE/EN language toggle, the light/dark switch and the user menu; navigation is on the left. On mobile the menu opens via the burger icon.' },
      { text: 'TimeFeed is a PWA – use “Add to home screen” to run it like an app, offline-capable at the terminal.' },
    ],
  },
  {
    id: 'rollen', title: 'Roles & permissions', icon: UserGroupIcon,
    intro: 'Who is allowed to do what.',
    entries: [
      { term: 'Employee', text: 'Clocks their own time, sees their own times and profile and can request corrections.' },
      { term: 'Administration', text: 'Additionally manages times, employees, groups and presence, decides on correction requests and closes months.' },
      { term: 'Accounting', text: 'Like Administration plus access to the payroll export (DATEV / Lohn & Gehalt).' },
      { term: 'Admin', text: 'Full access including time models, terminals, all system settings, backup, storage (S3) and updates.' },
      { term: 'Super-admin / tenant admin', text: 'Manages tenants and companies across the platform, or their own tenant branding and the DPA/T&C.' },
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard', icon: HomeIcon,
    entries: [
      { text: 'Greeting, current date and a large live clock.' },
      { text: 'Quick access to clocking in/out and an overview of the current status.' },
    ],
  },
  {
    id: 'stempeln', title: 'Clocking (time tracking)', icon: ClockIcon,
    intro: 'Record clock-in, clock-out and breaks – on the computer, via NFC or at the terminal.',
    entries: [
      { term: 'Web app', text: 'Clock in / out / start break / end break with a single click on the clocking page. The current status is shown.' },
      { term: 'Order', text: 'Only sensible actions are possible (e.g. “clock out” only after “clock in”). Impossible actions are disabled.' },
      { term: 'Break rules', text: 'Configurable per company: automatic break deduction (statutory breaks), clocking breaks yourself, or a combination of both.' },
      { term: 'Automatic cut-off', text: 'Forgotten clock-outs are closed automatically at night at the configured cut-off time.' },
      { term: 'Working-hours warnings', text: 'Exceeding the maximum daily working time or falling short of the minimum rest period is flagged (German ArbZG).' },
    ],
  },
  {
    id: 'nfc', title: 'NFC chip', icon: FingerPrintIcon,
    intro: 'Personal clocking via NFC – no login.',
    entries: [
      { text: 'Each employee can be assigned a personal NFC chip. Scanning opens their personal clocking page directly (handoff via the FeedAuth hub).' },
      { text: 'Ideal for quick clock-in/out on the go or at a shared device, without entering a password each time.' },
      { text: 'Requirement: an NFC-capable device and a browser that supports Web NFC.' },
    ],
  },
  {
    id: 'terminal', title: 'Kiosk terminal', icon: DeviceTabletIcon,
    intro: 'A fixed device as a time clock for everyone.',
    entries: [
      { text: 'A tablet/computer runs as a full-screen terminal (device-token sign-in, no personal login).' },
      { term: 'Identify', text: 'Employees clock via NFC badge or a personal PIN at the device.' },
      { term: 'Offline mode', text: 'If the network drops, the terminal buffers the clock events and syncs them later.' },
      { term: 'Monitoring', text: 'Terminals report via ping; if a device stays silent too long, an optional fault alert is sent by email.' },
      { term: 'Settings protection', text: 'The gear menu of all terminals of a tenant can be protected with a central terminal settings password.' },
    ],
  },
  {
    id: 'gps', title: 'Location (GPS)', icon: MapPinIcon,
    intro: 'Optional location capture when clocking – configurable per company.',
    entries: [
      { term: 'Modes', text: 'Disabled (no location), Optional (default), Accept with warning, or GPS required (no clocking without a real location).' },
      { term: 'Accuracy', text: 'A maximum accuracy radius (in metres) can be required so that imprecise fixes are rejected.' },
      { text: 'The GPS fix is warmed up when the clocking page opens so clocking does not wait. Data protection/co-determination are the operator’s responsibility.' },
    ],
  },
  {
    id: 'meine-zeiten', title: 'My times', icon: ClipboardDocumentListIcon,
    intro: 'Your personal overview.',
    entries: [
      { text: 'Shows your own clock events, the daily balance and the calculated working time per day.' },
      { text: 'The time-account balance (actual vs. target, over-/undertime) is updated continuously.' },
      { text: 'For closed or faulty days you can request a correction directly.' },
    ],
  },
  {
    id: 'zeiten-verwalten', title: 'Manage times', icon: PencilSquareIcon,
    intro: 'For Administration, Accounting and Admin.',
    entries: [
      { term: 'Add & cancel', text: 'Add missing clock events manually, cancel faulty ones – logged traceably.' },
      { term: 'Correction requests', text: 'A dedicated tab with open requests; a counter badge on the menu item shows pending requests.' },
      { term: 'Timesheets', text: 'Monthly timesheet per employee as a print/PDF view.' },
    ],
  },
  {
    id: 'korrekturen', title: 'Correction requests', icon: CheckCircleIcon,
    intro: 'A clean workflow instead of silent edits.',
    entries: [
      { text: 'Employees submit a correction request with a mandatory reason (e.g. “forgot to clock out”).' },
      { text: 'Administration/Accounting/Admin approve or reject – each with an optional note. Only then does the time change.' },
      { text: 'In an already closed month no corrections are possible; the month must be reopened first.' },
    ],
  },
  {
    id: 'monatsabschluss', title: 'Month closing', icon: ClipboardDocumentListIcon,
    intro: 'Close months cleanly before exporting.',
    entries: [
      { text: 'The month can be closed for all employees; afterwards the times are locked.' },
      { text: 'Closing is blocked while there are incomplete days (e.g. clock-in without clock-out) – these are listed.' },
      { text: 'A closed month can be reopened when needed.' },
    ],
  },
  {
    id: 'anwesenheit', title: 'Presence', icon: UserGroupIcon,
    entries: [
      { text: 'Live overview of who is currently present, on a break or absent – filtered by company/tenant.' },
    ],
  },
  {
    id: 'mitarbeiter', title: 'Employees, groups & departments', icon: UsersIcon,
    entries: [
      { text: 'Maintain employee master data: name, personnel number, role, company/group, time model and NFC chip.' },
      { text: 'Groups and departments structure the employees and control visibility and reports.' },
      { text: 'Deactivate departing employees promptly – deleted records go to the recycle bin.' },
    ],
  },
  {
    id: 'zeitmodelle', title: 'Time models', icon: AdjustmentsHorizontalIcon,
    intro: 'The target-hours basis for every employee.',
    entries: [
      { text: 'A time model defines the target hours per weekday (HH:MM) – the basis for balance and overtime.' },
      { text: 'Inactive models are ignored in the target-hours calculation.' },
    ],
  },
  {
    id: 'zuschlaege', title: 'Surcharge profiles', icon: BanknotesIcon,
    intro: 'Automatic surcharges for night, Sunday and public-holiday work.',
    entries: [
      { text: 'A surcharge profile (e.g. “night surcharge”) contains one or more time windows with a percentage – windows across midnight are supported.' },
      { text: 'Each profile can be assigned a wage type so the surcharges appear in the payroll export.' },
      { text: 'Inactive profiles are ignored in the surcharge calculation.' },
    ],
  },
  {
    id: 'abwesenheitsarten', title: 'Absence types', icon: TagIcon,
    entries: [
      { text: 'Absence types (e.g. holiday, sickness, home office) with colour and label – some built in, some custom.' },
      { text: 'Each type has a DATEV / Lohn & Gehalt code (1 character) for the export.' },
    ],
  },
  {
    id: 'export', title: 'Payroll export (DATEV / LuG)', icon: ArrowDownTrayIcon,
    intro: 'For Accounting and Admin.',
    entries: [
      { term: 'DATEV', text: 'Export in DATEV format with consultant and client number.' },
      { term: 'Lohn & Gehalt (LuG)', text: 'Per-calendar-day LuG format with a code and wage-type number per absence type.' },
      { term: 'Values', text: 'Target and overtime hours per month; a positive monthly balance optionally shown separately as overtime.' },
      { text: 'The wage-type numbers per absence type are stored centrally and carried into the export.' },
    ],
  },
  {
    id: 'integrationen', title: 'Integrations & employee sync', icon: ArrowsRightLeftIcon,
    entries: [
      { text: 'Employees can be imported or synced with other systems; the last sync result is shown.' },
      { text: 'Coupling with UrlaubsFeed so absences/holidays stay in sync.' },
    ],
  },
  {
    id: 'mandanten-firmen', title: 'Tenants & companies', icon: BuildingLibraryIcon,
    intro: 'Structure: tenant → company → department/group → employee.',
    entries: [
      { term: 'Tenants', text: 'The super-admin manages tenants; per tenant there is branding (name, colour, logo), DPA/T&C and the central terminal password.' },
      { term: 'DPA/T&C', text: 'Per tenant you can maintain contract data and generate a printable data-processing agreement and terms & conditions.' },
      { term: 'Companies', text: 'Per company e.g. the federal state (for public holidays). Settings exist as a global template and per company.' },
    ],
  },
  {
    id: 'einstellungen', title: 'Settings (admin)', icon: Cog6ToothIcon,
    intro: 'Central system control with tabs.',
    entries: [
      { text: 'Tabs: General, Time tracking, Company, Email, Notifications, Security, Integrations, API keys, Audit log, Backup, Storage, Recycle bin, Updates, System.' },
      { term: 'Timesheet dispatch', text: 'Automatic email dispatch of the monthly timesheets to the configured recipients.' },
      { term: 'Company context', text: 'Super-admin / cross-company roles edit either the global template or the row of a specific company.' },
    ],
  },
  {
    id: 'backup-speicher', title: 'Backup, storage & recycle bin', icon: ServerStackIcon,
    entries: [
      { term: 'Backup', text: 'Automatic daily backups with a defined retention; restore from backup is possible.' },
      { term: 'Storage (S3)', text: 'Optional secondary storage (S3) for offloading/redundancy.' },
      { term: 'Recycle bin', text: 'Deleted records go to the recycle bin first and can be restored until they are removed permanently.' },
    ],
  },
  {
    id: 'sicherheit', title: 'Security', icon: ShieldCheckIcon,
    entries: [
      { text: 'Account lockout after too many failed attempts; passwords stored only as a bcrypt hash.' },
      { text: '“Sign out on all devices” invalidates existing sessions; the session duration is configurable.' },
      { text: 'The audit log records security-relevant actions with a timestamp.' },
    ],
  },
  {
    id: 'api', title: 'API keys', icon: KeyIcon,
    entries: [
      { text: 'For connections to third-party systems you can create and revoke API keys.' },
    ],
  },
  {
    id: 'profil', title: 'Profile, password & dark mode', icon: UserCircleIcon,
    entries: [
      { text: 'Change your own password and maintain personal details in the profile.' },
      { text: 'Switch language (DE/EN) and light/dark mode any time via the header.' },
    ],
  },
  {
    id: 'neuigkeiten', title: 'Feed & news (changelog)', icon: SparklesIcon,
    entries: [
      { text: 'The feed bundles news and notices.' },
      { text: 'After an update “What’s new” shows the changes automatically; the version number at the bottom of the menu reopens the changelog.' },
    ],
  },
  {
    id: 'papierkorb', title: 'Deleting & restoring data', icon: TrashIcon,
    entries: [
      { text: 'Deletions are reversible: employees, timesheets and other records can be recovered from the recycle bin until they are removed permanently after the retention period.' },
    ],
  },
];

const UI = {
  de: {
    intro: 'Vollständige Anleitung zu TimeFeed. Tipp: nutzen Sie die Suche oder springen Sie über die Themen direkt zum Abschnitt.',
    searchPlaceholder: 'Dokumentation durchsuchen …',
    noResults: (q: string) => `Keine Treffer für „${q}".`,
  },
  en: {
    intro: 'Complete guide to TimeFeed. Tip: use the search or jump straight to a section via the topics.',
    searchPlaceholder: 'Search documentation …',
    noResults: (q: string) => `No results for “${q}”.`,
  },
};

export default function DokumentationContent() {
  const { lang } = useI18n();
  const [query, setQuery] = useState('');
  const SECTIONS = lang === 'en' ? SECTIONS_EN : SECTIONS_DE;
  const ui = lang === 'en' ? UI.en : UI.de;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS
      .map((s) => {
        const hitTitle = (s.title + ' ' + (s.intro || '')).toLowerCase().includes(q);
        const entries = s.entries.filter((e) => `${e.term || ''} ${e.text}`.toLowerCase().includes(q));
        if (hitTitle) return s;
        if (entries.length) return { ...s, entries };
        return null;
      })
      .filter(Boolean) as DocSection[];
  }, [query, SECTIONS]);

  return (
    <div className="not-prose space-y-5">
      <p className="text-slate-600 dark:text-gray-400">{ui.intro}</p>

      <SearchInput value={query} onChange={setQuery} placeholder={ui.searchPlaceholder} />

      {!query && (
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200 transition-colors"
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.title}
            </a>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-slate-500">{ui.noResults(query)}</p>
      )}

      {filtered.map((s) => (
        <section
          key={s.id}
          id={s.id}
          className="scroll-mt-24 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/40 p-2">
              <s.icon className="h-5 w-5 text-primary-600 dark:text-primary-300" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white m-0">{s.title}</h2>
          </div>
          {s.intro && <p className="text-sm text-slate-500 dark:text-gray-400 mb-3">{s.intro}</p>}
          <ul className="space-y-2">
            {s.entries.map((e, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-gray-300">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary-400 flex-shrink-0" />
                <span>{e.term ? <><span className="font-semibold text-slate-900 dark:text-white">{e.term}:</span> {e.text}</> : e.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
