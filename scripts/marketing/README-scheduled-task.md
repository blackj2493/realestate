# Reddit monitor — scheduled task (Windows)

Runs the opportunity monitor every 30 minutes and pushes reply-worthy threads to
Telegram. **Nothing posts to Reddit automatically** — you read, edit, post.

## Why local and not GitHub Actions

The monitor reads Reddit's public RSS feeds, which need no API key. Reddit
throttles those hard from datacenter IPs — a GitHub runner gets almost nothing —
but tolerates them from a residential connection.

Measured on this machine: a full sweep gets roughly a third of feeds through and
429s the rest, even with a 12s pace and a 30s retry. That sounds bad and isn't.
Matches are deduped in `reddit_opportunities` (migration 093), so a feed missed
now is picked up next run. Partial coverage costs **latency, not leads** — which
is why the schedule is every 30 minutes rather than the original every 2 hours.

If Reddit API credentials ever become available, set `REDDIT_CLIENT_ID` and
`REDDIT_CLIENT_SECRET` in `.env.local` and the script uses the OAuth transport
instead — faster, complete coverage, and then it can move back to CI.

## The pieces

| file | job |
|---|---|
| `reddit-monitor.cmd` | Sets the working dir, rotates the log past 5 MB, calls the local `tsx` binary. Must stay **CRLF** — `cmd.exe` will not parse an LF batch file. |
| `reddit-monitor.vbs` | Launches the `.cmd` with a hidden window, so no console flashes on the desktop twice an hour. |
| `reddit-monitor.log` | Appended per run, gitignored. Rotates to `.log.1`. |

## Register the task

Already registered as **PureProperty Reddit Monitor**. To recreate:

```powershell
$vbs = "C:\Users\PCGamer\Projects\Realestate-reddit\scripts\marketing\reddit-monitor.vbs"
Register-ScheduledTask -TaskName "PureProperty Reddit Monitor" -Force `
  -Action  (New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"") `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
              -RepetitionInterval (New-TimeSpan -Minutes 30)) `
  -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -MultipleInstances IgnoreNew `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 25))
```

`StartWhenAvailable` catches up after the machine sleeps instead of skipping the
slot. `IgnoreNew` means a slow sweep never gets a second copy stacked on top of
it. The 25-minute limit kills a hung run — a healthy sweep takes about 10.

## Operating it

```powershell
Get-ScheduledTaskInfo -TaskName "PureProperty Reddit Monitor"   # last/next run, last result
Start-ScheduledTask   -TaskName "PureProperty Reddit Monitor"   # run now
Disable-ScheduledTask -TaskName "PureProperty Reddit Monitor"   # pause
Enable-ScheduledTask  -TaskName "PureProperty Reddit Monitor"
```

Watch it work: `Get-Content reddit-monitor.log -Tail 30 -Wait`

Run it by hand, without sending or writing to the DB:

```
npx tsx scripts/marketing/redditMonitor.ts            # dry run
npx tsx scripts/marketing/redditMonitor.ts --apply    # real: DB + Telegram
npx tsx scripts/marketing/redditMonitor.ts --subs TorontoRealEstate   # one sub
```

## Warmup mode

`WARMUP_MODE` is **on** by default, so every draft is product-free — no brand, no
link, no disclosure, because there is nothing to disclose when nothing is being
promoted. It is forced on regardless for any `no-links` sub.

Turn it off only once an account has genuine history **in the subs it posts to**.
Weeks, not days. Reddit's tolerance for self-promotion tracks visible history in
that community, not account age.

```
REDDIT_WARMUP=false   # in .env.local, when ready
```

The Telegram message states which mode produced the draft, and flags any draft
that names the site.

## Things that will bite

- **The `.cmd` must stay CRLF.** Saving it from an editor set to LF silently
  breaks every line. Symptom: `'ddit' is not recognized as an internal or
  external command`.
- **This worktree is on `feat/reddit-monitor`**, not `main`. When that branch
  merges, repoint `REPO` in the `.cmd` and the path in the `.vbs` at the main
  checkout, or the task keeps running stale code.
- **Telegram credentials live in `.env.local`** (gitignored) — `TELEGRAM_BOT_TOKEN`
  and `TELEGRAM_CHAT_ID`. The chat id only exists after you have messaged the bot;
  bots cannot open a conversation.
- **A partial Telegram send fails the whole run on purpose** and leaves the batch
  pending. Showing a thread twice is cheap; silently dropping one is not.
