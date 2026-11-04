"use client";

/**
 * SellerAddressField — the optional "Which home?" box on /welcome, shown only after
 * "Selling a home". Free text with address suggestions from /api/geocode (address types
 * only, no POI). The value only decides where the seller lands: their /address page, whose
 * route resolves any address (live listing → sold record → geocode). Never required.
 */

import { useEffect, useRef, useState } from "react";

interface Suggestion {
  label: string;
}

export default function SellerAddressField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const picked = useRef(false);

  useEffect(() => {
    // A picked suggestion fills the box; do not search again for the text we just set.
    if (picked.current) {
      picked.current = false;
      return;
    }
    const q = value.trim();
    // Too short to search: render nothing (see `shown`) rather than clearing state here.
    if (q.length < 4) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: Suggestion[] }) => {
          setSuggestions((d.results ?? []).slice(0, 5));
          setOpen(true);
        })
        .catch(() => {
          /* aborted or offline: the free text still works */
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [value]);

  const shown = value.trim().length >= 4 ? suggestions : [];

  return (
    <div className="border border-teal-600/30 bg-teal-500/[0.06] p-3">
      <label htmlFor="sv-sell-address" className="text-sm font-semibold text-foreground">
        Which home? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="sv-sell-address"
        type="text"
        autoComplete="street-address"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => shown.length > 0 && setOpen(true)}
        placeholder="Street address, city"
        className="mt-2 min-h-[44px] w-full border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none"
      />
      {open && shown.length > 0 && (
        <ul role="listbox" aria-label="Address suggestions" className="mt-1 border border-border bg-card">
          {shown.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                role="option"
                aria-selected={s.label === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  picked.current = true;
                  onChange(s.label);
                  setOpen(false);
                }}
                className="block min-h-[40px] w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        We&rsquo;ll open your home&rsquo;s page: what sold on your street, how fast, and for how much.
        Nobody contacts you unless you ask.
      </p>
    </div>
  );
}
