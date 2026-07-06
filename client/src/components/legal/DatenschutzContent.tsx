// Ersetzt keine Rechtsberatung.
import {
  UserIcon, ServerStackIcon, CircleStackIcon, KeyIcon, PaperAirplaneIcon, ClockIcon,
  ScaleIcon, MegaphoneIcon, LockClosedIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline';
import LegalSection from './LegalSection';

export default function DatenschutzContent() {
  return (
    <div className="not-prose space-y-5">
      <p className="text-sm text-slate-500 dark:text-gray-400">Stand: 2026</p>

      <LegalSection icon={UserIcon} title="1. Verantwortlicher">
        <address className="not-italic">
          Christoph van Brackel<br />
          Barbaraweg 5<br />
          47559 Kranenburg, Deutschland<br />
          E-Mail: <a href="mailto:christoph@vanbrackel.de">christoph@vanbrackel.de</a>
        </address>
      </LegalSection>

      <LegalSection icon={ServerStackIcon} title="2. Datenstandort und Hosting">
        <p>
          Sämtliche Anwendungs- und Nutzerdaten (Datenbank, Backups) werden in einem Rechenzentrum in Deutschland
          verarbeitet und gespeichert. Als Hosting-Anbieter setzen wir die <strong>Hetzner Online GmbH</strong>,
          Industriestr. 25, 91710 Gunzenhausen, im Rahmen einer Auftragsverarbeitung gemäß Art. 28 DSGVO ein.
          Eine Weitergabe an weitere Dritte erfolgt nur, soweit nachfolgend beschrieben.
        </p>
      </LegalSection>

      <LegalSection icon={CircleStackIcon} title="3. Verarbeitete Daten">
        <ul>
          <li><strong>Account-Daten:</strong> Name, E-Mail, Rolle, Abteilung/Position, Personalnummer, Eintritts-/Austrittsdatum. Rechtsgrundlage: Art. 6 Abs. 1 lit. b/f DSGVO.</li>
          <li><strong>Zeiterfassungsdaten:</strong> erfasste Arbeitszeiten (Kommen/Gehen, Datum, Dauer). Rechtsgrundlage: Art. 6 Abs. 1 lit. b/c DSGVO i. V. m. § 26 BDSG.</li>
          <li><strong>Audit-Logs:</strong> sicherheitsrelevante Aktionen mit Benutzer-ID und Zeitstempel. Grundlage: Art. 6 Abs. 1 lit. f DSGVO.</li>
          <li><strong>Server-Logs:</strong> technische Protokolle zur Fehlersuche/Sicherheit.</li>
        </ul>
      </LegalSection>

      <LegalSection icon={KeyIcon} title="4. Cookies / lokaler Speicher">
        <p>
          Nur technisch notwendige Daten im lokalen Speicher (Anmelde-Token, Anzeige-Einstellungen wie Dark-Mode).
          Kein Tracking – kein Einwilligungsbanner nach § 25 TDDDG.
        </p>
      </LegalSection>

      <LegalSection icon={PaperAirplaneIcon} title="5. Empfänger der Daten">
        <ul>
          <li>E-Mail-Versand (Benachrichtigungen/Passwort-Reset) über einen E-Mail-Dienstleister im Rahmen einer Auftragsverarbeitung gemäß Art. 28 DSGVO.</li>
          <li>Optionaler Objektspeicher (S3) für Backups/Anhänge – sofern aktiviert, im Rahmen einer Auftragsverarbeitung.</li>
        </ul>
      </LegalSection>

      <LegalSection icon={ClockIcon} title="6. Speicherdauer">
        <p>
          Speicherung für die Dauer des Beschäftigungsverhältnisses bzw. solange für die Zwecke erforderlich;
          danach Löschung/Anonymisierung (gesetzliche Fristen bleiben unberührt). Gelöschte Datensätze verbleiben
          bis zu 30 Tage im Papierkorb und werden anschließend automatisch endgültig entfernt.
        </p>
      </LegalSection>

      <LegalSection icon={ScaleIcon} title="7. Ihre Rechte">
        <ul>
          <li>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21).</li>
          <li>Zur Ausübung wenden Sie sich an den oben genannten Verantwortlichen.</li>
        </ul>
      </LegalSection>

      <LegalSection icon={MegaphoneIcon} title="8. Beschwerderecht">
        <p>Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren – etwa am Sitz des Verantwortlichen: Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen.</p>
      </LegalSection>

      <LegalSection icon={LockClosedIcon} title="9. Datensicherheit">
        <p>Übertragung per TLS, Passwörter mit bcrypt gehasht, rollenbasierte Zugriffsbeschränkung.</p>
      </LegalSection>

      <LegalSection icon={ArrowPathIcon} title="10. Änderungen">
        <p>Diese Datenschutzerklärung kann angepasst werden; es gilt die jeweils aktuelle Fassung.</p>
      </LegalSection>
    </div>
  );
}
