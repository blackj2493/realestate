"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/posthog";
import CityAlert from "./CityAlert";

// Map camera per city. A ?city= link alone filters the list but leaves the camera where it
// was (the map reopens on the last camera), so the link also carries ?lat&lng&z to fly
// there. Values match regionCamera() in lib/dashboard/area where it has them; Milton,
// Pickering and Oshawa are not in that table.
const CITIES = [
  { slug: "toronto", name: "Toronto", lat: 43.6532, lng: -79.3832, z: 11 },
  { slug: "mississauga", name: "Mississauga", lat: 43.5853, lng: -79.645, z: 11.5 },
  { slug: "brampton", name: "Brampton", lat: 43.6882, lng: -79.763, z: 11.5 },
  { slug: "richmond-hill", name: "Richmond Hill", lat: 43.8764, lng: -79.4381, z: 12 },
  { slug: "markham", name: "Markham", lat: 43.8599, lng: -79.335, z: 11.5 },
  { slug: "vaughan", name: "Vaughan", lat: 43.8361, lng: -79.4983, z: 11.5 },
  { slug: "oakville", name: "Oakville", lat: 43.4675, lng: -79.6877, z: 12 },
  { slug: "milton", name: "Milton", lat: 43.5183, lng: -79.8774, z: 12 },
  { slug: "pickering", name: "Pickering", lat: 43.8384, lng: -79.0868, z: 12 },
  { slug: "oshawa", name: "Oshawa", lat: 43.8971, lng: -78.8658, z: 12 },
  { slug: "hamilton", name: "Hamilton", lat: 43.2557, lng: -79.8711, z: 11.5 },
  { slug: "ottawa", name: "Ottawa", lat: 45.4215, lng: -75.6972, z: 11 },
] as const;

function mapHref(c: (typeof CITIES)[number]): string {
  const q = new URLSearchParams({ city: c.name, age: "New,0-5", lat: String(c.lat), lng: String(c.lng), z: String(c.z) });
  return `/properties?${q.toString()}`;
}

/** Pick a city, then open the map on its new and nearly-new homes (?age=New,0-5), or the price cuts. */
export default function CityLinks({ follow }: { follow?: string }) {
  // ?follow={city} = back from sign-in after "Email me new listings in {city}".
  const resumeCity = follow ? CITIES.find((x) => x.name.toLowerCase() === follow.trim().toLowerCase()) : undefined;
  const [city, setCity] = useState<string>(resumeCity?.slug ?? "toronto");
  useEffect(() => {
    if (resumeCity) document.getElementById("city-title")?.scrollIntoView({ block: "start" });
  }, [resumeCity]);
  const c = CITIES.find((x) => x.slug === city) ?? CITIES[0];
  const name = c.name;
  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2 text-center text-sm font-semibold transition-colors";

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
        {CITIES.map((x) => (
          <option key={x.slug} value={x.slug}>
            {x.name}
          </option>
        ))}
      </select>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Link
          href={mapHref(c)}
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
      <CityAlert key={name} city={name} resume={resumeCity?.name === name} />
    </section>
  );
}
