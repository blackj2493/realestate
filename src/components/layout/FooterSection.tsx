"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One column of the site footer.
 *
 * Below `sm` it is a closed disclosure. From `sm` up it is a plain always-open column
 * and the toggle is gone. The four columns stack to one on a phone, and the tracker
 * registry alone contributes nine links, so the open form ran past 1,400px of dead
 * scroll under every /data and (app) page.
 *
 * WHY THE OPEN STATE STARTS FALSE: the body ships as `hidden sm:block`, so a phone
 * paints it collapsed and a desktop paints it expanded — each correct before hydration,
 * so neither viewport jumps. Opening from an effect instead would collapse the footer
 * under the reader's thumb after first paint.
 *
 * WHY TWO LABELS: the heading is an `<h2>` on desktop and a `<button>` on mobile, and
 * only one of the two is in the accessibility tree at a time. A single button carried
 * across both breakpoints would announce `aria-expanded="false"` on desktop while its
 * links sat visible on the screen.
 *
 * The links stay in the served HTML at every width. Collapsing is a CSS state, not a
 * mount condition — a footer that dropped them from the markup would defeat the reason
 * it exists (see SiteFooter).
 */

const headingCls =
  "terminal-font text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground";

export default function FooterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className="border-b border-border/60 last:border-b-0 sm:border-b-0">
      <h2 className={cn(headingCls, "hidden sm:block")}>{title}</h2>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 py-3.5 text-left sm:hidden"
      >
        <span className={headingCls}>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      <ul
        id={bodyId}
        className={cn(
          "space-y-2 pb-4 sm:mt-3 sm:block sm:pb-0",
          open ? "block" : "hidden",
        )}
      >
        {children}
      </ul>
    </div>
  );
}
