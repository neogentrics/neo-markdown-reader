# CI: update from the last version with the old name, for an install for one person and for everyone.
# The new version must land in the same folder, replace the old program, keep the settings, and use the
# old settings folder when it runs. Never run this on a computer you use: it installs and removes the app.
param(
  [Parameter(Mandatory)] [string] $OldSetup,
  [Parameter(Mandatory)] [string] $NewSetup
)
$ErrorActionPreference = 'Stop'
$keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'

function Get-Entries { Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName -like '*Markdown Reader*' }

function Get-OneEntry {
  $entries = @(Get-Entries)
  if ($entries.Count -ne 1) { throw "Expected one entry in Add/Remove Programs, found: $($entries.DisplayName -join ', ')" }
  $entries[0]
}

function Get-InstallFolder($entry) {
  if ($entry.UninstallString -notmatch '^"([^"]+)"') { throw "Can't read: $($entry.UninstallString)" }
  Split-Path $Matches[1]
}

function Get-Links {
  $folders = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
  @(Get-ChildItem $folders -Recurse -Filter '*Markdown Reader*.lnk' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
}

foreach ($mode in 'one person', 'everyone') {
  Write-Host "--- install for $mode"
  $flags = if ($mode -eq 'everyone') { '/S', '/allusers' } else { , '/S' }
  Start-Process -Wait -FilePath $OldSetup -ArgumentList $flags

  $entry = Get-OneEntry
  $dir = Get-InstallFolder $entry
  Write-Host "Installed: $($entry.DisplayName) in $dir"
  if (-not (Test-Path (Join-Path $dir 'Neo Markdown Reader.exe'))) { throw 'The old version did not install.' }

  $data = Join-Path $env:APPDATA 'Neo Markdown Reader'
  $newData = Join-Path $env:APPDATA 'RT Markdown Reader'
  New-Item -ItemType Directory -Force $data | Out-Null
  Set-Content (Join-Path $data 'settings.json') '{"theme":"sepia","tutorial":"done"}'

  # The same arguments the app gives the installer on Restart to update, apart from reopening it.
  Start-Process -Wait -FilePath $NewSetup -ArgumentList '--updated', '/S'

  $entry = Get-OneEntry
  Write-Host "Updated: $($entry.DisplayName), publisher $($entry.Publisher)"
  if ($entry.DisplayName -notlike 'RT Markdown Reader*') { throw "Add/Remove Programs shows: $($entry.DisplayName)" }
  if ((Get-InstallFolder $entry) -ne $dir) { throw "It moved to $(Get-InstallFolder $entry)" }
  $exe = Join-Path $dir 'RT Markdown Reader.exe'
  if (-not (Test-Path $exe)) { throw 'The new program is not in the same folder.' }
  if (Test-Path (Join-Path $dir 'Neo Markdown Reader.exe')) { throw 'The old program was left behind.' }
  $links = Get-Links
  Write-Host "Start menu: $($links -join ', ')"
  if ($links -notcontains 'RT Markdown Reader.lnk' -or $links -contains 'Neo Markdown Reader.lnk') { throw 'The Start menu shortcut is wrong.' }

  $app = Start-Process -PassThru -FilePath $exe
  Start-Sleep -Seconds 12
  if ($app.HasExited) { throw "The updated app quit by itself (exit code $($app.ExitCode))." }
  Get-Process -Name 'RT Markdown Reader' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  if ((Get-Content (Join-Path $data 'settings.json') -Raw) -notmatch 'sepia') { throw 'Settings were lost.' }
  if (Test-Path (Join-Path $newData 'settings.json')) { throw 'The updated app started a new settings folder.' }

  $args = @('/S', "_?=$dir")
  if ($entry.UninstallString -match '/allusers') { $args = @('/allusers') + $args }
  if ($entry.UninstallString -notmatch '^"([^"]+)"') { throw 'No uninstaller.' }
  Start-Process -Wait -FilePath $Matches[1] -ArgumentList $args
  if (@(Get-Entries).Count) { throw 'It did not uninstall.' }
  Remove-Item $data, $newData -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'Updating from the old name works.'
