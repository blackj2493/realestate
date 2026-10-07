/**
 * /areas/narrow?e=&c=&s=[&p=][&keep=1] — where the digest's narrow ask lands.
 *
 * This page CHANGES NOTHING on load. Mail scanners open every link in an email, and the
 * action behind it replaces an area, so the change waits for the reader's button press
 * (NarrowEmailClient → POST /api/email/narrow-area). The signature is checked here only to
 * decide whether to show the choice at all.
 */
import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/layout/AppHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import { verifyNarrow } from "@/lib/areas/narrowLink";
import { wholeCityToNarrow } from "@/lib/areas/narrowAsk";
import { partNamed, partsOf } from "@/lib/dashboard/cityParts";
import NarrowEmailClient from "./NarrowEmailClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pick your part of the city | PureProperty",
  robots: { index: false, follow: false },
};

export default async function NarrowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  const e = (q.e ?? "").trim().toLowerCase();
  const s = q.s ?? "";
  const city = wholeCityToNarrow(q.c ?? "");
  const valid = !!city && verifyNarrow(e, city, s);
  const pre = city && q.p ? partNamed(q.p) : null;
  const suggested = pre && partsOf(city!)?.includes(pre) ? { name: pre.name, hint: pre.hint } : null;

  return (
    <>
      <AppHeader variant="marketing" />
      <main className="min-h-app bg-background text-foreground">
        <div className="mx-auto max-w-xl px-4 py-10">
          {valid && city ? (
            <>
              <h1 className="text-2xl font-bold text-foreground">Pick your part of {city}</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                You follow all of {city}, so your email covers every new home in the city. Pick the
                part you are looking in, and your email covers that part only. You can change it
                any time on your dashboard.
              </p>
              <div className="mt-6">
                <NarrowEmailClient e={e} s={s} city={city} suggested={suggested} />
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-foreground">This link does not work any more</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                You can pick the areas you follow on your dashboard.
              </p>
              <Link
                href="/dashboard"
                className="mt-4 inline-block text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400"
              >
                Open your dashboard &rarr;
              </Link>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
