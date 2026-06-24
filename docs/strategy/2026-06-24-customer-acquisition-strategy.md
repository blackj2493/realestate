# PureProperty.ca — Customer Acquisition Strategy

> ⚠️ **SUPERSEDED by `2026-06-24-customer-acquisition-strategy-v2-web-grounded.md`.** This version's generation agents ran headless and could not reach the web, so its precedents are from model knowledge. The v2 edition replaces those assumptions with cited web research (HouseSigma/Zoocasa/Properly growth, programmatic-SEO ranking data, data-PR precedents, community-seeding realities). Read v2 for the current plan; this file is kept as the workflow-output record.

**Date:** 2026-06-24
**Method:** 64-agent adversarial workflow — 8 strategy lenses → distilled to 8 candidates → 5 skeptics attacked each (code-grounded) → weighted scoring → synthesis → hard red-team → refine → 4 independent confidence judges.
**Panel-voted confidence:** **54%** (individual votes: 55 / 52 / 52 / 55). The refined plan self-rates **~40% at 6 months.**

> **Method caveat:** the generation agents could not run live web searches in the headless run, so the "global precedents" cited below are from model knowledge, not freshly verified. The adversarial/scoring layers *did* read the live codebase, which is where the sharpest findings came from.

---

## 0. The single most important finding (read this first)

**Nobody can honestly sell you 95% confidence before the evidence exists.** Every independent judge landed at ~52–55%. The honest target is not "a plan we're 95% sure of" — it's **a plan that cheaply buys the evidence to move you from ~50% to a real number in ~6 weeks, with downside bounded to founder-hours, not capital.** Any strategy promising more than that pre-validation is selling certainty that cannot exist yet.

What the panel *is* confident about:
- The **wedge is right**: investor-first, on the one axis (investor analytics) HouseSigma doesn't own. Competing on their axis (coverage/history/apps/brand) is suicide-by-attrition.
- The **downside is bounded**: the whole plan costs founder-hours, not marketing capital.
- The product depth is **real and honestly described** (verifiers confirmed the engines exist in code).

What kills the confidence (the unanimous red-team verdict): **every channel routes through one part-time founder doing manual work, and there is no compounding/automated channel that survives him running out of hours.** All four judges independently named the same #1 fix → see §2.

---

## 1. The wedge

- **Audience:** High-intent GTA investors / flippers — the only segment where your built depth is a weapon, not redundancy.
- **Hook (the reason-to-care):** the **non-VOW "gotcha"** — *"This 'new' listing has actually been for sale 94 days across 3 relistings; ask is down 14% since March."* True DOM + Price Compression + suite/density flags. These are anonymous-renderable, screenshot-able, and legally clean (non-VOW).
- **The signup reward (NOT the hook):** Deal Score, Estimated Sale Price, offer band. These are VOW-derived/gated — and crucially, they're the part real investors **hoard**, so never count on them propagating. Assume **viral coefficient K = 0**; treat any sharing as pure upside.

### Code-grounded build constraints the skeptics surfaced (do not skip)
- **The ~2% Estimated Sale Price is *list-anchored*** (`salePrice.ts` needs a live ask). The "paste ANY address" promise is **false for off-market** — there it falls back to the **~11% AVM**, a credibility bomb local agents will screenshot-dunk. → **Key the public artifact strictly on an active Typesense listing**, never a bare/off-market address.
- **Deal Score + Estimated Sale Price are VOW-gated.** The *free public* layer must be the non-VOW metrics only (True DOM, Price Compression, suite/density, mandatory brokerage name). The gated metrics sit behind the free-account CTA.
- A **broadcast email primitive does not exist yet** — `alerts.ts` is per-user-per-listing transactional only. The newsletter (§2) is a small real build, not a config change. Never broadcast specific IDX listing rows to a list (prohibited redistribution); send commentary + aggregates + gated teases.

---

## 2. The one structural fix the whole panel demanded

The refined plan makes **manual founder-seeding the primary engine**. All four judges independently said this is the load-bearing crack: it's linear, perpetual, and competes with the founder's build time, day job, and future brokerage. Their unanimous prescription:

