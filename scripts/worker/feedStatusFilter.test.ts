import { describe, expect, it } from 'vitest';
import { ACTIVE_STATUS_FILTER, CONDITIONAL_STATUS_FILTER } from './feedStatusFilter';

describe('feed status filter', () => {
  it('asks for Active plus the four conditional statuses under Active Under Contract', () => {
    expect(CONDITIONAL_STATUS_FILTER).toBe(
      "(StandardStatus eq 'Active Under Contract' and (MlsStatus eq 'Sold Conditional' or " +
        "MlsStatus eq 'Sold Conditional Escape' or MlsStatus eq 'Leased Conditional' or " +
        "MlsStatus eq 'Leased Conditional Escape'))"
    );
    expect(ACTIVE_STATUS_FILTER).toBe(`(StandardStatus eq 'Active' or ${CONDITIONAL_STATUS_FILTER})`);
  });

  it('stays one parenthesized term, so "and ModificationTimestamp ..." binds to all of it', () => {
    let depth = 0;
    for (const [i, ch] of [...ACTIVE_STATUS_FILTER].entries()) {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      if (depth === 0) expect(i).toBe(ACTIVE_STATUS_FILTER.length - 1);
    }
  });
});
