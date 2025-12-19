@echo off
setlocal enabledelayedexpansion

:: ================================
:: SPECTRA VISION - Docker Deploy
:: Sci-Fi Ring Doorbell Interface
:: ================================

echo.
echo  ========================================
echo   SPECTRA // VISION - Docker Installer
echo  ========================================
echo.

:: Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker non trovato!
    echo Installa Docker Desktop da: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker non e' in esecuzione!
    echo Avvia Docker Desktop e riprova.
    pause
    exit /b 1
)

echo [OK] Docker rilevato e in esecuzione
echo.

:: Check for .env file
if not exist ".env" (
    echo [!] File .env non trovato!
    echo.
    echo Creando .env da .env.example...
    
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] File .env creato
        echo.
        echo ==========================================
        echo  IMPORTANTE: Configura il file .env
        echo ==========================================
        echo.
        echo 1. Apri il file .env con un editor
        echo 2. Inserisci il tuo RING_REFRESH_TOKEN
        echo    ^(Esegui: npx -p ring-client-api ring-auth-cli^)
        echo 3. Salva e riavvia questo script
        echo.
        notepad .env
        pause
        exit /b 0
    ) else (
        echo [ERROR] Anche .env.example non trovato!
        pause
        exit /b 1
    )
)

echo [OK] File .env trovato
echo.

:: Create data directories
if not exist "data\snapshots" mkdir "data\snapshots"
if not exist "data\recordings" mkdir "data\recordings"
echo [OK] Directory dati create

echo.
echo Avvio build e deploy Docker...
echo.

:: Build and start with Docker Compose
docker-compose up -d --build

if errorlevel 1 (
    echo.
    echo [ERROR] Errore durante il deploy!
    pause
    exit /b 1
)

echo.
echo  ========================================
echo   DEPLOY COMPLETATO CON SUCCESSO!
echo  ========================================
echo.
echo  App disponibile su: http://localhost:3005
echo.
echo  Comandi utili:
echo    docker-compose logs -f     ^(vedi log^)
echo    docker-compose stop        ^(ferma^)
echo    docker-compose start       ^(riavvia^)
echo    docker-compose down        ^(rimuovi^)
echo.
pause
