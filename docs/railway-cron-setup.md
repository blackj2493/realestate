# Railway Cron Setup — Daily Sync & Estimates Recompute

The ETL pipeline runs on **Railway cron**, not GitHub Actions. GitHub Actions' egress
to Supabase began truncating REST responses (`premature close`) — Supabase logged `200`s
while the runner never received the body — while Supabase and the Railway-hosted app were
unaffected. Running the sync from Railway puts it on the same healthy network path as the
app. The GitHub workflows are kept as **manual-only fallbacks** (`workflow_dispatch`).

## What runs where

| Job | Command | Schedule | GitHub fallback |
| --- | --- | --- | --- |
| Daily sync (full pipeline) | `npm run sync:daily` | `0 3 * * *` (daily 03:00 UTC) | `daily-sync.yml` (manual) |
| Estimates recompute (full table) | `npm run sync:recompute` | `0 7 * * 0,3` (Sun & Wed 07:00 UTC) | `estimates-recompute.yml` (manual) |

- `npm run sync:daily` → `scripts/worker/dailySync.ts`, a single orchestrator that runs
  every step the old workflow did, in order, with per-step timeouts. Core sync is
  critical (aborts on failure); all other steps are best-effort. Exits non-zero on any
  failure so Railway flags the run.
- `npm run sync:recompute` → `refresh-property-estimates.ts --apply` **unsharded** — on
  Railway there's no 6h job ceiling, so the full recompute runs in one pass (no `--shard`
  matrix needed).
- `tsx` was moved to `dependencies` so it's available at runtime regardless of how
  Railway prunes dev deps.

## One-time setup (Railway dashboard)

Do this on the **`main`** branch after merging the PR (production should track `main`).

For **each** of the two jobs, create a new service in the existing Railway project:

1. **New → GitHub Repo** → `blackj2493/realestate`, branch `main`.
2. **Settings → Deploy → Start Command:** `npm run sync:daily` (or `npm run sync:recompute`).
3. **Settings → Cron Schedule:** `0 3 * * *` (or `0 7 * * 0,3`).
   - A cron service must be **one-shot**: it runs the start command and exits. Do NOT
     attach a public domain or a healthcheck — those are for long-running services.
4. **Settings → Region:** match your Supabase region to minimise latency.
5. **Variables:** add the env vars below (copy shared ones from the app service).

> Cron services run the start command on the existing build/image — they don't rebuild
> each run, so startup is just container boot + the command.

## Environment variables

| Variable | Daily | Recompute | Purpose |
| --- | :---: | :---: | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | Supabase REST endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | RLS-bypass key for the ETL |
| `PROPTX_IDX_TOKEN` | ✅ | — | TRREB IDX feed (Active) |
| `PROPTX_VOW_TOKEN` | ✅ | — | TRREB VOW feed (Sold) |
| `TYPESENSE_ADMIN_API_KEY` | ✅ | — | Typesense indexing (hard-required by `sync.ts` on import) |
| `DATABASE_URL` | ✅ | — | Session-pooler string for the geo-flags step (raw `pg`) |
| `RESEND_API_KEY` | ✅ | — | Watchlist alert emails + failure email |
| `ALERTS_FROM_EMAIL` | optional | — | Verified Resend sender (default `support@pureproperty.ca`) |
| `NEXT_PUBLIC_SITE_URL` | ✅ | — | Link base for alerts + revalidation target |
| `REVALIDATE_SECRET` | ✅ | — | Auth for `/api/revalidate` cache-bust |
| `SYNC_ALERT_EMAIL` | optional | — | Where to email the orchestrator's failure summary |

The recompute job only needs the two Supabase vars.

## Failure notifications

1. **Railway native (recommended):** Project → Settings → **Notifications** → enable
   email/Slack/webhook on **deployment failed / crashed**. Both jobs exit non-zero on
   failure, so Railway flags them.
2. **Orchestrator email (optional):** set `SYNC_ALERT_EMAIL` (+ `RESEND_API_KEY`) and the
   daily orchestrator emails a per-step failure summary. No-ops cleanly if unset.

## Notes

- After confirming Railway runs green, leave the GitHub workflows as-is — they're
  `workflow_dispatch`-only and harmless. Trigger one by hand if Railway is ever down.
- The cron cadence here matches what the workflows used; adjust the Cron Schedule field
  in Railway to change it (no code change needed).
