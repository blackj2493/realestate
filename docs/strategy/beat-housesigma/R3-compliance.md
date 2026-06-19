# R3 — Compliance / TRREB Guardrail (sign-off)

**Author:** `compliance` | **Round:** 3 | Read R3-SHORTLIST.

## ✅ ENDORSE

I endorse the merged shortlist without dissent. It is faithfully inside the compliance envelope — every ruling I issued across R0–R2 is correctly reflected: G is gated row-level + public aggregate-VOW teaser (min-N≥5); C is a hard precondition for all Phase 2–3 gated surfaces; J is the permanent >100 answer split active-public / sold-gated; D emits the two-column `rent_idx_public` (public) vs `rent_blended_gated` (gated) split I asked for; K strips AVM/sold from OG exports; L is active-IDX aggregates + templated prose (no LLM, §6.2(k)); B removes the fabricated cap rate (a §5.8/§10.1 data-integrity protection, not just UX). The strategic spine ("open the lobby, gate the vault; lead with the wedge") is the compliant shape of "instant hit" — public *active* surfaces wide open, regulated *VOW-derived* magic behind the required rope.

## Confirmation of the routed open item (yes, with clause)

**CONFIRMED — YES.**
- **Single-listing `OriginalListPrice − ListPrice` (one record's own active-feed-native fields) = ✅ anon-SAFE passthrough.** The subtraction is a display computation on two fields of the *same single active record* — it merges nothing, joins no other records, and builds no dataset derivative, so it does **not** trigger **IDX §6.2(f)** (the anti-merge/anti-exploit-the-*dataset* clause). It is permitted field-selection display under **IDX §6.3(f)**. Grounded in our own deterministic ETL (`transformer.ts:596-597`). *One sourcing condition stands:* `PreviousListPrice → ListPrice` is IDX-feed-native and SAFE today; the field literally named `OriginalListPrice` appears under the **VOW** payload spec, so confirm it is carried on the **active IDX record** before shipping that specific field publicly (else use the IDX-native `PreviousListPrice` drop, which is unconditionally safe).
- **Cross-chain price compression = 🔒 gated.** The relist-stitched `total_price_drop` / `true_price_drop_pct` fold in `raw_vow_sold` sold campaigns (`sync.ts:116-125,395`) → VOW-derived → **VOW §6.2(f)**, behind `requireConsumer`, with a public aggregate teaser only.

Same "↓ $40k" visual, two different sources: single-record arithmetic is public; the stitched chain is gated. Product must wire the public badge to the single-listing fields, not to `total_price_drop`.

## One status update for the record — CORRECTION (compare cells = CONFIRMED BREACH)

**I must correct my own earlier "CLEAR" message this round.** I previously reported compare cells clear based on `compareMetricsConfig.ts:196-197` (which *defines* a brokerage row). `product-ux` re-verified the actual render path and I confirmed it directly: **`CompareClient.tsx` builds its own `<table>` with per-listing `<th>` columns (lines 85-100) showing price + address ONLY — it does NOT use the shared `ListingCardBody`, and the config's brokerage row is NOT among the rendered always-visible `CORE_METRICS` (line 105).** There is zero `ListOfficeName` output on the desktop compare table (and the same must be checked on `CompareMobile`, line 128).

**This is a CONFIRMED, citable §6.3(c) breach on a public, anonymously-reachable, shareable surface** (`/properties/compare?ids=...`, anon-reachable, `robots index:false`). A config that *declares* mandatory display does not prove the render *emits* it. **Fix required: add a `ListOfficeName` row at sibling weight (no visual separation) to the rendered compare table BEFORE move F drives anon traffic to it.** `perf-arch` is sizing the fix inside C's effort; `product-ux` owns it as the concrete deliverable.

Corrected audit status: **map popup CLEAR · ledger row CLEAR · compare cell = BREACH (fix required).** So move **C now carries THREE hard items**: (1) flip `VOW_ENFORCE_TERMS=true`; (2) the verified-clean brokerage surfaces; (3) **add the missing brokerage row to the compare table.** Lesson for the record: verify the render path, not the schema.

Sign-off stands (ENDORSE) — the breach is already absorbed into C, which is a hard precondition; it does not change the plan, only confirms C must include the compare-table fix. Idle.
