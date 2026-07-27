import { describe, it, expect, beforeEach } from "vitest";
import {
  saveProfile,
  saveConfig,
  getProfile,
  getConfig,
  hasForeignWorkspace,
  resetLocalWorkspace,
} from "./config";

/**
 * The dashboard workspace lives in localStorage, not Supabase, so it outlives the account
 * that wrote it. These cover the case that reached a user: an account deleted server-side
 * and re-created, whose browser still held the old workspace — which silently suppressed
 * the first-run market picker and carried the previous name into the dashboard greeting.
 */
/** A valid config with the given regions — getConfig() supplies the default shape. */
const aConfig = (regions: string[]) => ({ ...getConfig(), regions });

// The suite runs in the node environment (this repo has no jsdom), and config.ts guards
// on `typeof window`. A tiny in-memory shim is enough to exercise the real read/write
// paths without pulling in a DOM just for these cases.
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
}

describe("local workspace ownership", () => {
  beforeEach(installLocalStorage);

  it("reports no foreign workspace on a clean browser", () => {
    expect(hasForeignWorkspace()).toBe(false);
  });

  it("reports no foreign workspace for an /apply seed, which never stores regions", () => {
    // /apply is the only pre-account writer and always seeds `regions: []`.
    saveProfile({ fullName: "Casey", email: "casey@example.com", objectives: [], regions: [], assets: [] });
    saveConfig(aConfig([]));
    expect(hasForeignWorkspace()).toBe(false);
  });

  it("detects a previous account's workspace by its saved regions", () => {
    saveConfig(aConfig(["Oakville"]));
    expect(hasForeignWorkspace()).toBe(true);
  });

  it("clears both the profile and the config, so no name or city carries over", () => {
    saveProfile({ fullName: "Previous Owner", email: "prev@example.com", objectives: [], regions: [], assets: [] });
    saveConfig(aConfig(["Oakville"]));

    resetLocalWorkspace();

    // The greeting source is gone — DashboardClient reads getProfile()?.fullName.
    expect(getProfile()).toBeNull();
    expect(getConfig().regions).toEqual([]);
    expect(hasForeignWorkspace()).toBe(false);
  });

  it("leaves a freshly seeded region in place after a reset", () => {
    saveConfig(aConfig(["Oakville"]));
    resetLocalWorkspace();
    saveConfig({ ...getConfig(), regions: ["Hamilton"] });
    expect(getConfig().regions).toEqual(["Hamilton"]);
  });
});
