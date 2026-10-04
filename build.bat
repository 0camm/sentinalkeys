@echo off
REM Run on Windows with Python 3.10+ installed. Put this next to Sentinel.py.
python -m pip install -r requirements.txt || exit /b 1
python -m PyInstaller --onefile --noconsole --clean --name Sentinel --collect-all customtkinter Sentinel.py || exit /b 1
powershell -Command "Get-FileHash dist\Sentinel.exe -Algorithm SHA256 | Format-List"
echo.
echo Optional: python update_index.py dist\Sentinel.exe index.html
