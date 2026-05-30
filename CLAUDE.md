This file governs all AI coding agent behavior Claude operating within the PureProperty.ca repository.

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
1. **Cashflow Investor** | Maximize monthly yield and ROI. | Extrapolated Cap Rate, Cashflow Calculator, Gross Yield, Tenant Overlap Detection. |
2. **Flipper & Deal Hunter** | Buy under market value, force appreciation. | Temporal Distress Engine (True DOM), Price Compression, Assignment Detection, Carrying Cost Calculator. |
3. **Smart Homebuyer** | Avoid bidding wars, find hidden value (basements). | Suite Potential (Duplex conversion flags), Carrying Costs, Standard Status alerts. |
4. **Builders & Developers** | Land assembly and missing-middle housing. | PostGIS Zoning Overlays, Price-per-Buildable-Square-Foot, Lot Dimension extraction. |

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
Every feature must be measurably better than housesigma or realtor.ca on at least one dimension; more data visible, cleaner to scan, or exposing insight they don't have. If a component is just equivalent, it is not worth shipping.

## 11.
This project integrates two TRREB data feeds. Before writing any code that reads, displays, or transforms listing data, consult the relevant docs below.

### API Payloads & Response Structure
- @.claude/docs/api/trreb-idx-payload.md — IDX feed field schema and payload spec
- @.claude/docs/api/trreb-vow-payload.md — VOW feed field schema and payload spec
- @.claude/docs/api/idx-response-example.json — Real example IDX API response
- @.claude/docs/api/vow-response-example.json — Real example VOW API response

### Legal Agreements & Rules
- @.claude/docs/legal/idx-agreement.pdf — IDX display rules, dos and don'ts
- @.claude/docs/legal/vow-agreement.pdf — VOW display rules, dos and don'ts

**Always check the agreement files before implementing any listing display feature to ensure compliance with TRREB data licensing rules.**

## 12. Operational notes
- **Daily sync** runs via `.github/workflows/daily-sync.yml` at 03:00 UTC (`npx tsx scripts/worker/ingester.ts sync`).
- **GitHub secrets required (CRITICAL):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROPTX_IDX_TOKEN` — TRREB IDX feed bearer token. Used **only** for Active listings (Query A in `ingester.ts`).
  - `PROPTX_VOW_TOKEN` — TRREB VOW feed bearer token. Used **only** for Sold/Closed listings (Query B → `raw_vow_sold`).
  - `TYPESENSE_ADMIN_API_KEY` — Typesense admin key. Required by the sync step because `ingester.ts` imports `sync.ts`, which constructs a Typesense admin client at module load and hard-throws without it (`sync.ts:38`). Missing → the job crashes on **import** (exit 1) before `runDeltaSync` runs. Added 2026-05-24 after it broke the nightly sync 05-22→05-24.
  - `RESEND_API_KEY` — Resend API key for the **Send Watchlist Alerts** step (`scripts/worker/alerts.ts`). OPTIONAL: the step is `continue-on-error` and no-ops cleanly when unset, so a missing key never breaks the core sync. Optional companions: `ALERTS_FROM_EMAIL` (must be a Resend-verified sender; defaults to `alerts@pureproperty.ca`) and `NEXT_PUBLIC_SITE_URL` (link base in emails; defaults to `https://pureproperty.ca`).
- **Watchlist accounts & alerts (added 2026-05-24).** Auth is now wired via **Supabase Auth (magic link)** + `@supabase/ssr` — the dormant next-auth/Prisma stack was deleted. Accounts are OPTIONAL (anonymous-first stays); signing in syncs the watchlist across devices and enables email alerts. Tables `profiles` + `watchlist` live in migration `015_auth_profiles_watchlist.sql` (RLS owner-only via `auth.uid()`); apply with `npx tsx scripts/admin/applyMigration015.ts` (or the Supabase SQL editor). The nightly **Send Watchlist Alerts** step emails per-user price-drop digests off the freshly-synced Typesense index — deterministic comparison only (no LLM, §4), daily cadence.
- **IDX and VOW are TWO DISTINCT TRREB tokens — they are not interchangeable.** The ingester reads them strictly at `scripts/worker/ingester.ts:242-243` with **no fallback chain**. The legacy `RESO_BEARER_TOKEN` is unused and must not be reintroduced (its presence in the workflow caused a 6-day silent sync outage on 2026-05-14 when the dual-token refactor shipped without updating the workflow). When adding env vars to the workflow, IDX and VOW must always be passed explicitly.
- **Silent-failure caveat:** the catch block at `ingester.ts:777-785` advances `sync_state.last_sync_timestamp` even when `records_synced=0` and `status='failed'`. A missing token therefore does not just stop the sync — it permanently rolls the cursor forward, making the gap unrecoverable without a manual SQL reset of `sync_state.last_sync_timestamp`.
- `raw_vow_sold` holds ~217k historical records in prod. Never run migrations that alter its schema; it is read-only for AVM, append-only for daily sync.
- **DB connection strings for admin/migration scripts (READ THIS BEFORE RUNNING `scripts/admin/*.ts`).** These scripts (e.g. `applyMigrationNNN.ts`, `backfill020.ts`) open a raw `pg` client via `DATABASE_URL || DIRECT_DB_URL`. The two are NOT interchangeable:
  - `DIRECT_DB_URL` = the **direct** host `db.<ref>.supabase.co:5432`. It is **IPv6-only** and does **not** resolve from local dev / CI here — it fails with `getaddrinfo ENOENT`. Having it defined is NOT enough; it cannot be used to run scripts from this environment. (It does contain the password + project ref, but the pooler host/region is NOT derivable from it.)
  - To actually run these scripts, set **`DATABASE_URL` to the Supabase Session pooler string** (Dashboard → Settings → Database → Connection string → **Session pooler**, port **5432** — *not* the Transaction pooler on 6543; our scripts use a session-level `SET statement_timeout` and run DDL, which transaction mode drops). The pooler is IPv4-reachable. Put it in `.env.local` (never commit it).
  - **SQL editor caveat:** instant DDL (ADD COLUMN, CREATE FUNCTION) is fine to paste into the Supabase SQL editor, but heavy ops — full-table `UPDATE`s and partial indexes whose predicate detoasts `full_payload` JSONB across ~112k rows — exceed the editor's gateway timeout ("upstream timeout"). Those belong in a pooler-connected script that runs `SET statement_timeout TO '0'` and batches by id cursor (pattern: migration `020_region_aggregates.sql` = slim DDL; `scripts/admin/backfill020.ts` = batched backfill + index builds).
