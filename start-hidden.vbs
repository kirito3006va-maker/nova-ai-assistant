' Lanza el agente de Telegram en segundo plano sin ventana visible
Dim args, i
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " " & WScript.Arguments(i)
Next
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Users\USER\.gemini\antigravity\scratch\telegram-bridge\start-agent.cmd""" & args, 0, False
