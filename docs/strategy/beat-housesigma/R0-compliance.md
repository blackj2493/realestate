# R0 — Compliance / TRREB Guardrail (opening position)

**Author:** `compliance` | **Round:** 0 | Read-only audit of agreements + live gate code.

I read **both** signed agreements end-to-end (`pdftotext` extract of `idx-agreement.pdf`, `vow-agreement.pdf`) and the live gate code. This file is the **legal box every other agent must design inside.** Cite the clause, not my opinion.

---

## 0. Who we actually are (load-bearing facts from the signature pages)

This dictates *who* can sign off on anything risky — it is not a footnote.

- **Member / licensee:** TANMAY RAO, PROPTX membership **#9608879**, under brokerage **EXP REALTY** (branch **285400**). (`idx-agreement.pdf:1083-1089`, `vow-agreement.pdf:981-988`)
- **Broker of Record (BoR):** **KATHERINE SARAH MILIAN**. She personally acknowledged the Brokerage is **"fully and directly liable for any breach or any other unauthorized activity"** and specifically initialled **§6.3(g)** in both agreements. (`idx:1182-1196`, `vow:1068-1080`)
- **PureProperty.ca operates as a Third Party Service Provider (IDX) / Affiliated VOW Partner (VOW)** — registered Subscriber/VOW URL is **`http://pureproperty.ca`** (`idx:1108`, `vow:1001`). The TPSP/AVP has **no independent data rights**; everything is derivative of the Member's licence (IDX §6.4 / VOW §6.4). If Tanmay leaves EXP or BoR changes, **both feeds must be re-papered** (IDX §12.3(d), VOW §12.3(d)(e)).
- **Up to 3 URLs allowed per feed** (IDX §3.2 "Subscriber Website(s)"; VOW §3.2 "VOW"), but **each URL must be pre-approved by the BoR via the PROPTX Online Agreement System** before it goes live (IDX §6.3(g), VOW §6.3(g)). **New public surface = BoR paperwork, not just a deploy.**

> **Implication for the council:** "Get sign-off" is not a vague hand-wave. It is a concrete, named action — BoR Katherine Milian filing a URL/change form with PROPTX — and she carries personal joint-and-several liability (IDX §11.1, VOW §11.1). Any proposal whose go-live depends on her signature must say so explicitly and price in the lead time.

---

## 1. The single most important legal distinction (IDX ≠ VOW)

The two feeds are **not** governed by the same rules, and the council keeps conflating them.

| | **IDX feed** (Active listings) | **VOW feed** (Sold / closed + full detail) |
|---|---|---|
| What it carries | Active listings only — *"subset of active listings"* (IDX §3.2 "IDX Data") | All Listing Information incl. **sold prices/dates** |
| Display surface | A public **Subscriber Website** | A **"secure password-protected internet website"** (VOW §3.2) — **gating is the licence, not a UX choice** |
| Derived analytics? | **FORBIDDEN.** §6.2(f) bars merging/creating derivatives, full stop — no carve-out. | **PERMITTED, narrowly.** §6.2(f): *"Members may use any such information to create derivative analytical tools or reports **on their VOW(s)** solely for the purpose of providing residential real estate brokerage services."* |
| AI/LLM | §6.2(k): may not feed IDX data to **any** AI System for any purpose. | §6.2(a)/(f)/(j): same prohibition, written into the restriction. |

**Three consequences nobody else will flag:**

1. **Our entire data-edge (AVM, True DOM, Value-Add, cap/yield off sold comps) is legal ONLY because it is VOW-derived and lives behind the VOW password gate.** It rests on a *single sentence* — VOW §6.2(f) — and that sentence has two hard limits: **(a) on their VOW(s)** [= password-gated] and **(b) solely for providing brokerage services to bona-fide consumers.** Strip either qualifier (e.g. expose AVM publicly, or to a non-consumer) and the carve-out evaporates → §6.2(f) reverts to "create no derivative works."
2. **Anything derived purely from the IDX (active) feed has NO analytics carve-out at all.** If a metric is computed only from active listings, IDX §6.2(f) forbids it even behind a login. Metrics must be sourced from VOW to inherit the carve-out.
3. **§6.3(f) (both feeds): raw listing content "may not be changed in any way."** Only *reformatting by field selection on objective criteria (geography/property type)* is allowed. We may **display new computed columns alongside** the data; we may **not alter, rewrite, paraphrase, or "clean up" the feed's own fields** (e.g. no LLM-rewritten remarks, no edited brokerage strings).

---

## 2. The Compliance Envelope