> **Elevate a leverageable, build-once-reuse channel to a CO-PRIMARY track — don't bury it in a later "bridge" phase.**

The strongest candidate, because it uses your **abundant** resource (engineering) instead of your scarcest (founder-hours):

**→ The "GTA Distress Letter" — an auto-generated weekly digest** of the most distressed/compressed listings (deterministic, §4-safe, founder QA's each send). Build it once; it compounds without per-listing labor, builds an owned list of named high-intent investors, and de-risks the single point of failure (the founder personally being the funnel).

Paired with the **SEO capture loop** (the only other non-founder-hours channel), this gives you a real engine instead of one tired person. **Manual seeding becomes the bootstrap that proves investors convert and seeds the first list — not the long-term engine.**

---

## 3. The sequenced plan

### Phase 0 — Cheap diagnostics (Week 1, blocks nothing)
The highest-leverage work in the entire plan. Buy the facts before building.
- **0A — SEO reality check (30 min):** pull Google Search Console *today*. Are the hubs indexed? Getting investor-intent impressions? Ranking? "45k indexed URLs" is an **assumption** — a young domain with thin programmatic pages is a Google doorway-page *risk*, not a guaranteed asset. **This single check decides whether you have one channel or two.**
- **0B — Founder-cadence time-test (2 weeks, zero code):** manually do the seeding motion with current tools; log every minute. Price *your* sustainable cadence empirically before building.
- **0C — Compliance ask:** as a licensed EXP agent, email TRREB compliance 3–4 exact sample cards; get written sign-off on aggregation floors + co-branded-metric rules. Assume a **90-day** reply; ship non-VOW regardless.
- **GATE:** Proceed only if (a) Search Console shows *any* nonzero investor-intent impressions OR you consciously accept SEO is a 6–12 mo bet; AND (b) you sustained **≥4 hrs/week for the full 2 weeks**. **Kill the manual wedge now** if you can't hold 4 hrs/week — it only gets harder once the brokerage starts.

### Phase 1 — Ship the artifact + bootstrap seeding (Months 1–3)
- Thin public page over `dealScore` / `avm/salePrice` / `underwriting`, **keyed on an active listing**. Public = non-VOW metrics + brokerage name; gated CTA via `/share/[token]` with per-link attribution.
- Founder seeds **only** in live "is this overpriced?" threads/DMs, disclosed as an agent per each room's rules, value-first, mods messaged first.
- **Run warm-sphere outbound in PARALLEL from day 1** (judges' note): your EXP/board sphere + any prior investor contacts are the highest-trust, founder-controlled top-of-funnel — not a fallback for when mods say no.
- **GATE (over ~60–80 cards / 4 weeks):** share→signup **≥8%** *and* tolerated in **≥2 of 3** rooms *and* cadence held ≥4 hrs/wk for 4 straight weeks. Treat 8% as *directional* (n is small); weight the qualitative "are buyers replying" signal equally. **Kill/pivot** if mod-removed in ≥2 rooms, cadence breaks 2+ weeks, or conversion <3%.

### Phase 2 — The leverageable engine (Months 1–3, run as co-primary)
- Build the **double-opt-in capture** on the highest-cap-rate / development-potential / neighbourhood hubs → new `broadcast_subscribers` table on the existing Resend path.
- Ship the **auto-generated weekly Distress Letter** (founder QA'd). This is the only channel that compounds without founder-hours.
- **GATE:** ≥300 GTA-investor subscribers AND ≥10 "actively buying" replies by Day 90. **Kill** if hubs convert <0.5% or send near-zero traffic by week 8 (and downgrade the whole investor-reachability thesis).

### Phase 3 — Brokerage validation, founder-as-agent-of-record (Months 3–9)
- **Do NOT** start by asking competing/EXP agents to deploy your tool for their clients — structurally misaligned (you'd be training their clients on your future competitor's brand; a "yes" tests friendship, not deployability).
- Instead: **you're licensed — be the agent of record on your own signups.** Work the highest-intent watchlist/viewing-request leads yourself. Tests the only question that matters — *does a signed-up investor actually transact?* — with zero third-party dependency. Each close = a sold-accuracy receipt = credibility fuel back into Phase 1.
- **GATE (proceed to open brokerage):** ≥1 attributable transaction *or* ≥3 viewing-requests with genuine offer intent traceable to the wedge by ~Day 150. **Kill the brokerage decision** (keep the portal as a brand/SEO/lead asset) if no transaction-intent signal appears despite a growing list.

### Bridge (Months 6–9+, only on cumulative green)
Optional B2B2C with **non-competing investor-serving agents**, on-domain calculator-SEO, and a quarterly distress index as an authority/link sink. Leftover hours only. Keep the press index background-only and **post-compliance-letter** — don't point an "agents game the DOM clock" hook at the board whose license you hold.

---

## 4. Per-play confidence + the one thing that must be true

| Play | Confidence | Must be true |
|---|---|---|
| 0A — SEO check | 95 | Search Console tells the truth in 30 min (the *result* may be bad; the diagnostic is reliable) |
| 0B — cadence test | 80 | Founder honestly logs hours and respects the kill |
| 0C — compliance | 70 | Board eventually replies; non-VOW ships regardless, so silence isn't fatal |
| 1 — artifact + seeding | 45 | Rooms tolerate a disclosed agent AND founder sustains cadence (both unproven, both binding) |
| 2 — SEO capture + newsletter | 35 | The programmatic hubs actually rank and send investor-intent traffic (currently unverified) |
| 3 — founder-as-AOR | 50 | A signed-up investor transacts with the founder in-window |
| Bridge — B2B2C / authority | 25 | A non-competing agent deploys; authority content compounds (both slow) |

---

## 5. First 5 actions this month

1. **Pull Google Search Console (this week, 30 min).** Decides one channel vs two.
2. **Run the 2-week cadence time-test now (zero code).** Decide honestly if 4 hrs/week is sustainable *before* building.
3. **Email TRREB compliance** with 3–4 exact sample cards. Assume 90-day reply; ship non-VOW regardless.
4. **Build the active-listing-keyed artifact page** (days, not weeks — it's packaging existing engines): public non-VOW metrics + brokerage name → gated CTA via `/share/[token]`.
5. **Message the mods** of r/TorontoRealEstate + your top 2 GTA REI groups to learn the disclosed-agent rules *before* posting. If 2 of 3 say no, pivot weight to warm-sphere outbound immediately.

**The asymmetry that makes this worth doing:** if the first two weeks come back red (SEO dead, cadence unsustainable, mods hostile), you've spent ~10 founder-hours learning the channel is wrong — not a quarter and not a dollar. If green, you've earned a validated, defensible, founder-led engine and the right to open the brokerage.

---

## Appendix — Strategies considered (ranked, after adversarial review)

None were outright killed; all survived "wounded" (the wedge is sound, the execution risk is founder-throughput).

| Strategy | Score | Avg skeptic confidence |
|---|---|---|
| Own the Investor Room (founder-led teardowns + gated community) | 54 | 46 |
| The GTA Distress Letter (auto-generated newsletter) | 47 | 48 |
| Arm the Agents (B2B2C co-branded reports) | 46 | 46 |
| Calculator-Led SEO Moat (MLS-live tools that earn backlinks) | 46 | 39 |
| The Underwrite-This-Address Tool | 43 | 42 |
| The Quarterly GTA Flip/Distress Index (data-journalism link magnet) | 33 | 39 |
| The True-DOM Exposé (shareable artifact + earned media) | 30 | 36 |
| Sold-Accuracy Receipts (public, falsifiable scoreboard) | 29 | 35 |

**Note on the synthesis:** the workflow's refined plan kept manual seeding primary. This memo elevates the **Distress Letter + SEO capture** to co-primary per the unanimous judge note, because they are the only motions that break the founder-hours throughput ceiling — using the founder's abundant resource (engineering) rather than his scarcest (time).
