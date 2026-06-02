import type { Metadata } from "next";
import LegalDocument, { type LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy · PureProperty.ca",
  description:
    "How PureProperty.ca collects, uses, and safeguards your personal information (PIPEDA).",
  robots: { index: true, follow: true },
};

// TODO(legal): have this document reviewed by counsel for accuracy against actual
// data practices and PIPEDA (see the final section) before relying on it.
const EFFECTIVE_DATE = "June 1, 2026";
const CONTACT_EMAIL = "support@pureproperty.ca";

const TITLE = "PureProperty.ca Privacy Policy";

const INTRO = `This Privacy Policy explains how PureProperty.ca ("PureProperty," "we," "us," or "our") collects, uses, discloses, and safeguards your personal information when you use our website and services (the "Service"). PureProperty.ca is a real estate data platform operating in Ontario, Canada that displays active listings through the TRREB/PROPTX IDX feed and provides sold/closed listings together with deterministic, automated analytics — including an automated valuation estimate, Deal Score, cap rate, and True days-on-market — to registered, signed-in users through the TRREB/PROPTX VOW (Virtual Office Website) feed. We are committed to handling your personal information in accordance with Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable Ontario law. Listing data displayed on the Service is licensed from PROPTX/TRREB and remains their intellectual property; this Policy concerns the personal information of users of the Service, not the licensed listing content itself. Effective Date: ${EFFECTIVE_DATE}.`;

