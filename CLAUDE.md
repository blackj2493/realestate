This file governs all AI coding agent behavior for Claude operating within the PureProperty.ca repository.

> **Maintenance note:** §§1–11 are the durable strategy/compliance charter — change them deliberately. §§12–13 are the operational/feature snapshot and drift fastest; refresh them whenever workflows, migrations, ETL line numbers, or major feature domains change. Last full audit: 2026-07-08 (against migration `055`).

## 1. Core Mission & Strategy
PureProperty.ca is not a consumer portal; it is the "Bloomberg Terminal for Canadian Real Estate."
- **The Ultimate Goal:** Overtake HouseSigma in utility and capture traffic volume comparable to Realtor.ca by serving the top 1% of high-intent users.
- **Target Audience:** High-intent, analytical retail investors, developers, and boutique wholesalers. We actively filter out casual window-shoppers.
- **Positioning:** Real estate is a mathematical instrument. We provide institutional-grade "shadow data" (True DOM, Capital Burn Rate, Suite Potential) that consumer brokerages actively obscure to protect the industry.

---

## 2. User Personas & Feature Mapping
UI elements, state stores, and derived metric engines must be built specifically for these distinct personas. Do not build generic "one-size-fits-all" features.

| Persona | Primary Goal | Key Features & Metrics Required |
| :--- | :--- | :--- |
1. **Cashflow Investor** | Maximize monthly yield and ROI. | Cap Rate / Gross Yield (Underwriting Sandbox), Cashflow Calculator, Rent AVM, Tenant Overlap Detection. |
2. **Flipper & Deal Hunter** | Buy under market value, force appreciation. | True-DOM Campaign-History Ledger, Deal Score / "Deal Read", Force-Appreciation (Value-Add) engine, Distress Engine, Carrying Cost Calculator. |
3. **Smart Homebuyer** | Avoid bidding wars, find hidden value (basements). | Suite Potential (Duplex conversion flags), Carrying Costs, Things-to-Know diligence, Standard Status alerts. |
4. **Builders & Developers** | Land assembly and missing-middle housing. | Zoning Overlays (municipal open data), Price-per-Buildable-Square-Foot, Lot Dimension extraction, surplus-parking / density flags. |

> The metric names above are the persona *charter* (what each persona needs). For where each is actually implemented today, see **§13 Feature Map**. Note: the legacy `TemporalDistressEngine` DOM code and standalone `ExtrapolatedCapRateEngine` UI have been superseded — True DOM now lives in `src/lib/campaignHistory/`, and cap-rate/yield math is centralized in `src/lib/underwriting/` + `src/lib/finance/canadianMortgage.ts`.

---

## 3. App Structure & Core Pages
The application architecture is strictly partitioned into three critical phases.

### A. Onboarding ("The Velvet Rope")
- **Objective:** Fulfill VOW compliance (which requires an account to view sold data) while generating psychological exclusivity.
- **Design:** A high-friction, 3-step "Application for Terminal Access." Do not use a generic 1-click Google login on the public landing page. Use the onboarding flow to capture investor intent (e.g., "What is your primary investment strategy?").

### B. The Terminal Page (Command Center)
This is the primary interface and the core engine of the platform.
- **Objective:** Zero Time-To-Value (TTV). The user must be dropped immediately into the data.
- **UI/UX:** 100vh layout. No scrolling hero images. No generic marketing copy. No hiding powerful tools behind "More Filters" dropdowns.
- **The Map Engine:** Replace traditional Google Map clusters with Deck.gl / Mapbox WebGL 3D geospatial rendering. Render 3D hexagon heatmaps that visualize Yield, DOM, or Price Compression across neighborhoods.
- **Data Connection:** This page is completely blind to Supabase. It connects *exclusively* to Typesense for sub-50ms, in-memory search to ensure instant map and list updates when sliders are adjusted.
- **State Management:** Governed exclusively by `src/lib/stores/commandCenterStore.ts`.

