/**
 * Reddit-opportunity monitor — the marketing brain.
 *
 * Everything editorial lives here: which subreddits we watch, which phrases make
 * a post/comment worth replying to, and the two-voice draft replies the digest
 * email ships with. The runtime (redditMonitor.ts) is dumb plumbing; tune the
 * campaign by editing THIS file.
 *
 * Companion strategy doc: docs/strategy/reddit-engagement-playbook.md
 * (per-sub rules of engagement, account hygiene, cadence discipline).
 */

/** How openly a subreddit tolerates product mentions. Shown in the digest. */
export type PromoPolicy = 'open' | 'careful' | 'no-links';

export interface SubredditConfig {
  /** Without the r/ prefix, exact case as Reddit shows it. */
  name: string;
  /** Watch new posts (cheap, always on for listed subs). */
  posts: boolean;
  /**
   * Also watch the sub's newest-comments firehose. Only sensible for small/mid
   * subs where 100 comments ≈ a few hours of traffic; in a megasub the feed
   * window is minutes and coverage is illusory.
   */
  comments: boolean;
  policy: PromoPolicy;
  /** One-line rule-of-engagement reminder, printed under every match. */
  note: string;
  /**
   * true = the sub itself pins the geography to Ontario (r/TorontoRealEstate),
   * so items don't need to name a city. false = Canada-wide sub; items must
   * mention an Ontario place (or a competitor brand) to alert, otherwise we'd
   * ping on Calgary threads we can't help with.
   */
  geoImplied: boolean;
  /**
   * Constraints that change WHAT MAY BE SAID, not merely the tone — rendered
   * above the draft in every alert rather than beside the policy chip, because a
   * line at the top of a notification is the line that gets skimmed past.
   *
   * Only set this where getting it wrong has a cost beyond a bad reply: a feed-
   * agreement breach, a ban, or a thread turning on you.
   */
  compliance?: string;
}

export const SUBREDDITS: SubredditConfig[] = [
  { name: 'TorontoRealEstate', posts: true, comments: true, policy: 'careful', geoImplied: true,
    note: 'Tool mentions are normal here but shills get called out — lead with data, mention the site second.' },
  { name: 'OntarioRealEstate', posts: true, comments: true, policy: 'careful', geoImplied: true,
    note: 'Small sub, low volume — a genuinely helpful answer stands out for weeks.' },
  { name: 'RealEstateCanada', posts: true, comments: true, policy: 'careful', geoImplied: false,
    note: 'Canada-wide — only reply when the thread is Ontario or the question is generic.' },
  { name: 'CanadaHousing', posts: true, comments: false, policy: 'careful', geoImplied: false,
    note: 'Politics-heavy; answer data questions with data, skip the ideology threads.' },
  { name: 'CanadaHousing2', posts: true, comments: true, policy: 'careful', geoImplied: false,
    note: 'Doomer-leaning; price-cut / inventory trackers land well, salesy tone does not.',
    compliance:
      'OPENLY HOSTILE TO REALTORS. Disclose anyway — being caught hiding it is far worse than ' +
      'being downvoted for it. Never sound bullish here; a falling number posted plainly will ' +
      'be believed, the same number framed optimistically will not.' },
  { name: 'OntarioLandlord', posts: true, comments: true, policy: 'careful', geoImplied: true,
    note: 'Investor lane — rental yield / cap-rate answers; landlord-tenant law threads are off-topic for us.' },
  { name: 'PersonalFinanceCanada', posts: true, comments: false, policy: 'no-links', geoImplied: false,
    note: 'STRICT no self-promo. Answer with the method/number only; name the site ONLY if someone asks where the data is from.',
    compliance:
      'NO LINK, NO BRAND — strip both from the draft before posting. This sub removes ' +
      'self-promotion on sight and the mods do not negotiate. Give the number and the method ' +
      'and nothing else; name the site only if somebody directly asks where it came from.' },
  { name: 'askTO', posts: true, comments: false, policy: 'careful', geoImplied: true,
    note: 'General-city sub — only reply to explicit housing-data questions, one link max.' },
  { name: 'ottawa', posts: true, comments: false, policy: 'careful', geoImplied: true,
    note: 'General-city sub; Ottawa data is a differentiator (HouseSigma is weaker there).' },
  { name: 'Hamilton', posts: true, comments: false, policy: 'careful', geoImplied: true,
    note: 'General-city sub — housing threads only.' },
  { name: 'KitchenerWaterloo', posts: true, comments: false, policy: 'careful', geoImplied: true,
    note: 'General-city sub — housing threads only.' },
  { name: 'londonontario', posts: true, comments: false, policy: 'careful', geoImplied: true,
    note: 'General-city sub — housing threads only.' },
  { name: 'mississauga', posts: true, comments: false, policy: 'careful', geoImplied: true,
    note: 'General-city sub — housing threads only.' },
  // Competitor-branded, but user-run (mods u/khnhk + u/Mother-Bug2191, since Jun 2022),
  // NOT operated by HouseSigma. That distinction is the whole reason it can exist: the
  // "bought high, sold low" genre needs sold prices, which are VOW-gated in Ontario. A
  // sub full of USERS re-posting screenshots is ambient leakage nobody is liable for.
  // The same post from us would be a feed-agreement breach. See launch-marketing-strategy
  // §R.3a — this is the sharpest compliance edge anywhere in the monitor.
  { name: 'HouseSigmaBlunders', posts: true, comments: true, policy: 'careful', geoImplied: true,
    note: 'Competitor-branded sub, user-run. You are a guest — contribute the CONTEXT nobody else can, never more sold data.',
    compliance:
      'VOW WALL — this changes what you may post, not how you say it. NEVER post a sold price, ' +
      'a sold-vs-purchase loss, or a relist chain for a named listing. That is a breach of the ' +
      'feed agreement, not a style call, and it is the one TRREB can pull the data over. ' +
      'SAFE: a single listing\'s own asking-price cuts, aggregates over 5+ sales, or anything ' +
      'already public in the news. And never bash HouseSigma — you are in their house.' },
];

