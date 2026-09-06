/**
 * Every scheduled workflow here builds its operator email by piping the worker's output
 * through `tee`:
 *
 *     run: npx tsx scripts/worker/thing.ts 2>&1 | tee -a "$SUMMARY_FILE"
 *
 * GitHub's DEFAULT run shell is `bash -e` with NO pipefail, so the step exits with the
 * status of the LAST command in the pipeline — tee — which is always 0. The worker can
 * exit 1 and the job still goes green and emails "completed OK".
 *
 * That was not hypothetical. `monitor-avm-accuracy` exists to shout when the AVM drifts,
 * and avmDriftCheck.ts shouts by exiting 1 (scripts/worker/avmDriftCheck.ts) — an exit
 * this swallowed. `retrain-avm` would likewise have reported success for a trainer that
 * threw on a dead feature, letting the backtest score a stale staging table and the gate
 * promote it. Twelve workflows were in that state on 2026-09-06 (PR #498).
 *
 * The fix per workflow is `shell: bash` (which is `bash --noprofile --norc -eo pipefail`)
 * or an explicit `set -o pipefail` in a multi-line run block.
 *
 * SCOPE: this is a FILE-level check, not a step-level one. It proves a workflow that pipes
 * into tee carries a pipefail guard somewhere; it cannot prove the guard covers the
 * particular step. Job-level `defaults.run.shell` — the form this repo standardised on —
 * does cover every step, which is why that is the form to reach for.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';

const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ name: f, src: readFileSync(join(DIR, f), 'utf8') }));

/** Steps that pipe into tee are the ones whose exit status a missing pipefail hides. */
const piped = workflows.filter((w) => /\|\s*tee\b/.test(w.src));

describe('workflows: a piped step must not swallow its exit status', () => {
  it('finds the workflows to check (guards the glob itself)', () => {
    expect(workflows.length).toBeGreaterThan(10);
    expect(piped.length).toBeGreaterThan(0);
  });

  it.each(piped.map((w) => w.name))('%s guards the pipeline with pipefail', (name) => {
    const { src } = piped.find((w) => w.name === name)!;
    const guarded = /^\s*shell:\s*bash\s*$/m.test(src) || /set\s+-o\s+pipefail/.test(src);
    expect(
      guarded,
      `${name} pipes into tee but sets neither \`shell: bash\` nor \`set -o pipefail\`, so ` +
        'every piped step exits 0 no matter what the script did. Add to the job:\n\n' +
        '    defaults:\n      run:\n        shell: bash\n',
    ).toBe(true);
  });
});