### C. Individual Listing Page (The 70/30 Asymmetric View)
- **Objective:** Immediate financial analysis without leaving the context of the property.
- **Layout:** A strict 70/30 split terminal view.
  - **Left Side (70%):** Structural data, unparsed address, and an image "bento grid" replacing the standard real estate image carousel.
  - **Right Side (30%):** A sticky, interactive financial calculator (Cap Rate, Carry Cost, Downpayment sliders).
- **Interactivity:** As the user adjusts mortgage rates or down payments on the right side, the Capital Burn Rate and Yield metrics must instantly recalculate.

---

## 4. Strict Legal & Compliance Guardrails (CRITICAL)
Any code touching the TRREB IDX/VOW data feeds must adhere strictly to board agreements. **Failure to comply risks API revocation.**
- **No AI Data Processing:** You are strictly forbidden from passing raw IDX/VOW Listing Information through any LLM or AI System for transformation. All derived metrics (Yield, True DOM, Cap Rate) must be calculated using deterministic, hardcoded logic in the Node.js ETL pipeline.
- **Pagination & Display Limits:** Any UI query responding to a user search must limit the retrieved listings to a maximum of 100 properties.
- **Data Freshness:** The ETL pipeline must ensure that VOW and IDX data displayed on the frontend is refreshed at least every 24 hours.
- **Mandatory Brokerage Display:** The listing Brokerage must be clearly displayed for all listings (including thumbnails) in the same font/size as other listing details, without visual separation.

---

## 5. Architecture: The "Shadow MLS"
Do not introduce direct database calls from the Next.js frontend to Supabase for property searches.
1. **Ingestion (ETL Worker):** Bypasses board rate limits via background cron jobs (delta syncs).
2. **The Vault (Supabase/Postgres):** The immutable historical record. Stores raw JSONB. Used for heavy spatial queries (zoning polygons), AVM training data, and historical stitching (property-hash entity resolution → True-DOM campaign-history ledger). NOTE: server-side API routes (`src/app/api/**`) DO read Supabase directly for AVM, market aggregates, schools, zoning, etc. — the "frontend queries Typesense exclusively" rule (§3B) applies to the **Command Center property search/map**, not to every server route.
3. **The Search Engine (Typesense):** The "Brains". In-memory, typo-tolerant search. **The frontend queries Typesense exclusively.**

I am using supabase and railways

---

## 6. Data Handling & Messy JSON Transformations
Real estate IDX/VOW data is notoriously dirty and case sensitive. When modifying `scripts/worker/transformer.ts`:
- **Expect Nulls and Inconsistencies:** Payloads contain overlapping array fields (e.g., `Basement: ["Full", "Finished"]`), heavily nested room dimensions (`WashroomsType1Pcs`, `RoomsBelowGrade`), and missing booleans.
- **Strict Typesense Schema Enforcement:** Every field declared in the Typesense schema MUST be present in the `typesensePayload`. You must apply aggressive fallbacks (`?? 0`, `|| ''`, `false`). Typesense will reject entire batches if a single object is missing a declared key.
- **Explicit Field Assignment:** Build Supabase records field-by-field. NEVER use spread operators (e.g., `{...t.supabasePayload}`) for upserts, as nested objects will crash integer column constraints.

---

## 7. Development Commands & Infrastructure
* `npm run dev` / `build` / `start` — Next.js standard commands.
* `npm run lint` (eslint) / `npm run typecheck` (`tsc --noEmit`) / `npm test` (vitest run) — CI gates; `pr-validation.yml` runs all three on every PR.
* `npx tsx scripts/worker/ingester.ts sync` — TRREB dual-query delta sync (Active via IDX + Sold via VOW); must use `import 'dotenv/config'`. This is the step the nightly workflow invokes.
* `npm run sync:daily` (`scripts/worker/dailySync.ts`) — Railway-cron entry point that reproduces the full daily pipeline outside GitHub Actions.
* `scripts/worker/sync.ts` — the ETL Sync **Orchestrator** (dual-writes Supabase + Typesense, refreshes campaign history). It is a library imported by `ingester.ts`, not a standalone CLI you run directly.
* `npm run smoke:mobile` (`scripts/admin/mobileSmoke.ts`) — mobile smoke check. `npm run demo:record` / `demo:fixture` — demo recording.
* **Database Clients:** `src/lib/supabase/client.ts` contains `getServerClient()` (RLS enforced) and `getServiceRoleClient()` (RLS bypassed, strictly for ETL workers). Browser/server/middleware SSR clients live under `src/lib/supabase/`.
* **Typesense Queries:** Typesense requires colon-operator syntax (`FieldName:>=value`). Standard JS syntax produces HTTP 400 errors.

