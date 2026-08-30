/**
 * Render every shipped email template to standalone HTML so it can be opened at a real
 * phone width and inspected. Dev/QA only — sends nothing and touches no data.
 *
 * Why this exists: these templates are built as inline-CSS tables with NO @media queries
 * (Gmail's mobile app strips <head> styles, so breakpoints are unreliable). That makes
 * them fluid by construction but easy to break by adding a column — a four-column table
 * squeezed its numeric cells to 58px at 390px and wrapped every row at 360px before
 * anyone noticed. Open these in a 390px and a 360px viewport before shipping copy or
 * layout changes to an email.
 *
 * Usage:
 *   npx tsx scripts/admin/renderEmailPreviews.ts [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

import { renderWelcomeEmail } from '@/lib/alerts/welcomeEmail';
import { renderAlertsDigest, type DigestPayload } from '@/lib/alerts/digest';
import {
  renderDashboardEducationEmail,
  renderSaveHomeEmail,
  type SaveHomeListing,
} from '@/lib/alerts/onboardingEmails';

const outDir = process.argv[2] || path.join(process.cwd(), '.email-previews');
fs.mkdirSync(outDir, { recursive: true });

const UNSUB = 'https://www.pureproperty.ca/unsubscribe?e=preview';
const MANAGE = 'https://www.pureproperty.ca/account/emails';

const write = (name: string, html: string) => {
  const file = path.join(outDir, `${name}.html`);
  fs.writeFileSync(file, html, 'utf8');
  console.log(`${name.padEnd(24)} ${(html.length / 1024).toFixed(1).padStart(5)} KB  ${file}`);
};

const digestPayload: DigestPayload = {
  statusChanges: [
    {
      listing_key: 'W1234567',
      address: '128 Maplecrest Ave',
      city: 'Vaughan',
      kind: 'sold',
      brokerage: 'Sample Realty Inc.',
      thumb: null,
    },
  ],
  drops: [
    {
      listing_key: 'C9876543',
      address: '55 Bloor St W, Unit 1204',
      city: 'Toronto',
      oldPrice: 899000,
      newPrice: 849000,
      thumb: null,
      brokerage: 'Sample Realty Inc.',
    },
  ],
  bubbles: [],
};

const saveHomes: SaveHomeListing[] = [
  {
    listing_key: 'W1',
    address: '12 Kipling Ave',
    city: 'Toronto',
    price: 1249000,
    thumb: null,
    brokerage: 'Sample Realty Inc.',
  },
  {
    listing_key: 'W2',
    address: '3400 Rutherford Rd',
    city: 'Vaughan',
    price: 989000,
    thumb: null,
    brokerage: 'Sample Realty Inc.',
  },
];

write('welcome', renderWelcomeEmail('preview@example.com').html);
write('digest', renderAlertsDigest(digestPayload, UNSUB).html);
write(
  'onboarding-dashboard',
  renderDashboardEducationEmail({ areaName: 'Woodbridge', unsubscribeUrl: UNSUB, manageUrl: MANAGE }).html,
);
write(
  'onboarding-save-home',
  renderSaveHomeEmail({ homes: saveHomes, areaName: 'Woodbridge', unsubscribeUrl: UNSUB, manageUrl: MANAGE }).html,
);

console.log(`\n${4} templates written. Open each at 390px and 360px wide.`);
