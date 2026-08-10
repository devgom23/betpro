@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ============================================
echo   BETPRO 클로드 코드 시작
echo   작업 폴더: %~dp0
echo ============================================
echo.

where claude >nul 2>&1
if errorlevel 1 goto noclaude

claude
exit /b 0

:noclaude
echo.
echo [오류] claude 명령어를 찾지 못했습니다.
echo        Claude Code가 설치되어 있는지 확인해주세요.
echo.
pause
exit /b 1
