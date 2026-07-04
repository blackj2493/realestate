"use client";

/**
 * Property Data Sheet — chip-nav + 2-column accordion grid (spec 2026-06-12).
 *
 * Server page resolves the registry (buildDatasheet) and passes plain JSON;
 * this island owns ONLY collapse state and chip scroll-jumps. All group
 * content is server-rendered open (crawlers / no-JS see every field); we
 * collapse the long tail on mobile after mount (progressive enhancement).
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ExternalLink, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolvedGroup } from "@/lib/property/datasheet";

export default function PropertyDataSheet({ groups }: { groups: ResolvedGroup[] }) {
  // SSR + first paint: everything open. After mount, collapse all but the
  // first group on small screens (matches spec: mobile = 9 tappable headers).
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.group.id, true])),
  );
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      // SSR renders all groups open (SEO); the mobile collapse is a deliberate
      // post-mount progressive enhancement, not derivable state.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount collapse
      setOpen((prev) => {
        const next = { ...prev };
        groups.forEach((g, i) => {
          next[g.group.id] = i === 0;
        });
        return next;
      });
    }
    // groups identity is stable per page load (server-resolved prop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (groups.length === 0) return null;

  const jumpTo = (id: string) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    // open first so the scroll target has its final height
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior, block: "start" });
    });
  };

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
        <Table2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        Property Data Sheet
      </h3>
      <p className="mb-3 text-[10px] text-muted-foreground">
        Information deemed reliable but is not guaranteed accurate by PROPTX.
      </p>

      {/* Chip nav — tab-like wayfinding without hiding content */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap">
        {groups.map(({ group, rows }) => {
          const isRisk = group.id === "risk";
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => jumpTo(group.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 font-mono text-xs transition-colors",
                isRisk
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {isRisk && <span aria-hidden="true">⚠ </span>}
              {group.title} · {rows.length}
            </button>
          );
        })}
      </div>

      {/* 2-col accordion card grid */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {groups.map(({ group, rows }) => {
          const isRisk = group.id === "risk";
          const isOpen = open[group.id] ?? true;
          return (
            <section
              key={group.id}
              id={`datasheet-${group.id}`}
              ref={(el) => {
                sectionRefs.current[group.id] = el;
              }}
              className={cn(
                "scroll-mt-6 rounded-lg border bg-card/30",
                isRisk ? "border-amber-500/30" : "border-border",
              )}
            >
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                aria-expanded={isOpen}
                aria-controls={`datasheet-${group.id}-panel`}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span
                  className={cn(
                    "flex items-center gap-2 text-xs font-semibold uppercase tracking-wider",
                    isRisk ? "text-amber-700 dark:text-amber-300" : "text-foreground",
                  )}
                >
                  {isRisk && <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
                  {group.title}
                  <span className="font-mono font-normal text-muted-foreground">· {rows.length}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isOpen ? "rotate-180" : "rotate-0",
                  )}
                />
              </button>
              {/* hidden (not unmounted): SSR HTML keeps all field values in the DOM for crawlers */}
              <div
                id={`datasheet-${group.id}-panel`}
                className={cn("px-4 pb-4", !isOpen && "hidden")}
              >
                <div className="grid grid-cols-1 gap-y-2">
                  {rows.map((row) => (
                    <div key={row.key} className="flex items-baseline justify-between gap-4">
                      <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
                      {row.href ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 px-2.5 py-0.5 font-mono text-xs text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
                        >
                          {row.value}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span
                          className={cn(
                            "min-w-0 break-words text-right font-mono text-sm",
                            row.flagged ? "text-amber-700 dark:text-amber-300" : "text-foreground",
                          )}
                        >
                          {row.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
