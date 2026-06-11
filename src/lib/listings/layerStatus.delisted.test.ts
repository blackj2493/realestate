import { describe, it, expect } from "vitest";
import { layerStatus, LAYER_TONE_CLASS } from "./layerStatus";
import type { ListingDocument } from "@/lib/typesense/client";

describe("layerStatus — de-listed comps", () => {
  it("labels each reason, all in the delisted (amber) tone", () => {
    for (const [kind, label] of [
      ["terminated", "TERMINATED"],
      ["expired", "EXPIRED"],
      ["suspended", "SUSPENDED"],
    ] as const) {
      const s = layerStatus({ id: "x", compKind: kind } as ListingDocument);
      expect(s.label).toBe(label);
      expect(s.tone).toBe("delisted");
    }
    expect(LAYER_TONE_CLASS.delisted).toContain("amber");
  });
});