---

## 8. Output Protocol:
When I (the user) ask for implementation details, you must format your response as a strict, copy-pasteable block. It must include:
1. **Target File(s):** Exact file paths to create/modify.
2. **Context/Objective:** A 1-sentence summary of what the code achieves.
3. **Exact Logic & Constraints:** Data fallback requirements, specific Tailwind classes, and state management targets.
4. **Code Block:** The exact implementation code.

Start each session by writing a detailed plan with phases before writing the code
Ask Clarifying questions if you are not 90% confident on how to proceed
Break the project into smaller tasks and commit to source control between phases

## 9. Model Routing
Use Haiku for renaming, formatting, simple lookup, JSON cleanup
Use Sonnet for standard components debugging, code review, API transformers
Use Opus for: Architecture decisions, data model design, complex refactors

## 10: Non negotiable quality bar
Every feature must be measurably better than housesigma or realtor.ca on at least one dimension; more data visible, cleaner to scan, or exposing insight they don't have. If a component is just equivalent, it is not worth shipping.

## 11.
This project integrates two TRREB data feeds. Before writing any code that reads, displays, or transforms listing data, consult the relevant docs below.

### API Payloads & Response Structure
Read these on demand (do NOT assume field names from memory — the feeds are case-sensitive and quirky):
- `.claude/docs/api/trreb-idx-payload.md` — IDX feed field schema and payload spec
- `.claude/docs/api/trreb-vow-payload.md` — VOW feed field schema and payload spec
- `.claude/docs/api/vow-response-example.json` — Real example VOW API response

### Legal Agreements & Rules
- `.claude/docs/legal/idx-agreement.pdf` — IDX display rules, dos and don'ts
- `.claude/docs/legal/vow-agreement.pdf` — VOW display rules, dos and don'ts

**Always check the agreement files before implementing any listing display feature to ensure compliance with TRREB data licensing rules.**

## 12. Operational notes
- **Daily sync** runs via `.github/workflows/daily-sync.yml` at 03:00 UTC. It is no longer a single step — the job runs a full pipeline in order: `ingester.ts sync` → `refresh-condo-fee-stats` → `refresh-market-summary` → `refresh-property-sale-history` → `refresh-sqft-calibration` → `refresh-avm-trend-offset` → `refresh-property-estimates` (`--since 25h`) → `enrichGeoFlags` (`--since 25h`) → **Send Watchlist Alerts** (`alerts.ts`) → `revalidateListings` → `pruneVowAccessLog`. It opens a GitHub issue on sync failure.
- **All scheduled workflows (`.github/workflows/`):** keep this list current when adding/removing crons.
  | Workflow | Cron (UTC) | Cadence | Runs |
  | :-- | :-- | :-- | :-- |
  | `daily-sync.yml` | `0 3 * * *` | daily | full sync pipeline (above) |
  | `estimates-recompute.yml` | `0 7 * * 0,3` | Sun & Wed | sharded `refresh-property-estimates` + `reconcile-sold-from-vault` |
  | `freshness-check.yml` | `0 */6 * * *` | every 6h | `freshnessCheck.ts` data-age heartbeat |
  | `warm-sitemaps.yml` | `0 */6 * * *` | every 6h | warm sitemap URLs |
  | `refresh-rental-index.yml` | `0 5 * * 1` | Mondays | `refreshRentalMarketIndex.ts --apply` |
  | `refresh-geo.yml` | `0 6 15 * *` | monthly (15th) | `loadGeoData.ts --all` + `enrichGeoFlags` full sweep |
  | `refresh-zoning.yml` | `0 6 20 * *` | monthly (20th) | `load-zoning.ts` + `backfill-zoning --apply` |
  | `refresh-amenities.yml` | `0 7 5 2,5,8,11 *` | quarterly | `backfill-amenity-fields --apply` |
  | `refresh-schools.yml` | `0 8 1 1,4,7,10 *` | quarterly | `build-schools-dataset --refresh` + `backfill-school-fields` |
  | `monitor-avm-accuracy.yml` | `0 9 3 * *` | monthly (3rd) | `avm-backtest.ts` → `avmDriftCheck.ts` (drift gate) |
  | `retrain-avm.yml` | `0 8 6 * *` | monthly (6th) | `avm/trainMatrices.ts` (challenger→staging) → backtests → `avm/promoteChallenger.ts` (compare-only unless dispatched to promote) |
  | `pr-validation.yml` | — | on PR | lint + typecheck + test |
