"use client";

/**
 * Source line rendered inside every tracker table, directly UNDER the column headers.
 *
 * WHY THIS EXISTS. A tracker table's real distribution is the screenshot. It gets
 * posted to X, pasted into a Slack, dropped into a reporter's draft — and at that
 * point the page, the URL bar and any surrounding link are all gone. Links on the
 * social platforms are nofollow anyway, so an image carrying the source is the only
 * artefact that still points home after the table leaves the site. That makes this
 * line the cheapest attribution mechanism available, and the only one that keeps
 * working when somebody ELSE takes the screenshot, which is the case that matters.
 *
 * WHY UNDER THE HEADERS AND NOT ABOVE. People crop from the header row — it is the
 * top of the meaningful content, so it is where the rectangle naturally starts. Our
 * own first attempt at this was cropped exactly that way. Anything above the headers
 * is outside the frame of a typical crop; anything below them is inside it, because
 * a crop that excludes the headers has no readable table left. Putting it at the
 * bottom fails for the opposite reason: a 200-row list is always cropped before the
 * footer.
 *
 * The date rides along deliberately. It stops a figure being quoted as current two
 * years later, and it signals a maintained dataset rather than a one-off chart.
 *
 * Provided by TrackerShell (which owns the slug and the as-of date) and consumed by
 * RankingTable, so no board has to thread props through and any tracker added later
 * inherits it. Outside a provider the context is null and nothing renders.
 */
import { createContext, useContext, type ReactNode } from "react";

export interface TrackerAttribution {
  /** Display text, e.g. "pureproperty.ca/data/over-asking" — no protocol, no www. */
  label: string;
  /**
   * Pre-formatted on the server. Formatting a date in the client would risk a
   * hydration mismatch on a component that renders on every tracker page.
   */
  asOfLabel: string | null;
}

const Ctx = createContext<TrackerAttribution | null>(null);

export function TrackerAttributionProvider({
  value,
  children,
}: {
  value: TrackerAttribution;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTrackerAttribution(): TrackerAttribution | null {
  return useContext(Ctx);
}

/**
 * The rendered line. Small enough to sit quietly in the UI, legible enough to survive
 * a screenshot scaled down to a phone — which is the only size that matters here.
 */
export function AttributionStrip() {
  const attribution = useTrackerAttribution();
  if (!attribution) return null;

  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border bg-card/40 px-2 py-1">
      {/* Pinned like the label column beside it. Every board is wider than a phone, so
          an un-pinned source line scrolls off to the left the moment a reader drags the
          numbers sideways — and a screenshot taken in that state carries no URL at all,
          which is the one thing this line exists to prevent. */}
      <span className="terminal-font sticky left-0 bg-card px-2 py-1 -mx-2 -my-1 text-[10px] font-medium tracking-wide text-muted-foreground dark:bg-background">
        {attribution.label}
      </span>
      {attribution.asOfLabel && (
        <span className="terminal-font whitespace-nowrap text-[10px] tracking-wide text-muted-foreground">
          data as of {attribution.asOfLabel}
        </span>
      )}
    </div>
  );
}
