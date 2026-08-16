# Reddit Engagement Playbook

How PureProperty markets on Reddit without getting banned, called out, or ignored.
The automated half lives in `scripts/marketing/redditMonitor.ts` (+ config in
`redditMonitorConfig.ts`, cron in `.github/workflows/reddit-monitor.yml`); this doc is
the human half — what to do when the digest email lands.

**The loop:** every 2 hours the monitor scans the subreddits below → scores new
posts/comments against the trigger taxonomy → records matches in
`reddit_opportunities` → emails a digest with two draft replies per match
(personal voice + company voice). A human reads the thread, edits a draft, posts it.
**Nothing is ever posted automatically.**

## Why two voices — and the one rule that keeps this safe

- **Company account** (e.g. `u/PureProperty` or a founder-flaired personal account):
  transparent "founder here" voice. Use it for brand mentions, feature questions,
  data-error reports, and anywhere you'd be comfortable being quoted.
- **Personal account**: your normal Reddit account, casual register, answers the
  question first and mentions the site as one option among others.

The rule: **anonymous ≠ deceptive.** Posting from a personal account is fine;
*pretending to be an uninvolved happy customer* is astroturfing — it violates most
subs' rules, Redditors dig through post histories fast, and a single "OP works
there and didn't say so" comment costs more than fifty good replies earned. That's
why the personal-voice templates carry an optional one-line disclosure — keeping
it almost always *increases* upvotes; Reddit rewards "I work on this, biased but
here's the honest answer" and destroys hidden shills. HouseSigma itself grew on
exactly this founder-transparent playbook.

Never do: reply to criticism of PureProperty from the anonymous account · upvote
your own replies from the other account · post the same link in multiple subs the
same day · argue.

## Where we play

| Subreddit | Watch | Policy | Rules of engagement |
|---|---|---|---|
| r/TorontoRealEstate | posts + comments | careful | Tool mentions normal; lead with data, site second |
| r/OntarioRealEstate | posts + comments | careful | Small sub; one great answer echoes for weeks |
| r/RealEstateCanada | posts + comments | careful | Ontario threads only |
| r/CanadaHousing | posts | careful | Data questions only; skip ideology threads |
| r/CanadaHousing2 | posts + comments | careful | Price-cut/inventory trackers land well here |
| r/OntarioLandlord | posts + comments | careful | Investor lane: yield/cap-rate; skip LTB-law threads |
| r/PersonalFinanceCanada | posts | **no-links** | STRICT no self-promo: give the method/number; name the site only if asked |
| r/askTO, r/ottawa, r/Hamilton, r/KitchenerWaterloo, r/londonontario, r/mississauga | posts | careful | Housing-data threads only; one link max; Ottawa is a differentiator (HouseSigma is weaker there) |
| site-wide search | posts | — | `housesigma` (competitor threads) + `pureproperty` (brand watch) |

Category taxonomy (what triggers an alert): `sold_data` (sold-price/history
questions, competitor mentions — our bread and butter), `tool_rec` ("best
site/app?" threads), `market_pulse` (DOM/price-cut/inventory/crash arguments →
answer with the **public** `/data` trackers, which need no login and earn
backlinks), `valuation` ("what's it worth"), `investor` (cap rate/cash flow),
`condo_data` (fees/special assessments), `brand_watch` (always alerts).

## Discipline (this is what keeps the accounts alive)

1. **10:1 ratio.** For every reply that mentions PureProperty, make ~ten normal
   comments that don't. The monitor finds promo openings; the account still needs
   a life outside them.
2. **Max 1–2 link-drops per sub per week**, even if the digest offers ten. Pick
   the best thread and skip the rest — `dismissed` is a fine status.
3. **Reply fast or not at all.** The digest runs 2-hourly because Reddit replies
   earn most of their votes in the first hours. If a thread is a day old, let it go.
4. **Check the number before posting.** Market-pulse drafts contain
   `[check the tracker and paste the current number]` slots on purpose — a reply
   with a real figure wins the thread; a vague "we have trackers" is an ad.
5. **PFC is a no-fly zone for links.** Answer with the data/method. When someone
   replies "where is that from?" — *that's* when you name the site. It reads as
   requested information, because it is.
6. **Edit every draft.** They're deliberately 90% done; the missing 10% (a detail
   from the thread) is what makes it a reply instead of a paste.

## Ops runbook

- **One-time setup:**
  1. Apply migration `093_reddit_opportunities.sql` (applyMigrationFiles.ts, pooler `DATABASE_URL`).
  2. Create a free Reddit "script" app at <https://www.reddit.com/prefs/apps> →
     repo secrets `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (application-only
     OAuth, read-only; without them the RSS fallback gets rate-limited to death in CI).
  3. Optional secret `MARKETING_ALERT_EMAIL` for the digest recipient (falls back
     to `SYNC_ALERT_EMAIL`).
- **Emails:** digest only when there are *new* matches; failures email via
  `notifyRun.ts`. No "ran OK, nothing found" noise.
- **Local dry-run:** `npx tsx scripts/marketing/redditMonitor.ts --subs TorontoRealEstate --rss`
  (no DB/email; add `--preview digest.html` to eyeball the email).
- **Tuning:** all subreddits/triggers/templates live in `redditMonitorConfig.ts`.
  Too noisy → raise `SCORE_THRESHOLD` or delete weak triggers; too quiet → add
  subs or phrases. Status lifecycle in the migration header.
