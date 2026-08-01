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
import { useRouter } from "next/navigation";
import { Search, X, Home, Hash, MapPin, GraduationCap, Navigation, Sparkles, Crosshair, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useOpenListing } from "@/hooks/useOpenListing";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { priceConfig } from "@/lib/filters/fundamentals";
import { federatedSuggest } from "@/lib/search/federatedSuggest";
import { fetchChipPreview, type ChipPreview } from "@/lib/search/chipPreview";
import { schoolScoreField } from "@/lib/schools/schoolLens";
import { parseNlQuery } from "@/lib/search/nlParse";
import { syncChips } from "@/lib/search/chipApply";
import { rankListings, type RankBadge } from "@/lib/search/personaRank";
import { compsAnchorForListing } from "@/lib/comps/compsAnchor";
import { getRecents, pushRecent, clearRecents, type RecentSearch } from "@/lib/search/recents";
import { addressProfileHref } from "@/lib/search/searchTarget";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";
import { expandableCityGroupFor } from "@/lib/regions/cityGroups";
import { SUGGEST_MIN_CHARS, SUGGEST_DEBOUNCE_MS, SEARCH_DEBUG } from "@/lib/search/searchConfig";
import { recordParse, parseMissRate } from "@/lib/search/parseMetrics";
import type { SuggestGroup, SuggestItem, ParsedQuery } from "@/lib/search/types";
import type { ListingDocument } from "@/lib/typesense/client";
import SearchChipsRow from "./search/SearchChipsRow";
import SearchAnswerCard from "./search/SearchAnswerCard";
import SearchEmptyState, { type WatchedArea } from "./search/SearchEmptyState";

interface Props {
  className?: string;
  placeholder?: string;
}

const TONE: Record<RankBadge["tone"], string> = {
  drop: "text-rose-700 dark:text-rose-300 border-rose-500/30 bg-rose-500/10",
  stale: "text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10",
  dom: "text-foreground border-border bg-muted/60",
  cap: "text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  yield: "text-cyan-700 dark:text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  carry: "text-foreground border-border bg-muted/60",
  lot: "text-cyan-700 dark:text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  zoning: "text-violet-700 dark:text-violet-300 border-violet-500/30 bg-violet-500/10",
};

