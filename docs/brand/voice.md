# PureProperty.ca — Communication Voice & Tone Guide

> **Status:** Canonical. This governs all user-facing communication — email, in-app
> copy, notifications, onboarding, transactional and marketing messages — and every
> AI edit to that copy in this repo. If a message can't pass the litmus test at the
> bottom, it doesn't ship.
>
> **Re-established & reconciled 2026-08-01 (against `origin/main`).** This file had fallen
> out of the tree (it lived only in git history, last at `bb62fd9`). It is now restored as
> source of truth and reconciled to the emails that actually ship — the **welcome**
> (`welcomeEmail.ts`), the **nightly digest** (`digest.ts`, composed from `emailShell.ts`),
> and the **lead follow-up** (`leadFollowUpEmail.ts`). **Verify email code against
> `origin/main`, not the working tree** — the `feat/email-comms` branch is ~179 commits
> behind and its email files are stale. Live wiring status: §12.

---

## 0. Why this exists

For most products, brand voice is decoration. For PureProperty it is the **product
differentiator**. Realtor.ca and HouseSigma communicate like a **consumer portal** —
warm, aspirational, agent-friendly ("Find your dream home!"). Our entire wedge is
being the **anti-portal**: the terminal, not the brochure.

So our copy must not sound like real estate marketing at all. It should read like a
**research desk / trading terminal**: a Bloomberg alert, a sell-side research note, a
Stripe status email. Every word either reinforces *"this is institutional-grade and
I'm now an insider"* or it breaks the spell. There is no neutral copy.

**Ultimate business goal:** PureProperty is a **brokerage lead-generation engine**. The
data terminal is the top of the funnel; the revenue is real estate commission once the
brokerage is live. Every communication decision is judged against *"does this move a
high-intent person toward transacting with us?"* — see §10 for the phased plan.

**Decisions locked with the founder (2026-07-16):**
- **Edge:** Overtly contrarian, **re-aimed**. We attack *the old way / the industry
  status quo / the typical agent who buries the numbers* — never the category of agents
  as a whole, because we intend to *be* the agent. PureProperty is positioned as the
  exception that fixes it. (Guardrails in §7; phased wording in §10.)
- **Sender:** Split. Automated alerts/digests are machine-sent and unsigned. Personal
  follow-ups come from a human identity — **phased**: a research-desk identity now
  (pre-brokerage), a named licensed agent once the brokerage is registered (§3, §10).

---

## 1. Voice (constant — never changes)

Five pillars. Voice is *who we are*; it does not flex by context.

