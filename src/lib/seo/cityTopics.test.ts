import { describe, expect, it } from "vitest";
import { CITY_TOPICS, TOPIC_HUBS, topicCity } from "./cityTopics";
import { outlookPath } from "@/lib/data/outlookCities";
import { homeValuePath } from "@/lib/homeValue/content";
import { powerOfSalePath } from "@/components/powerOfSale/PowerOfSaleView";
import { notSellingPath } from "@/components/notSelling/NotSellingView";
import { basementValuePath } from "@/lib/data/basementValue";
import { priceChangePath } from "@/lib/data/priceChange";
import { condoPricesPath } from "@/lib/data/condoPrices";
import { goodTimeToBuyPath } from "@/lib/data/goodTimeToBuy";
import { schoolPricesPath } from "@/lib/data/schoolPrices";
import { soldPricesPath } from "@/lib/data/soldPrices";
import { bestTimeToSellPath } from "@/lib/data/bestTimeToSell";

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
    expect(by["basement-value"].path("markham")).toBe(basementValuePath("markham"));
    expect(by["basement-value"].hub).toBe(basementValuePath());
    expect(by["best-time-to-sell"].path("markham")).toBe(bestTimeToSellPath("markham"));
    expect(by["best-time-to-sell"].hub).toBe(bestTimeToSellPath());
    expect(by["sold-prices"].path("markham")).toBe(soldPricesPath("markham"));
    expect(by["sold-prices"].hub).toBe(soldPricesPath());
    expect(by["school-catchment-prices"].path("markham")).toBe(schoolPricesPath("markham"));
    expect(by["school-catchment-prices"].hub).toBe(schoolPricesPath());
    expect(by["price-change"].path("markham")).toBe(priceChangePath("markham"));
    expect(by["price-change"].hub).toBe(priceChangePath());
    expect(by["condo-prices"].path("markham")).toBe(condoPricesPath("markham"));
    expect(by["condo-prices"].hub).toBe(condoPricesPath());
    expect(by["good-time-to-buy"].path("markham")).toBe(goodTimeToBuyPath("markham"));
    expect(by["good-time-to-buy"].hub).toBe(goodTimeToBuyPath());
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
