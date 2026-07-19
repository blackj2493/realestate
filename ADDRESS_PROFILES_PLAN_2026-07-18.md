# Address Profiles — "no address dead-ends" (2026-07-18)

## Objective
Any searched address resolves to a useful page. Today `/address/{prov}/{city}/{slug}` 404s
unless the slug ends in a sold-record ListingKey (~2-yr VOW window) — exactly the moment a
HouseSigma-habituated visitor bounces. Instead: resolve every address, lead with **nearby
active listings** (IDX — fully anon-displayable, our strongest legal hook), add public
context (schools/walkability/geo flags), and capture the lead via "Track this address"
(email-only, no account) — funneling into the search loop where the account ask lands on
save-search/favourite intent.

Design mockup (approved in conversation): claude.ai/code/artifact/50f226c1 — actives-first,
AVM pull-not-push, area-level value stats.

## Resolution ladder (key-less slug)
1. **Active match** — Typesense `properties` by `UnparsedAddress` + `addressesMatch`
   (pattern: watchlist dispositions `fetchRelists`) → redirect to `/properties/{id}`.
2. **Sold match** — `sold_listings` by address (pattern: `fetchSoldByAddress`) → redirect
   to the canonical keyed `/address/.../{street}-{KEY}` page (existing VOW-gated flow).
3. **Geocode** — server-side Mapbox (existing `NEXT_PUBLIC_MAPBOX_TOKEN`), 24h
   `unstable_cache` on the query; postal-code DB (`src/lib/postalCodes.ts`) as fallback
   when the slug carries a postal. → render the profile.
4. Nothing usable (no civic number, geocode miss) → `notFound()`.

## Phases
- **P1 — resolution + profile page** (this branch):
  `src/lib/address/{resolveProfile,nearbyForSale,flagsNearPoint}.ts`,
  `src/components/address/{AddressProfileView,TrackAddressCard}.tsx`, page branch in
  `src/app/(app)/address/[prov]/[city]/[slug]/page.tsx` (+ metadata mirror; keyed sold
  flow untouched). Nearby actives via native Typesense radius
  `location:(lat, lng, R km)` + `sort_by location(lat,lng):asc` — smoke-tested live
  2026-07-18 (243 hits / 2 km Hamilton, `geo_distance_meters` returned). Brokerage on
  every card, same type size as details (CLAUDE.md §4, audit R2 fallback included).
  Profile pages are `noindex,follow` for v1 (unbounded URL space; flip when the owned
  address corpus lands — see Later).
- **P2 — lead capture**: migration `077_address_watches.sql` (email + address_key unique,
  RLS on/no policies = service-role only), `POST /api/address-watches` (clone of
  listing-alerts route: 5/min/IP, validation, idempotent upsert, best-effort Resend
  confirmation). Capture ships first, delivery is a follow-up — same playbook as
  listing-alerts (route comment documents this precedent).
- **P3 — geo flags at a point**: migration `078_flags_near_point.sql` — PostGIS RPC over
  `geo_features` (specs jsonb from `GEO_DATASETS`, per-feature `_match_radius_m`
  override honoured; precedent: `zoning_in_bbox`, migration 050). Page degrades to
  hidden section until the RPC is applied. Low-frequency long-tail pages + 24h cache →
  acceptable vs the Disk-IO budget that mandates precompute for the listing flow.
- **P4 — search wiring**: header `LocationSearch` (navigate): address-shaped free text /
  address picks with no listing → address-profile URL (chokepoint `targetToHref` /
  `applyTarget`). Terminal `LocationSearchV2` geo rows keep fly-to+pin, gain a
  "Profile →" secondary action.

## Deliberately deferred (documented, not built)
- **Value curve panel** (benchmark by property type): blocked on index licensing —
  Teranet=paid commercial licence; CREA HPI=member access, embed needs CREA sign-off;
  StatCan=OGL-free but coarse; own sold-archive index=clean for gated layer, anon
  display needs the legal memo. Decide source → then build.
- **address_watches delivery** in `scripts/worker/alerts.ts` (address→active match reuses
  `parseAddress`/`addressesMatch`), monthly value report (email-comms branch).
- **Owned address corpus** (StatCan ODA + municipal address points) → stable slugs,
  sitemap, flip noindex→index, drop per-miss Mapbox calls.
- Migrations 077/078 are **written but NOT applied to prod** — apply via
  `npx tsx scripts/admin/applyMigrationFiles.ts 077_address_watches.sql 078_flags_near_point.sql`
  (Session-pooler `DATABASE_URL`) after owner OK. All new surfaces no-op cleanly until then.

## Compliance posture (audit-aligned)
Profile page renders ZERO VOW data: actives are IDX (public by design, brokerage
displayed); schools/walkability/geo-flags are open data; sold teaser is a static
"members see sold history" card with no data fetch (no existence leak). The VOW consumer
gate stays the conversion wall. No LLM touches listing data (§4).
