@echo off
rem Octop platform entry: make sure the shell is running, that is all.
rem If the platform is ALREADY running, this does nothing and opens nothing
rem (enter from the 8200 page you already have open - never pop a new one).
rem Only when the shell is down: start it hidden, wait for ready, then open
rem http://127.0.0.1:8200/ once. The planet service (8130) is pulled up
rem automatically by the lyra-planet plugin inside Octop.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=$false; try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8200/login'|Out-Null; $u=$true}catch{}; if($u){exit}; Start-Process 'D:\WorkSpace\octop-src\start-octop.bat' -WindowStyle Hidden; for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 500; try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8200/login'|Out-Null; break}catch{}}; Start-Process 'http://127.0.0.1:8200/'"
