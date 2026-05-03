@echo off
mode con cols=110 lines=45
cd /d "%~dp0"
echo Bygger och installerar pa telefonen - laptop-lage.
echo.
echo Tips:
echo - USB-kabel funkar bast pa tag eller nar dator/telefon inte ar pa samma Wi-Fi.
echo - Tradlost funkar om telefon och dator ar pa samma nat/hotspot.
echo - Skicka port som argument vid behov: Bygg-och-installera-laptop.bat 37142
echo.

if "%~1"=="" (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-and-install-laptop.ps1"
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-and-install-laptop.ps1" -Port "%~1"
)

echo.
echo.
echo Klar. Tryck valfri tangent for att stanga.
pause >nul
