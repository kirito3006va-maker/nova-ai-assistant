$wsh = New-Object -ComObject WScript.Shell

$sc = $wsh.CreateShortcut("$env:USERPROFILE\Desktop\Nova Orbe Flotante.lnk")
$sc.TargetPath = "$PSScriptRoot\NovaFloatingOrb.exe"
$sc.WorkingDirectory = "$PSScriptRoot"
$sc.Description = "Orbe Flotante Holografico de Nova (Nativo de PC sin fondo)"
$sc.Save()

$sc2 = $wsh.CreateShortcut("$env:USERPROFILE\Desktop\Nova Widget.lnk")
$sc2.TargetPath = "$PSScriptRoot\NovaFloatingOrb.exe"
$sc2.WorkingDirectory = "$PSScriptRoot"
$sc2.Description = "Orbe Flotante Holografico de Nova (Nativo de PC sin fondo)"
$sc2.Save()

Write-Output "ACCESOS_NATIVOS_CREADOS_OK"
