# Laptop-friendly build and install script.
# Prefers USB when available, then falls back to wireless ADB.

param(
    [string]$Port = "",
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$NoInstallDependencies
)

$ErrorActionPreference = "Stop"

$ConfigPath = Join-Path $PSScriptRoot ".wireless-adb.json"
$AppRoot = Split-Path $PSScriptRoot -Parent
$ApkPath = Join-Path $AppRoot "android\app\build\outputs\apk\release\app-release.apk"

function Write-Step {
    param([string]$Text)
    Write-Host ""
    Write-Host " $Text" -ForegroundColor Cyan
}

function Find-FirstExistingPath {
    param([string[]]$Paths)
    foreach ($path in $Paths) {
        if ($path -and (Test-Path $path)) {
            return (Resolve-Path $path | Select-Object -First 1).Path
        }
    }
    return ""
}

function Find-CommandSource {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { return $cmd.Source }
    return ""
}

function Find-Adb {
    $fromPath = Find-CommandSource "adb.exe"
    if ($fromPath) { return $fromPath }

    return Find-FirstExistingPath @(
        (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"),
        (Join-Path $env:ProgramFiles "Android\android-sdk\platform-tools\adb.exe"),
        "C:\Android\Sdk\platform-tools\adb.exe"
    )
}

function Find-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
        return $env:JAVA_HOME
    }

    $javaExe = Find-FirstExistingPath @(
        "C:\Program Files\Android\Android Studio\jbr\bin\java.exe",
        "C:\Program Files\Android\Android Studio\jre\bin\java.exe",
        "C:\Program Files\Eclipse Adoptium\jdk-21*\bin\java.exe",
        "C:\Program Files\Java\jdk-21*\bin\java.exe",
        "C:\Program Files\Java\jdk-17*\bin\java.exe"
    )
    if ($javaExe) { return (Split-Path (Split-Path $javaExe -Parent) -Parent) }
    return ""
}

function Find-Npm {
    $npm = Find-CommandSource "npm.cmd"
    if ($npm) { return $npm }

    return Find-FirstExistingPath @(
        "C:\Program Files\nodejs\npm.cmd",
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd"),
        (Join-Path $env:APPDATA "npm\npm.cmd"),
        (Join-Path $env:USERPROFILE "scoop\apps\nodejs\current\npm.cmd")
    )
}

function Find-Node {
    return Find-FirstExistingPath @(
        "C:\Program Files\nodejs\node.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
        (Join-Path $env:USERPROFILE "scoop\apps\nodejs\current\node.exe"),
        (Find-CommandSource "node.exe")
    )
}

function Find-Npx {
    $npx = Find-CommandSource "npx.cmd"
    if ($npx) { return $npx }

    return Find-FirstExistingPath @(
        "C:\Program Files\nodejs\npx.cmd",
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npx.cmd"),
        (Join-Path $env:APPDATA "npm\npx.cmd"),
        (Join-Path $env:USERPROFILE "scoop\apps\nodejs\current\npx.cmd")
    )
}