/** Site-wide post searches (competitor + brand watch), run every cycle. */
export const SEARCHES: { label: string; query: string }[] = [
  { label: 'competitor:housesigma', query: 'housesigma' },
  { label: 'brand:pureproperty', query: '"pureproperty" OR "pure property"' },
];

/**
 * Trigger taxonomy. An item alerts when it hits ≥1 strong pattern (each worth
 * 3) and its total score clears SCORE_THRESHOLD. Weak terms add 1 each — they
 * never alert alone, they rank strong matches against each other.
 */
export interface CategoryConfig {
  id: string;
  label: string;
  strong: RegExp[];
  weak: RegExp[];
}

export const CATEGORIES: CategoryConfig[] = [
  {
    id: 'brand_watch',
    label: 'Brand mention',
    strong: [/pure\s?property/i],
    weak: [],
  },
  {
    id: 'sold_data',
    label: 'Sold prices / history',
    strong: [
      /what (did|does|do) .{0,50}(sell|sold|go) for/i,
      /s[ao]ld price/i,
      /sale price history/i,
      /price history/i,
      /(find|see|look up|check) .{0,40}sold/i,
      /sold (data|listings|comps|history)/i,
      /recently sold/i,
      /house\s?sigma|mongohouse|bungol|zealty|\bwahi\b/i,
      /comparable sales|\bcomps\b/i,
    ],
    weak: [/realtor\.ca/i, /\bmls\b/i, /\bcma\b/i, /agent (told|said|says)/i],
  },
  {
    id: 'tool_rec',
    label: 'Tool / site recommendation',
    strong: [
      /best (site|app|website|tool|platform)/i,
      /any (good )?(site|app|tool|website)s? (for|to|that)/i,
      /alternative(s)? to (housesigma|realtor|zillow|zolo)/i,
      /recommend .{0,30}(site|app|website|tool)/i,
      /(which|what) (site|app|website) (do|does|should)/i,
      /where (can|do) (i|you|we) (see|find|look|check|track)/i,
    ],
    weak: [/listing/i, /search/i, /map/i],
  },
  {
    id: 'market_pulse',
    label: 'Market direction / data',
    strong: [
      /days on market|\bdom\b/i,
      /price (cut|drop|reduction|decrease)s?/i,
      /relist(ed|ing)?\b/i,
      /(terminat|delist|cancel)(ed|ing)? .{0,25}listing/i,
      /listing .{0,25}(terminated|cancelled|delisted)/i,
      /months of inventory|inventory (is )?(rising|piling|climbing|exploding)/i,
      /(market|prices?) (is |are )?(crash|cool|correct|drop|fall|tank|soften)/i,
      /sitting on the market/i,
      /bidding war|bully offer/i,
      /(good|bad|right|wrong) time to buy/i,
      /sell.?through|absorption rate/i,
    ],
    weak: [/interest rate/i, /\bboc\b|bank of canada/i, /spring market|fall market/i, /sold over asking/i],
  },
  {
    id: 'valuation',
    label: 'What is it worth',
    strong: [
      /how much is (my|our|this|the) (house|home|condo|place|property) worth/i,
      /(house|home|condo|property) (value|valuation) estimate/i,
      /what.{0,15}(house|home|condo|place).{0,15}worth/i,
      /home (value|estimate)/i,
      /apprais(al|er|ed)/i,
      /(mpac|assessment) (vs|versus|compared)/i,
      /(over|under)priced/i,
    ],
    weak: [/refinanc/i, /heloc/i, /list(ing)? price/i],
  },
  {
    id: 'investor',
    label: 'Investor math',
    strong: [
      /cap rate/i,
      /rental yield/i,
      /cash.?flow (positive|negative|analysis)?/i,
      /rent estimate|estimate .{0,20}rent/i,
      /investment (property|condo|unit)/i,
      /\bbrrrr\b/i,
      /pre.?con(struction)? assignment/i,
    ],
    weak: [/mortgage/i, /down payment/i, /tenant/i, /\broi\b/i],
  },
  {
    id: 'condo_data',
    label: 'Condo fees / building health',
    strong: [
      /condo fee|maintenance fee/i,
      /special assessment/i,
      /reserve fund/i,
      /status certificate/i,
      /fees? (are |keep )?(going up|increasing|climbing|doubling)/i,
    ],
    weak: [/property management/i, /condo board/i, /kitec/i],
  },
];

