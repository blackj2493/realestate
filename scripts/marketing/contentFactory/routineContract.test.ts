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

  it('keeps X chart-first, with the URL inside the image', () => {
    // The watermark is the load-bearing line in the whole X section. A chart gets
    // screenshotted and re-posted detached from the tweet, links on X are nofollow,
    // and a screenshot carries no link at all — so the URL burned into the image is
    // the ONLY thing still pointing home after the chart leaves our account. Lose
    // this instruction and the channel produces reach with no attribution.
    const x = CONTRACT.slice(CONTRACT.indexOf('## X'), CONTRACT.indexOf('## Video'));
    expect(x.toLowerCase()).toContain('inside the image');
    expect(x).toContain('pureproperty.ca');
    expect(x.toLowerCase()).toMatch(/one chart, one claim/);
    expect(x.toLowerCase()).toContain('alt text');
  });

  it('reminds the routine it cannot make the image, only specify it', () => {
    // It runs sandboxed with no egress. Without this it writes "chart showing…" as
    // though it had produced one, and the operator gets a post with no asset.
    const x = CONTRACT.slice(CONTRACT.indexOf('## X'), CONTRACT.indexOf('## Video'));
    expect(x.toLowerCase()).toMatch(/cannot make the image|specify it/);
  });

  it('keeps video faceless, and keeps the disclosure obligation that survives it', () => {
    // Going off camera is a format choice; the disclosure is a licensing obligation.
    // The failure mode this guards is dropping the second along with the first, which
    // would put unattributed property claims out under a licensed realtor's account.
    const video = CONTRACT.slice(CONTRACT.indexOf('## Video'), CONTRACT.indexOf('## LinkedIn'));
    expect(video.toLowerCase()).toContain('faceless');
    expect(video.toLowerCase()).toContain('text card');
    expect(video.toLowerCase()).toContain('verbatim');
    // A synthetic presenter reading a licensed professional's claims is the one
    // faceless option that is worse than being on camera.
    expect(video.toLowerCase()).toMatch(/never let a synthetic presenter/);
  });

  it('keeps the never-a-real-listing wall that separates video from the in-app clips', () => {
    // The whole reason this section exists. The in-app clip library is recorded under
    // the "display on Subscriber Website" carve-out, which does not reach YouTube.
    // Lose this and the obvious next step -- reposting an existing demo clip -- is a
    // licence breach that looks like reusing an asset we already made.
    const video = CONTRACT.slice(CONTRACT.indexOf('## Video'), CONTRACT.indexOf('## LinkedIn'));
    expect(video.toLowerCase()).toContain('never a real listing');
    expect(video).toMatch(/§6\.2\(a\)/);
    expect(video).toContain('PPDEMO');
  });

  it('confines AI tooling on video to voice and edit, never ingestion', () => {
    // VOW 6.2(a) bars providing anything derived from the feed to an AI System for any
    // purpose. Auto-captioning and auto-cutting tools ingest the footage to work, so
    // the ban has to be stated in terms of tools someone would otherwise reach for.
    const video = CONTRACT.slice(CONTRACT.indexOf('## Video'), CONTRACT.indexOf('## LinkedIn'));
    expect(video.toLowerCase()).toMatch(/voice synthesis and editing only/);
    expect(video.toLowerCase()).toMatch(/auto-captioning|auto-cutting/);
  });

  it('keeps the watermark on video for the same reason as the chart', () => {
    // A re-uploaded clip carries no link, exactly like a screenshotted chart.
    const video = CONTRACT.slice(CONTRACT.indexOf('## Video'), CONTRACT.indexOf('## LinkedIn'));
    expect(video).toContain('pureproperty.ca');
    expect(video.toLowerCase()).toContain('watermarked');
  });

  it('reminds the routine it cannot record the clip, only specify it', () => {
    // Same sandbox as the chart spec. Without this it writes "clip showing..." as
    // though it had recorded one, and the operator gets a script with no shot list.
    const video = CONTRACT.slice(CONTRACT.indexOf('## Video'), CONTRACT.indexOf('## LinkedIn'));
    expect(video.toLowerCase()).toMatch(/cannot record it|specify it/);
    expect(video.toLowerCase()).toContain('shot list');
  });

  it('makes the routine choose one post rather than hand over a menu', () => {
    // The failure this prevents already happened: two weeks of runs produced fourteen
    // unreviewed PRs and zero posts. The drafts were fine — thirteen options a day
    // against a capacity of two or three is what stopped anything shipping. If this
    // section goes, the file reverts to a menu and the operator reverts to skipping it.
    expect(CONTRACT).toContain('Post this one today');
    expect(CONTRACT.toLowerCase()).toMatch(/menu, not a queue/);
    expect(CONTRACT.toLowerCase()).toMatch(/do not hand over options/);
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
