@echo off
title MapMiner - Hentikan Layanan
echo Menghentikan layanan MapMiner...

REM PENTING: matikan watchdog dulu, kalau tidak ia akan menyalakan ulang
REM layanan dalam 30 detik (itu tugasnya).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'watchdog\.mjs|watchdog-start\.vbs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM Hentikan proses yang mendengarkan di port 3003 (scraper), 3004 (verifikasi WA) dan 3000 (Next.js)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3003 " ^| findstr "LISTENING"') do (
    echo [..] Menghentikan scraper (PID %%a^)...
    taskkill /f /t /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3004 " ^| findstr "LISTENING"') do (
    echo [..] Menghentikan verifikasi WhatsApp (PID %%a^)...
    taskkill /f /t /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo [..] Menghentikan Next.js (PID %%a^)...
    taskkill /f /t /pid %%a >nul 2>&1
)

echo [OK] Semua layanan MapMiner dihentikan.
echo      Untuk menyalakan lagi: jalankan start.bat
echo      (layanan hanya hidup selama jendelanya terbuka).
timeout /t 2 /nobreak >nul
