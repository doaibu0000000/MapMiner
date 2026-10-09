# Fallback pemasangan Node.js LTS (dipanggil start.bat bila winget tidak
# tersedia atau gagal). Mengunduh MSI resmi dari nodejs.org lalu memasangnya
# senyap; Windows akan meminta izin administrator (UAC) saat pemasangan.
#
# PENTING: file ini harus murni ASCII (tanpa em-dash/karakter UTF-8 lain) -
# Windows PowerShell 5.1 membaca file tanpa BOM sebagai ANSI, dan karakter
# UTF-8 multi-byte dapat merusak parsing string.
$ErrorActionPreference = 'Stop'

# Pastikan TLS 1.2 aktif (default lama bisa TLS 1.0 sehingga unduhan gagal)
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

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
Write-Host "[..] Mengunduh Node.js $ver (sekitar 30 MB)..."
Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing -TimeoutSec 600

# Sanity check: MSI harus lebih besar dari 10 MB (bukan halaman error)
if ((Get-Item $msi).Length -lt 10MB) {
    Write-Host "[!!] Berkas MSI yang terunduh tidak utuh - ulangi start.bat."
    exit 1
}

# 3) Pasang senyap (dengan elevasi UAC)
Write-Host "[..] Memasang Node.js - klik Yes bila Windows meminta izin administrator..."
$p = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Verb RunAs -Wait -PassThru
if ($p.ExitCode -eq 0) {
    Write-Host "[OK] Node.js $ver terpasang."
    exit 0
} else {
    Write-Host "[!!] Pemasangan Node.js gagal (kode $($p.ExitCode))."
    exit $p.ExitCode
}
