import { useMemo, useState } from 'react';
import SearchInput from '../common/SearchInput';
import {
  ArrowRightOnRectangleIcon, UserGroupIcon, HomeIcon, ClockIcon, UsersIcon,
  TrashIcon, Cog6ToothIcon, UserCircleIcon, SparklesIcon,
} from '@heroicons/react/24/outline';

interface DocEntry { term?: string; text: string }
interface DocSection { id: string; title: string; icon: any; intro?: string; entries: DocEntry[] }

const SECTIONS: DocSection[] = [
  {
    id: 'erste-schritte', title: 'Erste Schritte & Anmeldung', icon: ArrowRightOnRectangleIcon,
    intro: 'So melden Sie sich an und finden sich zurecht.',
    entries: [
      { text: 'Anmeldung mit E-Mail und Passwort. „Passwort vergessen?" sendet einen Reset-Link per E-Mail (1 Stunde gültig).' },
      { text: 'Oben die orange Kopfleiste (Logo, Benutzer-Menü, Hell/Dunkel-Umschalter), links die Navigation. Auf Mobilgeräten klappt das Menü über das Burger-Symbol auf.' },
      { text: 'TimeFeed ist eine PWA – über „zum Startbildschirm hinzufügen" wie eine App nutzbar.' },
    ],
  },
  {
    id: 'rollen', title: 'Rollen & Berechtigungen', icon: UserGroupIcon,
    intro: 'Welche Rolle was darf.',
    entries: [
      { term: 'Mitarbeiter', text: 'Sieht das eigene Dashboard und das eigene Profil.' },
      { term: 'Manager', text: 'Zusätzlich: Zugriff auf Mitarbeiter- und Gruppenübersicht der eigenen Teams.' },
      { term: 'HR (Personal)', text: 'Zusätzlich: verwaltet Mitarbeiter-Stammdaten, Gruppen und den Papierkorb.' },
      { term: 'Admin', text: 'Vollzugriff inkl. aller Systemeinstellungen, Rollen, Backup, Speicher (S3) und Updates.' },
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard', icon: HomeIcon,
    entries: [
      { text: 'Zeigt eine Begrüßung, das aktuelle Datum und eine große Live-Uhr.' },
      { text: 'Die Karte „Zeiterfassung" ist ein Ausblick: Kommen/Gehen-Stempeln wird mit dem nächsten Update freigeschaltet.' },
    ],
  },
  {
    id: 'zeiterfassung', title: 'Zeiterfassung (in Vorbereitung)', icon: ClockIcon,
    intro: 'Die Kernfunktionen der Zeiterfassung folgen im nächsten Update.',
    entries: [
      { term: 'Kommen/Gehen', text: 'Arbeitsbeginn und -ende per Klick stempeln — direkt vom Dashboard.' },
      { term: 'Zeitmodelle', text: 'Gruppen erhalten künftig Zeitmodelle (Soll-Arbeitszeiten), gegen die gestempelte Zeiten ausgewertet werden.' },
      { term: 'Auswertungen', text: 'Übersichten über erfasste Zeiten und Salden sind geplant.' },
    ],
  },
  {
    id: 'mitarbeiter', title: 'Mitarbeiter, Gruppen & Abteilungen', icon: UsersIcon,
    entries: [
      { text: 'HR/Admin legen Benutzer an (Name, E-Mail, Rolle, Abteilung/Position, Personalnummer, Eintritts-/Austrittsdatum, Beschäftigungsgrad).' },
      { text: 'Unter „Gruppen & Abteilungen" werden Teams und ihre (auch mehreren) Manager verwaltet.' },
    ],
  },
  {
    id: 'papierkorb', title: 'Papierkorb', icon: TrashIcon,
    entries: [
      { text: 'Gelöschte Einträge (Mitarbeiter, Gruppen) bleiben 30 Tage erhalten und können wiederhergestellt werden. Danach erfolgt die automatische endgültige Löschung.' },
    ],
  },
  {
    id: 'einstellungen', title: 'Einstellungen (Admin)', icon: Cog6ToothIcon,
    intro: 'In Tabs gegliedert.',
    entries: [
      { term: 'Allgemein / Unternehmen', text: 'Firmendaten, Arbeitstage, Stunden pro Arbeitstag.' },
      { term: 'E-Mail / Sicherheit', text: 'SMTP, Passwort-Richtlinie & Login-Schutz.' },
      { term: 'Backup / Speicher / Papierkorb / Updates', text: 'Backup (lokal + S3), Objektspeicher, Papierkorb, In-App-Updates.' },
    ],
  },
  {
    id: 'profil', title: 'Profil, Passwort & Dark-Mode', icon: UserCircleIcon,
    entries: [
      { text: 'Über das Benutzer-Menü (oben rechts) zu „Profil" und „Abmelden".' },
      { text: 'Im Profil das Passwort ändern (gemäß Richtlinie).' },
      { text: 'Hell/Dunkel-Modus über das Sonne/Mond-Symbol in der Kopfleiste.' },
    ],
  },
  {
    id: 'neuigkeiten', title: 'Neuigkeiten (Changelog)', icon: SparklesIcon,
    entries: [
      { text: 'Im Footer auf die Versionsnummer klicken, um „Was ist neu" zu öffnen. Bei neuer Version erscheint der Changelog einmalig automatisch.' },
    ],
  },
];

export default function DokumentationContent() {
  const [query, setQuery] = useState('');

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
  }, [query]);

  return (
    <div className="not-prose space-y-5">
      <p className="text-slate-600 dark:text-gray-400">
        Vollständige Anleitung zu TimeFeed. Tipp: nutzen Sie die Suche oder springen Sie über die Themen direkt zum Abschnitt.
      </p>

      <SearchInput value={query} onChange={setQuery} placeholder="Dokumentation durchsuchen …" />

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
        <p className="text-slate-500">Keine Treffer für „{query}".</p>
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
