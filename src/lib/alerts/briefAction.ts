/**
 * Signed links that reshape the nightly brief from inside it, with no login.
 *
 * Two families:
 *  - FILTER links ("Detached only", "3+ bedrooms") set one dashboard filter and switch one
 *    area to "my filters only". They replace the line that told a reader they had no
 *    filters and left them to go fix it on a dashboard most of them never opened.
 *  - PERSONA links reorder the angle picks (pickAngles) for an investor or a builder.
 *
 * SIGNING. HMAC over `brief:<action>:<email>:<bubbleId>` with the alerts secret. The action
 * and the area are both inside the signature, so a link cannot be edited into another
 * action or pointed at another area. The handler still checks the area belongs to the
 * signed email's account.
 *
 * NOT APPLIED ON GET. Mail security scanners (Outlook Safe Links, corporate gateways) open
 * every link in a message. The frequency links tolerate that because each is a single
 * idempotent choice; four mutually exclusive filter links would not — a scanner would
 * apply all four and leave whichever came last. So GET renders a confirm button and only
 * the POST it submits writes anything (src/app/api/email/brief/route.ts).
 */

import { timingSafeEqual } from "crypto";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { signAlertsPayload } from "./unsubscribe";

export type FilterPresetId = "detached" | "town" | "condo" | "beds3" | "frontage50" | "vacant";

export interface FilterPreset {
  /** Chip text in the email. */
  label: string;
  /** What the confirm page says the tap will do. */
  confirm: string;
  /** The lens fields this preset sets. Every other lens field is left as the reader had it. */
  patch: Partial<MarketActivityLens>;
}

export const FILTER_PRESETS: Record<FilterPresetId, FilterPreset> = {
  detached: { label: "Detached only", confirm: "only detached homes", patch: { propertyTypes: ["detached"] } },
  town: { label: "Townhouses only", confirm: "only townhouses", patch: { propertyTypes: ["town"] } },
  condo: { label: "Condos only", confirm: "only condo apartments", patch: { propertyTypes: ["condo"] } },
  beds3: { label: "3+ bedrooms", confirm: "only homes with 3 or more bedrooms", patch: { minBeds: 3, bedsExact: false } },
  frontage50: { label: "Lots 50 ft+", confirm: "only lots with 50 ft or more of frontage", patch: { minFrontage: 50 } },
  vacant: { label: "Vacant land", confirm: "only vacant land", patch: { propertyTypes: ["vacant"] } },
};

/** Which presets an area offers, by the reader's persona. Four at most: a row of chips, not a form. */
export const PERSONA_PRESETS: Record<PersonaType, readonly FilterPresetId[]> = {
  smart: ["detached", "town", "condo", "beds3"],
  cashflow: ["detached", "town", "condo", "beds3"],
  flippers: ["detached", "town", "condo", "beds3"],
  builders: ["frontage50", "vacant", "detached"],
};

export type BriefAction = `filter:${FilterPresetId}` | `persona:${PersonaType}`;

const PRESET_IDS = Object.keys(FILTER_PRESETS) as FilterPresetId[];
const PERSONAS: readonly PersonaType[] = ["smart", "cashflow", "flippers", "builders"];

export function isBriefAction(a: string): a is BriefAction {
  const [kind, value] = a.split(":");
  if (kind === "filter") return PRESET_IDS.includes(value as FilterPresetId);
  if (kind === "persona") return PERSONAS.includes(value as PersonaType);
  return false;
}

/** Parsed form of a verified action. */
export type ParsedBriefAction =
  | { kind: "filter"; preset: FilterPresetId }
  | { kind: "persona"; persona: PersonaType };

export function parseBriefAction(a: BriefAction): ParsedBriefAction {
  const [kind, value] = a.split(":");
  return kind === "filter"
    ? { kind: "filter", preset: value as FilterPresetId }
    : { kind: "persona", persona: value as PersonaType };
}

const norm = (email: string) => (email || "").trim().toLowerCase();

export function signBriefAction(email: string, action: BriefAction, bubbleId = ""): string {
  return signAlertsPayload(`brief:${action}:${norm(email)}:${bubbleId}`);
}

/** Constant-time; false on any mismatch, unknown action, or missing input. */
export function verifyBriefAction(email: string, action: string, bubbleId: string, sig: string): boolean {
  if (!email || !sig || !isBriefAction(action)) return false;
  // A filter link is always about one area; a persona link never is.
  const isFilter = action.startsWith("filter:");
  if (isFilter !== Boolean(bubbleId)) return false;
  const expected = Buffer.from(signBriefAction(email, action, bubbleId));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function briefActionUrl(email: string, action: BriefAction, siteUrl: string, bubbleId = ""): string {
  const base = (siteUrl || "https://www.pureproperty.ca").replace(/\/$/, "");
  const q = new URLSearchParams({ e: norm(email), a: action });
  if (bubbleId) q.set("b", bubbleId);
  q.set("s", signBriefAction(email, action, bubbleId));
  return `${base}/api/email/brief?${q.toString()}`;
}

/** The lens after a preset: the reader's own lens with only the preset's fields replaced. */
export function applyPreset(lens: MarketActivityLens, preset: FilterPresetId): MarketActivityLens {
  return { ...lens, ...FILTER_PRESETS[preset].patch };
}