### ✅ SAFE (already inside the box — keep doing / can expand freely)
- **Public, indexable display of ACTIVE (IDX) listings** incl. the 45k `/properties/{key}` detail pages in `sitemap.ts`. The sitemap comment is correct: it emits `listings` (active IDX) only, never `raw_vow_sold`. *Rule: IDX Purpose §3.2 + §6.3 — active display on the registered Subscriber Website is the licensed use.*
- **The 100-listing display cap.** Enforced as `MAX_LIST = 100` / `Math.min(limit, 100)` with `// TRREB §6.3(b)` comments (`sold/route.ts:41`, `dashboard/queries.ts:230,253`, `useWatchlistSnapshot.ts:99`). *Rule: IDX §6.3(b), VOW §6.3(b).*
- **Aggregate COUNTS and histograms over the index** (`perPage:0 → found`, range-count tiles, median-sample histograms in `bubbles/stats.ts`). A count/distribution is **not** "viewing/retrieving Listings," so it is outside the §6.3(b) 100-cap. *Defensible, but see §3 limit #3.*
- **Deterministic derived metrics in the ETL** (True DOM, ExtrapolatedCapRate). Verified: **no LLM SDK is imported anywhere in `scripts/worker/`** — the §4 / §6.2(k) "no AI on listing data" line holds today.
- **VOW sold data shown to a logged-in, terms-accepted Consumer** with brokerage on every row (`sold/route.ts` count-only teaser for anon, full rows for `isConsumer`). *Rule: VOW Purpose §3.2 + §6.2(f) "on their VOW(s)."*
- **Mandatory brokerage display** (`ListOfficeName` on every sold row; must also be verified present on every IDX thumbnail/card — see §3 limit #2). *Rule: §6.3(c).*

### 🔒 GATED (legal only behind the VOW password wall + bona-fide-consumer + BoR awareness)
- **Sold prices, sold dates, sold comps, sold media.** *VOW §3.2 (password-protected) + Purpose.*
- **AVM / "what's it worth", Value-Add / Force-Appreciation, region cap-rate & sold-price-trend stats** — anything computed *from* VOW sold data. *VOW §6.2(f): derivative tools allowed only "on their VOW(s)... for providing brokerage services."* The live `requireConsumer.ts` choke point is the right architecture; the remaining gap is operational — flip `VOW_ENFORCE_TERMS=true` so a signed-in-but-not-terms-accepted user is correctly treated as a non-consumer (the code already supports it: `getConsumer()` returns `isConsumer:false` until `hasAcceptedTerms`).
- **Watchlist price-drop email alerts** — the digest reflects VOW-derived deltas to a registered account; fine as a private consumer service, **but** must stay deterministic (no LLM summarizing listing content into the email — §6.2(k)) and must go only to the account owner (privacy §9).
- **Any NEW public URL / subdomain / app** (even showing only active data): must be **BoR-pre-approved and filed with PROPTX** first. *§6.3(g).*

### ⛔ FORBIDDEN (will draw a §12.3 termination / §13.1 injunction — re-work or kill)
- **A PUBLIC (ungated) AVM / valuation / "instant home value" tool.** This is the headline growth-magnet idea and it is the **single highest revocation risk.** A public valuation tool is a derivative work of VOW sold data served *off* the VOW and to non-consumers → breaks **both** qualifiers of VOW §6.2(f), and HouseSigma-style "what's my home worth" lead-gen also fails the "bona-fide purchase/sale interest" Purpose. *VOW §6.2(f), Purpose §3.2, §6.3(k).* **No engineering trick fixes this — only audience/placement (gated) or explicit PROPTX written authorization does.**
- **Feeding ANY listing/sold field to an LLM** for rewriting, summarizing, embedding, semantic search, or "AI insights." *IDX §6.2(k), VOW §6.2(a)/(f)/(j).* (This forecloses the obvious "AI listing summaries / chat-with-the-MLS" virality play. Derived metrics must stay hardcoded & deterministic — §4.)
- **Syndicating / exporting / re-publishing the feed** to social, a partner, a public API, a downloadable dataset, or a third-party site. *§6.2(g),(h),(r)/(s).* This kills "embeddable widgets," "public data API," and "post listings to Instagram/X" growth loops as drawn.
- **Altering feed-native content** — LLM-cleaned addresses, rewritten public remarks, "de-duplicated" brokerage names. *§6.3(f).*
- **Returning >100 Listings to one user query** via clever pagination/infinite-scroll that lets a user retrieve the 101st+ listing in response to one inquiry. *§6.3(b).*
- **Removing/obscuring the brokerage or PROPTX notices**, or claiming "full MLS access." *§6.3(c),(f),(j),(i); §7.6.*

---

## 3. My top 3 hard limits (the ones I expect to actively enforce this council)

1. **The VOW carve-out is a tightrope, not a highway.** Every "shadow data" feature that beats HouseSigma is legal *only* while it stays password-gated AND serves bona-fide consumers AND is framed as a brokerage service. Growth's instinct (make the magic public to go viral) and Compliance's box are in direct tension here — that tension is *the* strategic decision of this council.
2. **Brokerage display must be audited on EVERY active surface, including map popups, comparison tables, watchlist cards, and thumbnails** — same font/size, not visually separated (§6.3(c)). I have verified sold rows; I have **not** yet verified IDX cards/map popups/compare cells. This is a silent, easy-to-miss breach vector.
3. **The aggregate-count defence has a ceiling.** Counts/histograms dodge the 100-cap, but a feature that lets a user *enumerate* the underlying listings via repeated narrow count queries, or that ships >100 rows of sampled data to the client, re-crosses into "retrieving Listings." `bubbles/stats.ts` `MEDIAN_SAMPLE_CAP` is fine as long as the **samples never render as a browsable listing set** — perf-arch/data-quant must keep it server-side and aggregate-only.

---

## 4. My 3 boldest moves — high-impact AND compliant ("yes-and", not vetoes)

### Move 1 — "The Velvet Rope IS the moat": weaponize the mandatory VOW gate into our acquisition engine
*Persona: all four, anchored on the **Flipper/Deal-Hunter**.* HouseSigma forces a signup to see sold prices and treats it as friction. **We are *required* to gate VOW anyway (VOW §3.2 password-protected) — so stop apologizing for it and make the gate the product.** Reframe the 3-step "Application for Terminal Access" as the qualifier that proves bona-fide interest (which §3.2 Purpose *requires* us to establish), and make the locked teaser show *more provocative shadow-data shapes than HouseSigma's* — e.g. "this block had 7 sold firm in 30d, median True-DOM 41d, 3 sold under ask" as a **count/aggregate teaser** (SAFE per §2), with the row-level detail unlocking on signup. Compliant because the teaser is aggregate (no §6.3(b) listings, no VOW row values leave the server — exactly what `sold/route.ts` already does), and the gate is a licence obligation we turn into conversion. **Beats HouseSigma on:** the wall feels like exclusivity, not a paywall, and the teaser exposes insight they don't tease.

### Move 2 — Lean ALL-IN on programmatic SEO of the ACTIVE (IDX) feed — the one place we can legally go big & public
*Persona: **Smart Homebuyer** (top-of-funnel) feeding the gated personas.* This is the Realtor.ca-traffic play and it is **squarely SAFE**: active IDX listings on the registered Subscriber Website are the licensed public use (§3.2 Purpose), and `sitemap.ts` already emits 45k indexable detail pages. **Yes-and:** add neighbourhood/city *active-inventory* landing pages and active-listing structured data (schema.org RealEstateListing) — all from the IDX feed, all with mandatory brokerage display, all carrying the §6.3(i) "deemed reliable, not guaranteed" and §6.3(k) bona-fide notices. **The hard line I'll hold:** **zero sold data, zero AVM numbers, zero VOW-derived metrics in any indexable/public page or its meta tags** — those are the bait that lives *behind* the Move-1 gate. This is the only growth lane where Compliance says "go bigger," not "stop."

### Move 3 — A "Compliance-Safe Insight" spec + pre-cleared design pattern so the council stops re-litigating the box
*Persona: serves the council; protects all four personas' features from getting killed late.* The riskiest failure mode isn't one bad feature — it's **shipping a great gated feature, then leaking it** (a public share link, an OG-image preview, an SEO meta description, a logged-out screenshot) that puts VOW-derived numbers in front of a non-consumer or a crawler. **Yes-and:** I will publish one reusable rule — *"VOW-derived value ⇒ behind `requireConsumer` (terms-enforced) AND `robots` disallow AND no value in OG/meta AND no syndication."* `robots.ts` already disallows `/dashboard` and `/share/`; the pattern formalizes that so growth can move fast *inside* the box without a compliance review per feature. **Beats HouseSigma on:** we can ship aggressive shadow-data features at speed precisely because the legal rails are pre-poured — they litigate each feature, we don't.

---

## 5. The riskiest idea I expect to have to veto

A **public "What's your home worth?" AVM tool** (or any logged-out AVM/sold-price surface) used as the viral acquisition hook. It is the most obvious way to "become an instant hit," `growth`/`competitive` will almost certainly propose it, the AVM engine already exists, and it is **flatly forbidden** (VOW §6.2(f) both qualifiers + Purpose §3.2). My counter is **Move 1** — capture the same intent with an *aggregate* public teaser and unlock the number behind the legally-required gate. The compliant version of "instant hit" is *gated magic with a public aggregate teaser*, never *public magic*.