- **GitHub secrets required (CRITICAL):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROPTX_IDX_TOKEN` — TRREB IDX feed bearer token. Used **only** for Active listings (Query A in `ingester.ts`).
  - `PROPTX_VOW_TOKEN` — TRREB VOW feed bearer token. Used **only** for Sold/Closed listings (Query B → `raw_vow_sold`).
  - `TYPESENSE_ADMIN_API_KEY` — Typesense admin key. Still required by the sync step (the orchestrator dual-writes to Typesense), but the key is now validated **lazily** inside `getAdminClient()` in `sync.ts` — importing the module (via `ingester.ts`) no longer throws at load time. A missing key surfaces when the write actually runs, not as an import-time exit 1. (History: added 2026-05-24 after a module-load hard-throw broke the nightly sync 05-22→05-24; the load-time throw was later removed in favor of lazy validation.)
  - `RESEND_API_KEY` — Resend API key for the **Send Watchlist Alerts** step (`scripts/worker/alerts.ts`). OPTIONAL: the step is `continue-on-error` and no-ops cleanly when unset, so a missing key never breaks the core sync. Optional companions: `ALERTS_FROM_EMAIL` (must be a Resend-verified sender; defaults to `support@pureproperty.ca`) and `NEXT_PUBLIC_SITE_URL` (link base in emails; defaults to `https://pureproperty.ca`).
