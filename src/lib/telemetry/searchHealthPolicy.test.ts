import { describe, expect, it } from "vitest";
import {
  evaluateSearchHealth,
  classifySearchError,
  isBotUserAgent,
  ALERT_COOLDOWN_MS,
  BURST_MIN,
  BURST_MIN_SESSIONS,
  GRIND_MIN,
} from "./searchHealthPolicy";

const NOW = Date.parse("2026-07-20T12:00:00Z");
const base = { hourCount: 0, hourSessions: 0, dayCount: 0, lastAlertAtMs: null, nowMs: NOW };

describe("evaluateSearchHealth", () => {
  it("stays quiet on a blip (one user's bad Wi-Fi)", () => {
    expect(evaluateSearchHealth({ ...base, hourCount: 5, hourSessions: 1, dayCount: 5 })).toEqual({ alert: false });
    // Burst volume from a SINGLE session is still not actionable.
    expect(
      evaluateSearchHealth({ ...base, hourCount: BURST_MIN + 3, hourSessions: 1, dayCount: BURST_MIN + 3 })
    ).toEqual({ alert: false });
  });

  it("alerts on a widespread burst", () => {
    expect(
      evaluateSearchHealth({ ...base, hourCount: BURST_MIN, hourSessions: BURST_MIN_SESSIONS, dayCount: BURST_MIN })
    ).toEqual({ alert: true, reason: "burst" });
  });

  it("alerts on a slow 24h grind even without an hourly burst", () => {
    expect(evaluateSearchHealth({ ...base, hourCount: 2, hourSessions: 1, dayCount: GRIND_MIN })).toEqual({
      alert: true,
      reason: "grind",
    });
  });

  it("cooldown suppresses repeats of the same episode", () => {
    const tripped = { ...base, hourCount: BURST_MIN, hourSessions: 3, dayCount: 99 };
    expect(
      evaluateSearchHealth({ ...tripped, lastAlertAtMs: NOW - ALERT_COOLDOWN_MS + 60_000 })
    ).toEqual({ alert: false });
    expect(
      evaluateSearchHealth({ ...tripped, lastAlertAtMs: NOW - ALERT_COOLDOWN_MS - 60_000 })
    ).toEqual({ alert: true, reason: "burst" });
  });
});

describe("classifySearchError", () => {
  it("recognizes the axios timeout the terminal shows", () => {
    expect(classifySearchError(new Error("timeout of 15000ms exceeded"))).toBe("timeout");
    expect(classifySearchError(new Error("Request aborted"))).toBe("timeout");
  });

  it("recognizes network-layer failures", () => {
    expect(classifySearchError(new Error("Network Error"))).toBe("network");
    expect(classifySearchError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("defaults everything else to http_error", () => {
    expect(classifySearchError(new Error("Request failed with status code 503"))).toBe("http_error");
    expect(classifySearchError(undefined)).toBe("http_error");
  });
});

describe("isBotUserAgent", () => {
  it("drops crawlers, headless renderers and a missing UA", () => {
    for (const ua of [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0 Mobile Safari/537.36 Chrome-Lighthouse",
      "",
      null,
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });

  it("keeps real browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
    ]) {
      expect(isBotUserAgent(ua)).toBe(false);
    }
  });
});
