@echo off
title NOVA Desktop Mini Widget
cd /d "C:\Users\USER\.gemini\antigravity\scratch\telegram-bridge"
echo Iniciando mini widget holografico de Nova en pantalla...

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://127.0.0.1:3840/widget.html" --window-size=265,310 --window-position=1640,710 --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream
) else (
  start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --app="http://127.0.0.1:3840/widget.html" --window-size=265,310 --window-position=1640,710 --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream
)
