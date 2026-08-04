/**
 * WatchAlerts — the pure derivation behind WatchlistAlertsBell.
 *
 * Folds the watchlist's two change signals into one alert feed:
 *  - price drops: the current ask is below the price the home had when saved;
 *  - dispositions: the saved key left the active index — relisted under a new
 *    MLS#, sold, leased, or plain off-market — resolved server-side by the same
 *    useWatchlistSnapshot layer the dashboard Watchlist section renders from.
 *
 * Every alert carries a SIGNATURE: the exact state being reported. The bell
 * stores the last acknowledged signature per listing (localStorage), so the
 * badge re-lights only when the state CHANGES — a further price cut, an
 * off-market home resolving to "sold", a second relist under yet another key —
 * and re-opening an unchanged alert stays quiet.
 *
 * Compliance: disposition KINDS are the public-safe HouseSigma-model badge
 * (lib/watchlist/disposition.ts) — no VOW numbers ever reach this layer. The
 * relist ask comes from the live IDX listing, which is display-safe.
 */

import type { WatchlistChange } from "./useWatchlistSnapshot";

export type WatchAlertKind = "drop" | "relisted" | "sold" | "leased" | "off";

export interface WatchAlert {
  /** Saved listing key — the stable identity the seen-marker is keyed on. */
  id: string;
  /** Row link: the relist's NEW active key when there is one, else the saved key. */
  href: string;
  address: string;
  kind: WatchAlertKind;
  /** Exact reported state; a different signature re-lights the bell. */
  sig: string;
  /** drop only */
  oldPrice?: number;
  newPrice?: number;
  dropPct?: number;
  /** relisted only — current ask on the new active listing (IDX, public). */
  relistPrice?: number | null;
}

/** Actionable first: live price cuts, then live relists, then closure events. */
const KIND_ORDER: Record<WatchAlertKind, number> = {
  drop: 0,
  relisted: 1,
  sold: 2,
  leased: 3,
  off: 4,
};

export function deriveWatchAlerts(changes: WatchlistChange[]): WatchAlert[] {
  const alerts: WatchAlert[] = [];

  for (const c of changes) {
    const key = c.item.listing_key;
    if (!key) continue;
    const savedAddress = c.item.address || c.item.city || "Watched property";

    if (c.offMarket) {
      const disp = c.disposition;
      if (disp?.kind === "relisted") {
        alerts.push({
          id: key,
          href: `/properties/${disp.newKey}`,
          address: disp.newAddress || savedAddress,
          kind: "relisted",
          sig: `s:relisted:${disp.newKey}`,
          relistPrice: disp.newPrice,
        });
      } else if (disp?.kind === "sold" || disp?.kind === "leased") {
        alerts.push({
          id: key,
          href: `/properties/${key}`,
          address: savedAddress,
          kind: disp.kind,
          sig: `s:${disp.kind}`,
        });
      } else {
        // Specific de-list reason, or the disposition fetch still in flight —
        // either way the public-safe rendering is the generic off-market row.
        alerts.push({
          id: key,
          href: `/properties/${key}`,
          address: savedAddress,
          kind: "off",
          sig: "s:off",
        });
      }
      continue;
    }

    const baseline = c.item.list_price;
    const newPrice = c.current?.ListPrice;
    if (!baseline || !newPrice || newPrice >= baseline) continue;
    alerts.push({
      id: key,
      href: `/properties/${key}`,
      address: c.current?.UnparsedAddress || savedAddress,
      kind: "drop",
      sig: `p:${newPrice}`,
      oldPrice: baseline,
      newPrice,
      dropPct: Math.round(((baseline - newPrice) / baseline) * 100),
    });
  }

  return alerts.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.dropPct ?? 0) - (a.dropPct ?? 0)
  );
}

/**
 * Parse the stored seen-marker. Before status alerts, values were the raw
 * acknowledged price (a number) — coerce those to the drop signature so an
 * upgrade never re-fires every previously-seen price drop at once.
 */
export function normalizeSeen(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = `p:${v}`;
  }
  return out;
}
