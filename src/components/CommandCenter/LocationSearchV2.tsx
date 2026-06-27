/**
 * LocationSearchV2 — the reimagined terminal search bar (behind SEARCH_V2_ENABLED).
 *
 * One bar, five ideas:
 *   1. Natural-language → editable "AI PARSED" chips that drive the real query.
 *   2. Federated, categorized suggestions (Addresses · Communities · MLS · Geo).
 *   3. Persona-aware ranking + badges on address rows.
 *   4. Answer-card verdict for street/area queries (sold $ VOW-gated).
 *   5. Comp-on-demand from any address, plus a useful recents/watched empty state.
 *
 * Spatial intents fly the map (setFlyTo / setSearchPin); entity intents open the
 * listing. Sold prices are never rendered here — the sold rows are gated CTAs.
 */

"use client";

import React from "react";
import { Search, X, Home, Hash, MapPin, GraduationCap, Navigation, Sparkles, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useOpenListing } from "@/hooks/useOpenListing";
import { priceConfig } from "@/lib/filters/fundamentals";
import { federatedSuggest } from "@/lib/search/federatedSuggest";
import { parseNlQuery } from "@/lib/search/nlParse";
import { syncChips } from "@/lib/search/chipApply";
import { rankListings, type RankBadge } from "@/lib/search/personaRank";
import { getRecents, pushRecent, clearRecents, type RecentSearch } from "@/lib/search/recents";
import { SUGGEST_MIN_CHARS, SUGGEST_DEBOUNCE_MS } from "@/lib/search/searchConfig";
import type { SuggestGroup, SuggestItem, ParsedQuery } from "@/lib/search/types";
import SearchChipsRow from "./search/SearchChipsRow";
import SearchAnswerCard from "./search/SearchAnswerCard";
import SearchEmptyState, { type WatchedArea } from "./search/SearchEmptyState";

interface Props {
  className?: string;
  placeholder?: string;
}

const TONE: Record<RankBadge["tone"], string> = {
  drop: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  stale: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  dom: "text-slate-300 border-slate-600 bg-slate-800/60",
  cap: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  yield: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  carry: "text-slate-300 border-slate-600 bg-slate-800/60",
  lot: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  zoning: "text-violet-300 border-violet-500/30 bg-violet-500/10",
};

