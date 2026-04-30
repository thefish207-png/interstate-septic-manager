# Generates a unique icon and a desktop shortcut for the Interstate Septic
# Manager *History* build. The icon is drawn programmatically with a
# purple→teal gradient, a clipboard silhouette, and a clock face — visually
# distinct from the standard ISM icon so you can tell builds apart at a glance.

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$appDir       = "C:\Users\thefi\Desktop\interstate-septic-manager"
$iconPath     = "$appDir\assets\summit-history-icon.ico"
$shortcutPath = "C:\Users\thefi\Desktop\Summit History.lnk"
$oldShortcut  = "C:\Users\thefi\Desktop\ISM History.lnk"
$oldIcon      = "$appDir\assets\history-icon.ico"

# ---------- Draw the icon ----------
$size = 256
$bmp  = New-Object System.Drawing.Bitmap($size, $size)
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Rounded-rect background (purple → teal diagonal gradient)
function New-RoundedPath($x, $y, $w, $h, $r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $y, ($r*2), ($r*2), 180, 90)
  $path.AddArc(($x + $w - $r*2), $y, ($r*2), ($r*2), 270, 90)
  $path.AddArc(($x + $w - $r*2), ($y + $h - $r*2), ($r*2), ($r*2), 0, 90)
  $path.AddArc($x, ($y + $h - $r*2), ($r*2), ($r*2), 90, 90)
  $path.CloseFigure()
  return $path
}

$bgPath = New-RoundedPath 8 8 240 240 36
$rect   = New-Object System.Drawing.Rectangle(8, 8, 240, 240)
$bg     = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 142, 36, 170),  # deep purple
  [System.Drawing.Color]::FromArgb(255, 0,   150, 136), # teal
  [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillPath($bg, $bgPath)

# Subtle highlight on top edge
$highlight = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(64, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0,  255, 255, 255),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillPath($highlight, $bgPath)

# Clipboard body
$clipPath = New-RoundedPath 70 78 116 142 12
$g.FillPath([System.Drawing.Brushes]::White, $clipPath)

# Clipboard top clip
$clipTop = New-RoundedPath 100 60 56 30 8
$g.FillPath((New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(255, 60, 60, 70))), $clipTop)

# Clipboard ruled lines (history rows)
$line = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(255, 200, 200, 210), 4)
for ($i = 0; $i -lt 4; $i++) {
  $y = 110 + ($i * 22)
  $g.DrawLine($line, 86, $y, 170, $y)
}

# Clock face overlay (history motif)
$clockX = 156; $clockY = 156; $clockR = 52
$clockBrush = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(255, 255, 152, 0))  # orange
$g.FillEllipse($clockBrush, ($clockX - $clockR/2), ($clockY - $clockR/2), $clockR, $clockR)
$clockEdge = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(255, 255, 255, 255), 4)
$g.DrawEllipse($clockEdge, ($clockX - $clockR/2), ($clockY - $clockR/2), $clockR, $clockR)

# Clock hands
$handPen = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(255, 255, 255, 255), 4)
$handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$handPen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($handPen, $clockX, $clockY, $clockX, ($clockY - 16))   # minute hand (up)
$g.DrawLine($handPen, $clockX, $clockY, ($clockX + 12), $clockY)   # hour hand (right)
$g.FillEllipse([System.Drawing.Brushes]::White, ($clockX - 3), ($clockY - 3), 6, 6)

# ---------- Save PNG, wrap as PNG-in-ICO ----------
$tmpPng = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'ism_history_icon.png')
$bmp.Save($tmpPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

$pngBytes = [System.IO.File]::ReadAllBytes($tmpPng)
$pngLen   = $pngBytes.Length

# ICO file = 6-byte ICONDIR + 16-byte ICONDIRENTRY + raw PNG data
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0)        # reserved
$bw.Write([UInt16]1)        # type = icon
$bw.Write([UInt16]1)        # image count
# ICONDIRENTRY
$bw.Write([Byte]0)          # width  (0 = 256)
$bw.Write([Byte]0)          # height (0 = 256)
$bw.Write([Byte]0)          # color count
$bw.Write([Byte]0)          # reserved
$bw.Write([UInt16]1)        # color planes
$bw.Write([UInt16]32)       # bits per pixel
$bw.Write([UInt32]$pngLen)  # image size
$bw.Write([UInt32]22)       # offset (6 + 16)
$bw.Write($pngBytes)
[System.IO.File]::WriteAllBytes($iconPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
Remove-Item $tmpPng -Force

Write-Host "Icon written: $iconPath"

# ---------- Create the desktop shortcut ----------
$WScriptShell        = New-Object -ComObject WScript.Shell
$Shortcut            = $WScriptShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments  = '"' + $appDir + '\launch.vbs"'
$Shortcut.WorkingDirectory = $appDir
$Shortcut.WindowStyle      = 1
$Shortcut.Description      = "Summit History - Interstate Septic Manager"
$Shortcut.IconLocation     = $iconPath
$Shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"

# Clean up the previous "ISM History" shortcut/icon if they exist
if (Test-Path $oldShortcut) { Remove-Item $oldShortcut -Force; Write-Host "Removed old shortcut: $oldShortcut" }
if (Test-Path $oldIcon)     { Remove-Item $oldIcon -Force;     Write-Host "Removed old icon: $oldIcon" }
