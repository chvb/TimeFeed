import { EnvelopeIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';
import LegalSection from './LegalSection';

export default function KontaktContent() {
  return (
    <div className="not-prose space-y-5">
      <LegalSection icon={EnvelopeIcon} title="Kontakt">
        <p>Bei Fragen zu TimeFeed erreichen Sie uns per E-Mail:</p>
        <p className="mt-1"><a href="mailto:christoph@vanbrackel.de">christoph@vanbrackel.de</a></p>
      </LegalSection>

      <LegalSection icon={BuildingOfficeIcon} title="Anschrift">
        <address className="not-italic">
          Christoph van Brackel<br />
          Barbaraweg 5<br />
          47559 Kranenburg<br />
          Deutschland
        </address>
      </LegalSection>
    </div>
  );
}
