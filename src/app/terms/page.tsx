import type { Metadata } from "next";
import LegalDocument, { type LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "VOW Terms of Use · PureProperty.ca",
  description:
    "The Terms of Use governing access to the registered, VOW areas of PureProperty.ca.",
  robots: { index: true, follow: true },
};

// TODO(legal): have this document reviewed by counsel and confirmed against the
// current PROPTX VOW Policy and Rules (see the final section) before relying on it.
const EFFECTIVE_DATE = "June 1, 2026";
const CONTACT_EMAIL = "support@pureproperty.ca";

const TITLE = "PureProperty.ca — VOW Terms of Use";

const INTRO = `These VOW Terms of Use ("Terms") govern your access to and use of the registered, signed-in areas of PureProperty.ca (the "Service"), operated as a Virtual Office Website ("VOW") and IDX display under licence from PROPTX and the Toronto Regional Real Estate Board ("TRREB"). PureProperty.ca displays active listings, sold and closed listings, and deterministically computed analytics derived from real estate listing data. By creating an account or signing in, you agree to be bound by these Terms. If you do not agree, do not register for or use the registered areas of the Service. Effective Date: ${EFFECTIVE_DATE}.`;

const SECTIONS: LegalSection[] = [
  {
    heading: "1. About the Service and What You Are Accessing",
    paragraphs: [
      `PureProperty.ca presents two categories of real estate listing information. Active listings are made available through an IDX (Internet Data Exchange) display and may be viewed publicly. Sold and closed listing information, together with VOW-derived analytics such as our automated valuation estimate, Deal Score, estimated cap rate, and True days-on-market, are made available only through a Virtual Office Website (VOW) and only to registered users who have created an account and signed in.`,
      `Access to the VOW portions of the Service requires registration because the underlying data is licensed under the PROPTX VOW Policy and Rules, which condition the display of sold and certain other listing information on the establishment of a lawful consumer relationship through a registered account. The analytics we display are calculated using deterministic, hard-coded logic. We do not pass listing information through any artificial intelligence or large language model for transformation or interpretation.`,
      `These Terms apply specifically to your use of the VOW and registered areas. Your use of the public, non-registered portions of the Service is also subject to any general site terms and our Privacy Policy.`,
    ],
  },
  {
    heading: "2. Eligibility and Bona Fide Consumer Status",
    paragraphs: [
      `By registering for and using the Service, you represent and warrant that you are at least the age of majority in your province or territory of residence, and that you have a bona fide, genuine interest in the purchase, sale, or lease of real estate. You confirm that you are accessing the data in furtherance of that genuine interest and not for any other reason.`,
      `You agree that you will use the listing information available through the Service solely for your own personal, non-commercial purposes and for no other purpose. You will not use the information, in whole or in part, for any commercial purpose, for any purpose unrelated to your bona fide interest in the purchase, sale, or lease of real estate, or in any manner not expressly permitted by these Terms.`,
      `If your interest in real estate is professional, brokerage-related, or otherwise commercial in nature, the registered VOW areas of the Service are not licensed for your use, and you must not access them under this consumer registration.`,
    ],
  },
  {
    heading: "3. Permitted Use and Strict Restrictions on the Listing Data",
    paragraphs: [
      `The listing information displayed through the Service is provided to you for your personal viewing only. You may view listings, save them to your watchlist, and use the information to inform your own real estate decisions. No other use is granted, and all rights not expressly granted to you are reserved by PROPTX, TRREB, the participating member brokerages, and us.`,
      `You will not, and will not permit or assist any other person to, copy, reproduce, redistribute, retransmit, republish, frame, mirror, scrape, harvest, data-mine, index, aggregate, store beyond your ordinary personal use, download in bulk, or otherwise extract the listing information, nor create any derivative product, compilation, database, or work from it.`,
      `You will not use any robot, spider, crawler, scraper, automated script, bot, headless browser, or any artificial intelligence or machine-learning system to access, monitor, query, copy, collect, or process any portion of the Service or the listing information. Access to the Service must be through ordinary, interactive, human-driven use of a standard web browser, consistent with the functionality we make available.`,
    ],
  },
  {
    heading: "4. Accuracy of Information — Deemed Reliable but Not Guaranteed",
    paragraphs: [
      `The listing information displayed through the Service is deemed reliable but is not guaranteed accurate by PROPTX or TRREB. Listing data originates from third parties, including member brokerages and their agents, and may contain errors, omissions, or out-of-date entries, and may change or be withdrawn at any time without notice.`,
      `You should independently verify any information that is material to a real estate decision, including price, status, measurements, taxes, and property characteristics, and you should consult a licensed real estate professional, lawyer, lender, appraiser, inspector, or other qualified advisor before acting. You rely on the information displayed through the Service at your own risk.`,
    ],
  },
  {
    heading: "5. Intellectual Property and Attribution",
    paragraphs: [
      `All listing information available through the Service is and remains the intellectual property of PROPTX, TRREB, and the participating member brokerages, and is protected by copyright and other laws. We display this information under licence and do not transfer any ownership or licence rights to you. The Service software, design, our deterministically computed analytics, and other site materials are owned by us or our licensors.`,
      `The listing brokerage is displayed in association with each listing, including in thumbnail and summary views. You must not remove, alter, obscure, crop, overlay, or interfere with any brokerage attribution, copyright notice, source credit, watermark, or other proprietary marking that appears on or with any listing or image. You agree to preserve all such notices in any permitted personal use.`,
    ],
  },
  {
    heading: "6. Your Account and Passwordless Sign-In",
    paragraphs: [
      `Access to the VOW areas of the Service is provided through a personal, individual registered account, secured by passwordless email magic-link authentication. The email address associated with your account, and the magic-link sign-in messages sent to it, function as your access credentials and must be kept secure and confidential. You are responsible for maintaining the security of the email account that controls your sign-in.`,
      `Your account is personal to you. You must not share, sell, sublicense, transfer, or otherwise make your account, your sign-in links, or your access to the Service available to any other person, and you must not allow others to view the licensed data through your account. You are responsible for all activity that occurs under your account.`,
      `You must provide accurate registration information, maintain control of the email address on file, and notify us promptly at ${CONTACT_EMAIL} if you believe your account or email has been compromised or accessed without your authorization.`,
    ],
  },
  {
    heading: "7. Optional Features: Watchlist and Price-Drop Alerts",
    paragraphs: [
      `The Service may offer optional features, including a personal watchlist for saving listings of interest and opt-in email alerts that notify you of price changes, such as price drops, on listings you have saved. These features are provided for your personal convenience only and are subject to the same restrictions on use of the listing data set out in these Terms.`,
      `Alerts and other notifications are provided on a best-efforts basis and may be delayed, incomplete, or unavailable; you should not rely on them as a complete or timely record of listing activity. You may opt out of, disable, or unsubscribe from email alerts at any time, and we may modify or discontinue these optional features at any time.`,
    ],
  },
  {
    heading: "8. Automated Estimates Are Not Appraisals",
    paragraphs: [
      `Our automated valuation estimate, Deal Score, estimated cap rate, True days-on-market, and any other computed figures, scores, or analytics shown on the Service are automated estimates generated by algorithms from available data. They are provided for general informational purposes only.`,
      `These figures are not appraisals, are not professional opinions of value, and are not advice of any kind. They are not prepared by a licensed appraiser, agent, lender, accountant, or other professional, and must not be relied upon or represented as a valuation, appraisal, or professional opinion of value, condition, suitability, or investment merit. You must not use them for lending, tax, legal, insurance, or any decision requiring a professional valuation. Always obtain independent professional advice before making a real estate or financial decision.`,
    ],
  },
  {
    heading: "9. Acceptable Use",
    paragraphs: [
      `In addition to the data restrictions above, you agree not to use the Service in any way that violates applicable law, infringes the rights of others, or breaches the PROPTX VOW Policy and Rules or any TRREB requirement. You will not attempt to gain unauthorized access to the Service, other accounts, or our systems; will not probe, scan, circumvent, or test the vulnerability of the Service or its access controls; and will not interfere with, disrupt, or impose an unreasonable load on the Service or its infrastructure.`,
      `You will not introduce malware or harmful code, misrepresent your identity or affiliation, use the Service to send unsolicited communications, or use the Service to compete with, replicate, or build a substitute for it or for the underlying data feeds. We may monitor use of the Service to enforce these Terms and protect the data and our systems.`,
    ],
  },
  {
    heading: "10. Suspension, Revocation, and Discontinuation of the Data Feed",
    paragraphs: [
      `We may, at our discretion and without prior notice, suspend, limit, or revoke your access to the Service or to particular features if we believe you have breached these Terms, misused the Service or the listing data, shared or transferred your account, or engaged in automated or commercial use, or where required to protect the data, our licence, or our systems.`,
      `The listing data feeds we rely on are provided by PROPTX and TRREB under licence and may be modified, restricted, or discontinued at any time. We may modify, suspend, or discontinue all or part of the Service, including the VOW analytics or the display of any category of listing, at any time and without liability to you. Sections of these Terms that by their nature should survive termination will continue to apply.`,
    ],
  },
  {
    heading: "11. Disclaimer of Warranties",
    paragraphs: [
      `The Service and all listing information, analytics, estimates, and other content are provided on an "as is" and "as available" basis, without warranties of any kind, whether express, implied, statutory, or otherwise. To the fullest extent permitted by law, we, PROPTX, TRREB, and the member brokerages disclaim all implied warranties, including warranties of merchantability, fitness for a particular purpose, accuracy, completeness, title, and non-infringement.`,
      `We do not warrant that the Service will be uninterrupted, secure, error-free, or free of harmful components, or that any information, estimate, or analytic will be accurate, current, or reliable. Some jurisdictions do not allow the exclusion of certain warranties, so some of these exclusions may not apply to you.`,
    ],
  },
  {
    heading: "12. Limitation of Liability",
    paragraphs: [
      `To the fullest extent permitted by law, in no event will we, our affiliates, or our and their respective directors, officers, employees, and licensors (including PROPTX, TRREB, and the member brokerages) be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, revenue, data, goodwill, or business opportunity, arising out of or relating to your use of, or inability to use, the Service or any listing information, analytics, or estimate, whether based in contract, tort, or any other legal theory, even if advised of the possibility of such damages.`,
      `To the fullest extent permitted by law, our total aggregate liability arising out of or relating to the Service and these Terms will not exceed one hundred Canadian dollars (CAD $100). Nothing in these Terms limits any liability that cannot be limited or excluded under applicable law.`,
    ],
  },
  {
    heading: "13. Indemnification",
    paragraphs: [
      `You agree to defend, indemnify, and hold harmless PureProperty.ca and its affiliates, and our and their respective directors, officers, employees, agents, and licensors (including PROPTX, TRREB, and the member brokerages), from and against any claims, demands, losses, liabilities, damages, costs, and expenses, including reasonable legal fees, arising out of or related to your breach of these Terms, your misuse of the Service or the listing data, your violation of any law or third-party right, or any unauthorized or automated access conducted through your account.`,
      `We reserve the right to assume the exclusive defence and control of any matter otherwise subject to indemnification by you, in which case you agree to cooperate with us at your expense.`,
    ],
  },
  {
    heading: "14. Governing Law and Disputes",
    paragraphs: [
      `These Terms and any dispute arising out of or relating to them or the Service are governed by the laws of the Province of Ontario and the federal laws of Canada applicable in Ontario, without regard to conflict-of-laws principles. You agree to the exclusive jurisdiction of the courts located in Ontario, Canada, and waive any objection to venue in those courts, subject to any mandatory consumer-protection rights that apply to you under applicable law.`,
    ],
  },
  {
    heading: "15. Changes to These Terms",
    paragraphs: [
      `We may update these Terms from time to time, including to reflect changes in the PROPTX VOW Policy and Rules, TRREB requirements, the Service, or applicable law. When we do, we will revise the Effective Date above and, where appropriate, provide notice through the Service or by email.`,
      `Your continued use of the Service after the revised Terms take effect constitutes your acceptance of the changes. If you do not agree to the revised Terms, you must stop using the registered areas of the Service.`,
    ],
  },
  {
    heading: "16. Termination",
    paragraphs: [
      `You may stop using the Service and close your account at any time by contacting us at ${CONTACT_EMAIL}. We may terminate or suspend your account and access as described in these Terms.`,
      `Upon termination, your right to access the VOW areas and licensed data ends immediately, and you must cease all use of any listing information obtained through the Service. Provisions relating to intellectual property and attribution, accuracy disclaimers, automated estimates, disclaimers of warranties, limitation of liability, indemnification, and governing law survive termination.`,
    ],
  },
  {
    heading: "17. Contact",
    paragraphs: [
      `If you have questions about these Terms, your account, or the Service, please contact us at ${CONTACT_EMAIL}.`,
    ],
  },
];

export default function TermsPage() {
  return <LegalDocument title={TITLE} intro={INTRO} sections={SECTIONS} />;
}
