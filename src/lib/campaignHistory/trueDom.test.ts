import { describe, it, expect } from 'vitest';
import { computeTrueDomFromCampaigns } from './trueDom';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z'); // past the 17:38Z entry-of-day so 363 floors to exactly 24
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

// The real 363 Maria Antonia chain (sale + lease), newest-first.
const chain363: CampaignEvent[] = [
  ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', end_date: null, end_reason: null, list_price: 1729000, original_list_price: 1729000 }),
  ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900 }),
  ev({ listing_key: 'N12656610', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-01-02T17:40:02Z', end_date: '2026-03-02', list_price: 5000 }),
  ev({ listing_key: 'N12500658', transaction_type: 'Lease', status: 'Expired', entry_date: '2025-11-02T16:02:46Z', end_date: '2025-12-31', list_price: 5000 }),
  ev({ listing_key: 'N12409326', status: 'Terminated', entry_date: '2025-09-17T15:32:06Z', end_date: '2025-10-15', list_price: 1990000, original_list_price: 1990000 }),
  ev({ listing_key: 'N12343968', transaction_type: 'Lease', status: 'Expired', entry_date: '2025-08-14T14:08:06Z', end_date: '2025-10-30', list_price: 5300 }),
  ev({ listing_key: 'N12209050', transaction_type: 'Lease', status: 'Terminated', entry_date: '2025-06-10T13:28:48Z', end_date: '2025-08-07', list_price: 5300 }),
];

describe('computeTrueDomFromCampaigns — 363 Maria Antonia', () => {
  const r = computeTrueDomFromCampaigns(chain363, { nowMs: NOW });

  it('stitches the current sale campaign (05-15 -> now), not the 2025 effort', () => {
    expect(r.true_dom).toBe(24); // 2026-05-15 -> 2026-06-08
  });
  it('counts every campaign for the "listed N times" signal', () => {
    expect(r.campaign_count).toBe(7);
  });
  it('reports no drop (they raised the ask)', () => {
    expect(r.total_price_drop).toBe(0);
  });
  it('is not stale below 60 days', () => {
    expect(r.is_stale).toBe(false);
  });
});

describe('computeTrueDomFromCampaigns — edges', () => {
  it('a fresh active listing with no prior ≈ its own age', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'F', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2);
    expect(r.campaign_count).toBe(1);
  });

  it('breaks the chain when the gap exceeds the window', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 900000, original_list_price: 900000 }),
        ev({ listing_key: 'O', status: 'Terminated', entry_date: '2026-01-01T00:00:00Z', end_date: '2026-02-01', list_price: 950000, original_list_price: 950000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2); // prior ended 2026-02-01, gap > 35d -> not stitched
  });

  it('stitches a prior within the window and surfaces the drop', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000, original_list_price: 800000 }),
        ev({ listing_key: 'O', status: 'Terminated', entry_date: '2026-05-10T00:00:00Z', end_date: '2026-05-20', list_price: 900000, original_list_price: 900000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(29);            // 2026-05-10 -> 2026-06-08
    expect(r.total_price_drop).toBe(100000); // 900k -> 800k
  });

  it('excludes lease campaigns from the sale True DOM', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'S', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 }),
        ev({ listing_key: 'L', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-05-01T00:00:00Z', end_date: '2026-05-30', list_price: 3000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2);       // lease ignored for the number
    expect(r.campaign_count).toBe(2); // but still counted in the timeline tally
  });

  it('returns zero true_dom when there is no sale campaign', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'L', transaction_type: 'Lease', status: 'Active', entry_date: '2026-06-01T00:00:00Z', list_price: 3000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(0);
    expect(r.campaign_count).toBe(1);
  });
});

