@echo off
REM ---------------------------------------------------------------------------
REM Reddit opportunity monitor — scheduled runner.
REM
REM WHY THIS RUNS LOCALLY AND NOT ON GITHUB ACTIONS: the monitor reads Reddit's
REM public RSS feeds, which need no API key. Reddit throttles those hard from
REM datacenter IPs (a GitHub runner gets almost nothing) but tolerates them from
REM a residential connection. Measured here: roughly a third of feeds return on
REM any given sweep, the rest 429. That is fine — matches are deduped in
REM Supabase, so a feed missed now is picked up next run. Partial coverage costs
REM latency, not leads, which is why the schedule is every 30 min rather than
REM every 2h.
REM
REM Launched hidden via reddit-monitor.vbs so no console window flashes on the
REM desktop twice an hour. Register with install-reddit-task.cmd.
REM ---------------------------------------------------------------------------

set "REPO=C:\Users\PCGamer\Projects\Realestate-reddit"
set "LOG=%REPO%\reddit-monitor.log"

cd /d "%REPO%" || exit /b 1

REM Keep the log from growing forever — rotate past ~5 MB, keep one generation.
for %%F in ("%LOG%") do if %%~zF GTR 5000000 move /y "%LOG%" "%LOG%.1" >nul 2>&1

echo. >> "%LOG%"
echo ===================== %DATE% %TIME% ===================== >> "%LOG%"

REM Call the local tsx binary rather than npx: npx re-resolves the package on
REM every run, which is slow and needs the network for no reason.
call "%REPO%\node_modules\.bin\tsx.cmd" scripts\marketing\redditMonitor.ts --apply >> "%LOG%" 2>&1

echo [exit %ERRORLEVEL%] >> "%LOG%"
exit /b %ERRORLEVEL%
