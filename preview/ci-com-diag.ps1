# Diagnoses how Windows activates the preview handler (run by CI). Registers the built handler
# for the current user exactly as build/installer.nsh does, then tries to create it:
#   - in-process and through the preview host (prevhost.exe), the way Explorer does,
#   - from this (elevated) process and from a de-elevated one (Explorer is never elevated).
param([string]$Dll, [string]$Out, [switch]$Child)
$ErrorActionPreference = 'Stop'
$clsid = '{24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}'

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NmrComTest {
  [DllImport("ole32.dll")] static extern int CoCreateInstance(ref Guid clsid, IntPtr outer, uint ctx, ref Guid iid, out IntPtr ppv);
  public static string Try(string clsid, uint ctx) {
    Guid c = new Guid(clsid); Guid unk = new Guid("00000000-0000-0000-C000-000000000046");
    IntPtr p; int hr = CoCreateInstance(ref c, IntPtr.Zero, ctx, ref unk, out p);
    if (hr != 0) return "FAILED 0x" + hr.ToString("X8");
    Guid iph = new Guid("8895b1c6-b41f-4c1c-a562-0d564250836f"); IntPtr q;
    int qi = Marshal.QueryInterface(p, ref iph, out q);
    if (qi == 0) Marshal.Release(q);
    Marshal.Release(p);
    return qi == 0 ? "OK (IPreviewHandler available)" : "CREATED, but no IPreviewHandler: 0x" + qi.ToString("X8");
  }
}
'@

function Report {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $elevated = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $lines = @("elevated=$elevated")
  $lines += "in-process (CLSCTX_INPROC_SERVER): " + [NmrComTest]::Try($clsid, 1)
  $lines += "preview host (CLSCTX_LOCAL_SERVER): " + [NmrComTest]::Try($clsid, 4)
  return $lines
}

if ($Child) { Report | Set-Content -Path $Out -Encoding UTF8; exit 0 }

# Log every assembly bind the CLR makes, so a failure names the file it could not find.
$fusion = Join-Path $env:TEMP 'nmr-fusion'
Remove-Item $fusion -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $fusion | Out-Null
$fk = 'HKLM:\SOFTWARE\Microsoft\Fusion'
New-ItemProperty $fk -Name EnableLog -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty $fk -Name ForceLog -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty $fk -Name LogFailures -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty $fk -Name LogPath -Value ($fusion + '\') -PropertyType String -Force | Out-Null

# Register for the current user, mirroring build/installer.nsh.
$dllPath = (Resolve-Path $Dll).Path
Write-Host "Assembly: $([Reflection.AssemblyName]::GetAssemblyName($dllPath).FullName)"
Write-Host "Files beside it: $((Get-ChildItem (Split-Path $dllPath) -Filter *.dll | ForEach-Object Name) -join ', ')"
$codebase = 'file:///' + ($dllPath -replace '\\', '/')
$asm = 'NeoMarkdownPreview, Version=2.1.0.0, Culture=neutral, PublicKeyToken=null'
$key = "HKCU:\Software\Classes\CLSID\$clsid"
New-Item -Path "$key\InprocServer32\2.1.0.0" -Force | Out-Null
Set-ItemProperty $key '(default)' 'Neo Markdown Reader preview'
Set-ItemProperty $key 'DisplayName' 'Neo Markdown Reader preview'
Set-ItemProperty $key 'AppID' '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}'
New-ItemProperty $key -Name 'DisableLowILProcessIsolation' -Value 1 -PropertyType DWord -Force | Out-Null
foreach ($k in @("$key\InprocServer32", "$key\InprocServer32\2.1.0.0")) {
  if ($k -eq "$key\InprocServer32") { Set-ItemProperty $k '(default)' 'mscoree.dll'; Set-ItemProperty $k 'ThreadingModel' 'Apartment' }
  Set-ItemProperty $k 'Class' 'Neo.MarkdownPreview.PreviewHandler'
  Set-ItemProperty $k 'Assembly' $asm
  Set-ItemProperty $k 'RuntimeVersion' 'v4.0.30319'
  Set-ItemProperty $k 'CodeBase' $codebase
}
Write-Host "Registered $codebase"
Write-Host "UAC EnableLUA = $((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA)"

Write-Host '--- this process'
Report | ForEach-Object { Write-Host $_ }

Write-Host '--- de-elevated process (like Explorer)'
$outFile = Join-Path $env:TEMP 'nmr-com-diag.txt'
Remove-Item $outFile -ErrorAction SilentlyContinue
$self = $PSCommandPath
& runas.exe /trustlevel:0x20000 "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$self`" -Child -Out `"$outFile`""
for ($i = 0; $i -lt 60 -and -not (Test-Path $outFile); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path $outFile) { Get-Content $outFile | ForEach-Object { Write-Host $_ } } else { Write-Host 'de-elevated run produced no output' }

Write-Host '--- the registration as COM sees it (HKEY_CLASSES_ROOT)'
$ErrorActionPreference = 'Continue'
@(Get-Item "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid") + @(Get-ChildItem "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid" -Recurse) | ForEach-Object {
  $k = $_; $k.Property | ForEach-Object { Write-Host "    [$($k.PSChildName)] $_ = $($k.GetValue($_))" }
}

Write-Host '--- assembly binding log (Fusion)'
Get-ChildItem $fusion -Recurse -Filter *.htm | ForEach-Object {
  $t = (Get-Content $_.FullName -Raw) -replace '<[^>]+>', ''
  if ($t -match 'NeoMarkdownPreview|Markdig') { Write-Host "== $($_.FullName)"; Write-Host $t }
}

Write-Host '--- what regasm /codebase would register'
$regasm = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'RegAsm.exe'
$regFile = Join-Path $env:TEMP 'nmr-regasm.reg'
& $regasm /nologo /codebase $dllPath /regfile:$regFile | Out-Null
if (Test-Path $regFile) { Get-Content $regFile | Select-String -Pattern ([regex]::Escape($clsid.Trim('{}'))) -Context 0,12 | ForEach-Object { Write-Host $_ } }

Write-Host '--- registered machine-wide by regasm /codebase instead'
Remove-Item "HKCU:\Software\Classes\CLSID\$clsid" -Recurse -Force
& $regasm /nologo /codebase $dllPath | ForEach-Object { Write-Host $_ }
Report | ForEach-Object { Write-Host $_ }
& $regasm /nologo /unregister $dllPath | Out-Null

Write-Host '--- assembly binding log after the machine-wide attempt'
Get-ChildItem $fusion -Recurse -Filter *.htm | Sort-Object LastWriteTime | Select-Object -Last 4 | ForEach-Object {
  $t = (Get-Content $_.FullName -Raw) -replace '<[^>]+>', ''
  Write-Host "== $($_.FullName)"; Write-Host $t
}
Remove-ItemProperty $fk -Name EnableLog, ForceLog, LogFailures, LogPath -ErrorAction SilentlyContinue
