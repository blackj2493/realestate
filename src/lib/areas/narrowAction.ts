/**
 * The one action behind the narrow ask, shared by the email page and the in-app card so the
 * two can never disagree about what "switch", "keep" and "undo" mean.
 *
 *   switch  all of Toronto → a part     replaceRegion + resolve 'switched'
 *   keep    stay on all of Toronto      resolve 'kept' (the ask ends for good)
 *   undo    a part → all of Toronto     replaceRegion back + re-open the ask
 *
 * The part is validated by MEMBERSHIP in that city's parts, never by pattern: region labels
 * are free text elsewhere, and membership guarantees we only ever save something the
 * digest, the map and the market stats all expand.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { partsOf } from "@/lib/dashboard/cityParts";
import { replaceRegion } from "@/lib/dashboard/followRegion";
import { regionMapHref } from "@/lib/dashboard/area";
import { reopenAsk, resolveAsk } from "./narrowAskStore";
import { wholeCityToNarrow } from "./narrowAsk";

export type NarrowInput =
  | { kind: "switch"; city: string; part: string }
  | { kind: "keep"; city: string }
  | { kind: "undo"; city: string; part: string };

export interface NarrowOutcome {
  ok: boolean;
  error: string | null;
  /** Where to send the reader next (the part on the map, or the whole city). */
  mapHref: string | null;
  regions: string[];
}

/** Parse an untrusted body into a NarrowInput, or null. */
export function parseNarrowInput(body: unknown): NarrowInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const city = typeof b.city === "string" ? wholeCityToNarrow(b.city) : null;
  if (!city) return null;
  const parts = partsOf(city) ?? [];
  const part = typeof b.part === "string" ? parts.find((p) => p.name === b.part)?.name : undefined;
  if (b.action === "keep") return { kind: "keep", city };
  if (b.action === "switch" && part) return { kind: "switch", city, part };
  if (b.action === "undo" && part) return { kind: "undo", city, part };
  return null;
}

export async function performNarrow(
  sb: SupabaseClient,
  userId: string,
  input: NarrowInput,
  ctx: { via: "email" | "app"; email?: string | null }
): Promise<NarrowOutcome> {
  if (input.kind === "keep") {
    await resolveAsk(sb, userId, input.city, { resolved: "kept", via: ctx.via });
    return { ok: true, error: null, mapHref: regionMapHref(input.city), regions: [] };
  }

  const [from, to] = input.kind === "switch" ? [input.city, input.part] : [input.part, input.city];
  const r = await replaceRegion(sb, userId, from, to, {
    source: ctx.via === "email" ? "narrow_email" : "narrow_app",
    email: ctx.email ?? null,
  });
  if (!r.ok) return { ok: false, error: r.error, mapHref: null, regions: [] };

  if (input.kind === "switch") {
    await resolveAsk(sb, userId, input.city, { resolved: "switched", part: input.part, via: ctx.via });
  } else {
    await reopenAsk(sb, userId, input.city);
  }
  return { ok: true, error: r.error, mapHref: regionMapHref(to), regions: r.regions };
}
