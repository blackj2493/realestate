import { describe, expect, it } from "vitest";
import { CITY_TOPICS, TOPIC_HUBS, topicCity } from "./cityTopics";
import { outlookPath } from "@/lib/data/outlookCities";
import { homeValuePath } from "@/lib/homeValue/content";
import { powerOfSalePath } from "@/components/powerOfSale/PowerOfSaleView";
import { notSellingPath } from "@/components/notSelling/NotSellingView";

describe("cityTopics", () => {
  it("each topic path matches its family helper", () => {
    const by = Object.fromEntries(CITY_TOPICS.map((t) => [t.id, t]));
    expect(by.market.path("markham")).toBe(outlookPath("markham"));
    expect(by["power-of-sale"].path("markham")).toBe(powerOfSalePath("markham"));
    expect(by["not-selling"].path("markham")).toBe(notSellingPath("markham"));
    expect(by["home-value"].path("markham")).toBe(homeValuePath("markham"));
    expect(by["power-of-sale"].hub).toBe(powerOfSalePath());
    expect(by["not-selling"].hub).toBe(notSellingPath());
    expect(by["home-value"].hub).toBe(homeValuePath());
  });

  it("hub list covers every topic hub", () => {
    expect(TOPIC_HUBS.map((h) => h.href).sort()).toEqual(CITY_TOPICS.map((t) => t.hub).sort());
  });

  it("resolves covered city slugs case-insensitively, and rejects others", () => {
    expect(topicCity("Markham")?.slug).toBe("markham");
    expect(topicCity("sudbury")).toBeNull();
    expect(topicCity(undefined)).toBeNull();
  });
});