function Invoke-Adb {
    param([string[]]$Arguments = @())
    $prevErr = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        return & $script:Adb @Arguments 2>&1
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
    $usb = $serials | Where-Object { $_ -notmatch ":" -and $_ -notmatch "^emulator-" } | Select-Object -First 1
    if ($usb) { return $usb }

    $phone = $serials | Where-Object { $_ -notmatch "^emulator-" } | Select-Object -First 1
    if ($phone) { return $phone }
    return $serials | Select-Object -First 1
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

function Connect-Target {
    param([string]$Ip, [string]$PortValue)
    if (-not $Ip -or -not $PortValue) { return $false }
    if ($PortValue -notmatch "^\d+$") { return $false }

    $target = "${Ip}:${PortValue}"
    Write-Host "       Ansluter till $target ..." -ForegroundColor Cyan
    $result = cmd /c "`"$script:Adb`" connect $target 2>&1"
    Start-Sleep -Seconds 1

    $list = Invoke-Adb "devices"
    if ($list -match "${target}\s+device") {
        Write-Host "       Ansluten." -ForegroundColor Green
        Save-Config -Ip $Ip -PortValue $PortValue
        return $true
    }

    $msg = (($result | ForEach-Object { $_.ToString() }) -join " ").Trim()
    if (-not $msg) { $msg = "kunde inte ansluta till $target" }
    Write-Host "       Kunde inte ansluta. $msg" -ForegroundColor Yellow
    return $false
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
    $pairResult = $pairCode | & $script:Adb pair $target 2>&1
    $pairText = (($pairResult | ForEach-Object { $_.ToString() }) -join " ").Trim()
    if ($pairText -match "Successfully paired") {
        Write-Host "       Parning lyckades." -ForegroundColor Green
        return $true
    }

    if (-not $pairText) { $pairText = "okant fel vid adb pair" }
    Write-Host "       Parning misslyckades: $pairText" -ForegroundColor Red
    return $false
}

function Ensure-ProjectDependencies {
    if (Test-Path (Join-Path $AppRoot "node_modules")) { return $true }
    if ($NoInstallDependencies) {
        Write-Host "       node_modules saknas och -NoInstallDependencies ar valt." -ForegroundColor Red
        return $false
    }
    if (-not $script:Npm) {
        Write-Host "       node_modules saknas och npm hittas inte." -ForegroundColor Red
        return $false
    }

    Write-Host "       node_modules saknas. Installerar med npm ci..." -ForegroundColor Yellow
    Set-Location $AppRoot
    & $script:Npm ci
    return ($LASTEXITCODE -eq 0)
}

function Move-IncompleteNdkInstalls {
    $ndkRoot = Join-Path $env:ANDROID_HOME "ndk"
    if (-not (Test-Path $ndkRoot)) { return }

    $resolvedNdkRoot = (Resolve-Path $ndkRoot).Path
    Get-ChildItem -LiteralPath $resolvedNdkRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $sourceProperties = Join-Path $_.FullName "source.properties"
        if (Test-Path $sourceProperties) { return }

        $stamp = Get-Date -Format "yyyyMMddHHmmss"
        $backupPath = "$($_.FullName).incomplete-$stamp"
        Write-Host "       Hittade halvfardig NDK-installation: $($_.FullName)" -ForegroundColor Yellow
        Write-Host "       Flyttar undan den sa Gradle kan installera om NDK..." -ForegroundColor Yellow
        Move-Item -LiteralPath $_.FullName -Destination $backupPath
    }
}

Write-Step "[0/4] Kontrollerar laptop-miljo..."

$script:Adb = Find-Adb
$javaHome = Find-JavaHome
$script:Node = Find-Node
$script:Npm = Find-Npm
$script:Npx = Find-Npx
$missing = New-Object System.Collections.Generic.List[string]

if (-not $script:Adb) { $missing.Add("Android SDK platform-tools / adb") }
if (-not $javaHome) { $missing.Add("Java/JDK, t.ex. Android Studio JBR") }
if (-not $SkipBuild -and -not $script:Node) { $missing.Add("Node.js") }
if (-not $SkipBuild -and -not $script:Npx) { $missing.Add("Node.js med npx") }
if (-not $SkipBuild -and -not $script:Npm -and -not (Test-Path (Join-Path $AppRoot "node_modules"))) { $missing.Add("npm for att installera projektberoenden") }

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host " Saknar detta pa laptopen:" -ForegroundColor Red
    foreach ($item in $missing) { Write-Host " - $item" -ForegroundColor Red }
    Write-Host ""
    Write-Host " Installera Node.js LTS om Node/npm/npx saknas. Android Studio brukar fixa adb och Java." -ForegroundColor Yellow
    exit 1
}

$env:ANDROID_HOME = Split-Path (Split-Path $script:Adb -Parent) -Parent
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = $javaHome
$env:APP_VARIANT = "preview"
$env:NODE_ENV = "production"

if ($script:Node) {
    $nodeDir = Split-Path $script:Node -Parent
    $env:Path = "$nodeDir;$env:Path"
}

Write-Host "       adb: $script:Adb" -ForegroundColor Gray
Write-Host "       JAVA_HOME: $env:JAVA_HOME" -ForegroundColor Gray
if ($script:Node) { Write-Host "       node: $script:Node" -ForegroundColor Gray }
if ($script:Npx) { Write-Host "       npx: $script:Npx" -ForegroundColor Gray }

Move-IncompleteNdkInstalls

if (-not $SkipBuild) {
    if (-not (Ensure-ProjectDependencies)) {
        Write-Host "       Kunde inte installera projektberoenden." -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $script:Adb)) {
    Write-Host "adb hittas inte." -ForegroundColor Red
    exit 1
}

$null = Invoke-Adb "devices"
Start-Sleep -Milliseconds 800

Write-Step "[1/4] Ansluter till telefonen..."

$targetSerial = Get-ConnectedDeviceSerial
if ($targetSerial) {
    if ($targetSerial -match ":") {
        Write-Host "       Redan ansluten tradlost: $targetSerial" -ForegroundColor Green
    } else {
        Write-Host "       Redan ansluten via USB: $targetSerial" -ForegroundColor Green
    }
} else {
    Write-Host "       Ingen USB-enhet hittades. Provar tradlost." -ForegroundColor Yellow
    Write-Host "       Pa tag ar USB oftast enklast om Wi-Fi/hotspot kranglar." -ForegroundColor Gray

    $ip = Resolve-PhoneIp -ConfiguredIp (Get-ConfiguredIp)
    if (-not $ip) {
        Write-Host "       Ogiltig eller saknad IP-adress. Avbryter." -ForegroundColor Red
        exit 1
    }

    $portToTry = ""
    if ($Port) { $portToTry = $Port } else { $portToTry = Get-ConfiguredPort }
    $connected = $false

    if ($portToTry) {
        $connected = Connect-Target -Ip $ip -PortValue $portToTry
    }

    if (-not $connected) {
        Write-Host "       Soker efter aktuell port via adb mdns..." -ForegroundColor Gray
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
                if (-not (Pair-Phone -DefaultIp $ip)) { exit 1 }
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

if (-not $SkipBuild) {
    Write-Step "[2/4] Bygger APK..."
    Set-Location $AppRoot
    & $script:Npx expo run:android --variant release --no-bundler
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host " BYGGET MISSLYCKADES." -ForegroundColor Red
        Write-Host " Prova igen, eller kor med -SkipBuild om APK redan finns." -ForegroundColor Yellow
        exit $LASTEXITCODE
    }
} else {
    Write-Step "[2/4] Hoppar over build..."
    if (-not (Test-Path $ApkPath)) {
        Write-Host "APK hittas inte: $ApkPath" -ForegroundColor Red
        exit 1
    }
}

if ($SkipInstall) {
    Write-Step "[3/4] Hoppar over installation..."
    Write-Host "       APK: $ApkPath" -ForegroundColor Green
    exit 0
}

Write-Step "[3/4] Installerar pa telefonen..."
$targetSerial = Get-ConnectedDeviceSerial
if ($targetSerial) {
    $null = Invoke-Adb "-s", $targetSerial, "install", "-r", $ApkPath
} else {
    $null = Invoke-Adb "install", "-r", $ApkPath
}

if ($LASTEXITCODE -ne 0) {
    Write-Host " Installation misslyckades." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Step "[4/4] Klar"
Write-Host " ========================================" -ForegroundColor Green
Write-Host "   Appen ar installerad pa telefonen." -ForegroundColor Green
Write-Host " ========================================" -ForegroundColor Green
