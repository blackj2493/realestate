/**
 * Pull the X drafts out of a `content-queue/YYYY-MM-DD.md` file.
 *
 * WHY THIS EXISTS. The daily routine already writes an X draft for every angle — chart
 * spec, post text, alt text, caveat, compressed disclosure — and has done since
 * 2026-08-18. It then opens a PR, and every one of those PRs is still open. The drafting
 * was never the missing piece; nineteen days of finished X posts have simply never been
 * read. The Reddit monitor's advantage is not a better writer, it is that its output
 * arrives on a phone.
 *
 * So this is a parser, not a generator. It takes the file the routine already produces
 * and lifts out the parts you need in your hand while posting.
 *
 * PARSE, DON'T RE-RENDER. The post text is reproduced verbatim, blockquote markers
 * stripped and nothing else. ROUTINE.md's first hard rule is that figures are cited
 * exactly as given — so this must never reflow, re-wrap or "tidy" a draft on the way out.
 * A delivery layer that edits the number is worse than no delivery layer.
 *
 * THE FILE SHAPE MOVES, so every field is optional and drift is reported rather than
 * thrown. Measured across two consecutive real days:
 *
 *   2026-09-06            2026-09-07
 *   ### (b) X — single chart   ### (b) X          (no suffix)
 *   **Chart spec**             **Chart spec:**    (colon)
 *   **Post text**              **Post text:**
 *   ## Angle 1 — Whitby price cuts   ## Angle 1 — Brampton: 32% of active listings…
 *
 * Both are the same routine, one day apart. A parser pinned to either loses the other
 * silently, which is the failure mode that matters here: a thin alert reads exactly like
 * a quiet day. Hence `warnings`, which the caller ships alongside the drafts.
 */

export interface XDraft {
  /** 1-based, as numbered in the file. */
  angle: number;
  /** The angle heading's text — a short title some days, the full claim on others. */
  title: string;
  /** The heading's own suffix: "single chart", "thread", … Empty when the heading is bare. */
  format: string;
  /** Verbatim figure line from the angle header, when present. */
  figure: string | null;
  sourceUrl: string | null;
  /** The chart-spec bullets, markdown as written. */
  chartSpec: string | null;
  /** The post itself, blockquote markers removed. This is what gets pasted into X. */
  post: string | null;
  altText: string | null;
}

export interface ParsedContentFile {
  /**
   * The routine's own `## ⭐ Post this one today` block, verbatim.
   *
   * Delivered as written rather than matched back to an angle. The routine states its
   * pick in prose, and on some days (2026-09-07) that block already carries the finished
   * chart spec, post and alt text. Re-deriving which angle it meant is guesswork that can
   * be wrong; quoting it cannot be.
   */
  pick: string | null;
  drafts: XDraft[];
  /** Heading drift, missing sections — anything the caller should see rather than guess. */
  warnings: string[];
}

/** `## Angle 3 — Whitby months of supply` */
const ANGLE_RE = /^##[ \t]+Angle[ \t]+(\d+)[ \t]*[—–-][ \t]*(.+?)[ \t]*$/gm;

/**
 * `### (b) X — single chart`, and also a bare `### (b) X`.
 *
 * `[ \t]` throughout, never `\s`: `\s` matches newlines, so an optional-suffix group built
 * from it walks off the heading and swallows the next paragraph as the "format". Not
 * hypothetical — it captured `**Chart spec:**` out of the 2026-09-07 file.
 *
 * The letter is not pinned either; the routine reorders platforms between days.
 */
const X_HEADING_RE = /^###[ \t]+\([a-z]\)[ \t]+X\b[ \t]*(?:[—–-][ \t]*(.*?))?[ \t]*$/m;

/** Any following `### ` heading ends the X block. */
const NEXT_SUBHEADING_RE = /^###[ \t]+/m;

/** The routine's recommendation block. */
const PICK_RE = /^##[ \t]+⭐[ \t]*Post this one today[ \t]*$/m;
/** Any following `## ` heading ends it. */
const NEXT_HEADING_RE = /^##[ \t]+/m;

/**
 * A `**Label**` marker, with or without a colon, inside the bold or after it.
 *
 * Both spellings are real: 2026-09-06 writes `**Post text**`, 2026-09-07 writes
 * `**Post text:**`. Nothing guarantees which you get, so accept both rather than lose a
 * day's drafts to a colon.
 */
function labelMarker(label: string): RegExp {
  return new RegExp(String.raw`^\*\*${label}:?\*\*:?[ \t]*$`, 'm');
}