/** ≥1 strong (3 pts) + one supporting signal, OR two independent strongs. */
export const SCORE_THRESHOLD = 4;

/** Ignore anything older than this — a late reply in a dead thread reads as spam. */
export const LOOKBACK_HOURS = 36;

/** Max opportunities per digest; the rest are recorded with status 'overflow'. */
export const MAX_PER_DIGEST = 12;

/** Bot/noise authors, checked case-insensitively. */
export const EXCLUDED_AUTHORS = [/^automoderator$/i, /bot$/i, /^\[deleted\]$/i];

/** Recurring threads that match triggers but aren't reply targets. */
export const EXCLUDED_TITLES = [/daily discussion/i, /weekly .{0,20}thread/i, /megathread/i, /monthly rant/i];

/**
 * Ontario place names (word-boundary, case-insensitive). Used to (a) gate
 * Canada-wide subs to threads we can actually help with and (b) fill {{city}}
 * in draft templates.
 */
export const ONTARIO_PLACES = [
  'Toronto', 'GTA', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton', 'Kitchener', 'Waterloo',
  'Cambridge', 'Oakville', 'Burlington', 'Milton', 'Vaughan', 'Markham', 'Richmond Hill',
  'Scarborough', 'Etobicoke', 'North York', 'Oshawa', 'Whitby', 'Ajax', 'Pickering',
  'Guelph', 'Barrie', 'Niagara', 'St. Catharines', 'Windsor', 'Kingston', 'Durham', 'Ontario',
];

/**
 * Draft replies, two voices per category:
 *   personal — for your anonymous/community account. Casual register, value
 *     first, names the site as one option among others. Includes a disclosure
 *     line you can keep or cut — see the playbook on why keeping it usually
 *     WINS on Reddit (undisclosed shilling is against most subs' rules and
 *     post-history sleuths find out fast).
 *   company — transparent founder voice for the official account.
 * [Square-bracket notes] are instructions to YOU — replace or delete before
 * posting. {{city}} is auto-filled when a city was detected.
 */
/**
 * Draft replies, per category.
 *
 * `personal` is the fallback. `personalVariants`, where present, is what actually
 * ships: the monitor picks one deterministically from the thread id.
 *
 * WHY VARIANTS: a fixed template is a bigger risk than a clumsy sentence. Post the
 * same paragraph on five threads and somebody eventually lines them up side by
 * side, and at that point you are not a helpful regular, you are a bot. Rotating
 * phrasings means no two replies ever match.
 *
 * HOUSE STYLE for anything in `personalVariants` — these are meant to survive a
 * reader asking "did a person write this?":
 *   - Two to four sentences. Long replies read as marketing whoever wrote them.
 *   - Contractions. Lowercase sentence starts are fine. Fragments are fine.
 *   - No em-dashes, no bullet lists, no bold. All three read as generated now.
 *   - Answer ONE thing well instead of covering every angle. Completeness is the
 *     single biggest tell that a machine wrote it.
 *   - Have an opinion. Hedging everything reads as fake.
 *   - No sign-off.
 *   - Disclosure last, in parentheses, casual. Never omit it.
 */
