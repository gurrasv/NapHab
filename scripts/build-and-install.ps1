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
    return ""
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

function Get-MdnsPairingTargets {
    $out = Invoke-Adb "mdns", "services"
    $targets = New-Object System.Collections.Generic.List[string]
    foreach ($lineObj in @($out)) {
        $line = [string]$lineObj
        if ($line -notmatch "_adb-tls-pairing\._tcp") { continue }
        $m = [regex]::Match($line, "(\d+\.\d+\.\d+\.\d+):(\d+)")
        if ($m.Success) {
            $target = "$($m.Groups[1].Value):$($m.Groups[2].Value)"
            if (-not $targets.Contains($target)) { $targets.Add($target) }
        }
    }
    return $targets
}

function Resolve-PhoneIp {
    param([string]$ConfiguredIp)
    if ($ConfiguredIp) { return $ConfiguredIp }

    $targets = Get-MdnsConnectTargets
    $ips = @(
        $targets |
        ForEach-Object { ($_ -split ":")[0] } |
        Where-Object { $_ -match "^\d+\.\d+\.\d+\.\d+$" } |
        Select-Object -Unique
    )

    if ($ips.Count -eq 1) {
        Write-Host "       Hittade telefon-IP via mDNS: $($ips[0])" -ForegroundColor Gray
        return [string]$ips[0]
    }

    if ($ips.Count -gt 1) {
        Write-Host "       Flera mobiler hittades via mDNS: $($ips -join ', ')" -ForegroundColor Yellow
    }

    Write-Host "       Kunde inte lasa telefonens IP automatiskt." -ForegroundColor Yellow
    Write-Host "       Oppna Tradlos felsokning pa telefonen och las av IP-adressen." -ForegroundColor Yellow
    $manualIp = (Read-Host " IP (t.ex. 192.168.1.42)").Trim()
    if ($manualIp -notmatch "^\d+\.\d+\.\d+\.\d+$") { return "" }
    return $manualIp
}

function Pair-Phone {
    param([string]$DefaultIp)

    $pairTarget = ""
    $pairTargets = Get-MdnsPairingTargets
    if ($pairTargets.Count -gt 0) {
        Write-Host "       Hittade parningsadress via mDNS: $($pairTargets[0])" -ForegroundColor Gray
        $pairTarget = $pairTargets[0]
    }

    Write-Host ""
    Write-Host "       Oppna: Tradlos felsokning -> Parra enhet med parningskod" -ForegroundColor Yellow
    Write-Host "       Skriv PARNINGSADRESS (IP:PORT) eller bara porten." -ForegroundColor Yellow
    $pairInput = (Read-Host "       Parningsadress/port").Trim()
    $pairCode = ((Read-Host "       6-siffrig kod").Trim()) -replace "\s", ""

    if (-not $pairInput -and $pairTarget) { $pairInput = $pairTarget }
    if ($pairCode -notmatch "^\d{6}$") {
        Write-Host "       Koden maste vara exakt 6 siffror." -ForegroundColor Red
        return $false
    }

    $pairIp = ""
    $pairPort = ""
    if ($pairInput -match "^(\d+\.\d+\.\d+\.\d+):(\d+)$") {
        $pairIp = $matches[1]
        $pairPort = $matches[2]
    } elseif ($pairInput -match "^\d+$") {
        $pairPort = $pairInput
        if ($DefaultIp) {
            $pairIp = $DefaultIp
        } elseif ($pairTarget -match "^(\d+\.\d+\.\d+\.\d+):\d+$") {
            $pairIp = $matches[1]
        } else {
            $pairIp = (Read-Host "       Telefon-IP").Trim()
        }
    }

    if ($pairIp -notmatch "^\d+\.\d+\.\d+\.\d+$" -or $pairPort -notmatch "^\d+$") {
        Write-Host "       Ogiltig parningsadress." -ForegroundColor Red
        return $false
    }

    $target = "${pairIp}:${pairPort}"
    Write-Host "       Parar med $target ..." -ForegroundColor Cyan
    $pairResult = $pairCode | & $Adb pair $target 2>&1
    $pairText = (($pairResult | ForEach-Object { $_.ToString() }) -join " ").Trim()
    if ($pairText -match "Successfully paired") {
        Write-Host "       Parning lyckades." -ForegroundColor Green
        return $true
    }

    if (-not $pairText) { $pairText = "okant fel vid adb pair" }
    Write-Host "       Parning misslyckades: $pairText" -ForegroundColor Red
    return $false
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
    $ip = Resolve-PhoneIp -ConfiguredIp (Get-ConfiguredIp)
    if (-not $ip) {
        Write-Host "       Ogiltig eller saknad IP-adress. Avbryter." -ForegroundColor Red
        exit 1
    }
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
        Write-Host " Ange anslutning som PORT (t.ex. 37142) eller IP:PORT (t.ex. 192.168.1.42:37142)." -ForegroundColor Yellow
        $userTarget = (Read-Host " Port / IP:Port").Trim()
        if ($userTarget -match "^(\d+\.\d+\.\d+\.\d+):(\d+)$") {
            $ip = $matches[1]
            $script:Port = $matches[2]
        } else {
            $script:Port = $userTarget
        }
        if ($script:Port -notmatch "^\d+$") {
            Write-Host " Ogiltig port. Avbryter." -ForegroundColor Red
            exit 1
        }
        if (-not (Connect-Target -Ip $ip -PortValue $script:Port)) {
            Write-Host " Misslyckades att ansluta med den porten." -ForegroundColor Red
            $pairNow = (Read-Host " Vill du prova omparning nu? (j/n)").Trim().ToLowerInvariant()
            if ($pairNow -eq "j" -or $pairNow -eq "ja" -or $pairNow -eq "y" -or $pairNow -eq "yes") {
                if (-not (Pair-Phone -DefaultIp $ip)) {
                    exit 1
                }
                Write-Host ""
                Write-Host " Ange sedan ANSLUTNINGSPORTEN fran 'IP-adress och port' i Tradlos felsokning." -ForegroundColor Yellow
                $retryTarget = (Read-Host " Port / IP:Port").Trim()
                if ($retryTarget -match "^(\d+\.\d+\.\d+\.\d+):(\d+)$") {
                    $ip = $matches[1]
                    $script:Port = $matches[2]
                } else {
                    $script:Port = $retryTarget
                }
                if ($script:Port -notmatch "^\d+$" -or -not (Connect-Target -Ip $ip -PortValue $script:Port)) {
                    Write-Host " Fortfarande ingen anslutning efter omparning." -ForegroundColor Red
                    exit 1
                }
            } else {
                exit 1
            }
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
