This file governs all AI coding agent behavior Claude operating within the PureProperty.ca repository.

## 1. Core Mission & Strategy
PureProperty.ca presents as the "Bloomberg Terminal for Canadian Real Estate" — but the terminal is the **hook, not the product**. The product is a **transaction lead**, and the platform is a lead-generation engine dressed as an analytics terminal.

### How We Make Money (read this before making any strategic trade-off)
The differentiated data features are a **USP / customer-acquisition wedge**, not a revenue source. We never charge users for data. Revenue comes from the high-intent buyers and sellers the data attracts:
1. **Now — Lead monetization:** Sell qualified buyer/seller leads to partner agents, or work the leads we generate ourselves. Every high-intent user captured is the unit of value.
2. **Endgame — Own brokerage:** Stand up our own brokerage and earn a **commission split from our own realtors** on transactions our platform sources. The lead funnel built today becomes the brokerage's deal flow tomorrow.

**Strategic consequence:** Because the asset is *captured, high-intent, contactable users who are likely to transact*, every product decision optimizes for **attracting and converting** those users — never for filtering them out. Volume of qualified leads > exclusivity.

- **The Ultimate Goal:** Become the acquisition front-end for a brokerage. Use institutional-grade "shadow data" to out-differentiate HouseSigma and Realtor.ca, pull high-intent transactors off those portals, capture them as accounts, and convert them into leads (and eventually brokerage clients).
- **Target Audience:** High-intent, ready-to-transact buyers, sellers, and investors — analytical retail investors, flippers, homebuyers, and developers. These are people likely to *do a deal*, which is exactly what a lead is worth. We attract them with depth; we do not turn anyone away.
- **The USP (why users pick us over incumbents):** Real estate is a mathematical instrument. We expose institutional-grade "shadow data" (True DOM, Capital Burn Rate, Suite Potential) that consumer brokerages obscure. This unique data is the reason a high-intent user leaves Realtor.ca for us — and once they are here and signed in, they are a lead.

*How we actually take those users from Realtor.ca and HouseSigma — the beachhead, channels, and build order — is specified in §13. Read it before building anything whose job is acquisition (SEO pages, overlays, shareable reports, signup flows).*

---

## 2. User Personas & Feature Mapping
UI elements, state stores, and derived metric engines must be built specifically for these distinct personas. Do not build generic "one-size-fits-all" features.

| Persona | Primary Goal | Key Features & Metrics Required |
| :--- | :--- | :--- |
1. **Cashflow Investor** | Maximize monthly yield and ROI. | Extrapolated Cap Rate, Cashflow Calculator, Gross Yield, Tenant Overlap Detection. |
2. **Flipper & Deal Hunter** | Buy under market value, force appreciation. | Temporal Distress Engine (True DOM), Price Compression, Assignment Detection, Carrying Cost Calculator. |
3. **Smart Homebuyer** | Avoid bidding wars, find hidden value (basements). | Suite Potential (Duplex conversion flags), Carrying Costs, Standard Status alerts. |
4. **Builders & Developers** | Land assembly and missing-middle housing. | PostGIS Zoning Overlays, Price-per-Buildable-Square-Foot, Lot Dimension extraction. |

---

## 3. App Structure & Core Pages
The application architecture is strictly partitioned into three critical phases.

### A. Onboarding (Lead Capture, framed as "Terminal Access")
- **Objective:** This is the **lead-capture funnel** — its entire job is to turn an anonymous visitor into a contactable, qualified lead. It doubles as VOW compliance (an account is required to view sold data), so the account wall is a feature, not a tax: every signup is a lead.
- **Design principle — friction only where it *qualifies*, never where it *deters*.** Signup itself must be low-friction (magic link, one screen) so we lose as few high-intent users as possible. The "exclusivity" framing is *marketing tone*, not literal gatekeeping — never add steps whose only effect is to turn qualified transactors away.
- **Qualify while you capture:** Use the onboarding flow to collect lead-scoring signals — buy vs. sell vs. invest intent, timeline to transact, target market, financing status ("What is your primary investment strategy?"). This intent data is what makes a lead sellable now and routable to our brokerage later. Prefer this over a bare 1-click Google login, which captures a user but no intent.

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
2. **The Vault (Supabase/Postgres):** The immutable historical record. Stores raw JSONB. Used for heavy spatial queries (PostGIS zoning) and historical stitching (Temporal Distress Engine).
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
* `npm run dev` / `build` / `lint` - Next.js standard commands.
* `npx tsx scripts/worker/ingester.ts sync` - Daily delta sync (must use `import 'dotenv/config'`).
* `npx tsx scripts/worker/sync.ts` - Manual sync orchestrator.
* **Database Clients:** `src/lib/supabase/client.ts` contains `getServerClient()` (RLS enforced) and `getServiceRoleClient()` (RLS bypassed, strictly for ETL workers).
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
Every feature must be measurably better than housesigma or realtor.ca on at least one dimension; more data visible, cleaner to scan, or exposing insight they don't have. If a component is just equivalent, it is not worth shipping. This differentiation is the **USP** — the reason a high-intent user switches to us. It is a means to the business end, not the end itself.