function CategoryIcon({ category }: { category: SuggestItem["category"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (category === "address") return <Home className={cn(cls, "text-emerald-400/80")} />;
  if (category === "mls") return <Hash className={cn(cls, "text-slate-400")} />;
  if (category === "community") return <MapPin className={cn(cls, "text-cyan-400/80")} />;
  if (category === "school") return <GraduationCap className={cn(cls, "text-amber-400/80")} />;
  if (category === "geo") return <Navigation className={cn(cls, "text-cyan-400")} />;
  return <span className="block h-2 w-2 shrink-0 rounded-full bg-rose-400" />; // sold
}

export default function LocationSearchV2({ className, placeholder: placeholderProp }: Props) {
  const location = useCommandCenterStore((s) => s.location);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const totalCount = useCommandCenterStore((s) => s.totalCount);
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const setFlyTo = useCommandCenterStore((s) => s.setFlyTo);
  const setSearchPin = useCommandCenterStore((s) => s.setSearchPin);
  const toggleLayer = useCommandCenterStore((s) => s.toggleLayer);
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const setFilter = useCommandCenterStore((s) => s.setFilter);
  const setSchool = useCommandCenterStore((s) => s.setSchool);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const removeAddedFilter = useCommandCenterStore((s) => s.removeAddedFilter);
  const commute = useCommandCenterStore((s) => s.commute);
  const school = useCommandCenterStore((s) => s.school);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const openListing = useOpenListing();

  const [value, setValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [groups, setGroups] = React.useState<SuggestGroup[]>([]);
  const [parsed, setParsed] = React.useState<ParsedQuery | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [highlight, setHighlight] = React.useState(-1);
  const [recents, setRecents] = React.useState<RecentSearch[]>([]);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = React.useRef(0);

  // Persona badges for address rows (computed from the listings already in hand).
  const badgeFor = React.useMemo(() => {
    const map = new Map<string, RankBadge[]>();
    const addr = groups.find((g) => g.category === "address");
    if (addr) {
      const listings = addr.items.map((i) => i.listing!).filter(Boolean);
      for (const r of rankListings(listings, activePersona)) map.set(r.listing.id, r.badges);
    }
    return map;
  }, [groups, activePersona]);

  // Flat list (in render order) for keyboard navigation.
  const flatItems = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced parse + federated suggest.
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < SUGGEST_MIN_CHARS) {
      setGroups([]);
      setParsed(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const mine = ++reqId.current;
      const p = parseNlQuery(q);
      setParsed(p.isStructured ? p : null);
      const g = await federatedSuggest(q);
      if (mine !== reqId.current) return; // a newer keystroke won
      setGroups(g);
      setHighlight(-1);
      setSearching(false);
      setOpen(true);
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };

  const remember = (label: string, kind: RecentSearch["kind"]) => {
    pushRecent({ label, kind });
  };

  // ── Selection handlers ────────────────────────────────────────────────────
  const selectItem = (item: SuggestItem) => {
    switch (item.category) {
      case "address":
      case "mls":
        if (item.geo) setFlyTo({ lat: item.geo.lat, lng: item.geo.lng, zoom: item.geo.zoom });
        if (item.listing) openListing(item.listing);
        remember(item.label, item.category === "mls" ? "mls" : "address");
        break;
      case "community":
        setLocation(item.label);
        remember(item.label, "place");
        break;
      case "geo":
        if (item.geo) {
          setFlyTo({ lat: item.geo.lat, lng: item.geo.lng, zoom: item.geo.zoom ?? 16 });
          setSearchPin({ lat: item.geo.lat, lng: item.geo.lng, label: item.label });
        }
        remember(item.label, "address");
        break;
      case "sold":
        // Comp-on-demand entry: light up the sold layer so comps render on the map.
        if (!activeLayers.has("sold")) toggleLayer("sold");
        break;
    }
    setValue("");
    close();
  };

  // Comp-on-demand from a specific address row.
  const findComps = (item: SuggestItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.geo) {
      setFlyTo({ lat: item.geo.lat, lng: item.geo.lng, zoom: 15 });
      setSearchPin({ lat: item.geo.lat, lng: item.geo.lng, label: item.label });
    }
    if (!activeLayers.has("sold")) toggleLayer("sold");
    setValue("");
    close();
  };

  // Apply the parsed NL chips to the live query.
  const applyNl = (chips = parsed?.chips ?? []) => {
    if (!chips.length) return;
    syncChips(chips, {
      setUniversalFilter,
      setFilter,
      setLocation,
      setSchool,
      addFilter,
      removeAddedFilter,
      priceBounds: priceConfig(transactionMode),
    });
    remember(value.trim(), "nl");
    setValue("");
    close();
  };

  const removeChip = (id: string) => {
    if (!parsed) return;
    const next = { ...parsed, chips: parsed.chips.filter((c) => c.id !== id) };
    setParsed(next.chips.length ? next : null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (open && highlight >= 0 && highlight < flatItems.length) {
      selectItem(flatItems[highlight]);
    } else if (parsed?.isStructured) {
      applyNl();
    } else if (value.trim()) {
      setLocation(value.trim());
      remember(value.trim(), "place");
      setValue("");
      close();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    const n = flatItems.length;
    if (open && n > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHighlight((p) => (e.key === "ArrowDown" ? (p + 1) % n : (p - 1 + n) % n));
    }
  };

  // ── Empty-state data ──────────────────────────────────────────────────────
  const openEmpty = () => {
    setRecents(getRecents());
    setOpen(true);
  };

  const watched: WatchedArea[] = React.useMemo(() => {
    const out: WatchedArea[] = [];
    if (drawPolygon) out.push({ id: "draw", label: "Drawn area", sub: "custom polygon on the map" });
    if (commute.enabled && commute.destination)
      out.push({
        id: "commute",
        label: `${commute.minutes}-min ${commute.mode} → ${commute.destination.label}`,
        sub: "commute zone",
      });
    if (school.enabled && school.minScore > 0)
      out.push({ id: "school", label: `Schools ≥ ${school.minScore}`, sub: "school-quality lens" });
    return out;
  }, [drawPolygon, commute, school]);

  const fmt = totalCount.toLocaleString();
  const placeholder =
    placeholderProp ??
    (location
      ? `${location}, ON  |  Search ${fmt} listings…`
      : totalCount > 0
        ? `Search ${fmt} listings — or describe it…`
        : "Search address, community, school, MLS# — or describe it…");

  const flat = (item: SuggestItem) => flatItems.indexOf(item);
  // Address intent = a number that isn't part of a structured NL query ("3 bed…").
  const addrIntent = /\d/.test(value) && !parsed?.isStructured;
  const topCommunity = groups.find((g) => g.category === "community")?.items[0];
  const locationChip = parsed?.chips.find((c) => c.kind === "location");
  const showAnswer = addrIntent || Boolean(topCommunity) || Boolean(locationChip);
  const answerArea =
    (locationChip?.value as string) ?? topCommunity?.label ?? (value.trim() ? value.trim() : "This area");

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form onSubmit={onSubmit}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => (value.trim().length >= SUGGEST_MIN_CHARS ? setOpen(true) : openEmpty())}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="h-7 rounded-none border-slate-800 bg-slate-900 pl-9 pr-16 font-mono text-xs text-slate-200 placeholder:text-slate-500"
          />
          {parsed?.isStructured && (
            <span className="pointer-events-none absolute right-8 top-1/2 flex -translate-y-1/2 items-center gap-1 border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
              <Sparkles className="h-2.5 w-2.5" />
              AI
            </span>
          )}
          {(value.length > 0 || location.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setLocation("");
                setValue("");
                setGroups([]);
                setParsed(null);
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[28rem] w-[384px] max-w-[92vw] overflow-y-auto border border-slate-700 bg-slate-900 shadow-2xl">
          {/* Empty state */}
          {value.trim().length < SUGGEST_MIN_CHARS ? (
            <SearchEmptyState
              recents={recents}
              watched={watched}
              onPickRecent={(r) => {
                setValue(r.label);
                setOpen(true);
              }}
              onPickWatched={() => close()}
              onClearRecents={() => {
                clearRecents();
                setRecents([]);
              }}
              onSearchThisArea={() => {
                setLocation("");
                close();
              }}
            />
          ) : (
            <>
              {parsed?.isStructured && <SearchChipsRow chips={parsed.chips} onRemove={removeChip} />}

              {showAnswer && (
                <SearchAnswerCard
                  area={answerArea}
                  activeCount={topCommunity?.count}
                  onUnlock={() => {
                    if (!activeLayers.has("sold")) toggleLayer("sold");
                    close();
                  }}
                />
              )}

              {searching && groups.length === 0 && (
                <div className="px-3 py-3 font-mono text-xs text-slate-500">Searching…</div>
              )}
              {!searching && groups.length === 0 && (
                <div className="px-3 py-3 font-mono text-xs text-slate-500">
                  No matches for “{value.trim()}”. Try an address, community, school, or MLS#.
                </div>
              )}

              {groups.map((g) => (
                <div key={g.category}>
                  <div className="flex items-center justify-between px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    <span>{g.title}</span>
                    {g.category === "sold" && <span className="text-cyan-400/80">VOW</span>}
                  </div>
                  {g.items.map((item) => {
                    const idx = flat(item);
                    const badges = item.listing ? badgeFor.get(item.listing.id) ?? [] : [];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => selectItem(item)}
                        className={cn(
                          "group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                          idx === highlight ? "bg-slate-800" : "hover:bg-slate-800"
                        )}
                      >
                        <CategoryIcon category={item.category} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-mono text-xs text-slate-200">{item.label}</span>
                          {item.sublabel && (
                            <span className="truncate text-[10px] text-slate-500">{item.sublabel}</span>
                          )}
                          {badges.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {badges.slice(0, 2).map((b, i) => (
                                <span
                                  key={i}
                                  className={cn("border px-1.5 py-0.5 font-mono text-[9px]", TONE[b.tone])}
                                >
                                  {b.label}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>

                        {item.category === "sold" && (
                          <span className="flex items-center gap-1.5">
                            <span className="select-none font-mono text-xs text-rose-300 blur-[4px]">$6XX,XXX</span>
                            <span className="bg-cyan-500 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-950">
                              Unlock
                            </span>
                          </span>
                        )}
                        {item.category === "community" && item.count !== undefined && (
                          <span className="shrink-0 font-mono text-[11px] text-cyan-400">
                            {item.count.toLocaleString()}
                          </span>
                        )}
                        {item.category === "address" && item.geo && (
                          <span
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => findComps(item, e)}
                            className="hidden shrink-0 items-center gap-1 border border-slate-700 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300 group-hover:flex"
                          >
                            <Crosshair className="h-2.5 w-2.5" />
                            Comps
                          </span>
                        )}
                        {item.provenance && item.category !== "sold" && item.category !== "community" && (
                          <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-600 sm:group-hover:hidden sm:block">
                            {item.provenance}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              {parsed?.isStructured && (
                <button
                  type="button"
                  onClick={() => applyNl()}
                  className="sticky bottom-0 flex w-full items-center justify-center gap-2 border-t border-slate-800 bg-cyan-500 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
                >
                  <Sparkles className="h-3 w-3" />
                  Apply {parsed.chips.length} filters
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
