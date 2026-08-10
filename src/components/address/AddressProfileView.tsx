/**
 * Address-profile render for a key-less /address slug — the "Home Pulse" living
 * dossier for an off-market home (redesign 2026-07-23; ADDRESS_PROFILES_PLAN P1).
 *
 * AUTH-AWARE: `isConsumer` (decided server-side in page.tsx via getConsumer()) drives
 * every gate on the page. Signed-in consumers see real sold-side data (sold snapshot,
 * sold feed rows, the street ledger) and ZERO sign-up CTAs; anonymous visitors see
 * asking-side data in full plus count-only sold teasers. The gate is STRUCTURAL:
 * the gated fetchers (getSoldNearGated / getStreetLedgerGated) run ONLY inside the
 * isConsumer branch, so no VOW value is ever fetched — let alone rendered — for anon.
 *
 * Anonymous-safe surface (unchanged in kind from v1):
 *  - Nearby ACTIVES (IDX — photos/prices/brokerage public by design) power the pulse
 *    score, ticker, "if it listed today" band, feed NEW/CUT rows, radar pins, carousel.
 *  - Sold teasers are aggregates only: counts + bare ~110m-rounded radar points
 *    (see soldNearPoint.ts) — matching the market-activity route, which withholds
 *    even sold addresses from anon.
 *  - Schools (EQAO), amenities and geo "Things to Know" are open data.
 */
import { Suspense } from "react";
import Link from "next/link";
import {
  GraduationCap,
  Footprints,
  MapPin,
  Bell,
  TriangleAlert,
  Info,
  Dumbbell,
} from "lucide-react";
import type { AddressProfile } from "@/lib/address/resolveProfile";
import { getNearbyForSale, type NearbyListing } from "@/lib/address/nearbyForSale";
import { getBestTypicalRents } from "@/lib/address/leasedRents";
import { getBestTypicalPrices } from "@/lib/address/soldPrices";
import { computePulse } from "@/lib/address/pulse";
import {
  getSoldNearSummary,
  getSoldNearGated,
  type SoldNearGated,
  type SoldNearSummary,
} from "@/lib/address/soldNearPoint";
import {
  getStreetLedgerGated,
  getStreetLedgerPublic,
  type StreetLedgerGated,
  type StreetLedgerPublic,
} from "@/lib/address/streetLedger";
import { getSaleRecordByAddressGated, type SaleRecord } from "@/lib/address/saleRecord";
import SaleRecordCard from "./SaleRecordCard";
import { getFlagsNearPoint, CHECKED_LABELS, type AddressFlag } from "@/lib/address/flagsNearPoint";
import { getNearbySchools, type NearbySchool } from "@/lib/schools/nearbySchoolList";
import { assignAmenities, NO_AMENITY_KM } from "@/lib/amenities/nearestAmenities";
import { cityHubSlug, slugify } from "@/lib/listings/listingPath";
import { cityHrefOrMap } from "@/lib/listings/cityHubs";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import PulseLoader from "@/components/ui/PulseLoader";
import TrackAddressCard from "./TrackAddressCard";
import MarketGrids from "./MarketGrids";
import PulseCard from "./PulseCard";
import ActivityTicker, { type TickerItem } from "./ActivityTicker";
import IfListedToday, { type ListedTodayBand } from "./IfListedToday";
import { dominantSubType } from "./listedTodayDefault";
import { parseAddress, streetNamesMatch } from "@/lib/watchlist/disposition";
import ActivityFeed from "./ActivityFeed";
import StreetRadar from "./StreetRadar";
import StreetLedgerCard from "./StreetLedgerCard";
import Standouts from "./Standouts";

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

