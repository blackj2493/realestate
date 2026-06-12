/**
 * Property Data Sheet field registry — deterministic payload→rows mapping.
 *
 * Compliance (IDX §6.3(f), CLAUDE.md §4): values are rendered VERBATIM — the only
 * "formatting" permitted is trimming, currency/locale number display, unit
 * suffixes from companion fields, and joining array fields with " · ".
 * No sold-outcome VOW fields and no broker-workflow fields may ever be added
 * here (they are policy-excluded; see datasheet.test.ts policy suite).
 *
 * Pure logic — no React, no Node APIs — so it is unit-testable in vitest's
 * node environment and callable from the server page.
 */

import { formatPrice } from "@/lib/utils";

export type RawPayload = Record<string, unknown>;

export type DatasheetGroupId =
  | "vitals"
  | "building"
  | "interior"
  | "exterior"
  | "condo"
  | "utilities"
  | "taxes"
  | "transaction"
  | "risk";

export interface ResolvedRow {
  key: string;
  label: string;
  value: string;
  /** External link rows (virtual tours). */
  href?: string;
  /** Amber risk accent (risk group rows with a concerning value). */
  flagged?: boolean;
}

export interface DatasheetGroupMeta {
  id: DatasheetGroupId;
  title: string;
}

export interface ResolvedGroup {
  group: DatasheetGroupMeta;
  rows: ResolvedRow[];
}

interface DatasheetField {
  key: string;
  label: string;
  group: DatasheetGroupId;
  format: (p: RawPayload) => string | null;
  href?: (p: RawPayload) => string | null;
  flag?: (p: RawPayload) => boolean;
}

// ── null-safe readers (CLAUDE.md §6: expect nulls, wrong types, empty arrays) ──

