import { describe, it, expect } from "vitest";
import {
  MAX_ASKS,
  narrowAskSubject,
  shouldAsk,
  suggestPart,
  wholeCityToNarrow,
} from "./narrowAsk";

describe("wholeCityToNarrow", () => {
  it("names Toronto and Ottawa, case-insensitively, and nothing else", () => {
    expect(wholeCityToNarrow("Toronto")).toBe("Toronto");
    expect(wholeCityToNarrow(" ottawa ")).toBe("Ottawa");
    expect(wholeCityToNarrow("Scarborough")).toBeNull();
    expect(wholeCityToNarrow("Toronto C02")).toBeNull();
    expect(wholeCityToNarrow("Mississauga")).toBeNull();
  });
});

describe("shouldAsk", () => {
  it("asks a reader never asked", () => {
    expect(shouldAsk(null)).toBe(true);
  });
  it(`stops after ${MAX_ASKS} asks`, () => {
    expect(shouldAsk({ shown_count: MAX_ASKS - 1, resolved: null })).toBe(true);
    expect(shouldAsk({ shown_count: MAX_ASKS, resolved: null })).toBe(false);
  });
  it("stops on any answer", () => {
    expect(shouldAsk({ shown_count: 0, resolved: "kept" })).toBe(false);
    expect(shouldAsk({ shown_count: 1, resolved: "switched" })).toBe(false);
  });
});

describe("suggestPart", () => {
  it("picks the part most opened homes sit in", () => {
    const p = suggestPart("Toronto", { "Toronto W06": 4, "Toronto W08": 3, "Toronto E05": 2 });
    expect(p?.name).toBe("Etobicoke");
  });
  it("ignores homes outside the city", () => {
    expect(suggestPart("Toronto", { Mississauga: 40, "Toronto E05": 3 })?.name).toBe("Scarborough");
  });
  it("needs enough opens to say anything", () => {
    expect(suggestPart("Toronto", { "Toronto E05": 2 })).toBeNull();
  });
  it("does not guess between tied parts", () => {
    expect(suggestPart("Toronto", { "Toronto E05": 3, "Toronto W06": 3 })).toBeNull();
  });
  it("works for Ottawa's OREB areas", () => {
    expect(suggestPart("Ottawa", { Barrhaven: 5, Kanata: 1 })?.name).toBe("Barrhaven and Manotick");
  });
  it("has nothing to say for a city not offered in parts", () => {
    expect(suggestPart("Mississauga", { Mississauga: 9 })).toBeNull();
  });
});

describe("narrowAskSubject", () => {
  it("is a ticker line, numbers first, never a question", () => {
    const s = narrowAskSubject("Toronto", 1890, "week");
    expect(s).toBe("Toronto · 1,890 new homes this week · pick your part");
    expect(s).not.toMatch(/[?!]/);
    expect(narrowAskSubject("Ottawa", 41, "night")).toBe("Ottawa · 41 new homes tonight · pick your part");
  });
});

import { parseNarrowInput } from "./narrowAction";
import { renderAlertsDigest } from "@/lib/alerts/digest";

describe("parseNarrowInput", () => {
  it("accepts a part of the city it names, by membership", () => {
    expect(parseNarrowInput({ city: "Toronto", action: "switch", part: "Scarborough" })).toEqual({
      kind: "switch",
      city: "Toronto",
      part: "Scarborough",
    });
    expect(parseNarrowInput({ city: "ottawa", action: "keep" })).toEqual({ kind: "keep", city: "Ottawa" });
  });
  it("rejects a part from another city, a made-up part and a city not offered in parts", () => {
    expect(parseNarrowInput({ city: "Toronto", action: "switch", part: "Kanata and Stittsville" })).toBeNull();
    expect(parseNarrowInput({ city: "Toronto", action: "switch", part: "Toronto C02" })).toBeNull();
    expect(parseNarrowInput({ city: "Mississauga", action: "keep" })).toBeNull();
    expect(parseNarrowInput({ city: "Toronto", action: "delete" })).toBeNull();
    expect(parseNarrowInput(null)).toBeNull();
  });
});

describe("the digest carries the ask", () => {
  const payload = { drops: [], statusChanges: [], bubbles: [] };
  const ask = {
    city: "Toronto",
    newCount: 268,
    period: "night" as const,
    suggested: { name: "Etobicoke", hint: "Mimico · Islington · The Kingsway", url: "https://x/areas/narrow?p=Etobicoke" },
    pickUrl: "https://x/areas/narrow?e=a",
    firstAsk: true,
  };

  it("takes the subject line on the first ask only", () => {
    expect(renderAlertsDigest(payload, undefined, { narrowArea: ask }).subject).toBe(
      "Toronto · 268 new homes tonight · pick your part"
    );
    expect(renderAlertsDigest(payload, undefined, { narrowArea: { ...ask, firstAsk: false } }).subject).not.toMatch(
      /pick your part/
    );
  });

  it("names the suggestion and offers switch, pick and keep, in HTML and text", () => {
    const r = renderAlertsDigest(payload, undefined, { narrowArea: ask });
    expect(r.html).toContain("You follow all of Toronto.");
    expect(r.html).toContain("Switch to Etobicoke");
    expect(r.html).toContain("Keep all of Toronto");
    expect(r.text).toContain("Most of the homes you opened are in Etobicoke");
    expect(r.text).toContain("https://x/areas/narrow?e=a&keep=1");
  });

  it("is absent when there is no ask", () => {
    expect(renderAlertsDigest(payload).html).not.toContain("You follow all of");
  });
});
