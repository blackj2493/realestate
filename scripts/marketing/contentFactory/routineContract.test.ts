/**
 * Guards content-queue/ROUTINE.md — the editorial contract the drafting routine reads.
 *
 * A prose file is not usually worth a test. This one is, because it is the only thing
 * standing between the trackers and everything we publish, and because its previous
 * home was a cloud schedule config where nothing could review it. A rule silently
 * deleted from this file is a rule that stops applying to every draft from the next
 * morning onward, with no diff anyone would notice.
 *
 * These assertions are deliberately about presence, not wording — they should survive
 * an edit that improves the prose and fail an edit that removes a wall.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONTRACT = readFileSync(path.join(process.cwd(), 'content-queue', 'ROUTINE.md'), 'utf8');
const lower = CONTRACT.toLowerCase();

describe('content routine contract', () => {
  it('names every platform the routine drafts for', () => {
    for (const platform of ['## Reddit', '## X', '## Video', '## LinkedIn']) {
      expect(CONTRACT, `missing section: ${platform}`).toContain(platform);
    }
  });

  it('keeps the draft-only posture explicit', () => {
    // The entire compliance story depends on a human approving each post. If this
    // sentence goes, the routine has no instruction stopping it from wiring up a poster.
    expect(lower).toContain('nothing posts automatically');
  });

  it('keeps the figure-verbatim rule', () => {
    // The routine cannot see the site or the DB. A figure it derives is one it invented.
    expect(lower).toContain('verbatim');
    expect(lower).toMatch(/never recompute|do not recompute/);
  });

  it('keeps the aggregate-only VOW wall', () => {
    expect(lower).toContain('aggregates only');
    expect(lower).toMatch(/never an individual listing|no individual/);
  });

  it('keeps the prior-art rule and names the actual prior art', () => {
    // Naming them is the point: a rule that says "check for prior art" without saying
    // who is easy to satisfy by not looking.
    expect(lower).toMatch(/prior[- ]art/);
    expect(CONTRACT).toContain('Wahi');
    expect(CONTRACT).toContain('Door Insight');
  });

  it('keeps the licensed-realtor constraint on advice', () => {
    expect(lower).toMatch(/never what someone should do|not what someone should do/);
  });

  it('states the inverted promotion default that separates LinkedIn from Reddit', () => {
    // The single most load-bearing distinction between the two channels. Losing it
    // produces either a Reddit post that reads as an advert or a LinkedIn post that
    // gives the data away unattributed.
    const linkedin = CONTRACT.slice(CONTRACT.indexOf('## LinkedIn'));
    expect(linkedin.toLowerCase()).toContain('always attribute');
    expect(linkedin.toLowerCase()).toMatch(/inverted|opposite default/);
  });

  it('tells the routine NOT to reuse the founder disclosure on LinkedIn', () => {
    // The disclosure exists because Reddit readers do not know who is talking. The
    // LinkedIn profile headline already says it, so repeating it reads as automated.
    const linkedin = CONTRACT.slice(CONTRACT.indexOf('## LinkedIn'));
    expect(linkedin.toLowerCase()).toMatch(/do not use the founder disclosure/);
  });

  it('caps LinkedIn at one draft per day', () => {
    // Cadence is twice a week. Drafting five for two slots trains the reviewer to skim,
    // and skimming is how a wrong figure gets posted.
    const linkedin = CONTRACT.slice(CONTRACT.indexOf('## LinkedIn'));
    expect(linkedin.toLowerCase()).toContain('one linkedin draft per day');
  });

  it('protects the post type that earns citations', () => {
    const linkedin = CONTRACT.slice(CONTRACT.indexOf('## LinkedIn'));
    expect(linkedin).toMatch(/Type C/);
    expect(linkedin.toLowerCase()).toMatch(/do not drop it/);
  });

  it('contains no novelty claim of its own', () => {
    // Same rule the public copy is held to (see noveltyClaims.test.ts). A contract that
    // breaks its own rule teaches the routine to break it too.
    const banned = [
      /nobody\s+(?:else\s+)?(?:publishes|measures|reports)\b/i,
      /no\s+other\s+(?:\w+\s+){0,2}source\b/i,
      /no\s+canadian\s+source\b/i,
      /the\s+only\s+(?:\w+\s+){0,2}(?:source|tracker|dataset|publisher)\b/i,
    ];
    // Strip blockquotes (which quote the false claim as a cautionary example) and
    // inline code spans (the convention this file uses to write a banned phrase as a
    // token rather than assert it). Same idea as stripComments() in noveltyClaims.test.ts:
    // the document that records the rule has to be able to name what it forbids.
    const body = CONTRACT.split('\n')
      .filter((l) => !l.trim().startsWith('>'))
      .join('\n')
      .replace(/`[^`]*`/g, ' ');
    for (const p of banned) {
      expect(body.match(p)?.[0], `contract itself contains a novelty claim`).toBeUndefined();
    }
  });

  it('is discoverable from CLAUDE.md, which is how the routine finds it at all', () => {
    // Claude Code auto-loads the repo-root CLAUDE.md, so this pointer is what makes
    // the contract apply without anyone editing the cloud schedule. Delete the pointer
    // and the routine silently falls back to whatever stale instructions its schedule
    // still carries — no error, just yesterday's rules.
    const claudeMd = readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('content-queue/ROUTINE.md');
  });

  it('tells the routine to flag rather than fudge an angle it cannot draft honestly', () => {
    // This is what caught the months-of-supply direction bug before it posted.
    expect(lower).toMatch(/anomaly note/);
    expect(lower).toMatch(/leave it out/);
  });
});
