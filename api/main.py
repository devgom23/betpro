"""
BETPRO API 서버 (FastAPI) - 골격
================================================================
[역할] 검증된 분석 엔진(engine.py)과 기존 인증/경로 모듈을
       React 프론트엔드가 부를 수 있는 HTTP API로 노출한다.

[실행]  프로젝트 루트(betpro/)에서
        python -m uvicorn api.main:app --reload --port 8000
        문서 화면: http://localhost:8000/docs

[구성한 엔드포인트]
  GET  /api/health                     서버 생존 확인
  POST /api/login                      로그인 → 토큰 발급(+쿠키)
  POST /api/logout                     로그아웃(쿠키 삭제)
  GET  /api/me                         현재 로그인 상태
  GET  /api/dashboard                  스코프별 리그 업로드 현황
  GET  /api/leagues                    리그 코드/라벨 목록
  GET  /api/leagues/{code}/filters     시즌·라운드 선택지
  GET  /api/leagues/{code}             대형 분석표 데이터(시즌/라운드/배당 필터)
  GET  /api/head_to_head               두 팀 상대전적 (상세 팝업용)
  POST /api/analyze                    엔진 실시간 분석(임의 배당 1경기)
================================================================
"""
import os
import re
import sys

# 루트/‘api’ 를 import 경로에 등록 (betpro_paths, betpro_auth, engine)
_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_API_DIR)
for _p in (_ROOT, _API_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from typing import Optional  # noqa: E402
import pandas as pd  # noqa: E402
from fastapi import FastAPI, HTTPException, Depends, Response, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import betpro_paths as PATHS  # noqa: E402
import betpro_auth as AUTH    # noqa: E402
import engine                 # noqa: E402
import data_access as DATA    # noqa: E402
from deps import get_current_user, COOKIE_NAME  # noqa: E402

# React 개발 서버(Vite=5173, CRA=3000) 등 허용 오리진
ALLOWED_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
]

