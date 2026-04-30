# Pair PC with phone (Wireless debugging). Run once. Then Bygg-och-installera.bat works with connect port only.

$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $Adb)) {
    Write-Host "adb hittas inte." -ForegroundColor Red
    exit 1
}

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

function Get-MdnsPairingTarget {
    $out = Invoke-Adb "mdns", "services"
    foreach ($lineObj in @($out)) {
        $line = [string]$lineObj
        if ($line -notmatch "_adb-tls-pairing\._tcp") { continue }
        $m = [regex]::Match($line, "(\d+\.\d+\.\d+\.\d+):(\d+)")
        if ($m.Success) { return "$($m.Groups[1].Value):$($m.Groups[2].Value)" }
    }
    return ""
}

Write-Host ""
Write-Host " Pa telefonen: Installningar -> Utvecklaralternativ -> Tradlos felsoekning" -ForegroundColor Cyan
Write-Host " Tryck pa 'Parra enhet med parningskod'. Da visas adress (t.ex. 192.168.86.25:33127) och en 6-siffrig kod." -ForegroundColor Cyan
Write-Host ""

$mdnsTarget = Get-MdnsPairingTarget
if ($mdnsTarget) {
    Write-Host " Hittad parningsadress via mDNS: $mdnsTarget" -ForegroundColor Gray
}

$pairInput = Read-Host " Ange PARNINGSADRESSEN (IP:PORT) eller bara PORT"
$code     = Read-Host " Ange den 6-siffriga KODEN"

$pairInput = $pairInput.Trim()
$code     = $code.Trim() -replace "\s", ""

if (-not $pairInput -and $mdnsTarget) {
    $pairInput = $mdnsTarget
}
if (-not ($code -match "^\d{6}$")) {
    Write-Host " Koden ska vara exakt 6 siffror." -ForegroundColor Red
    exit 1
}

$ip = ""
$pairPort = ""
if ($pairInput -match "^(\d+\.\d+\.\d+\.\d+):(\d+)$") {
    $ip = $matches[1]
    $pairPort = $matches[2]
} elseif ($pairInput -match "^\d+$") {
    $pairPort = $pairInput
    if ($mdnsTarget -match "^(\d+\.\d+\.\d+\.\d+):\d+$") {
        $ip = $matches[1]
    } else {
        $ip = (Read-Host " Ange telefonens IP (t.ex. 192.168.1.42)").Trim()
    }
}

if (-not ($pairPort -match "^\d+$") -or $ip -notmatch "^\d+\.\d+\.\d+\.\d+$") {
    Write-Host " Ogiltig adress. Anvaend formatet IP:PORT eller PORT + giltig IP." -ForegroundColor Red
    exit 1
}

$target = "${ip}:${pairPort}"

Write-Host ""
Write-Host " Parar med $target ..." -ForegroundColor Cyan

$ErrorActionPreference = "SilentlyContinue"
$result = $code | & $Adb pair $target 2>&1
$ErrorActionPreference = "Stop"

$resultStr = ($result | Out-String).Trim()
if ($resultStr -match "Successfully paired") {
    Write-Host " Parning lyckades. Koer nu Bygg-och-installera.bat och ange anslutningsporten (inte parningsporten)." -ForegroundColor Green
} else {
    Write-Host " Parning misslyckades: $resultStr" -ForegroundColor Red
    Write-Host " Kontrollera port och kod, och att parningsskarmen ar oppen pa telefonen." -ForegroundColor Yellow
    exit 1
}