- **Watchlist accounts & alerts (foundation added 2026-05-24, since expanded).** Auth is wired via **Supabase Auth (magic link)** + `@supabase/ssr` — the dormant next-auth/Prisma stack was deleted. Accounts are OPTIONAL (anonymous-first stays); signing in syncs the watchlist across devices and enables email alerts. The base tables `profiles` + `watchlist` live in migration `015_auth_profiles_watchlist.sql` (RLS owner-only via `auth.uid()`). The alerting surface has since grown well beyond watchlist price-drops: saved-market **bubbles** + digests (`025_market_bubbles`, `034_bubble_alerts`), **listing alerts** with delivery tracking (`051`/`052_listing_alerts*`), and **viewing requests** (`036`). The nightly **Send Watchlist Alerts** step (`alerts.ts`) emails per-user price-drop / status-change / new-in-bubble digests off the freshly-synced Typesense index — deterministic comparison only (no LLM, §4), one email/user/day.
- **Migrations are at `055` (not 015).** `supabase/migrations/` runs 001→055; `scripts/admin/applyMigrationNNN.ts` exists through 050, and `scripts/worker/avm/trainMatrices.ts` references `055_avm_staging`. When documenting or applying migrations, check `supabase/migrations/` for the true latest — do NOT assume 015/020 are current. Notable later migrations: `050_zoning_areas`, `053_vow_access_log`, `054_geo_flags_checked`, `055_avm_staging` (AVM champion/challenger).
- **IDX and VOW are TWO DISTINCT TRREB tokens — they are not interchangeable.** The ingester reads them strictly at `scripts/worker/ingester.ts:319-320` (`IDX_TOKEN` / `VOW_TOKEN`, each `.trim()`ed) with **no fallback chain**; they are re-validated at the point of use (~lines 447 and 517). The legacy `RESO_BEARER_TOKEN` is unused and must not be reintroduced (its presence in the workflow caused a 6-day silent sync outage on 2026-05-14 when the dual-token refactor shipped without updating the workflow). When adding env vars to the workflow, IDX and VOW must always be passed explicitly.
- **Cursor-on-failure is now SAFE (the old silent-failure bug is FIXED).** Historically the catch block advanced `sync_state.last_sync_timestamp` to NOW even on `status='failed'`, permanently rolling the cursor into an unrecoverable gap. That is no longer the case: the failure handler at `ingester.ts:~1279-1294` **preserves** the previous cursor via `nextSyncCursor('failed', previousCursor, …)` (`scripts/worker/syncCursor.ts`), and if `readSyncState()` itself failed (cursor unknown) it writes **nothing**, so the next run re-reads the true cursor and re-runs the window. `nextSyncCursor` only advances to NOW on `'completed'`. So a missing token / mid-sync failure now safely re-runs the same window next night — no manual `sync_state` SQL reset required. (`syncCursor.ts` is unit-tested and documents this contract.)
- `raw_vow_sold` holds ~217k historical records in prod. Never run migrations that alter its schema; it is read-only for AVM, append-only for daily sync.
- **DB connection strings for admin/migration scripts (READ THIS BEFORE RUNNING `scripts/admin/*.ts`).** These scripts (e.g. `applyMigrationNNN.ts`, `backfill020.ts`) open a raw `pg` client via `DATABASE_URL || DIRECT_DB_URL`. The two are NOT interchangeable:
  - `DIRECT_DB_URL` = the **direct** host `db.<ref>.supabase.co:5432`. It is **IPv6-only** and does **not** resolve from local dev / CI here — it fails with `getaddrinfo ENOENT`. Having it defined is NOT enough; it cannot be used to run scripts from this environment. (It does contain the password + project ref, but the pooler host/region is NOT derivable from it.)
  - To actually run these scripts, set **`DATABASE_URL` to the Supabase Session pooler string** (Dashboard → Settings → Database → Connection string → **Session pooler**, port **5432** — *not* the Transaction pooler on 6543; our scripts use a session-level `SET statement_timeout` and run DDL, which transaction mode drops). The pooler is IPv4-reachable. Put it in `.env.local` (never commit it).
  - **SQL editor caveat:** instant DDL (ADD COLUMN, CREATE FUNCTION) is fine to paste into the Supabase SQL editor, but heavy ops — full-table `UPDATE`s and partial indexes whose predicate detoasts `full_payload` JSONB across ~112k rows — exceed the editor's gateway timeout ("upstream timeout"). Those belong in a pooler-connected script that runs `SET statement_timeout TO '0'` and batches by id cursor (pattern: migration `020_region_aggregates.sql` = slim DDL; `scripts/admin/backfill020.ts` = batched backfill + index builds).

---

## 13. Feature Map (implemented surface)
§§1–5 describe the *charter*. This section maps the product as actually built, so you can find the right module before writing code. Directories are under `src/` unless noted. When you add a major feature domain, add it here.

