import { describe, expect, it } from "vitest";
import { digestCadence, DORMANT_WORKSPACE_DAYS } from "./digestCadence";

const DAY = 86_400_000;
const base = {
  areaCount: 1,
  anyFilteredArea: false,
  workspaceAgeMs: 30 * DAY,
  chosen: null as null | "daily" | "weekly",
};

describe("digestCadence", () => {
  it("caps the cell that produces 45% of all churn", () => {
    // One area, never narrowed, workspace untouched for a month.
    expect(digestCadence(base)).toEqual({
      frequency: "weekly",
      reason: "dormant_single_unfiltered_area",
      derived: true,
    });
  });

  it("always marks a derived cap as needing an explanation in the email", () => {
    // Migration 144's constraint: a change the reader did not ask for and cannot see reads
    // as broken delivery. `derived` is what forces the caller to say so.
    expect(digestCadence(base).derived).toBe(true);
    expect(digestCadence({ ...base, areaCount: 3 }).derived).toBe(false);
  });

  describe("each condition alone is not enough", () => {
    it("a second area means the reader showed intent", () => {
      const c = digestCadence({ ...base, areaCount: 2 });
      expect(c.frequency).toBe("daily");
      expect(c.reason).toBe("default");
    });

    it("a real filter means the firehose is already narrowed", () => {
      expect(digestCadence({ ...base, anyFilteredArea: true }).frequency).toBe("daily");
    });

    it("a recently-touched workspace means they came back", () => {
      expect(digestCadence({ ...base, workspaceAgeMs: 2 * DAY }).frequency).toBe("daily");
    });
  });

  describe("the dormancy boundary", () => {
    it("sends nightly right up to the threshold", () => {
      const justInside = DORMANT_WORKSPACE_DAYS * DAY - 1;
      expect(digestCadence({ ...base, workspaceAgeMs: justInside }).frequency).toBe("daily");
    });

    it("caps once the threshold is reached", () => {
      expect(
        digestCadence({ ...base, workspaceAgeMs: DORMANT_WORKSPACE_DAYS * DAY }).frequency
      ).toBe("weekly");
    });

    it("treats a missing workspace row as dormant", () => {
      // Every signup since #511 writes this row at acceptance, so a missing one is an
      // account that predates it and has not been back.
      expect(digestCadence({ ...base, workspaceAgeMs: null }).frequency).toBe("weekly");
    });
  });

  describe("an explicit choice is final", () => {
    it("keeps a reader on nightly even when the rule would cap them", () => {
      const c = digestCadence({ ...base, chosen: "daily" });
      expect(c).toEqual({ frequency: "daily", reason: "chosen", derived: false });
    });

    it("keeps a reader on weekly even when the rule would not cap them", () => {
      const c = digestCadence({ ...base, areaCount: 5, anyFilteredArea: true, chosen: "weekly" });
      expect(c).toEqual({ frequency: "weekly", reason: "chosen", derived: false });
    });

    it("never presents a chosen cadence as derived, so the email does not explain itself", () => {
      expect(digestCadence({ ...base, chosen: "weekly" }).derived).toBe(false);
    });
  });

  it("fails open — an engaged reader is never capped", () => {
    for (const areaCount of [0, 2, 3, 10, 34]) {
      expect(digestCadence({ ...base, areaCount }).frequency, `${areaCount} areas`).toBe("daily");
    }
  });
});
