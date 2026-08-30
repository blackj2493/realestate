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
import { renderDataDropEmail } from '@/lib/alerts/dataDropEmail';
import { BOARD_MARKETS } from '@/lib/data/marketBoard';
import type { DataDropPayload } from '@/lib/dataDrop/payload';
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

// Weekly Data Drop — BOTH shapes. The province one is 70.6% of real sends and is the one
// whose chip grid and spread chart need the narrow-width check; the market one is the
// simpler layout. Fixed illustrative numbers, so the preview is stable across runs and can
// never be mistaken for a live figure.
const dropBase = {
  weekId: '2026-W36',
  rows: [
    { label: 'Sold above asking', value: '52%', context: 'down 6 points vs last year' },
    { label: 'Typical price cut', value: '$41,000', context: 'median, among those that cut' },
    { label: 'Days to sell', value: '41', context: 'up from 32 a month ago' },
  ],
  trackers: [
    { label: 'Price cuts', slug: 'price-cuts' },
    { label: 'Days on market', slug: 'days-on-market' },
    { label: 'Sold over asking', slug: 'over-asking' },
  ],
  dataAsOf: '2026-08-27T10:00:00Z',
};

const dropMarket: DataDropPayload = {
  ...dropBase,
  scope: 'market',
  region: 'Milton',
  headline: {
    kind: 'leverage',
    figure: '34',
    unit: '%',
    lede: 'of active Milton listings have <b>cut their asking price</b>.',
    because:
      'Four weeks ago it was <b>27%</b> — up 7 points. That is one seller in three who has already moved first.',
  },
  others: [
    { region: 'Oakville', value: '24% cutting price' },
    { region: 'Burlington', value: '29% cutting price' },
  ],
  spread: null,
};

const dropProvince: DataDropPayload = {
  ...dropBase,
  scope: 'province',
  region: 'Ontario',
  headline: {
    kind: 'over_ask_flip',
    figure: '47',
    unit: '%',
    lede: "of Ontario homes sold <b>above the seller's asking price</b> last month.",
    because:
      'A year ago it was 51%. For the first time in a year, most sellers are taking less than they asked.',
  },
  others: [],
  spread: {
    low: { region: 'Hamilton', pct: 10 },
    high: { region: 'Oshawa', pct: 37 },
    mid: { region: 'Ontario', pct: 18 },
  },
};

const dropCommon = {
  chipMarkets: BOARD_MARKETS,
  unsubscribeUrl: UNSUB,
  manageUrl: MANAGE,
  ctaTarget: 'terminal' as const,
  email: 'preview@example.com',
  signature: 'preview-signature',
};

write('data-drop-market', renderDataDropEmail({ payload: dropMarket, ...dropCommon }).html);
write('data-drop-province', renderDataDropEmail({ payload: dropProvince, ...dropCommon }).html);

console.log(`\n${6} templates written. Open each at 390px and 360px wide.`);
