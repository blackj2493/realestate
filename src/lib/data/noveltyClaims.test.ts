/**
 * Guards the prior-art rule declared at the top of `trackers.ts`.
 *
 * On 2026-08-14 two trackers shipped to production claiming to be the only source
 * for their metric. Both were false — Wahi has published a GTA overbid/underbid
 * report monthly since July 2022, and Door Insight publishes Toronto house rents
 * monthly. A reader who knows the prior art and catches us claiming novelty stops
 * trusting every other figure on the site, which costs far more than any single
 * metric is worth.
 *
 * The rule was already written down when it was broken, so writing it down again
 * is not the fix. This test is: novelty language in anything the public reads now
 * fails the build.
 *
 * State the DIFFERENCE instead — statistic, coverage, cadence, source — and name
 * who else measures it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Vitest runs from the project root (where vitest.config.ts lives). */
const ROOT = process.cwd();

/** Everything a visitor or a journalist actually reads. */
const SCANNED_DIRS = [
  'src/app/data',
  'src/app/embed',
  'src/lib/data',
];

const SCANNED_EXT = new Set(['.ts', '.tsx']);

/**
 * Phrases that assert nobody else publishes a metric. Deliberately narrow: bare
 * "the only" is fine ("the only thing we ask is a credit"), so each pattern names
 * the noun that makes it a novelty claim.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /nobody\s+(?:else\s+)?(?:publishes|measures|reports|has)\b/i, why: '"nobody publishes/measures/has"' },
  { pattern: /no\s+one\s+(?:else\s+)?(?:publishes|measures|reports)\b/i, why: '"no one publishes"' },
  { pattern: /no\s+other\s+(?:\w+\s+){0,2}source\b/i, why: '"no other (Canadian) source"' },
  { pattern: /no\s+canadian\s+source\b/i, why: '"no Canadian source"' },
  { pattern: /no\s+equivalent\b/i, why: '"no equivalent"' },
  { pattern: /no\s+published\s+figure\s+anywhere\b/i, why: '"no published figure anywhere"' },
  { pattern: /the\s+only\s+(?:\w+\s+){0,2}(?:source|tracker|dataset|publisher)\b/i, why: '"the only source/tracker"' },
  { pattern: /(?:first|only)\s+(?:in\s+canada|canadian)\s+to\s+publish\b/i, why: '"first in Canada to publish"' },
  { pattern: /never\s+been\s+published\b/i, why: '"never been published"' },
];

/**
 * Strip comments before scanning. The prior-art notes in `trackers.ts`,
 * `competitionBoard.ts` and `rentBoard.ts` quote the banned phrases on purpose —
 * they document what went wrong — so scanning them would fail on the very
 * comments that record the rule.
 *
 * Removes block comments, then whole-line `//` and JSDoc `*` continuations. It
 * deliberately does NOT strip trailing `//` comments mid-line, because that would
 * truncate `https://` URLs inside string literals and could hide a real claim
 * written after one.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out; // directory not present on this branch — nothing to scan
  }
  for (const entry of entries) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (SCANNED_EXT.has(path.extname(entry)) && !entry.endsWith('.test.ts')) out.push(rel);
  }
  return out;
}

describe('prior-art rule: no novelty claims in public copy', () => {
  const files = SCANNED_DIRS.flatMap((d) => walk(d));

  it('finds files to scan (guards against the glob silently breaking)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('no public /data or /embed copy claims to be the only source for a metric', () => {
    const violations: string[] = [];

    for (const file of files) {
      // Whitespace is collapsed across the WHOLE file before matching, not scanned
      // line by line. JSX prose wraps mid-sentence constantly — the original
      // "…no published / figure anywhere…" claim on the rents page straddled two
      // lines, and a per-line scan sailed straight past it.
      const body = stripComments(readFileSync(path.join(ROOT, file), 'utf8'))
        .replace(/\s+/g, ' ');

      for (const { pattern, why } of BANNED) {
        const hit = body.match(pattern);
        if (hit) {
          const at = body.indexOf(hit[0]);
          const context = body.slice(Math.max(0, at - 60), at + hit[0].length + 60).trim();
          violations.push(`${file} — ${why}\n    …${context}…`);
        }
      }
    }

    expect(
      violations,
      violations.length
        ? `Novelty claim(s) in public copy. Name who else measures it and state the ` +
            `difference (statistic / coverage / cadence / source) instead — see the ` +
            `PRIOR-ART GATE note in src/lib/data/trackers.ts.\n\n${violations.join('\n')}\n`
        : undefined,
    ).toEqual([]);
  });
});