describe('computeTrueDomFromCampaigns — LEASE track (rental-native metrics)', () => {
  it('stitches lease campaigns into lease_true_dom + surfaces the rent reduction', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'L2', transaction_type: 'Lease', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 3000, original_list_price: 3000 }),
        ev({ listing_key: 'L1', transaction_type: 'Lease', status: 'Terminated', entry_date: '2026-05-10T00:00:00Z', end_date: '2026-05-20', list_price: 3200, original_list_price: 3200 }),
      ],
      { nowMs: NOW }
    );
    expect(r.lease_true_dom).toBe(29);          // 2026-05-10 -> NOW (stitched, gap 17d)
    expect(r.lease_total_price_drop).toBe(200); // earliest ask 3200 -> current 3000
    expect(r.true_dom).toBe(0);                 // no sale campaign
    expect(r.total_price_drop).toBe(0);
  });

  it('keeps the sale and lease tracks independent for a sale->lease flip (62 Fernbrook shape)', () => {
    const r = computeTrueDomFromCampaigns(
      [
        // current campaign: For Lease at $2,800 (no rent drop)
        ev({ listing_key: 'LNow', transaction_type: 'Lease', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 2800, original_list_price: 2800 }),
        // a prior FAILED sale with a big drop
        ev({ listing_key: 'SOld', transaction_type: 'Sale', status: 'Terminated', entry_date: '2026-05-10T00:00:00Z', end_date: '2026-05-20', list_price: 805100, original_list_price: 1000000 }),
      ],
      { nowMs: NOW }
    );
    // the six-figure drop stays on the SALE track and NEVER lands on the rental
    expect(r.total_price_drop).toBe(194900);
    expect(r.lease_total_price_drop).toBe(0);
    // rental DOM is the lease campaign's own age, not the old sale span
    expect(r.lease_true_dom).toBe(2);  // 2026-06-06 -> NOW
    expect(r.true_dom).toBe(10);       // sale span 2026-05-10 -> its 2026-05-20 terminal
  });

  it('a sale-only listing carries zero lease metrics', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'S', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000, original_list_price: 800000 })],
      { nowMs: NOW }
    );
    expect(r.lease_true_dom).toBe(0);
    expect(r.lease_total_price_drop).toBe(0);
  });
});

describe('null end_date on non-Active campaigns (audit HIGH-9)', () => {
  it('does NOT stitch a Terminated campaign with no end_date — true_dom counts only the fresh campaign', () => {
    const now = Date.parse('2026-06-09T00:00:00Z');
    const events = [
      ev({ listing_key: 'OLD1', status: 'Terminated', entry_date: '2024-06-01', end_date: null, transaction_type: 'Sale' }),
      ev({ listing_key: 'NEW1', status: 'Active', entry_date: '2026-05-02', end_date: null, transaction_type: 'Sale' }),
    ];
    const r = computeTrueDomFromCampaigns(events, { nowMs: now });
    expect(r.true_dom).toBe(38); // 2026-05-02 → 2026-06-09, NOT ~737 days back to 2024
  });

  it('still stitches a prior with a KNOWN end_date within the window (regression guard)', () => {
    const now = Date.parse('2026-06-09T00:00:00Z');
    const events = [
      ev({ listing_key: 'OLD2', status: 'Terminated', entry_date: '2026-03-01', end_date: '2026-04-20', transaction_type: 'Sale' }),
      ev({ listing_key: 'NEW2', status: 'Active', entry_date: '2026-05-02', end_date: null, transaction_type: 'Sale' }),
    ];
    const r = computeTrueDomFromCampaigns(events, { nowMs: now });
    expect(r.true_dom).toBe(100); // gap 12d ≤ 35 → stitched back to 2026-03-01
  });

  it('a NEWEST non-Active campaign with no end_date contributes 0 days (conservative, not inflated)', () => {
    const now = Date.parse('2026-06-09T00:00:00Z');
    const events = [
      ev({ listing_key: 'ONLY', status: 'Terminated', entry_date: '2025-01-01', end_date: null, transaction_type: 'Sale' }),
    ];
    const r = computeTrueDomFromCampaigns(events, { nowMs: now });
    expect(r.true_dom).toBe(0); // unknown terminal — refuse to fabricate ~524 days
  });
});

describe('computeTrueDomFromCampaigns — regression: multi-hop, boundary, off-market', () => {
  it('stitches a 3-campaign chain and walks the drop back to the earliest', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'C3', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 700000, original_list_price: 700000 }),
        ev({ listing_key: 'C2', status: 'Terminated', entry_date: '2026-05-20T00:00:00Z', end_date: '2026-06-01', list_price: 750000, original_list_price: 750000 }),
        ev({ listing_key: 'C1', status: 'Terminated', entry_date: '2026-05-01T00:00:00Z', end_date: '2026-05-15', list_price: 800000, original_list_price: 800000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(38);             // earliest start 2026-05-01 -> NOW
    expect(r.total_price_drop).toBe(100000); // earliest original 800k -> current 700k
    expect(r.campaign_count).toBe(3);
  });

  it('stitches at an exactly-35-day gap but breaks at 36', () => {
    const stitched = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 }),
        ev({ listing_key: 'P', status: 'Terminated', entry_date: '2026-04-25T00:00:00Z', end_date: '2026-05-02', list_price: 820000, original_list_price: 820000 }),
      ],
      { nowMs: NOW }
    );
    expect(stitched.true_dom).toBe(44); // gap 35d (<=35) -> stitched, earliest 2026-04-25

    const broken = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 }),
        ev({ listing_key: 'P', status: 'Terminated', entry_date: '2026-04-25T00:00:00Z', end_date: '2026-05-01', list_price: 820000, original_list_price: 820000 }),
      ],
      { nowMs: NOW }
    );
    expect(broken.true_dom).toBe(2); // gap 36d (>35) -> not stitched, newest age only
  });

  it('measures to the terminal date when the newest campaign is already off-market', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'S', status: 'Sold', entry_date: '2026-04-01T00:00:00Z', end_date: '2026-05-01', list_price: 900000, original_list_price: 900000, close_price: 890000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(30);     // 2026-04-01 -> 2026-05-01 (NOT to now)
    expect(r.campaign_count).toBe(1);
  });
});