/** "$1.2M" / "$729k" — compact labels. */
function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function fmtDist(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`;
}

/** Epoch (UTC-midnight date-only) → "Jul 17" — audit MEDIUM-18. */
function fmtSoldDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

function relDays(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "today" : `${d}d`;
}

/* ── listing card (carousel) ────────────────────────────────────────────────── */

function NearbyCard({ l }: { l: NearbyListing }) {
  return (
    <Link
      href={`/properties/${l.id}`}
      className="group w-72 shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-card/40 transition-colors hover:border-cyan-500/40"
    >
      <div className="relative h-44 bg-muted">
        {l.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- MLS photos are never optimized (cost + TRREB watermark)
          <img src={l.imageUrl} alt={l.address} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No photo</div>
        )}
        {l.dropAmount > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded bg-amber-500 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-950">
            CUT −{fmtK(l.dropAmount)}
          </span>
        )}
        {l.distanceM !== null && (
          <span className="absolute right-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] text-cyan-700 dark:text-cyan-400">
            {fmtDist(l.distanceM)}
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="text-lg font-bold text-foreground">{fmtPrice(l.price)}</p>
        {/* Details + brokerage share one type tier — §6.3: no visual de-emphasis. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {[l.beds ? `${l.beds} bd` : null, l.baths ? `${l.baths} ba` : null, l.subType].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 truncate text-sm text-muted-foreground">{l.address}</p>
        <p className="mt-1 text-sm text-muted-foreground">{l.brokerage ?? "Brokerage unavailable"}</p>
      </div>
    </Link>
  );
}

/* ── schools ────────────────────────────────────────────────────────────────── */

function scoreClasses(score: number | null): string {
  if (score === null) return "border-border bg-muted/60 text-muted-foreground";
  if (score >= 8) return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (score >= 6.5) return "border-cyan-500/30 bg-cyan-500/15 text-cyan-700 dark:text-cyan-400";
  return "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400";
}

function SchoolRow({ s }: { s: NearbySchool }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border font-mono text-sm font-bold ${scoreClasses(s.score)}`}
        title={s.score !== null ? `EQAO score ${s.score.toFixed(1)}/10` : "Not yet rated"}
      >
        {s.score !== null ? s.score.toFixed(1) : "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
        <span className="block text-xs capitalize text-muted-foreground">
          {s.system} · {s.level}
        </span>
      </span>
      <span className="shrink-0 font-mono text-xs text-emerald-700 dark:text-emerald-400">{fmtKm(s.distanceKm)}</span>
    </div>
  );
}

/* ── geo flags ──────────────────────────────────────────────────────────────── */

/** Suspense-streamed risk scan: awaits the flags RPC on its own so the rest of the
 *  page renders without it. A clear result is still information — the "clean bill"
 *  stamp (soft wording: dataset COVERAGE varies by municipality, so "no hits" must
 *  never read as "we verified everything"). null = lookup failed → render nothing. */
