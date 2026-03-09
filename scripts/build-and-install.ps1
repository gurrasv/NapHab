# Build preview APK and install on phone (wireless first).
# Flow:
# 1) If already connected -> continue.
# 2) Else try explicit/saved port.
# 3) Else auto-discover connect port with `adb mdns services`.
# 4) Else ask for port manually.

param(
    [string]$Port = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$ConfigPath = Join-Path $PSScriptRoot ".wireless-adb.json"
$AppRoot = Split-Path $PSScriptRoot -Parent
$ApkPath = Join-Path $AppRoot "android\app\build\outputs\apk\release\app-release.apk"
$DefaultIp = "192.168.86.25"

$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:APP_VARIANT = "preview"

function Invoke-Adb {
    param([string[]]$Arguments = @())
    $prevErr = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        return & $Adb @Arguments 2>&1
    } finally {
        $ErrorActionPreference = $prevErr
    }
}

function Save-Config {
    param([string]$Ip, [string]$PortValue)
    if (-not $Ip -or -not $PortValue) { return }
    @{ ip = $Ip; port = [int]$PortValue } | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
}

function Get-ConfiguredIp {
    if (Test-Path $ConfigPath) {
        try {
            $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            if ($cfg.ip) { return [string]$cfg.ip }
        } catch {}
    }
    return $DefaultIp
}

function Get-ConfiguredPort {
    if (Test-Path $ConfigPath) {
        try {
            $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            if ($cfg.port) { return [string]$cfg.port }
        } catch {}
    }
    return ""
}

function Get-ConnectedDeviceSerial {
    $out = Invoke-Adb "devices", "-l"
    $lines = $out -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match "^\S+\s+device(\s|$)" }
    $serials = $lines | ForEach-Object { ($_ -split "\s+")[0] }
    $phone = $serials | Where-Object { $_ -notmatch "^emulator-" } | Select-Object -First 1
    if ($phone) { return $phone }
    return $serials | Select-Object -First 1
}

function Connect-Target {
    param([string]$Ip, [string]$PortValue)
    if (-not $Ip -or -not $PortValue) { return $false }
    if ($PortValue -notmatch "^\d+$") { return $false }

    $target = "${Ip}:${PortValue}"
    Write-Host "Connecting to $target ..." -ForegroundColor Cyan
    $result = cmd /c "`"$Adb`" connect $target 2>&1"
    Start-Sleep -Seconds 1

    $list = Invoke-Adb "devices"
    if ($list -match "${target}\s+device") {
        Write-Host "Connected." -ForegroundColor Green
        Save-Config -Ip $Ip -PortValue $PortValue
        return $true
    }

    $msg = (($result | ForEach-Object { $_.ToString() }) -join " ").Trim()
    if (-not $msg) { $msg = "failed to connect to $target" }
    Write-Host "Could not connect. $msg" -ForegroundColor Yellow
    return $false
}

function Get-MdnsConnectTargets {
    $out = Invoke-Adb "mdns", "services"
    $targets = New-Object System.Collections.Generic.List[string]

    foreach ($lineObj in @($out)) {
        $line = [string]$lineObj
        if ($line -notmatch "_adb-tls-connect\._tcp") { continue }
        $m = [regex]::Match($line, "(\d+\.\d+\.\d+\.\d+):(\d+)")
        if ($m.Success) {
            $target = "$($m.Groups[1].Value):$($m.Groups[2].Value)"
            if (-not $targets.Contains($target)) { $targets.Add($target) }
        }
    }
    return $targets
}

if (-not (Test-Path $Adb)) {
    Write-Host "adb not found. Set ANDROID_HOME or add adb to PATH." -ForegroundColor Red
    exit 1
}

# Warm up adb daemon.
$null = Invoke-Adb "devices"
Start-Sleep -Milliseconds 800

Write-Host ""
Write-Host " [1/3] Ansluter till telefonen..." -ForegroundColor Cyan

$targetSerial = Get-ConnectedDeviceSerial
if ($targetSerial) {
    Write-Host "       Redan ansluten." -ForegroundColor Green
} else {
    $ip = Get-ConfiguredIp
    $portToTry = ""
    if ($Port) { $portToTry = $Port } else { $portToTry = Get-ConfiguredPort }

    $connected = $false

    # A) Try explicit or previously saved port first.
    if ($portToTry) {
        $connected = Connect-Target -Ip $ip -PortValue $portToTry
    }

    # B) Auto-discover current connect port via mDNS.
    if (-not $connected) {
        Write-Host "       Sokar efter aktuell port via adb mdns..." -ForegroundColor Gray
        $targets = Get-MdnsConnectTargets
        foreach ($target in $targets) {
            $parts = $target.Split(":")
            if ($parts.Length -ne 2) { continue }
            if (Connect-Target -Ip $parts[0] -PortValue $parts[1]) {
                $connected = $true
                break
            }
        }
    }

    # C) Ask user as final fallback.
    if (-not $connected) {
        Write-Host "       Telefonen ar inte ansluten." -ForegroundColor Red
        Write-Host ""
        Write-Host " Ange anslutningsporten fran telefonen (Tradlos felsokning -> Anslut):" -ForegroundColor Yellow
        $script:Port = (Read-Host " Port").Trim()
        if ($script:Port -notmatch "^\d+$") {
            Write-Host " Ogiltig port. Avbryter." -ForegroundColor Red
            exit 1
        }
        if (-not (Connect-Target -Ip $ip -PortValue $script:Port)) {
            Write-Host " Misslyckades att ansluta. Sla av/paa Tradlos felsokning och prova ny port." -ForegroundColor Red
            exit 1
        }
    }

    $targetSerial = Get-ConnectedDeviceSerial
    if (-not $targetSerial) {
        Write-Host " Ingen ansluten enhet hittades trots connect-forsok." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
if (-not $SkipBuild) {
    Write-Host " [2/3] Bygger APK (tar oftast 1-2 min, folj texten nedan)..." -ForegroundColor Cyan
    Write-Host ""
    Set-Location $AppRoot
    npx expo run:android --variant release --no-bundler
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host " BYGGET MISSLYCKADES." -ForegroundColor Red
        Write-Host " Forsok igen eller kora: .\build-and-install.ps1 -SkipBuild" -ForegroundColor Yellow
        exit $LASTEXITCODE
    }
} else {
    if (-not (Test-Path $ApkPath)) {
        Write-Host "APK not found: $ApkPath" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host " [3/3] Installerar pa telefonen..." -ForegroundColor Cyan
$targetSerial = Get-ConnectedDeviceSerial
if ($targetSerial) {
    $null = Invoke-Adb "-s", $targetSerial, "install", "-r", $ApkPath
} else {
    $null = Invoke-Adb "install", "-r", $ApkPath
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host " ========================================" -ForegroundColor Green
    Write-Host "   KLAR. Appen ar installerad pa telefonen." -ForegroundColor Green
    Write-Host " ========================================" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host " Installation misslyckades." -ForegroundColor Red
    exit $LASTEXITCODE
}
