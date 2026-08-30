# The Weekly Data Drop — build plan and strategy

Status: **BUILT** on `feat/weekly-data-drop` (Units 2-10). Unit 1 (DNS) is an owner task.
Nothing is scheduled to real users yet — the workflow exists but has never run unattended.
Date: 2026-08-28
Owner: Tanmay
Scope: engagement plan WS2 (`email_prefs.data_drop`, named in migration 106).

---

## 0. Why this one first

Three engines drive retention: Personal (your homes), Search (your areas), Market (the
whole board). The first two only reach a user who has **already saved something**. The
audit on 2026-08-28 found the consequence: after roughly day 30, a user with no saved
asset receives **zero email, forever**.

The Data Drop is the only asset with a region-wide fallback, so it needs nothing from the
user to work. It therefore reaches **100% of the base**, including everyone the other two
engines cannot touch.

It is also the cheapest asset we can ship. Every figure it needs is **already recomputed
nightly** for the public `/data` trackers, and the board modules that read that precompute
are already written, already cached, and already carry the compliance posture we need.

| Component | Exists today | Path |
| :--- | :--- | :--- |
| The numbers | yes, nightly | `region_metrics` (mig 081) → `src/lib/data/marketBoard.ts` |
| Worker-safe reader | yes | `computeMarketBoardUncached()` — built for exactly this |
| Week-over-week history | yes, 400 days | `metric_snapshots` (mig 090) |
| Over-ask / rents / fees | yes, nightly | `competitionBoard.ts`, `rentBoard.ts`, `condoFeeBoard.ts` |
| The email shell | yes | `src/lib/alerts/emailShell.ts` — `shell()`, `footer()`, `button()` |
| Observable send path | yes | `sendTransactionalEmail()` + `email_send_failures` (mig 098) |
| One-click unsubscribe | yes | `marketingUnsubscribeUrl()` (RFC 8058) |
| Idempotency store | yes | `user_email_lifecycle` (mig 105) |
| The preference column | yes | `email_prefs.data_drop` (mig 106), default TRUE |
| The preference toggle | yes, on `origin/main` | `EmailPrefsClient.tsx` — "Weekly market update" |
| **The sender** | NO | no send subdomain — voice.md §12 marks it open |
| **The payload builder** | NO | — |
| **The renderer** | NO | — |
| **The workflow** | NO | — |

Ten of the fourteen parts are already built. We are wiring, not inventing.

---

## 1. The toggle, and PR #430

`EmailPrefsClient.tsx` renders the weekly-update toggle on `origin/main` today, wired to
`email_prefs.data_drop` through `/api/email-prefs`. It is missing only from
`feat/email-comms`, which forked 2026-07-15 and sits 399 commits behind — so on main it
needed no work at all.

**That changed while this was being built.** PR **#430** ("honour the preference centre, and
stop offering streams that don't send") moves the stream catalogue into
`src/lib/email/streams.ts` and enforces one invariant with a test: *a stream is offered if
and only if `sender` names the code that sends it.* Because nothing sent the weekly,
`data_drop` is marked `sender: null` there and **hidden from the preference centre**.

#430 is right to hide it — a switch that does nothing in either position costs more trust
than a short page saves — and its own body names the remedy: "a one-line change on the day
its sender ships." This branch is that day.

