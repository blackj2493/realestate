/**
 * FeatureGuide — the searchable catalogue of everything the terminal can do.
 *
 * One surface that composes the discovery system's pillars:
 *  • "On this page" — features for the current route, persona-ordered (a Cashflow
 *    user sees cap-rate tools first; a Flipper sees the DOM timeline).
 *  • "What's new" — recently-shipped features; viewing the tab clears the badge.
 *  • "All" — the full catalogue, searchable.
 *  • A mastery meter ("you've explored N of M tools") that nudges depth.
 * Each row's "Show me" fires a Spotlight at the real control; off-page features
 * offer "Open" instead. Opened via the floating launcher or the `?` hotkey.
 */

"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Search, X, Sparkles, Check, ExternalLink, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDiscovery, type GuideTab } from "@/lib/discovery/useDiscovery";
import {
  FEATURES,
  featuresForPath,
  newFeatures,
  masteryUniverse,
  surfaceForPath,
  type FeatureWithCta,
} from "@/lib/discovery/featureRegistry";
import { getConfig } from "@/lib/dashboard/config";
import type { PersonaType } from "@/lib/personas/personaConfig";

const TABS: { id: GuideTab; label: string }[] = [
  { id: "page", label: "On this page" },
  { id: "new", label: "What's new" },
  { id: "all", label: "All features" },
];

export default function FeatureGuide() {
  const open = useDiscovery((s) => s.guideOpen);
  const tab = useDiscovery((s) => s.guideTab);
  const setTab = useDiscovery((s) => s.setGuideTab);
  const close = useDiscovery((s) => s.closeGuide);
  const seen = useDiscovery((s) => s.seen);
  const used = useDiscovery((s) => s.used);
  const showFeature = useDiscovery((s) => s.showFeature);
  const markSeen = useDiscovery((s) => s.markSeen);
  const markUsed = useDiscovery((s) => s.markUsed);

  const pathname = usePathname() || "/";
  const [persona, setPersona] = React.useState<PersonaType | undefined>(undefined);
  const [query, setQuery] = React.useState("");

  // Read the user's persona (best-effort, client-only) whenever the guide opens.
  React.useEffect(() => {
    if (open) setPersona(getConfig().persona);
  }, [open]);

  // Viewing "What's new" acknowledges those features (clears the launcher badge).
  React.useEffect(() => {
    if (open && tab === "new") {
      markSeen(newFeatures().map((f) => f.id));
    }
  }, [open, tab, markSeen]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const currentSurface = surfaceForPath(pathname);

  const list: FeatureWithCta[] = React.useMemo(() => {
    let base: FeatureWithCta[];
    if (tab === "page") base = featuresForPath(pathname, persona);
    else if (tab === "new") base = newFeatures();
    else base = FEATURES;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.blurb.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    );
  }, [tab, pathname, persona, query]);

  const mastery = React.useMemo(() => {
    const universe = masteryUniverse();
    const explored = universe.filter((f) => used[f.id] !== undefined).length;
    return { explored, total: universe.length };
  }, [used]);

  const newIds = React.useMemo(() => new Set(newFeatures().map((f) => f.id)), []);

  if (!open || typeof document === "undefined") return null;

  const masteryPct = mastery.total ? Math.round((mastery.explored / mastery.total) * 100) : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-slate-950/70 p-3 pt-[8vh] backdrop-blur-sm sm:p-4"
      onClick={close}
    >
      <div
        className="pp-fade-up flex max-h-[84vh] w-full max-w-2xl flex-col border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + mastery meter */}
        <div className="border-b border-slate-800 px-4 pt-3.5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <h2 className="terminal-font text-sm font-semibold uppercase tracking-wider text-slate-100">
                Feature Guide
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close feature guide"
              className="-mr-1 inline-flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-cyan-400 transition-all duration-500"
                style={{ width: `${masteryPct}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[11px] text-slate-400">
              {mastery.explored}/{mastery.total} tools explored
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-slate-800 px-4">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search features…"
            className="h-11 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-800 px-2">
          {TABS.map((t) => {
            const active = t.id === tab;
            const badge = t.id === "new" ? newFeatures().filter((f) => seen[f.id] === undefined).length : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative px-3 py-2.5 text-xs font-medium transition-colors",
                  active ? "text-cyan-200" : "text-slate-400 hover:text-slate-200"
                )}
              >
                {t.label}
                {badge > 0 && (
                  <span className="ml-1.5 rounded-full bg-rose-500/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                    {badge}
                  </span>
                )}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-cyan-400" />}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-slate-500">
              {tab === "new" ? "You're all caught up — no new features." : "No matching features."}
            </p>
          ) : (
            list.map((f) => {
              const Icon = f.icon;
              const onThisPage = f.surfaces.includes(currentSurface);
              const isNew = newIds.has(f.id);
              const isUsed = used[f.id] !== undefined;
              return (
                <div
                  key={f.id}
                  className="flex items-start gap-3 border-b border-slate-800/60 px-4 py-3 last:border-b-0"
                >
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center border border-slate-700 bg-slate-800/60 text-slate-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-100">{f.title}</p>
                      {isNew && (
                        <span className="shrink-0 rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                          New
                        </span>
                      )}
                      {isUsed && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                      {f.shortcut && (
                        <kbd className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                          {f.shortcut}
                        </kbd>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-snug text-slate-400">{f.blurb}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{f.category}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {onThisPage ? (
                      <button
                        type="button"
                        onClick={() => showFeature(f.id)}
                        className="inline-flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                      >
                        <Crosshair className="h-3.5 w-3.5" /> Show me
                      </button>
                    ) : f.href ? (
                      <Link
                        href={f.href}
                        onClick={() => {
                          markUsed(f.id);
                          close();
                        }}
                        className="inline-flex items-center gap-1.5 border border-slate-600 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-cyan-500/50 hover:text-cyan-200"
                      >
                        {f.ctaLabel ?? "Open"} <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => showFeature(f.id)}
                        className="inline-flex items-center gap-1.5 border border-slate-600 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-cyan-500/50 hover:text-cyan-200"
                      >
                        <Crosshair className="h-3.5 w-3.5" /> Show me
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2.5 text-[11px] text-slate-500">
          <span>
            Press{" "}
            <kbd className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">?</kbd>{" "}
            anytime to reopen
          </span>
          <Link href="/glossary" onClick={close} className="text-slate-400 transition-colors hover:text-cyan-200">
            Open glossary →
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}
