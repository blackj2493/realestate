/**
 * LocationSearch — the terminal search bar's typeahead.
 *
 * Restores the autocomplete the old (orphaned) SearchDropdown provided, but native
 * to the dark terminal. A debounced Typesense query surfaces, in priority order:
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
import { Search, X, MapPin, Home, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { suggestSearch, type SearchSuggestion } from "@/lib/typesense/client";

interface LocationSearchProps {
  className?: string;
}

function SuggestionIcon({ kind }: { kind: SearchSuggestion["kind"] }) {
  if (kind === "address") return <Home className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
  if (kind === "mls") return <Hash className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
  return <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
}

const KIND_TAG: Record<SearchSuggestion["kind"], string> = {
  city: "City",
  neighbourhood: "Area",
  address: "Address",
  mls: "MLS",
};

export default function LocationSearch({ className }: LocationSearchProps) {
  const location = useCommandCenterStore((s) => s.location);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const totalCount = useCommandCenterStore((s) => s.totalCount);
  const setSelectedProperty = useCommandCenterStore((s) => s.setSelectedProperty);

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
      setSuggestions(results);
      setHighlight(-1);
      setSearching(false);
      setOpen(true);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const closeAndBlur = () => {
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  // Commit a free-typed location string (no suggestion chosen).
  const commitLocation = (label: string) => {
    setLocation(label.trim());
    setValue("");
    closeAndBlur();
  };

  // Act on a chosen suggestion: places run a location search; address/MLS open the listing.
  const select = (s: SearchSuggestion) => {
    if ((s.kind === "address" || s.kind === "mls") && s.listing) {
      setSelectedProperty(s.listing); // opens the listing terminal
      setValue("");
      closeAndBlur();
      return;
    }
    commitLocation(s.label);
  };

  const clear = () => {
    setLocation("");
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
    } else if (value.trim()) {
      commitLocation(value);
    }
  };

  const fmt = totalCount.toLocaleString();
  const placeholder = location
    ? `${location}, ON  |  Search ${fmt} Active Listings…`
    : totalCount > 0
      ? `Search ${fmt} Active Listings…`
      : "Search city, neighbourhood, address, or MLS#…";

  const showClear = value.length > 0 || location.length > 0;

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
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="h-7 rounded-none border-slate-800 bg-slate-900 pl-9 pr-8 font-mono text-xs text-slate-200 placeholder:text-slate-500"
          />
          {showClear && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>

      {open && (suggestions.length > 0 || searching) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto border border-slate-700 bg-slate-900">
          {searching && suggestions.length === 0 && (
            <div className="px-3 py-2 font-mono text-xs text-slate-500">Searching…</div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.label}-${i}`}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(s)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                i === highlight ? "bg-slate-800" : "hover:bg-slate-800"
              )}
            >
              <SuggestionIcon kind={s.kind} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-xs text-slate-200">{s.label}</span>
                {s.sublabel && (
                  <span className="truncate text-[10px] text-slate-500">{s.sublabel}</span>
                )}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-600">
                {KIND_TAG[s.kind]}
              </span>
              {s.count !== undefined && (
                <span className="w-16 shrink-0 text-right font-mono text-[11px] text-cyan-400">
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
