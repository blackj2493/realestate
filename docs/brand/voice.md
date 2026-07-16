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

**Decisions locked with the founder (2026-07-16):**
- **Edge:** Overtly contrarian. We name the fact that the industry and consumer portals
  obscure data, and we position ourselves against it. (Guardrails in §7.)
- **Sender:** Split. Automated alerts/digests are machine-sent and unsigned. Personal
  follow-ups (lead replies) come from a **named human**.

---

## 1. Voice (constant — never changes)

Five pillars. Voice is *who we are*; it does not flex by context.

| Pillar | Means | Kill on sight |
| :--- | :--- | :--- |
| **Terse** | Say it in 8 words, not 20. Density signals respect for their time. | Throat-clearing ("We're excited to let you know that…") |
| **Numerate** | Lead with the number. The data is the sentence; prose is the caption. | Adjectives doing a number's job ("great deal", "huge drop") |
| **Precise** | Exact figures, exact terms, exact timestamps. Never round when you can be specific. | Vague hedges ("recently", "several", "around") |
| **Understated-confident** | The data flexes; we don't. No hype — hype reads as *retail*. | Exclamation marks, urgency theater, "Don't miss out!" |
| **Contrarian** | We're on the user's side against an industry that hides the numbers. State it plainly. | Ranting, conspiracy-blog energy, or disparaging a *specific* brokerage (see §7) |

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

## 3. Sender identity (locked: split model)

- **Automated mail** (digests, alerts, confirmations, operational): from
  **`PureProperty Alerts <support@pureproperty.ca>`**. **No personal signature.**
  Nobody wants a nightly "personal note" from a human. These end with the machine
  footer, not a name.
- **Personal follow-up** (a reply to a lead who raised their hand on a specific
  property): from a **named human** — e.g. `Jag at PureProperty <jag@pureproperty.ca>`,
  `replyTo` set to that human. Signed with a first name. This is the *only* place a
  name appears, which is exactly what makes it feel personal.

Rationale: users subconsciously sort machine-mail from human-mail. Honoring that split
makes the human touch land harder because it's rare.

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
- ✅ **On-voice rewrite (body):**
  > Tracking **{address}**. You'll get price cuts and status changes the day they
  > happen — the moves brokerages don't surface until it's too late to matter. Nothing
  > else.
  >
  > *(footer, not a signature)* Machine-sent by PureProperty Alerts. Unsubscribe anytime.

### Lead follow-up — currently MISSING (only the operator is emailed)
`src/app/api/viewing-requests/route.ts` notifies the operator but sends the lead
**nothing**. This is the single highest-warmth touchpoint and it doesn't exist.
- ✅ **On-voice (named human, 60% warmth):**
  > Got your request on **{address}** — I'll come back to you personally within a few
  > hours with the shadow numbers on this one: True DOM, full price history, and the
  > Capital Burn Rate a listing agent won't volunteer.
  >
  > — Jag, PureProperty

### Welcome email — currently MISSING
The trap is *"Welcome to PureProperty! We're so excited…"*. On-voice opens on utility
and the contrarian hook:
- ✅
  > You're in. The terminal shows three numbers the industry works to keep off your
  > screen: **True DOM** (how long a property has *really* been for sale, across every
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

**Aim the contrarian energy at the *system*, never at a person or a named party:**
- ✅ Fair game: "the industry," "consumer portals," "the data brokerages don't surface,"
  "shadow numbers," "what a listing agent won't volunteer."
- ❌ Off-limits: disparaging a **specific brokerage** — especially the one on the
  listing, whose name we are *required* to display respectfully and at equal weight
  (TRREB §6.3(c), CLAUDE.md §4). Never pair the brokerage line with a jab.
- ❌ Off-limits: naming a competitor (HouseSigma, Realtor.ca) disparagingly in
  user-facing copy. Imply the contrast; don't start a fight we can be sued over.

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

## 9. Where this gets applied first (Tier-1 fixes, in this voice)

1. Ship or stop promising the anonymous `similar` (new-listing) alert — right now the
   confirmation promises an email that's never sent.
2. Add unsubscribe + `List-Unsubscribe` to the registered-user digest (§7 CASL).
3. Add the **lead follow-up** auto-acknowledgement (§6) — named human, the shadow-data promise.
4. Add the **welcome** email (§6) — the biggest activation lever, currently absent.

All copy above is the reference implementation for these.
