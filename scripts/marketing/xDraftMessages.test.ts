import { describe, it, expect } from 'vitest';
import { clip, renderDraftMessage, renderPickMessage, renderWarningMessage } from './xDraftMessages';
import type { XDraft } from './xDraftParse';

const PR = 'https://github.com/o/r/pull/515';

const draft = (over: Partial<XDraft> = {}): XDraft => ({
  angle: 1,
  title: 'Brampton price cuts',
  format: 'single chart',
  figure: '`32%`',
  sourceUrl: 'https://www.pureproperty.ca/data/price-cuts',
  chartSpec: '- **Capture:** the price-cuts tracker.',
  post: '32% of active Brampton listings have cut their ask.\n\nCaveat: active inventory.',
  altText: 'Ranking of 15 Ontario markets.',
  ...over,
});

describe('renderDraftMessage', () => {
  const msg = renderDraftMessage(draft(), 1, 3, PR);

  it('carries the post verbatim, line breaks intact', () => {
    // The delivery layer must never edit a figure on its way to the operator.
    expect(msg).toContain(
      '<pre>32% of active Brampton listings have cut their ask.\n\nCaveat: active inventory.</pre>',
    );
  });

  it('puts the post in a <pre> block so Telegram makes it tap-to-copy', () => {
    expect(msg.indexOf('<pre>')).toBeGreaterThan(-1);
    // Post before alt before chart: paste first, then the box X asks for, then the work.
    expect(msg.indexOf('POST')).toBeLessThan(msg.indexOf('ALT TEXT'));
    expect(msg.indexOf('ALT TEXT')).toBeLessThan(msg.indexOf('CHART'));
  });

  it('numbers the draft and names the format and the PR', () => {
    expect(msg).toContain('X DRAFT 1/3');
    expect(msg).toContain('single chart');
    expect(msg).toContain(PR);
  });

  it('escapes HTML in the draft so a stray angle bracket cannot break the message', () => {
    const m = renderDraftMessage(draft({ post: 'a < b & c > d' }), 1, 1, PR);
    expect(m).toContain('a &lt; b &amp; c &gt; d');
  });

  it('says so plainly when an angle has no post, rather than looking complete', () => {
    const m = renderDraftMessage(draft({ post: null, chartSpec: null, altText: null }), 3, 3, PR);
    expect(m).toContain('None in this angle');
    expect(m).not.toContain('<pre>');
  });

  it('omits a bare format separator when the heading had no suffix', () => {
    expect(renderDraftMessage(draft({ format: '' }), 1, 1, PR)).toContain('X DRAFT 1/1</b>\n');
  });

  it('never exceeds the Telegram message cap, even on a huge chart spec', () => {
    const m = renderDraftMessage(draft({ chartSpec: 'x'.repeat(20_000) }), 1, 1, PR);
    expect(m.length).toBeLessThanOrEqual(4096);
    // The post still survives whole — only the chart spec, which is a note to the human,
    // is allowed to be cut.
    expect(m).toContain('32% of active Brampton listings have cut their ask.');
  });
});

describe('renderPickMessage', () => {
  it('quotes the routine block verbatim and dates it', () => {
    const m = renderPickMessage('**Platform: X.** Whitby at 2.8 months.', '2026-09-07', PR);
    expect(m).toContain('POST THIS ONE TODAY');
    expect(m).toContain('2026-09-07');
    expect(m).toContain('**Platform: X.** Whitby at 2.8 months.');
    expect(m).toContain(PR);
  });

  it('stays under the cap on a long pick block', () => {
    const m = renderPickMessage('y'.repeat(20_000), '2026-09-07', PR);
    expect(m.length).toBeLessThanOrEqual(4096);
    expect(m).toContain(PR);
  });
});

describe('renderWarningMessage', () => {
  it('lists every warning and links the PR', () => {
    const m = renderWarningMessage(['Angle 3: no post text.', 'Angle 4: no X section.'], PR);
    expect(m).toContain('• Angle 3: no post text.');
    expect(m).toContain('• Angle 4: no X section.');
    expect(m).toContain(PR);
  });
});

describe('clip', () => {
  it('leaves short text alone', () => {
    expect(clip('short', 100)).toBe('short');
  });

  it('marks that it truncated, so a cut is never mistaken for the whole draft', () => {
    expect(clip('x'.repeat(500), 100)).toContain('truncated');
  });

  it('prefers a line boundary when there is one late enough to keep', () => {
    const s = `${'a'.repeat(80)}\n${'b'.repeat(80)}`;
    expect(clip(s, 100).split('\n')[0]).toBe('a'.repeat(80));
  });
});
