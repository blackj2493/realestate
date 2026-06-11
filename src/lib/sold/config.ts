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

/** De-listed comps live in a 90-day Typesense window (design spec 2026-06-09). */
export const DELISTED_DISPLAY_MAX_DAYS = 90;

/** Clamp a requested window to [1, cap]; the cap depends on the comp kind.
 *  Existing 1-arg callers receive the sold/leased cap (unchanged behaviour). */
export function clampWindowDays(days: number, kind: "sold" | "leased" | "delisted" = "sold"): number {
  const cap = kind === "delisted" ? DELISTED_DISPLAY_MAX_DAYS : SOLD_DISPLAY_MAX_DAYS;
  if (!Number.isFinite(days)) return cap;
  return Math.min(cap, Math.max(1, Math.floor(days)));
}
