# Feature demo clips

Scripted Playwright recordings of the REAL app — real cursor → real button →
real result (never abstract animations). One command regenerates any clip after
a UI change, so the demo library never rots.

## Commands

```bash
npm run demo:record -- --list                 # scenes
npm run demo:record -- rail-draw              # one clip, against prod (anon)
npm run demo:record -- --all                  # everything recordable right now
npm run demo:record -- <id> --headed          # watch it record (debugging)
npm run demo:record -- <id> --base-url=http://localhost:3000
```

Output: `scripts/demos/out/<scene-id>.mp4` (H.264, 1600×900, silent, faststart)
plus a `.jpg` poster. `out/` is gitignored.

## VOW compliance — the two lanes

1. **Anon lane (default):** scenes run against prod as an anonymous visitor.
   What gets recorded is by definition what an anon user may see (IDX only).
2. **Unlocked lane:** scenes that demo the signed-in experience (Deal Score,
   AVM, sale history, …) must ONLY drive a **synthetic PPDEMO listing** on a
   local dev server:

   ```bash
   npm run demo:fixture -- <RealListingKey> --id=PPDEMO001   # build fixture
   $env:DEMO_FIXTURES = "1"; npm run dev                     # serve it
   npm run demo:record -- listing-unlocked --base-url=http://localhost:3000
   ```

   The fixture generator (`make-fixture.ts`) takes a real listing through the
   production data path (so every derived object has a real shape), then scales
   all dollar figures, shifts all dates, and replaces the identity (address,
   coords, photos, agents, remarks, parcel ids). It REFUSES to write if any
   sensitive source token survives. Fixtures are served only when
   `DEMO_FIXTURES=1` AND not on Vercel AND the key starts with `PPDEMO`
   (`src/lib/demo/demoListing.ts`).

## Publishing into the app

Copy the finished clip + poster to `public/demos/` and set `demoVideo:
"/demos/<id>.mp4"` on the feature's row in `featureRegistry.ts`. The Feature
Guide then shows a "Watch demo" toggle that mounts an autoplay/muted/loop
player only while expanded (closed rows never fetch the file). Several features
may share one clip (the listing-analysis stack all points at
`listing-unlocked.mp4`).

## Adding a scene

Create `scenes/<name>.ts` exporting a `Scene` (id = featureRegistry id where
possible), register it in `scenes/index.ts`. Use `human.*` for all motion and
call `markStart()` once the page has settled — everything before it is trimmed.
First-run tours/coach dots are auto-suppressed via a seeded `pp_discovery`.
