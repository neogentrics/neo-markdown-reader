# Builds the native COM server for the File Explorer preview (Windows, x64) with the Visual C++
# compiler. Needs Visual Studio or the Build Tools with "Desktop development with C++".
param([string]$Out = 'preview-dist')
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Visual Studio (or its Build Tools) with C++ is needed to build the preview add-on.' }
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio was found, but without the C++ tools ("Desktop development with C++").' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
New-Item -ItemType Directory -Force $Out | Out-Null
$outDir = (Resolve-Path $Out).Path
$src = $PSScriptRoot
$obj = Join-Path $env:TEMP 'nmr-shim-obj'
New-Item -ItemType Directory -Force $obj | Out-Null
# Static C runtime (/MT), so nothing extra needs installing; control-flow guard on.
$cl = "cl /nologo /W4 /WX /O2 /MT /EHsc /guard:cf /DUNICODE /D_UNICODE /Fo`"$obj\\`" " +
      "`"$src\NeoMarkdownPreviewShim.cpp`" /LD /Fe`"$outDir\NeoMarkdownPreviewShim.dll`" " +
      "/link /DEF:`"$src\NeoMarkdownPreviewShim.def`" /GUARD:CF /DYNAMICBASE /NXCOMPAT /MACHINE:X64"
cmd /c "`"$vcvars`" >nul && $cl"
if ($LASTEXITCODE) { throw "Building the preview add-on failed ($LASTEXITCODE)." }
Remove-Item (Join-Path $outDir 'NeoMarkdownPreviewShim.exp'), (Join-Path $outDir 'NeoMarkdownPreviewShim.lib') -ErrorAction SilentlyContinue
Write-Host "Built $outDir\NeoMarkdownPreviewShim.dll"
