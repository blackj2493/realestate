/**
 * LocationSearch — the terminal search bar's typeahead.
 *
 * A debounced Typesense query surfaces, in priority order:
 *   • an exact MLS# match → opens that listing,
 *   • street-address matches → opens that listing,
 *   • cities / neighbourhoods with live active-listing counts → runs a location search.
 * Place selections set the store `location` (driving the existing debounced search);
 * address/MLS selections open the listing terminal via setSelectedProperty.
 * The bar also shows the live total count — empty → "Search 83,051 Active Listings…",
 * committed → "Hamilton, ON | Search …".
 */

"use client";

import React from "react";
import { Search, X, MapPin, Home, Hash, Sparkles, CornerDownLeft, Layers, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { suggestSearch, type SearchSuggestion } from "@/lib/typesense/client";
import { useRouter } from "next/navigation";
import { useOpenListing } from "@/hooks/useOpenListing";
import { resolveSuggestionTarget, resolveTextTarget, targetToHref, type SearchTarget } from "@/lib/search/searchTarget";
import { matchesTypedAddress, fetchAddressStatus } from "@/lib/search/federatedSuggest";
import {
  ROW_STATUS_CHIP,
  ROW_STATUS_LABEL,
  ROW_STATUS_TONE,
  SECTION_TITLE,
  backOnMarketLabel,
  formatRecordDate,
  formatRowPrice,
  activeRowStatus,
  listingMetaLine,
  listingSpecs,
  localityLabel,
  sectionForCategory,
  shouldProbeRecords,
} from "@/lib/search/searchRows";
import type { AddressRecordResponse } from "@/lib/search/types";
import { geocodeAddress } from "@/lib/search/geocodeClient";
import { parseNlQuery } from "@/lib/search/nlParse";
import { chipsToQueryString } from "@/lib/search/chipUrl";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";
import { expandableCityGroupFor } from "@/lib/regions/cityGroups";

interface LocationSearchProps {
  className?: string;
  /** "inplace" (default): mutate commandCenterStore (terminal reacts live).
   *  "navigate": router.push into /properties or the listing detail page. */
  mode?: "inplace" | "navigate";
  /** When provided, city/neighbourhood selections are handed to this callback
   *  instead of the mode's default handling (address/MLS picks still follow the
   *  mode). Lets pages like Market Trends capture a region without touching the
   *  terminal store or navigating away. */
  onPlace?: (label: string) => void;
  placeholder?: string;
}

function SuggestionIcon({ kind }: { kind: SearchSuggestion["kind"] }) {
  if (kind === "address") return <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  if (kind === "record") return <Home className="h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-400/80" />;
  if (kind === "mls") return <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  return <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

const KIND_TAG: Record<SearchSuggestion["kind"], string> = {
  city: "City",
  neighbourhood: "Area",
  address: "Address",
  mls: "MLS",
  // Record rows render a status chip instead of this tag — see the row body.
  record: "Record",
};

/** Row tag that says what the row IS: a with-listing address row is a live For-Sale
 *  listing; a listing-less address row is the geocoded address-profile fallback. */
function tagFor(s: SearchSuggestion): string {
  if (s.kind === "address") return s.listing ? "For sale" : "Profile";
  return KIND_TAG[s.kind];
}

/** Public record meta, shown to anon too: MLS# · brokerage (TRREB §6.3(c)). */
function recordSublabel(r: AddressRecordResponse): string | undefined {
  // Date first — it is what separates several campaigns at one address. On a record the
  // date is VOW, so it is simply absent for an anonymous viewer.
  return (
    [r.soldDateMs ? formatRecordDate(r.soldDateMs) : null, r.key, r.brokerage]
      .filter(Boolean)
      .join("  ·  ") || undefined
  );
}

/**
 * Which section a header-bar suggestion belongs in. This bar predates SuggestCategory and
 * uses its own `kind` vocabulary, so translate first and then defer to the shared rule —
 * the two bars must not each decide what counts as a "place".
 */
function sectionFor(s: SearchSuggestion) {
  if (s.kind === "city" || s.kind === "neighbourhood") return sectionForCategory("community");
  // An address row with coordinates and no listing IS the geocoded place row.
  if (s.kind === "address" && !s.listing && s.geo) return sectionForCategory("geo");
  return sectionForCategory(s.kind === "record" ? "soldAddress" : "address");
}

/** A live listing's status word comes from the feed, never from a hardcoded label. */
function liveStatus(s: SearchSuggestion) {
  return s.listing ? activeRowStatus(s.listing.TransactionType) : null;
}

export default function LocationSearch({
  className,
  mode = "inplace",
  onPlace,
  placeholder: placeholderProp,
}: LocationSearchProps) {
  const location = useCommandCenterStore((s) => s.location);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const totalCount = useCommandCenterStore((s) => s.totalCount);
  // Mobile → full report; desktop → in-page Quick Look drawer (inplace mode only).
  const openListing = useOpenListing();
  const router = useRouter();

  const [value, setValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<SearchSuggestion[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [highlight, setHighlight] = React.useState(-1);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clearing the timer only cancels work that hasn't STARTED. Once a fetch is in flight a
  // newer keystroke's answer can land first and then be overwritten by the older, slower
  // one — the terminal bar has always guarded this (LocationSearchV2's reqId); this one
  // didn't, so the dropdown could show rows belonging to a query the user had moved past.
  const reqId = React.useRef(0);
  // The record/geocode probes now run on every address-shaped query (they used to be
  // skipped whenever an active listing matched), so cancel the previous pair rather than
  // leaving abandoned requests to occupy the browser's per-host connection budget.
  const abortRef = React.useRef<AbortController | null>(null);

  // Close the dropdown on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced autocomplete.
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Bumped before the early return too, so clearing the box also invalidates any
    // in-flight request instead of letting it repopulate an emptied dropdown.
    const mine = ++reqId.current;
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const results = await suggestSearch(q);
      // Same-destination guarantee as the terminal bar: an address-shaped query whose
      // typed address is NOT among the (typo-tolerant) listing matches gets a geocoded
      // address-profile row on top — fuzzy lookalikes must not swallow the typed
      // address. Navigate mode only (inplace/onPlace callers expect place labels).
      if (mode === "navigate" && shouldProbeRecords(q)) {
        const covered = results.some((s) => s.kind === "address" && matchesTypedAddress(q, s.label));
        // EVERY disposition at the address gets its own row, alongside a live For-Sale
        // row — the same contract federatedSuggest gives the terminal. This used to run
        // only when no active listing matched, and only ever rendered records[0], so a
        // relisted home hid its own history and a second record at the address vanished.
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Both degrade to null when aborted, so a cancelled probe simply renders no
        // record rows — never a throw out of the effect.
        const [status, hit] = await Promise.all([
          fetchAddressStatus(q, ctrl.signal),
          geocodeAddress(q, ctrl.signal),
        ]);
        const records = status?.found ? status.records ?? [] : [];
        // Reversed: successive unshifts then leave the rows in server order (newest first).
        for (const r of [...records].reverse()) {
          results.unshift({ kind: "record", label: r.address, sublabel: recordSublabel(r), record: r });
        }
        // The PLACE row is unconditional now. It used to render only when the address was
        // unknown to us (no record AND no active match), so the map option disappeared
        // exactly when a home had history or was for sale — the moment you most want to
        // see where it is.
        if (hit) {
          // Named from the FEED whenever we have a row for this address. The geocoder
          // answers with its own municipal naming ("Dundas" where the feed says
          // City=Hamilton, CityRegion=Dundas); only feed vocabulary exists in our region
          // taxonomy and in the /address URLs already indexed, so a geocoder name here
          // would mint a second identity for one home. (searchRows.ts)
          const named = records[0];
          const placeLabel = named
            ? `${named.address.split(",")[0]}, ${localityLabel(named.city, named.cityRegion)}`
            : hit.label;
          results.unshift({
            kind: "address",
            label: placeLabel,
            sublabel:
              records.length === 0 && !covered
                ? "Not on the market — centre the map here"
                : "Centre the map here and search this area",
            // Coords power the explicit Map/Profile button pair on this row.
            geo: { lat: hit.lat, lng: hit.lng },
          });
        }
      }
      if (mine !== reqId.current) return; // a newer keystroke already answered
      setSuggestions(results);
      setHighlight(-1);
      setSearching(false);
      setOpen(true);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, mode]);

  const closeAndBlur = () => {
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  // Lightweight NL parse of the raw input (pure, runs per keystroke). In navigate
  // mode a STRUCTURED query ("4 bed townhouse under 900k in milton") becomes a
  // deep link into the terminal rather than a bare place search — the terminal
  // hydrates the full filter set from the URL (see chipUrl + chipApply). Plain
  // places stay plain (isStructured === false) and flow through the typeahead.
  const nl = React.useMemo(() => parseNlQuery(value), [value]);
  const showStructured = mode === "navigate" && nl.isStructured;
  // Parent city (Toronto/London) whose whole-city scope is reachable through the
  // existing ?city= / setLocation full-text path — offered as a synthetic top row.
  const cityGroup = expandableCityGroupFor(value);

  const goStructured = () => {
    const qs = chipsToQueryString(nl.chips);
    router.push(`/properties${qs ? `?${qs}` : ""}`);
    setValue("");
    closeAndBlur();
  };

  // Apply a resolved target. navigate mode routes; inplace mode mutates the store
  // exactly as before (city → setLocation, listing → setSelectedProperty).
  const applyTarget = (t: SearchTarget) => {
    if (t.action === "set-location" && onPlace) {
      onPlace(t.label); // caller-managed region (e.g. Market Trends page)
    } else if (t.action === "open-href") {
      // A record's destination is whatever the server resolved — including the forward
      // from a dead off-market campaign to the live relist. Never re-derive it here.
      router.push(t.href);
    } else if (mode === "navigate") {
      router.push(targetToHref(t));
    } else if (t.action === "open-listing") {
      openListing(t.listing); // desktop → Quick Look drawer; mobile → full report
    } else {
      setLocation(t.label); // drives the existing debounced search
    }
    setValue("");
    closeAndBlur();
  };

  // Act on a chosen suggestion.
  const select = (s: SearchSuggestion) => applyTarget(resolveSuggestionTarget(s));

  const clear = () => {
    if (mode === "inplace") setLocation("");
    setValue("");
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    const n = suggestions.length;
    if (open && n > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHighlight((prev) => (e.key === "ArrowDown" ? (prev + 1) % n : (prev - 1 + n) % n));
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (open && highlight >= 0 && highlight < suggestions.length) {
      select(suggestions[highlight]);
    } else if (showStructured) {
      goStructured(); // "4 bed townhouse under 900k" → deep link, not a place
    } else if (value.trim()) {
      applyTarget(resolveTextTarget(value));
    }
  };

  const fmt = totalCount.toLocaleString();
  // `totalCount` lives in the terminal's store, so OFF the terminal it stays 0
  // and this always falls through to the last branch. In navigate mode (the app
  // header) that box is ~288px — 220px of text once the icon and clear-button
  // padding are removed — and the long prompt measures 324px in JetBrains Mono
  // 12px, so it was permanently clipped mid-word rather than transiently. The
  // header gets a prompt that fits; the terminal's own search is full-width and
  // keeps the fuller wording.
  const placeholder = placeholderProp ?? (location
    ? `${location}, ON  |  Search ${fmt} Active Listings…`
    : totalCount > 0
      ? `Search ${fmt} Active Listings…`
      : mode === "navigate"
        ? "Search city, address, or MLS#…"
        : "Search city, neighbourhood, address, or MLS#…");

  // In navigate mode the store `location` isn't ours to clear, so the X only
  // reflects the typed value; inplace mode also surfaces a committed location.
  const showClear = mode === "inplace" ? value.length > 0 || location.length > 0 : value.length > 0;

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
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="h-7 rounded-none border-border bg-card pl-9 pr-8 font-mono text-xs text-foreground placeholder:text-muted-foreground"
          />
          {showClear && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>

      {open && (suggestions.length > 0 || searching || showStructured || value.trim().length >= 2) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto border border-border bg-card">
          {/* Whole-city shortcut: TRREB has no single value for Toronto/London, so this
              scopes the whole city via the existing ?city= / setLocation path (applyTarget
              handles navigate/inplace/onPlace). Sits above the individual district rows. */}
          {cityGroup && (
            <button
              type="button"
              onMouseEnter={() => setHighlight(-1)}
              onClick={() => applyTarget(resolveTextTarget(cityGroup))}
              className="flex w-full items-center gap-2.5 border-b border-border bg-cyan-500/5 px-3 py-2 text-left transition-colors hover:bg-cyan-500/10"
            >
              <Layers className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-xs text-foreground">{cityGroup} — all districts</span>
                <span className="truncate text-[10px] text-muted-foreground">Search the whole city</span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">City-wide</span>
            </button>
          )}
          {/* Structured-query shortcut: parsed the sentence into filters → deep-link
              into the terminal. Sits above place/address matches and is the default
              Enter action (highlight stays -1 until the user arrows into a place). */}
          {showStructured && (
            <button
              type="button"
              onMouseEnter={() => setHighlight(-1)}
              onClick={goStructured}
              className="flex w-full items-center gap-2.5 border-b border-border bg-cyan-500/5 px-3 py-2 text-left transition-colors hover:bg-cyan-500/10"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" />
              <span className="flex min-w-0 flex-1 flex-col">
                {/* cyan-200 on the bg-cyan-500/5 tint is near-white on near-white once this
                    row renders light — and it does: LocationSearch mounts in AppHeader,
                    FirstRunRegionPicker and AnalyticsClient, none of them dark islands. The
                    icon one line up already carries the split; this label was missed. */}
                <span className="truncate font-mono text-xs text-cyan-800 dark:text-cyan-200">
                  {nl.chips.map((c) => c.label).join("  ·  ")}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">Search all matches on the map</span>
              </span>
              <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          )}
          {searching && suggestions.length === 0 && (
            <div className="px-3 py-2 font-mono text-xs text-muted-foreground">Searching…</div>
          )}
          {!searching && suggestions.length === 0 && !showStructured && value.trim().length >= 2 && (
            <div className="px-3 py-2 font-mono text-xs text-muted-foreground">
              No matches for “{value.trim()}”. Try a city, neighbourhood, address, or MLS#.
            </div>
          )}
          {suggestions.map((s, i) => {
            const section = sectionFor(s);
            // Header only when the section changes — keeps `suggestions` a flat array so
            // the existing highlight/keyboard indices keep working unchanged.
            const showHead = i === 0 || sectionFor(suggestions[i - 1]) !== section;
            const status = liveStatus(s);
            return (
            <React.Fragment key={`${s.kind}-${s.label}-${i}`}>
            {showHead && (
              <div className="flex items-center justify-between px-3 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <span>{SECTION_TITLE[section]}</span>
                {section === "listings" && suggestions.some((x) => x.kind === "record") && (
                  <span className="text-cyan-700 dark:text-cyan-400/80">VOW</span>
                )}
              </div>
            )}
            <button
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(s)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                i === highlight ? "bg-muted" : "hover:bg-muted"
              )}
            >
              {/* See LocationSearchV2: active photo is IDX and renders; a record's URL is
                  VOW so it shows a locked frame; never optimized (watermark + cost). */}
              {s.listing?.primaryImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.listing.primaryImageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-10 w-14 shrink-0 object-cover"
                />
              ) : s.record?.hasPhoto ? (
                <span className="flex h-10 w-14 shrink-0 items-center justify-center bg-muted text-muted-foreground">
                  <Lock className="h-3 w-3" />
                </span>
              ) : (
                <SuggestionIcon kind={s.kind} />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className="truncate font-mono text-xs text-foreground"
                  title={s.kind === "city" || s.kind === "neighbourhood" ? s.label : undefined}
                >
                  {s.kind === "city" || s.kind === "neighbourhood" ? formatRegionLabel(s.label) : s.label}
                </span>
                {s.sublabel && (
                  <span className="truncate text-[10px] text-muted-foreground">{s.sublabel}</span>
                )}
                {/* Live listing: identical spec + provenance lines to the terminal bar —
                    "4+1 bd · 3 ba · 2 pk · Detached · $885,000" then the date, MLS# and
                    brokerage. This bar used to show an address and nothing else. */}
                {s.listing && (
                  <>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {listingSpecs(s.listing)}
                    </span>
                    {listingMetaLine(s.listing) && (
                      <span className="truncate font-mono text-[10px] text-muted-foreground/80">
                        {listingMetaLine(s.listing)}
                      </span>
                    )}
                  </>
                )}
                {/* The relist, said out loud. A dead campaign whose home is listed again
                    reads as a dead end without this — and for an off-market record the
                    row now navigates to that live listing (server-resolved href). */}
                {s.record?.liveKey && (
                  <span className="truncate font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                    {backOnMarketLabel(s.record.livePrice, s.record.liveTransactionType)}
                  </span>
                )}
              </span>
              {/* Property record: the same status chip the terminal bar shows (shared
                  RECORD_KIND_* maps), plus the close price when the viewer is a VOW
                  consumer — the anon payload simply never carries one to hide. */}
              {s.kind === "record" && s.record ? (
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span
                    className={cn(
                      "border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                      ROW_STATUS_CHIP[s.record.dealKind]
                    )}
                  >
                    {ROW_STATUS_LABEL[s.record.dealKind]}
                  </span>
                  {s.record.closePrice ? (
                    <span className="font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-400">
                      {formatRowPrice(s.record.closePrice, s.record.dealKind === "leased")}
                      {s.record.soldDateMs && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          {formatRecordDate(s.record.soldDateMs)}
                        </span>
                      )}
                    </span>
                  ) : null}
                </span>
              ) : /* Geocoded not-listed address: the two destinations as EXPLICIT
                  buttons (owner: nobody knew where to click) — bordered Map
                  (centered-terminal deep link, PR #155 contract) + solid Profile.
                  Row-click still opens the profile (unchanged default). */
              s.geo ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(
                        `/properties?lat=${s.geo!.lat.toFixed(6)}&lng=${s.geo!.lng.toFixed(6)}&z=14&pin=${encodeURIComponent(s.label.split(",")[0])}`
                      );
                      setValue("");
                      closeAndBlur();
                    }}
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
                      select(s);
                    }}
                    className="flex items-center gap-1 bg-cyan-500 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
                  >
                    <Home className="h-3 w-3" />
                    Profile
                  </span>
                </span>
              ) : status ? (
                /* Live listing: the status word comes from the feed's TransactionType —
                   `tagFor` hardcoded "For sale" on every active row, lease listings
                   included. The Map action sits beside it, always visible (never
                   hover-gated: no touch device can reach a hover-only control). */
                <span className="flex shrink-0 items-center gap-1.5">
                  {s.listing?.location && (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const [lat, lng] = s.listing!.location;
                        router.push(
                          `/properties?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&z=16&pin=${encodeURIComponent(s.label.split(",")[0])}`
                        );
                        setValue("");
                        closeAndBlur();
                      }}
                      className="flex items-center gap-1 border border-cyan-500/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-700 transition-colors hover:bg-cyan-500/10 dark:text-cyan-300"
                    >
                      <MapPin className="h-2.5 w-2.5" />
                      Map
                    </span>
                  )}
                  <span className={cn("font-mono text-[10px] font-bold uppercase tracking-wider", ROW_STATUS_TONE[status])}>
                    {ROW_STATUS_LABEL[status]}
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {tagFor(s)}
                </span>
              )}
              {s.count !== undefined && (
                <span className="w-16 shrink-0 text-right font-mono text-[11px] text-cyan-700 dark:text-cyan-400">
                  {s.count.toLocaleString()}
                </span>
              )}
            </button>
            </React.Fragment>
            );
          })}
          {/* Persistent map exit — the terminal bar's twin. Without it this bar had no way
              back to the map for an address or street query, which is most of them.
              navigate mode only: the in-place callers (FirstRunRegionPicker,
              AnalyticsClient) are not map surfaces and have nowhere to send you. */}
          {mode === "navigate" && suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                // Prefer a coordinate already resolved for this query — the place row's,
                // else the first listing's — so the map lands on what was searched.
                const place = suggestions.find((x) => x.geo)?.geo;
                const loc = suggestions.find((x) => x.listing?.location)?.listing?.location;
                const lat = place?.lat ?? loc?.[0];
                const lng = place?.lng ?? loc?.[1];
                const pin = suggestions[0]?.label.split(",")[0] ?? value.trim();
                router.push(
                  lat != null && lng != null
                    ? `/properties?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&z=15&pin=${encodeURIComponent(pin)}`
                    : `/properties?city=${encodeURIComponent(value.trim())}`
                );
                setValue("");
                closeAndBlur();
              }}
              className="sticky bottom-0 flex w-full items-center justify-center gap-2 border-t border-border bg-cyan-500 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
            >
              <Layers className="h-3 w-3" />
              See these on the map
            </button>
          )}
        </div>
      )}
    </div>
  );
}
