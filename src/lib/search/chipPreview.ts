/**
 * chipPreview — for a STRUCTURED search-bar query (one that parsed into chips), run a
 * real filtered query so the dropdown can show "N listings match · here are a few" that
 * genuinely satisfy the chips (type, beds, baths, parking, price), instead of the raw
 * address text-matches that ignore the filters (e.g. a Detached showing under a
 * "Townhouse" chip).
 *
 * Reuses buildTerminalCoreClauses — the SAME builder the live terminal search uses — so
 * the preview count + samples line up with what "Apply N filters" will show. The chips
 * that AREN'T universal filters (school, stale, price-drop) are added here too: on Apply
 * they route through the school lens / persona, so the preview must include them or its
 * count diverges (e.g. "near 9+ school" cut 27 → 7). Location drives the text query,
 * exactly as the live search resolves a place string. Runs on the browser Typesense
 * search key against `properties`, like federatedSuggest.
 */
import { getTypesenseClient, type ListingDocument } from "@/lib/typesense/client";
import { buildTerminalCoreClauses } from "@/lib/filters/terminalQuery";
import { makeDefaultUniversalFilters } from "@/lib/filters/filterRegistry";
import type { UniversalFilterState } from "@/lib/filters/types";
import type { TerminalFilterState } from "@/lib/personas/personaConfig";
import type { ParsedChip } from "./types";

const SAMPLE = 3;
const NO_PERSONA = { buildFilterString: () => "" };

/** Map the parsed chips onto a UniversalFilterState — the same structural keys
 *  chipApply.syncChips writes. Location is the text query (handled below); persona-only
 *  chips (stale / price-drop / school) aren't part of the universal set, so they're not
 *  previewed. */
function chipsToUniversalFilters(chips: ParsedChip[]): UniversalFilterState {
  const uf = makeDefaultUniversalFilters();
  let lo: number | undefined;
  let hi: number | undefined;
  for (const c of chips) {
    switch (c.kind) {
      case "priceMin": lo = c.value as number; break;
      case "priceMax": hi = c.value as number; break;
      case "beds": uf.beds = c.value as number; break;
      case "baths": uf.baths = c.value as number; break;
      case "parking": uf.parking = c.value as number; break;
      case "homeType": uf.homeType = c.value as string[]; break;
      case "basement": {
        const prev = Array.isArray(uf.basement) ? (uf.basement as string[]) : [];
        uf.basement = [...prev, ...(c.value as string[])];
        break;
      }
    }
  }
  if (lo != null || hi != null) {
    const cur = (uf.price as [number, number]) ?? [0, 0];
    uf.price = [lo ?? cur[0], hi ?? cur[1]];
  }
  return uf;
}

export interface ChipPreview {
  /** Total active listings matching the chips (unrestricted Typesense `found`). */
  count: number;
  /** A small sample to show inline. */
  listings: ListingDocument[];
}

export async function fetchChipPreview(
  chips: ParsedChip[],
  /** Indexed score field for the active school lens (schoolScoreField), so a school
   *  chip filters on the SAME field Apply uses. null → no school lens resolvable. */
  schoolField: string | null,
  signal?: AbortSignal
): Promise<ChipPreview | null> {
  const location = (chips.find((c) => c.kind === "location")?.value as string) ?? "";
  const core = buildTerminalCoreClauses({
    transactionMode: "sale",
    propertyClass: "residential",
    universalFilters: chipsToUniversalFilters(chips),
    filters: {} as TerminalFilterState,
    persona: NO_PERSONA,
    excludePersona: true,
  });
  // Non-universal chips — mirror exactly what syncChips → school lens / persona apply.
  const extras: string[] = [];
  const school = chips.find((c) => c.kind === "school");
  if (school && schoolField) extras.push(`${schoolField}:>=${school.value as number}`);
  if (chips.some((c) => c.kind === "staleOnly")) extras.push("IsStale:=true");
  const drop = chips.find((c) => c.kind === "priceDrop");
  if (drop) extras.push(`TotalPriceDrop:>=${drop.value as number}`);

  const filterBy = [...core, ...extras].join(" && ");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search(
        {
          q: location || "*",
          // City/CityRegion only — location chips are place names, and UnparsedAddress
          // isn't reliably searchable (federatedSuggest guards the same way).
          query_by: "City,CityRegion",
          filter_by: filterBy,
          per_page: SAMPLE,
          sort_by: "ListPrice:desc",
        },
        signal ? { abortSignal: signal } : undefined
      );
    return {
      count: res.found ?? 0,
      listings: (res.hits ?? []).map((h: { document: ListingDocument }) => h.document),
    };
  } catch {
    return null; // aborted / backend slow — caller keeps the chips + Apply, just no preview
  }
}
