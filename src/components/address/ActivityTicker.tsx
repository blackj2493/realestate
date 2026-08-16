/**
 * ActivityTicker — the "this page is alive" strip under the address-profile hero.
 * Server component; the marquee is pure CSS (pp-tape). Content is duplicated once
 * so the -50% translate loops seamlessly.
 *
 * VOW gate: items are assembled by the caller. Anonymous callers pass a single
 * aggregate SOLD item (count only — "N sold nearby this month · sign in"); consumer
 * callers pass real per-sale items. This component renders whatever it's given and
 * fetches nothing.
 */
export interface TickerItem {
  kind: "new" | "cut" | "sold";
  text: string;
}

const KIND_CLS: Record<TickerItem["kind"], string> = {
  new: "text-cyan-700 dark:text-cyan-400",
  cut: "text-amber-600 dark:text-amber-400",
  sold: "text-emerald-700 dark:text-emerald-400",
};

const KIND_LABEL: Record<TickerItem["kind"], string> = { new: "NEW", cut: "CUT", sold: "SOLD" };

// Declared at module scope (not inside render) so it keeps a stable identity —
// a component created during render trips react-hooks/static-components and
// would reset its subtree state on every parent render.
function Tape({ items }: { items: TickerItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <span key={i} className="inline-flex shrink-0 items-baseline gap-2 whitespace-nowrap">
          <b className={`font-mono text-[10px] font-bold tracking-wider ${KIND_CLS[it.kind]}`}>{KIND_LABEL[it.kind]}</b>
          <span className="font-mono text-xs text-muted-foreground">{it.text}</span>
        </span>
      ))}
    </>
  );
}

export default function ActivityTicker({ items, radiusKm }: { items: TickerItem[]; radiusKm: number }) {
  if (items.length === 0) return null;
  return (
    <div
      className="mt-4 flex items-center overflow-hidden rounded-md border border-border bg-card/40"
      aria-label={`Recent listing activity within ${radiusKm} km`}
    >
      <span className="z-10 flex shrink-0 items-center gap-2 border-r border-border bg-card px-3.5 py-2 font-mono text-[10px] font-bold tracking-[0.18em] text-cyan-700 dark:text-cyan-400">
        <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-600 dark:bg-cyan-400" aria-hidden="true" />
        {radiusKm} KM
      </span>
      {/* Tape scrolls inside its own clipped track so it never slides under the chip.
          Two copies → seamless -50% loop; decorative duplication is aria-hidden. */}
      <div className="min-w-0 flex-1 overflow-hidden" aria-hidden="true">
        <div className="pp-tape flex w-max gap-10 pl-5">
          <Tape items={items} />
          <Tape items={items} />
        </div>
      </div>
    </div>
  );
}
