@echo off
cd /d "%~dp0"
python -c "import flask, matplotlib" >nul 2>&1 || python -m pip install -r requirements.txt
python -m src.main serve
pause
