/**
 * PulseLoader — the brand loading indicator: a market-pulse (EKG) line with a
 * cyan→emerald dash sweeping through it. Ties to the product's Pulse identity
 * (Home Pulse score, market pulse) instead of a generic spinner.
 *
 * Server-component-safe (pure markup + CSS; keyframes `pp-ekg` in globals.css).
 * Reduced motion renders the full static line. Works on both themes: the ghost
 * line uses a token colour; the sweep's cyan/emerald read on light and dark.
 *
 * Usage: route-level loading.tsx files (full-screen), or inline wherever a
 * section waits on data. `label` keeps it honest — say what's loading.
 */

const SIZES = { sm: "w-16", md: "w-24", lg: "w-36" } as const;

/** Heartbeat: flat → sharp up-spike → deep down-spike → flat. */
const PULSE_POINTS = "2,26 40,26 48,26 54,10 62,38 68,26 82,26 118,26";

export default function PulseLoader({
  size = "md",
  label,
  className = "",
}: {
  size?: keyof typeof SIZES;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className}`} role="status" aria-live="polite">
      <svg viewBox="0 0 120 44" className={`${SIZES[size]} overflow-visible`} aria-hidden="true">
        <defs>
          <linearGradient id="pp-loader-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#34d399" />
          </linearGradient>
        </defs>
        {/* ghost of the full pulse line, so the shape reads while the sweep travels */}
        <polyline
          points={PULSE_POINTS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-muted-foreground/25"
        />
        <polyline
          points={PULSE_POINTS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          stroke="url(#pp-loader-grad)"
          pathLength={100}
          className="pp-ekg"
        />
      </svg>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label ?? "Loading"}
      </span>
    </div>
  );
}