/**
 * Unwrap a markdown blockquote.
 *
 * `> ` prefixes go, a bare `>` is a blank line, and everything else survives untouched —
 * including the line breaks, which carry meaning in an X post (ROUTINE.md: "Two to four
 * short lines. Blank line between them.").
 */
export function unquote(block: string): string {
  return block
    .split('\n')
    .map((l) => l.replace(/^[ \t]*>[ \t]?/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The blockquote that follows a `**Label**` marker, or null when there isn't one. */
function labelledQuote(section: string, label: string): string | null {
  const marker = labelMarker(label);
  const at = section.search(marker);
  if (at === -1) return null;
  const after = section.slice(at).replace(marker, '');
  const out: string[] = [];
  let started = false;
  for (const line of after.split('\n')) {
    if (/^[ \t]*>/.test(line)) {
      started = true;
      out.push(line);
      continue;
    }
    if (started) break;
    // Skip the blank line between label and quote; anything else means there is no quote.
    if (line.trim() !== '') break;
  }
  return unquote(out.join('\n')) || null;
}

/** The bullets under `**Chart spec**`, up to the next `**Label**` or `###`. */
function chartSpecOf(section: string): string | null {
  const marker = labelMarker('Chart spec');
  const at = section.search(marker);
  if (at === -1) return null;
  // Strip only the marker LINE. Bullets may follow immediately (2026-09-07) or after a
  // blank line (2026-09-06); the trim below covers both.
  const after = section.slice(at).replace(marker, '');
  const end = after.search(/^(?:\*\*[A-Z]|###[ \t])/m);
  return (end === -1 ? after : after.slice(0, end)).trim() || null;
}

/** First `- **Label…:** value` line in the angle header. */
function headerField(angleHeader: string, label: string): string | null {
  const m = angleHeader.match(
    new RegExp(String.raw`^-[ \t]+\*\*${label}[^*]*\*\*[:\s]*(.+?)[ \t]*$`, 'm'),
  );
  return m ? m[1].trim() : null;
}

function pickSection(markdown: string): string | null {
  const at = markdown.search(PICK_RE);
  if (at === -1) return null;
  const after = markdown.slice(at).replace(PICK_RE, '');
  const end = after.search(NEXT_HEADING_RE);
  return (end === -1 ? after : after.slice(0, end)).trim() || null;
}

export function parseXDrafts(markdown: string): ParsedContentFile {
  const warnings: string[] = [];
  const drafts: XDraft[] = [];
  const pick = pickSection(markdown);
  if (!pick) warnings.push('No "## ⭐ Post this one today" block found.');

  // Collect angle spans first, so each body is bounded by the NEXT angle heading rather
  // than by a subheading that might legitimately repeat inside one.
  const heads: { angle: number; title: string; start: number; end: number }[] = [];
  ANGLE_RE.lastIndex = 0;
  for (let m = ANGLE_RE.exec(markdown); m; m = ANGLE_RE.exec(markdown)) {
    heads.push({
      angle: Number(m[1]),
      title: m[2],
      start: m.index + m[0].length,
      end: markdown.length,
    });
  }
  for (let i = 0; i < heads.length - 1; i++) {
    heads[i].end = markdown.lastIndexOf('\n## Angle', heads[i + 1].start);
  }

  if (heads.length === 0) {
    warnings.push('No "## Angle N — title" headings found — has ROUTINE.md changed shape?');
    return { pick, drafts, warnings };
  }

  for (const head of heads) {
    const body = markdown.slice(head.start, head.end);
    const xAt = body.search(X_HEADING_RE);
    if (xAt === -1) {
      warnings.push(`Angle ${head.angle} (${head.title}): no X section found.`);
      continue;
    }
    const headingMatch = body.slice(xAt).match(X_HEADING_RE);
    const afterHeading = body.slice(xAt).replace(X_HEADING_RE, '');
    const endsAt = afterHeading.search(NEXT_SUBHEADING_RE);
    const section = endsAt === -1 ? afterHeading : afterHeading.slice(0, endsAt);

    const post = labelledQuote(section, 'Post text');
    if (!post) warnings.push(`Angle ${head.angle} (${head.title}): X section has no post text.`);

    drafts.push({
      angle: head.angle,
      title: head.title,
      format: headingMatch?.[1]?.trim() ?? '',
      figure: headerField(body.slice(0, xAt), 'Figure'),
      sourceUrl: headerField(body.slice(0, xAt), 'Source URL'),
      chartSpec: chartSpecOf(section),
      post,
      altText: labelledQuote(section, 'Alt text'),
    });
  }

  return { pick, drafts, warnings };
}
