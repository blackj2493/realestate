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
import { Search, X, MapPin, Home, Hash, Sparkles, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { suggestSearch, type SearchSuggestion } from "@/lib/typesense/client";
import { useRouter } from "next/navigation";
import { useOpenListing } from "@/hooks/useOpenListing";
import { resolveSuggestionTarget, resolveTextTarget, targetToHref, type SearchTarget } from "@/lib/search/searchTarget";
import { matchesTypedAddress } from "@/lib/search/federatedSuggest";
import { geocodeAddress } from "@/lib/search/geocodeClient";
import { parseNlQuery } from "@/lib/search/nlParse";
import { chipsToQueryString } from "@/lib/search/chipUrl";

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
  if (kind === "mls") return <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  return <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

const KIND_TAG: Record<SearchSuggestion["kind"], string> = {
  city: "City",
  neighbourhood: "Area",
  address: "Address",
  mls: "MLS",
};

/** Row tag that says what the row IS: a with-listing address row is a live For-Sale
 *  listing; a listing-less address row is the geocoded address-profile fallback. */
function tagFor(s: SearchSuggestion): string {
  if (s.kind === "address") return s.listing ? "For sale" : "Profile";
  return KIND_TAG[s.kind];
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
      if (mode === "navigate" && /\d+\s+[a-zA-Z]{3,}/.test(q)) {
        const covered = results.some((s) => s.kind === "address" && matchesTypedAddress(q, s.label));
        if (!covered) {
          const hit = await geocodeAddress(q);
          if (hit) {
            results.unshift({
              kind: "address",
              label: hit.label,
              sublabel: "Not on the market — view the address profile",
            });
          }
        }
      }
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

  const goStructured = () => {
    const qs = chipsToQueryString(nl.chips);
    router.push(`/properties${qs ? `?${qs}` : ""}`);
    setValue("");
    closeAndBlur();
  };

  // Apply a resolved target. navigate mode routes; inplace mode mutates the store
  // exactly as before (city → setLocation, listing → setSelectedProperty).
  const applyTarget = (t: SearchTarget) => {
    if (t.action !== "open-listing" && onPlace) {
      onPlace(t.label); // caller-managed region (e.g. Market Trends page)
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
  const placeholder = placeholderProp ?? (location
    ? `${location}, ON  |  Search ${fmt} Active Listings…`
    : totalCount > 0
      ? `Search ${fmt} Active Listings…`
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
                <span className="truncate font-mono text-xs text-cyan-200">
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
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.label}-${i}`}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(s)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                i === highlight ? "bg-muted" : "hover:bg-muted"
              )}
            >
              <SuggestionIcon kind={s.kind} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-xs text-foreground">{s.label}</span>
                {s.sublabel && (
                  <span className="truncate text-[10px] text-muted-foreground">{s.sublabel}</span>
                )}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {tagFor(s)}
              </span>
              {s.count !== undefined && (
                <span className="w-16 shrink-0 text-right font-mono text-[11px] text-cyan-700 dark:text-cyan-400">
                  {s.count.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