**Second, complementary bar — lead conversion.** Because the business is lead generation → brokerage (§1), a feature that is analytically brilliant but captures or converts no leads is only half-built. For every significant feature, be able to answer: *does this attract a high-intent transactor, deepen their engagement, or move them toward becoming a captured/contactable lead?* Depth that keeps users on-platform and signed in is depth that produces leads. Never trade away lead capture for the sake of "exclusivity" or minimalism.

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
- **Daily sync** runs via `.github/workflows/daily-sync.yml` at 03:00 UTC (`npx tsx scripts/worker/ingester.ts sync`).
- **GitHub secrets required (CRITICAL):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROPTX_IDX_TOKEN` — TRREB IDX feed bearer token. Used **only** for Active listings (Query A in `ingester.ts`).
  - `PROPTX_VOW_TOKEN` — TRREB VOW feed bearer token. Used **only** for Sold/Closed listings (Query B → `raw_vow_sold`).
  - `TYPESENSE_ADMIN_API_KEY` — Typesense admin key. Required by the sync step because `ingester.ts` imports `sync.ts`, which constructs a Typesense admin client at module load and hard-throws without it (`sync.ts:38`). Missing → the job crashes on **import** (exit 1) before `runDeltaSync` runs. Added 2026-05-24 after it broke the nightly sync 05-22→05-24.
  - `RESEND_API_KEY` — Resend API key for the **Send Watchlist Alerts** step (`scripts/worker/alerts.ts`). OPTIONAL: the step is `continue-on-error` and no-ops cleanly when unset, so a missing key never breaks the core sync. Optional companions: `ALERTS_FROM_EMAIL` (must be a Resend-verified sender; defaults to `support@pureproperty.ca`) and `NEXT_PUBLIC_SITE_URL` (link base in emails; defaults to `https://pureproperty.ca`).
- **Watchlist accounts & alerts (added 2026-05-24).** Auth is now wired via **Supabase Auth (magic link)** + `@supabase/ssr` — the dormant next-auth/Prisma stack was deleted. Accounts are OPTIONAL (anonymous-first stays); signing in syncs the watchlist across devices and enables email alerts. Tables `profiles` + `watchlist` live in migration `015_auth_profiles_watchlist.sql` (RLS owner-only via `auth.uid()`); apply with `npx tsx scripts/admin/applyMigration015.ts` (or the Supabase SQL editor). The nightly **Send Watchlist Alerts** step emails per-user price-drop digests off the freshly-synced Typesense index — deterministic comparison only (no LLM, §4), daily cadence.
- **IDX and VOW are TWO DISTINCT TRREB tokens — they are not interchangeable.** The ingester reads them strictly at `scripts/worker/ingester.ts:242-243` with **no fallback chain**. The legacy `RESO_BEARER_TOKEN` is unused and must not be reintroduced (its presence in the workflow caused a 6-day silent sync outage on 2026-05-14 when the dual-token refactor shipped without updating the workflow). When adding env vars to the workflow, IDX and VOW must always be passed explicitly.
- **Silent-failure caveat:** the catch block at `ingester.ts:777-785` advances `sync_state.last_sync_timestamp` even when `records_synced=0` and `status='failed'`. A missing token therefore does not just stop the sync — it permanently rolls the cursor forward, making the gap unrecoverable without a manual SQL reset of `sync_state.last_sync_timestamp`.
- `raw_vow_sold` holds ~217k historical records in prod. Never run migrations that alter its schema; it is read-only for AVM, append-only for daily sync.
- **DB connection strings for admin/migration scripts (READ THIS BEFORE RUNNING `scripts/admin/*.ts`).** These scripts (e.g. `applyMigrationNNN.ts`, `backfill020.ts`) open a raw `pg` client via `DATABASE_URL || DIRECT_DB_URL`. The two are NOT interchangeable:
  - `DIRECT_DB_URL` = the **direct** host `db.<ref>.supabase.co:5432`. It is **IPv6-only** and does **not** resolve from local dev / CI here — it fails with `getaddrinfo ENOENT`. Having it defined is NOT enough; it cannot be used to run scripts from this environment. (It does contain the password + project ref, but the pooler host/region is NOT derivable from it.)
  - To actually run these scripts, set **`DATABASE_URL` to the Supabase Session pooler string** (Dashboard → Settings → Database → Connection string → **Session pooler**, port **5432** — *not* the Transaction pooler on 6543; our scripts use a session-level `SET statement_timeout` and run DDL, which transaction mode drops). The pooler is IPv4-reachable. Put it in `.env.local` (never commit it).
  - **SQL editor caveat:** instant DDL (ADD COLUMN, CREATE FUNCTION) is fine to paste into the Supabase SQL editor, but heavy ops — full-table `UPDATE`s and partial indexes whose predicate detoasts `full_payload` JSONB across ~112k rows — exceed the editor's gateway timeout ("upstream timeout"). Those belong in a pooler-connected script that runs `SET statement_timeout TO '0'` and batches by id cursor (pattern: migration `020_region_aggregates.sql` = slim DDL; `scripts/admin/backfill020.ts` = batched backfill + index builds).