/** Non-empty trimmed string, else null. Numbers pass through as strings. */
function str(p: RawPayload, key: string): string | null {
  const v = p[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Finite number, else null. */
function num(p: RawPayload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Array field → primitive members as trimmed strings; scalars wrap; else []. */
function list(p: RawPayload, key: string): string[] {
  const v = p[key];
  const arr = Array.isArray(v) ? v : v != null ? [v] : [];
  return arr
    .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
}

/** Joined array row value ("A · B"), null when empty. */
function joined(p: RawPayload, key: string): string | null {
  const items = list(p, key);
  return items.length > 0 ? items.join(" · ") : null;
}

/** Boolean flag → "Yes" only when strictly true (a "No" row is noise). */
function yes(p: RawPayload, key: string): string | null {
  return p[key] === true ? "Yes" : null;
}

/** Currency display, null unless a positive finite number. */
function money(p: RawPayload, key: string): string | null {
  const v = num(p, key);
  return v !== null && v > 0 ? formatPrice(v) : null;
}

// ── group metadata (registry order = default display order) ──

const GROUPS: DatasheetGroupMeta[] = [
  { id: "vitals", title: "Vitals" },
  { id: "building", title: "Building & Construction" },
  { id: "interior", title: "Interior" },
  { id: "exterior", title: "Exterior, Lot & Land" },
  { id: "condo", title: "Condo & Building" },
  { id: "utilities", title: "Utilities & Systems" },
  { id: "taxes", title: "Taxes & Assessment" },
  { id: "transaction", title: "Transaction & Possession" },
  { id: "risk", title: "Risk & Disclosures" },
];

/** Condo group applies only to condo-class subtypes (objective criteria, §6.3(f)). */
function isCondoClass(p: RawPayload): boolean {
  const sub = (str(p, "PropertySubType") ?? "").toLowerCase();
  return sub.includes("condo") || sub.includes("co-op") || sub.includes("co-ownership");
}

const GROUP_APPLIES: Partial<Record<DatasheetGroupId, (p: RawPayload) => boolean>> = {
  condo: isCondoClass,
};

// ── field registry ──

const FIELDS: DatasheetField[] = [
  // ── Vitals (absorbs the old Structural Vitals + Property Summary sections) ──
  {
    key: "PropertySubType",
    label: "Property Type",
    group: "vitals",
    format: (p) => str(p, "PropertySubType") ?? str(p, "PropertyType"),
  },
  { key: "ArchitecturalStyle", label: "Style", group: "vitals", format: (p) => joined(p, "ArchitecturalStyle") },
  { key: "ApproximateAge", label: "Property Age", group: "vitals", format: (p) => str(p, "ApproximateAge") },
  {
    key: "LotWidth",
    label: "Lot Dimensions",
    group: "vitals",
    format: (p) => {
      const w = num(p, "LotWidth");
      if (w === null || w <= 0) return null;
      const d = num(p, "LotDepth");
      const units = str(p, "LotSizeUnits");
      return [`${w} x ${d ?? "N/A"}`, units].filter(Boolean).join(" ");
    },
  },
  { key: "DirectionFaces", label: "Direction Faces", group: "vitals", format: (p) => str(p, "DirectionFaces") },
  {
    key: "HeatType",
    label: "Heating",
    group: "vitals",
    format: (p) => [str(p, "HeatType"), str(p, "HeatSource")].filter(Boolean).join(" · ") || null,
  },
  { key: "Cooling", label: "Cooling", group: "vitals", format: (p) => joined(p, "Cooling") },
  { key: "Basement", label: "Basement", group: "vitals", format: (p) => joined(p, "Basement") },
  {
    key: "KitchensTotal",
    label: "Kitchens",
    group: "vitals",
    // Known segments only — never fabricate a 0 the feed did not assert.
    format: (p) => {
      const total = num(p, "KitchensTotal");
      const above = num(p, "KitchensAboveGrade");
      const below = num(p, "KitchensBelowGrade");
      const known = [total, above, below].filter((v): v is number => v !== null);
      if (known.length === 0) return null;
      if (known.every((v) => v === 0)) return null; // all-zero row is noise
      const segs: string[] = [];
      if (above !== null) segs.push(`${above} above`);
      if (below !== null) segs.push(`${below} below`);
      if (total === null) return segs.join(" · ");
      return segs.length > 0 ? `${total} (${segs.join(" · ")})` : String(total);
    },
  },
  {
    key: "RoomsAboveGrade",
    label: "Rooms",
    group: "vitals",
    // Known segments only — never fabricate a 0 the feed did not assert.
    format: (p) => {
      const above = num(p, "RoomsAboveGrade");
      const below = num(p, "RoomsBelowGrade");
      const segs: string[] = [];
      if (above !== null) segs.push(`${above} above`);
      if (below !== null) segs.push(`${below} below`);
      return segs.length > 0 ? segs.join(" · ") : null;
    },
  },
  {
    key: "BedroomsAboveGrade",
    label: "Bedrooms",
    group: "vitals",
    // Known segments only. BedroomsTotal includes below-grade, so the plain-total
    // fallback gets NO "above" suffix and no below segment appended to it.
    format: (p) => {
      const above = num(p, "BedroomsAboveGrade");
      const below = num(p, "BedroomsBelowGrade");
      if (above !== null) {
        const segs = [`${above} above`];
        if (below !== null) segs.push(`${below} below`);
        return segs.join(" · ");
      }
      const total = num(p, "BedroomsTotal");
      if (total !== null) return String(total);
      return below !== null ? `${below} below` : null;
    },
  },
];

// Mark helpers as used — they are available for Task 2+ fields.
// TODO(Task 2): remove — these helpers get wired when the remaining groups land.
void (yes satisfies typeof yes);
void (money satisfies typeof money);

const DEFAULT_ORDER: DatasheetGroupId[] = GROUPS.map((g) => g.id);

/**
 * Resolve the registry against a payload. Only populated rows are returned;
 * groups with zero rows are dropped. `order` is the future persona-lens /
 * per-user reorder seam — it may reorder groups but can never add or remove
 * fields (per-user hiding is compliance-gated; see spec).
 *
 * `order` is normalized: duplicates are deduped, unknown ids are ignored, and
 * any DEFAULT_ORDER groups missing from it are appended afterwards in default
 * order — a partial `order` reorders its listed groups to the front but never
 * removes the rest.
 */
export function buildDatasheet(p: RawPayload, order?: DatasheetGroupId[]): ResolvedGroup[] {
  const requested = (order ?? []).filter(
    (id, i, arr) => DEFAULT_ORDER.includes(id) && arr.indexOf(id) === i,
  );
  const groupOrder = [...requested, ...DEFAULT_ORDER.filter((id) => !requested.includes(id))];
  const out: ResolvedGroup[] = [];
  for (const id of groupOrder) {
    const meta = GROUPS.find((g) => g.id === id);
    if (!meta) continue;
    const applies = GROUP_APPLIES[id];
    if (applies && !applies(p)) continue;
    const rows: ResolvedRow[] = [];
    for (const f of FIELDS) {
      if (f.group !== id) continue;
      let value: string | null = null;
      try {
        value = f.format(p);
      } catch {
        value = null; // formatter must never take the page down on garbage feed data
      }
      if (value === null) continue;
      const row: ResolvedRow = { key: f.key, label: f.label, value };
      if (f.href) {
        try {
          const href = f.href(p);
          if (href) row.href = href;
        } catch {
          /* omit link, keep row */
        }
      }
      if (f.flag) {
        try {
          row.flagged = f.flag(p);
        } catch {
          row.flagged = false;
        }
      }
      rows.push(row);
    }
    if (rows.length > 0) out.push({ group: meta, rows });
  }
  return out;
}
