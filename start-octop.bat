@echo off
rem Start the open-source Octop platform (the shell of the planet project).
rem Dashboard: http://127.0.0.1:8200/  (admin login)
rem The planet service on 8130 is pulled up automatically by the
rem lyra-planet plugin inside Octop. Do NOT start it separately.
rem Stop: taskkill /IM octop.exe /F   Disable autostart: delete
rem   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\octop-autostart.vbs
cd /d D:\WorkSpace\octop-src
".venv\Scripts\octop.exe" run --host 127.0.0.1 --port 8200 >> "%USERPROFILE%\.octop\logs\octop-stdout.log" 2>&1
