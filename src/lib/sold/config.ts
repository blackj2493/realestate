/**
 * Sold-comp display window. The 180-day cap is an ENGINEERING limit (the
 * `sold_listings` Typesense collection holds a rolling 180-day window — see
 * soldListingsSchema.ts). It is NOT a legal limit: neither TRREB agreement
 * (.claude/docs/legal/*.pdf) specifies a display duration; the binding rules live
 * in the un-repo'd "VOW Policy and Rules". Raising this beyond 180 also requires a
 * data-path change (read older comps from raw_vow_sold) — see the spec §6. Override
 * via env once the licensed window is confirmed with the Broker-of-Record / PROPTX.
 */
export const SOLD_DISPLAY_MAX_DAYS: number = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_SOLD_DISPLAY_MAX_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 180) : 180;
})();

/** Time-window dropdown options (days), filtered to the active cap. Default selection = max. */
export const SOLD_WINDOW_OPTIONS: number[] = [1, 3, 7, 30, 90, 180].filter(
  (d) => d <= SOLD_DISPLAY_MAX_DAYS
);

/** Clamp a requested window to [1, cap]; non-finite falls back to the cap. */
export function clampWindowDays(days: number): number {
  if (!Number.isFinite(days)) return SOLD_DISPLAY_MAX_DAYS;
  return Math.min(SOLD_DISPLAY_MAX_DAYS, Math.max(1, Math.floor(days)));
}