/**
 * Guards the arithmetic that scripts/admin/refloor-active-true-dom.ts runs in SQL.
 *
 * The stored true_dom only moves when a listing re-enters the sync delta, so a stable
 * relisted property freezes: E13615346 read 706 on a Compare row while the listing page
 * re-stitched 714 live. The re-floor job un-freezes it WITHOUT re-reading the feed, by
 * reconstructing the span START from the ledger snapshot — `start := fetched_at - true_dom
 * days` — and re-measuring that to now.
 *
 * The property that makes it safe is the ERROR DIRECTION. true_dom is floored, so the
 * reconstruction lands on or after the real start, and the re-measure can therefore only
 * ever UNDER-state — never claim more market time than the campaigns support. These tests
 * pin that, since an over-statement would inflate a distress signal (and Deal Score's
 * Negotiability pillar, which takes True DOM as an input).
 */
describe('snapshot reconstruction — the re-floor job’s SQL arithmetic', () => {
  const DAY = 86_400_000;
  const start = '2024-08-23T02:14:41Z'; // 67 North Edgely’s oldest sale campaign
  const active = [ev({ listing_key: 'E13615346', status: 'Active', entry_date: start, end_date: null })];

  /** What the SQL computes: floor((now - (fetched_at - stored days)) / day). */
  const reconstruct = (storedDom: number, fetchedAtMs: number, nowMs: number) =>
    Math.max(0, Math.floor((nowMs - (fetchedAtMs - storedDom * DAY)) / DAY));

  const t1 = Date.parse('2026-08-08T01:43:18Z'); // ledger fetched_at

  it('reproduces the live value exactly at the instant of the snapshot', () => {
    const stored = computeTrueDomFromCampaigns(active, { nowMs: t1 }).true_dom;
    expect(stored).toBe(714);
    expect(reconstruct(stored, t1, t1)).toBe(714);
  });

  it('never OVER-states, and stays within a day, as the snapshot ages', () => {
    const stored = computeTrueDomFromCampaigns(active, { nowMs: t1 }).true_dom;
    // Walk a full year past the snapshot — the drift window this job exists to close.
    for (const daysLater of [1, 2, 8, 30, 90, 365]) {
      const t2 = t1 + daysLater * DAY;
      const live = computeTrueDomFromCampaigns(active, { nowMs: t2 }).true_dom;
      const rebuilt = reconstruct(stored, t1, t2);
      expect(rebuilt, `${daysLater}d later must not exceed the live value`).toBeLessThanOrEqual(live);
      expect(rebuilt, `${daysLater}d later must stay within 1 day`).toBeGreaterThanOrEqual(live - 1);
    }
  });

  it('holds for a snapshot taken mid-day, where the floor discards the most', () => {
    // Worst case for the reconstruction: fetched_at sits just before a day boundary, so
    // `stored` has just discarded almost a full day of the real span.
    const mid = Date.parse('2024-08-24T02:14:40Z'); // 1ms short of a full day after start
    const stored = computeTrueDomFromCampaigns(active, { nowMs: mid }).true_dom;
    expect(stored).toBe(0);
    for (const daysLater of [1, 5, 100]) {
      const t2 = mid + daysLater * DAY;
      const live = computeTrueDomFromCampaigns(active, { nowMs: t2 }).true_dom;
      const rebuilt = reconstruct(stored, mid, t2);
      expect(rebuilt).toBeLessThanOrEqual(live);
      expect(rebuilt).toBeGreaterThanOrEqual(live - 1);
    }
  });

  it('is monotonic — a re-floored row never moves backwards on a later run', () => {
    let prev = 0;
    for (let d = 0; d <= 400; d += 7) {
      const v = reconstruct(714, t1, t1 + d * DAY);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
