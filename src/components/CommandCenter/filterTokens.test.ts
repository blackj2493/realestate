import { describe, it, expect, vi } from "vitest";
import { buildFilterTokens, type FilterItem } from "./filterTokens";
import { CORE_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import { PERSONA_CONFIG, defaultTerminalFilters } from "@/lib/personas/personaConfig";
import type { FilterValue } from "@/lib/filters/types";

const coreItem = (key: string, value: FilterValue, onChange = vi.fn()): FilterItem => ({
  def: FILTERS_BY_KEY[key],
  value,
  onChange,
});

// All core filters at their defaults (inactive) — the empty-bar baseline.
const defaultCoreItems = (): FilterItem[] =>
  CORE_FILTERS.map((def) => ({ def, value: def.defaultValue, onChange: vi.fn() }));

const base = {
  coreItems: defaultCoreItems(),
  addedItems: [] as FilterItem[],
  controls: PERSONA_CONFIG.cashflow.controls,
  filters: { ...defaultTerminalFilters },
  setFilter: vi.fn(),
  removeAddedFilter: vi.fn(),
  showAdvanced: true,
  showInvestor: true,
};

describe("buildFilterTokens", () => {
  it("returns no tokens when every filter is at its default", () => {
    expect(buildFilterTokens(base)).toEqual([]);
  });

  it("emits a core token with the def's chip label and removes by resetting to default", () => {
    const onChange = vi.fn();
    const tokens = buildFilterTokens({
      ...base,
      coreItems: [
        coreItem("price", [800_000, 3_000_000], onChange), // min lifted off floor ⇒ active
        ...defaultCoreItems().filter((i) => i.def.key !== "price"),
      ],
    });
    const price = tokens.find((t) => t.id === "price");
    expect(price?.tone).toBe("core");
    expect(price?.label).toBe("$800k+");
    price?.onRemove();
    expect(onChange).toHaveBeenCalledWith([0, 3_000_000]); // back to full range
  });

  it("includes added filters only when showAdvanced, and un-pins them on remove", () => {
    const onChange = vi.fn();
    const removeAddedFilter = vi.fn();
    const addedItems = [coreItem("parking", { n: 2, exact: false }, onChange)];

    expect(buildFilterTokens({ ...base, showAdvanced: false, addedItems })).toEqual([]);

    const tokens = buildFilterTokens({ ...base, addedItems, removeAddedFilter });
    const parking = tokens.find((t) => t.id === "parking");
    expect(parking?.label).toBe("2+ Parking");
    parking?.onRemove();
    expect(onChange).toHaveBeenCalledWith(0); // stepper default
    expect(removeAddedFilter).toHaveBeenCalledWith("parking");
  });

  it("emits an investor token gated by showInvestor and clears it via setFilter", () => {
    const setFilter = vi.fn();
    const filters = { ...defaultTerminalFilters, minCapRate: 5 };

    expect(buildFilterTokens({ ...base, showInvestor: false, filters })).toEqual([]);

    const tokens = buildFilterTokens({ ...base, filters, setFilter });
    const cap = tokens.find((t) => t.tone === "investor");
    expect(cap?.label).toBe("Cap Rate ≥ 5%");
    cap?.onRemove();
    expect(setFilter).toHaveBeenCalledWith("minCapRate", defaultTerminalFilters.minCapRate);
  });
});
