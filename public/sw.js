/*
 * PureProperty service worker.
 *
 * Deliberately NARROW. Listing pages render on the server behind the VOW gate
 * (force-dynamic) and TRREB caps data age at 24h, so an HTML document must NEVER be
 * served from a cache: a cached page could hand gated data to a signed-out user or show
 * yesterday's price. The only HTML this worker stores is /offline, which carries no
 * listing data.
 *
 * Policy (see classify()):
 *   static   — /_next/static/* (content-hashed), icons, logos, the manifest → cache-first
 *   navigate — every page load → network; if the network is down, the /offline page
 *   network  — everything else: all /api, /auth, /ingest, cross-origin, RSC fetches, POST
 *
 * Versioning: registered as /sw.js?v=<build id> (ServiceWorkerRegister.tsx). A new build
 * id is a new worker, and the old cache is deleted on activate.
 *
 * KILL SWITCH: set KILL_SWITCH = true and deploy. The next check-in wipes every cache,
 * unregisters this worker and reloads open tabs, so a bad worker can never pin users.
 *
 * Runs in the browser, not Node — plain ES5-style JS on purpose. src/lib/pwa/sw.test.ts
 * loads this file and exercises classify() through self.__pp.
 */
"use strict";

var KILL_SWITCH = false;

var VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
var CACHE_NAME = "pp-" + VERSION;
var OFFLINE_URL = "/offline";

/** Precached on install so the offline page has its logo even on a cold cache. */
var SHELL_ASSETS = ["/icons/icon-192.png", "/logo.svg", "/logo-light.svg", "/favicon.svg"];

var STATIC_PREFIXES = ["/_next/static/", "/icons/"];
var STATIC_EXACT = { "/logo.svg": 1, "/logo-light.svg": 1, "/favicon.svg": 1, "/manifest.webmanifest": 1 };
/** Checked BEFORE the navigate test on purpose: a navigation to /api or /auth gets no offline fallback. */
var NETWORK_ONLY_PREFIXES = ["/api/", "/auth/", "/ingest/"];

function startsWithAny(path, prefixes) {
  for (var i = 0; i < prefixes.length; i++) {
    if (path.indexOf(prefixes[i]) === 0) return true;
  }
  return false;
}

/**
 * @param {{ url: string, method: string, mode?: string, destination?: string }} req
 * @returns {"static"|"navigate"|"network"}
 */
function classify(req) {
  if (req.method !== "GET") return "network";
  var url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return "network";
  }
  if (url.origin !== self.location.origin) return "network";
  var path = url.pathname;
  if (startsWithAny(path, NETWORK_ONLY_PREFIXES)) return "network";
  if (req.mode === "navigate" || req.destination === "document") return "navigate";
  if (startsWithAny(path, STATIC_PREFIXES) || STATIC_EXACT[path] === 1) return "static";
  return "network";
}

/** cache.addAll is all-or-nothing; one missing asset must not fail the install. */
function addEach(cache, urls) {
  return Promise.all(
    urls.map(function (u) {
      return cache.add(u).catch(function () {
        /* best effort */
      });
    })
  );
}

self.addEventListener("install", function (event) {
  if (KILL_SWITCH) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return fetch(OFFLINE_URL, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error("offline page responded " + res.status);
        return res
          .clone()
          .text()
          .then(function (html) {
            // The offline page's own CSS/JS chunks, so it renders styled on a cold cache.
            var assets = [];
            var re = /(?:href|src)="(\/_next\/static\/[^"]+)"/g;
            var m;
            while ((m = re.exec(html))) assets.push(m[1]);
            return Promise.all([cache.put(OFFLINE_URL, res), addEach(cache, SHELL_ASSETS.concat(assets))]);
          });
      });
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return KILL_SWITCH || (k.indexOf("pp-") === 0 && k !== CACHE_NAME);
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        if (!KILL_SWITCH) return self.clients.claim();
        return self.registration
          .unregister()
          .then(function () {
            return self.clients.matchAll({ type: "window" });
          })
          .then(function (clients) {
            clients.forEach(function (c) {
              c.navigate(c.url);
            });
          });
      })
  );
});

function cacheFirst(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        // `basic` = same-origin and readable; never store an opaque or error response.
        if (res.ok && res.type === "basic") cache.put(request, res.clone());
        return res;
      });
    });
  });
}

/** Network first; only a FAILED fetch (no network) falls back. A 404/500 passes through. */
function networkWithOfflineFallback(request) {
  return fetch(request).catch(function () {
    return caches.match(OFFLINE_URL).then(function (hit) {
      return (
        hit ||
        new Response("You are offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
      );
    });
  });
}

self.addEventListener("fetch", function (event) {
  var kind = classify(event.request);
  if (kind === "network") return; // no respondWith → the browser handles it untouched
  if (kind === "static") {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  event.respondWith(networkWithOfflineFallback(event.request));
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Test seam (src/lib/pwa/sw.test.ts). Harmless in production.
self.__pp = { classify: classify, CACHE_NAME: CACHE_NAME, OFFLINE_URL: OFFLINE_URL, KILL_SWITCH: KILL_SWITCH };
