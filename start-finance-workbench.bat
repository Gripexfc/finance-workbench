@echo off
setlocal
cd /d "%~dp0"
set PORT=4180
where node >nul 2>nul
if %errorlevel%==0 (
  start "财务工作台服务" /b node local-server.mjs
  timeout /t 1 /nobreak >nul
  start "财务工作台" "http://127.0.0.1:%PORT%/"
  exit /b
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "财务工作台" "http://127.0.0.1:%PORT%/"
  py -m http.server %PORT% --bind 127.0.0.1
  exit /b
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "财务工作台服务" /b python -m http.server %PORT% --bind 127.0.0.1
  timeout /t 1 /nobreak >nul
  start "财务工作台" "http://127.0.0.1:%PORT%/"
  exit /b
)
echo 未找到 Python 3，请先安装 Python 3。
pause
