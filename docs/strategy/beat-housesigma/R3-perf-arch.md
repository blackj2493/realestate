# R3 — perf-arch (Sign-off)

## ENDORSE.

I endorse the merged shortlist as written. The phasing matches the critical path I argued (`A-triage` blocks → A-harden ∥ B ∥ C → D ∥ E1 → F+G+M → H/I/J/K/L), the compliance tiers are correctly threaded, and all three of my flagged items are captured verbatim:

- **A-triage = TRUE BLOCKER** (Phase 0: "re-indexing into a 502 cluster = data loss") — confirmed.
- **E split** (E1 ships now, gates F; "E2 rooms→ETL = later, don't let it delay E1") — confirmed.
- **My DISSENT logged** (J = the *permanent* >100 answer; forbid any future infinite-scroll workaround, §6.3(b)) — confirmed in both the J line and the dissents section. This is now a *positive design constraint*, not a blocking objection.

**Two non-blocking implementation reminders I'm carrying into build (already agreed, recording for the record):**
1. **E1's cache must be auth-partitioned** — IDX body cached in shared ISR/CDN HTML; VOW-gated fields (AVM, sale history, breakdown) computed per-request behind `requireConsumer`, never baked into the shared cache. (Compliance R1 made this binding; I own it.)
2. **No forced 131k full re-index for D1** — build `rental_market_index` in Supabase (zero Typesense load) and let the nightly delta `upsert` backfill the yield fields organically; only do a one-shot backfill if the cluster is confirmed right-sized post-A. New numeric fields land `facet:false, sort:true, optional:true` (RAM policy).

No remaining dissent beyond the one logged. Plan is sound. Ship it.
