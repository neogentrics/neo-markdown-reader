// The File Explorer preview handler: Explorer (through prevhost.exe) creates this COM object, by way
// of the small native server in preview/shim (see NativeEntry below), hands it the selected .md file,
// and gives it a window to draw in. It shows the document rendered by PreviewRenderer in a browser
// control that can't navigate, run scripts or load anything remote.
using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Neo.MarkdownPreview
{
    [ComVisible(true)]
    [Guid(Clsid)]
    [ClassInterface(ClassInterfaceType.None)]
    [ProgId("NeoMarkdownReader.Preview")]
    public sealed class PreviewHandler : IPreviewHandler, IInitializeWithStream, IInitializeWithFile, IObjectWithSite, IOleWindow
    {
        public const string Clsid = "24f83a0a-a913-4d0d-aef4-c0b0fc7b1248";
        const int MaxBytes = 8 * 1024 * 1024;

        static PreviewHandler()
        {
            // The handler is loaded into prevhost.exe, whose folder is not ours: find Markdig next to this DLL.
            AppDomain.CurrentDomain.AssemblyResolve += (_, args) =>
            {
                string name = new AssemblyName(args.Name).Name;
                string dir = Path.GetDirectoryName(typeof(PreviewHandler).Assembly.Location) ?? "";
                string candidate = Path.Combine(dir, name + ".dll");
                return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
            };
        }

        string text;
        IntPtr parentWindow;
        RECT bounds;
        PreviewControl control;
        object site;
        IPreviewHandlerFrame frame;

        /// <summary>The text of the page currently shown (used by the self-test).</summary>
        public string ShownText { get { return control?.ShownText; } }

        // ---------------------------------------------------------------- initialisation
        public void Initialize(IStream stream, uint grfMode)
        {
            var buffer = new MemoryStream();
            var chunk = new byte[64 * 1024];
            IntPtr readPtr = Marshal.AllocCoTaskMem(sizeof(int));
            try
            {
                while (buffer.Length <= MaxBytes)
                {
                    stream.Read(chunk, chunk.Length, readPtr);
                    int read = Marshal.ReadInt32(readPtr);
                    if (read <= 0) break;
                    buffer.Write(chunk, 0, read);
                }
            }
            finally { Marshal.FreeCoTaskMem(readPtr); Marshal.ReleaseComObject(stream); }
            text = Decode(buffer.ToArray());
        }

        public void Initialize(string path, uint grfMode)
        {
            var info = new FileInfo(path);
            text = info.Length > MaxBytes ? new string('x', PreviewRenderer.MaxChars + 1) : Decode(File.ReadAllBytes(path));
        }

        static string Decode(byte[] bytes)
        {
            if (bytes.Length > MaxBytes) return new string('x', PreviewRenderer.MaxChars + 1);
            return new UTF8Encoding(false).GetString(bytes);
        }

        // ---------------------------------------------------------------- the preview window
        public void SetWindow(IntPtr hwnd, ref RECT rect)
        {
            parentWindow = hwnd;
            bounds = rect;
            if (control != null)
            {
                Native.SetParent(control.Handle, parentWindow);
                control.Bounds = bounds.ToRectangle();
            }
        }

        public void SetRect(ref RECT rect)
        {
            bounds = rect;
            if (control != null) control.Bounds = bounds.ToRectangle();
        }

        public void DoPreview()
        {
            NativeEntry.AdoptApartment();
            Unload();
            control = new PreviewControl();
            control.CreateControl();
            Native.SetParent(control.Handle, parentWindow);
            control.Bounds = bounds.ToRectangle();
            control.ShowPage(PreviewRenderer.RenderPage(text ?? "", WindowsUsesDarkApps()));
            control.Visible = true;
        }

        public void Unload()
        {
            if (control != null)
            {
                control.Visible = false;
                control.Dispose();
                control = null;
            }
        }

        public void SetFocus() { control?.Focus(); }

        public void QueryFocus(out IntPtr phwnd) { phwnd = Native.GetFocus(); }

        public uint TranslateAccelerator(ref MSG pmsg)
        {
            // Let Explorer handle its own shortcuts (Tab out of the pane, F5…). S_FALSE = not handled.
            return frame != null ? frame.TranslateAccelerator(ref pmsg) : 1u;
        }

        // ---------------------------------------------------------------- site & window
        public void SetSite(object pUnkSite)
        {
            site = pUnkSite;
            frame = pUnkSite as IPreviewHandlerFrame;
        }

        public void GetSite(ref Guid riid, out object ppvSite) { ppvSite = site; }

        public void GetWindow(out IntPtr phwnd) { phwnd = control != null ? control.Handle : IntPtr.Zero; }

        public void ContextSensitiveHelp(bool fEnterMode) { throw new NotImplementedException(); }

        /// <summary>Follow Windows' "Choose your app mode: Dark" setting.</summary>
        static bool WindowsUsesDarkApps()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object v = key?.GetValue("AppsUseLightTheme");
                    return v is int i && i == 0;
                }
            }
            catch { return false; }
        }
    }

    /// <summary>The browser control the page is shown in. It never navigates away from the page.</summary>
    internal sealed class PreviewControl : UserControl
    {
        readonly WebBrowser browser;
        bool loaded;

        public PreviewControl()
        {
            browser = new WebBrowser
            {
                Dock = DockStyle.Fill,
                AllowWebBrowserDrop = false,
                IsWebBrowserContextMenuEnabled = false,
                ScriptErrorsSuppressed = true,
                WebBrowserShortcutsEnabled = false,
            };
            // The page is set once; after that every navigation (a clicked link, a refresh) is refused.
            browser.Navigating += (_, e) => { if (loaded) e.Cancel = true; };
            browser.DocumentCompleted += (_, __) => { loaded = true; };
            browser.NewWindow += (_, e) => e.Cancel = true;
            Controls.Add(browser);
        }

        public void ShowPage(string html)
        {
            loaded = false;
            browser.DocumentText = html;
        }

        public string ShownText
        {
            get { try { return loaded ? browser.Document?.Body?.InnerText : null; } catch { return null; } }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) browser.Dispose();
            base.Dispose(disposing);
        }
    }

    /// <summary>
    /// Called by the native COM server (NeoMarkdownPreviewShim.dll) through the .NET runtime host:
    /// creates a handler and writes its IUnknown to the address given (as hexadecimal text).
    /// Returns 0, or the HRESULT of what went wrong.
    /// </summary>
    public static class NativeEntry
    {
        public static int Create(string slot)
        {
            try
            {
                AdoptApartment();
                var address = new IntPtr(long.Parse(slot, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
                Marshal.WriteIntPtr(address, Marshal.GetIUnknownForObject(new PreviewHandler()));
                return 0;
            }
            catch (Exception e)
            {
                int hr = Marshal.GetHRForException(e);
                return hr != 0 ? hr : unchecked((int)0x80004005);
            }
        }

        /// <summary>
        /// Windows calls the handler on a single-threaded apartment (STA) thread, which the browser control
        /// needs. A thread that enters .NET through the runtime host isn't marked as one, so tell .NET.
        /// </summary>
        internal static void AdoptApartment()
        {
            Thread thread = Thread.CurrentThread;
            if (thread.GetApartmentState() == ApartmentState.STA || thread.TrySetApartmentState(ApartmentState.STA)) return;
            int type, qualifier;
            int hr = CoGetApartmentType(out type, out qualifier);
            throw new InvalidOperationException(string.Format(CultureInfo.InvariantCulture,
                "The preview needs a single-threaded apartment; .NET reports {0}, Windows reports type {1} (0x{2:X8}).",
                thread.GetApartmentState(), type, hr));
        }

        [DllImport("ole32.dll")] static extern int CoGetApartmentType(out int type, out int qualifier);
    }

    /// <summary>
    /// Used by the automated Windows build to check the handler end to end without Explorer: it plays
    /// Explorer's part (initialise, give a window, preview) and returns the text the page shows.
    /// </summary>
    public static class SelfTest
    {
        public static string Run(string path, int timeoutMs)
        {
            string shown = null;
            var form = new Form { Width = 800, Height = 600, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Left = 0, Top = 0 };
            form.Show();
            var handler = new PreviewHandler();
            ((IInitializeWithFile)handler).Initialize(path, 0);
            var rect = new RECT { Left = 0, Top = 0, Right = form.ClientSize.Width, Bottom = form.ClientSize.Height };
            handler.SetWindow(form.Handle, ref rect);
            handler.DoPreview();
            DateTime until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < until)
            {
                Application.DoEvents();
                shown = handler.ShownText;
                if (!string.IsNullOrEmpty(shown)) break;
                System.Threading.Thread.Sleep(20);
            }
            handler.Unload();
            form.Close();
            return shown ?? "";
        }
    }
}
