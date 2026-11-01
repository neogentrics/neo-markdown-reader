# Diagnoses how Windows activates the preview handler (run by CI). Writes several variants of the
# per-user registration and, for each, tries to create the handler in a fresh process: elevated and
# de-elevated (Explorer is never elevated), in-process and through the preview host (prevhost.exe).
param([string]$Dll, [string]$Out, [switch]$Child)
$ErrorActionPreference = 'Stop'
$clsid = '{24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}'

if ($Child) {
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
    return qi == 0 ? "OK" : "no IPreviewHandler 0x" + qi.ToString("X8");
  }
}
'@
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $elevated = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $who = if ($elevated) { 'elevated   ' } else { 'de-elevated' }
  "$who in-process: $([NmrComTest]::Try($clsid, 1)); preview host: $([NmrComTest]::Try($clsid, 4))" | Set-Content -Path $Out -Encoding UTF8
  exit 0
}

$dllPath = (Resolve-Path $Dll).Path
$codebase = 'file:///' + ($dllPath -replace '\\', '/')
$asm = 'NeoMarkdownPreview, Version=2.1.0.0, Culture=neutral, PublicKeyToken=null'
$class = 'Neo.MarkdownPreview.PreviewHandler'
$key = "HKCU:\Software\Classes\CLSID\$clsid"
$self = $PSCommandPath

function Register([hashtable]$o) {
  Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -Path "$key\InprocServer32\2.1.0.0" -Force | Out-Null
  New-Item -Path "$key\Implemented Categories\{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}" -Force | Out-Null
  Set-ItemProperty $key '(default)' $(if ($o.RootDefault) { $o.RootDefault } else { 'Neo Markdown Reader preview' })
  if ($o.AppId) {
    Set-ItemProperty $key 'AppID' '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}'
    New-ItemProperty $key -Name 'DisableLowILProcessIsolation' -Value 1 -PropertyType DWord -Force | Out-Null
  }
  if ($o.ProgId) { New-Item -Path "$key\ProgId" -Force | Out-Null; Set-ItemProperty "$key\ProgId" '(default)' 'NeoMarkdownReader.Preview' }
  Set-ItemProperty "$key\InprocServer32" '(default)' 'mscoree.dll'
  Set-ItemProperty "$key\InprocServer32" 'ThreadingModel' $o.Threading
  foreach ($k in @("$key\InprocServer32", "$key\InprocServer32\2.1.0.0")) {
    Set-ItemProperty $k 'Class' $class
    Set-ItemProperty $k 'Assembly' $asm
    Set-ItemProperty $k 'RuntimeVersion' 'v4.0.30319'
    Set-ItemProperty $k 'CodeBase' $codebase
  }
}

function Probe([string]$name) {
  Write-Host "--- $name"
  $f1 = Join-Path $env:TEMP 'nmr-diag-elev.txt'; $f2 = Join-Path $env:TEMP 'nmr-diag-user.txt'
  Remove-Item $f1, $f2 -ErrorAction SilentlyContinue
  Start-Process -Wait -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', "`"$self`"", '-Child', '-Out', "`"$f1`""
  & runas.exe /trustlevel:0x20000 "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File `"$self`" -Child -Out `"$f2`"" | Out-Null
  for ($i = 0; $i -lt 60 -and -not (Test-Path $f2); $i++) { Start-Sleep -Milliseconds 500 }
  foreach ($f in @($f1, $f2)) { if (Test-Path $f) { Write-Host "    $(Get-Content $f)" } else { Write-Host '    (no result)' } }
}

Write-Host "Assembly: $([Reflection.AssemblyName]::GetAssemblyName($dllPath).FullName)"
Register @{ Threading = 'Apartment'; AppId = $true };                                  Probe 'A. as the installer writes it'
Register @{ Threading = 'Apartment' };                                                 Probe 'B. without the preview-host AppID'
Register @{ Threading = 'Both'; AppId = $true };                                       Probe 'C. ThreadingModel Both'
Register @{ Threading = 'Apartment'; AppId = $true; ProgId = $true };                  Probe 'D. with a ProgId'
Register @{ Threading = 'Apartment'; AppId = $true; RootDefault = $class };            Probe 'E. class name as the key default'
Register @{ Threading = 'Both'; ProgId = $true; RootDefault = $class };                Probe 'F. exactly like regasm, per user'
Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue

$regasm = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'RegAsm.exe'
& $regasm /nologo /codebase $dllPath 2>&1 | Out-Null
Probe 'G. regasm /codebase, machine-wide'
& $regasm /nologo /unregister $dllPath 2>&1 | Out-Null
