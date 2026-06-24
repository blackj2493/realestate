# Move 1 — Vault min-n study + suppression rule

**Goal:** pick the beachhead submarket(s) and lock the rule that stops you from ever publishing or
grading a thin, ungradeable cell. 100% controllable — it runs entirely against the ~217k records you
already own. Do this first; it defines the entire public + private surface.

**Time:** one evening (plus query runtime).

## What "gradeable" means
The public Scoreboard and the private grading engine make *claims* (medians, calls, graded predictions).
A claim built on too few sales is noise that will later be wrong on the record — the opposite of the
"license-on-the-line track record" that is your only durable moat. So a `(submarket × month)` cell is
**gradeable** only when freehold 1–4-unit sales clear a minimum count. The AVM already uses an effective
sample floor of 6 peers (`src/lib/avm/types.ts:MIN_PEER_NEFF`); for *published* submarket claims we start
more conservatively at **min-n = 12 per month** and require a cell to clear it in ≥80% of observed months.

## Run it
```bash
# default: Brampton, min-n=12/mo, trailing 12mo, grain = city_region
npx tsx scripts/admin/phaseZeroMinN.ts

# verify the freehold filter captures the right rows (lists every property_sub_type with counts)
npx tsx scripts/admin/phaseZeroMinN.ts --diagnose

# tune it
npx tsx scripts/admin/phaseZeroMinN.ts --city=Mississauga --minN=15 --months=12 --grain=region
npx tsx scripts/admin/phaseZeroMinN.ts --city=Brampton --grain=fsa     # postal-FSA grain
```

**Connection (CLAUDE.md §12):** set `DATABASE_URL` to the Supabase **Session pooler** string
(Dashboard → Settings → Database → Connection string → *Session pooler*, port **5432** — not the
Transaction pooler on 6543). Put it in `.env.local` (never commit it). `DIRECT_DB_URL` is IPv6-only and
will not resolve here. The script is **read-only** — it never writes to `raw_vow_sold`.

## What it outputs
1. **`--diagnose` mode** — distinct `property_sub_type` values with counts, so you can confirm the
   freehold filter (`Detached`, `Semi-Detached`, `Att/Row/Townhouse`, etc.) is catching the right stock and
   not silently dropping a major spelling variant. **Run this once before trusting the numbers.**
2. **City overview** — top 905 cities by trailing freehold 1–4-unit sales, so you can see whether Brampton
   is actually the densest gradeable pond or whether an adjacent city is better.
3. **Submarket table for the target city** — per `city_region` (or FSA): median monthly sales, how many of
   the observed months clear min-n, total, and a ✅ **gradeable** flag.
4. **Flip-volume proxy** — same property re-sold at a gain in 2–18 months (directional TAM read only).
5. A JSON artifact `phase-zero-minn-<city>-<date>.json` with everything, plus the suppression-rule object.

## How to read it / the decision
- **≥1 gradeable submarket** → those are your launch cells. **Lock the suppression rule:** publish/grade a
  cell only at min-n ≥ 12; below that, auto-roll up to the parent city or suppress entirely. Write the rule
  into the Scoreboard generator and the grading pipeline so a thin cell can never leak a claim.
- **0 gradeable submarkets at `region` grain** → widen the grain (city-level) or pick a different primary
  city from the overview table. If even city-level is thin, the *public-index* leg of the strategy is not
  viable in this geography — keep the private cockpit + B2B report and drop the public Scoreboard leg.
- **Flip proxy** → carry this number into Move 2. The count of warm, reachable flip operators should be the
  same order of magnitude as the flip-proxy volume. If your warm well is 5 names but the city shows 400
  flips/yr, you have a distribution problem, not a demand problem (and vice-versa).

## Compliance note
This study uses **counts and medians only** — never raw listings — so it is squarely inside the aggregate
surface that is compliant without a public-listing license. It touches no LLM. It does not modify the
immutable vault. Nothing here needs the Move-4 sign-off; it is pure desk research on data you hold.
