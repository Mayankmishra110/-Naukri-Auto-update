' Launches the refresh script with no console window so scheduled runs never steal focus.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
WScript.Quit sh.Run("node.exe """ & dir & "\naukri-profile-refresh.js""", 0, True)