### Pages & routes (`app/`)
- **Marketing / onboarding:** `/` (hero), `/apply` (velvet-rope investor-intent onboarding → `/api/onboarding/apply`), `/login` (magic link), `/register` (→ `/login`), `/welcome` (VOW terms gate), `/operated-by` (TRESA brokerage disclosure), `/privacy`, `/terms`, `/glossary`.
- **Terminal / search:** `/properties` (deck.gl + Mapbox map browser, the Command Center).
- **Listing detail:** `/properties/[id]`, public SEO variant `/address/[prov]/[city]/[slug]`, `/properties/compare`.
- **AVM / lead-gen funnel:** `/avm` (gated → `/hidden-equity`), `/hidden-equity`, `/whats-my-home-hiding` (renovation "challenge" share funnel).
- **Dashboard / analytics:** `/dashboard` (mission control), `/analytics` (market trends).
- **SEO hubs & persona landing pages:** `/property[/prov/city[/neighbourhood]]`, `/commercial/[prov]/[city]`, `/family/[city]/top-rated-schools`, `/lifestyle/[city]/{most-walkable,new-construction}`, `/investments/[city]/{highest-cap-rate,development-potential}`. All emit per-city metadata + OG cards and must stay in sync with `app/sitemap.ts`.
- **Sharing / OG:** `/share/[token]` (anonymous tokenized shares → `/api/share`), `/og` + `/api/og/whats-my-home-hiding` dynamic OG images.
- **Key API routes (`app/api/`):** `avm[/cohorts|/hidden-equity]`, `estimates/sale-price`, `properties/listings` (**≤100 cap, §4**), `property/[id][/deal-score|/view]`, `properties/[id]/similar`, `market/{activity/sold,leaderboard,price-trend,region-stats}`, `underwriting`, `watchlist[/dispositions|/migrate]`, `bubbles[/[id][/stats]]`, `schools/{search,nearby,[id],catchments}`, `amenities/nearby`, `geocode`, `isochrone`, `zoning`, `viewing-requests`, `listing-alerts[/unsubscribe]`, `vow/accept-terms`, `sync`, `revalidate`, `health`. Public endpoints are per-IP rate-limited (`lib/rateLimit.ts`).

### Command Center terminal
- **`lib/stores/commandCenterStore.ts`** — the single large Zustand store: persona, universal + terminal filters, sale/rent mode, For Sale·Sold·Leased·For Rent layers, sold-comp window + VOW lock, Compare basket (MAX 8), map bounds/fly-to, comps-on-demand (drop-pin → constrained sold comps), map modes (listings/heatmap/3D), zoning toggle, instrument-deck rail modules, color-by-metric + legend bands, freehand draw-to-search, DOM scrubber, ⌘K palette.
- **`components/CommandCenter/`** (~50 files) — FilterBar/Drawer/Chip, LedgerPanel/Row, MapModeDock, MapControlRail, Map{Lenses,Color,Draw,Compare}Panel, MapTimeline, MapCommandPalette, QuickLookPanel, CompsPopover, {School,Commute,Amenity}Filter, SaveBubbleDialog, LocationSearchV2, CampaignHistoryChart, DOMTimelineChart.
- **Search/filter engines:** `lib/search/` (NL parse `nlParse.ts`, search chips, federated suggest, persona rank), `lib/filters/` (filter registry, fundamentals, histogram, `terminalQuery.ts`), `lib/typesense/` (schemas + "Shadow MLS" `DistressEngine`, `TemporalDistressEngine` [entity resolution/stitching only], `ExtrapolatedCapRateEngine`, `EligibilityFilter`).

### Personas
- **`lib/personas/personaConfig.ts`** — single source of truth for the 4 personas (`smart | cashflow | flippers | builders`): per-persona filter controls, Typesense `filter_by`, ledger columns, map coloring. `resolvePersona.ts` sets cross-surface precedence (URL `?lens` → persisted → `/apply` objectives → per-scope default). Switchers in `components/personas/` + `components/dashboard/PersonaLens.tsx`.

### AVM & valuation
- **`lib/avm/`** — anchor-and-adjust engine: `calculator.ts` (anchor × exp(Σ standardized betas)), `anchorService.ts` (recency-weighted robust local anchor + confidence band), `matrixService.ts` (offline RidgeCV coefficient matrix, `avm_multiplier_matrix`), `auditService.ts` (R² gate), `cohorts.ts`/`loadCohortTree.ts`, plus condition/feature/livingArea/salePrice/trendOffset/siblingModel helpers. **No AI at request time (§4).**
- **`lib/avm/valueAdd/`** — Force-Appreciation / renovation-ROI engine (`engine.ts`, `moveCatalog.ts`/`anonCatalog.ts`, `calibration.ts`) backing Hidden Equity + listing force-appreciation cards.
- **Champion/challenger training (offline):** `scripts/worker/avm/{trainMatrices,promoteChallenger,ingest-matrices}.ts` + `scripts/worker/avmDriftCheck.ts` (drift gate); staging in `055_avm_staging`. UI: `components/avm/`.

