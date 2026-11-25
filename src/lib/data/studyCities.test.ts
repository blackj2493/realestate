import { describe, expect, it } from "vitest";
import { studyCitySlugForFeedCity } from "./studyCities";

describe("studyCitySlugForFeedCity", () => {
  it("maps feed City values to the study city slug", () => {
    expect(studyCitySlugForFeedCity("Toronto C01")).toBe("toronto");
    expect(studyCitySlugForFeedCity("Barrhaven")).toBe("ottawa");
    expect(studyCitySlugForFeedCity("London North")).toBe("london");
    expect(studyCitySlugForFeedCity("Richmond Hill")).toBe("richmond-hill");
    expect(studyCitySlugForFeedCity("St. Catharines")).toBe("st-catharines");
    expect(studyCitySlugForFeedCity("Kawartha Lakes")).toBe("kawartha-lakes");
  });

  it("returns null for a city outside the study set", () => {
    expect(studyCitySlugForFeedCity("North Bay")).toBeNull();
    expect(studyCitySlugForFeedCity("")).toBeNull();
    expect(studyCitySlugForFeedCity(null)).toBeNull();
  });
});