export const TEMPLATES: Record<
  string,
  { personal: string; company: string; personalVariants?: string[] }
> = {
  brand_watch: {
    personal:
      "[You were mentioned — read the thread first. If it's praise, an upvote from the personal account is often enough; " +
      'let the founder account do the talking. If it\'s criticism, do NOT defend anonymously — that\'s how astroturf scandals start.]',
    company:
      "Founder here — someone sent me this thread. [Respond to the specific point: thank them / fix it / explain it.] " +
      "If anything on the site looks off or missing for {{city}}, tell me and I'll ship a fix — small team, we move fast.",
  },
  sold_data: {
    personal:
      "For Ontario solds you basically have the VOW sites — the data comes from the MLS boards but you need a free account " +
      "(that's the rule CREA sets, it's why realtor.ca will never show you sold prices). HouseSigma is the one everyone knows. " +
      "I've mostly switched to pureproperty.ca — free account too, and it shows the full listing history: relists, terminations, " +
      "what it actually sat at before 'selling in 5 days'. That history is usually more telling than the sold price itself.\n\n" +
      '[optional disclosure — recommended:] (disclosure: I work on pureproperty, but HouseSigma is solid too — use either)',
    personalVariants: [
      "realtor.ca won't ever show you solds, that's a CREA rule rather than a website being unhelpful. you need a VOW site " +
        'with a free account. HouseSigma is the one most people land on. i use pureproperty.ca, mainly because it shows the ' +
        "whole listing history, so you can tell when something \"sold in 5 days\" after being relisted twice.\n\n" +
        '(i work on pureproperty, so take that with the appropriate salt)',
      'free account on any VOW site gets you this, HouseSigma or pureproperty.ca both do it. honestly the sold price on its ' +
        'own is the less useful half. what i look at is whether it was relisted first, because a place on its third campaign ' +
        "tells you something the final number doesn't.\n\n(disclosure: i work on pureproperty)",
      "you're looking for a VOW site. the boards make you register before they'll show sold data, which is why the public " +
        'sites never do. HouseSigma works fine. pureproperty.ca is what i use, it keeps the relist and termination history ' +
        'attached so you can see the full campaign instead of just the ending.\n\n(fwiw i work on pureproperty)',
    ],
    company:
      "Founder of pureproperty.ca here — we're a VOW site like HouseSigma, so with a free account you get sold prices plus the " +
      "full campaign history for {{city}}: relists, terminations, true days-on-market. If you look something up and the history " +
      "seems wrong or incomplete, reply or DM me — data quality reports go to the top of my list.",
  },
  tool_rec: {
    personal:
      "Depends what you're after:\n\n" +
      "- **Just browsing actives:** realtor.ca is fine.\n" +
      "- **Sold prices + listing history:** you need a VOW site — HouseSigma (app-first) or pureproperty.ca (web-first, free account; " +
      "shows relist chains and real days-on-market, plus public market trackers you can check without signing in).\n" +
      "- **Rentals:** honestly still Facebook Marketplace and luck.\n\n" +
      '[optional disclosure — recommended:] (fwiw I work on pureproperty — biased, but the free tier genuinely covers all of this)',
    personalVariants: [
      "depends what you actually need. realtor.ca is fine if you just want to browse what's listed. for sold prices and " +
        "listing history you need a VOW site, so HouseSigma or pureproperty.ca. rentals are still mostly Facebook " +
        'Marketplace and patience, nothing has fixed that yet.\n\n(i work on pureproperty, so obviously biased)',
      "HouseSigma if you want the app, pureproperty.ca if you'd rather work on a desktop. both free with an account, both " +
        'pull the same board data. the difference is what they show you around the sale rather than the sale itself.' +
        '\n\n(disclosure: i work on pureproperty)',
      "for actives realtor.ca does the job. for anything involving sold prices you'll need to register somewhere, that's " +
        "just how the board rules work. i use pureproperty.ca, HouseSigma is the more popular answer and it's a fine " +
        'one.\n\n(i work on pureproperty, flagging that upfront)',
    ],
    company:
      "Founder of pureproperty.ca — adding it as an option since this is exactly what we built it for: sold prices, full listing " +
      "history, days-on-market and neighbourhood stats for Ontario, free account. There's also a public /data page with live market " +
      "trackers (price cuts, inventory, DOM) that needs no login. Happy to answer questions or take feature requests right here.",
  },
  market_pulse: {
    personal:
      "You don't have to argue this from vibes — there are public trackers for exactly this at pureproperty.ca/data " +
      "(price cuts, days-on-market, inventory, sell-through; no account needed). [Open the {{city}} tracker, paste the actual " +
      "current number here — a reply with a real figure in it wins the thread.] The direction over the last couple months is " +
      "what matters, not any single week.",
    personalVariants: [
      "there's an actual number for this rather than everyone guessing. [PASTE THE LIVE {{city}} FIGURE HERE from " +
        'pureproperty.ca/data before posting.] worth looking at the trend over a couple of months instead of any single ' +
        "week though, weekly moves in this market are mostly noise.\n\n(i work on pureproperty, the /data pages are free " +
        'and need no login)',
      "[PULL THE CURRENT {{city}} NUMBER from pureproperty.ca/data and lead with it.] that's the figure, for whatever it's " +
        "worth. i'd be careful reading much into one month either way, the direction over a quarter is the part that " +
        "actually holds up.\n\n(disclosure: i work on pureproperty. the data pages are free, no account)",
      "you can check this instead of arguing it. [INSERT LIVE {{city}} FIGURE from pureproperty.ca/data.] the thing most " +
        "people get wrong here is comparing to last month rather than the same month last year, which in a seasonal market " +
        'makes almost everything look like a crash or a boom.\n\n(i build pureproperty, flagging that)',
    ],
    company:
      "We publish free public trackers for exactly this — pureproperty.ca/data has price cuts, days-on-market, inventory and " +
      "sell-through for {{city}}, updated nightly, no login. [Paste the relevant current number into the reply.] Founder here — " +
      "if there's a cut of the market this sub wants tracked that we don't have, tell me and I'll build it.",
  },
  valuation: {
    personal:
      "Ignore the MPAC assessment — it lags the market by years and exists for taxes, not pricing. What actually works: pull the " +
      "last 3–4 sales of comparable places near you (same type, similar size) and price against those. Any VOW site shows them free — " +
      "HouseSigma or pureproperty.ca (the latter also shows each comp's listing history, so you can spot which 'comps' were actually " +
      "relisted three times). Treat any single algorithmic estimate as ±5–10%, including theirs.",
    company:
      "Founder of pureproperty.ca — a free account gets you the recent comparable solds around {{city}} plus each one's full " +
      "listing history, and our estimate alongside them. Honest caveat: no AVM should be trusted alone at the individual-house " +
      "level — use the estimate as a starting point and the comps as the answer. If your street looks thin on comps, DM me and " +
      "I'll tell you what the model actually had to work with.",
  },
  investor: {
    personal:
      "Before trusting anyone's pro-forma: pureproperty.ca has an investor mode on listings (cap rate + cash-flow with YOUR " +
      "numbers, not the listing agent's) and area-level rental yield data — free account. For {{city}} the useful first look is " +
      "yield by area and property type; it tells you immediately which segments even *can* cash-flow at today's rates before you " +
      "waste evenings on individual listings.",
    company:
      "Founder of pureproperty.ca here — we built an investor lens for exactly this: open any Ontario listing, flip to investor " +
      "mode, and you get cap rate and cash-flow with your own rate/down-payment assumptions, plus area rental-yield benchmarks. " +
      "Free account. If your underwriting needs an input we don't expose, tell me — investor-mode feature requests get built fast.",
  },
  condo_data: {
    personal:
      "One thing worth checking before you offer: how the building's fees have MOVED, not just what they are today. " +
      "pureproperty.ca (free account) shows fee stats and an annualized fee-trend per building, so a building whose fees are " +
      "climbing way faster than the area average shows up before it becomes your problem. None of that replaces reading the " +
      "status certificate — reserve fund study especially.",
    company:
      "Founder of pureproperty.ca — we track condo fee levels and the per-building fee *trend* (annualized, so one-off jumps " +
      "don't fake a trend) across Ontario. Free account. It's a screen, not a substitute for the status certificate — but it " +
      "catches the fee-spiral buildings early. If a building you're watching looks wrong in our data, flag it to me here.",
  },
};
