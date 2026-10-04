@echo off
setlocal
cd /d "%~dp0"

echo Installing requirements...
py -3 -m pip install --upgrade pip
py -3 -m pip install customtkinter psutil pyinstaller
if errorlevel 1 (
  echo Failed to install requirements. Make sure Python 3.10+ is installed and "py" works.
  pause
  exit /b 1
)

echo Building Sentinel.exe...
py -3 -m PyInstaller --noconfirm --onefile --windowed --uac-admin ^
  --name Sentinel --collect-all customtkinter Sentinel.py
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Done! Your exe is at: dist\Sentinel.exe
pause