> **ORDERING.** #430 should merge first; it is Step 0 of the same phase and this branch
> depends on nothing in it. Then, in `src/lib/email/streams.ts`:
>
> ```diff
>   key: "data_drop",
>   title: "Weekly market update",
>   desc: "One email a week on what's moving in the markets you follow.",
> - sender: null, // WS2 — the weekly Data Drop
> + sender: "scripts/worker/dataDrop.ts",
> ```
>
> `streams.test.ts` already enforces the invariant, so nothing else is needed. Both branches
> also append to `sendPolicy.ts` (#430 adds `canSendAlerts`, this adds `canSendDataDrop`),
> which is a textual conflict at the end of one file and nothing more.

Do NOT rebuild the toggle component. A second implementation is the failure the glossary
routes already carry.

## 2. What it must do for the reader

A weekly market email fails in one predictable way: it becomes a newsletter of levels.
"Toronto median price $1,043,000, down 2.1%" is a fact the reader cannot act on and can
read anywhere. It earns one open and then trains the reader to ignore the sender.

Every send must pass three tests. Call it **the drop test**.

1. **Is it about a place they chose?** Not "the GTA". Milton, because they saved Milton.
2. **Is it a change, not a level?** A level is trivia. A change is news.
   `$1.04M` tells you nothing. `34% of Milton sellers have cut their price, up from 27%
   four weeks ago` is a negotiating position.
3. **Does it name the consequence?** "That is one seller in three who has already blinked."

If a week's payload fails any test for a recipient, fall back a level. If the fallback
also fails, **skip that recipient**. A skipped week costs nothing. A weak week costs the
open rate of the next twelve.

### The value, stated per reader

| Reader | The line that earns the click |
| :--- | :--- |
| Buyer | "Milton homes now sit 9 days longer than a month ago, and a third of active listings have cut their price." → you have leverage |
| Seller | "58% of Milton sales closed above asking last month, down from 66%." → reset your price expectation |
| Investor | "A 3-bed Milton house rents for $3,400. Against the median price that is a 4.1% gross yield — the yearly return if you rented it out." |

The email's job is not to inform. Its job is to **return the reader to the map with a
reason**. One number they cannot get elsewhere, then one link.

### Why our numbers are worth reading

The boards already carry cuts nobody else publishes at our grain: relist-adjusted True
Days on Market, the share of **individual** sales beating **their own** ask (not
median-vs-median), closed MLS® lease rents province-wide, and the annualized condo fee
trend.

**Never claim novelty.** `src/lib/data/trackers.ts` carries the prior-art gate and the
reason for it: we shipped two false novelty claims in production on 2026-08-14 and had to
correct both. State the DIFFERENCE — statistic, coverage, cadence, source — and name who
else measures it. In an email that reaches the whole base every week, one "the only source
that…" line is a permanent credibility liability.

---

## 3. What it looks like

Fixed skeleton, rotating lead. The reader learns the shape in two weeks and scans it in
six seconds. The headline changes; the three rows never move.

```
From:    PureProperty Data <data@send.pureproperty.ca>
Subject: Milton: a third of sellers have now cut their price
Preview: Up from 27% four weeks ago — and homes are sitting 9 days longer.

+-- PUREPROPERTY.ca ------------------- WEEKLY DATA DROP --+
|                                                          |
|  MILTON . WEEK OF AUGUST 28                              |
|                                                          |
|  34%                                                     |
|  of active Milton listings have cut their asking price.  |
|  Four weeks ago it was 27%. That is one seller in three  |
|  who has already moved first.                            |
|                                                          |
|  -- THE REST OF THE PICTURE ---------------------------  |
|                                                          |
|  Sold above asking     52%      down 6 points vs last yr |
|  Typical price cut     $41,000  median, among those cut  |
|  Days to sell          41       up from 32 a month ago   |
|                                                          |
|  Check the tables: Price cuts . Days on market .         |
|  Sold over asking                                        |
|                                                          |
|            [ See Milton on the map -> ]                  |
|                                                          |
|  Also in your markets: Oakville 24% . Burlington 29%     |
|                                                          |
|  Aggregates only. Data as of Aug 27.                     |
|  Manage emails . Unsubscribe                             |
|  Data is deemed reliable but not guaranteed accurate.    |
|  Powered by PROPTX MLS(R).                               |
|  PureProperty . 268 America Ave, Vaughan, ON L6A 3G7     |
+----------------------------------------------------------+
```

Compose Mode A (`emailShell.shell()`) — the navy header and accent rule. Do not author a
new visual system; voice.md §11.9 already says to compose the existing one.

**One market in depth, never two.** Depth is what the terminal is for. Other saved markets
get one number each, four maximum, on one line.

**Link the public tables under the three rows.** Small, muted, one line. It is a **trust
device before it is a link**: a reader who doubts "34%" can open `/data/price-cuts` and see
every neighbourhood behind it. `snapshotPublicData.ts` already applies exactly this
discipline to press angles — each figure carries the `/data` URL a human can verify it
against — and the same rule should govern the widest send we make. It also puts three
public backlinks in an email that gets forwarded, which the terminal CTA never can. Keep it
small: the button stays the one call to action.

**Never drop the noun from a comparison.** "41 days to sell — 9 longer" is elliptical and
reads as broken. Write the comparison as a pair of values instead: **"41 days to sell, up
from 32."** That is grammatical, it states the change rather than a bare delta, and it
gives the reader both numbers in the same space. Apply it to every rank in §4.

**Plain language (voice.md §5.1).** Explain Gross Yield and Cap Rate the first time. Leave
True Days on Market and "your saved area" alone — glossing self-explanatory terms reads as
condescending.

---

## 4. Choosing the headline

The headline is the **biggest move**, not the biggest number. A deterministic ladder picks
it; the first rank that clears its threshold wins. No LLM touches this — CLAUDE.md forbids
passing feed data through one, and a deterministic ladder is also testable.

The ladder is ordered by **consequence to a decision**, not by magnitude.

| # | Kind | Source | Fires when | Reads as |
| :-- | :--- | :--- | :--- | :--- |
| 1 | `over_ask_flip` | `competitionBoard.pctOverAsk` | crosses 50% either way | "More than half of Milton homes now sell above asking." |
| 2 | `leverage` | `cutSharePct` delta 28d | 4 points or more | "34% have cut their price — up from 27% a month ago." |
| 3 | `speed` | `trueDom` delta 28d | 20% or more | "Homes now take 41 days to sell, up from 32 a month ago." |
| 4 | `supply` | `monthsOfSupply` band cross | `temperature` changes | "Milton has flipped to a buyer's market." |
| 5 | `bidding` | `yoyOverAskPts` | 8 points or more | "Sales over asking are down 11 points from last year." |
| 6 | `rent` | `rentBoard.yoyPct` | 6% or more | "3-bed rents are up 7% in a year, to $3,400." |
| 7 | `price` | `medianPrice` / `yoyPct` | always | "The typical Milton home sold for $1.04M, down 2.1%." |

Rank 7 always resolves where the market has data, so a headline is nearly always
available. Ranks 1 to 6 are what make it worth opening.

**Deltas are free.** `metric_snapshots` (migration 090) already stores one row per
(day, region, metric) with 400-day retention, written nightly by `dataHealthCheck.ts`.
Available metrics: `medianPrice`, `avgPrice`, `activeCount`, `monthsOfSupply`,
`soldToListPct`, `trueDom`, `soldMedianDom`, `cutSharePct`, `sellThroughPct`,
`latestMonthKey`. **No new table is needed.**

Two guards on the ladder:

- **Sample floor `MIN_SAMPLE_N = 5`** — the same floor the public content factory uses
  (`snapshotPublicData.ts`). Below it, the rank is skipped, never guessed.
- **Month rollover** — `medianPrice` and `soldToListPct` describe the latest month and are
  genuinely volatile in its first days. Compare them only when `latestMonthKey` is
  unchanged, exactly as `checkDrift` already does.

**Rotation.** If one kind wins three weeks running, demote it a rank so the email does not
read identically every week. The kind is recoverable from the idempotency key — see §6.

---

## 5. Scoping to the reader

`dashboard_prefs.config.regions` is an array of Typesense `City` values. `BOARD_MARKETS` is
`citiesFromRegions(Object.keys(REGION_TO_CITIES))` — the same 15 municipalities. The
intersection **is** the recipient's market set. No polygon maths, no geocoding.

Do not use `market_bubbles`: those are drawn polygons, not named markets, and they belong
to the nightly alerts digest.

```
regions = dashboard_prefs.config.regions  intersect  BOARD_MARKETS
primary = the market with the highest-ranked headline
others  = up to 4 more, one number each

if regions is empty  -> province-wide payload   (70.6% of the base — see §11)
```

The province payload already exists: `competitionBoard.ts` and `rentBoard.ts` both write a
reserved `Ontario` rollup.

### The province-wide send is the primary product, and its job is conversion

Calling it a "fallback" was wrong. 305 of 432 users have saved no market, so it is seven
sends in ten. **Build it first, and judge it on one number: how many readers pick a market.**

A province-wide figure is abstract, and abstraction does not convert. So the structure is
**news, tension, ask** — and nothing sits between the tension and the ask:

1. **The news.** The province headline, chosen by the same ladder.
2. **The tension.** State that the average hides their city, price the claim with the real
   spread from the board, and **end on an instruction**: *"That 47% runs from 23% in Ottawa
   to 71% in Whitby — a 48-point spread. Pick your city below to see its own numbers."*
3. **The ask.** A chip per covered market, one tap each (Unit 10). Not a generic "Save a
   market" link — the friction is **choosing**, not clicking, so the email does the choosing.

**Two copy rules this section is built on.**

*End the tension on an instruction, not a riddle.* An earlier draft closed with "One of
those is your market. This email cannot tell you which one until you pick it." It is coy, it
makes the product sound withholding, and it asks the reader to infer the action. Say what to
do.

*Put nothing between the tension and the ask.* A "what this looks like for one city"
specimen was drafted here — a quoted Milton lead under "if you followed Milton, this week's
email would have opened with…". Cut it. It re-explained a value proposition the reader had
just been shown, pushed the chips below a second scroll, and gave the most prominent block
on the page to a city nobody asked about. The spread line already proves the point in one
sentence.

**The picker is not the missing piece.** `FirstRunRegionPicker` already shows on the
dashboard for anyone with no saved region, and `AcceptTermsForm` offers the same list at
signup. Both ship today, and 305 users still have no market. What is missing is **reach** —
these readers stopped opening the dashboard. That is the whole argument for putting the
chips inside the message instead of behind another link to a page they are not visiting.

---

## 6. The build

Ten units. Two are owner tasks, not code.

### Unit 0 — Branch (owner, blocking)
Cut a fresh branch from `origin/main`. Land `feat/email-comms` separately. See §1.

### Unit 1 — Send subdomain (owner, DNS; blocks the first real send only)
Add `send.pureproperty.ca` as a Resend domain. Publish its DKIM CNAMEs and SPF TXT.
Leave `_dmarc.pureproperty.ca` at `p=none` and **do not** add `sp=reject` until the
subdomain verifies — subdomains inherit the parent policy.

Rationale (voice.md §11.7 item 2): recurring marketing volume must not ride the reputation
that delivers sign-in codes. A spam complaint on a weekly digest must never cost a user
their one-time password.

### Unit 2 — `SENDERS.dataDrop`
```ts
dataDrop: { from: "PureProperty Data <data@send.pureproperty.ca>" }
```
**Literal. No env fallback.** `ALERTS_FROM_EMAIL` currently resolves to `support@` and
wins over every default that reads it. If the Data Drop reads that variable, the editorial
sender silently reverts to `support@` and nobody notices. Add the row to voice.md §11.8.

### Unit 3 — `canSendDataDrop` in `src/lib/email/sendPolicy.ts`
Mirror `canSendOnboarding`. Allow only when **all** hold:
- not `profiles.marketing_opt_out` (master switch),
- `email_prefs.data_drop !== false`,
- no active `email_prefs.pause_until`,
- `cadence !== 'minimal'` (`'reduced'` still permits one weekly — this **is** the weekly),
- this ISO week not already sent.

Unit-test it. `scripts/worker/alerts.ts` ignores `email_prefs` today; do not repeat that.

### Unit 4 — `src/lib/dataDrop/payload.ts` (the core)
Pure and testable. Input: board rows, snapshot deltas, the recipient's regions, a week id.
Output: `{ region, headline: {kind, value, sentence}, rows: [3], cta, others, dataAsOf }`
or `null`.

> **Hard rule for the file header:** this module may read the board modules and
> `metric_snapshots` and **nothing else**. It must never query Typesense or `raw_vow_sold`
> directly. Every board carries "Aggregate statistics only — no listing rows, ever", so
> reading only boards makes the email compliant by construction and keeps it from
> restating a figure the site computes differently (the #250 failure).

### Unit 5 — `src/lib/alerts/dataDropEmail.ts`
Compose `shell()` + `footer()` + `button()`. Emit HTML **and** text (§11.7 item 6). Add a
case to the existing `scripts/admin/renderEmailPreviews.ts` so the render is reviewable
without sending.

### Unit 6 — `scripts/worker/dataDrop.ts`
Page `profiles` at 1000, same as the alerts and onboarding workers. Support `--dry`.

Idempotency key: **`data_drop:<ISO-week>:<kind>`**, for example
`data_drop:2026-W36:leverage`. Putting the kind in the key makes the last kind readable for
the rotation guard in §4 with no schema change. **Match on the week prefix, not the exact
key**, or a retry whose underlying data shifted would re-send that week. Stamp only after
Resend confirms, exactly as the onboarding worker does.

### Unit 7 — `.github/workflows/weekly-data-drop.yml`
```yaml
on:
  schedule:
    - cron: '40 11 * * 4'   # Thursday 07:40 EDT / 06:40 EST. :40 — GitHub defers :00 hardest.
  workflow_dispatch:
concurrency: { group: weekly-data-drop, cancel-in-progress: false }
```

**No `workflow_run` trigger.** The instruction is correct and load-bearing: a marketing
send must not ride the data pipeline. Chaining it would put the send time at the mercy of
sync duration — the exact bug `nightly-emails.yml` was split out to fix — and would
silently cancel the week whenever the sync went red.

Thursday is the right day. It clears Monday's inbox competition, avoids Friday's dead zone,
gives the reader two days of runway before Saturday showings, and does not collide with
`monthly-market-brief.yml` on the 3rd to 5th.

Then **register it in `schedule-watchdog.yml`**:
```js
{ file: 'weekly-data-drop.yml', label: 'Weekly Data Drop',
  maxAgeHours: 192, cronMinutesUtc: [11 * 60 + 40], maxDelayHours: 6 }
```
GitHub dropped a cron outright on 2026-08-28. On a weekly job that is a whole missing week,
and the LATE check is the only thing that sees it.

### Unit 8 — Preference toggle
Now a real one-line change rather than a no-op, because of #430 — see §1 for the diff.
Confirm the sender honours it (Unit 3), which `canSendDataDrop` tests cover.

### Unit 9 — Warm-up ramp
See §7.

### Unit 10 — One-tap market follow (the conversion mechanic for 70.6% of sends)

`GET /api/email/follow-market?e=<email>&s=<hmac>&city=<City>`

Verify the HMAC with the existing scheme in `src/lib/alerts/unsubscribe.ts`
(`signUnsubscribe` / `verifyUnsubscribe`) — no new secret, no new token column. Then resolve
the user by email, add the city to `dashboard_prefs.config.regions` (dedupe, respect the
cap), write an `activation_events` row of kind `save_area` with
`context: { city, source: 'data_drop' }`, and redirect to `/dashboard?followed=<City>` with a
visible confirmation and an undo.

**Validate `city` by membership in the curated list, never by pattern.** Region labels are
free text and must not be regex-validated; membership in the offered set is the correct
check and is strict enough.

**The offered set is `BOARD_MARKETS` — all 15, generated, never hand-listed.**

The set a reader may pick must be exactly the set the weekly can cover, or the chip makes a
promise the next send breaks. `QUICK_PICK_MARKETS` (`src/lib/dashboard/area.ts:148`) has 11
entries and `BOARD_MARKETS` has 15, and **they are not nested in either direction**:

- **London** is a quick pick with **no board row**. Tap it and next Thursday returns the
  province-wide email — the promise broken on first contact.
- **Milton, Oshawa, Whitby, Ajax and Pickering** are covered by the board and are **not**
  quick picks. Omitting them makes the offer look smaller than it is, which is the fault the
  first draft of the chip row had.

So drive the chips off `BOARD_MARKETS` and use `QUICK_PICK_MARKETS` only for the camera
where one exists. A new board market then lights up its own chip with no copy change.

Say the limit out loud rather than hiding it. Under the chips: *"Don't see yours? Reply and
tell us — we add markets as the data covers them."* That is honest about the 15, and it
generates replies, which Gmail weighs as a strong positive signal.

**On a GET that mutates state.** Email scanners and link prefetchers can fire it. That is
acceptable here and it is not the same call as unsubscribe: RFC 8058 mandates POST because
unsubscribing is destructive and irreversible from the sender's side, whereas adding a saved
market is additive, idempotent, low-harm, and undone in one click on the landing page. Keep
all four of those properties true and the GET stays correct.

---

## 7. Deliverability — the part the spec does not cover

A brand-new subdomain has **no reputation**. Sending week 1 to 100% of the base from a cold
`send.` is the standard way to land in Promotions and stay there.

**Revised 2026-08-28 against the real list size (§11).** The reachable base is **419**, not
thousands. That changes the ramp twice over. First, four weeks is too long: 419 addresses is
below the volume any filter treats as a bulk ramp, so the warm-up is nearly a non-issue.
Second, the original ramp sorted by "opened an email in 30 days" — a signal that **does not
exist yet**, because no marketing send has ever gone out. Sort by payload quality instead.

**The render check is a task, not a ramp week.** It does not wait for a Thursday and it does
not consume a warm-up step. As soon as Unit 5 renders, run the worker by hand against a seed
list — the owner's address plus one each on Gmail, Outlook/Hotmail and Apple/iCloud — and
read it on a phone and a desktop in each. Send it as many times as it takes.

It can also run **before the send subdomain exists**: `pureproperty.ca` is already
Resend-verified, so the test send goes out from the root domain and only the `From` changes
when Unit 1 lands. Nothing about the render depends on the subdomain.

That leaves a two-step ramp:

| Week | Audience | Size | Purpose |
| :--- | :--- | ---: | :--- |
| 1 | Everyone with a saved market | 127 | They get the personalised payload — best first impression, and the most engaged cohort we can identify |
| 2+ | Everyone else not opted out | ~292 | Province-wide payload; full base |

At this size the binding constraint is **complaint rate, not volume**. One complaint against
419 recipients is 0.24%, already past the 0.1% guidance. So the "why you are getting this"
line and a prominent unsubscribe matter more here than any warm-up curve would.

Also from §11.7, build these in at the start rather than later:
- **Sunset non-openers after about 20 sends** (4 to 6 months of a weekly). Do not discover
  this after a year of mailing a void.
- Keep the complaint rate under 0.1%. Watch Google Postmaster Tools and Resend analytics.
- Never image-only. Never ALL-CAPS or `!` in the subject.

---

## 8. How it fails, and the guard for each

Drawn from this repository's own incidents.

| Failure | What it looks like | Guard |
| :--- | :--- | :--- |
| **Frozen precompute** | The drop restates a stale number weekly. Nothing errors. | Hard-fail the run when `dataAsOf` is older than 48h. Send nothing. |
| **Null headline** | A market with no data ships a dash, or a literal `0`. | Builder returns `null`; worker skips and counts. Turn the run red when skips exceed 20%. |
| **Dropped cron** | A whole week silently missing. | Register in `schedule-watchdog.yml` (Unit 7). |
| **Double send** | A re-run or manual dispatch mails the week twice. | Week-prefix idempotency key, stamped only after Resend confirms. |
| **Sender hijack** | `ALERTS_FROM_EMAIL` reverts the editorial sender to `support@`. | `SENDERS.dataDrop` is a literal (Unit 2). |
| **Preference ignored** | A user who turned the weekly off still gets it. | `canSendDataDrop`, unit-tested (Unit 3). |
| **Two answers to one question** | The email says 41 days, the site says 38. | Read the board modules. Never re-derive. |
| **Novelty claim** | "The only source that publishes…" | The prior-art gate in `trackers.ts` applies to email too. |

---

## 9. What to measure

The point is a return visit, not an open.

| Metric | Target by week 8 | Read it as |
| :--- | :--- | :--- |
| Delivered / sent | above 99% | The subdomain is healthy |
| Open rate | above 35% | The subject earns the open |
| **Click to terminal** | **above 8%** | **The number earned a return visit — the real KPI** |
| Unsubscribe per send | below 0.3% | Cadence is tolerable |
| Complaints | below 0.1% | Gmail/Yahoo bulk requirement |
| Recipients skipped | below 5% | The payload builder finds a headline |
| Headline kind spread | no kind above 40% | The ladder is not stuck on rank 7 |

That last row is the honest self-check. If rank 7 (`price`) wins most weeks, the email has
degraded into the newsletter of levels that §2 exists to prevent.

---

## 10. Order of work

```
Task 0  branch off origin/main                      (owner, blocking, ~1h)
  |
  +-- Task 1  send subdomain + DNS                  (owner, ~30m + propagation)
  |
  +-- Task 2  SENDERS.dataDrop + voice.md 11.8      (~30m)
        |
        +-- Task 3  canSendDataDrop + tests         (~2h)
        |
        +-- Task 4  payload builder + tests         (~1d)  <- the real work
              |
              +-- Task 5  renderer + preview        (~4h)
                    |
                    +-- Task 6  worker + --dry      (~4h)
                    |     |
                    |     +-- TEST SEND to seed addresses  <- do this immediately,
                    |         (root domain; no subdomain needed)   not on a Thursday
                    |
                    +-- Task 10 follow-market route (~3h)  <- gates 70.6% of sends
                          |
                          +-- Task 7  workflow + watchdog  (~2h)
                                |
                                +-- Task 8  toggle verified (~30m)
                                +-- Task 9  ramp week 1 = the 127 (see 7)
```

Tasks 3 and 4 are independent and can run together. Task 1 blocks only the first real send,
so it does not gate the code.

**Roughly 3 engineering days plus DNS** — 2.5 for the send itself, plus Unit 10, which
gates 70.6% of every send. Ten of the fourteen parts already existed.

---

## 11. Open questions

### Resolved — no longer open

**The terminal deep link works with a plain `?city=`.** `src/app/properties/page.tsx:238`
reads `searchParams.get("city") || searchParams.get("search")` and calls
`setLocation(cityParam)`, seeded once per distinct value at module scope so a remount
cannot replay it. `?lens=<persona>` additionally opens the map in a chosen persona, and
`?lat=&lng=&z=` is the center deep link the address profile already uses.

So the CTA is `https://www.pureproperty.ca/properties?city=Milton` — a real supported
parameter, not a placeholder. The camera-restore behaviour in #380 governs an arrival with
NO parameters; an explicit `?city=` seeds ahead of it.

### A gap in the plan, not a question — ranks 1 and 6 have no history

`snapshotFromRows` writes exactly ten metrics to `metric_snapshots`: `medianPrice`,
`avgPrice`, `activeCount`, `monthsOfSupply`, `soldToListPct`, `trueDom`, `soldMedianDom`,
`cutSharePct`, `sellThroughPct`, `latestMonthKey`.

`pctOverAsk` and the rent medians are **not among them**. So rank 1 as §4 specifies it —
"`pctOverAsk` crosses 50% either way" — has no prior value to cross against, and rank 6 has
no 28-day comparison either. Ranks 2, 3 and 4 work today; ranks 1 and 6 do not.

Two fixes, and they are not equivalent:

- **(a) Add `pctOverAsk` and the headline rent band to `snapshotFromRows`.** One-line
  change each, and storing a metric without a `DRIFT_RULES` entry is already supported —
  it is stored but not drift-checked. **Cost: the ladder cannot use them for 28 days**,
  because the history has to accumulate first.
- **(b) Redefine ranks 1 and 6 against the year-over-year figures the boards already
  carry** — `competitionBoard.yoyOverAskPts` and `rentBoard.yoyPct`. Works on day one, but
  a year-over-year crossing is a weaker claim than a four-week one.

**Recommendation: do both.** Ship on (b) so the ladder is complete at launch, add (a) in
the same PR so the stronger four-week comparison switches on automatically a month later.

### Decided — recommended answers, overrule any of them

**1. Sender: `PureProperty Data <data@send.pureproperty.ca>`, reply-to `support@`.**

Use `send.`, not `news.` or `mail.`. voice.md §11.7 already names `send.`/`mail.`, so this
costs no doc churn; `mail.` collides with inbound-mail conventions (some orgs point it at a
webmail host); `news.` narrows the subdomain to newsletters, when the monthly home report
and product news should share this same reputation pool. The subdomain is nearly invisible
to readers — Gmail shows the display name — so its job is reputation isolation, not
branding. Pick the generic bulk pool and put one local part per stream on it.

`data@` over the alternatives: `hello@` already exists on the root domain as the welcome
sender, and two different `hello@` addresses is an operator trap. `markets@` blocks reuse,
since the monthly home-value report is not a market email. `data@` matches both the product
surface (`/data`) and the email's name.

**Set a reply-to, do not send this unmonitored.** A weekly market email draws real replies
("what about Guelph?"). Replies are among the strongest positive signals Gmail weighs, and
they are the best engagement data we can get. Verify `support@` actually receives first —
`alerts@` has no mailbox, so do not assume its neighbours do.

**2. Dormancy: two gates, not one boolean.**

```
terms_accepted_at IS NULL                      -> public tracker   (hard gate)
no activation_events row in 60 days            -> public tracker   (soft gate)
otherwise                                      -> terminal
```

The hard gate is not a heuristic: the terminal is VOW-gated, so for a user who never
accepted terms the map link IS a login wall. Send them somewhere readable.

Use `activation_events` for the soft gate, not `dashboard_prefs.config.lastVisitAt`. That
field is client-written into a jsonb blob with last-writer-wins across devices, and it only
records dashboard visits — a terminal-only user reads as dormant. `activation_events`
(migration 104) is server-written at each action's write point, service-role, indexed on
`(user_id, kind)` and `occurred_at DESC`, and is already the drip's source of truth. Resend
click data is not in our database and needs a webhook we do not have.

Known limit: `activation_events` logs milestones, not page views, so a user who browses
weekly but never saves anything reads as dormant. **For this decision that is correct** —
someone who has never saved anything is exactly who the public tracker serves better.

**3. `cadence: 'reduced'` DOES receive the Data Drop. `minimal` does not.**

The label the user chose reads "At most one non-urgent email a week." Excluding the Data
Drop would silently redefine `reduced` as "no weekly digest at all", which is not what they
agreed to — and `data_drop` already has its own off switch for anyone who wants exactly
that. `minimal` reads "Just alerts you set and account messages", so it is excluded.

Caveat to log as a follow-up: under `reduced`, a single week can still produce both the
nightly alerts digest and the Data Drop, which breaks the one-email promise. `sendPolicy.ts`
already defers cross-stream collision to a Phase-1 refinement. When that lands, the Data
Drop should be the priority weekly send and the alerts digest should yield for that week.

**4. Send hour: `40 11 * * 4` — Thursday 07:40 EDT / 06:40 EST.**

Changed from the `23 11` in §6; use this. Email sorts newest-first, so landing at 06:00
buries the send under three hours of overnight mail by the time anyone looks. GitHub defers
`schedule` by 20–45 minutes routinely, so an 11:40 UTC cron realistically lands
**07:40–08:25 EDT** — near the top of the inbox as the workday starts. That band is the
target; the cron minute is only how we aim at it. `:40` keeps it off `:00`, the most
contended minute (see the WHY block in `daily-sync.yml`).

Accept the DST drift. Cron is UTC, so the send shifts an hour twice a year. Both resulting
times are reasonable, and the alternative — two crons gated on month — is more moving parts
than one hour is worth for an Ontario-only audience.

**5. Ramp week 1: team only.**

It costs nothing. The ramp needs four weeks regardless, so team-only IS week 1, not an extra
week bolted on.

It is not redundant with `renderEmailPreviews.ts` or `--dry`, because a preview render is
not a real client. The faults that appear only in a real inbox are Outlook's Word rendering
engine on tables, Gmail's mobile clip at ~102KB, and dark-mode auto-inversion — which §11.6
explicitly relies on surviving. A cold subdomain's first send should also be tiny and go to
addresses guaranteed to open it. That is exactly the team.

### Measured against production, 2026-08-28

| Reading | Value | What it means |
| :--- | ---: | :--- |
| `profiles` | 432 | |
| `marketing_opt_out = true` | 13 | 3.0% |
| **Reachable base** | **419** | Ramp is 3 weeks, not 4 — see §7 |
| VOW terms accepted | 396 | 91.7%; the other 36 hit the hard CTA gate |
| `dashboard_prefs` rows | 177 | |
| **With ≥1 saved market** | **127** | 29.4% of the base |
| **Province-wide fallback** | **305** | **70.6% — the majority path** |
| `email_prefs` rows | 1 | with `data_drop = false` |
| `cadence` reduced / minimal | 0 / 0 | decision 3 is moot in practice today |
| `activation_events` | 555 | all inside 30 days |
| `metric_snapshots` span | Jul 20 → Aug 27 | **39 consecutive days, zero gaps** |
| `region_metrics` | 15 rows, 3h old | 48h freshness gate PASSES |

**Q7 is answered: not blocking.** `metric_snapshots` has 39 unbroken days. The 28-day
comparison ranks 2 and 3 depend on works today. (A first pass reported 7 days in 35 and
called it an alarm — that was a measurement fault, not a data fault: the query hit
PostgREST's 1000-row cap at ~6.7 days of 150 rows/day. Query one metric at a time when
counting snapshot days.)

**The finding that reorders the build: the fallback is the majority path.**
305 of 432 users have saved no market, so 70.6% of every send is the province-wide payload.
§5 treats that as a fallback and §3 mocks it as variant B. It is neither — it is **the
primary email**, and the personalised version is the minority case. Two consequences:

1. Build and polish the province-wide payload **first**, not last. It carries 7 sends in 10.
2. The "Save a market" nudge inside it is the highest-leverage CTA in the whole program. It
   is the only thing that moves someone from the 305 into the 127.

**Two smaller readings worth acting on.**
`activation_events` holds 555 rows and every one is inside 30 days, because the table only
started on 2026-08-03. The 60-day dormancy window in decision 2 therefore cannot
discriminate yet — it has ~25 days of history to work with. Keep the rule; the cost of a
false "dormant" is only a different CTA target, which is the safe direction.

The single `email_prefs` row has `data_drop = false`. If that is the owner's own test
account, the week-1 team send will silently skip it. Check before blaming the sender.

### Unrelated finding — the data-health canary is red, and has been since 2026-08-16

`gh run list --workflow=data-health.yml` shows 12 consecutive failures. The cause is not
schedule drift and not the snapshot write — both are healthy. The job writes
`metric_snapshots` successfully and then exits 1 on two pre-existing problems:

```
❌ [migrations] 093_reddit_opportunities.sql is not recorded as applied
⚠️  [unpriceable-values] statement timeout — is migration 113 applied?
```

Migration 093 is the known-pending Reddit monitor work. Nothing here blocks the Data Drop.
But a canary that has been red for twelve straight days is a canary nobody reads, and the
next real problem will land inside that noise. Worth clearing on its own account.

```
! npx tsx -e "import 'dotenv/config';import{getServiceRoleClient}from'./src/lib/supabase/client';const sb=getServiceRoleClient();(async()=>{const a=await sb.from('profiles').select('id',{count:'exact',head:true});const b=await sb.from('profiles').select('id',{count:'exact',head:true}).eq('marketing_opt_out',true);const c=await sb.from('dashboard_prefs').select('user_id',{count:'exact',head:true});const d=await sb.from('metric_snapshots').select('captured_on').order('captured_on',{ascending:true}).limit(1);console.log({profiles:a.count,optedOut:b.count,withSavedMarkets:c.count,snapshotsSince:d.data?.[0]?.captured_on})})()"
```
