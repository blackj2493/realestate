/**
 * The IDX feed's status filter for Query A (active inventory).
 *
 * Since about June 2026 PropTx sends a conditional deal as StandardStatus 'Active Under
 * Contract' (it used to be 'Active'). Query A asked only for 'Active', so a listing that
 * went conditional was never fetched again: its search doc kept the old "New" / "Price
 * Change" status and the home showed as plainly for sale. Measured 2026-11-03: 4,231
 * Active Under Contract on IDX, 4,228 of them one of the four statuses below; 40 of 40
 * recent conditional sales sampled sat in the index as New / Price Change.
 *
 * Conditional deals stay in search by product policy (NON_ACTIVE_STATUSES leaves them
 * out), with a "Sold Cond." chip and a line on the listing page. The filter names the
 * MlsStatus values exactly, so nothing else under Active Under Contract comes in.
 */
export const CONDITIONAL_MLS_STATUSES = [
  'Sold Conditional',
  'Sold Conditional Escape',
  'Leased Conditional',
  'Leased Conditional Escape',
] as const;

export const CONDITIONAL_STATUS_FILTER =
  `(StandardStatus eq 'Active Under Contract' and (` +
  CONDITIONAL_MLS_STATUSES.map((s) => `MlsStatus eq '${s}'`).join(' or ') +
  `))`;

/** Query A: live inventory, including conditional deals. */
export const ACTIVE_STATUS_FILTER = `(StandardStatus eq 'Active' or ${CONDITIONAL_STATUS_FILTER})`;
