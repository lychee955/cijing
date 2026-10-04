!macro customInstall
  FileOpen $0 "$INSTDIR\resources\cijing-nsis-installation" w
  FileWrite $0 "com.lychee955.cijing"
  FileClose $0
!macroend
