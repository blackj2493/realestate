import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The Supabase mirror + server sync are best-effort side-channels; stub them so the
// test observes ONLY the localStorage single-source-of-truth behaviour (and never
// loads the browser Supabase client / fires a real fetch under the node env).
vi.mock("@/lib/personas/personaAccount", () => ({
  mirrorPersonaToAccount: vi.fn(async () => {}),
  adoptAccountPersonaIfUnset: vi.fn(async () => null),
}));
vi.mock("@/lib/dashboard/configSync", () => ({
  pushConfig: vi.fn(),
  fetchServerConfig: vi.fn(async () => ({ config: null, unavailable: true })),
}));

// vitest env is `node`, so provide the minimal browser globals the persona
// write-through touches: a localStorage the config store can read/write.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const CONFIG_KEY = "pp_dashboard_config";
let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

describe("persona write-through — the terminal lens IS the shared dashboard config", () => {
  it("setActivePersona persists the lens into the dashboard config store", async () => {
    const { useCommandCenterStore } = await import("@/lib/stores/commandCenterStore");
    const { getConfig } = await import("@/lib/dashboard/config");

    useCommandCenterStore.getState().setActivePersona("flippers");

    expect(useCommandCenterStore.getState().activePersona).toBe("flippers");
    // The crux of fix #6: the terminal no longer keeps a private lens — it wrote
    // through to the ONE store the dashboard + listing pages also read.
    expect(getConfig().persona).toBe("flippers");
  });

  it("persisting a lens preserves the rest of the config (regions/boards)", async () => {
    const { persistPersona } = await import("@/lib/personas/personaStore");
    const { getConfig, saveConfig } = await import("@/lib/dashboard/config");

    saveConfig({ ...getConfig(), regions: ["Ottawa"] });
    persistPersona("cashflow");

    expect(getConfig().persona).toBe("cashflow");
    expect(getConfig().regions).toEqual(["Ottawa"]);
  });

  it("persistPersona is a no-op when the lens is unchanged (hydrate re-apply is free)", async () => {
    const { persistPersona } = await import("@/lib/personas/personaStore");

    persistPersona("builders");
    const snapshot = storage.getItem(CONFIG_KEY);
    persistPersona("builders"); // same value → must not rewrite
    expect(storage.getItem(CONFIG_KEY)).toBe(snapshot);
  });
});
