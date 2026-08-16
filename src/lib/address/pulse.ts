/**
 * Pulse score for the address-profile "Home Pulse" card — one 0-100 number that says
 * how the market immediately around an off-market home is behaving, derived ENTIRELY
 * from the live asking-side feed (momentum stats in nearbyForSale.ts). No sold/VOW
 * input, so the score itself is anonymous-safe and the card can say so ("scored from
 * live asking-side activity"). Deterministic (CLAUDE.md §4) and pure — unit-tested.
 *
 * The score is a heuristic thermometer, not a forecast: it moves when the inputs move
 * (nightly sync → new listings / cuts / aging), which is exactly what makes the page
 * worth revisiting.
 */

export interface PulseInput {
  /** Live actives within the radius. */
  totalActives: number;
  /** Listed within the last 7 days. */
  newThisWeek: number;
  /** Share of actives with at least one price cut (0..1). */
  cutShare: number;
  /** Actives sitting 30+ days (this campaign). */
  sitting30: number;
  /** Median days listed across actives; null when unknown. */
  medianDaysListed: number | null;
}

export interface Pulse {
  /** 5..95 — never pegged, the market is never "certain". */
  score: number;
  label: "Hot" | "Warm" | "Balanced" | "Cool" | "Cold";
  /** Short qualifier for the headline ("seller-leaning"). */
  lean: string;
  /** One-sentence read of the strongest signals, for the card body. */
  blurb: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function computePulse(m: PulseInput): Pulse {
  let score = 50;

  // Velocity — how long live listings have been sitting.
  const days = m.medianDaysListed;
  if (days !== null) {
    if (days <= 14) score += 15;
    else if (days <= 30) score += 5;
    else if (days > 45) score -= 10;
  }

  // Fresh supply arriving = an active, liquid pocket.
  if (m.totalActives > 0) {
    const fresh = m.newThisWeek / m.totalActives;
    if (fresh >= 0.1) score += 10;
    else if (m.newThisWeek > 0) score += 3;
    else score -= 5;
  }

  // Cut pressure — sellers blinking first.
  if (m.cutShare >= 0.3) score -= 15;
  else if (m.cutShare >= 0.15) score -= 5;
  else if (m.cutShare < 0.1) score += 8;

  // Stale share — inventory nobody is taking.
  if (m.totalActives > 0) {
    const stale = m.sitting30 / m.totalActives;
    if (stale >= 0.4) score -= 10;
    else if (stale <= 0.15) score += 8;
  }

  score = clamp(Math.round(score), 5, 95);

  const label: Pulse["label"] =
    score >= 72 ? "Hot" : score >= 58 ? "Warm" : score >= 46 ? "Balanced" : score >= 32 ? "Cool" : "Cold";
  const lean =
    label === "Hot" ? "seller's market"
      : label === "Warm" ? "seller-leaning"
      : label === "Balanced" ? "evenly matched"
      : label === "Cool" ? "buyer-leaning"
      : "buyer's market";

  return { score, label, lean, blurb: buildBlurb(m, label) };
}

/** Deterministic one-liner from the two strongest signals. */
function buildBlurb(m: PulseInput, label: Pulse["label"]): string {
  const parts: string[] = [];

  if (m.medianDaysListed !== null && m.medianDaysListed <= 14) {
    parts.push(`the median listing here is only ${Math.round(m.medianDaysListed)} days old`);
  } else if (m.medianDaysListed !== null && m.medianDaysListed > 45) {
    parts.push(`the median listing has sat ${Math.round(m.medianDaysListed)} days`);
  }

  if (m.newThisWeek > 0) {
    parts.push(`${m.newThisWeek} fresh listing${m.newThisWeek === 1 ? "" : "s"} arrived this week`);
  }

  if (m.cutShare >= 0.15) {
    parts.push(`${Math.round(m.cutShare * 100)}% of sellers have cut their price — buyers still have an opening`);
  } else if (m.cutShare < 0.1 && m.totalActives >= 8) {
    parts.push("almost nobody is cutting their price");
  }

  const body = parts.slice(0, 2).join(" and ");
  if (!body) return "A quiet pocket — little live inventory to read right now.";
  const opener =
    label === "Hot" || label === "Warm" ? "This pocket is moving:" : label === "Balanced" ? "A steady pocket:" : "A slow pocket:";
  return `${opener} ${body}.`;
}
