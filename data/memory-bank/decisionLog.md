# Architectural Decision Log

* **Decision 1:** We are using **Typesense** for our frontend search instead of Postgres/Supabase. 
  * *Reason:* Relational databases are too slow for complex, multi-variable filtering. Typesense sits in RAM and gives us sub-50ms latency, protecting us from TRREB rate limits.
* **Decision 2:** We are using **MiniMax M2.7** as our primary coding agent via the Continue.dev and Roo Code extensions. 
  * *Reason:* MiniMax M2.7 scores highly on SWE-Pro for autonomous execution and has a 200k context window, allowing it to read massive JSON payloads without losing logic.
* **Decision 3:** YAML Configuration parsing. 
  * *Reason:* When configuring YAML files for our tools, we must use spaces instead of tabs and wrap string values in quotes to prevent invisible character syntax errors.
* **Decision 4:** ETL transformer and Typesense schema must be kept in sync — this is the core data contract.
  * *Reason:* Typesense rejects entire documents if ANY declared field is missing from the payload. We lost days to schema/transformer drift where fields like `AssociationFee`, `BasementType`, `RawImages`, and `EntryTimestamp` were declared in the schema but not output by the transformer.
  * *Rule:* For every field declared in `typesenseSchema.ts`, the transformer must output it unconditionally — always. Use `?? 0` for numbers, `|| ''` for strings, `|| []` for arrays.
* **Decision 5:** Strict field naming convention (camelCase) throughout the stack.
  * *Reason:* We had a snake_case schema (`list_price`, `bedrooms`) that was later changed to camelCase (`ListPrice`, `BedroomsTotal`) to match what the transformer outputs. Inconsistent casing between schema, transformer, client, and frontend caused repeated batch rejections.
  * *Rule:* All field names use camelCase exclusively. No mixed conventions.
* **Decision 6:** Node.js worker scripts must import `dotenv/config`.
  * *Reason:* `ingester.ts` loaded `.env` correctly, but `sync.ts` did not — causing `SUPABASE_SERVICE_ROLE_KEY is not set` errors when running standalone. Inconsistent env loading is a silent failure that only surfaces when you run outside the Next.js context.
  * *Rule:* Every standalone Node.js script in `scripts/worker/` must include `import 'dotenv/config'` at the top.
* **Decision 7:** Supabase migrations must be applied manually via the dashboard — the CLI `db push` requires a local DATABASE_URL that we don't have configured.
  * *Reason:* `npx supabase db push` failed because `DATABASE_URL` was not in the local `.env`. We instead applied migrations manually via the Supabase SQL Editor dashboard.
  * *Rule:* For Supabase schema changes, paste the migration SQL directly into the Supabase Dashboard SQL Editor. Keep migration files self-contained and idempotent (`ADD COLUMN IF NOT EXISTS`).
* **Decision 8:** Do not invest time in mock test data — validate with real ingestion early.
  * *Reason:* We spent significant time debugging mock test failures (missing `ParkingTotal`, `CityRegion`, `Status`, `AssociationFee` in test data). The real pipeline only worked correctly when we ran `npx tsx scripts/worker/ingester.ts sync` with actual API data.
  * *Rule:* Keep mock tests minimal. Invest in real connectivity tests (`ingester.ts sync`) as the primary validation path.
* **Decision 9:** Real estate data is inherently messy — ETL must normalize overlapping fields and handle nulls gracefully.
  * *Reason:* The VOW and IDX APIs return overlapping/different field names for the same data (e.g., `TaxAnnualAmount` vs `AnnualTaxes`, `MlsStatus` vs `StandardStatus`). Null values appear on pre-construction, assignment, and condo listings regularly. The transformer must use fallback chains, not fail on nulls.
  * *Rule:* Every field mapping in `transformer.ts` uses a fallback chain. No field throws — they all fall back to `0`, `''`, `[]`, or a computed default.
* **Decision 10:** Typesense string fields cannot accept `null` — must use empty string `''` as fallback.
   * *Reason:* When `suite_confidence` was `null`, Typesense rejected the document with `"Field 'suite_confidence' must be a string"`. Typesense requires an actual string value or omits the field entirely.
   * *Rule:* For string fields declared in Typesense schema, always provide a fallback: `someField ?? ''`. Never leave string fields as `null`.
* **Decision 11:** Async transformer pattern requires `Promise.all` for parallel Supabase lookups.
   * *Reason:* Phase 3 introduced async Supabase calls for Rent AVM, True Value, and Mill Rate lookups. Sequential awaiting would triple sync time.
   * *Rule:* When multiple independent async operations are needed, use `Promise.all` for parallel execution.
* **Decision 12:** Supabase AVM lookups fail silently — must use try/catch with fallback defaults.
   * *Reason:* During sync, if Supabase queries fail (network, permissions, empty table), the transformer must not throw.
   * *Rule:* Wrap all Supabase service calls in try/catch blocks. Log warnings on failure, return fallback values.
* **Decision 13:** Phase 2/3 Services must be isolated modules with clear interfaces.
   * *Reason:* Created `multiUnitCalculator.ts`, `parkingCalculator.ts`, `rentAVM.ts`, `trueValueCalculator.ts`, `financialMetrics.ts` as independent services for unit testing and parallel development.
   * *Rule:* Each calculator service has a single responsibility and returns a typed interface. All services import `dotenv/config` at the top.