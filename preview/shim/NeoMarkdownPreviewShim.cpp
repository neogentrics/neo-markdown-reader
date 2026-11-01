// The COM server Windows loads for the File Explorer preview (registered per user by the installer).
//
// The preview handler itself is written in C# (NeoMarkdownPreview.dll, .NET Framework 4.8). Windows'
// own loader for .NET COM classes (mscoree.dll) wouldn't create it from a per-user registration, and a
// machine-wide one would need administrator rights to install. So this small native DLL is registered
// instead: it starts the .NET Framework runtime that is part of Windows, asks NeoMarkdownPreview.dll
// (next to this file) for a new handler and hands that to Windows.
#include <windows.h>
#include <metahost.h>
#include <cwchar>

#pragma comment(lib, "mscoree.lib")

namespace {

// {24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}: the preview handler (Neo.MarkdownPreview.PreviewHandler).
const CLSID kClsidPreview = {0x24f83a0a, 0xa913, 0x4d0d, {0xae, 0xf4, 0xc0, 0xb0, 0xfc, 0x7b, 0x12, 0x48}};
// From metahost.h; spelled out so no import library has to provide them.
const CLSID kClsidMetaHost = {0x9280188d, 0x0e8e, 0x4867, {0xb3, 0x0c, 0x7f, 0xa8, 0x38, 0x84, 0xe8, 0xde}};
const IID kIidMetaHost = {0xd332db9e, 0xb9b3, 0x4125, {0x82, 0x07, 0xa1, 0x48, 0x84, 0xf5, 0x32, 0x16}};
const IID kIidRuntimeInfo = {0xbd39d1d2, 0xba2f, 0x486a, {0x89, 0xb0, 0xb4, 0xb0, 0xcb, 0x46, 0x68, 0x91}};
const CLSID kClsidRuntimeHost = {0x90f1a06e, 0x7712, 0x4762, {0x86, 0xb5, 0x7a, 0x5e, 0xba, 0x6b, 0xdb, 0x02}};
const IID kIidRuntimeHost = {0x90f1a06c, 0x7712, 0x4762, {0x86, 0xb5, 0x7a, 0x5e, 0xba, 0x6b, 0xdb, 0x02}};

HMODULE g_module = nullptr;
SRWLOCK g_lock = SRWLOCK_INIT;
ICLRRuntimeHost* g_runtime = nullptr;   // started once and kept: the runtime can't be unloaded

// The full path of NeoMarkdownPreview.dll, which sits next to this DLL.
HRESULT ManagedAssemblyPath(wchar_t* out, size_t capacity) {
  DWORD n = GetModuleFileNameW(g_module, out, static_cast<DWORD>(capacity));
  if (n == 0 || n >= capacity) return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
  wchar_t* slash = wcsrchr(out, L'\\');
  if (!slash) return E_UNEXPECTED;
  size_t used = static_cast<size_t>(slash + 1 - out);
  return wcscpy_s(slash + 1, capacity - used, L"NeoMarkdownPreview.dll") == 0 ? S_OK : E_OUTOFMEMORY;
}

HRESULT StartRuntime(ICLRRuntimeHost** result) {
  AcquireSRWLockExclusive(&g_lock);
  HRESULT hr = S_OK;
  if (!g_runtime) {
    ICLRMetaHost* meta = nullptr;
    ICLRRuntimeInfo* info = nullptr;
    ICLRRuntimeHost* host = nullptr;
    hr = CLRCreateInstance(kClsidMetaHost, kIidMetaHost, reinterpret_cast<void**>(&meta));
    if (SUCCEEDED(hr)) hr = meta->GetRuntime(L"v4.0.30319", kIidRuntimeInfo, reinterpret_cast<void**>(&info));
    if (SUCCEEDED(hr)) hr = info->GetInterface(kClsidRuntimeHost, kIidRuntimeHost, reinterpret_cast<void**>(&host));
    if (SUCCEEDED(hr)) hr = host->Start();   // S_FALSE when another add-on already started it
    if (SUCCEEDED(hr)) {
      g_runtime = host;
      host = nullptr;
    }
    if (host) host->Release();
    if (info) info->Release();
    if (meta) meta->Release();
  }
  if (g_runtime) {
    g_runtime->AddRef();
    *result = g_runtime;
    hr = S_OK;
  }
  ReleaseSRWLockExclusive(&g_lock);
  return hr;
}

HRESULT CreateHandler(REFIID riid, void** ppv) {
  wchar_t path[MAX_PATH * 2];
  HRESULT hr = ManagedAssemblyPath(path, sizeof(path) / sizeof(path[0]));
  if (FAILED(hr)) return hr;
  ICLRRuntimeHost* runtime = nullptr;
  hr = StartRuntime(&runtime);
  if (FAILED(hr)) return hr;

  // The managed side writes the new handler's IUnknown into `handler`, whose address it is given.
  IUnknown* handler = nullptr;
  wchar_t slot[32];
  swprintf_s(slot, L"%llx", static_cast<unsigned long long>(reinterpret_cast<ULONG_PTR>(&handler)));
  DWORD code = 0;
  hr = runtime->ExecuteInDefaultAppDomain(path, L"Neo.MarkdownPreview.NativeEntry", L"Create", slot, &code);
  runtime->Release();
  if (SUCCEEDED(hr) && code != 0) hr = static_cast<HRESULT>(code);
  if (SUCCEEDED(hr) && !handler) hr = E_UNEXPECTED;
  if (SUCCEEDED(hr)) hr = handler->QueryInterface(riid, ppv);
  if (handler) handler->Release();
  return hr;
}

class Factory final : public IClassFactory {
 public:
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, IID_IClassFactory)) {
      *ppv = static_cast<IClassFactory*>(this);
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  // The factory is a static object that lives as long as the DLL.
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }
  STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    return CreateHandler(riid, ppv);
  }
  STDMETHODIMP LockServer(BOOL) override { return S_OK; }
};

Factory g_factory;

}  // namespace

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  *ppv = nullptr;
  if (!IsEqualCLSID(rclsid, kClsidPreview)) return CLASS_E_CLASSNOTAVAILABLE;
  return g_factory.QueryInterface(riid, ppv);
}

// Once the .NET runtime is loaded into a process it stays, so this DLL stays too.
STDAPI DllCanUnloadNow() { return S_FALSE; }

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = instance;
    DisableThreadLibraryCalls(instance);
  }
  return TRUE;
}
