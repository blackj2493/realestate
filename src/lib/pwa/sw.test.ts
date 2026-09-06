/**
 * Loads public/sw.js into a stub `self` and exercises its routing policy. This is the
 * compliance guard: an HTML document or an API response must never be classed as
 * cacheable (CLAUDE.md §4 — VOW gating happens in the server render; TRREB caps data
 * age at 24h).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ORIGIN = "https://www.pureproperty.ca";

type Req = { url: string; method: string; mode?: string; destination?: string };
type Kind = "static" | "navigate" | "network";
interface WorkerApi {
  classify: (req: Req) => Kind;
  CACHE_NAME: string;
  OFFLINE_URL: string;
  KILL_SWITCH: boolean;
}

function loadWorker(version = "abc123") {
  const src = readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8");
  const listeners: Record<string, unknown> = {};
  const self = {
    addEventListener: (type: string, fn: unknown) => {
      listeners[type] = fn;
    },
    location: { href: `${ORIGIN}/sw.js?v=${version}`, origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: {},
    registration: {},
    __pp: undefined as WorkerApi | undefined,
  };
  new Function("self", src)(self);
  if (!self.__pp) throw new Error("sw.js did not expose self.__pp");
  return { listeners, api: self.__pp };
}

const get = (p: string, extra: Partial<Req> = {}): Req => ({ url: ORIGIN + p, method: "GET", ...extra });
const nav = (p: string): Req => get(p, { mode: "navigate", destination: "document" });

describe("public/sw.js", () => {
  const { listeners, api } = loadWorker();
  const { classify } = api;

  it("registers the lifecycle handlers and ships with the kill switch OFF", () => {
    for (const ev of ["install", "activate", "fetch", "message"]) expect(listeners[ev]).toBeTypeOf("function");
    expect(api.KILL_SWITCH).toBe(false);
  });

  it("names the cache after the build id in the registration URL", () => {
    expect(api.CACHE_NAME).toBe("pp-abc123");
    expect(loadWorker("zzz").api.CACHE_NAME).toBe("pp-zzz");
    expect(api.OFFLINE_URL).toBe("/offline");
  });

  it("NEVER caches an HTML document — every navigation is network with an offline fallback", () => {
    expect(classify(nav("/"))).toBe("navigate");
    expect(classify(nav("/dashboard"))).toBe("navigate");
    expect(classify(nav("/properties/W1234567"))).toBe("navigate");
    expect(classify(nav("/property/on/toronto/12-main-st-W1234567"))).toBe("navigate");
    expect(classify(nav("/offline"))).toBe("navigate");
  });

  it("leaves every API, auth and analytics request alone, even as a navigation", () => {
    expect(classify(get("/api/listings/W1"))).toBe("network");
    expect(classify(nav("/api/listings/W1"))).toBe("network");
    expect(classify(get("/auth/callback?code=x"))).toBe("network");
    expect(classify(nav("/auth/confirm?token=x"))).toBe("network");
    expect(classify(get("/ingest/e/"))).toBe("network");
  });

  it("leaves the RSC payload of a client-side navigation alone (not a document, not static)", () => {
    expect(classify(get("/properties/W1234567?_rsc=1abc", { mode: "cors", destination: "" }))).toBe("network");
    expect(classify(get("/dashboard", { mode: "same-origin", destination: "empty" }))).toBe("network");
  });

  it("never touches cross-origin traffic (map tiles, Supabase, Typesense, MLS photos)", () => {
    expect(classify({ url: "https://api.mapbox.com/v4/tiles/1/1/1.pbf", method: "GET" })).toBe("network");
    expect(classify({ url: "https://pyzgnivilxhnwzfrdkiq.supabase.co/rest/v1/x", method: "GET" })).toBe("network");
    expect(classify({ url: "https://trreb-image.ampre.ca/x.jpg", method: "GET" })).toBe("network");
  });

  it("never caches a non-GET", () => {
    expect(classify({ url: ORIGIN + "/_next/static/chunks/a.js", method: "POST" })).toBe("network");
  });

  it("cache-firsts only content-hashed build output and the brand assets", () => {
    expect(classify(get("/_next/static/chunks/app/page-1a2b3c.js"))).toBe("static");
    expect(classify(get("/_next/static/css/abc.css"))).toBe("static");
    expect(classify(get("/_next/static/media/inter-latin.woff2"))).toBe("static");
    expect(classify(get("/icons/icon-192.png"))).toBe("static");
    expect(classify(get("/logo.svg"))).toBe("static");
    expect(classify(get("/manifest.webmanifest"))).toBe("static");
  });

  it("does not cache other public files or Next's image route", () => {
    expect(classify(get("/sample-listing.jpg"))).toBe("network");
    expect(classify(get("/demos/rail-draw.mp4"))).toBe("network");
    expect(classify(get("/_next/image?url=x"))).toBe("network");
    expect(classify(get("/_next/data/build/dashboard.json"))).toBe("network");
  });

  it("treats an unparseable URL as network", () => {
    expect(classify({ url: "not a url", method: "GET" })).toBe("network");
  });
});
