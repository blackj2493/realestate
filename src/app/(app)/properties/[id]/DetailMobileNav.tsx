"use client";

/**
 * DetailMobileNav — a sticky, scroll-spying section jumper for the listing
 * detail page on phones. The page is a long single-column scroll on mobile
 * (financials stack below the whole left column), so this lets the user jump
 * straight to Financials / History / Comps instead of scrolling past everything.
 * Desktop keeps the 70/30 layout and never sees this (md:hidden).
 *
 * Clicking a pill also fires `detail-open-section` so any collapsed
 * MobileCollapse with that id expands before we scroll to it.
 */

import React from "react";
import { cn } from "@/lib/utils";

export interface NavSection {
  id: string;
  label: string;
}

export default function DetailMobileNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = React.useState<string>(sections[0]?.id ?? "");

  React.useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).id);
      },
      // top offset clears the app header (56px) + this nav (~44px); bottom margin
      // makes a section "active" once it reaches the upper third of the viewport.
      { rootMargin: "-110px 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  const go = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // Expand the target if it's a CSS peer-checkbox collapse (e.g. History), then
    // scroll once it has its final height.
    const toggle = document.getElementById(`${id}-toggle`);
    if (toggle instanceof HTMLInputElement) toggle.checked = true;
    setActive(id);
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <nav className="sticky top-14 z-30 -mx-4 mb-4 border-b border-slate-800 bg-slate-950/95 backdrop-blur md:hidden">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => go(e, s.id)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              active === s.id ? "bg-cyan-500 text-slate-950" : "bg-slate-900 text-slate-400 active:bg-slate-800"
            )}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