| Pillar | Means | Kill on sight |
| :--- | :--- | :--- |
| **Terse** | Say it in 8 words, not 20. Density signals respect for their time. | Throat-clearing ("We're excited to let you know that…") |
| **Numerate** | Lead with the number. The data is the sentence; prose is the caption. | Adjectives doing a number's job ("great deal", "huge drop") |
| **Precise** | Exact figures, exact terms, exact timestamps. Never round when you can be specific. | Vague hedges ("recently", "several", "around") |
| **Understated-confident** | The data flexes; we don't. No hype — hype reads as *retail*. | Exclamation marks, urgency theater, "Don't miss out!" |
| **Contrarian (re-aimed)** | We're on the user's side against *the old way* — the industry status quo and the typical agent who buries the numbers. We are the fix. | Attacking agents *as a category* (we're becoming one), ranting, or disparaging a *specific* brokerage (§7) |

### Who is talking?

Picture the sender as **a sharp analyst who runs the terminal** — not a brand, not a
chatbot, not "the PureProperty team!". Slightly clinical, unmistakably on the user's
side, never chummy. When a copy decision is unclear, ask: *what would that analyst
write?*

---

## 2. Tone (flexes by context)

Voice is constant; **tone dials warmth up or down** by where a human is in the loop.
The risk of a terse, clinical voice is sounding robotic in the two moments a
relationship forms (welcome, lead follow-up). Hold the voice — flex the warmth.

| Context | Warmth | Sender | Why |
| :--- | :--- | :--- | :--- |
| Alerts / nightly digests | **0%** — pure utility | Machine (`PureProperty Alerts`) | They subscribed to data, not to us. Personality here is friction. |
| Signup confirmation | **10%** — one human beat, then facts | Machine | Reassure it worked, set expectations, exit. |
| Auth / OTP codes | **0%** — mechanical, instant | Machine (Supabase) | Trust = boring and fast. |
| Onboarding / welcome | **40%** — teach, don't gush | Machine, but written like a person | The one place we earn activation. Warm enough to guide. |
| **Lead follow-up (viewing request)** | **60%** — a person replying to a person | **Named human** | Highest intent we'll ever see. Sounding human converts. |
| Compliance / unsubscribe | Neutral, respectful, frictionless | Machine | A company confident in its value never traps you. |
| Operator / ops alerts (internal) | 0% — clean status | Machine | Internal, but stays on-style (no emoji, tagged prefix). |

---

## 3. Sender identity (split model, phased)

- **Automated alert mail** (digests, alerts, confirmations, operational): from
  **`PureProperty Alerts <alerts@pureproperty.ca>`** (the `ALERTS_FROM_EMAIL` env
  overrides it — point that at an `alerts@` value; it currently resolves to `support@`).
  **No personal signature.** Nobody wants a nightly "personal note" from a human. These
  end with the machine footer, not a name.
- **Welcome / activation** is machine-sent too, but from a distinct, warmer "front-desk"
  identity — **`PureProperty <hello@pureproperty.ca>`**, reply-to `support@` — and signs
  off `— The PureProperty terminal`. It is deliberately **not** the Tanmay persona: a
  once-ever activation email earns warmth (40%, §2) without pretending a human wrote it,
  and `hello@` keeps activation's sender reputation separate from the high-volume alert
  stream.
- **Personal follow-up** (a reply to a lead who raised their hand on a specific
  property): from a human identity, `replyTo` set to a monitored inbox. **The name is
  phased** because the founder is currently registered with another brokerage and
  PureProperty is not yet a registered brokerage:
  - **Phase 1 (now, pre-brokerage):** sign as **`— Tanmay, PureProperty`** — a real
    first name, **no title, no "Realty/Brokerage" suffix**. (Whoever signs as Tanmay
    must be the real person who actually reads and replies to these leads — the name is
    not a mascot.) Do **not** claim agent/representation status. The follow-up delivers
    *data and insight* (True DOM, price history, Capital Burn Rate), not an offer to
    represent the buyer. This keeps us honest and compliant while registered elsewhere.
  - **Phase 2 (brokerage live):** switch to a **real, RECO-registered person** — full
    name + credential, e.g. `— Jagdeep [Last], Broker of Record, PureProperty Realty`.
    Representation offers activate here. In Ontario, client-facing real estate comms
    must name a real registered individual and the brokerage — never a mascot.

Rationale: users subconsciously sort machine-mail from human-mail; honoring that split
makes the human touch land harder. The phasing keeps Phase-1 comms in a research frame
(legal today) and upgrades to a licensed, named agent the moment it's permitted.

---

## 4. The lexicon (locked spelling — treat as law)

Our proprietary vocabulary **is** the status signal. Spell and capitalize these
**identically everywhere** — email, UI, tooltips, push. Inconsistency ("true DOM" vs
"True DOM" vs "real days on market") instantly reads amateur and dissolves the
institutional feel. A terminal never calls the same field two names.

| Term | Canonical form | Never write |
| :--- | :--- | :--- |
| True days on market | **True DOM** | true dom, Real DOM, actual days on market |
| Holding cost | **Capital Burn Rate** | burn rate, carrying cost (when we mean the metric) |
| Basement/duplex upside | **Suite Potential** | suite potential, basement flag |
| Yield metric | **Cap Rate** / **Extrapolated Cap Rate** | caprate, cap-rate |
| Gross yield | **Gross Yield** | gross yield |
| Price softening over time | **Price Compression** | price drop (that's an event, not the metric) |
| Overlapping tenancies | **Tenant Overlap Detection** | — |
| Flip/assignment flags | **Assignment Detection** | — |
| Saved geographic alert area | **market bubble** (lowercase noun) | zone, area-alert, geofence |
| Historical stitching engine | **Temporal Distress Engine** | — |
| Buildable-cost metric | **Price-per-Buildable-Square-Foot** | — |

**Rule: use the insider term, then teach it once.** Write *"Capital Burn Rate:
$4,200/mo"* — never dumb it down to *"the monthly cost of holding this place."* The
vocabulary is the differentiation; translating it away throws that away. A one-line
gloss in parentheses on first use per message is fine; a replacement is not.

---

## 5. House style rules

- **No emoji in production copy.** Emoji is portal-warmth; it fights the terminal.
  (Ops/internal mail: replace `⚠️`/`✅` with plain tag prefixes — `[STALE]`, `[OK]`,
  `[FAILED]`.)
- **Subject lines = ticker format.** Facts, middot-separated (` · `), numbers first.
  Never a full sentence, never a question, never a hype word. The existing
  `2 sold · 1 price drop · 5 new listings` is the north star — everything matches it.
- **Numbers first, always.** `−$25,000 (−4.2%)` before any prose. Format money as
  `$1,234,000` (en-CA, no cents). Show deltas with sign and percent.
- **Length ceiling.** If a digest needs scrolling, it failed. Scannable rows, not
  paragraphs. One primary action per message.
- **Dashes.** Em dash `—` for asides; `→` for transitions/CTAs; minus `−` (U+2212) for
  negative deltas, not a hyphen.
- **No exclamation marks. Ever.** Confidence doesn't shout.

### 5.1 Plain language in email (owner directive, 2026-08-01)

**Write email so it's easy to understand — without talking down to the reader.** Email is our
widest, coldest, most first-touch channel, so it can't lean on the insider vocabulary the way
the terminal does. But the reader is a smart adult: explain the *genuinely specialized* terms
and leave the self-explanatory ones alone. Do not over-explain.

- **Explain the specialized finance terms** the first time they appear — the ones a normal
  person may not know cold: **Cap Rate, Gross Yield, Capital Burn Rate, Price Compression,
  Assignment Detection.** One short plain clause beside the term is enough.
- **Leave self-explanatory terms as-is** — glossing them reads as condescending. **True Days on
  Market** (spell out the acronym; it explains itself), **Deal Score** (pair with its A–D grade
  once), **your saved area**, **estimated value** all stand on their own.
- **Lead with the meaning, then the number.** Short sentences; say what a figure means. But
  don't dumb it down — respect the reader.
- **Email only.** The in-app **terminal** keeps the full insider voice (§4 lexicon, minimal
  hand-holding). Email translates the *hard* terms — not all of them.

| Explain in email (specialized) | Say it as |
| :--- | :--- |
| Cap Rate / Gross Yield | the yearly return if you rented it out |
| Capital Burn Rate | what it costs each month to own it |
| Price Compression | the price has been drifting down over time |
| Assignment Detection | signs this is a pre-construction resale |

| Fine as-is (self-explanatory) | Note |
| :--- | :--- |
| True Days on Market | spell out the acronym; no gloss needed |
| Deal Score | pair with the grade once (A = great … D = poor) |
| your saved area | already plain (never "market bubble" in email) |
| estimated value | already plain |

- ❌ (talking down): *"True Days on Market — that's how many days it's been for sale — is 41."*
- ✅ *"It's been on the market 41 days — longer than it looks, because it was relisted."*
- ✅ (specialized term, explained once): *"Cap Rate 4.1% — the yearly return if you rented it out."*

---

## 6. Do / Don't — against our actual copy

Real strings from the codebase, with on-voice rewrites.

### Subject lines
- ✅ **Keep:** `2 sold · 1 price drop · 5 new listings`
  (`src/lib/alerts/digest.ts:subjectFor`). Dense, scannable, ticker-like. This is the model.
- ✅ **Keep:** `$25,000 price drop — 12 King St W`
  (`listingAlertEmail.ts:subjectFor`). Number first, location second. Good.
- ⚠️ **Weak fallback:** `Your PureProperty alerts` / `Your watchlist & market alerts`
  (digest H1/fallback). Generic and portal-ish. Prefer a factual fallback:
  `Your terminal · nightly brief`.

### Signup confirmation — `src/app/api/listing-alerts/route.ts`
- Current: `You're set — Price & status alerts for {address}` + body
  `You'll only hear from us when something actually changes.` + sign-off `— PureProperty.ca`.
- Verdict: subject is fine. Body's *"only hear from us when something changes"* is a
  strong trust signal — **keep it**. But the copy is too tame for a contrarian brand,
  and it signs with the brand (should be machine-footer, per §3).
- ✅ **On-voice rewrite (body, re-aimed contrarian):**
  > Tracking **{address}**. You'll get price cuts and status changes the day they
  > happen — the moves the old way leaves you to find out about too late. Nothing else.
  >
  > *(footer, not a signature)* Machine-sent by PureProperty Alerts. Unsubscribe anytime.

### Lead follow-up — currently MISSING (only the operator is emailed)
`src/app/api/viewing-requests/route.ts` notifies the operator but sends the lead
**nothing**. This is the single highest-warmth touchpoint and it doesn't exist. It is
also the **top of the brokerage funnel** — speed-to-lead here decides conversion (§10).
- ✅ **Phase 1 (now — research framing, no representation claim, 60% warmth):**
  > Got your request on **{address}** — I'll come back to you personally, fast, with the
  > shadow numbers on this one: True DOM, full price history, and the Capital Burn Rate
  > the old way leaves off the listing. That's the read most buyers never get.
  >
  > — Tanmay, PureProperty
- ✅ **Phase 2 (brokerage live — representation activates):**
  > …happy to walk you through it and, if it's a fit, represent you on the offer.
  >
  > — Jagdeep [Last], PureProperty Realty
- ⚡ **Auto-send within seconds** of submission (machine), then a real human follow-up
  fast. See §10 — this is Tier-0.

### Welcome email — SHIPPED (reference implementation)
`src/lib/alerts/welcomeEmail.ts` — machine-sent from `hello@` on first VOW-Terms
acceptance; design of record `docs/brand/email-welcome.html`. It nails the on-voice open
(utility + contrarian hook, no "we're so excited"):
- ✅ **Subject:** `You're in — the tools most buyers never get`
  · **Preheader:** *"What it's really worth, what you could make it worth, and how long
  it's really been for sale."*
- ✅ **Body:** opens `You're in.`, then walks four feature tiles — **Estimated sale
  price** (ask vs. real value), **Renovation upside**, **True DOM** (the relist trick),
  and **Compare** — each a real worked example with monospace numbers; then a "that's
  just the first layer" gate (Suite Potential, nearby development, underwriting sandbox),
  one CTA (*Open your terminal →*), and the `— The PureProperty terminal` sign-off.
- This is the full "terminal readout" (§11.1, Mode A₁) and the reference for every future
  feature-showcase email. Deterministic copy (no LLM), compliant (no sold prices, CASL
  footer, one-click unsubscribe, hidden preheader).

### Status line copy — `digest.ts` / `listingAlertEmail.ts`
- ✅ **Already on-voice:** *"a relist often signals a motivated seller"*,
  *"Offer accepted with conditions — it can still fall through"*. These expose insight
  a portal hides. Keep and extend this pattern.

### Registered-user digest footer — `digest.ts`
- Current: *"Manage alerts"* link, **no unsubscribe, no `List-Unsubscribe` header.**
  This is a CASL gap and a deliverability risk (see §7). Add a plain one-click
  unsubscribe in the machine footer — the anonymous email already does this right.

---

## 7. Contrarian, but within the guardrails (CRITICAL)

Overtly contrarian is the chosen edge — but it has hard limits, because we operate
under TRREB IDX/VOW agreements and Canadian anti-spam law.

**Aim the contrarian energy at the *system / the old way*, never at agents as a
category (we're becoming one) and never at a named party:**
- ✅ Fair game: "the old way," "the industry status quo," "the typical agent who buries
  the numbers," "the data most buyers never get," "shadow numbers."
- ❌ Off-limits: attacking **agents as a whole** ("agents lie," "your agent is ripping
  you off"). We are about to *be* the agent — never train leads to distrust the role we
  want them to hire. Attack the *old way*; be the *new way*.
- ❌ Off-limits: disparaging a **specific brokerage** — especially the one on the
  listing, whose name we are *required* to display respectfully and at equal weight
  (TRREB §6.3(c), CLAUDE.md §4). Never pair the brokerage line with a jab.
- ❌ Off-limits: naming a competitor (HouseSigma, Realtor.ca) disparagingly in
  user-facing copy. Imply the contrast; don't start a fight we can be sued over.
- ⚠️ **Phase 1 only:** while the founder is registered with another brokerage and
  PureProperty is not yet a registered brokerage, user-facing copy must **not solicit a
  real estate trade or claim representation** under the PureProperty name. Keep the
  frame on *data/research/insight*. Representation language unlocks in Phase 2 (§10).

**Compliance is not negotiable and outranks voice:**
- Sold/closing prices **never** appear in email — the tease links to the gated page.
- Brokerage renders on **every** row, same size as other details.
- **CASL:** every commercial email needs a working unsubscribe and a valid
  `List-Unsubscribe` header. The contrarian brand *especially* keeps the exit clean —
  a company confident in its value never traps you. Unsubscribe copy stays neutral and
  one-click: *"One click to stop these."*
- No raw IDX/VOW data through any LLM (CLAUDE.md §4). Copy is deterministic.

If contrarian voice ever collides with a compliance rule, **compliance wins** and the
line gets rewritten. Losing the API feed ends the company; a softer sentence doesn't.

---

## 8. The litmus test (run before anything ships)

1. **Would a Bloomberg user or a Zillow user find this normal?** Must be the former.
2. **Did I lead with the number or the adjective?** Must be the number.
3. **Could a competitor's brand have sent this word-for-word?** If yes, it's too
   generic — cut until it could only be us.

Plus two guardrail checks for the contrarian edge:

4. **Is the jab aimed at the system, not a named party?** (No specific brokerage or
   competitor takes the hit.)
5. **Does every commercial email have a working one-click unsubscribe?**

---

## 9. Where this gets applied first (in this voice)

- **Tier 0 — brokerage funnel (highest ROI, see §10):** instant lead-follow-up
  auto-response (speed-to-lead) + a monitored inbox with a fast human reply.
- **Tier 1 — fix active liabilities:**
  1. Ship or stop promising the anonymous `similar` (new-listing) alert — the
     confirmation currently promises an email that's never sent.
  2. Add unsubscribe + `List-Unsubscribe` to the registered-user digest (§7 CASL).
  3. ✅ Done — the **welcome** email (§6) shipped (machine-sent from `hello@`). Extend it
     into a multi-step onboarding *sequence* next — the biggest remaining activation lever.
  4. Re-capture 2–3 qualification questions at onboarding (buyer/seller, timeline,
     financing) so leads can be scored and routed (§10).

All copy above is the reference implementation for these.

---

## 10. Brokerage lead-gen alignment (the funnel this voice serves)

The terminal is the top of a funnel whose bottom is a real estate commission. The voice
above is calibrated to *earn trust through competence*; this section is the funnel it
feeds. **Phased**, because the brokerage isn't live yet.

### The four lanes a brokerage funnel needs (current state)

1. **Capture** — ✅ mostly built. The velvet rope (VOW account for sold data) is a lead
   magnet; listing email-capture and viewing requests capture intent. Keep.
2. **Speed-to-lead** — ❌ broken. Viewing requests email a personal inbox with no
   auto-reply to the lead, no SLA, no routing. In real estate, replying in ~5 min vs
   ~30 min can 4–10× conversion. **This is Tier-0.** Fix: instant machine
   auto-acknowledgement (§6 Phase-1 copy) + a monitored inbox with a fast human reply.
3. **Nurture** — ❌ missing. Real estate consideration cycles run 3–12 months; today all
   comms are event-driven (price changed → email). Add a light nurture lane that keeps
   PureProperty top-of-mind as a *research brand* now, ready to convert at launch.
4. **Qualify / route** — ❌ missing. Onboarding profiling was collapsed. Re-add 2–3
   questions (buyer vs seller, timeline, pre-approved?) to score leads and, in Phase 2,
   route them to the right agent.

### Two phases

- **Phase 1 — now (registered elsewhere, no PureProperty brokerage):**
  - Frame everything as **data / research / insight**. No representation claims, no
    soliciting trades under the PureProperty name (§7).
  - Sender for human follow-ups = **research-desk identity or real first name, no title**
    (§3).
  - Goal: **capture + nurture** a high-intent audience under the research brand.
- **Phase 2 — brokerage live:**
  - Representation language unlocks. Contrarian framing upgrades to *"most agents bury
    this — **ours lead with it**."*
  - Sender = **named, RECO-registered agent + credential** (§3).
  - Goal: **convert** the nurtured audience into clients; route by qualification.

### Audience note

The "filter out casual window-shoppers" rule is right for the *data product* but leaves
brokerage volume on the table — a casual GTA homebuyer today is a commission in six
months. Keep the velvet rope on the *data depth*, but **capture and nurture everyone**;
don't reject a lead you could have warmed up.

---

## 11. Email visual system (locked)

Email is **not** a webpage: no reliable web fonts, images blocked by default (~40% of
opens), Outlook renders with Word's engine, 60%+ of opens are mobile, and half the
audience is in dark mode. The look is *engineered*, not styled. Mockup of record:
`docs/brand/email-mockup.html` (v3).

### 11.1 Two visual modes — intensity is inversely proportional to intimacy

Both modes are provided by `emailShell.ts`:

- **Mode A — "Terminal readout"** (`shell({ preheader, headerLabel, body })`): navy header
  bar with the live-text logo + a mono `headerLabel` (e.g. `NIGHTLY BRIEF`), body, footer.
  Used by the **welcome**, the **nightly digest**, and the single-listing / address-watch
  alerts. Intensity varies *within* Mode A: the welcome is heaviest — full feature-showcase
  tiles with worked-example data — while the digest and alerts are scannable listing rows
  (thumbnail → address → `city · brokerage` → price/delta). Same shell, more or less chrome;
  the shipped digest is the reference and stays as-is.
- **Mode B — "Plain note"** (`plainNote({ preheader, body })`): near-plaintext for Tanmay's
  lead follow-up. Small light logo, a short paragraph, `— Tanmay, PureProperty`, one plain
  unsubscribe line. **No header bar, no photo, no button, no chips.** If a "personal" email
  looks designed, it reads as a bot and stops converting. This minimalism is deliberate.

Property cards / rows (§11.5) belong to Mode A; Mode B stays text.

### 11.2 Logo lockup (rebuilt as LIVE TEXT, never an image)

The mark is `‹ ` + **PURE** (700) + `PROPERTY` + `.ca`, matching `public/logo.svg` /
`src/components/Logo.tsx`. Because it is text + a simple polyline chevron, we **rebuild it
in HTML** rather than embedding a PNG — an image logo disappears for the ~40% of opens
that block images; a text logo always renders, stays crisp on retina, and adapts to dark
mode. Drop the exact `<polyline>` chevron in via inline SVG where supported, with a `‹`
glyph (`&#10094;`) fallback.
- **On dark navy header:** chevron + `PURE` = `#FFFFFF`, `PROPERTY` = `#8FA4B8`,
  `.ca` = `#6B7E92`.
- **On white (Mode B):** chevron + `PURE` = `#0A1828`, `PROPERTY` = `#4A6378`,
  `.ca` = `#6B7E92`.
- The wordmark is **sans-serif** (brand type). Do NOT set it in the monospace face —
  monospace is reserved for *data* (§11.4).

### 11.3 Design tokens

**Layout:** 600px max content, fluid to 100% on mobile. Table layout, all CSS inline.
No flexbox/grid/background-image (Outlook). Page canvas `#F8FAFC`, card `#FFFFFF`.

**Color:**

| Token | Hex | Use |
| :--- | :--- | :--- |
| navy (brand) | `#0A1828` | header bar background, dark logo ink |
| ink | `#0F172A` | primary text |
| ink-2 | `#334155` | section headers |
| secondary | `#475569` | detail lines (city · brokerage), subject line — **AA on white** |
| muted | `#64748B` | chip labels, footer, struck-out old price |
| line | `#E2E8F0` | borders, chip outlines |
| accent | `#0891B2` | CTA buttons, links, the 2px header rule |
| positive | `#0F766E` | price-down (good for buyer), new price, "Likely" |
| negative | `#DC2626` | SOLD badge, delta emphasis |
| warn | `#D97706` | sold-conditional |

> Contrast rule: body/detail text is `#475569` or darker on white. `#94A3B8` is retired
> for body copy (fails AA); it survives only in Mode B's de-emphasized unsubscribe line.

**Type scale:** H1 18px · section headers 12–13px UPPERCASE `.10em` · body 14–15px ·
meta 12px · footer 11px.

### 11.4 The signature — monospace numbers

Every price, delta, True DOM, Cap Rate, Gross Yield, and Capital Burn Rate is set in
`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`. This one rule is
what makes an email *feel* like a terminal instead of a flyer. Prose stays sans-serif;
**numbers are mono.** The stack lives in `emailShell.ts` as the exported `MONO` token, so
every renderer that composes the shell inherits it — keep new emails on the shared `MONO`
rather than re-declaring a font.

### 11.5 Property card (Mode A only)

Photo-led for engagement, data-backed for trust — the fusion is the differentiation
(§10 quality bar): the portal shows a photo; we show the photo **plus** the shadow data.
- Card: `1px #E2E8F0` border, radius 8px, overflow hidden.
- **Header photo ~184px**, `object-fit:cover`, `alt = address`, `#E2E8F0` fallback fill.
  Feed image field (confirm at build). Status badge (`PRICE ↓`, `NEW`, `SOLD`) sits in
  the body, **not overlaid** on the image (Outlook can't position reliably).
- Body: address (700), then `city · brokerage` (`#475569`, §4 brokerage always shown),
  then the **mono price/delta ticker**, then a row of **metric chips**
  (`[LABEL] / mono value`, e.g. `TRUE DOM · 62 days`, `CAP RATE · 4.1%`,
  `CAPITAL BURN · $4,200/mo`).
- **Images-off is a first-class state:** the card must be complete and attractive with no
  image — address + price + chips carry it. The photo is an enhancement, never
  load-bearing. One modest image per card; never image-only.
- **Compliance gate:** before rendering real feed photos, verify image-display +
  attribution rules in `.claude/docs/legal/idx-agreement.pdf` / `vow-agreement.pdf` and
  confirm the payload image field. Brokerage attribution stays on every card regardless.
- **Validate the lift:** photos are believed to raise engagement — A/B the digest with vs.
  without card photos and watch click-through before treating it as permanent (§10).

### 11.6 Default theme: LIGHT (canonical), dark-*aware*

Light is the default and the design/QA target — for deliverability, because property
photos read best on white, and because a clean light "research note" reads more credible
to a cold lead than a dark app UI. The dark navy header bar carries the terminal identity
without betting the email on a dark background. Set
`<meta name="color-scheme" content="light dark">` and rely on borders + semantic colors
that survive auto-inversion. We do **not** author a separate dark send.

### 11.7 Deliverability — photos don't spam you, a weak domain does

1. **Authenticate `pureproperty.ca`: SPF + DKIM + DMARC** (start DMARC `p=none` →
   `quarantine`). This is ~80% of deliverability. Gmail/Yahoo bulk rules require it.
2. **Send from a subdomain** (`send.` / `mail.pureproperty.ca`) to isolate alert-volume
   reputation from the root domain.
3. **One-click `List-Unsubscribe` (RFC 8058)** on every bulk email — required by
   Gmail/Yahoo; also a Tier-1 fix (the registered digest lacks it).
4. **Physical mailing address + sender identity in the footer** (CASL). Replace the
   `[mailing address]` placeholder before sending.
5. **Healthy text-to-image ratio** — never image-only. Host images on HTTPS with real
   `width`/`height` + alt text, compressed.
6. **Multipart** — always include the plaintext part (renderers already emit `text`).
7. **List hygiene** — opted-in only, suppress hard bounces, honor unsubscribes instantly,
   sunset non-openers after ~4–6 months. Keep complaint rate < 0.1%.
8. **Warm up + monitor** — ramp volume gradually, steady cadence, watch Google Postmaster
   Tools + Resend analytics.

### 11.8 Sender name & subject (fixes the "Support" display)

Root cause of "Support": a bare `from` address with **no display name** — Gmail falls
back to the mailbox. Always set a display name, and keep it **consistent** so recipients
recognize it.

| Email | From name | Address | Reply-to |
| :--- | :--- | :--- | :--- |
| Nightly digest / alerts | **PureProperty Alerts** | `alerts@pureproperty.ca` | unmonitored ok |
| Signup confirmation | **PureProperty Alerts** | `alerts@` | `support@` |
| Welcome / activation | **PureProperty** | `hello@` | `support@` (monitored) |
| Lead follow-up | **Tanmay at PureProperty** | `tanmay@` | `tanmay@` (monitored) |

> **Welcome is machine-sent from `hello@`, NOT Tanmay** — a once-ever activation email
> earns warmth without faking a human author (§2/§3). The Tanmay identity is reserved for
> the genuinely human lead follow-up (Mode B). `pureproperty.ca` is Resend-verified so any
> `<addr>@` From works with no per-address setup; `ALERTS_FROM_EMAIL` currently resolves to
> `support@` and keeps winning over the `alerts@` default until repointed — see §12.

**Subject lines** — ticker/fact-first; no ALL-CAPS, no `!`, no spam-trigger words. Every
email also sets a **hidden preheader** (inbox preview). Status: `emailShell.shell()` emits
the preheader, so the **welcome**, **digest**, and shell-based alerts all carry one; verify
the inline confirmation email does too.

| Email | Subject | Preheader |
| :--- | :--- | :--- |
| Digest | `2 sold · 1 price drop · 5 new listings` | the moves the old way surfaces too late |
| Single price alert | `$50,000 price drop — 12 King St W` | Sign in for the full history |
| Confirmation | `Tracking 12 King St W — price & status alerts on` | You'll only hear from us when it changes |
| Welcome | `You're in — the tools most buyers never get` | What it's really worth, what you could make it worth, and how long it's really been for sale |
| Lead follow-up | `Re: your request on 12 King St W` | the shadow numbers are on the way |

`Re:` on the follow-up reads as a personal reply (it is one) → higher opens, fits Mode B.

### 11.9 Implementation note — the shared shell exists; compose it

`src/lib/alerts/emailShell.ts` is built and is the single source of layout truth:
`shell()` (Mode A navy header), `plainNote()` (Mode B), plus `footer()`, `button()`,
`sectionHeader()`, `link()`, `money()`, `listingUrl()`, and the `MONO` token; sends route
through `sendEmail.ts`. `digest.ts`, `listingAlertEmail.ts`, `addressWatchEmail.ts`, and
the confirmation compose it; the **welcome** is a standalone flagship renderer. Rule for
every new email (Data Drop, nurture, home-value): **compose `emailShell`, never hand-roll a
new HTML string** — that is exactly how the pre-shell renderers drifted.

---

## 12. Wiring status (reconciled against `origin/main`, 2026-08-28)

> Read from **origin/main (production)**. The working tree may sit on `feat/email-comms`,
> now ~398 commits behind main, whose email files are stale — an earlier draft of this
> section mistakenly described that branch. Always verify email code against `origin/main`,
> and **re-fetch before concluding**: main moves during a working session.
>
> Deliberately no line numbers below. The 2026-08-01 pass cited them and every one has since
> drifted; name the function or the module instead.

| Surface | State | Sender | Notes |
| :--- | :--- | :--- | :--- |
| Auth / OTP | ✅ live | Supabase (machine) | code-not-link (Safe-Links would burn the token) |
| Welcome / activation | ✅ live | `hello@` (machine) | fires on first VOW-Terms acceptance; preheader + one-click unsub; standalone renderer |
| Nightly digest | ✅ live | `alerts@` | Mode A via `emailShell`; preheader; one-click unsub + `List-Unsubscribe`. Consent via `canSendAlerts` — master switch, per-stream toggle, active pause (**not** cadence; see below) |
| Onboarding drip | ✅ live | `hello@` | a milestone-gated sequence, not a lone welcome (PR #220): finish-account, add-area, dashboard education, save-a-home. Gated by `canSendOnboarding`, idempotent via `user_email_lifecycle` |
| Single-listing alert (anon) | ✅ live | `alerts@` | one-click unsub → `/api/listing-alerts/unsubscribe` (flips rows to `unsubscribed`) |
| Address-watch ("Track this address") | ✅ live | `alerts@` | `addressWatchEmail.ts` (migration 077) — a Personal-engine primitive |
| Signup confirmation | ✅ live | `alerts@`, reply-to `support@` | `confirmationEmail.ts` |
| Lead follow-up (Tanmay) | ✅ live | `tanmay@` (Mode B) | `sendLeadFollowUp` wired in `viewing-requests/route.ts` — the lead gets a reply |
| `/apply` | ✅ by design | — | sends NO email. `/apply` routes straight to OTP sign-in, so a confirmation would collide with the code arriving seconds later; the abandoned-signup nudge covers the stall case |
| Preference centre | ✅ live | — | `/account/emails` — master switch, per-stream toggles, cadence, pause 30 days. Shows only streams a sender exists for (`src/lib/email/streams.ts`) |
| Shared `emailShell.ts` + `sendEmail.ts` | ✅ built | — | shell/plainNote/footer/button/MONO — compose it for new email |
| Send subdomain (`send.`/`mail.`) | ⚠️ open | — | §11.7 — isolate marketing volume from OTP/alerts reputation. Blocks the Data Drop |

**Consent rules.** A send is allowed only when the user is not master-opted-out AND the
stream is on AND no pause covers now. Both gates live in `src/lib/email/sendPolicy.ts`:
- `canSendOnboarding` — the drip. Cadence **does** gate it; `minimal` suppresses it entirely.
- `canSendAlerts` — the digest. Cadence **does not** gate it, because both non-standard
  settings promise the digest survives ("Only the essentials — just alerts you set").
  A suppressed user still has their baselines advanced, so re-subscribing or the end of a
  pause never dumps a backlog of everything they missed.

**Unsubscribe wiring:** registered marketing/digest → `/api/email/unsubscribe` sets
`profiles.marketing_opt_out` (+ RFC 8058 one-click POST); anon listing alerts →
`/api/listing-alerts/unsubscribe` (HMAC, flips rows). Both set the `List-Unsubscribe`
headers. **Manage alerts** → `/dashboard`.

**Where the senders run:** `.github/workflows/nightly-emails.yml` — triggered by the sync
completing, with an independent 06:47 UTC cron backstop and an operator receipt on every run
(PR #428). They are no longer trailing steps of `daily-sync.yml`, where the send TIME was an
accident of how long the sync happened to take.

**Env reality:** `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` (→ `alerts@`), `VIEWING_REQUESTS_EMAIL`,
`ALERTS_UNSUBSCRIBE_SECRET` (falls back to `SUPABASE_SERVICE_ROLE_KEY`), `NEXT_PUBLIC_SITE_URL`.

**Genuine gaps (verified on main, 2026-08-28):**
- No consumer **Data Drop** / recurring newsletter — the Market engine is still greenfield,
  and it is the only stream that would reach a user with no saved listing or area. Today
  those users hear nothing at all once the drip ends around day 30.
- No **"your home's value moved"** email and no monthly neighbourhood report — the Personal
  engine proper. There is no `user_homes` table yet; the address-watch email is the nearest
  existing primitive.
- **No click measurement anywhere** — no tracking parameters, no redirect route. §0's
  "measure clicks, not opens" is unimplemented, so no copy decision here is evidenced yet.
- ~~Welcome links to `/terminal`~~ — **fixed.** The email links resolve, and
  `next.config.mjs` permanently redirects `/terminal` → `/properties` as a safety net.
