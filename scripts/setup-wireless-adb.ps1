# Setup wireless ADB - run ONCE with phone connected via USB.
# Requires: USB debugging on, phone connected with cable.

$ErrorActionPreference = "Stop"
$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$ConfigPath = Join-Path $PSScriptRoot ".wireless-adb.json"

if (-not (Test-Path $Adb)) {
    Write-Host "adb not found. Check Android SDK." -ForegroundColor Red
    exit 1
}

Write-Host "Checking USB connection..." -ForegroundColor Cyan
$devices = & $Adb devices 2>&1
# Device line is "serial  device" or "serial  unauthorized" - need status = device
if ($devices -notmatch "device\s" -or $devices -match "unauthorized") {
    Write-Host "No device via USB. What adb sees:" -ForegroundColor Red
    Write-Host $devices
    Write-Host ""
    Write-Host "1. Look at the PHONE SCREEN - tap Allow if you see 'Allow USB debugging?'" -ForegroundColor Yellow
    Write-Host "2. On the phone: open notification 'USB for...' and choose File transfer / MTP (not only charging)." -ForegroundColor Yellow
    Write-Host "3. Try another USB cable or port (must transfer data)." -ForegroundColor Yellow
    Write-Host "4. Turn USB debugging OFF and ON in Developer options, unplug and plug again." -ForegroundColor Yellow
    exit 1
}

# Get phone Wi-Fi IP
$ipLine = & $Adb shell "ip -4 addr show wlan0" 2>$null
if (-not ($ipLine -match 'inet\s+(\d+\.\d+\.\d+\.\d+)')) {
    $ipLine = & $Adb shell "ip -4 addr" 2>$null | Select-String "inet "
    if ($ipLine -match 'inet\s+(\d+\.\d+\.\d+\.\d+)') { $phoneIp = $matches[1] }
} else {
    $phoneIp = $matches[1]
}

if (-not $phoneIp) {
    Write-Host "Could not read phone IP. Make sure Wi-Fi is on." -ForegroundColor Red
    exit 1
}

Write-Host "Phone IP: $phoneIp" -ForegroundColor Green
Write-Host "Enabling wireless ADB on port 5555..." -ForegroundColor Cyan
& $Adb tcpip 5555 | Out-Null
Start-Sleep -Seconds 1

# Connect wirelessly
& $Adb connect "${phoneIp}:5555" | Out-Null
Start-Sleep -Seconds 1
$list = & $Adb devices
if ($list -match "${phoneIp}:5555\s+device") {
    Write-Host "Wireless ADB enabled. You can unplug the USB cable." -ForegroundColor Green
    @{ ip = $phoneIp; port = 5555 } | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
    Write-Host "Saved. Next: run build-and-install.ps1" -ForegroundColor Gray
} else {
    Write-Host "Connection failed. Try again or use Wireless debugging in phone settings." -ForegroundColor Red
    exit 1
}
