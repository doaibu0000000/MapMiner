@echo off
setlocal EnableExtensions
title MapMiner - Nyalakan Semua Layanan
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

echo ============================================================
echo   MapMiner - Nyalakan Semua Layanan
echo.
echo   * Komputer baru / baru di-clone dari GitHub? Tidak apa-apa.
echo     Semua kebutuhan dipasang OTOMATIS saat pertama kali
echo     dijalankan: Bun, Node.js, dependensi, browser Chromium.
echo     Butuh koneksi internet dan bisa makan waktu 5-10 menit.
echo.
echo   * Layanan hanya hidup selama jendela ini terbuka.
echo     Tutup jendela ini (klik X) = SEMUA layanan ikut mati.
echo   * Mau matikan manual? Jalankan stop.bat
echo ============================================================
echo.

REM ============================================================
REM  BOOTSTRAP OTOMATIS — pasang semua kebutuhan bila belum ada
REM ============================================================

REM ---- 1) Bun (runtime utama semua layanan) ----
where bun >nul 2>&1
if errorlevel 1 (
    echo [..] Bun belum terpasang - mengunduh dan memasang Bun...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)
where bun >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!!] Gagal memasang Bun otomatis.
    echo      Kemungkinan tidak ada koneksi internet / diblokir antivirus.
    echo      Pasang manual dari https://bun.sh lalu jalankan start.bat lagi.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('bun --version') do echo [OK] Bun v%%v terpasang.

REM ---- 2) Node.js (dibutuhkan Next.js di port 3000) ----
where node >nul 2>&1
if errorlevel 1 (
    echo [..] Node.js belum terpasang - memasang versi LTS via winget...
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
    set "PATH=%PATH%;C:\Program Files\nodejs"
)
where node >nul 2>&1
if errorlevel 1 (
    echo [!!] Node.js belum bisa dipastikan terpasang.
    echo      Kalau aplikasi web di port 3000 gagal jalan, pasang manual:
    echo      https://nodejs.org - lalu jalankan start.bat lagi.
) else (
    echo [OK] Node.js terpasang.
)

REM ---- 3) Dependensi aplikasi Next.js (root) ----
if not exist "node_modules" (
    echo [..] Memasang dependensi aplikasi - sekali saja, sekitar 1-2 menit...
    call bun install
)
if not exist "node_modules" (
    echo [!!] Dependensi aplikasi gagal terpasang - cek koneksi internet lalu ulangi.
    pause
    exit /b 1
)

REM ---- 4) Dependensi mini-service bila belum ada ----
if not exist "mini-services\gmaps-scraper\node_modules" (
    echo [..] Memasang dependensi scraper ^(bun install^)...
    pushd mini-services\gmaps-scraper
    call bun install
    popd
)
if not exist "mini-services\wa-checker\node_modules" (
    echo [..] Memasang dependensi wa-checker ^(bun install^)...
    pushd mini-services\wa-checker
    call bun install
    popd
)

REM ---- 5) Browser Chromium untuk scraper — dilewati bila Chrome/Edge
REM         sudah terpasang di komputer ini (dipakai sebagai cadangan) ----
set "NEED_BROWSER=1"
if exist "%LOCALAPPDATA%\ms-playwright" set "NEED_BROWSER=0"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NEED_BROWSER=0"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "NEED_BROWSER=0"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "NEED_BROWSER=0"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NEED_BROWSER=0"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "NEED_BROWSER=0"
if "%NEED_BROWSER%"=="1" (
    echo [..] Browser untuk scraper belum ada - mengunduh Chromium, sekitar 150 MB...
    pushd mini-services\gmaps-scraper
    call bun x playwright-core install chromium
    popd
) else (
    echo [OK] Browser scraper tersedia - Chromium/Chrome/Edge ditemukan.
)

REM ---- 6) File .env bawaan bila belum ada ----
if not exist ".env" echo DATABASE_URL="file:./dev.db"> .env

echo.
echo [OK] Persiapan selesai - menyalakan layanan...
echo.

REM ============================================================
REM  NYALAKAN LAYANAN (perilaku lama tetap sama)
REM ============================================================

REM ---- 7) Bersihkan sisa mode "selalu online" yang lama ----
REM (shortcut Startup + watchdog membuat layanan menyala/muncul kembali
REM  dengan sendirinya; perilaku itu sudah tidak dipakai lagi)
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MapMiner AlwaysOnline.lnk" >nul 2>&1
schtasks /Delete /TN "MapMiner AlwaysOnline" /F >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'watchdog\.mjs|watchdog-start\.vbs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM ---- 8) Matikan layanan lama yang masih jalan di latar belakang ----
REM Tujuannya supaya semua layanan menjadi "anak" dari jendela ini:
REM jendela ditutup = semuanya benar-benar ikut mati.
echo [..] Mematikan sisa layanan lama di port 3003 / 3004 / 3000...
call :killport 3003
call :killport 3004
call :killport 3000

if not exist logs mkdir logs

REM ---- 9) Nyalakan ketiga layanan DI DALAM jendela ini ----
echo [..] Menyalakan scraper service (port 3003)...
pushd mini-services\gmaps-scraper
start "scraper" /b bun index.ts
popd

echo [..] Menyalakan wa-checker service (port 3004)...
pushd mini-services\wa-checker
start "wa-checker" /b bun index.ts
popd

echo [..] Menyalakan aplikasi Next.js (port 3000)...
start "next" /b bun run dev

echo [..] Menunggu semua layanan siap (maks ~3 menit)...
set /a tries=0
:wait
ping -n 3 127.0.0.1 >nul
set ok=1
curl -sf -m 3 http://localhost:3003/health >nul 2>&1 || set ok=0
curl -sf -m 3 http://localhost:3004/health >nul 2>&1 || set ok=0
curl -sf -m 3 http://localhost:3000 >nul 2>&1 || set ok=0
if %ok%==1 goto ready
set /a tries+=1
if %tries% lss 60 goto wait
echo [!!] Beberapa layanan belum siap - cek output di atas / folder logs.
goto running

:ready
echo.
echo [OK] Semua layanan online:
echo      - Aplikasi   : http://localhost:3000
echo      - Scraper    : http://localhost:3003
echo      - Wa-checker : http://localhost:3004

:running
echo.
echo ============================================================
echo   SEMUA LAYANAN BERJALAN DI JENDELA INI.
echo   Tutup jendela ini (klik X) untuk mematikan semuanya.
echo   (Atau jalankan stop.bat)
echo ============================================================
title MapMiner - Layanan Aktif (tutup jendela = matikan semua)

:stay
ping -n 3601 127.0.0.1 >nul
goto stay

:killport
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%1 " ^| findstr "LISTENING"') do (
    taskkill /f /t /pid %%a >nul 2>&1
)
exit /b 0