function CategoryIcon({ category }: { category: SuggestItem["category"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (category === "address") return <Home className={cn(cls, "text-emerald-700 dark:text-emerald-400/80")} />;
  if (category === "mls") return <Hash className={cn(cls, "text-muted-foreground")} />;
  if (category === "community") return <MapPin className={cn(cls, "text-cyan-700 dark:text-cyan-400/80")} />;
  if (category === "school") return <GraduationCap className={cn(cls, "text-amber-700 dark:text-amber-400/80")} />;
  if (category === "geo") return <Navigation className={cn(cls, "text-cyan-700 dark:text-cyan-400")} />;
  if (category === "soldAddress") return <Home className={cn(cls, "text-rose-700 dark:text-rose-400/80")} />;
  return <span className="block h-2 w-2 shrink-0 rounded-full bg-rose-400" />; // sold
}

export default function LocationSearchV2({ className, placeholder: placeholderProp }: Props) {
  const router = useRouter();
  const location = useCommandCenterStore((s) => s.location);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const searchVisibleArea = useCommandCenterStore((s) => s.searchVisibleArea);
  const totalCount = useCommandCenterStore((s) => s.totalCount);
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const setFlyTo = useCommandCenterStore((s) => s.setFlyTo);
  const setSearchPin = useCommandCenterStore((s) => s.setSearchPin);
  const enterComps = useCommandCenterStore((s) => s.enterComps);
  const exitComps = useCommandCenterStore((s) => s.exitComps);
  const toggleLayer = useCommandCenterStore((s) => s.toggleLayer);
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const setFilter = useCommandCenterStore((s) => s.setFilter);
  const setSchool = useCommandCenterStore((s) => s.setSchool);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const removeAddedFilter = useCommandCenterStore((s) => s.removeAddedFilter);
  const commute = useCommandCenterStore((s) => s.commute);
  const school = useCommandCenterStore((s) => s.school);
  // The active school lens's indexed field — so a school chip previews on the SAME field
  // Apply filters on (otherwise the preview count diverges from the applied result).
  const schoolField = schoolScoreField(school.level, school.system);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const openListing = useOpenListing();
  const authed = useIsAuthed();

  const [value, setValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [groups, setGroups] = React.useState<SuggestGroup[]>([]);
  const [parsed, setParsed] = React.useState<ParsedQuery | null>(null);
  // Real filtered preview for a structured query ("N listings match these chips").
  const [preview, setPreview] = React.useState<ChipPreview | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [highlight, setHighlight] = React.useState(-1);
  const [recents, setRecents] = React.useState<RecentSearch[]>([]);
  // Dev-only: live parser diagnostics (chips read + words unmatched) for the overlay.
  const [parseMeta, setParseMeta] = React.useState<{ chips: number; unmatched: string } | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

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
      setParseMeta(null);
      setPreview(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      // Cancel any in-flight suggest so keystrokes don't saturate the connection
      // pool, and fail fast (8s) rather than hang on the client's 30s timeout.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const failFast = setTimeout(() => ctrl.abort(), 8000);
      const mine = ++reqId.current;
      const p = parseNlQuery(q);
      setParsed(p.isStructured ? p : null);
      if (SEARCH_DEBUG) setParseMeta({ chips: p.chips.length, unmatched: p.unmatched });
      try {
        const [g, pv] = await Promise.all([
          // Structured → federatedSuggest skips the raw address/geo/sold paths (they read
          // the sentence literally); the chip preview is the real answer.
          federatedSuggest(q, ctrl.signal, { structured: p.isStructured }),
          p.isStructured ? fetchChipPreview(p.chips, schoolField, ctrl.signal) : Promise.resolve(null),
        ]);
        if (mine !== reqId.current) return; // a newer keystroke won
        setGroups(g);
        setPreview(pv);
      } catch {
        if (mine === reqId.current) { setGroups([]); setPreview(null); } // aborted / slow
      } finally {
        clearTimeout(failFast);
        if (mine === reqId.current) {
          setHighlight(-1);
          setSearching(false);
          setOpen(true);
        }
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, schoolField]);

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
      case "soldAddress":
        // This exact address has a sale record → its keyed /address page (sale hero +
        // property history). The href is server-built; fall back to the profile ladder.
        router.push(item.sold?.href ?? addressProfileHref(item.label) ?? "/properties");
        remember(item.label, "address");
        break;
    }
    setValue("");
    close();
  };

  // Comp-on-demand from a specific address row.
  const findComps = (item: SuggestItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // Constrain comps to the SUBJECT (same type + price band) via the shared anchor
    // helper — identical to the map popup + ledger entry points. zoom 14 (not 15) so the
    // viewport box around the address captures a few km of comps. enterComps switches to
    // a SOLD-only view so the count/list/pins all show the same constrained comps.
    const anchor = item.listing ? compsAnchorForListing(item.listing) : null;
    if (anchor) {
      setFlyTo({ lat: anchor.lat, lng: anchor.lng, zoom: 14 });
      enterComps({ ...anchor, label: item.label });
    } else if (item.geo) {
      setFlyTo({ lat: item.geo.lat, lng: item.geo.lng, zoom: 14 });
      enterComps({ lat: item.geo.lat, lng: item.geo.lng, label: item.label });
    }
    setValue("");
    close();
  };

  // "3 bd · 4 ba · Townhouse · $1,599,000" line under a preview sample.
  const previewMeta = (d: ListingDocument): string => {
    const parts: string[] = [];
    const beds = d.BedroomsAboveGrade || d.BedroomsTotal;
    if (beds) parts.push(`${beds} bd`);
    if (d.BathroomsTotalInteger) parts.push(`${d.BathroomsTotalInteger} ba`);
    if (d.PropertySubType) parts.push(d.PropertySubType.trim());
    if (d.ListPrice) parts.push(`$${d.ListPrice.toLocaleString("en-US")}`);
    return parts.join(" · ");
  };

  // Apply the parsed NL chips to the live query.
  const applyNl = (chips = parsed?.chips ?? []) => {
    if (!chips.length) return;
    if (SEARCH_DEBUG) recordParse({ q: value.trim(), chips: chips.length, unmatched: parsed?.unmatched ?? "" });
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
        ? `Search ${fmt} listings…`
        : "Search an address, community, school, or MLS#…");

  const flat = (item: SuggestItem) => flatItems.indexOf(item);
  // Address intent = a number that isn't part of a structured NL query ("3 bed…").
  const addrIntent = /\d/.test(value) && !parsed?.isStructured;
  const topCommunity = groups.find((g) => g.category === "community")?.items[0];
  // A parent city the query is reaching for (Toronto/London) whose whole-city scope
  // is reachable via the terminal's existing full-text location path — offers a
  // synthetic "all districts" row above the individual district facets.
  const cityGroup = expandableCityGroupFor(value);
  const locationChip = parsed?.chips.find((c) => c.kind === "location");
  const showAnswer = addrIntent || Boolean(topCommunity) || Boolean(locationChip);
  const answerArea =
    (locationChip?.value as string) ?? topCommunity?.label ?? (value.trim() ? value.trim() : "This area");

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form onSubmit={onSubmit}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            className="h-7 rounded-none border-border bg-card pl-9 pr-16 font-mono text-xs text-foreground placeholder:text-muted-foreground"
          />
          {parsed?.isStructured && (
            <span className="pointer-events-none absolute right-8 top-1/2 flex -translate-y-1/2 items-center gap-1 border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
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
                exitComps();
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[28rem] w-[440px] max-w-[92vw] overflow-y-auto border border-border bg-card shadow-2xl">
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
                searchVisibleArea();
                close();
              }}
            />
          ) : (
            <>
              {SEARCH_DEBUG && parseMeta && (
                <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1 font-mono text-[9px] text-muted-foreground">
                  <span className="text-muted-foreground">parser</span>
                  <span>
                    {parseMeta.chips} chip{parseMeta.chips === 1 ? "" : "s"}
                  </span>
                  {parseMeta.unmatched ? (
                    <span className="text-amber-700 dark:text-amber-400">· unmatched: “{parseMeta.unmatched}”</span>
                  ) : (
                    <span className="text-emerald-500/80">· all words read</span>
                  )}
                  {(() => {
                    const { total, misses } = parseMissRate();
                    return total > 0 ? (
                      <span className="ml-auto text-muted-foreground">
                        session miss {misses}/{total}
                      </span>
                    ) : null;
                  })()}
                </div>
              )}
              {parsed?.isStructured && <SearchChipsRow chips={parsed.chips} onRemove={removeChip} />}

              {/* Synthetic "whole city" row — TRREB has no single value for Toronto/London,
                  so this scopes the map to every district at once via the existing full-text
                  location path (setLocation of the parent name). Deliberately carries NO
                  per-community stats: it stands in for the group, not a single community. */}
              {cityGroup && (
                <button
                  type="button"
                  onClick={() => {
                    setLocation(cityGroup);
                    remember(cityGroup, "place");
                    setValue("");
                    close();
                  }}
                  className="flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <Layers className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-xs text-foreground">{cityGroup} — all districts</span>
                    <span className="truncate text-[10px] text-muted-foreground">Every district across the whole city</span>
                  </span>
                  <span className="shrink-0 border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                    City-wide
                  </span>
                </button>
              )}

              {showAnswer && <SearchAnswerCard area={answerArea} activeCount={topCommunity?.count} />}

              {/* Structured query → a PEEK at the real filtered matches (these honour the
                  chips, unlike the raw address list which is suppressed above). The samples
                  aren't individual links — tapping any of them APPLIES the filters and shows
                  the whole set on the map + ledger (same as the button below). */}
              {parsed?.isStructured && preview && (
                <div>
                  <div className="flex items-center justify-between px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Matching listings</span>
                    <span className="text-cyan-700 dark:text-cyan-400/80">{preview.count.toLocaleString()} match</span>
                  </div>
                  {preview.listings.length === 0 ? (
                    <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      No active listings match these filters.
                    </div>
                  ) : (
                    preview.listings.map((listing) => (
                      <button
                        key={listing.id}
                        type="button"
                        onClick={() => applyNl()}
                        title="See all matches on the map"
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted"
                      >
                        <Home className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400/80" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="line-clamp-2 font-mono text-xs text-foreground" title={listing.UnparsedAddress || undefined}>
                            {listing.UnparsedAddress || "—"}
                          </span>
                          <span className="truncate text-[10px] text-muted-foreground">{previewMeta(listing)}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {searching && groups.length === 0 && !(parsed?.isStructured && preview) && (
                <div className="px-3 py-3 font-mono text-xs text-muted-foreground">Searching…</div>
              )}
              {!searching && groups.length === 0 && !(parsed?.isStructured && preview) && (
                <div className="px-3 py-3 font-mono text-xs text-muted-foreground">
                  No matches for “{value.trim()}”. Try an address, community, school, or MLS#.
                </div>
              )}

              {groups.map((g) => (
                <div key={g.category}>
                  <div className="flex items-center justify-between px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>{g.title}</span>
                    {(g.category === "sold" || g.category === "soldAddress") && (
                      <span className="text-cyan-700 dark:text-cyan-400/80">VOW</span>
                    )}
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
                          idx === highlight ? "bg-muted" : "hover:bg-muted"
                        )}
                      >
                        <CategoryIcon category={item.category} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="line-clamp-2 font-mono text-xs text-foreground" title={item.label}>
                            {item.category === "community" ? formatRegionLabel(item.label) : item.label}
                          </span>
                          {item.sublabel && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {item.category === "sold" && authed
                                ? "See recent comparable sales on the map"
                                : item.sublabel}
                            </span>
                          )}
                          {/* Public record meta (shown to everyone): MLS# · brokerage. */}
                          {item.category === "soldAddress" && (item.sold?.mls || item.sold?.brokerage) && (
                            <span className="truncate font-mono text-[10px] text-muted-foreground/80" title={[item.sold?.mls, item.sold?.brokerage].filter(Boolean).join(" · ")}>
                              {[item.sold?.mls, item.sold?.brokerage].filter(Boolean).join(" · ")}
                            </span>
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
                            {authed ? (
                              <span className="border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                                View
                              </span>
                            ) : (
                              <>
                                <span className="select-none font-mono text-xs text-rose-700 dark:text-rose-300 blur-[4px]">
                                  $6XX,XXX
                                </span>
                                <span className="bg-cyan-500 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-950">
                                  Unlock
                                </span>
                              </>
                            )}
                          </span>
                        )}
                        {/* Sold-record row: status chip + (consumer) close price/date. When
                            no price is attached — an OFF MARKET record never closed, or the
                            viewer isn't a VOW consumer — an authed user gets a neutral "View"
                            (never an anon sign-in nudge), anon gets the sign-in CTA. The anon
                            payload never carried a price or date, so there is nothing to mask,
                            only to advertise (audit R24a). */}
                        {item.category === "soldAddress" && (
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            <span
                              className={cn(
                                "border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                                item.sold?.kindLabel === "LEASED"
                                  ? "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                                  : item.sold?.kindLabel === "OFF MARKET"
                                    ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                    : "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                              )}
                            >
                              {item.sold?.kindLabel ?? "SOLD"}
                            </span>
                            {item.sold?.priceLabel ? (
                              <span className="font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-400">
                                {item.sold.priceLabel}
                                {item.sold.dateLabel && (
                                  <span className="ml-1 font-normal text-muted-foreground">{item.sold.dateLabel}</span>
                                )}
                              </span>
                            ) : authed ? (
                              <span className="border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                                View
                              </span>
                            ) : (
                              <span className="bg-cyan-500 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-950">
                                Sign in for price
                              </span>
                            )}
                          </span>
                        )}
                        {item.category === "community" && item.count !== undefined && (
                          <span className="shrink-0 font-mono text-[11px] text-cyan-700 dark:text-cyan-400">
                            {item.count.toLocaleString()}
                          </span>
                        )}
                        {item.category === "address" && item.geo && (
                          <span
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => findComps(item, e)}
                            className="hidden shrink-0 items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-cyan-500/50 hover:text-cyan-300 group-hover:flex"
                          >
                            <Crosshair className="h-2.5 w-2.5" />
                            Comparable sales
                          </span>
                        )}
                        {/* Geocoded address (no listing anywhere) → its address-profile page
                            (ADDRESS_PROFILES_PLAN P4). Fly-to+pin stays the primary action
                            (the row itself). Rendered as a SOLID button with an action verb —
                            the old ghost "Profile" chip read as a status tag and nobody
                            realized it was clickable (owner, 2026-07-24). Always visible
                            (not hover-gated): it's the only touch-reachable path to the
                            profile from the terminal. */}
                        {item.category === "geo" && addressProfileHref(item.label) && (
                          <span className="flex shrink-0 items-center gap-1.5">
                            {/* Bordered Map button deliberately does NOT stop propagation —
                                it labels the row's own fly-to action rather than duplicating
                                it. Same visual pair as the header dropdown (owner: make the
                                two destinations unmistakable). */}
                            <span
                              role="button"
                              tabIndex={-1}
                              className="flex items-center gap-1 border border-cyan-500/50 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-700 transition-colors hover:border-cyan-400 hover:bg-cyan-500/10 dark:text-cyan-300"
                            >
                              <MapPin className="h-3 w-3" />
                              Map
                            </span>
                            <span
                              role="button"
                              tabIndex={-1}
                              onClick={(e) => {
                                e.stopPropagation();
                                const href = addressProfileHref(item.label);
                                if (href) router.push(href);
                              }}
                              className="flex items-center gap-1 bg-cyan-500 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
                            >
                              <Home className="h-3 w-3" />
                              Profile
                            </span>
                          </span>
                        )}
                        {item.provenance && item.category !== "sold" && item.category !== "soldAddress" && item.category !== "community" && (
                          <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:group-hover:hidden sm:block">
                            {item.category === "address" ? "for sale" : item.provenance}
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
                  className="sticky bottom-0 flex w-full items-center justify-center gap-2 border-t border-border bg-cyan-500 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
                >
                  <Sparkles className="h-3 w-3" />
                  {preview && preview.count > 0
                    ? `See all ${preview.count.toLocaleString()} matches on the map`
                    : `Apply ${parsed.chips.length} filters`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