async function ThingsToKnow({ lat, lng }: { lat: number; lng: number }) {
  const flags = await getFlagsNearPoint(lat, lng);
  if (flags === null) return null;
  if (flags.length > 0) {
    return (
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {flags.map((f) => (
          <FlagCard key={f.id} f={f} />
        ))}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-border bg-card/40 p-4">
      <p className="inline-flex items-center gap-2 rounded border border-dashed border-emerald-500/40 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
        ✓ Nothing flagged around this address
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        No hits in the public-record datasets we track ({CHECKED_LABELS.join(", ")}).
        Coverage varies by municipality.
      </p>
    </div>
  );
}

/** While the risk scan streams in — tells the user work is happening, not hanging. */
function ThingsToKnowSkeleton() {
  return (
    <div className="mt-3 flex justify-center rounded-lg border border-border bg-card/40 p-4">
      <PulseLoader size="sm" label={`Scanning ${CHECKED_LABELS.length} public-record datasets`} />
    </div>
  );
}

function FlagCard({ f }: { f: AddressFlag }) {
  const Icon = f.kind === "warn" ? TriangleAlert : Info;
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="flex items-start gap-2 text-sm font-medium text-foreground">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${f.kind === "warn" ? "text-amber-600 dark:text-amber-400" : "text-sky-700 dark:text-sky-400"}`} />
        {f.title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{f.source}</p>
    </div>
  );
}

/* ── sold-side snapshot (right column) ──────────────────────────────────────── */

function SoldSnapshot({
  isConsumer,
  gated,
  summary,
}: {
  isConsumer: boolean;
  gated: SoldNearGated | null;
  summary: SoldNearSummary | null;
}) {
  if (isConsumer) {
    if (!gated || gated.count90 === 0) return null;
    return (
      <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Sold-side snapshot</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {gated.medianClose90 !== null ? fmtK(gated.medianClose90) : "—"}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">median sold</p>
          </div>
          <div>
            <p className="font-mono text-lg font-bold tabular-nums text-foreground">
              {gated.closeToAskPct90 !== null ? `${gated.closeToAskPct90}%` : "—"}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">of asking</p>
          </div>
          <div>
            <p className="font-mono text-lg font-bold tabular-nums text-foreground">{gated.count90}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">sales · 90d</p>
          </div>
        </div>
        <p className="mt-2.5 text-[10px] leading-snug text-muted-foreground">
          Closed sales within 2 km, last 90 days · TRREB VOW — for your personal, non-commercial use.
        </p>
      </section>
    );
  }

  // Anonymous: count-only tease. No values are in props on this branch.
  const count90 = summary?.count90 ?? 0;
  if (count90 === 0) return null;
  return (
    <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Sold-side snapshot</h2>
      <div className="mt-3 grid grid-cols-3 gap-3" aria-hidden="true">
        {["median sold", "of asking", "sales · 90d"].map((label) => (
          <div key={label}>
            <div className="redact-skeleton h-6 w-14 rounded" />
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <b className="font-semibold text-foreground">
          {count90} home{count90 === 1 ? "" : "s"}
        </b>{" "}
        sold within 2 km in the last 90 days. The numbers are free with an account.
      </p>
      <Link
        href="/register"
        className="mt-3 inline-flex h-9 items-center rounded-md bg-emerald-500 px-4 text-xs font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400"
      >
        Create free account
      </Link>
    </section>
  );
}

/* ── page ───────────────────────────────────────────────────────────────────── */

export default async function AddressProfileView({
  profile,
  provSlug,
  citySlug,
  canonical,
  isConsumer,
}: {
  profile: AddressProfile;
  provSlug: string;
  citySlug: string;
  canonical: string;
  /** Server-decided (getConsumer() in page.tsx) — drives every gate on this page. */
  isConsumer: boolean;
}) {
  const [lat, lng] = profile.location ?? [null, null];
  const hasGeo = lat !== null && lng !== null;

  // Parallel fetches. The GATED fetchers run ONLY on the consumer branch — the
  // anonymous path never even asks for a VOW value (structural gate).
  // NOTE: the geo-flags scan is NOT awaited here — it streams via <Suspense> in the
  // "Things to know" block below, so a slow/cold flags lookup can never again hold
  // the whole page hostage (it was the entire ~6 s cold TTFB pre-094).
  const [nearby, lease, soldSummary, soldGated, ledgerGated, ledgerPublic, saleRecord] = await Promise.all([
    hasGeo ? getNearbyForSale(lat, lng) : Promise.resolve(null),
    // Live FOR RENT actives — powers the typical-rents grid (asking-side, anon-safe).
    hasGeo ? getNearbyForSale(lat, lng, { transactionType: "lease" }) : Promise.resolve(null),
    hasGeo ? getSoldNearSummary(lat, lng) : Promise.resolve(null),
    hasGeo && isConsumer ? getSoldNearGated(lat, lng) : Promise.resolve<SoldNearGated | null>(null),
    isConsumer
      ? getStreetLedgerGated(profile.address, profile.city, profile.postal)
      : Promise.resolve<StreetLedgerGated | null>(null),
    !isConsumer
      ? getStreetLedgerPublic(profile.address, profile.city, profile.postal)
      : Promise.resolve<StreetLedgerPublic | null>(null),
    // The subject's OWN sale record (VOW) — consumer branch only (structural gate).
    // profile.unit is REQUIRED here: the geocoded address is the building, so without it
    // a unit's page adopts whichever unit in the block sold most recently.
    isConsumer
      ? getSaleRecordByAddressGated(profile.address, profile.city, profile.postal, profile.unit)
      : Promise.resolve<SaleRecord | null>(null),
  ]);
  // Rents + sale-price grids: consumers see ACTUAL closes (VOW, fetched only when
  // isConsumer — structural gate in both fetchers); anon sees asking medians. The
  // already-fetched 2 km actives (lease / nearby) feed the asking paths for free.
  const [typicalRents, typicalPrices] = hasGeo
    ? await Promise.all([
        getBestTypicalRents(lat, lng, isConsumer, lease),
        getBestTypicalPrices(lat, lng, isConsumer, nearby),
      ])
    : [null, null];
  // City link: the hub page only when it actually holds inventory — geocoder community
  // names ("Bolton") aren't TRREB City values, and their hub renders an empty shell.
  // Fallback = map terminal centered here (owner call 2026-07-24).
  const cityLink = await cityHrefOrMap(profile.city, provSlug, hasGeo ? [lat, lng] : null);
  const schools = hasGeo ? getNearbySchools(lat, lng).slice(0, 4) : [];
  let grocery: { name: string; km: number } | null = null;
  let rec: { name: string; km: number } | null = null;
  if (hasGeo) {
    try {
      const a = assignAmenities([lat, lng]);
      if (a.NearestGroceryKm < NO_AMENITY_KM) grocery = { name: a.NearestGroceryName, km: a.NearestGroceryKm };
      if (a.NearestRecCentreKm < NO_AMENITY_KM) rec = { name: a.NearestRecCentreName, km: a.NearestRecCentreKm };
    } catch {
      /* amenity data unavailable — cards simply don't render */
    }
  }

  const provLabel = provSlug.toUpperCase();
  const hubSlug = cityHubSlug(profile.city) || slugify(profile.city) || citySlug;
  const { href: cityHref, isHub: cityIsHub } = cityLink;
  // The unit belongs in the title. A page reached as ".../86-2945-thomas-street" that
  // calls itself "2945 Thomas Street" reads as the whole building, and every number on
  // it inherits that ambiguity.
  const streetOnly = profile.address.split(",")[0];
  const streetAddress = profile.unit ? `Unit ${profile.unit} · ${streetOnly}` : streetOnly;

  // Map-terminal deep link centered on this home (?lat/&lng seed flyTo + the search
  // pin — see properties/page.tsx). NO ?city=: bounds scope the query there, so the
  // geocoder-vs-feed naming split (Nepean vs Barrhaven) can't hide nearby inventory.
  const mapHref = hasGeo
    ? `/properties?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&z=14&pin=${encodeURIComponent(streetOnly)}`
    : `/properties?city=${encodeURIComponent(profile.city)}`;

  // ── Pulse + narrative (asking-side only — anonymous-safe) ──────────────────
  const pulse = nearby
    ? computePulse({
        totalActives: nearby.totalFound,
        newThisWeek: nearby.momentum.newThisWeek,
        cutShare: nearby.momentum.cutShare,
        sitting30: nearby.momentum.sitting30,
        medianDaysListed: nearby.stats.medianDaysListed,
      })
    : null;

  // "If it listed today" bands: top-2 property types with a computable p25-p75 band.
  const bands: ListedTodayBand[] = (nearby?.typeMix ?? [])
    .filter((t) => t.p25 !== null && t.p75 !== null)
    .slice(0, 2)
    .map((t) => ({
      label: t.label,
      count: t.count,
      p25: t.p25 as number,
      p75: t.p75 as number,
      nearest: t.nearest
        ? {
            id: t.nearest.id,
            address: t.nearest.address,
            price: t.nearest.price,
            beds: t.nearest.beds,
            baths: t.nearest.baths,
            subType: t.nearest.subType,
            distanceM: t.nearest.distanceM,
            imageUrl: t.nearest.imageUrl,
            brokerage: t.nearest.brokerage,
          }
        : null,
    }));

  // Default the "if listed today" band to the SUBJECT's likely type, not the raw
  // nearby count-leader (audit #16 — a condo-dense pocket forced "Condo Apartment"
  // onto a detached-house address). Prefer the street's dominant RECORDED type
  // (members only — sold ledger), then the dominant type of same-street LIVE
  // listings (anon-safe IDX). Null → IfListedToday falls back to the non-condo band.
  const subjectStreetName = parseAddress(`${profile.address}, ${profile.city}`).streetName;
  const streetSoldType = dominantSubType((ledgerGated?.sales ?? []).map((s) => s.subType));
  const streetActiveType = subjectStreetName
    ? dominantSubType(
        (nearby?.listings ?? [])
          .filter((l) => streetNamesMatch(subjectStreetName, parseAddress(l.address).streetName))
          .map((l) => l.subType)
      )
    : null;
  const listedTodayDefaultType = streetSoldType ?? streetActiveType ?? null;

  // Hero narrative: market lean + the concrete next-door anchor. The detailed
  // momentum read lives in the pulse card's blurb — don't repeat it here.
  const anchor = bands[0]?.nearest ?? null;
  const narrative = pulse
    ? anchor
      ? `This pocket is ${pulse.lean} right now — ${
          anchor.distanceM !== null ? `${fmtDist(anchor.distanceM)} away, ` : "nearby, "
        }${anchor.address} is asking ${fmtPrice(anchor.price)}.`
      : pulse.blurb
    : null;

  const ledgerCount = isConsumer ? (ledgerGated?.count ?? 0) : (ledgerPublic?.count ?? 0);
  const soldCount30 = isConsumer ? (soldGated?.count30 ?? 0) : (soldSummary?.count30 ?? 0);

  // ── Ticker: interleave NEW / CUT / SOLD for variety ────────────────────────
  const tickerItems: TickerItem[] = [];
  const newItems: TickerItem[] = (nearby?.events ?? [])
    .filter((e) => e.kind === "new")
    .slice(0, 5)
    .map((e) => ({
      kind: "new",
      text: `${e.listing.address} · ${fmtPrice(e.listing.price)}${e.listing.entryMs ? ` · ${relDays(e.listing.entryMs)}` : ""}`,
    }));
  const cutItems: TickerItem[] = (nearby?.events ?? [])
    .filter((e) => e.kind === "cut")
    .slice(0, 3)
    .map((e) => ({ kind: "cut", text: `${e.listing.address} · −${fmtK(e.listing.dropAmount)}` }));
  const soldItems: TickerItem[] = isConsumer
    ? (soldGated?.events ?? []).slice(0, 4).map((s) => ({
        kind: "sold" as const,
        text: `${s.address} · ${fmtPrice(s.closePrice)} · ${fmtSoldDay(s.soldDateMs)}`,
      }))
    : soldCount30 > 0
      ? [{ kind: "sold" as const, text: `${soldCount30} sold nearby this month — sign in to see prices` }]
      : [];
  const maxLen = Math.max(newItems.length, cutItems.length, soldItems.length);
  for (let i = 0; i < maxLen; i++) {
    if (newItems[i]) tickerItems.push(newItems[i]);
    if (soldItems[i]) tickerItems.push(soldItems[i]);
    if (cutItems[i]) tickerItems.push(cutItems[i]);
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Residence",
        name: profile.address,
        address: {
          "@type": "PostalAddress",
          streetAddress: profile.address,
          addressLocality: profile.city,
          addressRegion: provLabel,
          ...(profile.postal ? { postalCode: profile.postal } : {}),
          addressCountry: "CA",
        },
      },
      {
        "@type": "BreadcrumbList",
        // The city row exists only when a real hub backs it — structured data must
        // never point crawlers at the map-terminal fallback (a query URL).
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "/" },
          { "@type": "ListItem", position: 2, name: "Properties", item: "/properties" },
          ...(cityIsHub ? [{ "@type": "ListItem", position: 3, name: `${profile.city}, ${provLabel}`, item: cityHref }] : []),
          { "@type": "ListItem", position: cityIsHub ? 4 : 3, name: profile.address, item: canonical },
        ],
      },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-[1080px] px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/properties" className="hover:text-cyan-600 dark:hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHref} className="hover:text-cyan-600 dark:hover:text-cyan-400">{profile.city}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{streetAddress}</span>
        </nav>

        {/* ── Hero: identity + narrative | pulse gauge ── */}
        <header className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-400">
              Off-market dossier
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{streetAddress}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {[profile.cityRegion, profile.city, provLabel].filter(Boolean).join(", ")}
              {profile.postal && <span className="font-mono text-xs">{profile.postal}</span>}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {/* States what OUR records hold, not what the market is doing. The old copy
                  ("Not currently for sale") asserted a market fact we never checked — and
                  it was wrong the moment a listing reached us late, was withheld from the
                  IDX feed, or sat under a unit we had matched away. */}
              <span className="rounded-full border border-border bg-card/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                No active listing on file
              </span>
              {ledgerCount > 0 && (
                <a
                  href="#ledger"
                  className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:border-emerald-400 dark:text-emerald-400"
                >
                  ◈ {ledgerCount} recorded sale{ledgerCount === 1 ? "" : "s"} on this street
                </a>
              )}
              {nearby && nearby.totalFound > 0 && (
                <a
                  href="#for-sale"
                  className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-700 hover:border-cyan-400 dark:text-cyan-400"
                >
                  {nearby.totalFound} live within {nearby.radiusKm} km ↓
                </a>
              )}
            </div>

            {narrative && <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-foreground">{narrative}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href="#track"
                className="inline-flex h-10 items-center rounded-md bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-500"
              >
                Put this home on my radar
              </a>
              {isConsumer ? (
                ledgerCount > 0 && (
                  <a href="#ledger" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                    Street sale ledger →
                  </a>
                )
              ) : (
                <Link href="/register" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                  What did it last sell for? →
                </Link>
              )}
            </div>
            {!isConsumer && (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                free · no card · alerts when anything moves on this street
              </p>
            )}
          </div>

          {pulse && nearby && (
            <PulseCard
              pulse={pulse}
              momentum={nearby.momentum}
              medianDaysListed={nearby.stats.medianDaysListed}
              radiusKm={nearby.radiusKm}
            />
          )}
        </header>

        {/* ── This home's own sale record (consumer-only; renders nothing without one) ── */}
        {saleRecord && saleRecord.campaignCount > 0 && (
          <div className="mt-5">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-400">
              This home&rsquo;s record
            </p>
            <SaleRecordCard record={saleRecord} />
          </div>
        )}

        {nearby && <ActivityTicker items={tickerItems} radiusKm={nearby.radiusKm} />}

        {/* Dashboard-style superlatives — concrete, repeatable facts (all IDX). */}
        {nearby && <Standouts nearby={nearby} />}

        {/* ── Main grid ── */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {nearby && (
              <IfListedToday
                address={streetAddress}
                bands={bands}
                histogram={nearby.histogram}
                medianAsking={nearby.stats.medianAsking}
                radiusKm={nearby.radiusKm}
                isConsumer={isConsumer}
                defaultType={listedTodayDefaultType}
              />
            )}

            {/* Sell + rent grids directly under the sale-side band (owner: prominent
                placement — the model's estimate, what homes actually sold for, and what
                they rent for are one thought: the whole investor calculation). */}
            <MarketGrids sell={typicalPrices ?? null} rent={typicalRents ?? null} showSignInNudge={!isConsumer} />

            {nearby && (
              <div id="feed" className="scroll-mt-6 [content-visibility:auto] [contain-intrinsic-size:0px_420px]">
                <ActivityFeed
                  activeEvents={nearby.events}
                  soldEvents={isConsumer ? (soldGated?.events ?? []) : []}
                  soldCount30={soldCount30}
                  isConsumer={isConsumer}
                  radiusKm={nearby.radiusKm}
                />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {hasGeo && nearby && (
              <StreetRadar
                centerLat={lat}
                centerLng={lng}
                radiusKm={nearby.radiusKm}
                activePins={nearby.pins}
                soldPoints={soldSummary?.points ?? []}
                isConsumer={isConsumer}
                mapHref={mapHref}
              />
            )}

            <SoldSnapshot isConsumer={isConsumer} gated={soldGated} summary={soldSummary} />

            <div id="ledger" className="scroll-mt-6 [content-visibility:auto] [contain-intrinsic-size:0px_480px]">
              <StreetLedgerCard isConsumer={isConsumer} gated={ledgerGated} publicLedger={ledgerPublic} />
            </div>

            <div id="track" className="scroll-mt-6">
              <TrackAddressCard
                address={profile.address}
                city={profile.city}
                postal={profile.postal}
                lat={lat}
                lng={lng}
              />
            </div>
          </div>
        </div>

        {/* ── Nearby actives carousel: IDX = fully public, no gate. Full container
            width (owner decision 2026-07-23 — this is the page's key conversion
            surface, so it never sits squeezed inside the grid's left column). ── */}
        {nearby && nearby.listings.length > 0 && (
          <section id="for-sale" className="mt-8 scroll-mt-6 [content-visibility:auto] [contain-intrinsic-size:0px_380px]">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                For sale near this home
              </h2>
              <span className="font-mono text-[10px] text-muted-foreground">
                {nearby.totalFound} within {nearby.radiusKm} km
              </span>
            </div>
            <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
              {nearby.listings.map((l) => (
                <NearbyCard key={l.id} l={l} />
              ))}
            </div>
            <Link
              href={mapHref}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-500"
            >
              See all {nearby.totalFound} on the map →
            </Link>
          </section>
        )}

        {/* ── The block, scored: schools + daily life + risk scan ── */}
        {(schools.length > 0 || grocery || rec || hasGeo) && (
          <section className="mt-8 [content-visibility:auto] [contain-intrinsic-size:0px_600px]">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">The block, scored</h2>
              <span className="font-mono text-[10px] text-muted-foreground">public records · EQAO · Overture</span>
            </div>

            {schools.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {schools.map((s) => (
                  <SchoolRow key={s.id} s={s} />
                ))}
              </div>
            )}
            {schools.length > 0 && (
              <p className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                <span>EQAO-based score out of 10 · straight-line distance</span>
                <Link href={`/family/${hubSlug}/top-rated-schools`} className="text-cyan-700 hover:underline dark:text-cyan-400">
                  All top-rated schools in {profile.city} →
                </Link>
              </p>
            )}

            {(grocery || rec) && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {grocery && (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-4">
                    <Footprints className="h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">Groceries · {grocery.name}</span>
                      <span className="block text-xs text-muted-foreground">nearest supermarket</span>
                    </span>
                    <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{fmtKm(grocery.km)}</span>
                  </div>
                )}
                {rec && (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-4">
                    <Dumbbell className="h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">Recreation · {rec.name}</span>
                      <span className="block text-xs text-muted-foreground">nearest community/rec centre</span>
                    </span>
                    <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{fmtKm(rec.km)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Things to Know: Suspense-streamed so the flags RPC never blocks the page. */}
            {hasGeo && (
              <Suspense fallback={<ThingsToKnowSkeleton />}>
                <ThingsToKnow lat={lat} lng={lng} />
              </Suspense>
            )}
          </section>
        )}

        {profile.provenance === "postal" && (
          <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> Location is approximate — placed from postal code {profile.postal}.
          </p>
        )}

        {/* Public exploration links (internal-link value + crawl path). The schools/
            walkable pills are hub-derived pages — hidden when no real hub backs this
            city name (they'd be as empty as the hub itself); the first pill then
            points at the map terminal instead of a dead shell. */}
        <section className="mt-8 flex flex-wrap gap-2">
          <Link href={cityHref} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-700 dark:hover:text-cyan-300">
            Homes for sale {cityIsHub ? `in ${profile.city}` : `near ${streetAddress}`} →
          </Link>
          {cityIsHub && (
            <>
              <Link href={`/family/${hubSlug}/top-rated-schools`} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-700 dark:hover:text-cyan-300">
                Top-rated schools in {profile.city} →
              </Link>
              <Link href={`/lifestyle/${hubSlug}/most-walkable`} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-700 dark:hover:text-cyan-300">
                Most walkable homes in {profile.city} →
              </Link>
            </>
          )}
        </section>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
