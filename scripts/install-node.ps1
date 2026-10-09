# Fallback pemasangan Node.js LTS (dipakai start.bat bila winget tidak
# tersedia atau gagal). Mengunduh MSI resmi dari nodejs.org lalu memasangnya
# senyap; Windows akan meminta izin administrator (UAC) saat pemasangan.
$ErrorActionPreference = 'Stop'

# 1) Tentukan versi LTS terbaru dari jalur v22 (fallback ke versi tetap bila daftar gagal diambil)
$ver = $null
try {
    $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 30
    $ver = ($idx | Where-Object { $_.version -like 'v22.*' -and $_.lts } | Select-Object -First 1).version
} catch { }
if (-not $ver) { $ver = 'v22.14.0' }

$url = "https://nodejs.org/dist/$ver/node-$ver-x64.msi"
$msi = Join-Path $env:TEMP "node-$ver-x64.msi"

# 2) Unduh MSI
Write-Host "[..] Mengunduh Node.js $ver (±30 MB)..."
Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing -TimeoutSec 600

# 3) Pasang senyap (dengan elevasi UAC)
Write-Host "[..] Memasang Node.js — klik Yes bila Windows meminta izin administrator..."
$p = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Verb RunAs -Wait -PassThru
if ($p.ExitCode -eq 0) {
    Write-Host "[OK] Node.js $ver terpasang."
    exit 0
} else {
    Write-Host "[!!] Pemasangan Node.js gagal (kode $($p.ExitCode))."
    exit $p.ExitCode
}
