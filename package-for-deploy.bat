@echo off
setlocal enabledelayedexpansion

:: ============================================
:: SPECTRA VISION - Package for Deployment
:: Crea cartella pronta per Docker su altro PC
:: ============================================

echo.
echo  ==========================================
echo   SPECTRA // VISION - Packager
echo  ==========================================
echo.

:: Set output folder name
set "OUTPUT_DIR=spectra-vision-deploy"
set "SCRIPT_DIR=%~dp0"

:: Remove old package if exists
if exist "%OUTPUT_DIR%" (
    echo [!] Rimuovo vecchio pacchetto...
    rmdir /s /q "%OUTPUT_DIR%"
)

:: Create output directory
echo [1/6] Creo cartella %OUTPUT_DIR%...
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\src"
mkdir "%OUTPUT_DIR%\public"
mkdir "%OUTPUT_DIR%\data"
mkdir "%OUTPUT_DIR%\data\snapshots"
mkdir "%OUTPUT_DIR%\data\recordings"

:: Copy core files
echo [2/6] Copio file core...
copy "%SCRIPT_DIR%server.js" "%OUTPUT_DIR%\" >nul
copy "%SCRIPT_DIR%package.json" "%OUTPUT_DIR%\" >nul
copy "%SCRIPT_DIR%package-lock.json" "%OUTPUT_DIR%\" >nul 2>nul

:: Copy Docker files
echo [3/6] Copio configurazione Docker...
copy "%SCRIPT_DIR%Dockerfile" "%OUTPUT_DIR%\" >nul
copy "%SCRIPT_DIR%docker-compose.yml" "%OUTPUT_DIR%\" >nul
copy "%SCRIPT_DIR%.dockerignore" "%OUTPUT_DIR%\" >nul

:: Copy src folder
echo [4/6] Copio moduli src...
xcopy "%SCRIPT_DIR%src\*" "%OUTPUT_DIR%\src\" /E /Q >nul

:: Copy public folder (excluding snapshots and recordings)
echo [5/6] Copio frontend public...
xcopy "%SCRIPT_DIR%public\*" "%OUTPUT_DIR%\public\" /E /Q /EXCLUDE:%SCRIPT_DIR%.dockerignore >nul 2>nul
if errorlevel 1 (
    xcopy "%SCRIPT_DIR%public\*" "%OUTPUT_DIR%\public\" /E /Q >nul
)

:: Copy personal .env file (THE KEY PART!)
echo [6/6] Copio file .env personale...
if exist "%SCRIPT_DIR%.env" (
    copy "%SCRIPT_DIR%.env" "%OUTPUT_DIR%\" >nul
    echo [OK] File .env copiato!
) else (
    echo [!] ATTENZIONE: .env non trovato!
    echo     Dovrai crearlo manualmente nella cartella di destinazione.
    copy "%SCRIPT_DIR%.env.example" "%OUTPUT_DIR%\.env.example" >nul 2>nul
)

:: Create deploy script inside package
echo @echo off > "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo. >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo  ======================================== >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo   SPECTRA // VISION - Avvio Docker >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo  ======================================== >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo. >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo docker --version ^>nul 2^>^&1 >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo if errorlevel 1 ( >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo     echo [ERRORE] Docker non trovato! Installa Docker Desktop. >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo     pause >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo     exit /b 1 >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo ) >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo [OK] Docker rilevato >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo. >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo Avvio build e deploy... >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo docker-compose up -d --build >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo. >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo ======================================== >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo   APP DISPONIBILE: http://localhost:3005 >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo ======================================== >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo echo. >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"
echo pause >> "%OUTPUT_DIR%\AVVIA-DOCKER.bat"

echo.
echo  ==========================================
echo   PACCHETTO CREATO CON SUCCESSO!
echo  ==========================================
echo.
echo  Cartella: %OUTPUT_DIR%
echo.
echo  Contenuto:
echo    - Tutti i file del progetto
echo    - File .env con il tuo token personale
echo    - AVVIA-DOCKER.bat per il deploy
echo.
echo  ISTRUZIONI:
echo    1. Copia la cartella "%OUTPUT_DIR%" sul nuovo PC
echo    2. Assicurati che Docker Desktop sia installato
echo    3. Doppio click su "AVVIA-DOCKER.bat"
echo.
pause
