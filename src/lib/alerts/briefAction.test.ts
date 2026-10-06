import { beforeAll, describe, expect, it } from "vitest";
import {
  FILTER_PRESETS,
  PERSONA_PRESETS,
  applyPreset,
  briefActionUrl,
  isBriefAction,
  parseBriefAction,
  signBriefAction,
  verifyBriefAction,
} from "./briefAction";
import { DEFAULT_ACTIVITY_LENS } from "@/lib/dashboard/config";

beforeAll(() => {
  process.env.ALERTS_UNSUBSCRIBE_SECRET = "test-secret";
});

const EMAIL = "Reader@Example.com";

describe("brief action links", () => {
  it("round-trips a filter link for one area", () => {
    const url = new URL(briefActionUrl(EMAIL, "filter:detached", "https://x.test/", "bub-1"));
    expect(url.pathname).toBe("/api/email/brief");
    const q = url.searchParams;
    expect(q.get("e")).toBe("reader@example.com");
    expect(verifyBriefAction(q.get("e")!, q.get("a")!, q.get("b")!, q.get("s")!)).toBe(true);
  });

  it("cannot be edited into another action or another area", () => {
    const sig = signBriefAction(EMAIL, "filter:detached", "bub-1");
    expect(verifyBriefAction(EMAIL, "filter:condo", "bub-1", sig)).toBe(false);
    expect(verifyBriefAction(EMAIL, "filter:detached", "bub-2", sig)).toBe(false);
    expect(verifyBriefAction("other@example.com", "filter:detached", "bub-1", sig)).toBe(false);
  });

  it("requires an area on filter links and refuses one on persona links", () => {
    expect(verifyBriefAction(EMAIL, "filter:detached", "", signBriefAction(EMAIL, "filter:detached", ""))).toBe(false);
    const p = signBriefAction(EMAIL, "persona:cashflow");
    expect(verifyBriefAction(EMAIL, "persona:cashflow", "", p)).toBe(true);
    expect(verifyBriefAction(EMAIL, "persona:cashflow", "bub-1", signBriefAction(EMAIL, "persona:cashflow", "bub-1"))).toBe(false);
  });

  it("does not share signatures with the frequency links", () => {
    // Same secret, different payload prefix: a brief signature is never a valid frequency one.
    expect(signBriefAction(EMAIL, "persona:smart")).not.toBe(signBriefAction(EMAIL, "persona:cashflow"));
    expect(isBriefAction("weekly")).toBe(false);
    expect(isBriefAction("filter:mansion")).toBe(false);
    expect(isBriefAction("persona:smart")).toBe(true);
  });

  it("parses actions", () => {
    expect(parseBriefAction("filter:beds3")).toEqual({ kind: "filter", preset: "beds3" });
    expect(parseBriefAction("persona:builders")).toEqual({ kind: "persona", persona: "builders" });
  });
});

describe("presets", () => {
  it("replace only their own lens fields", () => {
    const mine = { ...DEFAULT_ACTIVITY_LENS, minBeds: 2, basement: "finished" as const };
    expect(applyPreset(mine, "detached")).toEqual({ ...mine, propertyTypes: ["detached"] });
    expect(applyPreset(mine, "beds3")).toEqual({ ...mine, minBeds: 3, bedsExact: false });
  });

  it("offer at most four chips per persona, all defined", () => {
    for (const ids of Object.values(PERSONA_PRESETS)) {
      expect(ids.length).toBeLessThanOrEqual(4);
      for (const id of ids) expect(FILTER_PRESETS[id]).toBeDefined();
    }
  });
});