### Listing-detail analytics
- **`lib/dealScore/`** — persona-conditioned 0–100 "Deal Read" grade + suggested-offer band.
- **`lib/underwriting/`** — pure buy-and-hold underwrite (cashflow/cap/cash-on-cash/DSCR/carry); `lib/finance/canadianMortgage.ts` is the single source of truth for all carry/cap math (Canadian semi-annual compounding).
- **`lib/campaignHistory/`** — True-DOM ledger (relist-corrected days-on-market); replaced the old TemporalDistressEngine DOM code.
- **`lib/property/`** — listing assembly + `theRead.ts` (persona verdict), `diligence.ts` (Things-to-Know), `dealBreakers.ts`, `rentalSnapshot.ts`. `lib/comps/` + `lib/sold/` (VOW-gated sold comps). `lib/condo/feeStability.ts`, `lib/metrics/sanityBand.ts`.
- **`components/Property/`** (~30 files) — DealScoreCard, TheReadCard, UnderwritingSandbox, ForceAppreciationCard, EstimatedSaleCard, RoomMap, CondoFeeStabilityCard, ThingsToKnowCard, CampaignHistorySection, SaleHistorySection, ScheduleViewingForm, etc.

### Geo / zoning / schools / amenities
- `lib/zoning/attribution.ts` (municipal-open-data provenance + required attribution — distinct from MLS licensing) + `components/Map/useZoningLayers.ts`; `lib/schools/` (schoolLens, nearestSchools) + `useSchoolCatchmentLayers.ts` (attendance boundaries, `038`/`039`); `lib/amenities/nearestAmenities.ts` (Overture Maps walkability); `lib/geo/simplifyRing.ts` (RDP simplification for Typesense-safe polygons) + isochrone commute rings.

### Watchlist, bubbles, alerts, dashboard, compare
- `lib/watchlist/` (anon localStorage + auth-synced, dispositions), `lib/bubbles/` (sign-in-gated saved filter+area views + stats), `lib/alerts/` (transitions classifier, digest/bubbleDigest, listing-alert email, unsubscribe). `lib/dashboard/` + `components/dashboard/` (~30 files: ActionFeed, MarketPulse, region leaderboards, playlists). `lib/compare/` + `components/compare/` (8-way grid, winner highlighting). `lib/market/` (precomputed VOW-gated region aggregates feeding `/analytics`).

### Auth, VOW compliance, discovery, theming
- `lib/auth/requireConsumer.ts` (soft `getConsumer()` teaser / hard `requireConsumer()` 401 VOW gate) + `lib/audit/vowAccessLog.ts` (PROPTX §5.4 access trail, `053`). `components/auth/` (MagicLinkForm, PasskeyPrompt, AcceptTermsForm, VowGateOverlay).
- `lib/discovery/featureRegistry.ts` — in-app onboarding: feature guide, What's-New, tours, spotlights, mastery meter.
- `components/daylight/primitives.tsx` — the "Daylight Terminal" light-mode instrument design system (see `LIGHT_DARK_THEME_PLAN_2026-07-01.md`).

### ETL worker (`scripts/worker/`)
- Core: `ingester.ts` (RESO OData fetcher + delta/cursor), `sync.ts` (dual-write orchestrator), `transformer.ts` (raw → supabase/typesense payloads, §6), `alerts.ts` (nightly digests), `syncCursor.ts` (cursor contract), `dailySync.ts` (Railway entry). Enrichment: `enrichGeoFlags`, `mediaEnrichment`, `roomsEnrichment`, `soldIndexer`, `delistedIndexer`/`delistedMapper`, `staleSearchDocs`, `freshnessCheck`, `revalidateListings`, `pruneVowAccessLog`. Services: `services/{rentAVM,rentModel,financialMetrics,multiUnitCalculator,ratioPriceCalculator,parkingCalculator}.ts`. Recovery: `reset-sync-state.ts`, `reindex-from-vault.ts`.
