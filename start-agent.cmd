@echo off
cd /d "C:\Users\USER\.gemini\antigravity\scratch\telegram-bridge"
"C:\Program Files\nodejs\node.exe" --max-http-header-size=131072 telegram-agent.mjs %* >> "C:\Users\USER\.gemini\antigravity\scratch\telegram-bridge\agent.log" 2>&1
