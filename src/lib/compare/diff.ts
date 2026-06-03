/**
 * Diff-mode helper. A row is "identical" (hidden when "show only differences" is
 * on) when every present, DISPLAYED value is the same string — comparing rendered
 * strings so two values that both display "$3,200/mo" collapse even if raw cents
 * differ. Fewer than 2 present values → identical (nothing to compare).
 */
export function rowIsIdentical(displayed: (string | null | undefined)[]): boolean {
  const present = displayed.filter((s): s is string => s != null && s !== "");
  if (present.length < 2) return true;
  return present.every((s) => s === present[0]);
}
