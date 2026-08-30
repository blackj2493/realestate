/**
 * Street Recap — the fetching half. `./payload.ts` holds every decision; this file only
 * gathers, exactly as the Data Drop splits data from payload.
 *
 * TWO AUDIENCES, ONE EMAIL. Addresses reach us from `reno_lookups` (someone typed their
 * home into the renovation funnel while signed in) and from `address_watches` (someone
 * asked us to watch an address). They are keyed differently — user_id versus email — and
 * merged here on the email, because a person has one inbox and one street, not one of each.
 *
 * ONE RECAP PER PERSON PER MONTH. Somebody who looked up three homes gets one email about
 * the most recent, not three. The recap is a note about where you live; three of them is a
 * mailing list.
 */
import { getServiceRoleClient } from "@/lib/supabase/client";
import type { SoldAgg, ActiveAgg, TypeRow, RecapScope } from "./payload";

type SB = ReturnType<typeof getServiceRoleClient>;

/**
 * The sold window as CALENDAR DATES, "YYYY-MM-DD", half-open [from, to).
 *
 * Dates, not instants: `raw_vow_sold.close_date` is a `date`, and comparing it against a
 * timestamptz casts it to midnight in the server timezone — a 05:00Z bound would drop the
 * first day of every month through the summer. See previousMonthWindow().
 */
export interface RecapWindow {
  from: string;
  to: string;
}

/** Keys per RPC call. PostgREST caps a result set, and the type split returns a row per
 *  (scope × property type) — roughly eight per scope, so 150 keys stays well clear. */
const KEY_CHUNK = 150;

export interface Recipient {
  email: string;
  /** Null for an address_watches lead, which has no account. */
  userId: string | null;
  address: string;
  addressKey: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  /** From the reno funnel, which resolves it. Null for a watch, which has a postal instead. */
  cityRegion: string | null;
  /** First three characters of the postal code, when we have one. */
  fsa: string | null;
  source: "reno" | "watch";
  at: string;
}

// ── Audience ─────────────────────────────────────────────────────────────────

const norm = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();

/**
 * Everyone with an address we can write about, newest address per person.
 *
 * Ordered oldest-first and overwritten as we go, so the last write for an email wins and
 * the map ends up holding each person's most recent address without a sort per key.
 */
export async function loadRecapAudience(sb: SB): Promise<Recipient[]> {
  const byEmail = new Map<string, Recipient>();

  // ── reno_lookups (migration 129). Signed-in rows only ever carry an address. ──
  const { data: lookups, error: lErr } = await sb
    .from("reno_lookups")
    .select("user_id, address, address_key, lat, lng, city, city_region, created_at")
    .not("user_id", "is", null)
    .not("address", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (lErr) throw new Error(`reno_lookups read failed: ${lErr.message}`);

  const userIds = [...new Set((lookups ?? []).map((r) => r.user_id as string))];
  const emailByUser = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data: profs } = await sb
      .from("profiles")
      .select("id, email, marketing_opt_out")
      .in("id", userIds.slice(i, i + 200));
    for (const p of profs ?? []) {
      // A master unsubscribe is honoured by simply never resolving them to an address.
      if ((p as { marketing_opt_out?: boolean }).marketing_opt_out === true) continue;
      const e = norm((p as { email?: string }).email);
      if (e) emailByUser.set((p as { id: string }).id, e);
    }
  }

  for (const r of lookups ?? []) {
    const email = emailByUser.get(r.user_id as string);
    if (!email) continue;
    byEmail.set(email, {
      email,
      userId: r.user_id as string,
      address: r.address as string,
      addressKey: (r.address_key as string) ?? "",
      lat: (r.lat as number) ?? null,
      lng: (r.lng as number) ?? null,
      city: (r.city as string) ?? null,
      cityRegion: (r.city_region as string) ?? null,
      fsa: null,
      source: "reno",
      at: r.created_at as string,
    });
  }

  // ── address_watches (migration 077). Email-keyed leads with no account. ──
  // `status = 'active'` IS their consent: the one-click unsubscribe route flips it, so an
  // opted-out lead simply stops appearing here.
  const { data: watches, error: wErr } = await sb
    .from("address_watches")
    .select("email, address, address_key, city, postal, lat, lng, created_at")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (wErr) throw new Error(`address_watches read failed: ${wErr.message}`);

  for (const w of watches ?? []) {
    const email = norm(w.email as string);
    if (!email) continue;
    const postal = (w.postal as string) ?? "";
    byEmail.set(email, {
      email,
      userId: byEmail.get(email)?.userId ?? null,
      address: w.address as string,
      addressKey: (w.address_key as string) ?? "",
      lat: (w.lat as number) ?? null,
      lng: (w.lng as number) ?? null,
      city: (w.city as string) ?? null,
      cityRegion: null,
      fsa: postal.length >= 3 ? postal.slice(0, 3).toUpperCase() : null,
      source: "watch",
      at: w.created_at as string,
    });
  }

  return [...byEmail.values()];
}

// ── Aggregates ───────────────────────────────────────────────────────────────

export interface RecapAggregates {
  sold: Map<string, SoldAgg>;
  actives: Map<string, ActiveAgg>;
  /**
   * scopeKey → the city the FEED files that cohort under.
   *
   * Not the same string the recipient gave us, and that is the whole reason this exists.
   * `address_watches` stores the geocoder's municipality — "Strathroy", "Caledonia",
   * "Toronto" — while `raw_vow_sold.city` stores TRREB's: "Adelaide Metcalfe", "Haldimand",
   * "Toronto C01". Toronto alone is filed under ~36 district codes, so an exact match on
   * "Toronto" finds nothing. Asking the FSA cohort which city it belongs to is the only
   * reliable way to reach a comparison rollup.
   */
  feedCity: Map<string, string>;
}

