@echo off
cd /d "%~dp0"
if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)
echo.
echo ============================================
echo   WEB_BET PRO V1.0 - Starting server
echo   Local  : http://localhost:8501
echo   ID     : admin
echo   PW     : betpro-admin-2026
echo ============================================
echo.
streamlit run WEB_BET_PRO.py --server.port 8501 --server.address 0.0.0.0
pause
