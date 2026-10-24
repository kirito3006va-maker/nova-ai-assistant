$os = Get-CimInstance Win32_OperatingSystem
$bat = Get-CimInstance Win32_Battery
$cpu = Get-CimInstance Win32_Processor
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [PSCustomObject]@{
        id = $_.DeviceID
        freeGB = [math]::Round($_.FreeSpace/1GB, 1)
        totalGB = [math]::Round($_.Size/1GB, 1)
    }
})
$top = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object {
    [PSCustomObject]@{
        name = $_.ProcessName
        memMB = [math]::Round($_.WorkingSet64/1MB, 0)
    }
})
$ramUsed = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB, 1)
$ramTotal = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)

$res = [PSCustomObject]@{
    cpuLoad = [int]$cpu.LoadPercentage
    ramUsedGB = $ramUsed
    ramTotalGB = $ramTotal
    batteryPercent = if ($bat) { [int]$bat.EstimatedChargeRemaining } else { 100 }
    batteryStatus = if ($bat) { [int]$bat.BatteryStatus } else { 2 }
    disks = $disks
    topProcesses = $top
}

$res | ConvertTo-Json -Compress -Depth 4
