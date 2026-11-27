import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { registerEdition } from "./registerEdition";

const SOURCE = readFileSync("src/lib/data/reportEditions.ts", "utf8");

describe("registerEdition", () => {
  it("adds the import and the last EDITIONS entry", () => {
    const out = registerEdition(SOURCE, "2026-12");
    expect(out).toContain('import e202611 from "@/data/reports/2026-11.json";\nimport e202612 from "@/data/reports/2026-12.json";');
    expect(out).toContain(
      "export const EDITIONS: ReportEdition[] = [e202611 as unknown as ReportEdition, e202612 as unknown as ReportEdition];",
    );
  });

  it("is a no-op for an edition already listed", () => {
    const once = registerEdition(SOURCE, "2026-12");
    expect(registerEdition(once, "2026-12")).toBe(once);
    expect(registerEdition(SOURCE, "2026-11")).toBe(SOURCE);
  });

  it("refuses a bad edition or an unknown file shape", () => {
    expect(() => registerEdition(SOURCE, "2026-1")).toThrow();
    expect(() => registerEdition("export const X = 1;", "2026-12")).toThrow();
  });
});
