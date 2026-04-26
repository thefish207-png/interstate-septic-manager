$appDir = "C:\Users\thefi\Desktop\interstate-septic-manager"
$iconPath = "$appDir\assets\icon.ico"
$shortcutPath = "C:\Users\thefi\Desktop\ISM DEV.lnk"

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = '"' + $appDir + '\launch.vbs"'
$Shortcut.WorkingDirectory = $appDir
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Interstate Septic Manager (DEV - runs from source via npm start)"
$Shortcut.IconLocation = $iconPath
$Shortcut.Save()

Write-Host "Created: $shortcutPath"
