import { describe, it, expect } from "vitest";
import {
  detectInstallPlatform,
  isIos,
  parseInstallState,
  shouldShowInstallNudge,
  NUDGE_MIN_VISITS,
  NUDGE_SNOOZE_MS,
} from "./installPlatform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";

describe("isIos", () => {
  it("matches an iPhone user agent", () => {
    expect(isIos(IPHONE, 5)).toBe(true);
  });
  it("treats a Macintosh UA with touch as an iPad (desktop-site mode), but not a real Mac", () => {
    expect(isIos(IPAD_DESKTOP_UA, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP_UA, 0)).toBe(false);
  });
});

describe("detectInstallPlatform", () => {
  it("is installed whenever the page runs standalone, regardless of UA", () => {
    expect(
      detectInstallPlatform({ userAgent: ANDROID, maxTouchPoints: 5, standalone: true, hasNativePrompt: true })
    ).toBe("installed");
    expect(
      detectInstallPlatform({ userAgent: IPHONE, maxTouchPoints: 5, standalone: true, hasNativePrompt: false })
    ).toBe("installed");
  });
  it("is ios on iPhone even though no native prompt exists there", () => {
    expect(
      detectInstallPlatform({ userAgent: IPHONE, maxTouchPoints: 5, standalone: false, hasNativePrompt: false })
    ).toBe("ios");
  });
  it("is android only once Chrome has offered the native prompt", () => {
    expect(
      detectInstallPlatform({ userAgent: ANDROID, maxTouchPoints: 5, standalone: false, hasNativePrompt: true })
    ).toBe("android");
    expect(
      detectInstallPlatform({ userAgent: ANDROID, maxTouchPoints: 5, standalone: false, hasNativePrompt: false })
    ).toBe("unsupported");
  });
  it("is desktop for the native prompt on a non-Android UA", () => {
    expect(
      detectInstallPlatform({ userAgent: WINDOWS_CHROME, maxTouchPoints: 0, standalone: false, hasNativePrompt: true })
    ).toBe("desktop");
  });
  it("is unsupported where there is nothing to offer", () => {
    expect(
      detectInstallPlatform({ userAgent: FIREFOX_ANDROID, maxTouchPoints: 5, standalone: false, hasNativePrompt: false })
    ).toBe("unsupported");
  });
});

describe("shouldShowInstallNudge", () => {
  const now = 1_800_000_000_000;
  const base = { platform: "android" as const, isMobile: true, visits: NUDGE_MIN_VISITS, dismissedAt: null, now };

  it("shows on a phone from the second visit with no snooze", () => {
    expect(shouldShowInstallNudge(base)).toBe(true);
    expect(shouldShowInstallNudge({ ...base, platform: "ios" })).toBe(true);
  });
  it("waits for the second visit", () => {
    expect(shouldShowInstallNudge({ ...base, visits: NUDGE_MIN_VISITS - 1 })).toBe(false);
  });
  it("never shows on desktop, once installed, or where unsupported", () => {
    expect(shouldShowInstallNudge({ ...base, isMobile: false })).toBe(false);
    expect(shouldShowInstallNudge({ ...base, platform: "desktop" })).toBe(false);
    expect(shouldShowInstallNudge({ ...base, platform: "installed" })).toBe(false);
    expect(shouldShowInstallNudge({ ...base, platform: "unsupported" })).toBe(false);
  });
  it("honours the snooze window to the millisecond", () => {
    expect(shouldShowInstallNudge({ ...base, dismissedAt: now - NUDGE_SNOOZE_MS + 1 })).toBe(false);
    expect(shouldShowInstallNudge({ ...base, dismissedAt: now - NUDGE_SNOOZE_MS })).toBe(true);
  });
});

describe("parseInstallState", () => {
  const empty = { visits: 0, dismissedAt: null, installedAt: null };

  it("returns the empty state for null, garbage, or a wrong shape", () => {
    expect(parseInstallState(null)).toEqual(empty);
    expect(parseInstallState("")).toEqual(empty);
    expect(parseInstallState("{not json")).toEqual(empty);
    expect(parseInstallState('"a string"')).toEqual(empty);
    expect(parseInstallState("null")).toEqual(empty);
    expect(parseInstallState('{"visits":"3","dismissedAt":"x","installedAt":null}')).toEqual(empty);
  });
  it("round-trips a valid record and floors a fractional visit count", () => {
    expect(parseInstallState('{"visits":2.7,"dismissedAt":10,"installedAt":20}')).toEqual({
      visits: 2,
      dismissedAt: 10,
      installedAt: 20,
    });
  });
  it("rejects a negative or non-finite visit count", () => {
    expect(parseInstallState('{"visits":-1}').visits).toBe(0);
    expect(parseInstallState('{"visits":null}').visits).toBe(0);
  });
});
