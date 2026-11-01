# Checks the File Explorer preview handler on Windows (run by CI).
#   -Dll <path>             preview a test document with the built handler (NeoMarkdownPreview.dll)
#   -Dll <path> -Register   also register it for the current user (like the installer), check that
#                           Windows can start it the way Explorer does, then remove the registration
#   -Installed              check the installer's registration, then the same as above
#   -Uninstalled            check the uninstaller removed the registration
param([string]$Dll, [switch]$Register, [switch]$Installed, [switch]$Uninstalled, [switch]$Child, [string]$Out)
$ErrorActionPreference = 'Stop'
$clsid = '{24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}'
$iid = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'
$key = "HKCU:\Software\Classes\CLSID\$clsid"

if ($Uninstalled) {
  if (Test-Path $key) { throw 'The uninstaller left the preview handler registered.' }
  $link = Get-ItemProperty -Path "HKCU:\Software\Classes\.md\shellex\$iid" -ErrorAction SilentlyContinue
  if ($link -and $link.'(default)' -eq $clsid) { throw 'The uninstaller left .md linked to the preview handler.' }
  Write-Host 'ok - uninstall removed the preview handler'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
using System.Text; using System.Windows.Forms;
// Plays Explorer's part: creates the handler through COM, gives it a document and a window, and
// waits for the page to appear in that window.
public static class NmrExplorer {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [ComImport, Guid("8895b1c6-b41f-4c1c-a562-0d564250836f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPreviewHandler { void SetWindow(IntPtr hwnd, ref RECT rect); void SetRect(ref RECT rect); void DoPreview(); void Unload();
    void SetFocus(); void QueryFocus(out IntPtr phwnd); [PreserveSig] uint TranslateAccelerator(IntPtr pmsg); }
  [ComImport, Guid("b824b49d-22ac-4161-ac8a-9916e8fa3f7f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IInitializeWithStream { void Initialize(IStream pstream, uint grfMode); }
  [DllImport("ole32.dll")] static extern int CoCreateInstance(ref Guid clsid, IntPtr outer, uint ctx, ref Guid iid, out IntPtr ppv);
  [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern IStream SHCreateStreamOnFileEx(string file, uint mode, uint attributes, bool create, IStream template);
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  static readonly Guid Unknown = new Guid("00000000-0000-0000-C000-000000000046");
  static readonly Guid PreviewIid = new Guid("8895b1c6-b41f-4c1c-a562-0d564250836f");

  // Creates the handler and asks it for IPreviewHandler (CLSCTX_INPROC_SERVER = 1).
  public static string Create(string clsid, uint ctx) {
    Guid c = new Guid(clsid), unk = Unknown, iph = PreviewIid;
    IntPtr p; int hr = CoCreateInstance(ref c, IntPtr.Zero, ctx, ref unk, out p);
    if (hr != 0) return "creating it failed: 0x" + hr.ToString("X8");
    IntPtr q; int qi = Marshal.QueryInterface(p, ref iph, out q);
    if (qi == 0) Marshal.Release(q);
    Marshal.Release(p);
    return qi == 0 ? "OK" : "it has no IPreviewHandler: 0x" + qi.ToString("X8");
  }

  // The whole Explorer flow through the preview host (CLSCTX_LOCAL_SERVER = 4).
  public static string Preview(string clsid, string file, int timeoutMs) {
    Guid c = new Guid(clsid), unk = Unknown;
    IntPtr p; int hr = CoCreateInstance(ref c, IntPtr.Zero, 4, ref unk, out p);
    if (hr != 0) return "creating it in the preview host failed: 0x" + hr.ToString("X8");
    object handler = Marshal.GetObjectForIUnknown(p); Marshal.Release(p);
    var form = new Form { Width = 800, Height = 600, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Left = 0, Top = 0 };
    form.Show();
    try {
      ((IInitializeWithStream)handler).Initialize(SHCreateStreamOnFileEx(file, 0x40, 0, false, null), 0);
      var preview = (IPreviewHandler)handler;
      var rect = new RECT { Right = form.ClientSize.Width, Bottom = form.ClientSize.Height };
      preview.SetWindow(form.Handle, ref rect);
      preview.DoPreview();
      string drawnBy = null;
      EnumProc find = (h, l) => {
        var name = new StringBuilder(256); GetClassName(h, name, 256);
        if (name.ToString() != "Internet Explorer_Server") return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        drawnBy = Process.GetProcessById((int)pid).ProcessName + ".exe";
        return false;
      };
      for (DateTime until = DateTime.UtcNow.AddMilliseconds(timeoutMs); drawnBy == null && DateTime.UtcNow < until; ) {
        Application.DoEvents();
        EnumChildWindows(form.Handle, find, IntPtr.Zero);
        System.Threading.Thread.Sleep(50);
      }
      preview.Unload();
      return drawnBy != null ? "OK, the page is shown in the window, drawn by " + drawnBy : "no page appeared in the window";
    } catch (Exception e) {
      return e.GetType().Name + ": " + e.Message;
    } finally {
      form.Close();
      Marshal.ReleaseComObject(handler);
    }
  }
}
'@

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

if ($Child) {
  [NmrExplorer]::Preview($clsid, $md, 30000) | Set-Content -Path $Out -Encoding UTF8
  exit 0
}

function Test-Activation {
  $inproc = [NmrExplorer]::Create($clsid, 1)
  if ($inproc -ne 'OK') { throw "Windows can't start the preview handler: $inproc" }
  Write-Host 'ok - Windows starts the preview handler from its registration'

  # Explorer is never elevated and runs handlers in the preview host (prevhost.exe): do the same.
  $result = Join-Path $env:TEMP 'nmr-preview-com.txt'
  Remove-Item $result -ErrorAction SilentlyContinue
  & runas.exe /trustlevel:0x20000 "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Child -Out `"$result`"" | Out-Null
  for ($i = 0; $i -lt 90 -and -not (Test-Path $result); $i++) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Milliseconds 300
  $outcome = if (Test-Path $result) { (Get-Content $result -Raw).Trim() } else { 'the check produced no result' }
  if ($outcome -notlike 'OK*') { throw "Previewing like Explorer does failed: $outcome" }
  Write-Host "ok - previewing like Explorer does (not elevated, in the preview host): $outcome"
}

$registered = $false
try {
  if ($Installed) {
    $link = (Get-ItemProperty -Path "HKCU:\Software\Classes\.md\shellex\$iid").'(default)'
    if ($link -ne $clsid) { throw ".md is not linked to the preview handler (found '$link')." }
    $server = (Get-ItemProperty -Path "$key\InprocServer32").'(default)'
    if ((Split-Path $server -Leaf) -ne 'NeoMarkdownPreviewShim.dll') { throw "Unexpected COM server: $server" }
    if (-not (Test-Path $server)) { throw "Registered COM server is missing: $server" }
    $Dll = Join-Path (Split-Path $server) 'NeoMarkdownPreview.dll'
    if (-not (Test-Path $Dll)) { throw "The handler is missing: $Dll" }
    Write-Host "ok - registered for .md: $server"
    Test-Activation
  } elseif ($Register) {
    $shim = Join-Path (Split-Path (Resolve-Path $Dll).Path) 'NeoMarkdownPreviewShim.dll'
    if (-not (Test-Path $shim)) { throw "Build the COM server first: $shim is missing." }
    if (Test-Path $key) { throw 'The preview handler is already registered on this computer; not touching it.' }
    $registered = $true
    # The same values build/installer.nsh writes.
    New-Item -Path "$key\InprocServer32" -Force | Out-Null
    Set-ItemProperty $key '(default)' 'Neo Markdown Reader preview'
    Set-ItemProperty $key 'DisplayName' 'Neo Markdown Reader preview'
    Set-ItemProperty $key 'AppID' '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}'
    New-ItemProperty $key -Name 'DisableLowILProcessIsolation' -Value 1 -PropertyType DWord -Force | Out-Null
    Set-ItemProperty "$key\InprocServer32" '(default)' $shim
    Set-ItemProperty "$key\InprocServer32" 'ThreadingModel' 'Apartment'
    Test-Activation
  }
} finally {
  if ($registered) { Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue }
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
