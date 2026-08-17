import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ageHours,
  detectCity,
  fillTemplate,
  isExcludedAuthor,
  isExcludedTitle,
  parseAtomFeed,
  isProductFree,
  scoreItem,
  stripHtml,
  type RedditItem,
} from './redditMonitorCore';
import { TEMPLATES, SUBREDDITS } from './redditMonitorConfig';
import { buildPrompt, draftTransport } from './redditDraftLLM';
import { cliArgs, __setClaudeCliForTests } from './redditDraftCLI';

const base = (over: Partial<RedditItem>): RedditItem => ({
  id: 't3_test1',
  kind: 'post',
  subreddit: 'TorontoRealEstate',
  author: 'someuser',
  title: '',
  body: '',
  permalink: 'https://www.reddit.com/r/TorontoRealEstate/comments/test1/x/',
  createdUtc: new Date('2026-07-21T00:00:00Z'),
  ...over,
});

const GEO = { geoImplied: true };
const NO_GEO = { geoImplied: false };

describe('scoreItem', () => {
  it('flags a sold-price question in an Ontario sub', () => {
    const hit = scoreItem(
      base({ title: 'How do I find what a house sold for?', body: 'Realtor.ca only shows asking. Any way to see sold prices?' }),
      GEO
    );
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe('sold_data');
    expect(hit!.score).toBeGreaterThanOrEqual(4);
    // In warmup (the default) the personal draft must NOT name the site — the
    // company draft is where the brand lives until an account has real history.
    expect(hit!.draftPersonal).not.toContain('pureproperty');
    expect(hit!.draftCompany).toContain('pureproperty.ca');
  });

  it('drops geography-less matches in Canada-wide subs, keeps them once a city appears', () => {
    const noCity = base({ title: 'Where can I see sold prices?', body: 'Looking at a place out west.' });
    expect(scoreItem(noCity, NO_GEO)).toBeNull();

    const withCity = base({ title: 'Where can I see sold prices?', body: 'Condo in Etobicoke.' });
    const hit = scoreItem(withCity, NO_GEO);
    expect(hit).not.toBeNull();
    expect(hit!.city).toBe('Etobicoke');
  });

  it('lets competitor mentions through the geo gate (HouseSigma is an Ontario tell)', () => {
    const hit = scoreItem(base({ title: 'Is HouseSigma accurate?', body: 'The estimates seem off.' }), NO_GEO);
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe('sold_data');
  });

  it('always alerts on brand mentions regardless of score', () => {
    const hit = scoreItem(base({ title: 'tried pureproperty yesterday', body: 'neat' }), NO_GEO);
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe('brand_watch');
  });

  it('ignores plain chatter with no strong trigger', () => {
    expect(scoreItem(base({ title: 'Moving to Toronto next month!', body: 'So excited about the mortgage.' }), GEO)).toBeNull();
  });

  it('fills {{city}} in drafts from the detected place', () => {
    const hit = scoreItem(
      base({ title: 'Are prices dropping in Hamilton?', body: 'Feels like every listing has a price cut and sits forever?' }),
      GEO
    );
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe('market_pulse');
    expect(hit!.draftCompany).toContain('Hamilton');
  });
});

describe('detectCity / fillTemplate', () => {
  it('finds word-bounded Ontario places, proper-cased', () => {
    expect(detectCity('looking in ETOBICOKE right now')).toBe('Etobicoke');
    expect(detectCity('the barrier was high')).toBeNull(); // no "Barrie" inside "barrier"
    expect(detectCity('somewhere in BC')).toBeNull();
  });

  it('falls back to a neutral phrase without a city', () => {
    expect(fillTemplate('data for {{city}} here', null)).toBe('data for your market here');
    expect(fillTemplate('data for {{city}} here', 'Ottawa')).toBe('data for Ottawa here');
  });
});

describe('exclusions', () => {
  it('drops bots and recurring threads', () => {
    expect(isExcludedAuthor('AutoModerator')).toBe(true);
    expect(isExcludedAuthor('RemindMeBot')).toBe(true);
    expect(isExcludedAuthor('regular_user')).toBe(false);
    expect(isExcludedTitle('Daily Discussion Thread - July 21')).toBe(true);
    expect(isExcludedTitle('Why did this sell over asking?')).toBe(false);
  });
});