/** Map key, so a neighbourhood and a city of the same name never collide. */
export const scopeKey = (kind: RecapScope["kind"], label: string): string =>
  `${kind}:${label.trim().toLowerCase()}`;

async function rpcChunked<T>(
  sb: SB,
  fn: string,
  scope: string,
  keys: string[],
  extra: Record<string, unknown> = {}
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const { data, error } = await sb.rpc(fn, {
      p_scope: scope,
      p_keys: keys.slice(i, i + KEY_CHUNK),
      ...extra,
    });
    if (error) throw new Error(`${fn}(${scope}) failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

type SoldRow = { scope_key: string; city: string; sales: number; above_asking: number; median_dom: number | null };
type TypeRowRaw = { scope_key: string; property_sub_type: string; sales: number; median_dom: number | null };
type ActiveRow = { scope_key: string; active: number; cut_price: number; median_true_dom: number | null };

/**
 * Every figure the whole audience needs, in eight round trips regardless of its size.
 *
 * The worker collects the distinct scopes across all recipients and asks once per grain,
 * rather than once per person. At a few hundred recipients that is the difference between
 * eight queries and several hundred.
 */
export async function loadRecapAggregates(
  sb: SB,
  scopes: { regions: string[]; fsas: string[]; cities: string[] },
  window: RecapWindow
): Promise<RecapAggregates> {
  const sold = new Map<string, SoldAgg>();
  const actives = new Map<string, ActiveAgg>();
  const feedCity = new Map<string, string>();

  // TWO PASSES, because we do not know which cities to ask for until the tight cohorts
  // answer. The recipient's own city string is the geocoder's and rarely matches the feed's,
  // so the neighbourhood and FSA cohorts are asked first and each reports the city it is
  // filed under; those names — plus the recipient's own, in case it happens to match — are
  // what the city pass then requests.
  const grains: { kind: RecapScope["kind"]; keys: string[] }[] = [
    { kind: "region", keys: scopes.regions },
    { kind: "fsa", keys: scopes.fsas },
  ];

  for (const g of grains) {
    if (!g.keys.length) continue;

    const rows = await rpcChunked<SoldRow>(sb, "street_recap_sold", g.kind, g.keys, {
      p_from: window.from,
      p_to: window.to,
    });
    for (const r of rows) {
      if (r.city) feedCity.set(scopeKey(g.kind, r.scope_key), r.city);
      sold.set(scopeKey(g.kind, r.scope_key), {
        sales: Number(r.sales),
        aboveAsking: Number(r.above_asking),
        medianDom: r.median_dom == null ? null : Number(r.median_dom),
        byType: [],
      });
    }

    const types = await rpcChunked<TypeRowRaw>(sb, "street_recap_sold_types", g.kind, g.keys, {
      p_from: window.from,
      p_to: window.to,
    });
    for (const t of types) {
      const agg = sold.get(scopeKey(g.kind, t.scope_key));
      if (!agg) continue;
      const row: TypeRow = {
        type: t.property_sub_type,
        sales: Number(t.sales),
        medianDom: t.median_dom == null ? null : Number(t.median_dom),
      };
      agg.byType.push(row);
    }

    // FSA is deliberately unsupported for standing inventory — the postal code lives in
    // full_payload, and detoasting it across the table is the read that broke Toronto.
    if (g.kind === "fsa") continue;
    const act = await rpcChunked<ActiveRow>(sb, "street_recap_actives", g.kind, g.keys);
    for (const a of act) {
      actives.set(scopeKey(g.kind, a.scope_key), {
        active: Number(a.active),
        cutPrice: Number(a.cut_price),
        medianTrueDom: a.median_true_dom == null ? null : Number(a.median_true_dom),
      });
    }
  }

  // ── Pass 2: the comparison cities, now that we know their real names. ──
  const cityKeys = [...new Set([...scopes.cities, ...feedCity.values()])].filter(Boolean);
  if (cityKeys.length) {
    const rows = await rpcChunked<SoldRow>(sb, "street_recap_sold", "city", cityKeys, {
      p_from: window.from,
      p_to: window.to,
    });
    for (const r of rows) {
      sold.set(scopeKey("city", r.scope_key), {
        sales: Number(r.sales),
        aboveAsking: Number(r.above_asking),
        medianDom: r.median_dom == null ? null : Number(r.median_dom),
        byType: [],
      });
    }
    const act = await rpcChunked<ActiveRow>(sb, "street_recap_actives", "city", cityKeys);
    for (const a of act) {
      actives.set(scopeKey("city", a.scope_key), {
        active: Number(a.active),
        cutPrice: Number(a.cut_price),
        medianTrueDom: a.median_true_dom == null ? null : Number(a.median_true_dom),
      });
    }
  }

  return { sold, actives, feedCity };
}

/** The distinct scopes an audience needs, ready for loadRecapAggregates. */
export function collectScopes(recipients: Recipient[]): {
  regions: string[];
  fsas: string[];
  cities: string[];
} {
  const regions = new Set<string>();
  const fsas = new Set<string>();
  const cities = new Set<string>();
  for (const r of recipients) {
    if (r.cityRegion) regions.add(r.cityRegion);
    if (r.fsa) fsas.add(r.fsa);
    if (r.city) cities.add(r.city);
  }
  return { regions: [...regions], fsas: [...fsas], cities: [...cities] };
}
