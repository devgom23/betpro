@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv" (
    call .venv\Scripts\activate.bat
)
echo.
echo ============================================
echo   BETPRO API 서버 (FastAPI) 시작
echo   API 주소   : http://localhost:8000
echo   문서 화면  : http://localhost:8000/docs
echo   (종료: 이 창에서 Ctrl + C)
echo ============================================
echo.
python -m uvicorn api.main:app --reload --port 8000
pause