describe('parseAtomFeed', () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <author><name>/u/asker</name><uri>https://www.reddit.com/user/asker</uri></author>
    <category term="TorontoRealEstate" label="r/TorontoRealEstate"/>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;Any way to see sold prices &amp;amp; history?&lt;/p&gt;&lt;/div&gt;</content>
    <id>t3_1abcde</id>
    <link href="https://www.reddit.com/r/TorontoRealEstate/comments/1abcde/what_did_it_sell_for/"/>
    <updated>2026-07-21T01:00:00+00:00</updated>
    <published>2026-07-21T01:00:00+00:00</published>
    <title>What did 12 Main St sell for?</title>
  </entry>
  <entry>
    <author><name>/u/replier</name></author>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;Check a VOW site&lt;/p&gt;&lt;/div&gt;</content>
    <id>t1_c0ffee</id>
    <link href="https://www.reddit.com/r/TorontoRealEstate/comments/1abcde/what_did_it_sell_for/c0ffee/"/>
    <published>2026-07-21T02:00:00+00:00</published>
    <title>/u/replier on What did 12 Main St sell for?</title>
  </entry>
</feed>`;

  it('parses posts and comments with ids, bodies and timestamps', () => {
    const items = parseAtomFeed(feed, 'TorontoRealEstate');
    expect(items).toHaveLength(2);

    const [post, comment] = items;
    expect(post.id).toBe('t3_1abcde');
    expect(post.kind).toBe('post');
    expect(post.author).toBe('asker');
    expect(post.subreddit).toBe('TorontoRealEstate');
    expect(post.title).toBe('What did 12 Main St sell for?');
    expect(post.body).toBe('Any way to see sold prices & history?');
    expect(post.createdUtc.toISOString()).toBe('2026-07-21T01:00:00.000Z');

    expect(comment.id).toBe('t1_c0ffee');
    expect(comment.kind).toBe('comment');
    expect(comment.title).toBe('What did 12 Main St sell for?'); // "/u/x on " prefix stripped
  });

  it('drops entries without a t1_/t3_ id instead of guessing', () => {
    expect(parseAtomFeed('<entry><id>garbage</id><title>x</title></entry>', 's')).toHaveLength(0);
  });
});

describe('stripHtml / ageHours', () => {
  it('handles double-encoded entities and keeps line breaks', () => {
    expect(stripHtml('&lt;p&gt;a &amp;amp; b&lt;/p&gt;&lt;p&gt;c&lt;/p&gt;')).toBe('a & b\nc');
  });

  it('clamps future timestamps to zero age', () => {
    const now = new Date('2026-07-21T03:00:00Z');
    expect(ageHours(base({ createdUtc: new Date('2026-07-21T01:30:00Z') }), now)).toBe(1);
    expect(ageHours(base({ createdUtc: new Date('2026-07-21T04:00:00Z') }), now)).toBe(0);
  });
});

describe('warmup mode', () => {
  /**
   * The contract that matters most operationally: while warmup is on, nothing the
   * monitor hands you may name the site or carry a link. Getting this wrong means
   * posting promo from an account with no standing, which is the one mistake that
   * is expensive to undo — a filtered account or a burned sub.
   *
   * Guards every category with warmup phrasing, so adding a new one without a
   * product-free version fails here rather than on Reddit.
   */
  const PROMO = /pureproperty|https?:\/\//i;

  it('no warmup draft names the site or carries a link', () => {
    const offenders: string[] = [];
    for (const [cat, tpl] of Object.entries(TEMPLATES)) {
      for (const [i, v] of (tpl.warmupVariants ?? []).entries()) {
        if (PROMO.test(v)) offenders.push(`${cat}[${i}]`);
      }
    }
    expect(offenders, `warmup drafts must be product-free: ${offenders.join(', ')}`).toEqual([]);
  });

  it('ships the product-free draft for a normal sub while warmup is on', () => {
    const hit = scoreItem(
      base({ title: 'Where can I see what places sold for?', body: 'Toronto, realtor.ca only shows asking.' }),
      { geoImplied: true, policy: 'careful' },
    );
    expect(hit).not.toBeNull();
    expect(PROMO.test(hit!.draftPersonal)).toBe(false);
  });

  it('treats an unlisted sub as strict even while warmup is on', () => {
    expect(isProductFree(undefined)).toBe(true);
  });

  it('picks a stable draft per thread but different drafts across threads', () => {
    const q = { title: 'How do I see sold prices?', body: 'Toronto condo.' };
    const a1 = scoreItem(base({ ...q, id: 't3_aaa' }), GEO)!.draftPersonal;
    const a2 = scoreItem(base({ ...q, id: 't3_aaa' }), GEO)!.draftPersonal;
    expect(a1).toBe(a2); // same thread never changes under you

    const drafts = new Set(
      ['t3_a', 't3_b', 't3_c', 't3_d', 't3_e', 't3_f'].map(
        (id) => scoreItem(base({ ...q, id }), GEO)!.draftPersonal,
      ),
    );
    expect(drafts.size).toBeGreaterThan(1); // not one template for every thread
  });
});

describe('LLM draft prompt', () => {
  /**
   * The generated draft is only as safe as the prompt that produced it. Three
   * things must always reach the model, because each one has a real cost if it
   * doesn't: the sub's hard compliance wall (a feed-agreement breach), the warmup
   * rule (promo from an account with no standing), and the no-invented-numbers
   * rule (a hallucinated market stat posted under a licensed realtor's name).
   */
  const item = {
    id: 't3_p',
    kind: 'post' as const,
    subreddit: 'HouseSigmaBlunders',
    author: 'u',
    title: 'Bought 2022, just sold at a loss',
    body: 'Detached in Brampton. How common is this?',
    permalink: '',
    createdUtc: new Date(),
    category: 'market_pulse',
    categoryLabel: 'Market data argument',
    score: 8,
    triggers: [],
    city: 'Brampton',
    draftPersonal: '',
    draftCompany: '',
  };
  const blunders = SUBREDDITS.find((s) => s.name === 'HouseSigmaBlunders')!;

  it("carries the sub's compliance wall verbatim", () => {
    const p = buildPrompt(item, blunders, true);
    expect(p).toContain('VOW WALL');
    expect(p).toContain('HARD CONSTRAINT');
  });

  it('forbids naming the site in warmup, and permits it conditionally outside warmup', () => {
    expect(buildPrompt(item, blunders, true)).toContain('WARMUP MODE IS ON');
    expect(buildPrompt(item, blunders, false)).toContain('only if');
  });

  it('always forbids inventing figures and demands a placeholder instead', () => {
    for (const warmup of [true, false]) {
      const p = buildPrompt(item, blunders, warmup);
      expect(p).toContain('NO access to live market data');
      expect(p).toContain('placeholder');
    }
  });

  it('includes the actual thread text, which is the entire point', () => {
    const p = buildPrompt(item, blunders, true);
    expect(p).toContain('Bought 2022, just sold at a loss');
    expect(p).toContain('Detached in Brampton');
  });
});

describe('claude CLI draft transport', () => {
  const ARGS = cliArgs('claude-opus-5', 'medium', 'sys prompt', { type: 'object' });
  const flag = (name: string) => ARGS[ARGS.indexOf(name) + 1];

  it('never passes --bare, which would refuse the subscription login', () => {
    // --bare reads auth "strictly [from] ANTHROPIC_API_KEY or apiKeyHelper; OAuth
    // and keychain are never read". It would defeat the whole reason this
    // transport exists, and it would fail as an auth error rather than an
    // obviously-wrong one.
    expect(ARGS).not.toContain('--bare');
  });

  it('strips the harness that would otherwise burn ~33k tokens of rate limit per draft', () => {
    expect(flag('--tools')).toBe('');
    expect(ARGS).toContain('--system-prompt');
    expect(ARGS).toContain('--strict-mcp-config');
  });

  it("runs safe-mode so the user's ASD-STE100 CLAUDE.md cannot rewrite the drafts", () => {
    // The global CLAUDE.md mandates Simplified Technical English. Applied to a
    // Reddit comment it produces exactly the register we are trying to avoid, and
    // it would apply silently.
    expect(ARGS).toContain('--safe-mode');
  });

  it('sends a schema the CLI can actually parse', () => {
    expect(() => JSON.parse(flag('--json-schema'))).not.toThrow();
  });

  it('prefers the API key when present, else the CLI, else nothing', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      __setClaudeCliForTests('C:/fake/claude.exe');
      expect(draftTransport()).toBe('api');

      delete process.env.ANTHROPIC_API_KEY;
      expect(draftTransport()).toBe('cli');

      __setClaudeCliForTests(null);
      expect(draftTransport()).toBe('none');
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
      __setClaudeCliForTests(undefined);
    }
  });
});

/**
 * The promo gate with warmup OFF — the state the monitor runs in once an account has
 * real history. WARMUP_MODE is read from env at module load, so these reload the
 * module graph rather than trying to mutate a frozen const.
 *
 * This block exists because turning the flag off is a one-character change that
 * silently rewrites what every alert tells you to post. Before isProductFree existed
 * the rule was spelled out in four places and every copy read
 * `WARMUP_MODE || sub?.policy === 'no-links'`, which is false for an unlisted sub —
 * so flipping the flag would have shipped promotional drafts into subreddits nobody
 * had ever checked the rules for, under a header saying it was fine to post. The
 * brand and competitor search feeds return threads from arbitrary subs daily, so that
 * path is ordinary traffic, not an edge case.
 */
describe('promo gate with warmup off', () => {
  async function coreWithWarmupOff() {
    vi.resetModules();
    vi.stubEnv('REDDIT_WARMUP', 'false');
    return import('./redditMonitorCore');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('still forces product-free on a no-links sub', async () => {
    const { isProductFree: gate } = await coreWithWarmupOff();
    expect(gate({ policy: 'no-links' })).toBe(true);
  });

  it('FAILS CLOSED on an unlisted sub — the whole point of the helper', async () => {
    const { isProductFree: gate } = await coreWithWarmupOff();
    expect(gate(undefined)).toBe(true);
  });

  it('allows the promotional draft only on a sub someone has actually vetted', async () => {
    const { isProductFree: gate } = await coreWithWarmupOff();
    expect(gate({ policy: 'careful' })).toBe(false);
  });

  it('every configured sub resolves to a deliberate answer', async () => {
    const { isProductFree: gate } = await coreWithWarmupOff();
    const { SUBREDDITS: subs } = await import('./redditMonitorConfig');
    for (const s of subs) {
      expect(gate(s), `${s.name} must resolve from its policy`).toBe(s.policy === 'no-links');
    }
  });
});
