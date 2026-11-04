"use client";

import { useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/posthog";

const CITIES = [
  ["toronto", "Toronto"],
  ["mississauga", "Mississauga"],
  ["brampton", "Brampton"],
  ["richmond-hill", "Richmond Hill"],
  ["markham", "Markham"],
  ["vaughan", "Vaughan"],
  ["oakville", "Oakville"],
  ["milton", "Milton"],
  ["pickering", "Pickering"],
  ["oshawa", "Oshawa"],
  ["hamilton", "Hamilton"],
  ["ottawa", "Ottawa"],
] as const;

/** Pick a city, then go to its new homes or its price cuts. */
export default function CityLinks() {
  const [city, setCity] = useState<string>("toronto");
  const name = CITIES.find(([s]) => s === city)?.[1] ?? "Toronto";
  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors";

  return (
    <section aria-labelledby="city-title" className="rounded-lg border border-border bg-card p-5">
      <h2 id="city-title" className="text-lg font-semibold text-foreground">
        See the homes in your city
      </h2>
      <label htmlFor="hst-city" className="mt-3 block text-sm text-muted-foreground">
        City
      </label>
      <select
        id="hst-city"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        className="mt-1 w-full max-w-xs rounded-md border border-border bg-muted px-3 py-2 text-foreground"
      >
        {CITIES.map(([slug, label]) => (
          <option key={slug} value={slug}>
            {label}
          </option>
        ))}
      </select>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/lifestyle/${city}/new-construction`}
          onClick={() => track("hst_city_link", { city, target: "new_homes" })}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          New and nearly-new homes for sale in {name}
        </Link>
        <Link
          href="/data/price-cuts"
          onClick={() => track("hst_city_link", { city, target: "price_cuts" })}
          className={`${btn} border border-border text-foreground hover:border-emerald-500/50`}
        >
          Where sellers are cutting prices
        </Link>
      </div>
    </section>
  );
}
