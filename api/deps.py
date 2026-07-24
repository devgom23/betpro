"""
FastAPI 공용 의존성 - 인증 / 경로.
기존 betpro_paths.py, betpro_auth.py 를 '수정 없이' 그대로 재사용한다.
"""
import os
import sys

# 프로젝트 루트(betpro/)와 api/ 를 import 경로에 추가
_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_API_DIR)
for _p in (_ROOT, _API_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import betpro_paths as PATHS   # noqa: E402
import betpro_auth as AUTH     # noqa: E402
from fastapi import Request, HTTPException, Depends  # noqa: E402

# 자동 로그인 토큰을 담는 쿠키 이름 (React에서 쓰지 않고 서버가 관리)
COOKIE_NAME = "betpro_token"


def _extract_token(request: Request):
    """Authorization: Bearer <token> 우선, 없으면 쿠키에서 토큰을 꺼낸다."""
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE_NAME)


def get_current_user(request: Request) -> dict:
    """
    로그인 여부 검증 의존성.
    토큰 서명 통과 후에도 betpro_auth 가 DB를 다시 조회해
    계정 존재/만료/역할을 최종 판정한다(삭제·만료·비번변경 즉시 반영).
    """
    token = _extract_token(request)
    ok, info = AUTH.verify_token(PATHS.get_auth_db(), token)
    if not ok:
        raise HTTPException(status_code=401,
                            detail=info.get("msg") or "인증이 필요합니다.")
    return info   # {username, role, expiry, code, msg}


def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    """관리자 전용 엔드포인트 보호."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="관리자 전용 기능입니다.")
    return user
