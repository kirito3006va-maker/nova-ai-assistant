@echo off
title NOVA Holographic Desktop Client
cd /d "C:\Users\USER\.gemini\antigravity\scratch\telegram-bridge"
echo Iniciando interfaz holografica de Nova en Lenovo LOQ...

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://127.0.0.1:3840" --window-size=1060,670 --window-position=180,45 --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream
) else (
  start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --app="http://127.0.0.1:3840" --window-size=1060,670 --window-position=180,45 --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream
)
