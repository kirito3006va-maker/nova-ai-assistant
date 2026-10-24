@echo off
title NOVA Floating Desktop Orb
cd /d "C:\Users\USER\.gemini\antigravity\scratch\telegram-bridge"
echo Iniciando Orbe Flotante de Nova sin fondo en pantalla...
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "nova-floating-orb.ps1"
