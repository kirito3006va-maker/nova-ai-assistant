@echo off
echo Deteniendo Antigravity Telegram Agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*telegram-agent.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Proceso detenido: PID ' + $_.ProcessId) }"
echo Listo.
