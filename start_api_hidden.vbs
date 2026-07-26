' Auto-starts the BETPRO API backend at Windows logon, minimized.
' Window style 0 (fully hidden) gets killed by security software on this PC,
' so this uses 7 (minimized, no focus) instead -- it briefly shows in the
' taskbar but never pops up in front of the user.
' This same file is also copied into the Startup folder (shell:startup).
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\gomgu\Desktop\betpro"
WshShell.Run "cmd /c ""C:\Users\gomgu\Desktop\betpro\start_api_backend.bat""", 7, False
