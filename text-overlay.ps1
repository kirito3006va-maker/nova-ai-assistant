param(
    [string]$imagePath,
    [string]$text,
    [string]$outPath
)

Add-Type -AssemblyName System.Drawing

$imgBytes = [System.IO.File]::ReadAllBytes($imagePath)
$ms = New-Object System.IO.MemoryStream(,$imgBytes)
$bmp = [System.Drawing.Bitmap]::FromStream($ms)

$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$fontSize = [float]56
$font = New-Object System.Drawing.Font("Impact", $fontSize, [System.Drawing.FontStyle]::Regular)
$textSize = $g.MeasureString($text, $font)

$x = [float](($bmp.Width - $textSize.Width) / 2)
$y = [float]($bmp.Height - $textSize.Height - 60)

$padX = [float]24
$padY = [float]14
$rx = [float]($x - $padX)
$ry = [float]($y - $padY)
$rw = [float]($textSize.Width + ($padX * 2))
$rh = [float]($textSize.Height + ($padY * 2))

# Fondo oscuro elegante translúcido
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 10, 10, 18))
$g.FillRectangle($bgBrush, $rx, $ry, $rw, $rh)

# Borde Neón Cyan
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 240, 255), [float]3)
$g.DrawRectangle($borderPen, $rx, $ry, $rw, $rh)

# Sombra
$shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 0, 0, 0))
$g.DrawString($text, $font, $shadowBrush, [float]($x + 3), [float]($y + 3))

# Texto Principal Neón Cyan
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 255, 235))
$g.DrawString($text, $font, $textBrush, [float]$x, [float]$y)

$g.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
$ms.Dispose()

Write-Output "OVERLAY_OK"
