@echo off
rem ============================================================
rem  Nexvra HRMS - start everything in the right order:
rem  1) backend API (port 8000)  2) frontend app (port 3000)
rem  then open http://localhost:3000 in the browser.
rem ============================================================
setlocal
title Nexvra HRMS launcher
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" goto no_venv
if not exist "frontend\node_modules" goto install_frontend
:after_install

rem ---------- backend ----------
curl -s -o nul -f http://127.0.0.1:8000/api/health/
if not errorlevel 1 goto backend_running
echo Starting the backend on http://127.0.0.1:8000 ...
start "Nexvra HRMS - Backend" /d "%~dp0backend" cmd /k ".venv\Scripts\python manage.py runserver 127.0.0.1:8000"
goto wait_backend_start
:backend_running
echo Backend is already running.

:wait_backend_start
echo Waiting for the backend to be ready...
set /a tries=0
:wait_backend
curl -s -o nul -f http://127.0.0.1:8000/api/health/
if not errorlevel 1 goto backend_ready
set /a tries+=1
if %tries% geq 60 goto backend_failed
ping -n 2 127.0.0.1 >nul
goto wait_backend
:backend_ready
echo Backend is ready.

rem ---------- frontend ----------
if not exist "frontend\.next\BUILD_ID" goto build_frontend
:after_build
curl -s -o nul -f http://127.0.0.1:3000/login
if not errorlevel 1 goto frontend_running
echo Starting the frontend on http://localhost:3000 ...
start "Nexvra HRMS - Frontend" /d "%~dp0frontend" cmd /k "npm start"
goto wait_frontend_start
:frontend_running
echo Frontend is already running.

:wait_frontend_start
set /a tries=0
:wait_frontend
curl -s -o nul -f http://127.0.0.1:3000/login
if not errorlevel 1 goto all_ready
set /a tries+=1
if %tries% geq 90 goto frontend_failed
ping -n 2 127.0.0.1 >nul
goto wait_frontend

:all_ready
start "" http://localhost:3000
echo.
echo  Nexvra HRMS is running:  http://localhost:3000
echo  To stop it, run stop-hrms.bat or close the two server windows.
echo.
ping -n 6 127.0.0.1 >nul
exit /b 0

rem ---------- helpers / errors ----------
:install_frontend
echo Installing frontend packages - first run only...
pushd frontend
call npm install
popd
goto after_install

:build_frontend
echo Building the frontend - first run only, about one minute...
pushd frontend
call npm run build
if errorlevel 1 goto build_failed
popd
goto after_build

:no_venv
echo [ERROR] backend\.venv was not found. Follow docs\setup.md to install the backend first.
pause
exit /b 1

:backend_failed
echo [ERROR] The backend did not start within 60 seconds.
echo         Check the "Nexvra HRMS - Backend" window for the error.
echo         Most common cause: PostgreSQL is not running (Windows service "postgresql-x64-16").
pause
exit /b 1

:build_failed
popd
echo [ERROR] The frontend build failed. See the messages above.
pause
exit /b 1

:frontend_failed
echo [ERROR] The frontend did not start within 90 seconds.
echo         Check the "Nexvra HRMS - Frontend" window for the error.
pause
exit /b 1
