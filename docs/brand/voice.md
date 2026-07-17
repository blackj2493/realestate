# PureProperty.ca — Communication Voice & Tone Guide

> **Status:** Canonical. This governs all user-facing communication — email, in-app
> copy, notifications, onboarding, transactional and marketing messages — and every
> AI edit to that copy in this repo. If a message can't pass the litmus test at the
> bottom, it doesn't ship.

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

- **Automated mail** (digests, alerts, confirmations, operational): from
  **`PureProperty Alerts <support@pureproperty.ca>`**. **No personal signature.**
  Nobody wants a nightly "personal note" from a human. These end with the machine
  footer, not a name.
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

### Welcome email — currently MISSING
The trap is *"Welcome to PureProperty! We're so excited…"*. On-voice opens on utility
and the contrarian hook:
- ✅
  > You're in. The terminal shows three numbers the old way keeps off your screen:
  > **True DOM** (how long a property has *really* been for sale, across every
  > relisting), **Capital Burn Rate** (what it costs to hold), and **Suite Potential**
  > (hidden basement-unit upside). Save your first **market bubble** to start getting
  > them nightly →

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
  3. Add the **welcome** email (§6) — the biggest activation lever, currently absent.
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

- **Mode A — "Terminal readout"** (digests, alerts, welcome, confirmation): full system —
  brand navy header bar, sections, **property cards**, monospace numbers, CTA, footer.
- **Mode B — "Plain note"** (Tanmay's lead follow-up): near-plaintext. Small light logo,
  a short paragraph, `— Tanmay, PureProperty`, one plain unsubscribe line. **No header
  bar, no photo, no button, no chips.** If a "personal" email looks designed, it reads as
  a bot and stops converting. This minimalism is deliberate.

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
**numbers are always mono.**

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
| Welcome | **Tanmay at PureProperty** | `tanmay@` | `tanmay@` (monitored) |
| Lead follow-up | **Tanmay at PureProperty** | `tanmay@` | `tanmay@` (monitored) |

> Requires `alerts@` and `tanmay@` verified in Resend on the sending domain. Env today
> only has `support@pureproperty.ca` + a personal Gmail for leads — see §12 wiring.

**Subject lines** — ticker/fact-first; no ALL-CAPS, no `!`, no spam-trigger words. Every
email also sets a **hidden preheader** (inbox preview) — currently missing from all
renderers.

| Email | Subject | Preheader |
| :--- | :--- | :--- |
| Digest | `2 sold · 1 price drop · 5 new listings` | the moves the old way surfaces too late |
| Single price alert | `$50,000 price drop — 12 King St W` | Sign in for the full history |
| Confirmation | `Tracking 12 King St W — price & status alerts on` | You'll only hear from us when it changes |
| Welcome | `You're in — the 3 numbers the old way hides` | True DOM, Capital Burn, Suite Potential |
| Lead follow-up | `Re: your request on 12 King St W` | the shadow numbers are on the way |

`Re:` on the follow-up reads as a personal reply (it is one) → higher opens, fits Mode B.

### 11.9 Implementation note

Do **not** keep hand-building these as separate HTML strings (the current renderers are
already drifting). Extract one shared `src/lib/alerts/emailShell.ts` — logo lockup,
navy header bar, footer (address + unsubscribe), tokens, preheader helper, button, chip,
and **property-card** components — and refactor `digest.ts`, `listingAlertEmail.ts`, the
confirmation, the new welcome, and the Tanmay follow-up to compose it. The design then
lives in code, and every future email inherits it.
