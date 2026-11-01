; Extra installer steps (electron-builder includes this file into the NSIS installer).
;
; Registers the File Explorer preview handler for the current user: Explorer's Preview pane then
; shows .md files formatted. Everything is written under HKEY_CURRENT_USER, so no admin rights are
; needed, and an existing preview handler (for example PowerToys') is left alone.

!include "LogicLib.nsh"

!define NMR_PREVIEW_CLSID "{24f83a0a-a913-4d0d-aef4-c0b0fc7b1248}"
!define NMR_PREVIEW_IID "{8895b1c6-b41f-4c1c-a562-0d564250836f}"
!define NMR_PREVHOST_APPID "{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}"

!macro NmrPreviewLinkExt EXT
  ReadRegStr $R1 HKCR "${EXT}\shellex\${NMR_PREVIEW_IID}" ""
  ${If} $R1 == ""
  ${OrIf} $R1 == "${NMR_PREVIEW_CLSID}"
    WriteRegStr HKCU "Software\Classes\${EXT}\shellex\${NMR_PREVIEW_IID}" "" "${NMR_PREVIEW_CLSID}"
  ${EndIf}
!macroend

!macro NmrPreviewUnlinkExt EXT
  ReadRegStr $R1 HKCU "Software\Classes\${EXT}\shellex\${NMR_PREVIEW_IID}" ""
  ${If} $R1 == "${NMR_PREVIEW_CLSID}"
    DeleteRegKey HKCU "Software\Classes\${EXT}\shellex\${NMR_PREVIEW_IID}"
  ${EndIf}
!macroend

; Windows' preview host (prevhost.exe) keeps a preview handler loaded while Explorer shows a preview.
; Close the user's preview hosts so the handler's files can be replaced or removed; Explorer starts a
; new one the next time a preview is shown.
!macro NmrStopPreviewHost
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM prevhost.exe'
  Pop $R9
!macroend

!macro customInit
  !insertmacro NmrStopPreviewHost
!macroend

!macro customUnInit
  !insertmacro NmrStopPreviewHost
!macroend

!macro customInstall
  ; Windows starts the handler through NeoMarkdownPreviewShim.dll, a small native COM server that
  ; loads the C# handler (NeoMarkdownPreview.dll, next to it) into the .NET Framework built into Windows.
  ${If} ${FileExists} "$INSTDIR\resources\preview\NeoMarkdownPreviewShim.dll"
  ${AndIf} ${FileExists} "$INSTDIR\resources\preview\NeoMarkdownPreview.dll"
    StrCpy $R2 "Software\Classes\CLSID\${NMR_PREVIEW_CLSID}"
    DeleteRegKey HKCU "$R2"
    WriteRegStr HKCU "$R2" "" "Neo Markdown Reader preview"
    WriteRegStr HKCU "$R2" "DisplayName" "Neo Markdown Reader preview"
    ; Run in Windows' preview host, at the user's normal integrity level (the browser control needs it).
    WriteRegStr HKCU "$R2" "AppID" "${NMR_PREVHOST_APPID}"
    WriteRegDWORD HKCU "$R2" "DisableLowILProcessIsolation" 1
    WriteRegStr HKCU "$R2\InprocServer32" "" "$INSTDIR\resources\preview\NeoMarkdownPreviewShim.dll"
    WriteRegStr HKCU "$R2\InprocServer32" "ThreadingModel" "Apartment"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers" "${NMR_PREVIEW_CLSID}" "Neo Markdown Reader"
    !insertmacro NmrPreviewLinkExt ".md"
    !insertmacro NmrPreviewLinkExt ".markdown"
    !insertmacro NmrPreviewLinkExt ".mdown"
    !insertmacro NmrPreviewLinkExt ".mkd"
    !insertmacro NmrPreviewLinkExt ".mkdn"
    !insertmacro NmrPreviewLinkExt ".mdx"
  ${EndIf}
!macroend

!macro customUnInstall
  !insertmacro NmrPreviewUnlinkExt ".md"
  !insertmacro NmrPreviewUnlinkExt ".markdown"
  !insertmacro NmrPreviewUnlinkExt ".mdown"
  !insertmacro NmrPreviewUnlinkExt ".mkd"
  !insertmacro NmrPreviewUnlinkExt ".mkdn"
  !insertmacro NmrPreviewUnlinkExt ".mdx"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers" "${NMR_PREVIEW_CLSID}"
  DeleteRegKey HKCU "Software\Classes\CLSID\${NMR_PREVIEW_CLSID}"
!macroend
