import { describe, it, expect } from "vitest";
import { parseFilterCommands, type FilterCommand } from "./filterCommands";

const sale = { transactionMode: "sale", propertyClass: "residential" } as const;

const find = (cmds: FilterCommand[], key: string) => cmds.find((c) => c.key === key);

describe("parseFilterCommands", () => {
  it("ignores too-short queries", () => {
    expect(parseFilterCommands("a", sale)).toEqual([]);
  });

  it("parses an upper price bound from natural language", () => {
    const cmd = find(parseFilterCommands("under 800k", sale), "price");
    expect(cmd).toMatchObject({ control: "range", value: [0, 800_000] });
    expect(cmd?.label).toContain("≤$800k");
  });

  it("parses a lower bound and a range", () => {
    expect(find(parseFilterCommands("over 1.2m", sale), "price")).toMatchObject({
      value: [1_200_000, 3_000_000],
    });
    expect(find(parseFilterCommands("800k-1.2m", sale), "price")).toMatchObject({
      value: [800_000, 1_200_000],
    });
  });

  it("respects the transaction mode's price bounds (rent caps at 12k)", () => {
    const cmd = find(parseFilterCommands("under 50k", { transactionMode: "rent", propertyClass: "residential" }), "price");
    expect(cmd).toMatchObject({ value: [0, 12_000] }); // clamped to rent max
  });

  it("parses beds and baths as min steppers", () => {
    const cmds = parseFilterCommands("4 beds 2 baths", sale);
    expect(find(cmds, "beds")).toMatchObject({ control: "stepper", value: { n: 4, exact: false } });
    expect(find(cmds, "baths")).toMatchObject({ control: "stepper", value: { n: 2, exact: false } });
  });

  it("parses '4bd' shorthand", () => {
    expect(find(parseFilterCommands("4bd detached", sale), "beds")).toMatchObject({ value: { n: 4, exact: false } });
  });

  it("matches a class-scoped property type by name", () => {
    const cmd = find(parseFilterCommands("detached", sale), "homeType");
    expect(cmd?.control).toBe("enum");
    expect((cmd as Extract<FilterCommand, { control: "enum" }>).option.toLowerCase()).toContain("detached");
  });

  it("matches deep enum options hyphen/space-insensitively", () => {
    expect(find(parseFilterCommands("finished basement", sale), "basement")).toMatchObject({
      control: "enum",
      option: "Finished",
    });
    expect(find(parseFilterCommands("walkout", sale), "basement")).toMatchObject({ option: "Walk-Out" });
  });

  it("parses a deep stepper from its unit word", () => {
    expect(find(parseFilterCommands("2 parking", sale), "parking")).toMatchObject({
      control: "stepper",
      value: { n: 2, exact: false },
    });
  });

  it("resolves several filters from one multi-token query", () => {
    const cmds = parseFilterCommands("4bd under 900k finished basement", sale);
    expect(find(cmds, "beds")).toBeTruthy();
    expect(find(cmds, "price")).toMatchObject({ value: [0, 900_000] });
    expect(find(cmds, "basement")).toMatchObject({ option: "Finished" });
  });
});
