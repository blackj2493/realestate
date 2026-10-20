import { describe, it, expect } from 'vitest';
import {
  staleCheckoutReasons,
  DOCUMENT_SHAPING_PATHS,
  type CheckoutSignals,
} from './checkoutGuard';

const atTip: CheckoutSignals = { behind: 0, dirty: 0, branch: 'main', remoteUnknown: false };

describe('staleCheckoutReasons', () => {
  it('allows a checkout that sits at the tip with a clean tree', () => {
    expect(staleCheckoutReasons(atTip)).toEqual([]);
  });

  it('allows a feature branch that is merely AHEAD of main', () => {
    // Ahead is not behind. A branch with new ETL work still writes documents that
    // contain everything main writes, so it must not be refused.
    expect(staleCheckoutReasons({ ...atTip, branch: 'feat/new-rung' })).toEqual([]);
  });

  // Replays 2026-08-23: feat/email-comms, 387 commits behind, 20 modified worker files.
  it('refuses the checkout that rewrote 99.3% of the index', () => {
    const reasons = staleCheckoutReasons({
      behind: 387,
      dirty: 20,
      branch: 'feat/email-comms',
      remoteUnknown: false,
    });
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain('feat/email-comms');
    expect(reasons[0]).toContain('387');
    expect(reasons[1]).toContain('20');
  });

  it('refuses a lag of a single document-shaping commit', () => {
    const reasons = staleCheckoutReasons({ ...atTip, behind: 1 });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('1 commit(s) behind');
  });

  it('names the branch, or says so when HEAD is detached', () => {
    const named = staleCheckoutReasons({ ...atTip, behind: 4 });
    expect(named[0]).toContain("'main'");
    const detached = staleCheckoutReasons({ ...atTip, behind: 4, branch: null });
    expect(detached[0]).toContain('detached HEAD');
  });

  it('refuses uncommitted ETL edits even at the tip', () => {
    const reasons = staleCheckoutReasons({ ...atTip, dirty: 3 });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('not any reviewed commit');
  });

  it('refuses when origin/main could not be read, and reports nothing else', () => {
    // Unknown is not clean. A `behind: 0` that was never measured must not read as a pass,
    // and the fetch instruction must not compete with a lag number nobody trusts.
    const reasons = staleCheckoutReasons({
      behind: 0,
      dirty: 9,
      branch: 'main',
      remoteUnknown: true,
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('git fetch origin main');
  });

  it('names the paths it measured, so the reason can be acted on', () => {
    const reasons = staleCheckoutReasons({ ...atTip, behind: 2 });
    for (const p of DOCUMENT_SHAPING_PATHS) expect(reasons[0]).toContain(p);
  });
});
