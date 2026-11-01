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

# Register for the current user, mirroring build/installer.nsh.
$dllPath = (Resolve-Path $Dll).Path
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
