@echo off
rem Stops the Nexvra HRMS servers started by start-hrms.bat (backend :8000, frontend :3000).
setlocal
echo Stopping Nexvra HRMS...
for %%P in (8000 3000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    taskkill /pid %%I /t /f >nul 2>&1
  )
)
taskkill /fi "WINDOWTITLE eq Nexvra HRMS - Backend*" /t /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Nexvra HRMS - Frontend*" /t /f >nul 2>&1
echo Done.
ping -n 3 127.0.0.1 >nul
