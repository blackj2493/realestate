/**
 * Founding seats — the counter behind "N/50 seats taken".
 *
 * A seat is granted as a SIDE EFFECT of a user's first unlocked renovation-upside
 * result; there is no claim button and no email field (see migration 110). That
 * keeps the ask to a single action — signing in — and means a seat always costs a
 * verified OTP.
 *
 * What we promise a holder is deliberately narrow and permanently deliverable:
 * full access stays free. Nothing here prices a product, because there is no paid
 * tier — a "free" claim measured against a price that will never exist is a
 * misrepresentation we don't need in order to make 50 seats feel scarce.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** How many seats exist. The scarcity is real: past this, claimants are waitlisted. */
export const FOUNDING_SEAT_TOTAL = 200;

export interface SeatSummary {
  /** Seats actually held — a true COUNT(*), never an offset or a display fudge. */
  taken: number;
  total: number;
  /** The number the next person would be handed. */
  next: number;
  soldOut: boolean;
}

/**
 * Whether the counter is worth putting on screen.
 *
 * A zero is never persuasive, and — more importantly — zero is also what a FAILED
 * read returns, because getSeatSummary swallows errors to keep the reno result
 * alive. An unapplied migration would therefore render a confident "0/200", which
 * is this codebase's signature failure: a metric that nulls out and then displays
 * as though it were true. Render nothing instead; the page reads fine without it.
 */
export function shouldShowSeats(seats: SeatSummary | null | undefined): seats is SeatSummary {
  return !!seats && seats.taken > 0;
}

export const EMPTY_SEATS: SeatSummary = {
  taken: 0,
  total: FOUNDING_SEAT_TOTAL,
  next: 1,
  soldOut: false,
};

function summarize(taken: number): SeatSummary {
  return {
    taken,
    total: FOUNDING_SEAT_TOTAL,
    next: Math.min(taken + 1, FOUNDING_SEAT_TOTAL + 1),
    soldOut: taken >= FOUNDING_SEAT_TOTAL,
  };
}

/**
 * How many seats are gone. Reads COUNT(*) rather than the sequence's last value so
 * a gap (a conflicting insert that consumed a number) can never inflate the figure
 * we show — the counter states how many PEOPLE hold seats.
 *
 * Never throws: the counter is decoration on a page whose real job is the reno
 * result, so a DB hiccup must not take the result down with it.
 */
export async function getSeatSummary(supabase: SupabaseClient): Promise<SeatSummary> {
  try {
    const { count, error } = await supabase
      .from('founding_seats')
      .select('seat', { count: 'exact', head: true });
    if (error) throw error;
    return summarize(count ?? 0);
  } catch (err) {
    console.error('[founding/seats] count failed', err);
    return EMPTY_SEATS;
  }
}

export interface ClaimContext {
  userId: string;
  email?: string | null;
  source?: string | null;
  city?: string | null;
  cityRegion?: string | null;
}

export interface ClaimResult {
  /** This user's seat number, existing or newly taken. Null if the write failed. */
  seat: number | null;
  seats: SeatSummary;
}

/**
 * Return this user's seat, taking one if they don't have it yet.
 *
 * SELECT-before-INSERT is deliberate: `ON CONFLICT DO NOTHING` still consumes a
 * sequence value, so an unconditional insert would burn a seat number every time
 * someone re-ran the tool. The UNIQUE(user_id) constraint remains the real guard
 * for the (tiny) race between the select and the insert — on conflict we simply
 * re-read the row the other request wrote.
 */
export async function claimSeat(
  supabase: SupabaseClient,
  ctx: ClaimContext,
): Promise<ClaimResult> {
  try {
    const existing = await supabase
      .from('founding_seats')
      .select('seat')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (existing.data?.seat) {
      return { seat: Number(existing.data.seat), seats: await getSeatSummary(supabase) };
    }

    const inserted = await supabase
      .from('founding_seats')
      .insert({
        user_id: ctx.userId,
        email: ctx.email ?? null,
        source: ctx.source ?? null,
        city: ctx.city ?? null,
        city_region: ctx.cityRegion ?? null,
      })
      .select('seat')
      .maybeSingle();

    if (inserted.data?.seat) {
      return { seat: Number(inserted.data.seat), seats: await getSeatSummary(supabase) };
    }

    // Lost the race (or the insert was rejected) — the other writer's row is truth.
    const after = await supabase
      .from('founding_seats')
      .select('seat')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    return {
      seat: after.data?.seat ? Number(after.data.seat) : null,
      seats: await getSeatSummary(supabase),
    };
  } catch (err) {
    console.error('[founding/seats] claim failed', err);
    return { seat: null, seats: await getSeatSummary(supabase) };
  }
}

/** A seat only counts as founding if it landed inside the 50. */
export function isFoundingSeat(seat: number | null | undefined): boolean {
  return typeof seat === 'number' && seat > 0 && seat <= FOUNDING_SEAT_TOTAL;
}
