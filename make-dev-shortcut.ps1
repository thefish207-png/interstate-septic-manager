$appDir = "C:\Users\thefi\Desktop\interstate-septic-manager"
$iconPath = "$appDir\assets\icon.ico"
$shortcutPath = "C:\Users\thefi\Desktop\ISM (NEW).lnk"

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = '"' + $appDir + '\launch.vbs"'
$Shortcut.WorkingDirectory = $appDir
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Interstate Septic Manager (Dev with Cloud Auth)"
$Shortcut.IconLocation = $iconPath
$Shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"
