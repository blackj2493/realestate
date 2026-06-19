# R3 — product-ux (Sign-off)

## ENDORSE.

I endorse the merged shortlist in full. It captures the council's convergence faithfully and sequences risk correctly: stabilize → de-fake → cache → wedge-led funnel → differentiate. The strategic spine (Flipper-first on real data, Cashflow as the gated destination, Builder cut, "expose existing edge through compliant surfaces, not new engines") is the right call and matches what four of us independently re-derived.

## My dissent is captured correctly — confirmed.

Line 33 records it exactly as I argued: **"do not ship F before M(minimal) responsive toggle. F's chain = B + E1 + M."** Both the substance and the dependency chain are right. Line 21 (F dependency chain) and line 23 (M elevated to P0 growth-gate, "don't open a door you've made unwalkable") match my R2 framing verbatim. Nothing to add — the dissent stands as logged, non-blocking.

## One factual sharpening for the record (not a dissent — improves Phase 0 scoping)

Line 12 lists "compare cells = last unverified surface." Post-R2 I **finished that audit** — it's no longer unverified, it's a **confirmed §6.3(c) breach**: `CompareClient.tsx` renders the comparison table with **zero brokerage** (no `ListOfficeName` anywhere; it does *not* use the shared `ListingCardBody` that makes the map popup + ledger compliant), and `/properties/compare` is anon-reachable + shareable (`page.tsx:1-7`, `robots index:false`). So **C's brokerage work is one concrete fix** (add a `ListOfficeName` row at sibling weight to `CompareClient`), not an audit-then-maybe-fix. perf-arch already re-scoped C to **S** on this basis (flip `VOW_ENFORCE_TERMS` + the one compare row). Ownership is clean: I own the `CompareClient` row; perf-arch owns the ISR cache auth-partitioning so gated rows never bake into shared HTML.

## Open item (line 40) — I confirm from the product side

The anon **single-listing price-drop fact** (`OriginalListPrice − ListPrice`, one record's own fields) is the highest-converting compliant element on the anon Flipper card, and it's a display computation on a single listing's own fields — no cross-record stitch. I built my Q#1 anon-card answer around exactly this bright line and defer to compliance for the final clause stamp, but from a UX standpoint it's the right hook to lead the public card with (it shows a real distress signal Realtor.ca doesn't and HouseSigma gates harder). Cross-chain compression stays gated — agreed.

— product-ux, signed off.