const SECTIONS: LegalSection[] = [
  {
    heading: "1. Who We Are and Scope of This Policy",
    paragraphs: [
      `PureProperty.ca is the operator of the Service and is the organization responsible and accountable, under PIPEDA, for the personal information collected through it. This accountability extends to personal information processed on our behalf by the third-party service providers described in this Policy.`,
      `This Policy applies to personal information we collect from visitors and registered users of the Service. It does not apply to the licensed listing content (active, sold, and closed property records) supplied by PROPTX/TRREB, which is governed by their feed agreements and remains their intellectual property. Where you follow links to third-party websites, this Policy does not apply to those sites, and we encourage you to review their own privacy practices.`,
      `If you have questions about this Policy or how we handle your personal information, you may contact us at ${CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: "2. Personal Information We Collect",
    paragraphs: [
      `Account and authentication information. To create and access an account, we collect your email address, which we use to send passwordless "magic-link" sign-in emails. Because authentication is passwordless, we do not collect or store a password. We also generate and maintain session tokens that keep you securely signed in across visits.`,
      `Profile and watchlist information. When you use optional features, we store the listings you add to your watchlist and the preferences associated with your account, so that your saved properties and settings can be synchronized across the devices you sign in from. If you opt in to price-drop alerts, we record that preference and the specific listings you wish to be alerted about.`,
      `Usage, device, and technical information. As you use the Service, we automatically collect product-usage analytics (such as the features you interact with and the searches you run), your IP address, and device and browser characteristics. We also use cookies and browser local and session storage to operate the Service, as described in the Cookies section below.`,
      `We collect only the personal information that is reasonably necessary for the purposes described in this Policy, and we limit our collection accordingly.`,
    ],
  },
  {
    heading: "3. How and Why We Use Your Personal Information",
    paragraphs: [
      `We use the email address you provide to authenticate your sign-in by sending and validating magic-link emails, and we use session tokens to keep you securely signed in. We use your account, profile, and watchlist information to save the listings you choose to monitor and to synchronize that watchlist across your devices.`,
      `If you have opted in, we use your email address and your saved listings to send you the price-drop email alerts you requested. These alerts are generated through deterministic, rule-based comparisons of listing data. We do not use any artificial intelligence or large-language-model processing of listing data to produce alerts, valuations, Deal Scores, cap rates, days-on-market figures, or any other analytics on the Service.`,
      `We use your account and usage information to personalize your dashboard, and we use usage, device, and technical information to secure, operate, maintain, troubleshoot, and improve the Service, including detecting and preventing fraud and abuse. We also use your information as necessary to meet our legal and contractual obligations, including obligations under the VOW and IDX rules that govern access to and display of listing data.`,
      `We rely on your consent to collect and use your personal information for these purposes, and, in some cases, on the necessity of processing to provide the Service you have requested or to comply with applicable law.`,
    ],
  },
  {
    heading: "4. Consent and How to Withdraw It",
    paragraphs: [
      `By creating an account and using the Service, you consent to the collection, use, and disclosure of your personal information as described in this Policy. Where the law requires it, or where we wish to use your information for a new purpose not described here, we will seek your consent. Opt-in features such as price-drop email alerts require your express consent, which you provide by enabling them.`,
      `You may withdraw your consent at any time, subject to legal and contractual restrictions and reasonable notice. You can unsubscribe from price-drop alerts using the link in any alert email or through your account settings, and you can withdraw broader consent by deleting your account or by contacting us at ${CONTACT_EMAIL}.`,
      `Please note that withdrawing consent for certain processing — such as authentication or core account functions — may mean we can no longer provide some or all of the Service to you.`,
    ],
  },
  {
    heading: "5. We Do Not Sell Your Personal Information",
    paragraphs: [
      `We do not sell, rent, or trade your personal information to any third party, and we do not disclose it for any third party's own independent marketing purposes. We share personal information only with the service providers that help us operate the Service, as described in the next section, and only where required to do so by law or to protect our legal rights.`,
    ],
  },
  {
    heading: "6. Third-Party Service Providers",
    paragraphs: [
      `We engage a small number of trusted third-party processors to operate the Service on our behalf. These providers act under our instructions and are authorized to use your personal information only to provide their services to us, not for their own purposes.`,
      `Specifically, we use Supabase for user authentication (including issuing magic-link sign-ins) and for database hosting of account, profile, and watchlist data; Resend to deliver transactional emails and the price-drop alert emails you opt into; Mapbox to provide maps and geocoding within the Service; Typesense to power fast listing search; and Railway to host the application that runs the Service.`,
      `We choose providers that offer appropriate safeguards and bind them by contract to protect personal information consistent with this Policy and applicable law. We may also disclose personal information where required by law, to comply with legal process, or where reasonably necessary to protect the rights, property, or safety of PureProperty, our users, or others.`,
    ],
  },
  {
    heading: "7. Cookies, Local Storage, and Session Storage",
    paragraphs: [
      `We use cookies and browser local and session storage to operate the Service. These technologies keep you signed in by storing session tokens, remember your preferences and dashboard state, and support security and basic product-usage analytics so that we can understand how the Service is used and improve it.`,
      `Most of these technologies are necessary for the Service to function — for example, to maintain your authenticated session. You can configure your browser to block or delete cookies and to clear local and session storage, but doing so may impair sign-in and other core features. Because some storage is essential to authentication, disabling it may prevent you from using your account.`,
    ],
  },
  {
    heading: "8. Data Retention",
    paragraphs: [
      `We retain your personal information only for as long as it is needed to fulfill the purposes described in this Policy, to provide the Service to you, and to meet our legal, regulatory, and contractual obligations, including obligations under the VOW and IDX rules.`,
      `We retain account, profile, and watchlist information for as long as your account remains active. When you delete your account or ask us to delete your information, we will delete or de-identify your personal information within a reasonable period, except where we are required or permitted by law to retain certain records. Server logs and technical data are kept for a limited period appropriate to security and operational needs and are then deleted or de-identified.`,
    ],
  },
  {
    heading: "9. Security Safeguards",
    paragraphs: [
      `We maintain administrative, technical, and physical safeguards designed to protect your personal information against loss, theft, and unauthorized access, disclosure, copying, use, or modification. These measures include encrypted transmission of data over the Internet, access controls and row-level security on our database, passwordless authentication that avoids stored passwords, and limiting access to personal information to those who need it to operate the Service.`,
      `While we take reasonable steps to protect your information, no method of transmission or storage is completely secure, and we cannot guarantee absolute security. If we become aware of a breach of security safeguards that creates a real risk of significant harm, we will notify affected individuals and the appropriate authorities as required by PIPEDA.`,
    ],
  },
  {
    heading: "10. Your Rights: Access, Correction, Deletion, and Unsubscribe",
    paragraphs: [
      `Subject to applicable law, you have the right to access the personal information we hold about you and to request that it be corrected if it is inaccurate or incomplete. You may also request deletion of your personal information and the closure of your account.`,
      `You can manage much of your information directly: you can edit your watchlist, change your alert preferences, and unsubscribe from price-drop alerts using the link in any alert email or through your account settings. For access, correction, or deletion requests that you cannot complete yourself, contact us at ${CONTACT_EMAIL}.`,
      `We will respond to verified requests within the timeframes required by PIPEDA. We may need to verify your identity before acting on a request, and in limited circumstances we may be unable to fulfill a request — for example, where doing so would reveal another person's information or where retention is required by law; in such cases we will explain the reason.`,
    ],
  },
  {
    heading: "11. Children and Minors",
    paragraphs: [
      `The Service is intended for analytical real estate users and is not directed to children. We do not knowingly collect personal information from individuals under the age of 18. If you are under 18, please do not create an account or provide personal information to us. If we learn that we have collected personal information from a person under 18, we will take reasonable steps to delete it. If you believe a minor has provided us with personal information, please contact us at ${CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: "12. Cross-Border Data Processing",
    paragraphs: [
      `Some of our third-party service providers may store or process personal information on servers located outside of Canada, including in the United States. As a result, your personal information may be subject to the laws of the jurisdictions in which it is processed and may be accessible to courts, law enforcement, and authorities in those jurisdictions in accordance with their laws.`,
      `Where personal information is processed outside of Canada, we use contractual and other measures to require our providers to protect it consistent with this Policy and Canadian privacy law. By using the Service, you acknowledge that your personal information may be transferred to and processed in other countries for the purposes described in this Policy.`,
    ],
  },
  {
    heading: "13. Changes to This Policy",
    paragraphs: [
      `We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or the Service. When we make changes, we will revise the Effective Date at the top of this Policy and post the updated version on the Service.`,
      `If the changes are material, we will provide more prominent notice, which may include emailing registered users or displaying a notice within the Service. Your continued use of the Service after an updated Policy takes effect constitutes your acceptance of the changes, except where additional consent is required by law.`,
    ],
  },
  {
    heading: "14. How to Contact Us",
    paragraphs: [
      `If you have questions, concerns, or requests regarding this Privacy Policy or your personal information — including requests to access, correct, or delete your information, or to withdraw consent — you may contact our privacy contact at ${CONTACT_EMAIL}.`,
      `If you are not satisfied with our response to a privacy concern, you have the right to contact the Office of the Privacy Commissioner of Canada, which oversees compliance with PIPEDA.`,
    ],
  },
  {
    heading: "15. Template Notice and Legal Review",
    paragraphs: [
      `This document is a template provided for drafting purposes only and does not constitute legal advice. Before it is published or relied upon, it should be reviewed and adapted by qualified legal counsel to ensure it accurately reflects PureProperty.ca's actual data practices and complies with PIPEDA and all other applicable laws.`,
      `In addition, any companion Terms of Service or terms governing access to listing data should be reviewed by counsel and confirmed against the current PROPTX VOW Policy and Rules (and applicable IDX rules) before being relied upon.`,
    ],
  },
];

export default function PrivacyPage() {
  return <LegalDocument title={TITLE} intro={INTRO} sections={SECTIONS} />;
}
