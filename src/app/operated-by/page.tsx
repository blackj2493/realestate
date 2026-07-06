import type { Metadata } from "next";
import LegalDocument, { type LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Operated By · PureProperty.ca",
  description:
    "The brokerage and licensing under which PureProperty.ca operates its VOW and IDX listing display.",
  robots: { index: true, follow: true },
};

// TODO(broker-of-record): before relying on this, confirm with the Broker of Record
// (Katherine Milian, eXp) the registrant's exact REGISTERED name and title (Salesperson /
// Broker) and the brokerage's exact REGISTERED legal name — TRESA advertising rules govern
// the precise wording, and the Brokerage carries liability for the VOW's compliance.
const TITLE = "Operated By";

const INTRO: string[] = [
  `PureProperty.ca is a Virtual Office Website ("VOW") and Internet Data Exchange ("IDX") listing display, operated under licence from PropTx Innovations Inc. ("PROPTX") and the Toronto Regional Real Estate Board ("TRREB").`,
];

const SECTIONS: LegalSection[] = [
  {
    heading: "Operating brokerage",
    paragraphs: [
      `PureProperty.ca is operated by Tanmay Rao, a registrant with eXp Realty, Brokerage (4711 Yonge Street, 10th Floor, Toronto, Ontario), under the PROPTX VOW and IDX Data Agreements. Real estate listing information displayed on the Service is licensed from PROPTX/TRREB and remains their intellectual property.`,
      `Questions about the Service, or about its brokerage and licensing, can be directed to support@pureproperty.ca.`,
    ],
  },
];

export default function OperatedByPage() {
  return <LegalDocument title={TITLE} intro={INTRO} sections={SECTIONS} />;
}
