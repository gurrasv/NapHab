# Pair PC with phone (Wireless debugging). Run once. Then Bygg-och-installera.bat works with connect port only.

$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $Adb)) {
    Write-Host "adb hittas inte." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host " Pa telefonen: Installningar -> Utvecklaralternativ -> Tradlos felsoekning" -ForegroundColor Cyan
Write-Host " Tryck pa 'Parra enhet med parningskod'. Da visas adress (t.ex. 192.168.86.25:33127) och en 6-siffrig kod." -ForegroundColor Cyan
Write-Host ""

$pairPort = Read-Host " Ange PARNINGSPORTEN (siffrorna efter kolon, t.ex. 33127)"
$code     = Read-Host " Ange den 6-siffriga KODEN"

$pairPort = $pairPort.Trim()
$code     = $code.Trim() -replace "\s", ""

if (-not ($pairPort -match "^\d+$")) {
    Write-Host " Ogiltig port." -ForegroundColor Red
    exit 1
}
if (-not ($code -match "^\d{6}$")) {
    Write-Host " Koden ska vara exakt 6 siffror." -ForegroundColor Red
    exit 1
}

$ip = "192.168.86.25"
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
