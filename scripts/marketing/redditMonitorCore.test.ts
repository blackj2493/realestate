import { describe, expect, it } from 'vitest';
import {
  ageHours,
  detectCity,
  fillTemplate,
  isExcludedAuthor,
  isExcludedTitle,
  parseAtomFeed,
  scoreItem,
  stripHtml,
  type RedditItem,
} from './redditMonitorCore';
import { TEMPLATES } from './redditMonitorConfig';

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
