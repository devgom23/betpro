@echo off
cd /d "%~dp0"

REM Pick a python that actually has uvicorn.
REM The .venv here may be half-built (no uvicorn), which used to make the
REM server fail to start with "No module named uvicorn".
set "PY="

if not exist ".venv\Scripts\python.exe" goto trysystem
".venv\Scripts\python.exe" -c "import uvicorn" >nul 2>&1
if errorlevel 1 goto trysystem
set "PY=.venv\Scripts\python.exe"
goto run

:trysystem
python -c "import uvicorn" >nul 2>&1
if errorlevel 1 goto nopython
set "PY=python"

:run
echo.
echo ============================================
echo   BETPRO API 서버 (FastAPI) 시작
echo   API 주소  : http://localhost:8000
echo   문서 화면 : http://localhost:8000/docs
echo   (종료: 이 창에서 Ctrl + C)
echo ============================================
echo.
%PY% -m uvicorn api.main:app --reload --port 8000
pause
exit /b 0

:nopython
echo.
echo [오류] uvicorn 이 설치된 파이썬을 찾지 못했습니다.
echo        아래 명령으로 설치한 뒤 다시 실행해 주세요.
echo.
echo        pip install -r requirements.txt
echo.
pause
exit /b 1
