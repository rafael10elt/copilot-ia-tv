@echo off
set SCRIPT="%TEMP%\%RANDOM%-%RANDOM%.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") >> %SCRIPT%
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\Lumi Sentinel.lnk" >> %SCRIPT%
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> %SCRIPT%
echo oLink.TargetPath = "%~dp0venv\Scripts\pythonw.exe" >> %SCRIPT%
echo oLink.Arguments = """%~dp0sentinel.py""" >> %SCRIPT%
echo oLink.WorkingDirectory = "%~dp0" >> %SCRIPT%
echo oLink.Description = "Lumi Copilot Vision Sentinel" >> %SCRIPT%
echo oLink.Save >> %SCRIPT%
cscript /nologo %SCRIPT%
del %SCRIPT%
echo.
echo ========================================================
echo [OK] Atalho 'Lumi Sentinel' criado com sucesso na Area de Trabalho!
echo ========================================================
pause