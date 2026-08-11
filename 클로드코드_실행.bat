@echo off
cd /d "%~dp0"

echo.
echo ============================================
echo   BETPRO 전체 실행 (백엔드 + 프론트 + 클로드 코드)
echo   작업 폴더: %~dp0
echo ============================================
echo.

echo [1/3] 백엔드(API) 서버를 새 창에서 시작합니다...
start "BETPRO 백엔드 (API)" cmd /k "%~dp0API_실행.bat"

echo [2/3] 프론트(화면) 서버를 새 창에서 시작합니다...
start "BETPRO 프론트 (화면)" cmd /k "cd /d %~dp0web && npm run dev"

echo [3/3] 이 창에서 클로드 코드를 시작합니다...
echo.

where claude >nul 2>&1
if errorlevel 1 goto noclaude

claude --continue --model sonnet
exit /b 0

:noclaude
echo.
echo [오류] claude 명령어를 찾지 못했습니다.
echo        Claude Code가 설치되어 있는지 확인해주세요.
echo.
pause
exit /b 1
