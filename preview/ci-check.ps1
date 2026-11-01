# Checks the File Explorer preview handler on Windows (run by CI).
#   -Dll <path>   preview a test document with the built handler, the way Explorer would
#   -Installed    also check the installer's registration and COM activation
#   -Uninstalled  check the uninstaller removed the registration
param([string]$Dll, [switch]$Installed, [switch]$Uninstalled)
$ErrorActionPreference = 'Stop'
$clsid = '{24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}'
$iid = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'

if ($Uninstalled) {
  if (Test-Path "HKCU:\Software\Classes\CLSID\$clsid") { throw 'The uninstaller left the preview handler registered.' }
  $link = Get-ItemProperty -Path "HKCU:\Software\Classes\.md\shellex\$iid" -ErrorAction SilentlyContinue
  if ($link -and $link.'(default)' -eq $clsid) { throw 'The uninstaller left .md linked to the preview handler.' }
  Write-Host 'ok - uninstall removed the preview handler'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
$md = Join-Path $env:TEMP 'nmr-preview-test.md'
$text = @'
---
title: Quarterly Report
author: Neo Gentrics
---
# Summary

Revenue **grew** this quarter.

<script>document.title = 'pwned'</script>

![Company logo](https://tracker.example/pixel.png)

- [x] Shipped 2.1
'@
[IO.File]::WriteAllText($md, $text, (New-Object Text.UTF8Encoding($true)))

if ($Installed) {
  $link = (Get-ItemProperty -Path "HKCU:\Software\Classes\.md\shellex\$iid").'(default)'
  if ($link -ne $clsid) { throw ".md is not linked to the preview handler (found '$link')." }
  $server = Get-ItemProperty -Path "HKCU:\Software\Classes\CLSID\$clsid\InprocServer32"
  if ($server.'(default)' -ne 'mscoree.dll') { throw 'InprocServer32 should be mscoree.dll.' }
  $Dll = ([uri]$server.CodeBase).LocalPath
  if (-not (Test-Path $Dll)) { throw "Registered handler file is missing: $Dll" }
  Write-Host "ok - registered for .md, CodeBase $Dll"
  $obj = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([guid]$clsid))
  if ($obj.GetType().FullName -ne 'Neo.MarkdownPreview.PreviewHandler') { throw "COM created $($obj.GetType().FullName)" }
  Write-Host 'ok - COM creates the preview handler from its registration'
}

[void][Reflection.Assembly]::LoadFrom((Resolve-Path $Dll))
$shown = [Neo.MarkdownPreview.SelfTest]::Run($md, 30000)
Write-Host "Preview shows:`n$shown"
if ($shown -notmatch 'Quarterly Report') { throw 'The front-matter title is missing.' }
if ($shown -notmatch 'Revenue grew this quarter') { throw 'The document text is missing.' }
if ($shown -notmatch '\[Image: Company logo\]') { throw 'Images should be shown as their description, not loaded.' }
if ($shown -match '\]Company logo') { throw 'The image description is shown twice.' }
if ($shown -notmatch "<script>document\.title") { throw 'Raw HTML should be shown as text.' }
Write-Host 'ok - the preview renders the document safely'
