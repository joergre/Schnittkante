Unicode True
Name "Schnittkante"
OutFile "/workspace/desktop/release/Schnittkante-Setup.exe"
InstallDir "$LOCALAPPDATA\Schnittkante"
RequestExecutionLevel user
SetCompressor zlib
ShowInstDetails nevershow

Page instfiles

Section
  SetOutPath "$INSTDIR"
  File /r "/workspace/desktop/release/win-unpacked/*.*"
  CreateShortcut "$DESKTOP\Schnittkante.lnk" "$INSTDIR\Schnittkante.exe"
  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\Schnittkante.lnk" "$INSTDIR\Schnittkante.exe"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Schnittkante" "DisplayName" "Schnittkante"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Schnittkante" "UninstallString" "$\"$INSTDIR\Deinstallieren.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Schnittkante" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Schnittkante" "NoRepair" 1
  Exec '"$INSTDIR\Schnittkante.exe"'
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Schnittkante.lnk"
  Delete "$SMPROGRAMS\Schnittkante.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Schnittkante"
SectionEnd
