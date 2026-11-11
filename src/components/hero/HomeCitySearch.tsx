"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { QUICK_PICK_MARKETS } from "@/lib/dashboard/area";
import { resolveCityCamera } from "@/lib/search/cityCamera";

/**
 * The home page's one action: type a city, land on the map framed on it.
 *
 * The audit (2026-11) found no search field on the home page — a visitor who came to look
 * up a city had to find "Browse listings", then search again inside the terminal. This goes
 * straight to the same `?city=&lat=&lng=&z=` deep link the city links already use. The
 * quick-pick markets resolve instantly; any other name is framed from its own listings
 * (resolveCityCamera). An unknown name opens the map unframed rather than an empty city.
 */
export default function HomeCitySearch() {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(e: FormEvent) {
    e.preventDefault();
    const typed = value.trim();
    if (!typed || busy) return;
    const pick = QUICK_PICK_MARKETS.find((m) => m.name.toLowerCase() === typed.toLowerCase());
    const name = pick?.name ?? typed;
    setBusy(true);
    const cam = pick ? { lat: pick.lat, lng: pick.lng, zoom: pick.zoom } : await resolveCityCamera(name);
    if (!cam) {
      router.push("/properties");
      return;
    }
    const q = new URLSearchParams({ city: name, lat: String(cam.lat), lng: String(cam.lng), z: String(cam.zoom) });
    router.push(`/properties?${q.toString()}`);
  }

  return (
    <form
      role="search"
      onSubmit={go}
      className="mt-7 flex w-full max-w-[34rem] flex-col gap-3 sm:flex-row"
    >
      <label className="sr-only" htmlFor={`${listId}-city`}>
        City
      </label>
      <div className="relative flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          id={`${listId}-city`}
          list={listId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search a city, e.g. Toronto"
          autoComplete="off"
          enterKeyHint="search"
          className="h-[3.25rem] w-full rounded-md border border-slate-600 bg-slate-900/80 pl-12 pr-4 text-base text-white placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
        />
        <datalist id={listId}>
          {QUICK_PICK_MARKETS.map((m) => (
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="glow-emerald inline-flex h-[3.25rem] items-center justify-center rounded-md bg-emerald-500 px-8 text-base font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-70"
      >
        {busy ? "Opening…" : "Search"}
      </button>
    </form>
  );
}
