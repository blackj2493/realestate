import { describe, it, expect } from 'vitest';
import {
  concurrentWriterReasons,
  LIVE_WRITE_THRESHOLD,
  type WriterSignals,
} from './syncGuard';

const idle: WriterSignals = { running: [], liveWrites: 0 };

describe('concurrentWriterReasons', () => {
  it('allows the repair to start when nothing is writing', () => {
    expect(concurrentWriterReasons(idle)).toEqual([]);
  });

  it('refuses while a sync reports itself running', () => {
    const r = concurrentWriterReasons({ ...idle, running: [{ id: 'master', minutesAgo: 3 }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('master');
    expect(r[0]).toContain('running');
  });

  it('names every running cursor, not just the first', () => {
    const r = concurrentWriterReasons({
      ...idle,
      running: [{ id: 'master', minutesAgo: 2 }, { id: 'sold', minutesAgo: 9 }],
    });
    expect(r).toHaveLength(2);
    expect(r.join(' ')).toContain('sold');
  });

  /**
   * The OBSERVED signal exists because the REPORTED one can be wrong — a sync that
   * dies without updating sync_state leaves status='completed' while its last writes
   * are still landing. Live writes alone must be enough to refuse.
   */
  it('refuses on live writes even when sync_state looks idle', () => {
    const r = concurrentWriterReasons({ running: [], liveWrites: LIVE_WRITE_THRESHOLD });
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('written in the last');
  });

  it('ignores a trickle of incidental writes', () => {
    // One listing being edited, a webhook, a manual fix — not a sync. Refusing on
    // these would train people to pass --force by reflex, which costs the guard.
    expect(concurrentWriterReasons({ running: [], liveWrites: LIVE_WRITE_THRESHOLD - 1 })).toEqual([]);
  });

  it('reports both causes when both are present', () => {
    expect(
      concurrentWriterReasons({
        running: [{ id: 'active', minutesAgo: 1 }],
        liveWrites: 5_000,
      })
    ).toHaveLength(2);
  });

  it('formats the write count for humans', () => {
    const [reason] = concurrentWriterReasons({ running: [], liveWrites: 12_345 });
    expect(reason).toContain('12,345');
  });
});
