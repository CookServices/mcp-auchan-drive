@echo off
REM Lanceur du canari pour le Planificateur de taches Windows.
REM Fichier volontairement en ASCII + CRLF : cmd.exe parse mal l'UTF-8 accentue.
REM Chemins relatifs au depot : la tache reste valide si le dossier est deplace.
setlocal enabledelayedexpansion

cd /d "%~dp0.."
set AUCHAN_BROWSER=firefox

echo. >> canary-task.log
echo ===== %DATE% %TIME% ===== >> canary-task.log
call npm run canary >> canary-task.log 2>&1
set RESULT=%errorlevel%

if "%RESULT%"=="0" exit /b 0

REM Echec : notifier. Le resume vient de la derniere ligne de canary.log, que le
REM canari ecrit avant de sortir. S'il a plante avant, message generique.
set "SUMMARY="
for /f "usebackq delims=" %%L in (`powershell -NoProfile -Command "if (Test-Path canary.log) { (Get-Content canary.log -Tail 1) -replace '^\S+\s+', '' }"`) do set "SUMMARY=%%L"
echo !SUMMARY! | findstr /b /c:"ECHEC" >nul || set "SUMMARY=Le canari a echoue (code %RESULT%)."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0notify.ps1" -Message "!SUMMARY!"

exit /b %RESULT%