app = FastAPI(title="BETPRO API", version="0.1.0",
              description="BETPRO 분석 엔진을 노출하는 백엔드 API (골격)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    """부팅 시 폴더/DB 존재 보장 + 기본 관리자 생성."""
    PATHS.bootstrap()
    AUTH.ensure_default_admin(PATHS.get_auth_db())


# ─────────────────────────── 스코프 해석 ───────────────────────────
def _resolve_scope_db(scope: str, user: dict) -> str:
    """scope(master/user) → 실제 DB 경로. user 스코프는 로그인 계정 본인 DB."""
    if scope == PATHS.SCOPE_MASTER:
        return PATHS.get_master_db()
    if scope == PATHS.SCOPE_USER:
        username = user["username"]
        PATHS.ensure_user_space(username)     # 폴더/DB 없으면 생성
        return PATHS.get_user_db(username)
    raise HTTPException(status_code=400,
                        detail="scope 는 master 또는 user 여야 합니다.")


# ─────────────────────────── 헬스체크 ───────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "app": "BETPRO API", "version": app.version}


# ─────────────────────────── 인증 ───────────────────────────
class LoginBody(BaseModel):
    username: str
    password: str
    keep_login: bool = False   # '로그인 유지' 체크박스


@app.post("/api/login")
def login(body: LoginBody, response: Response):
    auth_db = PATHS.get_auth_db()
    ok, info = AUTH.verify_login(auth_db, body.username, body.password)
    if not ok:
        # 실패 사유(존재X/비번오류/만료)를 그대로 전달
        raise HTTPException(status_code=401, detail=info.get("msg", "로그인 실패"))

    token = AUTH.issue_token(auth_db, body.username)
    if not token:
        raise HTTPException(status_code=500, detail="토큰 발급에 실패했습니다.")

    # '로그인 유지' 시에만 httpOnly 쿠키로 자동로그인 토큰 저장
    if body.keep_login:
        days = AUTH.days_left(info.get("expiry"))
        max_age = int(days) * 86400 if days is not None else 400 * 86400
        response.set_cookie(
            key=COOKIE_NAME, value=token, httponly=True,
            samesite="lax", max_age=max(max_age, 0), path="/",
        )

    days = AUTH.days_left(info.get("expiry"))
    return {
        "token": token,   # React가 메모리/localStorage에 보관해 Bearer로 전송
        "user": {
            "username": body.username.strip(),
            "role": info.get("role"),
            "expiry": info.get("expiry"),
            "days_left": days,
        },
    }


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "username": user["username"],
        "role": user.get("role"),
        "expiry": user.get("expiry"),
        "days_left": AUTH.days_left(user.get("expiry")),
    }


# ─────────────────────────── 리그 목록/현황 ───────────────────────────
@app.get("/api/leagues")
def leagues():
    return [{"code": lg, "label": PATHS.LEAGUE_LABEL[lg]} for lg in PATHS.LEAGUES]


@app.get("/api/dashboard")
def dashboard(scope: str = PATHS.SCOPE_MASTER,
              user: dict = Depends(get_current_user)):
    db = _resolve_scope_db(scope, user)
    return {
        "scope": scope,
        "rows": PATHS.league_dashboard(db),
        "total_rows": PATHS.db_total_rows(db),
        "updated_at": PATHS.get_meta(db, "updated_at"),
        "can_write": PATHS.can_write(scope, user.get("role")),
    }


def _check_league(code: str):
    if code not in PATHS.VALID_LEAGUES:
        raise HTTPException(status_code=404, detail=f"알 수 없는 리그: {code}")


def _round_sort_key(v):
    # "9R"/"38R"처럼 숫자+문자 혼합 라벨은 float() 변환이 항상 실패해
    # 문자열 정렬로 빠지면 "9R" > "38R"가 되는 버그가 생긴다.
    # 라벨 안의 숫자만 뽑아 그 값으로 정렬한다(원본 betpro_ui._round_num과 동일 규칙).
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else 0


@app.get("/api/leagues/{code}/filters")
def league_filters(code: str, scope: str = PATHS.SCOPE_MASTER,
                   user: dict = Depends(get_current_user)):
    """시즌·라운드 선택지. 라운드는 시즌별로 묶어 반환."""
    _check_league(code)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df(db, code)
    if df.empty or "S" not in df.columns:
        return {"seasons": [], "rounds_by_season": {}, "latest": None}

    seasons = sorted([s for s in df["S"].dropna().unique().tolist()], reverse=True)
    rounds_by_season = {}
    for s in seasons:
        rs = df.loc[df["S"] == s, "R"].dropna().unique().tolist()
        rs = sorted(rs, key=_round_sort_key, reverse=True)
        rounds_by_season[str(s)] = [str(x) for x in rs]

    latest_season = str(seasons[0]) if seasons else None
    latest_round = (rounds_by_season.get(latest_season) or [None])[0]
    return {
        "seasons": [str(s) for s in seasons],
        "rounds_by_season": rounds_by_season,
        "latest": {"season": latest_season, "round": latest_round},
    }


ODDS_FILTER_COLS = ["KW", "KD", "KL", "KHW", "KHD", "KHL", "FW", "FD", "FL"]
ODDS_TOLERANCE = 0.005   # 원본 조회 필터와 동일한 부동소수 오차 허용


@app.get("/api/leagues/{code}")
def league_rows(code: str,
                scope: str = PATHS.SCOPE_MASTER,
                season: Optional[str] = None,   # None=최근시즌 자동, "ALL"=전체, 그외=정확히 일치
                round: Optional[str] = None,    # noqa: A002  (None/"ALL" 규칙 동일)
                kw: Optional[float] = None,
                kd: Optional[float] = None,
                kl: Optional[float] = None,
                khw: Optional[float] = None,
                khd: Optional[float] = None,
                khl: Optional[float] = None,
                fw: Optional[float] = None,
                fd: Optional[float] = None,
                fl: Optional[float] = None,
                limit: int = 500,
                offset: int = 0,
                user: dict = Depends(get_current_user)):
    """
    대형 분석표 데이터. 저장된 값을 '불러오기만' 한다(재계산 없음 — 원칙 6-3).
    season/round 미지정 시 최근 시즌·최근 라운드를 기본 선택. "ALL"이면 그 축은 필터 없음.
    배당 9종(kw~fl)을 넘기면 ±0.005 오차로 근사 일치하는 경기만 추린다(원본 조회 필터와 동일 규칙).
    """
    _check_league(code)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df(db, code)
    if df.empty:
        return {"columns": [], "rows": [], "total": 0,
                "season": None, "round": None}

    # 기본값: 최근 시즌·최근 라운드. "ALL"이면 해당 축은 필터하지 않는다.
    if season is None and "S" in df.columns and not df["S"].dropna().empty:
        season = str(sorted(df["S"].dropna().unique().tolist())[-1])
    elif season == "ALL":
        season = None

    sub = df
    if season is not None and "S" in sub.columns:
        sub = sub[sub["S"].astype(str) == str(season)]

    if round is None and "R" in sub.columns and not sub["R"].dropna().empty:
        try:
            round = str(sorted(sub["R"].dropna().unique().tolist(),
                               key=lambda x: float(x))[-1])
        except (TypeError, ValueError):
            round = str(sorted(sub["R"].dropna().astype(str).unique().tolist())[-1])
    elif round == "ALL":
        round = None

    if round is not None and "R" in sub.columns:
        sub = sub[sub["R"].astype(str) == str(round)]

    odds_query = {"KW": kw, "KD": kd, "KL": kl, "KHW": khw, "KHD": khd,
                  "KHL": khl, "FW": fw, "FD": fd, "FL": fl}
    for col in ODDS_FILTER_COLS:
        target = odds_query[col]
        if target is None or col not in sub.columns:
            continue
        series = pd.to_numeric(sub[col], errors="coerce")
        sub = sub[(series - target).abs() < ODDS_TOLERANCE]

    total = len(sub)
    page = sub.iloc[offset: offset + limit]
    return {
        "columns": list(df.columns),
        "rows": DATA.df_to_records(page),
        "total": total,
        "season": season,
        "round": round,
        "can_write": PATHS.can_write(scope, user.get("role")),
    }


# ─────────────────────────── 상대전적 (상세 팝업용) ───────────────────────────
RT_LABELS = {1: "핸승", 2: "핸무", 3: "무", 4: "역"}


def _rt_label(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
        return RT_LABELS.get(int(float(v)))
    except (TypeError, ValueError):
        return None


@app.get("/api/head_to_head")
def head_to_head(scope: str = PATHS.SCOPE_MASTER,
                 home: str = "",
                 away: str = "",
                 limit: int = 15,
                 user: dict = Depends(get_current_user)):
    """
    두 팀의 과거 맞대결 기록(betpro_ui._head_to_head 이식).
    결과(RT)는 '각 경기의 홈팀 기준' — 지금 보고 있는 경기의 홈팀 관점으로
    재해석하지 않는다(원본과 동일한 주의사항).
    """
    db = _resolve_scope_db(scope, user)
    total_df = DATA.load_total_df(db)

    ht, at = str(home).strip(), str(away).strip()
    empty = {"summary": None, "matches": [], "total": 0}
    if total_df.empty or "HT" not in total_df.columns or "AT" not in total_df.columns:
        return empty

    h = total_df["HT"].astype(str).str.strip()
    a = total_df["AT"].astype(str).str.strip()
    m = total_df[((h == ht) & (a == at)) | ((h == at) & (a == ht))].copy()
    if m.empty:
        return empty

    m["_r_num"] = m["R"].map(_round_sort_key) if "R" in m.columns else 0
    sort_cols = [c for c in ["S", "_r_num"] if c in m.columns or c == "_r_num"]
    m = m.sort_values(sort_cols, ascending=False).drop(columns=["_r_num"])

    summary = {"핸승": 0, "핸무": 0, "무": 0, "역": 0}
    for v in m.get("RT", []):
        lab = _rt_label(v)
        if lab in summary:
            summary[lab] += 1
    summary["총"] = int(sum(summary.values()))

    cols = [c for c in ["S", "R", "DT", "HT", "HS", "AS", "AT", "RT", "FW", "FD", "FL"]
            if c in m.columns]
    out = m[cols].head(limit).copy()
    if "RT" in out.columns:
        out["RT_label"] = out["RT"].map(_rt_label)

    return {
        "summary": summary,
        "matches": DATA.df_to_records(out),
        "total": len(m),
    }


# ─────────────────────────── 엔진 실시간 분석 ───────────────────────────
class AnalyzeBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    league: str                       # 개별지표 기준 리그(EPL 등)
    row: dict                         # {HT,AT,FW,FD,FL,FHW,KW,KD,KL,KHW,RT?...}


@app.post("/api/analyze")
def analyze(body: AnalyzeBody, user: dict = Depends(get_current_user)):
    """
    임의 배당 1경기를 엔진으로 즉시 분석 → 26개 지표 + 플핸 예측 반환.
    개별지표는 해당 리그 DB, 통합(TF-/TK-)지표는 스코프 통합DB 기준.
    """
    _check_league(body.league)
    db = _resolve_scope_db(body.scope, user)
    league_df = DATA.load_league_df(db, body.league)
    total_df = DATA.load_total_df(db)
    if league_df.empty:
        raise HTTPException(status_code=400,
                            detail=f"{body.league} 데이터가 비어 있습니다.")

    row = pd.Series(body.row)
    result = engine.analyze_row(row, league_df, total_df)  # 캐시는 내부 생성
    return {"result": DATA.series_to_dict(result)}
