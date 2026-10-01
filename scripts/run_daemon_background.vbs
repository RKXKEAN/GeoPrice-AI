' GeoPrice AI - Silent Background Daemon Runner
' ดับเบิ้ลคลิกไฟล์นี้เพื่อรันระบบอัตโนมัติเบื้องหลังแบบไร้หน้าต่างจอดำ (Silent Mode)
Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = "python """ & scriptDir & "\auto_polygon_pipeline.py"" --daemon --interval 60"
WshShell.Run cmd, 0, False
Set WshShell = Nothing
