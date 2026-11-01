# Temporary helper for the README screenshot: registers the built preview handler for this user
# (as the installer does), opens a folder of Markdown files in File Explorer with the Preview pane
# on, selects one, and captures the screen.
param([string]$Dll, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$clsid = '{24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}'
$iid = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'
$shim = (Resolve-Path $Dll).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

$key = "HKCU:\Software\Classes\CLSID\$clsid"
New-Item -Path "$key\InprocServer32" -Force | Out-Null
Set-ItemProperty $key '(default)' 'Neo Markdown Reader preview'
Set-ItemProperty $key 'DisplayName' 'Neo Markdown Reader preview'
Set-ItemProperty $key 'AppID' '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}'
New-ItemProperty $key -Name 'DisableLowILProcessIsolation' -Value 1 -PropertyType DWord -Force | Out-Null
Set-ItemProperty "$key\InprocServer32" '(default)' $shim
Set-ItemProperty "$key\InprocServer32" 'ThreadingModel' 'Apartment'
New-Item -Path "HKCU:\Software\Classes\.md\shellex\$iid" -Force | Out-Null
Set-ItemProperty "HKCU:\Software\Classes\.md\shellex\$iid" '(default)' $clsid
New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -Force | Out-Null
New-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -Name $clsid -Value 'Neo Markdown Reader' -PropertyType String -Force | Out-Null
# Explorer: show file extensions, and the Preview pane.
$adv = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
New-ItemProperty $adv -Name HideFileExt -Value 0 -PropertyType DWord -Force | Out-Null

$dir = 'C:\Users\Public\Documents\Project notes'
New-Item -ItemType Directory -Force $dir | Out-Null
$doc = @'
---
title: Website relaunch plan
subtitle: Goals, schedule and open questions
author: Neo Gentrics
date: 2026-11-01
---
# Goals

Relaunch the website with **faster pages**, a clearer structure and a *new look*.

> [!TIP]
> Draft pages live in the `staging` folder until they are approved.

## Schedule

| Phase | Owner | Finish |
|---|---|---|
| Content audit | Maria | Nov 14 |
| New design | Jonas | Dec 5 |
| Launch | Team | Jan 9 |

## Checklist

- [x] Collect analytics
- [x] Agree on the sitemap
- [ ] Write the new home page
- [ ] Test on phones

## Notes

```js
const pages = sitemap.filter((p) => p.ready);
```
'@
[IO.File]::WriteAllText("$dir\Website relaunch plan.md", $doc, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText("$dir\Meeting notes - October.md", "# Meeting notes`n`n- Budget approved`n", (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText("$dir\README.md", "# Project notes`n`nPlans and minutes.`n", (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText("$dir\Ideas.md", "# Ideas`n`n- Dark mode`n", (New-Object Text.UTF8Encoding($false)))

$shell = New-Object -ComObject WScript.Shell
function Capture([string]$name) {
  $b = [Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $Out "$name.png"), [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "captured $name ($($b.Width)x$($b.Height))"
}

Start-Process explorer.exe -ArgumentList "/select,`"$dir\Website relaunch plan.md`""
Start-Sleep -Seconds 6
$null = $shell.AppActivate('Project notes')
Start-Sleep -Seconds 1
$shell.SendKeys('% ')        # window menu
Start-Sleep -Milliseconds 400
$shell.SendKeys('x')         # maximize
Start-Sleep -Seconds 2
Capture 'explorer-1-opened'
$shell.SendKeys('%p')        # Alt+P: Preview pane
Start-Sleep -Seconds 8
Capture 'explorer-2-preview'
$shell.SendKeys('%p')
Start-Sleep -Seconds 4
Capture 'explorer-3-toggled'
$shell.SendKeys('%p')
Start-Sleep -Seconds 8
Capture 'explorer-4-preview-again'
Get-Process prevhost -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "prevhost running: pid $($_.Id)" }