---

## 13. Customer Acquisition & Go-To-Market (how we take users from Realtor.ca & HouseSigma)
This section operationalizes §1: it is the plan for *attracting and converting* high-intent transactors into captured leads. Every acquisition-facing feature (SEO pages, the overlay, shareable reports, signup flows) must serve the beachhead, message, and capture rules below.

### The beachhead: the "house hacker" (dominate this ONE wedge before expanding)
The single segment we own first is the **intersection of the Cashflow Investor and Smart Homebuyer personas** — an owner-occupier buying a property that *partially pays for itself* (legal or potential basement suite, duplex conversion).
- **One message:** *"Buy a home that pays for itself."*
- **One feature set:** Suite Potential + Carrying Cost + Cap Rate (already mapped to those personas in §2).
- **Why it wins:** neither Realtor.ca nor HouseSigma tells a buyer *"this house has a rentable suite that covers ~40% of your mortgage."* In the current GTA affordability crunch this wedge has both the **volume** of homebuyers and the **analytical depth** of investors.
- **Discipline (Crossing the Chasm):** do NOT dilute into a fourth-best-for-everyone portal. One wedge, one message, total dominance — *then* expand outward to pure cashflow investors and flippers. Expansion is earned, not simultaneous.

### Monetization posture: the "King" path (brokerage targeted within ~12 months)
Because the brokerage is near-term, we optimize for **owning the customer relationship now**.
- Every lead is captured, qualified, and nurtured **under our brand, in our product**.
- **Lead-sales to partner agents are OVERFLOW-ONLY** — we sell what we cannot yet serve, never the core pipe. Do not architect the funnel around feeding other brokerages (Founder's Dilemmas "Rich vs. King": we are deliberately choosing King; easy lead-sale cash must not quietly re-point the funnel at competitors we intend to displace).
- Factor RECO brokerage licensing / agent recruiting into planning **now**, not at the end.

### Why head-on fails, and where we intercept
Realtor.ca owns *"what's for sale"* (discovery + SEO). HouseSigma owns *"what did it sell for"* (the analysis moment). We out-broad neither and out-brand neither — we **skim high-intent transactors off the top of their funnels** with the 10x-metric wedge, intercepting at the point of intent:

| # | Channel | What we build | How it captures the lead |
| :-- | :-- | :-- | :-- |
| 1 | **Programmatic SEO** (highest ROI, compounding) | Auto-generated pages for queries the incumbents ignore: *"homes with income suites in [area]", "best cash-flow neighbourhoods [city]", "[address] true days on market"* — one page per neighbourhood × metric, fed from our data. | Organic Google traffic → soft wall → account required to see full shadow data (VOW-compliant, §4). |
| 2 | **Parasitic overlay** (most direct steal) | Browser extension injecting our shadow metrics (Suite Potential, True DOM, Cap Rate) directly onto Realtor.ca & HouseSigma listing pages. | Meets their users on their own site at the moment of analysis; CTA pulls them into our account. |
| 3 | **Community land-grab** | Presence + weekly data drops in r/TorontoRealEstate, r/canadahousing, BiggerPockets Canada, REIN, local first-time-buyer / REI groups. | Become the default tool; deep-link back to gated reports. |
| 4 | **Data-as-marketing loop** | Shareable, PR-worthy reports: *"10 Toronto homes that pay for themselves this week", "neighbourhoods cutting prices fastest".* | Backlinks (feed channel 1's SEO) + press (brand); each share is a top-of-funnel magnet. |

**Paid ads are a poor early fit** — we'd bid real-estate keywords against portals with far deeper pockets, and spend stops the moment we stop paying. Channels 1, 2, and 4 compound; prioritize them.

### Build order (phased)
- **P1 — Prove the wedge converts:** programmatic SEO pages for the house-hacker query set + seed one community channel. Instrument signup → intent capture end-to-end.
- **P2 — Tap incumbent traffic directly:** ship the overlay extension.
- **P3 — Monetize overflow:** turn on lead-sales for high-intent users we cannot yet serve.
- **P4 — Convert to brokerage:** stand up the brokerage on the captured, branded funnel; route the best leads to our own agents.

**Non-negotiable:** every channel must terminate in a **captured, intent-qualified lead under our brand** (§1, §3A). A channel that drives traffic but not captured, contactable leads is not done.
