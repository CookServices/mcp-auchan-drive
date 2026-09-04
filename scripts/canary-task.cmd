@echo off
REM Lanceur du canari pour le Planificateur de tâches Windows.
REM Chemins relatifs au dépôt : la tâche reste valide si le dossier est déplacé.
cd /d "%~dp0.."
set AUCHAN_BROWSER=firefox
echo. >> canary-task.log
echo ===== %DATE% %TIME% ===== >> canary-task.log
call npm run canary >> canary-task.log 2>&1
exit /b %errorlevel%
