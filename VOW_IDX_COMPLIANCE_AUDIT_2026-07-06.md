# TRREB / PROPTX VOW + IDX Compliance Audit — PureProperty.ca

**Date:** 2026-07-06
**Scope:** Full clean audit of the live website + codebase against the two executed PROPTX agreements
(`.claude/docs/legal/idx-agreement.pdf`, `.claude/docs/legal/vow-agreement.pdf`, both dated 2024-11-26).
**Method:** Rule-by-rule audit across 24 derived obligations by six parallel reviewers (VOW gating, attribution/
notices, data integrity/limits, API/scraping/redistribution, live-anon recon, competitor practice), plus direct
code verification of the load-bearing findings. Every infraction is paired with how **HouseSigma** and **Zolo**
handle the same obligation.

> **Contract basis.** Registered subscriber: TANMAY RAO (EXP REALTY, membership #9608879), Broker of Record
> Katherine Milian. Both agreements register a **single VOW/Subscriber URL: `http://pureproperty.ca`** (apex).
> IDX = active listings, displayable publicly. VOW = sold/off-market data, only on a "secure password-protected"
> site for Consumers with an established broker-consumer relationship. Breach cure window is tight: **10 days,
> or 48 hours if you don't respond in writing** (IDX §12.3(a)(i); VOW §12.3(a)(i)). API revocation is the stated
> remedy and it is at PROPTX's sole discretion.

---

## 1. Verdict summary

| # | Obligation | Verdict | Severity |
|---|-----------|---------|----------|
| R1 | Feed-only listings (no synthetic/demo on prod) | 🟡 Partial | Medium |
| R2 | 100-listing cap per inquiry | 🟡 Partial | Low |
| R3 | Brokerage attribution everywhere (incl. thumbnails, same size) | 🟡 Partial | Medium |
| R4 | Source display ("PROPTX MLS®") | ✅ Compliant | — |
| R5 | Operator contact separated from listing brokerage | ✅ Compliant* | — |
| R6 | No content modification (analytics VOW-only) | 🟡 Partial | Medium |
| R7 | URL registration (apex vs www vs previews) | ❌ **Violation** | **High** |
| R8 | 24-hour refresh | 🟡 Partial | Medium |
| R9 | "Deemed reliable" notice on all feed displays | 🟡 Partial | **High** |
| R10 | No "full MLS access" / over-completeness claims | 🟡 Partial | Low–Med |
| R11 | Bona-fide interest notice (prominent) | 🟡 Partial | Medium |
| R12 | VOW data gated to registered consumers | 🟡 Partial | **High** (+ 1 Critical unverified) |
| R13 | Display only on the registered site | 🟡 Partial | Medium |
| R14 | No AI/LLM contact with feed data | ✅ Compliant | — |
| R15 | Anti-scraping precautions **and monitoring** | 🟡 Partial | **High** |
| R16 | No export/download of feed data | ✅ Compliant | — |
| R17 | No resale / third-party access grant | ✅ Compliant | — |
| R18 | No syndication / redistribution | 🟡 Partial | Medium |
| R19 | Preserve trademarks / copyright / watermarks | ✅ Compliant | — |
| R20 | Consumer-activity audit trail (VOW §5.4) | 🟡 Partial | Medium |
| R21 | Privacy policy / PIPEDA | ✅ Compliant | — |
| R22 | No PROPTX affiliation claims | ✅ Compliant | — |
| R23 | VOW Terms-of-Use acceptance recorded | ✅ Compliant* | — |
| R24 | Status integrity (active vs VOW) | 🟡 Partial | Medium |

\* Compliant with a caveat flagged below.

**Headline:** No leak of sold *prices/numbers* to anonymous users was found on any surface examined — the
server-side VOW number-gating is genuinely well-built and, on the `/address` sold pages, is *stricter* than
Zolo's blur model. The real exposure is concentrated in a handful of issues: an **unregistered production host +
open preview deployments (R7)**, the **flagship terminal missing its two mandatory notices (R9/R11)**, a
**weaker login-only gate on the active listing page (R12)**, and **unauthenticated bulk-extractable listing
surfaces with zero monitoring (R15)**. Two more concrete items surfaced late: a **fabricated MLS®-badged listing
on the public landing page (R1)** and an **anon alert email that leaks the specific "terminated/expired/
suspended" reason the dashboard deliberately suppresses (R12/R13/R24)** — the one place a VOW-derived *status
detail* actually reaches non-consumers. Two items **cannot be closed from the code alone** and need a production
check (see §5).

---

## 2. Critical / High findings

### R7 — Production host is not the registered URL, and previews serve the live feed ❌ HIGH

**Rule:** IDX/VOW §6.3(g) — each Subscriber/VOW website URL must be pre-approved and registered. Both agreements
register exactly one URL: the apex `http://pureproperty.ca`.

**Found:**
- Production canonical host is **`www.pureproperty.ca`**, not the registered apex — `src/app/robots.ts:3`,
  `src/app/sitemap.ts:9`, `src/app/addresses/sitemap.ts:16`, `scripts/worker/alerts.ts:45`
  (`NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca"`); robots.txt emits `Host: https://www.pureproperty.ca`.
- **No host allowlist anywhere:** `src/middleware.ts:9-49` only does listing-URL rewrites + `updateSession`;
  `next.config.mjs` has no `redirects()` and no host gate; no `vercel.json`. Therefore **every Vercel preview
  deployment (`*.vercel.app`) and any alias serves the full live IDX/VOW app** on an unregistered host.
- 2 of the 3 allowed URL slots are unused, so registering the real hosts is free.

**Risk:** Serving board data on unregistered hosts is a direct §6.3(g) breach; preview URLs are also
crawlable/shareable feed mirrors. This is the cleanest, most objective violation in the audit.

**HouseSigma:** operates on its single registered brokerage domain; sold/estimate/API paths are further walled
in `robots.txt` (`Disallow: /listings/similar/sold/*`, `/home/estimate`, `/search`, `/user/`, `/bkv2/api/`).
**Zolo:** canonical `www.zolo.ca`; every non-browser request (incl. previews-style automated hits) returns
HTTP 403 via edge bot protection, so there is no unauthenticated mirror to reach.

**Fix:** (a) Register `https://www.pureproperty.ca` (and apex) via the PROPTX URL Change/Update form; (b) add a
middleware host allowlist that 404s/redirects any host other than the registered ones; (c) set Vercel preview
deployments to password-protected + `noindex`, or exclude the feed from previews.

---

### R9 — The flagship terminal has no "deemed reliable" notice in its default view 🟡 HIGH

**Rule:** IDX/VOW §6.3(i) — a notice that the information is *deemed reliable but not guaranteed accurate by
PROPTX* must appear on **all** feed-data displays.

**Found:** The canonical notice exists and is correct — `src/components/legal/ListingComplianceNotice.tsx:24`
("Listing information is deemed reliable but is not guaranteed accurate by PROPTX.") — and is included on listing
detail, every SEO/hub page, dashboard, analytics, emails, and share pages. **But the terminal `/properties`**
(the primary anonymous IDX browsing surface: map + ledger + popups) shows it **only conditionally**: it renders
at `src/components/CommandCenter/LedgerPanel.tsx:264-268` *only when* a Sold/Leased/De-listed VOW layer is
toggled on. In the default active For-Sale/For-Rent view the ledger footer shows only "PROPTX MLS®"; the map
popups (`ListingMapPopup.tsx`) and Quick Look panel carry no notice at all.

**Risk:** The single most-used surface for the live IDX feed lacks the mandatory reliability disclaimer.

**HouseSigma:** carries "The information here is deemed reliable but not guaranteed by PROPTX" and the ITSO
equivalent in its terms and on listing surfaces. **Zolo:** board-standard MLS disclaimer present site-wide
(exact per-page string unverified behind their 403 wall, but the CREA/TRREB attributions are in their ToU).

**Fix:** Render `ListingComplianceNotice` unconditionally in the terminal chrome (persistent footer on
`LedgerPanel` + a line in the map/Quick Look), independent of active layers.

---

### R11 — Same gap: no bona-fide interest notice on the terminal default view 🟡 MEDIUM

**Rule:** IDX/VOW §6.3(k) — prominently post that the site may only be used by consumers with a bona-fide
interest in a purchase/sale/lease.

**Found:** Exact suggested wording is present (`ListingComplianceNotice.tsx:25-29`) on every hub/detail/auth
page and the login/apply flows — **but absent from the terminal default view** for the same reason as R9 (only
inside the conditional `LedgerPanel.tsx:266` VOW-layer block). An anonymous consumer browsing active listings +
map never sees the restriction.

**HouseSigma:** enforces bona-fide at the gate itself — a mandatory questionnaire; users who decline are
"restricted from viewing VOW data." **Zolo:** ToU requires "a bona fide interest in the purchase, sale, or
lease of real estate… intended only for personal, non-commercial use," accepted at registration.

**Fix:** Same as R9 — make the notice persistent on the terminal.

---

### R12 — Active listing page uses a weaker login-only VOW gate 🟡 HIGH (plus one CRITICAL item unverified)

**Rule:** VOW definitions + §6.2(f): VOW data (sold price/date, and analytics derived from it) is for a
registered **Consumer with an established broker-consumer relationship** — not merely an authenticated visitor.

**Found — the app/API layer is genuinely strong:**
- All VOW API routes gate server-side and return locked/empty teaser shapes to anon (e.g.
  `src/app/api/market/activity/sold/route.ts:166-176`, `properties/[id]/similar/route.ts:272-300`,
  `estimates/sale-price/route.ts:47-48`, `avm/hidden-equity/route.ts:38-51`,
  `watchlist/dispositions/route.ts:322-330`). All sold reads use the **admin** key server-side; the `properties`
  Typesense collection has **no** close/sold-price fields (`src/lib/typesense/typesenseSchema.ts:204-335`) — sold
  data is isolated in a separate `sold_listings` collection.
- The public `/address/[prov]/[city]/[slug]` page is a **model**: it fetches VOW data only inside the
  `isConsumer` branch, emits address-only JSON-LD, and shows anon just a sign-in CTA — a *structural* gate with
  no blurred data in the page source (`src/app/(app)/address/[prov]/[city]/[slug]/page.tsx:128,178-197`).
- The consumer gate is the full check: `getConsumer()` = signed-in **and** `hasAcceptedTerms()`
  (`src/lib/auth/requireConsumer.ts:35-38`).

**The defect:** the **active listing detail page** does *not* use that gate. At
`src/app/(app)/properties/[id]/page.tsx:417`:
```
const isAuthed = isDemoListingKey(id) || !!(await getCurrentUser());
```
`isAuthed` (mere login) then drives `gateVowDerived(detail, isAuthed)` at `:424`. So a user who is **authenticated
but has not accepted the VOW Terms** (e.g. arrived via a Supabase magic link without completing the `/welcome`
ToU step) receives full VOW-derived data — AVM estimate, Value-Add, Deal Score, Expected Sale, stitched True DOM,
and ClosePrice/CloseDate for a sold subject — on the primary analytics surface. Every other surface would treat
that same user as a non-consumer. Fix: use `getConsumer()`'s `isConsumer` instead of `getCurrentUser()`.

**Second leak — anon alert emails disclose the specific de-list reason the app otherwise suppresses:** the
off-market branch of the alert email renders `Listing ${s.detail.toLowerCase()} — a relist often signals a
motivated seller` (`src/lib/alerts/listingAlertEmail.ts:57-58`), where `s.detail` traces back to the raw
`MlsStatus` (`scripts/worker/alerts.ts:255` ← `transitions.ts:69`) and can be **"terminated" / "expired" /
"suspended."** These emails go to the **anonymous, email-only `listing_alerts` audience** (no account, no ToU, no
broker-consumer relationship). The dashboard deliberately collapses that exact reason to a generic "gone" for
non-consumers (`api/watchlist/dispositions/route.ts:263-268`), so the email path is *leakier than the UI it
mirrors* — it hands a VOW-derived terminal status detail to non-consumers. (The same emails also disclose
price-drop magnitude + direction, but that's sourced from the active IDX index, so it's permissible.) This is the
single most concrete VOW-status disclosure to non-consumers in the audit. **Fix:** in the alert email, gate the
specific delisted reason the same way the dashboard does — show a neutral "no longer listed" to the anon
audience.

**Minor:** the listing page also shows anon a VOW-sourced "Sold after {dom} days on market"
(`properties/[id]/page.tsx:465,683-687`) and the sold subject's original list price (`:621`).

**Related fail-open (verify in prod):** `hasAcceptedTerms()` returns `true` on any query error or if migration
029 is unapplied (`src/lib/auth/terms.ts:32-49`, "failing open"). Enforcement defaults on
(`VOW_ENFORCE_TERMS !== "false"`), but if migration 029 isn't applied in prod, or the flag is set to `false`,
the consumer gate silently degrades to login-only everywhere.

**CRITICAL — browser Typesense key scope (unverified, see §5):** the browser search key is public
(`NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY`, `src/lib/typesense/client.ts:22`, sent as a URL param). The
rotation script created a replacement scoped to `documents:search` on `['properties']` only, to replace a
**previously leaked** key (`BzXk…`) — but it wrote to Railway (now abandoned; prod is Vercel) and the old key's
revocation is a separate manual step with no evidence it ran (`scripts/admin/_rotateSearchKey.ts`). **If the
live key can read `sold_listings`, or the leaked key was never revoked, anonymous clients can read sold prices
directly = critical VOW leak.** The `per_page ≤ 100` and `exclude_fields` limits are client-side only and do not
bind the key.

**HouseSigma:** all sold data, price-history charts, **and** the AVM are gated behind a free account with a
bona-fide questionnaire, plus idle re-authentication; sold/estimate endpoints are blocked in robots.txt.
**Zolo:** sold *index* pages are public but the sold *price* requires an email-verified registered account
("Real estate boards require a verified email prior to accessing full listing data including sold prices").

**Fix:** (1) switch `/properties/[id]` to the `getConsumer` gate; (2) verify migration 029 is applied and
`VOW_ENFORCE_TERMS` is unset in prod; (3) **run the live key-scope check** (§5) and revoke the `BzXk…` key.

---

### R15 — Anti-scraping precautions don't cover the real surfaces, and there is no monitoring 🟡 HIGH

**Rule:** IDX/VOW §6.2(d) — maintain reasonable precautions to **prevent** scraping/data-mining **and monitor**
the site for it.

**Found:**
- Precautions that exist: `robots.txt` disallows `/api/`, `/dashboard`, auth routes, `/share/`
  (`src/app/robots.ts:5-24`) and blocks the major AI crawlers; the ToU bans scraping (`terms/page.tsx:46`);
  Cloudflare actively 403s automated fetchers (confirmed in live recon).
- Gaps: the rate limiter is **in-process only** and explicitly "NOT shared across instances" — ineffective on
  Vercel's multi-instance serverless — and keys off a spoofable `X-Forwarded-For` (`src/lib/rateLimit.ts:8-14,
  37-49`). It's applied only to share/alerts/viewing-requests/apply/geocode. It is **absent** on
  `src/app/api/properties/listings/route.ts`, which is **unauthenticated with an unbounded `page` param**
  (`:28`, limit clamped to 100/page) → cumulative pagination extracts the entire active index. The public
  Typesense key allows the same bulk extraction cross-origin.
- **No monitoring at all:** grep for abuse/scrape/bot-detection/anomaly across the repo returns only ToU copy
  and limiter comments. The affirmative monitoring obligation is unmet.
- The dedicated **`/addresses/sitemap.xml`** publicly enumerates the full address→MLS# corpus — a convenient
  scraping roadmap for any client that ignores robots.

**HouseSigma:** robots.txt specifically walls the sold/estimate/search/user API endpoints; ToU bans
"scraping, data mining… collect, store, re-organize, summarize or manipulate any Listing Information."
**Zolo:** hard edge bot-wall (403 to all non-browser clients) is the strongest deterrent of the three; ToU
bans scraping and any redistribution of VOW data.

**Fix:** put `/api/properties/listings` behind auth or a hard server-side page cap; add a distributed
rate-limiter (e.g. Upstash) keyed on a trustworthy IP; lock the Typesense Cloud CORS allowlist to the registered
hosts; add basic request-rate/anomaly monitoring + alerting to satisfy the monitoring clause.

---

## 3. Medium / Low findings

### R1 — A fabricated MLS®-badged listing renders on the public landing page 🟡 MEDIUM
Rule: §6.3(a) — no listings other than those transmitted through the datafeed may be displayed. The demo-fixture
vector is safe (see §4), but the **landing hero** (`src/components/hero/ListingCompare.tsx`, rendered to every
anonymous visitor via `src/app/page.tsx:53`) shows a hardcoded, non-feed listing dressed as real MLS inventory:
"14 Maple Ave, Toronto, ON", "$899,000", `Detached · MLS® C12639568`, "Listed by ABC Realty Inc., Brokerage",
NEW / ● Active / "Just listed · 5 days on market" badges, plus a fabricated Deal Score, sold price-history, cap
rate, rents, and school scores (`:8,53,65-66,72,110-112`, comment: "Purely illustrative — hardcoded sample
data"). It's the only such surface (a repo grep found no other rendered fabricated listing). Attaching a
realistic-looking MLS number **and** the MLS® mark to invented data displays a non-feed "listing" and also
implicates R19 (MLS® mark on fake data). **Fix:** add a visible "Illustration — not a live listing" disclaimer
and swap the MLS id for an obvious non-real token (e.g. `MLS® SAMPLE`) and a non-real brokerage/address.

### R3 — Brokerage attribution: present on the main surfaces, silently dropped on a few 🟡 MEDIUM
Rule: §6.3(c) — listing brokerage shown for **all** listings incl. thumbnails, same font/size, not visually
separated. Attribution renders with a fallback on the core surfaces — terminal cards + map popups
(`ListingCardBody.tsx:124-131,187-194`, `{doc.ListOfficeName || "Brokerage unavailable"}`), all hub/share cards
(`PropertyCard.tsx:329-333`, "Listed by … || Unknown"), comp cards, and the Compare view (an `alwaysShow` row).
**Gaps:** six surfaces render brokerage only `if (brokerage)` with **no fallback**, so a listing missing
`ListOfficeName` shows none at all — `RecentlyViewed.tsx:66-68`, `WatchlistSection.tsx:181-183`,
`actionfeed/ActionFeedItem.tsx:47-51`, `MapComparePanel.tsx:110`, and both email templates
(`src/lib/alerts/digest.ts:71-72`, `listingAlertEmail.ts:89-90`). On `ListingCardBody`/`MapComparePanel`/
`ActionFeedItem` the brokerage also sits in the smallest 10px tier, below the 12px bed/bath details — arguably
"visually de-emphasized." *Competitors:* both HouseSigma and Zolo are licensed brokerages that display listing
brokerage credit; exact card-level prominence was unverifiable behind their JS/403 walls. **Fix:** add the
"Brokerage unavailable" fallback to the six surfaces; bump attribution to match the sibling detail tier.

### R6 — No content modification; two VOW-context caveats 🟡 MEDIUM
Feed values are stored verbatim (`scripts/worker/transformer.ts:928` `full_payload: raw`; extraction only
selects with fallbacks, never rewrites City/PropertySubType/Basement). The old **commercial "$1"/0-bed artifact
is fixed in code** — `properties/[id]/page.tsx:446` gates all residential/AVM machinery off for `isCommercial`,
swaps beds/baths for Sqft/Type/Zoning, and emits `"Place"` JSON-LD without fabricated beds/baths. (The live "$1"
listing seen in recon is either a pre-fix cache or the raw feed's actual list price — not a code-side
modification; worth a spot-check.) **Caveats:** (1) the derivative-analytics exception is **VOW-only** (VOW
§6.2(f)); the IDX agreement §6.3(f) has *no* such exception, yet AVM/Deal-Score/Expected-Sale run substantially
on IDX active values — a strict reading could object even for logged-in users; (2) `UnderwritingSandbox` +
`RentalSnapshot` render client-side calculators for **anon** on active listings, seeded from public IDX
price/taxes (borderline). *Competitors:* HouseSigma brands its AVM "Estimated Value" and **gates it behind
login**; Zolo exposes a public address-based "Home Value" estimator but keeps it as a separate tool, not stamped
onto feed listings. **Fix:** keep all derived analytics behind the consumer gate (ties to R12); confirm anon
active-listing calculators are acceptable or gate them.

### R8 — 24-hour refresh holds only when the nightly sync succeeds 🟡 MEDIUM
Happy path is compliant: daily cron (`.github/workflows/daily-sync.yml:11-12`), same-sync deletion of sold +
terminal-status ids from the active index (`staleSearchDocs.ts:39-55`), detail pages `force-dynamic`, hubs ISR
1h. The old silent-cursor-advance bug is fixed (`ingester.ts:1267-1296`, exits 1 on failure). **Residuals:**
(1) no independent staleness fuse — during a multi-day sync outage (precedent 2026-06-16→24) displayed data
silently exceeds 24h with no user-facing "as-of" indicator; (2) the de-listed purge (Query C) is non-fatal and
runs last, so VOW-delist-only terminated/expired/suspended listings can persist as "Active" >24h if it fails
while A/B succeed; (3) a listing that vanishes with no sold/terminal record "shows For Sale forever" until
reconcile. *Competitors:* HouseSigma/Zolo both advertise frequent refresh (Zolo "every 15 minutes"). **Fix:**
add a staleness fuse that surfaces an "as-of" banner (or suppresses display) when `last_sync` age > 24h; make
Query C failure alert loudly.

### R10 — Marketing copy leans on "every/all" completeness claims 🟡 LOW–MED
No literal "full access to the MLS System" claim exists. But `src/app/page.tsx:43` ("See every listing like the
smart money does"), `src/app/layout.tsx:26,33,37` ("Browse every active Ontario MLS® listing", "Every listing,
decoded"), and `hero/ListingCompare.tsx:280` ("active & sold · all Ontario") are completeness claims that edge
toward implying comprehensive MLS access, which §6.3(j) guards against. **Fix:** soften "every/all" to "active
MLS® listings" (the `llms.txt` phrasing is already safe).

### R13 — Feed data leaves the registered site through three channels 🟡 MEDIUM
(1) Alert emails go to the **anonymous, email-only `listing_alerts` audience** (no account/ToU/relationship),
carrying address, city, brokerage, a price-drop **direction + magnitude**, and **the specific de-list reason**
("terminated/expired/suspended") — see R12; sold prices are correctly excluded (`scripts/worker/alerts.ts:148-307,
243-256`, `src/lib/alerts/listingAlertEmail.ts:38-58`). (2) Share pages set OG/Twitter images to the **raw MLS media URL**
(`src/app/share/[token]/page.tsx:110-133`), so posting a link republishes the MLS photo + address into
Facebook/X/Slack caches off-domain. (3) PostHog (US cloud) receives `$current_url` including descriptive listing
paths (address + MLS key) on every pageview, undercutting the "no addresses" discipline; if session replay is on
and VOW elements aren't `[data-ph-mask]`-tagged, sold prices could reach it (unverified). **Fix:** confirm the
price-drop teaser to anon leads is acceptable (it's IDX active data, not sold — likely OK, but it is off-domain
distribution); scrub addresses/keys from analytics URLs; verify replay masking.

### R18 — No purpose-built feed, but the active index is redistributable 🟡 MEDIUM
No RSS/oEmbed/bulk feed exists, but the unauthenticated `/api/properties/listings` JSON endpoint (unbounded
paging) and the public cross-origin Typesense key make the entire active index machine-harvestable — the same
root cause as R15. **Fix:** as R15.

### R20 — No producible consumer-activity audit trail 🟡 MEDIUM
Rule: VOW §5.4 — maintain an audit trail of Consumers' VOW activity, producible to PROPTX on demand. No
`audit_log`/`activity_log`/`search_log` table exists. The closest artifacts are anonymous per-listing view
**counts** (`api/property/[id]/view/route.ts:41-47`, keyed by a client-generated `viewerId`), watchlist state,
and third-party PostHog (US, retention-limited) — none is an authoritative, retained, per-consumer log of which
sold pages/searches a registered consumer performed. **Fix:** add a minimal server-side per-consumer VOW-access
log (user id, timestamp, resource) with sane retention.

### R2 — 100-listing cap: one interpretive edge on the terminal 🟡 LOW
Every search path is clamped to ≤100 (`src/lib/typesense/client.ts:363-364`), and display is sliced to 100. The
only edge: an **authenticated** consumer with For-Sale + Sold + Leased + De-listed layers all lit triggers four
parallel ≤100 queries (~400 docs to the browser) before the render slice to 100
(`src/app/properties/page.tsx:332-348`, `src/lib/sold/fetchSoldComps.ts:70-84`). Whether that's "one inquiry of
400" or "four inquiries of 100" is interpretive; anon is unaffected (comp routes return `[]`). **Fix (optional):**
if you want to be conservative, cap the merged multi-layer retrieval at 100.

---

## 4. Compliant (confirmed)

- **R1 (demo-fixture vector only)** — synthetic PPDEMO fixtures are impossible on prod: `isDemoFixturesEnabled`
  requires `DEMO_FIXTURES==="1" && !process.env.VERCEL` (`src/lib/demo/demoListing.ts:29`); only `PPDEMO`-prefixed
  keys resolve; prod always sets `VERCEL`. *(The landing-hero fabricated listing is the R1 gap — see §3.)*
- **R4 Source display** — "PROPTX MLS®" / "Powered by PROPTX MLS®" on terminal footer, page footers, emails, and
  share pages. Single-source feed, correctly credited.
- **R5 Operator separation** — the operator's lead-capture CTA (`CtaLadder` → `ScheduleViewingForm`, own
  `/api/viewing-requests` pipeline) is clearly separated from the "Listed by {ListOfficeName}" attribution.
  *Caveat:* I found **no on-site disclosure of the operating TRREB Member brokerage identity** — worth adding
  for §6.3(e)/TRESA hygiene.
- **R14 No AI/LLM contact** — zero AI/LLM dependencies (`package.json`), no AI API calls anywhere, no Supabase
  edge functions; the NL search parser is deterministic regex (`src/lib/search/nlParse.ts`). Every "AI/LLM"
  string in the repo is a compliance comment asserting determinism. Fully clean — this is the strongest area.
- **R16 No export** — no CSV/attachment/RSS/oEmbed; the only `.export()` is server-side sitemap generation using
  the admin key on **public fields only** (`src/lib/sold/soldByKey.ts:104`). *(One residual: `xlsx@0.18.5` is a
  dependency used by the demo fixture tooling — confirm no user-facing export ships feed data.)*
- **R17 No resale** — no paid API tier or data-partnership grant; consumer share links are a product share of
  ≤100 live on-domain listings, not a data sale.
- **R19 Watermarks/notices** — the ETL deliberately keeps the watermarked media variant and drops
  `LargestNoWatermark` (`scripts/worker/mediaEnrichment.ts:119-167,215-223`); the UI renders images `unoptimized`
  to avoid re-encode stripping the watermark; the ToU forbids users removing marks. Strong, deliberate compliance.
- **R21 Privacy/PIPEDA** — full 14-section policy naming PIPEDA, processors, RLS, and OPC recourse
  (`src/app/privacy/page.tsx`), linked from dashboard/auth/forms. *(Caveat: both privacy + terms carry a
  `TODO(legal): have this reviewed by counsel` — get counsel sign-off before relying on them.)*
- **R22 No affiliation** — only attribution/licence statements ("Powered by PROPTX MLS®", "under licence from
  PROPTX and TRREB"); no partner/endorsed/official language.
- **R23 ToU acceptance** — recorded via `/welcome` → `AcceptTermsForm` → `POST /api/vow/accept-terms` →
  `recordTermsAcceptance()` writing `terms_accepted_at` + `terms_version` + `bona_fide_attested=true` (migration
  029); a version bump re-prompts everyone. Enforced at the consumer gate. *Caveats:* honored everywhere **except**
  the active listing page (R12); fail-open if migration 029 is absent.
- **R24 Status integrity (anon)** — no listing is mislabelled "Active": a frozen-Active row is overridden to
  OFF MARKET from `raw_vow_delisted` (`getListingDetail.ts:472-488`); the `/address` page and anon comp routes
  never emit VOW rows to anonymous users. **Three caveats (🟡, Medium):** (a) the listing page *does* show anon a
  VOW-derived **SOLD / OFF MARKET status badge** (numbers nulled) while `/address` hides sold-vs-terminated
  entirely — inconsistent treatment of the same class of data (a documented "HouseSigma-model" decision, but
  decide it deliberately and apply it consistently); (b) `src/app/sitemap.ts:104-124` selects **every** listings
  row with no status filter, so it emits `/properties/{key}` URLs for sold + delisted listings — contradicting
  its own `:11-12` comment ("active IDX feed only … never emitted"); non-active pages are `robots:{index:false}`
  (`properties/[id]/page.tsx:251-260`) so they're noindex, but still crawlable/reachable and still serve the SOLD
  badge + address + list price + DoM to anon; (c) the anon alert-email reason leak (see R12). Plus the R8 ghost
  window. **Fix:** filter the sitemap to active statuses (and correct the comment); align the listing-page badge
  policy with `/address`; gate the email reason.

---

## 5. Cannot be closed from code — verify in production

1. **Typesense browser-key scope + leaked-key revocation (decides R12-Critical).** Run the read-only script left
   at `scripts/admin/_auditKeyScope.ts` (it lists key scopes with masked prefixes and tests whether the public
   key can reach `sold_listings` and page past 100). **This was intentionally blocked in this session** because
   it reads the production Typesense cluster with the admin key — an action you never explicitly authorized — so
   it needs your approval to run. Expected PASS: the leaked `BzXk…` key is absent, and the public key is BLOCKED
   on `sold_listings`. Any other result is a critical VOW leak. *(I authored the script but did not run it.)*
2. **Migration 029 applied in prod + `VOW_ENFORCE_TERMS` unset** — otherwise the consumer gate fails open to
   login-only (R12/R23).
3. **Vercel preview deployments** — confirm they are password-protected/`noindex`, and register `www` (R7).
4. **PostHog** — is session replay enabled, and do VOW price elements carry `[data-ph-mask]`? (R13).
5. **Apex → www redirect** — confirm the registered apex actually resolves/redirects as intended (R7).

---

## 6. How HouseSigma & Zolo handle each infraction (reference model)

| Obligation | HouseSigma | Zolo | Where PureProperty stands |
|-----------|-----------|------|--------------------------|
| **Sold/VOW gating** | Free account; **bona-fide questionnaire** + auto-match to an HS agent; sold price, charts, **and AVM** all gated; idle re-auth | Public sold **index**, but sold **price** needs email-verified account; name+email+ToU | Server-side gating strong; `/address` stricter than Zolo; **but** active listing page is login-only (R12) |
| **AVM/estimates** | **Gated** behind login, labeled "Estimated Value" | **Public** address tool, separate from listings | Gated for anon; leaks to logged-in **non-consumers** on the listing page (R12/R6) |
| **Required notices** | "deemed reliable… by PROPTX/ITSO" + bona-fide in ToU/pages | CREA/TRREB attributions in ToU | Correct copy exists but **missing on the terminal default view** (R9/R11) |
| **Brokerage attribution** | Displayed (HS is a brokerage) | Displayed (Zolo Realty) | Present on core surfaces; dropped on 6 secondary ones (R3) |
| **Anti-scraping** | robots.txt walls sold/estimate/API; ToU ban | **Hard 403 bot-wall** on everything | robots + Cloudflare, but bulk endpoints open + **no monitoring** (R15) |
| **Registered host** | Single brokerage domain | `www.zolo.ca`, bot-walled | **www unregistered + previews open** (R7) |
| **Terminated/off-market** | Behind login; alerts track "sold/terminated/suspended" | Behind registration | `/address` gates correctly; but the **anon email leaks the specific "terminated" reason** the dashboard suppresses; ghost window in sync (R8/R24) |
| **Email alerts** | Registered users only | Registered/verified only | Sent to **anonymous** leads; leak price-drop magnitude/direction (IDX, OK) **and the specific de-list reason** (VOW status detail — not OK) (R12/R13) |
| **Synthetic listings** | Real feed only | Real feed only | **Fabricated MLS®-badged listing on the landing hero** (R1) |
| **Enforcement precedent** | Named in TRREB's 2020 memo (2-yr sold-data limit; threatened $50k fines); complied | No enforcement action found | — |

**Net:** HouseSigma is the strictest reference (gate everything including the AVM, plus a bona-fide questionnaire
and idle re-auth). PureProperty's server-side architecture is comparable or better in places (the `/address`
structural gate), but three "front-door" gaps — unregistered host, terminal notices, and the login-only listing
gate — are exactly the kind of visible, easily-audited items a board spot-check would catch first.

---

## 7. Prioritized remediation checklist

**Do first (High / breach-cure exposure):**
1. **R7** — register `www` (+ apex) with PROPTX; add a middleware host allowlist; lock down preview deployments.
2. **R9 + R11** — make `ListingComplianceNotice` (deemed-reliable + bona-fide) persistent on the terminal + map.
3. **R12** — switch `/properties/[id]` from `getCurrentUser()` to the `getConsumer()` consumer gate.
4. **R15/R18** — auth-or-cap `/api/properties/listings`; distributed rate limiter; lock Typesense CORS; add
   scrape monitoring.
5. **§5 verifications** — run the key-scope check (with approval) + revoke `BzXk…`; confirm migration 029 +
   `VOW_ENFORCE_TERMS`.

**Then (Medium):**
6. **R12/R13/R24** — gate the specific de-list reason in the anon alert email (show a neutral "no longer listed");
   this is the one concrete VOW-status detail reaching non-consumers.
7. **R1** — add an "illustration" disclaimer + non-real MLS id/brokerage to the landing hero listing.
8. **R24** — filter `sitemap.ts` to active statuses (and fix its inaccurate comment); align the listing-page
   SOLD/OFF-MARKET badge policy with `/address`.
9. R3 attribution fallbacks + prominence on the six secondary surfaces.
10. R8 staleness fuse / "as-of" banner + loud Query-C-failure alert.
11. R20 minimal per-consumer VOW-access audit log.
12. R13 scrub addresses/keys from analytics URLs; verify PostHog replay masking.
13. R6 keep all derived analytics behind the consumer gate; decide on anon active-listing calculators.

**Lower priority / hygiene:**
14. R10 soften "every/all" marketing superlatives.
15. R2 optional merged multi-layer 100-cap.
16. Disclose the operating TRREB Member brokerage identity on-site (R5); get counsel sign-off on terms/privacy.

---

*Prepared by an automated multi-agent compliance audit (6 reviewers + direct code verification). Findings cite
`file:line`. Items in §5 require production access and were not executed in this session. This is an engineering
compliance review, not legal advice — pair it with counsel review before relying on it for board correspondence.*
