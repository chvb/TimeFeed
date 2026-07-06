import { BuildingOfficeIcon, EnvelopeIcon, UserIcon, ShieldExclamationIcon, LinkIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import LegalSection from './LegalSection';

export default function ImpressumContent() {
  return (
    <div className="not-prose space-y-5">
      <LegalSection icon={BuildingOfficeIcon} title="Angaben gemäß § 5 TMG">
        <address className="not-italic">
          Christoph van Brackel<br />
          Barbaraweg 5<br />
          47559 Kranenburg<br />
          Deutschland
        </address>
      </LegalSection>

      <LegalSection icon={EnvelopeIcon} title="Kontakt">
        <p>E-Mail: <a href="mailto:christoph@vanbrackel.de">christoph@vanbrackel.de</a></p>
      </LegalSection>

      <LegalSection icon={UserIcon} title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <address className="not-italic">
          Christoph van Brackel<br />
          Barbaraweg 5<br />
          47559 Kranenburg
        </address>
      </LegalSection>

      <LegalSection icon={ShieldExclamationIcon} title="Haftung für Inhalte">
        <p>
          Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen
          Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet,
          übermittelte oder gespeicherte fremde Informationen zu überwachen.
        </p>
      </LegalSection>

      <LegalSection icon={LinkIcon} title="Haftung für Links">
        <p>
          Unser Angebot enthält ggf. Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben.
          Für diese fremden Inhalte ist stets der jeweilige Anbieter verantwortlich.
        </p>
      </LegalSection>

      <LegalSection icon={DocumentTextIcon} title="Urheberrecht">
        <p>Die durch die Betreiber erstellten Inhalte und Werke unterliegen dem deutschen Urheberrecht.</p>
      </LegalSection>
    </div>
  );
}
