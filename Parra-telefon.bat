@echo off
mode con cols=80 lines=25
cd /d "%~dp0"
echo.
echo Parra datorn med telefonen (en gang).
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\pair-phone.ps1"
echo.
pause
