' Lance la mini-application 7G (icone dans la barre systeme) sans aucune fenetre.
Set WshShell = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "app-7g.ps1"""
WshShell.Run cmd, 0, False
