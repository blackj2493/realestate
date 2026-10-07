"use client";

import NarrowChooser, { type NarrowSubmit } from "@/components/areas/NarrowChooser";

/** The email-link flavour of the chooser: every button POSTs with the link's signature. */
export default function NarrowEmailClient({
  e,
  s,
  city,
  suggested,
}: {
  e: string;
  s: string;
  city: string;
  suggested: { name: string; hint: string } | null;
}) {
  const submit: NarrowSubmit = async (action, part) => {
    const res = await fetch("/api/email/narrow-area", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ e, s, city, action, part }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; mapHref?: string };
    return { ok: res.ok && !!body.ok, mapHref: body.mapHref ?? null };
  };
  return <NarrowChooser city={city} suggested={suggested} submit={submit} />;
}
