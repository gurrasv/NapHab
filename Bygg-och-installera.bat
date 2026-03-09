@echo off
mode con cols=100 lines=45
cd /d "%~dp0"
echo Bygger preview-APK och installerar pa telefonen...
echo - Redan ansluten: bygget startar direkt.
echo - Inte ansluten: du fragas efter port (t.ex. 37142). Eller kora med port: Bygg-och-installera.bat 37142
echo.
if "%~1"=="" (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-and-install.ps1"
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-and-install.ps1" -Port "%~1"
)
echo.
echo.
echo Klar. Tryck valfri tangent for att stanga.
pause >nul
