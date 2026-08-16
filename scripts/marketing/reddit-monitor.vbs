' Launches reddit-monitor.cmd with no visible window.
'
' Task Scheduler running a .cmd directly pops a console on the desktop every
' time it fires. Twice an hour that is genuinely irritating, and irritating
' automation gets switched off. The alternative — "run whether user is logged on
' or not" — requires storing the account password in the task, which is a worse
' trade for a job that only needs to run while the machine is in use anyway.
'
' Run(cmd, 0, False): 0 = hidden window, False = don't block.
CreateObject("WScript.Shell").Run _
  "cmd /c ""C:\Users\PCGamer\Projects\Realestate-reddit\scripts\marketing\reddit-monitor.cmd""", 0, False
