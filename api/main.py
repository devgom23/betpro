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
  GET  /api/head_to_head               두 팀 상대전적 (상세 팝업/상대전적 탭 공용)
  POST /api/pick_ai                    종합픽 (상세 팝업 — 배당/지표/상대전적/흐름 요약)
  GET  /api/leagues/{code}/match_excel 상세보기 팝업 내용 엑셀(1시트) 다운로드
  GET  /api/leagues/{code}/table_excel 현재 조회된 분석표 엑셀 다운로드
  GET  /api/leagues/{code}/upload_template  경기 업로드용 빈 표본 양식 (쓰기 권한 필요)
  POST /api/leagues/{code}/upload      경기 엑셀 업로드 (쓰기 권한 필요, confirm 2단계)
  POST /api/leagues/{code}/delete_matches  선택한 시즌/라운드 경기만 삭제 (쓰기 권한 필요)
  POST /api/leagues/{code}/my_picks    내 예측(중요 별표/내픽) 저장 — 계정 개인 기록
  GET  /api/teams                      전체 팀명 목록 (상대전적 탭)
  GET  /api/total                      통합DB(6대 리그 합산) 조회
  POST /api/recompute/pending          예정 경기만 최신 통합DB 기준 재계산
  POST /api/recompute/all              전체(과거 포함) 재계산 — confirm 필수
  POST /api/analyze                    엔진 실시간 분석(임의 배당 1경기)

  ── 관리자 전용 (role=admin) ──
  GET  /api/admin/master/status        master.db 현황 + 백업 목록
  POST /api/admin/master/backup        지금 백업
  POST /api/admin/master/restore       백업 롤백
  POST /api/admin/master/delete_league 리그 테이블 삭제(자동 백업 후)
  GET  /api/admin/users                계정 목록
  POST /api/admin/users                계정 추가
  POST /api/admin/users/{u}/expiry     이용기간(종료일) 변경
  POST /api/admin/users/{u}/start_date 이용시작일 변경
  POST /api/admin/users/{u}/password   비밀번호 변경
  DELETE /api/admin/users/{u}          계정 삭제(본인 불가)
  GET  /api/admin/customer_data        고객 업로드 현황
  GET  /api/admin/customer_data/{u}/leagues   해당 고객의 데이터 보유 리그
  GET  /api/admin/customer_data/{u}/{league}  고객 원본 열람(읽기전용, 로그 기록)
  GET  /api/admin/access_log           열람 기록
================================================================
"""
import io
import os
import re
import sqlite3
import sys
from datetime import date, timedelta
from urllib.parse import quote

# 루트/‘api’ 를 import 경로에 등록 (betpro_paths, betpro_auth, engine)
_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_API_DIR)
for _p in (_ROOT, _API_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from typing import Optional, Union  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from fastapi import (FastAPI, HTTPException, Depends, Response, Request,  # noqa: E402
                     UploadFile, File, Form)
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import betpro_paths as PATHS  # noqa: E402
import betpro_auth as AUTH    # noqa: E402
import engine                 # noqa: E402
import data_access as DATA    # noqa: E402
import match_excel as XLS     # noqa: E402
import user_leagues as USERLG  # noqa: E402
import crawler as CRAWL        # noqa: E402
import kr_crawler as KRCRAWL   # noqa: E402
import my_picks as MYPICKS     # noqa: E402
import bet_slips as BETSLIPS   # noqa: E402
import ev_model as EVM         # noqa: E402
import pick_ai as PICKAI       # noqa: E402
from deps import get_current_user, get_admin_user, COOKIE_NAME  # noqa: E402

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
    _warm_master_cache_async()


def _warm_master_cache_async():
    """공식 데이터(6개 리그)를 서버 시작 직후 백그라운드에서 미리 읽어 캐시에 올려둔다.
    data_access의 mtime 캐시는 "누군가 그 리그를 요청한 시점"에 처음 채워지는데,
    베팅내역 화면은 여러 리그를 한꺼번에 훑어야 해서(다리마다 소속 리그가 다를 수 있음)
    서버를 막 켰을 때 처음 열면 리그 6개를 그 자리에서 전부 디스크에서 읽느라
    몇 초씩 걸렸다(실측 7초대) — 로그인·다른 화면 조회 중에는 이 지연이 안 보이게
    별도 스레드로 미리 데워둔다. 실패해도(파일 없음 등) 서버 기동에는 영향 없다."""
    import threading

    def _warm():
        try:
            db_path = PATHS.get_master_db()
            for lg in DATA.LEAGUES:
                DATA.load_league_df(db_path, lg)
        except Exception:
            pass

    threading.Thread(target=_warm, daemon=True).start()


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
            "start_date": info.get("start_date") or "",
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
        "start_date": user.get("start_date") or "",
        "days_left": AUTH.days_left(user.get("expiry")),
    }


# ─────────────────────────── 리그 목록/현황 ───────────────────────────
@app.get("/api/leagues")
def leagues(scope: str = PATHS.SCOPE_MASTER,
            user: dict = Depends(get_current_user)):
    """
    탭에 띄울 리그 목록.
      master → 고정 6대리그
      user   → 그 계정이 직접 만든 리그(없으면 빈 목록 → 화면에서 '리그 생성' 안내)
    """
    if scope == PATHS.SCOPE_USER:
        return USERLG.list_leagues(_resolve_scope_db(scope, user))
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
    """공식 데이터(master) 전용 검증 — 고정 6대리그만 통과."""
    if code not in PATHS.VALID_LEAGUES:
        raise HTTPException(status_code=404, detail=f"알 수 없는 리그: {code}")


def _check_league_for(code: str, scope: str, user: dict):
    """
    스코프에 맞는 리그인지 검증한다.
      master → 고정 6대리그
      user   → 로그인 계정이 만든 리그만 (남의 계정 코드를 넣어도 통과 못 함 —
               검증 대상 DB 자체가 _resolve_scope_db()로 본인 것으로 고정되기 때문)
    """
    if scope == PATHS.SCOPE_USER:
        if code not in USERLG.valid_codes(_resolve_scope_db(scope, user)):
            raise HTTPException(status_code=404, detail=f"알 수 없는 리그: {code}")
        return
    _check_league(code)


def _is_user_scope(scope: str) -> bool:
    return scope == PATHS.SCOPE_USER


# ─────────────────────────── 내 데이터: 사용자 정의 리그 ───────────────────────────
class UserLeagueBody(BaseModel):
    label: str


class UserLeagueDeleteBody(BaseModel):
    confirm: bool = False


def _user_db_of(user: dict) -> str:
    return _resolve_scope_db(PATHS.SCOPE_USER, user)


@app.get("/api/user_leagues")
def user_leagues_list(user: dict = Depends(get_current_user)):
    return {"leagues": USERLG.list_leagues(_user_db_of(user))}


@app.post("/api/user_leagues")
def user_leagues_create(body: UserLeagueBody, user: dict = Depends(get_current_user)):
    """리그를 만든다. 이 시점엔 등록부에만 올라가고, 경기 테이블은 첫 업로드 때 생긴다."""
    try:
        return USERLG.create_league(_user_db_of(user), body.label)
    except USERLG.UserLeagueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/user_leagues/{code}/rename")
def user_leagues_rename(code: str, body: UserLeagueBody,
                        user: dict = Depends(get_current_user)):
    """이름만 바꾼다 — 경기 데이터·지표·예측은 전혀 건드리지 않는다."""
    try:
        return USERLG.rename_league(_user_db_of(user), code, body.label)
    except USERLG.UserLeagueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/user_leagues/{code}/delete")
def user_leagues_delete(code: str, body: UserLeagueDeleteBody,
                        user: dict = Depends(get_current_user)):
    """리그와 그 안의 경기 데이터를 모두 지운다(되돌릴 수 없음)."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    try:
        return USERLG.delete_league(_user_db_of(user), code)
    except USERLG.UserLeagueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _rt_summary(df: pd.DataFrame):
    """RT 결과분포 {핸승,핸무,무,역,총} 계산. RT 컬럼이 없거나 값이 없으면 None.
    5(취소)는 실제 결과가 아니라서 제외 — 안 그러면 "총"이 4개 항목 합계보다 커진다."""
    if "RT" not in df.columns:
        return None
    rt = pd.to_numeric(df["RT"], errors="coerce")
    rt = rt[rt.isin([1, 2, 3, 4])]
    if not len(rt):
        return None
    return {
        "핸승": int((rt == 1).sum()), "핸무": int((rt == 2).sum()),
        "무": int((rt == 3).sum()), "역": int((rt == 4).sum()),
        "총": int(len(rt)),
    }


def _hit_summary(df: pd.DataFrame):
    """PICK 적중/보험/미적/관망 카운트 {적중,보험,미적,관망,총}.
    PH_STATUS 컬럼 없거나 값이 하나도 없으면 None."""
    if "PH_STATUS" not in df.columns:
        return None
    s = df["PH_STATUS"].fillna("")
    counts = {"적중": int((s == "적중").sum()), "보험": int((s == "보험").sum()),
              "미적": int((s == "미적").sum()), "관망": int((s == "관망").sum())}
    total = counts["적중"] + counts["보험"] + counts["미적"] + counts["관망"]
    if total == 0:
        return None
    counts["총"] = total
    return counts


def _round_sort_key(v):
    # "9R"/"38R"처럼 숫자+문자 혼합 라벨은 float() 변환이 항상 실패해
    # 문자열 정렬로 빠지면 "9R" > "38R"가 되는 버그가 생긴다.
    # 라벨 안의 숫자만 뽑아 그 값으로 정렬한다(원본 betpro_ui._round_num과 동일 규칙).
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else 0


@app.get("/api/leagues/{code}/filters")
def league_filters(code: str, scope: str = PATHS.SCOPE_MASTER,
                   user: dict = Depends(get_current_user)):
    """
    시즌·라운드 선택지 + 리그 전체 현황(등록 시즌수/전체 경기수/RT분포).
    라운드는 시즌별로 묶어 반환. 탭 바로 아래 "리그 전체 대시보드"에 쓰인다.
    """
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df_ranked(db, code)   # 적중/미적 집계에 PH_STATUS 필요
    if df.empty or "S" not in df.columns:
        return {"seasons": [], "rounds_by_season": {}, "latest": None,
                "total_rows": 0, "rt_summary": None, "hit_summary": None}

    seasons = sorted([s for s in df["S"].dropna().unique().tolist()], reverse=True)
    rounds_by_season = {}
    for s in seasons:
        rs = df.loc[df["S"] == s, "R"].dropna().unique().tolist()
        rs = sorted(rs, key=_round_sort_key, reverse=True)
        rounds_by_season[str(s)] = [str(x) for x in rs]

    latest_season = str(seasons[0]) if seasons else None
    latest_round = (rounds_by_season.get(latest_season) or [None])[0]
    rt_summary = _rt_summary(df)
    rt_total = rt_summary["총"] if rt_summary else 0
    return {
        "seasons": [str(s) for s in seasons],
        "rounds_by_season": rounds_by_season,
        "latest": {"season": latest_season, "round": latest_round},
        "total_rows": len(df),
        "rt_summary": rt_summary,
        "hit_summary": _hit_summary(df),
        # 리그 관리 박스(내 데이터 재계산 버튼 옆)에 쓰는 요약 — 통합DB 탭 대시보드 표와 같은 항목.
        "season_range": f"{seasons[-1]} ~ {seasons[0]}" if seasons else "-",
        "pending_count": len(df) - rt_total,
        "kw_count": int(df["KW"].notna().sum()) if "KW" in df.columns else 0,
        "fw_count": int(df["FW"].notna().sum()) if "FW" in df.columns else 0,
    }


ODDS_FILTER_COLS = ["KW", "KD", "KL", "KHW", "KHD", "KHL", "FW", "FD", "FL"]
ODDS_TOLERANCE = 0.005   # 원본 조회 필터와 동일한 부동소수 오차 허용


def _apply_league_filters(df, season, round, odds_query):
    """
    분석표 조회 필터(시즌·라운드·배당 9종)를 적용한다.
    화면 표시와 엑셀 다운로드가 반드시 같은 결과를 내도록 두 곳이 공유한다.
    반환: (걸러진 DataFrame, 실제 적용된 season, 실제 적용된 round)
    """
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

    for col in ODDS_FILTER_COLS:
        target = odds_query.get(col)
        if target is None or col not in sub.columns:
            continue
        series = pd.to_numeric(sub[col], errors="coerce")
        sub = sub[(series - target).abs() < ODDS_TOLERANCE]

    return sub, season, round


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
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df_ranked(db, code)   # 표시용 순위(HP/AP) 포함
    # 베팅 기대수익률(EV) 컬럼을 붙인다. 저장하지 않고 조회할 때마다 계산한다 —
    # 확률 추정에 그 리그의 과거 경기 전체를 쓰므로 경기가 쌓이면 값도 같이 갱신된다.
    df = EVM.attach_for_league(df)
    if df.empty:
        # 데이터가 아직 없어도 can_write는 반드시 내려줘야 한다.
        # 이게 빠지면 "비어 있는 리그에 업로드" UI가 사라져 첫 등록 자체가 막힌다.
        return {"columns": [], "rows": [], "total": 0,
                "season": None, "round": None, "rt_summary": None, "hit_summary": None,
                "can_write": PATHS.can_write(scope, user.get("role"))}

    sub, season, round = _apply_league_filters(
        df, season, round,
        {"KW": kw, "KD": kd, "KL": kl, "KHW": khw, "KHD": khd,
         "KHL": khl, "FW": fw, "FD": fd, "FL": fl})

    total = len(sub)
    page = sub.iloc[offset: offset + limit]
    records = DATA.df_to_records(page)
    _attach_my_picks(records, user["username"], code, scope)
    return {
        "columns": list(df.columns) + ["IMPORTANT", "MY_PICK", "MY_HIT"],
        "rows": records,
        "total": total,
        "season": season,
        "round": round,
        "rt_summary": _rt_summary(sub),
        "hit_summary": _hit_summary(sub),
        "can_write": PATHS.can_write(scope, user.get("role")),
    }


# ───────────────── 시즌 지표 (똥배 격자 / 결과 격자 / 라운드 이력) ─────────────────
# 조회 조건이 "시즌 1개 + 라운드 1개"로 좁혀졌을 때만 만든다(사용자 지정) — 전체 조회에서는
# 라운드 축 자체가 의미가 없어 계산하지 않는다.
DDONG_MAX = 1.49          # 똥배 기준: 국내배당(KW/KL) 중 낮은 쪽이 이 값 이하 (표 컬럼과 동일 규칙)
_RT_MAIN = (1, 2, 3, 4)   # 취소(5)·결과없음은 어느 표에서도 세지 않는다


def _num_col(df: pd.DataFrame, name: str) -> pd.Series:
    """숫자 컬럼을 안전하게 꺼낸다 — 아예 없는 컬럼이면 전부 NaN인 열로 취급."""
    if name not in df.columns:
        return pd.Series(np.nan, index=df.index, dtype="float64")
    return pd.to_numeric(df[name], errors="coerce")


def _ddong_odds(df: pd.DataFrame) -> pd.Series:
    """행별 똥배 배당값(국내 KW/KL 중 낮은 쪽). 똥배가 아니면 NaN."""
    low = pd.concat([_num_col(df, "KW"), _num_col(df, "KL")], axis=1).min(axis=1)
    return low.where(low <= DDONG_MAX)


def _r2(v) -> float:
    """배당값을 소수 2자리로 맞춘다(값끼리 같은지 비교해야 해서 표기를 통일)."""
    return float(f"{float(v):.2f}")


def _score_int(v):
    return None if v is None or pd.isna(v) else int(float(v))


def _pct(n: int, total: int) -> int:
    return int(n / total * 100 + 0.5) if total else 0


@app.get("/api/leagues/{code}/season_stats")
def season_stats(code: str,
                 scope: str = PATHS.SCOPE_MASTER,
                 season: Optional[str] = None,
                 round: Optional[str] = None,   # noqa: A002
                 user: dict = Depends(get_current_user)):
    """
    조회 중인 '시즌 1개 + 라운드 1개' 기준 지표 3종.
      ① 똥배 격자   그 시즌 똥배 경기를 (결과 4줄 × 라운드) 격자에 배당값으로 배치
      ② 결과 격자   그 시즌 전 경기를 같은 격자에 개수로 배치 + 라운드별 정(핸승+핸무)/플(무+역)
      ③ 라운드 이력 같은 라운드를 과거 시즌까지 훑어 결과 분포 + 그 라운드 똥배 목록
    시즌·라운드 중 하나라도 '전체'면 available=false만 돌려준다(계산 안 함).
    """
    _check_league_for(code, scope, user)
    if not season or season == "ALL" or not round or round == "ALL":
        return {"available": False}

    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df(db, code)
    if df.empty or "S" not in df.columns or "R" not in df.columns:
        return {"available": False}

    df = df.copy()
    df["_S"] = df["S"].astype(str)
    df["_R"] = df["R"].astype(str)
    df["_rt"] = _num_col(df, "RT")
    df["_dd"] = _ddong_odds(df)

    cur = df[df["_S"] == str(season)]
    if cur.empty:
        return {"available": False}

    rounds = sorted(cur["_R"].dropna().unique().tolist(), key=_round_sort_key)

    # ① 똥배 격자 — 결과 줄마다 라운드별 똥배 배당값 목록
    dd = cur[cur["_dd"].notna() & cur["_rt"].isin(_RT_MAIN)]
    ddong_total = len(dd)
    ddong_rows = []
    for rt in _RT_MAIN:
        g = dd[dd["_rt"] == rt]
        cells = {r: sorted(_r2(v) for v in gg["_dd"]) for r, gg in g.groupby("_R")}
        ddong_rows.append({
            "rt": RT_LABELS[rt], "count": len(g),
            "pct": _pct(len(g), ddong_total), "cells": cells,
        })

    # 이번 라운드에 나온 똥배 배당값 — 같은 값이 과거 라운드 어느 결과 줄에 있었는지
    # 화면에서 색으로 찾아보기 위한 기준값이다.
    focus = sorted({_r2(v) for v in cur.loc[cur["_R"] == str(round), "_dd"].dropna()})

    # ② 결과 격자 — 그 시즌 전 경기의 라운드별 결과 개수
    valid = cur[cur["_rt"].isin(_RT_MAIN)]
    result_total = len(valid)
    result_rows = []
    for rt in _RT_MAIN:
        g = valid[valid["_rt"] == rt]
        result_rows.append({
            "rt": RT_LABELS[rt], "count": len(g),
            "pct": _pct(len(g), result_total),
            "cells": {r: int(n) for r, n in g["_R"].value_counts().items()},
        })

    ratio, tally = {}, {"정": 0, "중": 0, "플": 0}
    for r in rounds:
        g = valid[valid["_R"] == r]
        jung = int(g["_rt"].isin((1, 2)).sum())
        pl = int(g["_rt"].isin((3, 4)).sum())
        if jung == 0 and pl == 0:
            continue
        winner = "정" if jung > pl else ("플" if pl > jung else "중")
        ratio[r] = {"jung": jung, "pl": pl, "winner": winner}
        tally[winner] += 1

    # ③ 라운드 이력 — 같은 라운드를 시즌별로 (최근 시즌 → 오래된 시즌 순)
    history = []
    same = df[df["_R"] == str(round)]
    for s in sorted(same["_S"].dropna().unique().tolist(), reverse=True):
        g = same[same["_S"] == s]
        counts = {RT_LABELS[rt]: int((g["_rt"] == rt).sum()) for rt in _RT_MAIN}
        picks = [
            {
                "rank": rank,
                "rt": RT_LABELS.get(int(row["_rt"])) if pd.notna(row["_rt"]) else None,
                "odds": _r2(row["_dd"]),
                "HT": str(row.get("HT") or ""), "AT": str(row.get("AT") or ""),
                "HS": _score_int(row.get("HS")), "AS": _score_int(row.get("AS")),
            }
            for rank, (_, row) in enumerate(
                g[g["_dd"].notna()].sort_values("_dd").iterrows(), start=1)
        ]
        history.append({
            "season": s, "counts": counts,
            "jung": counts["핸승"] + counts["핸무"],
            "pl": counts["무"] + counts["역"],
            "picks": picks,
        })

    return {
        "available": True,
        "season": str(season), "round": str(round), "rounds": rounds,
        "ddong": {"rows": ddong_rows, "total": ddong_total, "focus": focus},
        "result": {"rows": result_rows, "total": result_total,
                   "ratio": ratio, "tally": tally},
        "history": history,
    }


def _my_pick_key(s, r, no, ht, at) -> tuple:
    return tuple(MYPICKS.normalize(v) for v in (s, r, no, ht, at))


def _attach_my_picks(records: list, username: str, code: str, scope: str) -> None:
    """조회된 행마다 이 계정이 표시한 중요 별표(IMPORTANT)/내픽(MY_PICK)/적중여부(MY_HIT)/메모(MEMO)를 붙인다."""
    picks = MYPICKS.list_my_picks(username, code, scope)
    by_key = {_my_pick_key(p["S"], p["R"], p["No"], p["HT"], p["AT"]): p for p in picks}
    for row in records:
        p = by_key.get(_my_pick_key(row.get("S"), row.get("R"), row.get("No"), row.get("HT"), row.get("AT")))
        row["IMPORTANT"] = bool(p["starred"]) if p else False
        row["MY_PICK"] = p["pick"] if p else None
        row["MY_HIT"] = p["hit"] if p else None
        row["MEMO"] = p["memo"] if p else None


class MyPickBody(BaseModel):
    scope: str
    # 프론트가 표 행 값을 그대로 보내다 보니 No처럼 숫자로 오는 필드도 있다 —
    # 매칭 키는 문자열로 통일해서 저장하므로(upsert_my_pick), 여기선 원시 타입만 받아둔다.
    S: Union[str, int, float]
    R: Union[str, int, float]
    No: Union[str, int, float]
    HT: Union[str, int, float]
    AT: Union[str, int, float]
    starred: bool = False
    pick: Optional[str] = None
    hit: Optional[str] = None
    memo: Optional[str] = None


@app.post("/api/leagues/{code}/my_picks")
def save_my_pick(code: str, body: MyPickBody, user: dict = Depends(get_current_user)):
    """중요 별표/내픽/적중여부/메모 저장 — 계정 개인 기록이라 scope(공식/내 데이터)와 무관하게 본인만 본다."""
    MYPICKS.upsert_my_pick(
        user["username"], code, body.scope,
        body.S, body.R, body.No, body.HT, body.AT,
        body.starred, body.pick, body.hit, body.memo,
    )
    return {"ok": True}


# ─────────────────────────── 상대전적 (상세 팝업용) ───────────────────────────
# 5="취소"는 실제로 열리지 않은 경기(우천취소·리그 자체 취소 등) 표시용 — engine.py의
# 26개 지표 표본 카운트는 RT==1~4로만 매칭해서(get_samples_fast) 5는 자동으로 제외되므로
# 계산 로직에는 영향이 없다.
RT_LABELS = {1: "핸승", 2: "핸무", 3: "무", 4: "역", 5: "취소"}


def _rt_label(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
        return RT_LABELS.get(int(float(v)))
    except (TypeError, ValueError):
        return None


# ─────────────────────────── 이번주 픽 (별표 모아보기) ───────────────────────────

def _scope_league_codes(scope: str, user: dict) -> list[str]:
    if scope == PATHS.SCOPE_USER:
        return [lg["code"] for lg in USERLG.list_leagues(_resolve_scope_db(scope, user))]
    return list(PATHS.LEAGUES)


_DT_RE = re.compile(r"(\d{2})-(\d{2})-(\d{2})")


def _betting_day_sort_key(dt_val, tm_val):
    """새벽 6시 이전 경기는 전날 '베팅일'로 묶어 정렬한다 — LeagueTable의 금/토/일
    배경색 규칙(columnGroups.js의 bettingDayStyle, WEEKDAY_PREV)과 순서를 맞추기
    위함이다. 예: 일요일 03:00 경기는 토요일 밤 경기들 바로 다음에 오게 한다."""
    m = _DT_RE.search(str(dt_val or ""))
    try:
        tm_num = float(tm_val)
    except (TypeError, ValueError):
        tm_num = None
    if not m:
        return (str(dt_val or ""), tm_num if tm_num is not None else 0.0)
    yy, mm, dd = (int(x) for x in m.groups())
    d = date(2000 + yy, mm, dd)
    hour = int(tm_num // 100) if tm_num is not None else None
    if hour is not None and hour < 6:
        d -= timedelta(days=1)
        order = tm_num + 2400  # 그 베팅일 안에서는 맨 뒤에 오게
    else:
        order = tm_num if tm_num is not None else 0.0
    return (d.isoformat(), order)


def _scope_league_labels(scope: str, user: dict) -> dict:
    """리그 코드 → 화면에 쓰는 리그명(라벨). 내 데이터는 사용자가 리그 생성 시
    직접 지은 이름(예: ul_2 → 'K2')이라 코드만으론 알아볼 수 없어 따로 매핑해준다."""
    if scope == PATHS.SCOPE_USER:
        return {lg["code"]: lg["label"] for lg in USERLG.list_leagues(_resolve_scope_db(scope, user))}
    return dict(PATHS.LEAGUE_LABEL)


@app.get("/api/weekly_picks")
def weekly_picks(user: dict = Depends(get_current_user)):
    """공식 데이터·내 데이터를 가리지 않고 별표(★)로 표시한 경기를 전부 모아 보여준다.
    "이번주 벳"에서 조합을 만들 대상이 되는 표라서, 리그 표와 같은 컬럼 구성을 그대로 쓰되
    어느 리그 경기인지 알 수 있도록 L(리그 코드)을 채워서 내려준다."""
    username = user["username"]
    rows: list[dict] = []
    for scope in (PATHS.SCOPE_MASTER, PATHS.SCOPE_USER):
        try:
            db = _resolve_scope_db(scope, user)
        except HTTPException:
            continue
        labels = _scope_league_labels(scope, user)
        for code in _scope_league_codes(scope, user):
            starred = {
                _my_pick_key(p["S"], p["R"], p["No"], p["HT"], p["AT"]): p
                for p in MYPICKS.list_my_picks(username, code, scope)
                if p["starred"] and not p["wp_hidden"]
            }
            if not starred:
                continue
            df = DATA.load_league_df_ranked(db, code)
            if df.empty:
                continue
            df = EVM.attach_for_league(df)   # 핸승 위험도(RISK/WIN_RISK/WIN_RISK_F/AI_PICK/K_VALUE/F_VALUE/KF_AI) — 위험도
            # 계산엔 리그 전체 이력이 필요해 df 자체는 그대로 두지만, 별표 몇 개 보자고
            # 수천 행×200개 컬럼을 전부 JSON 직렬화(df_to_records)할 필요는 없다 —
            # 여기서 별표 찍힌 행만 먼저 추려서 그만큼만 변환한다(리그당 실측 0.3~0.5초 절약).
            sub = df[["S", "R", "No", "HT", "AT"]]
            keep_idx = [
                i for i, s, r, no, ht, at in sub.itertuples(name=None)
                if _my_pick_key(s, r, no, ht, at) in starred
            ]
            if not keep_idx:
                continue
            for rec in DATA.df_to_records(df.loc[keep_idx]):
                key = _my_pick_key(rec.get("S"), rec.get("R"), rec.get("No"),
                                   rec.get("HT"), rec.get("AT"))
                p = starred.get(key)
                if p is None:
                    continue
                rec["L"] = code
                rec["L_LABEL"] = labels.get(code, code)
                rec["scope"] = scope
                rec["IMPORTANT"] = True
                rec["MY_PICK"] = p["pick"]
                rec["MY_HIT"] = p["hit"]
                rec["MEMO"] = p["memo"]
                rows.append(rec)

    rows.sort(key=lambda r: _betting_day_sort_key(r.get("DT"), r.get("TM")))
    columns = ["L"] + [c for c in (list(rows[0].keys()) if rows else [])
                       if c not in ("L", "L_LABEL", "scope")]
    return {"columns": columns, "rows": rows, "total": len(rows)}


class HideItem(BaseModel):
    code: str
    scope: str
    S: Union[str, int, float]
    R: Union[str, int, float]
    No: Union[str, int, float]
    HT: Union[str, int, float]
    AT: Union[str, int, float]


class HideBody(BaseModel):
    items: list[HideItem]


@app.post("/api/weekly_picks/hide")
def hide_weekly_picks(body: HideBody, user: dict = Depends(get_current_user)):
    """이번주 픽 선택 삭제 — 체크한 경기를 이 화면에서만 숨긴다. 별표(starred)는 그대로 둬서
    리그 표의 ★ 표시·적중 기록은 안 바뀐다."""
    cleared = MYPICKS.hide_from_weekly_picks(user["username"], [item.model_dump() for item in body.items])
    return {"ok": True, "cleared": cleared}


# ─────────────────────────── 베팅내역 (조합베팅) ───────────────────────────

class BetSlipLegBody(BaseModel):
    code: str
    S: Union[str, int, float]
    R: Union[str, int, float]
    No: Union[str, int, float]
    HT: Union[str, int, float]
    AT: Union[str, int, float]
    DT: str
    pick_type: str
    odds: Optional[float] = None
    # 이번주 픽은 공식/내 데이터를 섞어서 조합을 만들 수 있어, 이 다리가 실제로 어느
    # 스코프 리그 소속인지 따로 받아야 한다(슬립 전체의 scope와 다를 수 있다).
    scope: Optional[str] = None


class BetComboBody(BaseModel):
    odds: Optional[float] = None      # 미지정이면 다리 배당의 곱으로 계산
    stake: Optional[int] = None
    legs: list[BetSlipLegBody]


class BetBatchBody(BaseModel):
    scope: str
    memo: Optional[str] = None
    bets: list[BetComboBody]


@app.post("/api/bet_slips")
def create_bet_batch(body: BetBatchBody, user: dict = Depends(get_current_user)):
    """"벳등록" 한 번 = 조합표의 여러 줄을 한 묶음으로 등록. 계정 개인 기록이라 본인만 본다."""
    batch_id = BETSLIPS.create_batch(
        user["username"], body.scope,
        [bet.model_dump() for bet in body.bets],
        body.memo,
    )
    return {"ok": True, "batch_id": batch_id}


def _attach_leg_hits(slips: list[dict], user: dict) -> None:
    """슬립 목록(BETSLIPS.list_slips*)에 다리별 실제 결과(actual/dt/hit)와 슬립 전체
    결과(result/payout/hit_amount)를 붙인다. /api/bet_slips와 /api/team_bet_record가
    "다리마다 리그 df를 찾아 RT 대조"라는 같은 계산을 반복하지 않도록 여기 한 곳으로 모았다."""
    db_by_scope: dict[str, str] = {}

    def db_for(sc: str) -> str:
        if sc not in db_by_scope:
            db_by_scope[sc] = _resolve_scope_db(sc, user)
        return db_by_scope[sc]

    df_cache: dict[tuple, pd.DataFrame] = {}

    def df_for(sc: str, code: str) -> pd.DataFrame:
        key = (sc, code)
        if key not in df_cache:
            df_cache[key] = DATA.load_league_df(db_for(sc), code)
        return df_cache[key]

    # (S,R,No,HT,AT) -> RT라벨 인덱스. 예전엔 다리마다 리그 전체를 처음부터 한 줄씩
    # (iterrows) 다시 훑어서, 벳이 몇 개만 쌓여도 몇 초씩 걸렸다(12벳/28다리 실측
    # 6.8초). 리그당 인덱스를 딱 한 번만 만들어 이후 모든 다리가 그걸 재사용한다.
    rt_index_cache: dict[tuple, dict] = {}

    def rt_index_for(sc: str, code: str) -> dict:
        key = (sc, code)
        if key not in rt_index_cache:
            df = df_for(sc, code)
            idx: dict = {}
            if not df.empty and {"S", "R", "No", "HT", "AT", "RT"}.issubset(df.columns):
                has_dt = "DT" in df.columns
                cols = ["S", "R", "No", "HT", "AT", "RT"] + (["DT"] if has_dt else [])
                sub = df[cols]
                for row in sub.itertuples(index=False, name=None):
                    s, r, no, ht, at, rt = row[:6]
                    dt = row[6] if has_dt else None
                    idx[_my_pick_key(s, r, no, ht, at)] = (_rt_label(rt), dt)
            rt_index_cache[key] = idx
        return rt_index_cache[key]

    def rt_for(leg: dict):
        # 다리에 스코프가 저장돼 있으면 그것만 본다. 옛날에 등록돼 스코프가 없는
        # 다리는 공식/내 데이터 둘 다 뒤져서 찾는다(전에는 슬립 scope 하나만 봐서,
        # 이번주 픽에서 섞어 담은 내 데이터 다리의 결과를 못 찾는 버그가 있었다).
        scopes_to_try = [leg["scope"]] if leg.get("scope") else [PATHS.SCOPE_MASTER, PATHS.SCOPE_USER]
        key = _my_pick_key(leg["S"], leg["R"], leg["No"], leg["HT"], leg["AT"])
        for sc in scopes_to_try:
            idx = rt_index_for(sc, leg["code"])
            if key in idx:
                return idx[key]
        return (None, None)

    for slip in slips:
        for leg in slip["legs"]:
            leg["actual"], leg["dt"] = rt_for(leg)
            leg["hit"] = BETSLIPS.judge_leg(leg["pick_type"], leg["actual"])
        slip["result"] = BETSLIPS.slip_result([l["hit"] for l in slip["legs"]])
        # 당첨금 = 뱃금액 × 배당(예상), 적중금 = 실제로 맞았을 때만 받는 금액
        slip["payout"] = (round(slip["stake"] * slip["odds"])
                          if slip["stake"] and slip["odds"] else None)
        slip["hit_amount"] = slip["payout"] if slip["result"] == "적중" else None


@app.get("/api/bet_slips")
def list_bet_slips(scope: str = PATHS.SCOPE_MASTER, user: dict = Depends(get_current_user)):
    """베팅내역 표 데이터. 등록 묶음(batch) → 조합 순으로 묶어 소계를 내고, 등록된 순서 그대로
    나열한다. 회차는 더 이상 날짜로 자동 구분하지 않고, 사용자가 체크박스로 고른 뒤 "회차 설정"을
    눌러야 그 구간(settle_group_id)에 회차총계가 붙는다 — 그 전까지는 소계만 있는 미확정 상태다."""
    slips = BETSLIPS.list_slips(user["username"], scope)
    _attach_leg_hits(slips, user)

    max_legs = max((len(s["legs"]) for s in slips), default=0)

    # 등록 순서(id) 그대로 훑으며 settle_group_id가 연속으로 같은 구간끼리 하나의 섹션으로 묶는다.
    # None(미확정)도 하나의 값으로 취급 — 회차 설정 전까지는 계속 같은 섹션에 쌓인다.
    raw_sections: list[dict] = []
    for slip in slips:
        gid = slip["settle_group_id"]
        if raw_sections and raw_sections[-1]["group_id"] == gid:
            raw_sections[-1]["slips"].append(slip)
        else:
            raw_sections.append({"group_id": gid, "slips": [slip]})

    sections: list[dict] = []
    for sec in raw_sections:
        batches: list[dict] = []
        for slip in sec["slips"]:
            batch = next((b for b in batches if b["batch_id"] == slip["batch_id"]), None)
            if batch is None:
                batch = {"batch_id": slip["batch_id"], "created_dt": slip["created_dt"], "slips": []}
                batches.append(batch)
            batch["slips"].append(slip)
        for batch in batches:
            batch["subtotal"] = BETSLIPS.settle(batch["slips"])

        item = {"group_id": sec["group_id"], "batches": batches}
        # 미확정 구간도 "지금까지 담은 벳" 기준으로 실시간 소계를 보여준다(회차 설정
        # 전이라도 얼마 넣었고 지금까지 얼마 돌아왔는지 알 수 있게) — round_end만
        # 아직 확정되지 않았다는 뜻으로 None으로 둔다(화면엔 "진행 중"으로 표시).
        item["round_start"] = min((s["round_start"] for s in sec["slips"]), default=None)
        item["round_end"] = (max(s["round_end"] for s in sec["slips"])
                              if sec["group_id"] is not None else None)
        item["total"] = BETSLIPS.settle(sec["slips"])
        sections.append(item)

    # 페이지 맨 위 전체 요약(총 투자/총 회수/수익/수익률/적중 N/M) — 회차 구분과 무관하게
    # 지금까지 등록된 모든 벳을 통틀어 계산한다.
    summary = BETSLIPS.settle(slips)
    summary["hit_count"] = sum(1 for s in slips if s["result"] == "적중")
    summary["total_count"] = len(slips)

    return {"max_legs": max_legs, "sections": sections, "summary": summary}


@app.get("/api/team_bet_record")
def team_bet_record(name: str, user: dict = Depends(get_current_user)):
    """상세보기 팀명 옆 (적중/전체) 배지용. "전체"는 베팅내역의 개별 벳(조합) 개수가
    아니라 "이번주 벳"에서 그 팀을 선택("+추가")한 횟수다 — 한 경기에 유형을 여러 개
    담아도(예: 플핸/핸무 둘 다 추가) 조합 곱해지기 전 기준으로 그 경기 1건만 센다.
    "적중"은 그 경기에 담은 유형 중 가장 먼저 추가한 것(다리 id가 가장 작은 것)의
    적중 여부만 본다 — 나중에 다른 유형을 더 담았다고 판정이 바뀌지 않는다.
    스코프(공식/내 데이터) 구분 없이 이 계정의 전체 배팅 이력을 본다."""
    name = (name or "").strip()
    if not name:
        return {"name": name, "hit": 0, "total": 0}
    slips = BETSLIPS.list_slips_all(user["username"])
    _attach_leg_hits(slips, user)

    # (batch_id, S, R, No, HT, AT) 조합마다 다리 id가 가장 작은(=가장 먼저 추가한) 것만 남긴다.
    first_leg: dict[tuple, dict] = {}
    for slip in slips:
        for leg in slip["legs"]:
            if leg.get("HT") != name and leg.get("AT") != name:
                continue
            key = (slip["batch_id"], leg.get("S"), leg.get("R"), leg.get("No"), leg.get("HT"), leg.get("AT"))
            cur = first_leg.get(key)
            if cur is None or leg["leg_id"] < cur["leg_id"]:
                first_leg[key] = leg

    total = len(first_leg)
    hit = sum(1 for leg in first_leg.values() if leg["hit"] == "적중")
    return {"name": name, "hit": hit, "total": total}


class SlipIdsBody(BaseModel):
    scope: str
    slip_ids: list[int]


@app.post("/api/bet_slips/lock")
def lock_bet_slips(body: SlipIdsBody, user: dict = Depends(get_current_user)):
    """체크박스로 고른 벳들을 하나의 회차로 확정한다("회차 설정"). 확정되면 회차총계가
    붙고, 그 벳들은 더 이상 선택 삭제·재설정 대상이 되지 않는다."""
    group_id = BETSLIPS.lock_slips(user["username"], body.scope, body.slip_ids)
    return {"ok": True, "group_id": group_id}


@app.post("/api/bet_slips/delete_selected")
def delete_selected_bet_slips(body: SlipIdsBody, user: dict = Depends(get_current_user)):
    """체크박스로 고른 벳들을 지운다. 이미 회차로 묶인 벳은 걸러지고 그대로 남는다."""
    deleted = BETSLIPS.delete_slips(user["username"], body.scope, body.slip_ids)
    return {"ok": True, "deleted": deleted}


@app.delete("/api/bet_slips/{slip_id}")
def delete_bet_slip(slip_id: int, user: dict = Depends(get_current_user)):
    BETSLIPS.delete_slip(user["username"], slip_id)
    return {"ok": True}


@app.delete("/api/bet_batches/{batch_id}")
def delete_bet_batch(batch_id: str, user: dict = Depends(get_current_user)):
    """등록 묶음 통째로 삭제 — 잘못 등록한 벳등록 한 건을 되돌릴 때. 이미 회차로 묶인
    벳은 남긴다(BETSLIPS.delete_batch가 걸러준다)."""
    BETSLIPS.delete_batch(user["username"], batch_id)
    return {"ok": True}


def _wdl_breakdown(m: pd.DataFrame, reference: str, home_only: bool = False) -> dict:
    """
    기준 팀(reference)이 각 경기에서 홈이었든 원정이었든 상관없이 실제 스코어로
    이겼는지(W)/비겼는지(D)/졌는지(L) 판정하고, 그 W/D/L 안에서 핸디캡 결과(RT)가
    어떻게 갈렸는지 세부 집계한다. 예: W인데 RT=역이면 "실제로는 이겼지만 핸디는
    못 넘음"이라는 뜻 — RT는 항상 '그 경기 자체의 홈팀' 기준 원본값을 그대로 쓴다.
    home_only=True면 기준 팀이 그 경기에서 실제로 홈이었던 맞대결만 센다("홈기준").
    """
    buckets = {"W": {}, "D": {}, "L": {}}
    if m.empty or "HS" not in m.columns or "AS" not in m.columns or "HT" not in m.columns:
        return {k: {"total": 0, "breakdown": {}} for k in buckets}
    for _, row in m.iterrows():
        hs, as_ = row.get("HS"), row.get("AS")
        if pd.isna(hs) or pd.isna(as_):
            continue
        row_ht = str(row.get("HT", "")).strip()
        if home_only and row_ht != reference:
            continue
        mine, theirs = (hs, as_) if row_ht == reference else (as_, hs)
        letter = "W" if mine > theirs else "L" if mine < theirs else "D"
        lab = _rt_label(row.get("RT")) or "기타"
        buckets[letter][lab] = buckets[letter].get(lab, 0) + 1
    return {k: {"total": sum(v.values()), "breakdown": v} for k, v in buckets.items()}


def _head_to_head_calc(total_df: pd.DataFrame, home: str, away: str,
                       cross: bool = True, limit: int = 15) -> dict:
    """
    두 팀의 과거 맞대결 기록(betpro_ui._head_to_head 이식).
    결과(RT)는 '각 경기의 홈팀 기준' — 지금 보고 있는 경기의 홈팀 관점으로
    재해석하지 않는다(원본과 동일한 주의사항).
    cross=True(기본)면 홈/원정이 뒤바뀐 경기도 포함(양방향).
    cross=False면 home=홈팀·away=원정팀으로 지정한 방향만 정확히 일치하는 경기만.
    """
    ht, at = str(home).strip(), str(away).strip()
    empty = {"summary": None, "wdl_summary": None, "wdl_summary_home": None, "matches": [], "total": 0}
    if total_df.empty or "HT" not in total_df.columns or "AT" not in total_df.columns:
        return empty

    h = total_df["HT"].astype(str).str.strip()
    a = total_df["AT"].astype(str).str.strip()
    if cross:
        mask = ((h == ht) & (a == at)) | ((h == at) & (a == ht))
    else:
        mask = (h == ht) & (a == at)
    m = total_df[mask].copy()
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

    # 기준 팀(ht)이 홈/원정 상관없이 실제로 이겼는지/비겼는지/졌는지 기준 요약("전체기준")과,
    # 그 팀이 실제로 홈이었던 맞대결만 추린 요약("홈기준"). 둘 다 limit으로 잘리기 전
    # 전체 맞대결(m) 기준이라 "최근 N경기만 표시"와 무관하게 정확하다.
    wdl_summary = _wdl_breakdown(m, ht)
    wdl_summary_home = _wdl_breakdown(m, ht, home_only=True)

    cols = [c for c in ["S", "R", "DT", "HT", "HS", "AS", "AT", "RT",
                        "KW", "KD", "KL", "FW", "FD", "FL"]
            if c in m.columns]
    out = m[cols].head(limit).copy()
    if "RT" in out.columns:
        out["RT_label"] = out["RT"].map(_rt_label)

    return {
        "summary": summary,
        "wdl_summary": wdl_summary,
        "wdl_summary_home": wdl_summary_home,
        "matches": DATA.df_to_records(out),
        "total": len(m),
    }


def _season_matches(total_df: pd.DataFrame, team: str, season) -> list:
    """종합픽의 '시즌전적' 신호용 — team이 이번 시즌(season)에 홈/원정 상관없이 치른
    경기 원본 목록. 정배/역배 판정과 핸디캡 결과 집계는 pick_ai.py가 한다(여기선 그
    판단에 필요한 원본 칼럼만 추려서 넘긴다)."""
    t = str(team).strip()
    if not t or total_df.empty or "HT" not in total_df.columns or "AT" not in total_df.columns:
        return []
    h = total_df["HT"].astype(str).str.strip()
    a = total_df["AT"].astype(str).str.strip()
    mask = (h == t) | (a == t)
    if "S" in total_df.columns:
        mask &= total_df["S"].astype(str) == str(season)
    m = total_df[mask]
    if m.empty:
        return []
    cols = [c for c in ["S", "R", "HT", "AT", "RT", "KW", "KL", "FW", "FL"] if c in m.columns]
    return DATA.df_to_records(m[cols])


def _h2h_source_df(db: str, scope: str, code: str) -> pd.DataFrame:
    """
    상대전적 검색 대상.
      master → 6대리그를 합친 통합DB(팀이 어느 리그 소속이든 다 뒤진다)
      user   → 내 데이터는 '통합DB' 자체가 없으므로(리그별 완전 독립), 그 리그
               하나만 본다. code 없이 호출되면(있을 수 없는 경우) 빈 결과를 낸다.
    """
    if scope != PATHS.SCOPE_USER:
        return DATA.load_total_df(db)
    if not code:
        return pd.DataFrame()
    return DATA.load_league_df(db, code)


@app.get("/api/head_to_head")
def head_to_head(scope: str = PATHS.SCOPE_MASTER,
                 code: str = "",
                 home: str = "",
                 away: str = "",
                 limit: int = 15,
                 cross: bool = True,
                 user: dict = Depends(get_current_user)):
    if code and scope == PATHS.SCOPE_USER:
        _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = _h2h_source_df(db, scope, code)
    return _head_to_head_calc(df, home, away, cross=cross, limit=limit)


class PickAiBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str = ""
    row: dict


@app.post("/api/pick_ai")
def pick_ai(body: PickAiBody, user: dict = Depends(get_current_user)):
    """종합픽 — 핸승위험도·지표표본·상대전적·최근흐름을 한 번에 정리해 돌려준다.

    화면이 이미 들고 있는 경기 한 줄을 그대로 받아서 계산한다(리그 전체를 다시 읽지
    않으므로 팝업이 즉시 뜬다). 상대전적만 화면에 없는 값이라 여기서 직접 구한다.
    저장은 하지 않는다 — 팝업을 열 때마다 그 자리에서 계산하는 표시 전용 값이다.
    """
    if body.code and body.scope == PATHS.SCOPE_USER:
        _check_league_for(body.code, body.scope, user)
    ht = str(body.row.get("HT") or "").strip()
    at = str(body.row.get("AT") or "").strip()
    h2h = None
    season_matches = None
    if ht and at:
        db = _resolve_scope_db(body.scope, user)
        src_df = _h2h_source_df(db, body.scope, body.code)
        # limit을 크게 잡는다 — pick_ai가 "오늘과 같은 정배/역배 구도였던 맞대결만" 골라
        # 다시 세아려야 해서(아래 compute() 참고) summary 집계만으론 안 되고 개별 경기
        # 목록(matches)이 전부 있어야 한다.
        h2h = _head_to_head_calc(src_df, ht, at, cross=True, limit=500)
        season = body.row.get("S")
        season_matches = {
            "home": _season_matches(src_df, ht, season),
            "away": _season_matches(src_df, at, season),
        }
    return PICKAI.compute(body.row, h2h, scope=body.scope, season_matches=season_matches)


@app.get("/api/leagues/{code}/match_excel")
def match_excel_download(code: str,
                         scope: str = PATHS.SCOPE_MASTER,
                         season: str = "",
                         round: str = "",   # noqa: A002
                         no: str = "",
                         hlimit: int = 100000,   # 엑셀은 화면과 달리 자리 제약이 없어 사실상 전부 담는다
                         user: dict = Depends(get_current_user)):
    """
    상세보기 팝업(배당·플핸예측·상대전적·지표별 표본)을 엑셀 한 시트로 내려받는다.
    화면에 이미 계산되어 저장된 값만 그대로 옮겨 담을 뿐, 새로 계산하지 않는다.
    """
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df_ranked(db, code)   # 화면 팝업과 같은 폼/최근전적이 담기도록
    if df.empty or "S" not in df.columns or "R" not in df.columns:
        raise HTTPException(status_code=404, detail="데이터가 없습니다.")

    mask = (df["S"].astype(str) == str(season)) & (df["R"].astype(str) == str(round))
    if "No" in df.columns:
        # No는 숫자 컬럼이라 float 저장(1.0)과 문자열 비교(1)가 어긋날 수 있어 숫자로 비교한다.
        try:
            target_no = float(no)
            mask &= pd.to_numeric(df["No"], errors="coerce") == target_no
        except (TypeError, ValueError):
            mask &= df["No"].astype(str) == str(no)
    sub = df[mask]
    if sub.empty:
        raise HTTPException(status_code=404, detail="해당 경기를 찾을 수 없습니다.")

    row = DATA.df_to_records(sub.head(1))[0]
    ht = str(row.get("HT") or "").strip()
    at = str(row.get("AT") or "").strip()

    h2h_df = _h2h_source_df(db, scope, code)
    h2h = _head_to_head_calc(h2h_df, ht, at, cross=True, limit=hlimit)

    buf = XLS.build_match_excel(row, h2h)
    return _xlsx_response(
        buf, f"{ht}_vs_{at}_{row.get('S', '')}_{row.get('R', '')}.xlsx", "match_detail.xlsx")


# ─────────────────────────── 엑셀 다운로드 / 업로드 ───────────────────────────
XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_response(buf, korean_name: str, ascii_name: str) -> StreamingResponse:
    """한글 파일명은 RFC 5987(filename*)로, 구형 클라이언트용 ASCII 이름도 함께 준다."""
    safe = korean_name.replace("/", "-").replace("\\", "-")
    headers = {
        "Content-Disposition":
            f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe)}"
    }
    return StreamingResponse(buf, media_type=XLSX_MEDIA, headers=headers)


_TABLE_TO_L_CODE = {v: k for k, v in PATHS.L_CODE_TO_TABLE.items()}


@app.get("/api/leagues/{code}/upload_template")
def upload_template(code: str,
                    scope: str = PATHS.SCOPE_MASTER,
                    season: str = "",
                    round: str = "",   # noqa: A002 — 숫자만(예: "27") → 파일엔 "27R"로 채움
                    user: dict = Depends(get_current_user)):
    """경기 업로드용 빈 표본 양식(.xlsx). 업로드 권한이 있는 사용자만.
    리그·시즌·라운드를 넘기면 경기번호 1~10행을 미리 채운 파일을 만든다."""
    _check_league_for(code, scope, user)
    if not PATHS.can_write(scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")

    round = round.strip()
    if round and not round.isdigit():
        raise HTTPException(status_code=400, detail="라운드는 숫자만 입력하세요.")
    round_label = f"{round}R" if round else ""

    # 리그(L) 칸에는 내 데이터도 '코드'를 넣는다 — L은 중복판정 키라서, 이름을 바꿔도
    # 흔들리지 않는 값이어야 한다. 파일명에는 사람이 알아보는 리그 이름을 쓴다.
    buf = XLS.build_upload_template(
        league_code=_l_value(_resolve_scope_db(scope, user), scope, code),
        season=season.strip(),
        round_label=round_label,
    )
    shown = USERLG.label_of(_resolve_scope_db(scope, user), code) \
        if _is_user_scope(scope) else code
    name_parts = [shown] + [p for p in (season.strip(), round_label) if p]
    return _xlsx_response(buf, f"{'_'.join(name_parts)}_경기업로드_양식.xlsx", "upload_template.xlsx")


@app.get("/api/leagues/{code}/table_excel")
def table_excel_download(code: str,
                         scope: str = PATHS.SCOPE_MASTER,
                         season: Optional[str] = None,
                         round: Optional[str] = None,   # noqa: A002
                         kw: Optional[float] = None,
                         kd: Optional[float] = None,
                         kl: Optional[float] = None,
                         khw: Optional[float] = None,
                         khd: Optional[float] = None,
                         khl: Optional[float] = None,
                         fw: Optional[float] = None,
                         fd: Optional[float] = None,
                         fl: Optional[float] = None,
                         user: dict = Depends(get_current_user)):
    """
    현재 조회 조건 그대로의 분석표를 엑셀로. 화면과 같은 필터 함수를 쓰므로
    화면에 보이는 것과 정확히 같은 경기가 담긴다(행 수 상한 없이 전부).
    """
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df_ranked(db, code)   # 화면과 같은 순위(HP/AP)가 담기도록
    if df.empty:
        raise HTTPException(status_code=404, detail="데이터가 없습니다.")

    sub, season, round = _apply_league_filters(
        df, season, round,
        {"KW": kw, "KD": kd, "KL": kl, "KHW": khw, "KHD": khd,
         "KHL": khl, "FW": fw, "FD": fd, "FL": fl})

    records = DATA.df_to_records(sub)
    _attach_my_picks(records, user["username"], code, scope)

    shown = USERLG.label_of(db, code) if _is_user_scope(scope) else code
    buf = XLS.build_table_excel(
        list(df.columns) + ["IMPORTANT", "MY_PICK", "MY_HIT", "MEMO"], records, title=shown)
    parts = [shown]
    if season:
        parts.append(str(season))
    if round:
        parts.append(str(round))
    return _xlsx_response(buf, f"{'_'.join(parts)}_분석표.xlsx", "league_table.xlsx")


UPLOAD_DEDUP_KEY = ["L", "S", "R", "No", "HT", "AT"]   # 원본과 동일(DT는 결측이 많아 제외)


def _keep_existing_where_blank(new: pd.DataFrame, old: pd.DataFrame) -> pd.DataFrame:
    """
    이미 있는 경기를 다시 올릴 때, 새 데이터의 '빈 칸'이 기존 값을 지우지 않게 한다.

    같은 경기(L/S/R/No/HT/AT)에 대해 값이 들어온 칸만 새 값으로 바꾸고,
    비어 있는 칸은 기존 값을 그대로 둔다 — 스코어맨 크롤링은 경기결과(RT)·핸디(FH)·
    국내배당을 가져오지 못하므로, 이 처리가 없으면 직접 입력해 둔 값이 통째로 지워진다.
    (덮어쓰기를 원하면 그 칸에 값을 채워서 올리면 된다)
    """
    if old is None or old.empty or new is None or new.empty:
        return new
    key = [c for c in UPLOAD_DEDUP_KEY if c in new.columns and c in old.columns]
    if not key:
        return new

    o = old.drop_duplicates(subset=key, keep="last")
    cols = [c for c in new.columns if c in old.columns and c not in key]
    if not cols:
        return new

    joined = new.merge(o[key + cols], on=key, how="left", suffixes=("", "__old"))
    for c in cols:
        oc = f"{c}__old"
        if oc not in joined.columns:
            continue
        blank = joined[c].isna() | (joined[c].astype(str).str.strip() == "")
        joined.loc[blank, c] = joined.loc[blank, oc]
    return joined[new.columns]


def _merge_and_save(db: str, code: str, scope: str, new: pd.DataFrame, confirm: bool):
    """
    새 경기(new)를 기존 리그 데이터와 병합해 저장한다.
    엑셀 업로드와 '스코어맨 Data 가져오기'가 똑같은 규칙을 쓰도록 한 곳에 모아 둔 함수다.

    confirm=False면 저장하지 않고 미리보기(건수/중복)만 돌려준다.
    이미 있던 경기의 26개 지표·플핸예측은 최초 계산값을 그대로 유지하고(예측 고정),
    새로 들어온 경기만 계산한다.
    """
    old = DATA.load_league_df(db, code)
    new = _keep_existing_where_blank(new, old)
    old_count = len(old)
    # concat 직후(중복제거 전) 프레임 — old/new의 dedup key 컬럼 dtype이 여기서 하나로
    # 통일된다(예: No가 old=int64, new=float64였어도 같은 dtype이 됨). 아래서 old 쪽 행을
    # 다시 골라 쓸 때 이 dtype 통일된 버전을 써야 문자열 캐스팅 없이 정확히 매칭된다.
    pre_dedup = pd.concat([old, new], ignore_index=True) if not old.empty else new.copy()
    merged = pre_dedup

    key = [c for c in UPLOAD_DEDUP_KEY if c in merged.columns]
    duplicates = 0
    if key:
        before = len(merged)
        merged = merged.drop_duplicates(subset=key, keep="last").reset_index(drop=True)
        duplicates = before - len(merged)

    if not confirm:
        return {
            "saved": False,
            "new_rows": len(new),
            "existing_rows": len(old),
            "after_merge": len(merged),
            "duplicates_removed": duplicates,
            "sample": DATA.df_to_records(new.head(10)),
        }

    if scope == PATHS.SCOPE_MASTER:
        PATHS.backup_master()      # 저장 전 자동 백업 (관리자 화면에서 롤백 가능)

    # 통합(TF-/TK-)지표의 표본 기준.
    #   master → 6대리그를 합친 통합DB
    #   user   → 그 리그 하나만 (사용자 지정: 내 데이터는 탭별로 완전히 독립)
    if _is_user_scope(scope):
        total_new = merged
    else:
        total_new = DATA.load_total_df(db)
        if total_new.empty:
            total_new = merged

    final = merged.copy()

    # ① 이미 있던 경기(dedup key가 old에도 있던 행)는 분석 컬럼을 최초 계산값 그대로 되살린다.
    raw_cols = set(XLS.UPLOAD_TEMPLATE_COLS)
    analysis_cols = [c for c in old.columns if c not in raw_cols] if not old.empty else []

    if key and old_count and analysis_cols:
        old_harmonized = pre_dedup.iloc[:old_count]   # dtype이 final과 통일된 old 행들
        frozen = old_harmonized[key + analysis_cols].drop_duplicates(subset=key, keep="last")

        match = final[key].merge(frozen, on=key, how="left", indicator=True)
        is_known = (match["_merge"] == "both").to_numpy()

        for c in analysis_cols:
            if c not in final.columns:
                final[c] = pd.NA
            final.loc[is_known, c] = match.loc[is_known, c].values
    else:
        is_known = np.zeros(len(final), dtype=bool)

    # ①-보강: 이미 있던 경기라도 이번에 처음 국내/해외 배당이 채워졌으면
    #         그 쪽 지표·플핸예측만 최초 계산한다(다른 쪽·다른 행은 안 건드림).
    #         업로드 재등록·스코어맨 크롤·젠토토 국내배당 크롤 모두 이 경로를 탄다.
    if key and old_count and analysis_cols:
        _fill_missing_ph_side(final, db, scope, final.index[is_known].tolist())

    # ② 새로 들어온(=old에 없던) 경기만 지표·플핸예측을 계산한다.
    #    전체 리그 표(final)를 표본 모집단으로 써서 개별지표를 계산하고,
    #    새 경기끼리도 서로의 표본에 포함된다(engine의 자기 자신 1건 제외 로직이 처리).
    new_rows = final[~is_known]
    if not new_rows.empty:
        res_new = engine._recompute_indicators_for_subset(new_rows, final, total_new)
        for c in res_new.columns:
            if c not in final.columns:
                final[c] = pd.NA
            final.loc[res_new.index, c] = res_new[c].values

    # 병합(concat+dedup) 과정에서 이미 있던 경기가 뒤로 밀려 저장되면, 화면은 raw 저장
    # 순서를 그대로 보여주므로 같은 라운드 안에서 No가 뒤죽박죽으로 보인다(예: 1,3,2,4..).
    # 값 자체는 그대로이니 저장 직전에 시즌·라운드·No 순으로 다시 정렬해 둔다.
    if {"S", "R", "No"}.issubset(final.columns):
        sort_key = pd.DataFrame({
            "S": final["S"].astype(str),
            "_r": final["R"].map(_round_sort_key),
            "_no": pd.to_numeric(final["No"], errors="coerce"),
        }, index=final.index)
        final = final.loc[sort_key.sort_values(["S", "_r", "_no"], kind="stable").index]
        final = final.reset_index(drop=True)

    con = sqlite3.connect(db)
    try:
        final.to_sql(code, con, if_exists="replace", index=False)
    finally:
        con.close()
    PATHS.stamp_updated(db)

    return {
        "saved": True,
        "rows": len(final),
        "new_rows": len(new),
        "duplicates_removed": duplicates,
    }


@app.post("/api/leagues/{code}/upload")
def upload_matches(code: str,
                   file: UploadFile = File(...),
                   scope: str = Form(PATHS.SCOPE_MASTER),
                   confirm: bool = Form(False),
                   user: dict = Depends(get_current_user)):
    """
    경기 엑셀 업로드 (원본 WEB_BET_PRO.py 2105~2165줄 이식).
    confirm=false면 저장하지 않고 미리보기(건수/중복)만 돌려준다 — 실수로 덮어쓰는 걸 막는 2단계.
    confirm=true면 기존 데이터와 병합·중복제거 후 "새로 추가되는 경기만" 26개 지표+플핸예측을
    계산해 리그 테이블에 저장한다.

    [원본과 다른 점 — 의도적 수정]
      원본은 기존 표(지표 컬럼 포함)에 새 분석결과를 옆으로 이어붙여서, 데이터가 이미
      있는 리그에 추가 업로드하면 컬럼명이 208개 중복돼 저장이 실패했다(빈 리그 최초
      업로드만 동작). 여기서는 이어붙이는 대신 같은 이름의 컬럼에 덮어써서, 기존 표의
      구조를 유지한다.

    [예측 고정 원칙 — 사용자 지정]
      이미 DB에 있던 경기(시즌·라운드·경기번호·팀이 같음)의 26개 지표·플핸예측은
      새 경기가 추가돼도 절대 다시 계산하지 않는다 — 한 번 나온 예측이 이후 데이터로
      계속 바뀌면 "과거 예측의 적중률"이라는 의미 자체가 없어지기 때문. 스코어(HS/AS/RT)
      등 원본 값은 이번 업로드로 갱신되지만(예정 경기에 나중에 결과만 채우는 흐름을
      그대로 지원), 분석 컬럼은 그 경기가 처음 저장됐을 때 값을 그대로 유지한다.
      새로 추가되는 경기만 engine._recompute_indicators_for_subset()으로 계산한다
      (예정 경기 재계산 버튼이 쓰는 것과 같은 함수) — 그래서 기존 경기가 아주 많아도
      이번에 추가된 경기 수만큼만 계산해 훨씬 빠르다.
      전체삭제 후 재업로드처럼 old가 비어 있으면(=완전히 새 리그) 모든 행이 "새 경기"로
      취급되어 정상적으로 전부 계산된다.
    """
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    if not PATHS.can_write(scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    try:
        head = pd.read_excel(io.BytesIO(raw), header=None, nrows=10)
        hr = engine.find_header_row(head)
        new = engine.preprocess_data(pd.read_excel(io.BytesIO(raw), header=hr))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"엑셀을 읽지 못했습니다: {e}")

    if new.empty:
        raise HTTPException(
            status_code=400,
            detail="유효한 경기가 없습니다. 홈팀(HT)·원정팀(AT)이 채워져 있는지 확인하세요.")

    return _merge_and_save(db, code, scope, new, confirm)


# ─────────────────────────── 스코어맨 Data 가져오기 ───────────────────────────
class CrawlBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    url: Optional[str] = None


class CrawlAliasBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    mapping: dict = {}


class CrawlSaveBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    rows: list = []
    confirm: bool = False


def _l_value(db: str, scope: str, code: str) -> str:
    """
    엑셀/DB의 'L'(리그) 칸에 넣을 값.
      master → 원본 관례대로 2글자 코드(EPL→'EP')
      user   → 사용자가 붙인 리그 이름(예: 'K1')
    ⚠ 내부 코드(ul_1)를 넣으면 안 된다 — L은 중복판정 키라서, 기존 데이터와 값이 다르면
       같은 경기가 중복 저장되고 표에서도 다른 리그처럼 보인다.
    """
    if _is_user_scope(scope):
        return USERLG.label_of(db, code)
    return _TABLE_TO_L_CODE.get(code, code)


def _league_teams(db: str, code: str):
    """그 리그에 이미 등록되어 있는 팀명 목록(팀명 셀렉트박스 옵션)."""
    df = DATA.load_league_df(db, code)
    if df.empty or "HT" not in df.columns:
        return []
    names = set(df["HT"].dropna().astype(str)) | set(df["AT"].dropna().astype(str))
    return sorted(n.strip() for n in names if n.strip())


@app.get("/api/crawl/config")
def crawl_config(scope: str = PATHS.SCOPE_MASTER, code: str = "",
                 user: dict = Depends(get_current_user)):
    """리그별 크롤 주소 + 저장된 팀명 치환 규칙 + 브라우저 상태."""
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    udb = _user_db_of(user)      # 설정은 항상 계정 DB에 저장(master.db는 건드리지 않음)
    return {
        "url": CRAWL.get_source(udb, scope, code),
        "default_url": CRAWL.default_source(code),
        "aliases": CRAWL.list_aliases(udb, scope, code),
        "teams": _league_teams(db, code),
        "is_open": CRAWL.is_open(),
        "known_ids": CRAWL.KNOWN_LEAGUE_IDS,
    }


@app.post("/api/crawl/open")
def crawl_open(body: CrawlBody, user: dict = Depends(get_current_user)):
    """크롬 창을 그 리그의 스코어맨 화면으로 연다. url을 주면 그 주소를 저장하고 사용한다."""
    _check_league_for(body.code, body.scope, user)
    udb = _user_db_of(user)
    try:
        url = (body.url or "").strip()
        if url:
            url = CRAWL.set_source(udb, body.scope, body.code, url)
        else:
            url = CRAWL.get_source(udb, body.scope, body.code)
        if not url:
            raise HTTPException(status_code=400,
                                detail="이 리그의 스코어맨 주소를 먼저 입력해 주세요.")
        CRAWL.open_page(url)
    except CRAWL.CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "url": url}


class CrawlRoundBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    round: str   # noqa: A003 — "17" 또는 "17R"


@app.post("/api/crawl/round")
def crawl_round(body: CrawlRoundBody, user: dict = Depends(get_current_user)):
    """열린 화면의 라운드를 바꾼다(시즌은 화면에서 직접 고른다)."""
    _check_league_for(body.code, body.scope, user)
    try:
        return {"ok": True, "round": CRAWL.select_round(body.round)}
    except CRAWL.CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/crawl/fetch")
def crawl_fetch(body: CrawlBody, user: dict = Depends(get_current_user)):
    """
    지금 크롬 화면에 떠 있는 경기들을 가져온다.
    저장해 둔 치환 규칙을 적용한 뒤, 그래도 DB에 없는 팀명은 따로 알려준다.
    """
    _check_league_for(body.code, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    udb = _user_db_of(user)
    try:
        res = CRAWL.crawl_current(_l_value(db, body.scope, body.code))
    except CRAWL.CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))

    aliases = CRAWL.list_aliases(udb, body.scope, body.code)
    rows = CRAWL.apply_aliases(res["rows"], aliases)
    teams = _league_teams(db, body.code)
    res["rows"] = rows
    res["teams"] = teams
    res["unknown_teams"] = CRAWL.unknown_teams(rows, teams)
    res["applied_aliases"] = len(aliases)
    return res


@app.post("/api/crawl/aliases")
def crawl_save_aliases(body: CrawlAliasBody, user: dict = Depends(get_current_user)):
    """팀명 치환 규칙 저장 — 다음 가져오기부터 자동으로 적용된다."""
    _check_league_for(body.code, body.scope, user)
    udb = _user_db_of(user)
    n = CRAWL.save_aliases(udb, body.scope, body.code, body.mapping)
    return {"ok": True, "saved": n,
            "aliases": CRAWL.list_aliases(udb, body.scope, body.code)}


@app.post("/api/crawl/save")
def crawl_save(body: CrawlSaveBody, user: dict = Depends(get_current_user)):
    """가져온 경기들을 리그에 등록한다. 엑셀 업로드와 완전히 같은 병합 규칙을 쓴다."""
    _check_league_for(body.code, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if not body.rows:
        raise HTTPException(status_code=400, detail="가져온 경기가 없습니다.")

    # 업로드 양식과 같은 컬럼만 남긴다(_핸디기준 같은 참고용 필드는 저장하지 않는다)
    raw = pd.DataFrame(body.rows)
    for c in XLS.UPLOAD_TEMPLATE_COLS:
        if c not in raw.columns:
            raw[c] = None
    new = engine.preprocess_data(raw[XLS.UPLOAD_TEMPLATE_COLS])
    if new.empty:
        raise HTTPException(status_code=400,
                            detail="유효한 경기가 없습니다. 홈팀·원정팀이 채워져 있는지 확인하세요.")
    return _merge_and_save(db, body.code, body.scope, new, body.confirm)


@app.post("/api/crawl/close")
def crawl_close(user: dict = Depends(get_current_user)):
    CRAWL.close_page()
    return {"ok": True}


# ═══════════════════════ 국내배당(젠토토) 가져오기 ═══════════════════════
# 스코어맨(해외배당) 크롤과 흐름은 같지만 목적이 다르다 — 이미 있는 경기의
# 국내배당 칸(KW~KHL)만 채우는 '백필 전용' 기능이라 새 경기를 만들지 않는다.
# 저장은 새 엔드포인트 없이 기존 /api/crawl/save(= _merge_and_save)를 그대로 쓴다.
#   젠토토 사이트의 '리그 선택' 검색 필터 값(game_name[])을 CDP로 직접 확인해 맞춘
#   것들 — 화면 표시 텍스트(예: '라리가')와 실제 필터/game-name title 속성값(예:
#   '스페인 라리가')이 다르면 _parse_lines()의 title 매칭이 걸러버려 아무 것도
#   못 찾는다(에레디비시도 같은 이유로 이미 한 번 고쳤다). EP/BD/SA/L1은 아직
#   실측 확인 전이라 원래 값 그대로 둔다 — 같은 증상(가져오기 실패)이 나면 그
#   리그도 같은 방식(회차 화면 열고 리그 체크박스의 실제 value 확인)으로 맞춘다.
KR_LEAGUE_NAME_GUESS = {
    "K1": "K리그1", "K2": "K리그2", "EP": "EPL",
    "La": "스페인 라리가", "BD": "분데스리", "SA": "세리에A", "Er": "네덜란드 에레디비시", "L1": "프리그1",
}


class CrawlKrOpenBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    year: str
    round: str   # noqa: A003 — 젠토토 자체 회차번호(예: 260036). 앱의 R과 무관.


class CrawlKrFetchBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    season: str            # 이 리그의 시즌(S) — 매칭용
    round: str              # noqa: A003 — 이 리그의 라운드(R, 예: '21R') — 매칭용
    league_name: Optional[str] = None   # 비우면 K1/K2 기본 추정값 사용


@app.get("/api/crawl/kr/config")
def crawl_kr_config(scope: str = PATHS.SCOPE_MASTER, code: str = "",
                    user: dict = Depends(get_current_user)):
    """국내배당 가져오기 설정 — 팀명 치환 규칙(스코어맨과 별도 저장)·리그명 추정.
    매칭용 시즌/라운드는 리그마다 표기가 달라(K리그 '2026' vs 유럽리그 '20-21') 사용자가
    직접 타이핑하면 자주 어긋난다 — 이 리그에 실제 저장된 최신 시즌/라운드 표기를 그대로
    내려줘서 화면에서 기본값으로 채워 두면 표기 실수를 원천적으로 막을 수 있다."""
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    udb = _user_db_of(user)
    label = _l_value(db, scope, code)
    df = DATA.load_league_df(db, code)
    latest_season = latest_round = None
    if not df.empty and "S" in df.columns:
        seasons = sorted([s for s in df["S"].dropna().unique().tolist()])
        if seasons:
            latest_season = str(seasons[-1])
            rounds = df.loc[df["S"] == seasons[-1], "R"].dropna().unique().tolist()
            if rounds:
                latest_round = str(sorted(rounds, key=_round_sort_key)[-1])
    return {
        "aliases": CRAWL.list_aliases(udb, scope, code, source="kr"),
        "teams": _league_teams(db, code),
        "is_open": KRCRAWL.is_open(),
        "default_league_name": KR_LEAGUE_NAME_GUESS.get(label, label),
        "latest_season": latest_season,
        "latest_round": latest_round,
    }


@app.post("/api/crawl/kr/open")
def crawl_kr_open(body: CrawlKrOpenBody, user: dict = Depends(get_current_user)):
    """크롬 창을 젠토토의 해당 연도·회차 화면으로 연다(로그인 필요 — 최초 1회 직접 로그인)."""
    _check_league_for(body.code, body.scope, user)
    try:
        url = KRCRAWL.open_round(body.year, body.round)
    except KRCRAWL.CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "url": url}


@app.post("/api/crawl/kr/fetch")
def crawl_kr_fetch(body: CrawlKrFetchBody, user: dict = Depends(get_current_user)):
    """
    지금 화면에 떠 있는 국내배당(초기배당)을 가져와, 이 리그의 season/round에 이미
    있는 경기와 (홈팀,원정팀)으로 매칭한다. No는 화면 순번이 아니라 매칭된 기존 행의
    실제 No를 그대로 붙인다 — 그래야 저장 시 새 경기로 중복 생성되지 않는다.
    매칭 안 되는 경기는 새로 만들지 않고 목록으로만 알려준다.
    """
    _check_league_for(body.code, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    udb = _user_db_of(user)
    label = _l_value(db, body.scope, body.code)
    league_name = (body.league_name or KR_LEAGUE_NAME_GUESS.get(label, "")).strip()
    if not league_name:
        raise HTTPException(status_code=400,
                            detail="젠토토 리그명을 확인할 수 없습니다. 직접 입력해 주세요.")
    try:
        raw = KRCRAWL.fetch_domestic(league_name)
    except KRCRAWL.CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))

    aliases = CRAWL.list_aliases(udb, body.scope, body.code, source="kr")
    rows = CRAWL.apply_aliases(raw["rows"], aliases)
    teams = _league_teams(db, body.code)
    # unknown_teams는 안내용일 뿐 막지 않는다 — 스코어맨과 달리 여긴 "이 리그 DB에 이미
    # 있는 경기만 채우는" 백필이라, 이 라운드에 없는 경기(다른 리그로 잘못 걸렸거나
    # 아직 이 앱에 없는 경기)가 섞여 나오는 게 정상이다. 팀명 오타처럼 보이면 치환
    # UI로 고쳐 다시 가져오면 되지만, 그러지 않아도 매칭된 나머지는 그대로 저장할 수 있다.
    unknown = CRAWL.unknown_teams(rows, teams)

    df = DATA.load_league_df(db, body.code)
    matched_rows, unmatched = [], []

    def _round_norm(v):
        # "20"과 "20R"을 같은 라운드로 본다 — 사용자가 R을 안 붙여도 매칭되게.
        return re.sub(r"[Rr]$", "", str(v).strip())

    if df.empty or not {"S", "R", "HT", "AT", "No"}.issubset(df.columns):
        unmatched = [f"{r['HT']} vs {r['AT']}" for r in rows]
    else:
        season_q = str(body.season).strip()
        round_q = _round_norm(body.round)
        season_round = df[(df["S"].astype(str).str.strip() == season_q) &
                          (df["R"].astype(str).apply(_round_norm) == round_q)]
        # No뿐 아니라 S/R도 반드시 "매칭된 그 행"의 실제 값을 그대로 써야 한다 —
        # 사용자가 입력한 라운드 표기("20")가 DB 값("20R")과 다르면, 저장 시 dedup key가
        # 어긋나 새 경기로 중복 생성된다.
        row_map = {}
        for _, r in season_round.iterrows():
            key = (str(r["HT"]).strip(), str(r["AT"]).strip())
            row_map[key] = (r["S"], r["R"], float(r["No"]))

        L = _l_value(db, body.scope, body.code)
        for r in rows:
            pair = (str(r["HT"]).strip(), str(r["AT"]).strip())
            hit = row_map.get(pair)
            if hit is None:
                note = f" ({r['_note']})" if r.get("_note") else ""
                unmatched.append(f"{r['HT']} vs {r['AT']}{note}")
                continue
            s_val, r_val, no_val = hit
            matched_rows.append({
                "L": L, "S": s_val, "R": r_val, "No": no_val,
                "HT": r["HT"], "AT": r["AT"],
                "KW": r["KW"], "KD": r["KD"], "KL": r["KL"], "KH": r["KH"],
                "KHW": r["KHW"], "KHD": r["KHD"], "KHL": r["KHL"],
                "_note": r.get("_note", ""),
            })

    return {
        "count": raw["count"], "fail_cnt": raw["fail_cnt"],
        "matched": len(matched_rows), "rows": matched_rows, "unmatched": unmatched,
        "teams": teams, "unknown_teams": unknown,
    }


@app.post("/api/crawl/kr/aliases")
def crawl_kr_save_aliases(body: CrawlAliasBody, user: dict = Depends(get_current_user)):
    """국내배당(젠토토) 팀명 치환 규칙 저장 — 스코어맨 치환 규칙과는 별도로 저장된다."""
    _check_league_for(body.code, body.scope, user)
    udb = _user_db_of(user)
    n = CRAWL.save_aliases(udb, body.scope, body.code, body.mapping, source="kr")
    return {"ok": True, "saved": n,
            "aliases": CRAWL.list_aliases(udb, body.scope, body.code, source="kr")}


@app.post("/api/crawl/kr/close")
def crawl_kr_close(user: dict = Depends(get_current_user)):
    KRCRAWL.close_page()
    return {"ok": True}


class DeleteMatchesBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    season: str = "ALL"
    round: str = "ALL"   # noqa: A003
    confirm: bool = False


@app.post("/api/leagues/{code}/delete_matches")
def delete_matches(code: str, body: DeleteMatchesBody, user: dict = Depends(get_current_user)):
    """
    선택한 시즌/라운드에 해당하는 경기만 지운다 — 리그 테이블 자체나 다른 시즌
    데이터는 그대로 둔다("경기 Data 모두삭제"처럼 테이블 전체를 지우는 게 아님).
    화면 조회와 같은 필터 함수를 써서 "보이는 조건 = 지워지는 대상"이 항상 일치하게 한다.
    시즌/라운드 둘 다 "ALL"이면 사실상 리그 전체 삭제와 같다.
    """
    _check_league_for(code, body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")

    db = _resolve_scope_db(body.scope, user)
    df = DATA.load_league_df(db, code)
    if df.empty:
        raise HTTPException(status_code=404, detail="데이터가 없습니다.")

    to_delete, _, _ = _apply_league_filters(df, body.season, body.round, {})
    if to_delete.empty:
        raise HTTPException(status_code=404, detail="해당 조건에 맞는 경기가 없습니다.")

    remaining = df.drop(index=to_delete.index)

    if body.scope == PATHS.SCOPE_MASTER:
        PATHS.backup_master()   # 삭제 전 자동 백업

    con = sqlite3.connect(db)
    try:
        remaining.to_sql(code, con, if_exists="replace", index=False)
    finally:
        con.close()
    PATHS.stamp_updated(db)

    return {"deleted": len(to_delete), "remaining": len(remaining)}


# ─────────────────────────── 결과·핸디 직접 입력 ───────────────────────────
# RT(경기결과 구분)·KH(국내핸디)·FH(해외핸디)를 화면에서 바로 채워 넣는 기능.
# 크롤링은 이 세 값을 못 채우므로(RT는 판정 기준이 사용자 재량, KH·FH도 방향을 사람이
# 정해야 함) 여기서 직접 입력한다. 26개 지표·플핸예측 등 분석 컬럼은 절대 건드리지
# 않는다 — 그 세 칸만 바뀌고, 표본 재계산은 기존 업로드/재계산 경로에서만 일어난다.
RT_LABEL_TO_NUM = {"핸승": 1, "핸무": 2, "무": 3, "역": 4, "취소": 5}
HANDICAP_CHOICES = {-1.0, 1.0}
# RT/KH/FH를 뺀 나머지 직접입력 대상 — 전부 순수 숫자(스코어·배당)라 규칙이 동일하다.
SCORE_FIELDS = ("HS", "AS")
ODDS_FIELDS_EDIT = ("KW", "KD", "KL", "KHW", "KHD", "KHL", "FW", "FD", "FL", "FHW", "FHD", "FHL")
NUMERIC_EDIT_FIELDS = SCORE_FIELDS + ("KH", "FH") + ODDS_FIELDS_EDIT


@app.get("/api/leagues/{code}/edit_rows")
def edit_rows_list(code: str, scope: str = PATHS.SCOPE_MASTER,
                   season: Optional[str] = None, round: Optional[str] = None,   # noqa: A002
                   only_blank: bool = False,
                   user: dict = Depends(get_current_user)):
    """
    결과·핸디 입력 화면용 목록. 저장된 값을 불러오기만 한다(재계산 없음).
    only_blank=true면 RT·KH·FH 중 하나라도 비어 있는 경기만 돌려준다.
    """
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df(db, code)   # 원본(분석 컬럼 없이) — 재계산 대상 아님
    if df.empty:
        return {"rows": [], "season": None, "round": None}

    sub, season, round = _apply_league_filters(df, season, round, {})

    cols = ["S", "R", "No", "DT", "HT", "AT", "HS", "AS", "RT",
            "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL",
            "FW", "FD", "FL", "FH", "FHW", "FHD", "FHL"]
    cols = [c for c in cols if c in sub.columns]
    view = sub[cols].copy()
    view["RT_label"] = pd.to_numeric(view.get("RT"), errors="coerce").map(
        {v: k for k, v in RT_LABEL_TO_NUM.items()})

    if only_blank:
        blank = pd.Series(False, index=view.index)
        for c in ("RT", "KH", "FH"):
            if c in sub.columns:
                blank = blank | pd.to_numeric(sub[c], errors="coerce").isna()
        view = view[blank]

    if "S" in view.columns and "R" in view.columns and "No" in view.columns:
        sort_key = pd.DataFrame({
            "S": view["S"].astype(str),
            "R": view["R"].map(_round_sort_key),
            "No": pd.to_numeric(view["No"], errors="coerce"),
        }, index=view.index)
        view = view.loc[sort_key.sort_values(["S", "R", "No"]).index]
    return {"rows": DATA.df_to_records(view), "season": season, "round": round,
            "total": len(sub)}


class EditRowItem(BaseModel):
    S: str
    R: str
    No: float
    HT: str
    AT: str
    RT: Optional[str] = None    # '핸승'/'핸무'/'무'/'역' 또는 None(지우기)
    HS: Optional[float] = None
    AS: Optional[float] = None
    KW: Optional[float] = None
    KD: Optional[float] = None
    KL: Optional[float] = None
    KH: Optional[float] = None
    KHW: Optional[float] = None
    KHD: Optional[float] = None
    KHL: Optional[float] = None
    FW: Optional[float] = None
    FD: Optional[float] = None
    FL: Optional[float] = None
    FH: Optional[float] = None
    FHW: Optional[float] = None
    FHD: Optional[float] = None
    FHL: Optional[float] = None


class EditRowsBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    rows: list[EditRowItem]


# PH_PICK/실측/비중은 해외(F) 표본만으로 정해지고 PH_K는 완전히 독립된 값이다
# (engine.compute_plushandi 참고) — 그래서 한쪽만 다시 계산해도 이미 확정된 다른 쪽
# 예측은 절대 안 바뀐다. "26개 지표·플핸예측은 안 바뀐다" 원칙은 이미 예측이 나와 있는
# 쪽에 대해서만 지키고, 애초에 배당이 없어서 한 번도 계산된 적 없는 쪽은 이번에 배당을
# 채웠으면 그때 처음으로 계산해 준다.
_PH_SIDES = (
    ("K", "PH_K", "KW", "KL"),
    ("F", "PH_F", "FW", "FL"),
)


def _fill_missing_ph_side(df: pd.DataFrame, db: str, scope: str, touched_idx: list) -> dict:
    """
    방금 edit_rows로 값이 바뀐 행 중, 그 리그(K)/해외(F) 예측이 여태 비어 있었는데
    이번에 그 쪽 배당(승/패)이 채워진 행만 그 쪽 지표·PH_*를 새로 계산해 df에 채운다.
    다른 쪽, 그리고 이미 예측이 있던 행은 전혀 건드리지 않는다.
    """
    if not touched_idx:
        return {}
    idx = pd.Index(touched_idx).unique()
    total_df = df if _is_user_scope(scope) else DATA.load_total_df(db)
    if total_df is None or total_df.empty:
        total_df = df

    filled = {}
    for side, ph_col, w_col, l_col in _PH_SIDES:
        codes = engine.PH_K_CODES if side == "K" else engine.PH_F_CODES
        side_cols = [f"{c} {i}" for c in codes for i in (1, 2, 3, 4)] + [ph_col]
        if side == "F":
            # PICK/실측/비중은 해외(F) 표본만으로 결정되므로(engine.compute_plushandi 참고)
            # 해외 쪽이 이번에 처음 계산될 때만 같이 저장한다 — 그동안 표본·PH_F는 채워지고도
            # 이 3개 컬럼만 안 옮겨져서 픽이 영원히 빈 값으로 남던 버그.
            side_cols += ["PH_PICK", "PH_HIT", "PH_DOM"]
        for c in side_cols:
            if c not in df.columns:
                df[c] = np.nan

        ph_blank = df.loc[idx, ph_col].isna()
        has_odds = df.loc[idx, w_col].notna() & df.loc[idx, l_col].notna()
        target = idx[(ph_blank & has_odds).to_numpy()]
        if len(target) == 0:
            continue

        res = engine._recompute_indicators_for_subset(df.loc[target], df, total_df)
        for c in side_cols:
            if c in res.columns:
                df.loc[res.index, c] = res[c].values
        filled[side] = len(target)
    return filled


@app.post("/api/leagues/{code}/edit_rows")
def edit_rows_save(code: str, body: EditRowsBody, user: dict = Depends(get_current_user)):
    """
    RT와 스코어(HS/AS)·국내/해외 배당·국내/해외 핸디배당만 갱신한다.
    26개 지표·플핸예측 등 분석 컬럼은 전혀 건드리지 않는다.
    화면이 항상 그 경기의 '현재 입력 상태'를 통째로 보내므로, None은 그대로 '값 없음(공란)'
    으로 저장한다 — 부분 수정이 아니라 칸의 전체 상태를 매번 확정 짓는 방식이다.
    """
    _check_league_for(code, body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if not body.rows:
        raise HTTPException(status_code=400, detail="수정할 경기가 없습니다.")

    for item in body.rows:
        if item.RT is not None and item.RT not in RT_LABEL_TO_NUM:
            raise HTTPException(status_code=400,
                                detail=f"RT는 핸승/핸무/무/역 중 하나여야 합니다: {item.RT!r}")
        for label, val in (("KH", item.KH), ("FH", item.FH)):
            if val is not None and val not in HANDICAP_CHOICES:
                raise HTTPException(status_code=400,
                                    detail=f"{label}는 -1 또는 +1이어야 합니다: {val!r}")
        for field in SCORE_FIELDS + ODDS_FIELDS_EDIT:
            val = getattr(item, field)
            if val is not None and val < 0:
                raise HTTPException(status_code=400,
                                    detail=f"{field}는 0 이상이어야 합니다: {val!r}")

    db = _resolve_scope_db(body.scope, user)
    df = DATA.load_league_df(db, code)
    if df.empty:
        raise HTTPException(status_code=404, detail="데이터가 없습니다.")
    # 입력 대상 칸을 전부 숫자 컬럼으로 강제한다 — 한 번도 값이 안 들어간 컬럼은 전부 NULL이라
    # object dtype으로 남아 있을 수 있고, 그 상태로 저장하면 SQLite가 TEXT 타입을
    # 잡아 -1.0 같은 값이 문자열 "-1.0"으로 들어가 버린다(엑셀에서 숫자로 안 읽힘).
    for c in ("RT",) + NUMERIC_EDIT_FIELDS:
        df[c] = pd.to_numeric(df[c], errors="coerce") if c in df.columns else np.nan

    # No는 DB에 float으로 저장돼 있어 문자열 비교('1' vs '1.0')가 어긋날 수 있으므로
    # 숫자로 비교한다. S/R/HT/AT는 문자열로 비교한다.
    no_num = pd.to_numeric(df["No"], errors="coerce")
    str_cols = {c: df[c].astype(str) for c in ("S", "R", "HT", "AT")}

    updated = 0
    not_found = []
    touched_idx = []
    for item in body.rows:
        mask = (
            (str_cols["S"] == str(item.S)) & (str_cols["R"] == str(item.R)) &
            (str_cols["HT"] == item.HT) & (str_cols["AT"] == item.AT) &
            (no_num == float(item.No))
        )
        idx = df.index[mask]
        if idx.empty:
            not_found.append(f"{item.S} {item.R} No.{item.No} {item.HT} vs {item.AT}")
            continue
        df.loc[idx, "RT"] = RT_LABEL_TO_NUM.get(item.RT) if item.RT is not None else np.nan
        for field in NUMERIC_EDIT_FIELDS:
            val = getattr(item, field)
            df.loc[idx, field] = val if val is not None else np.nan
        updated += len(idx)
        touched_idx.extend(idx)

    filled_sides = _fill_missing_ph_side(df, db, body.scope, touched_idx)

    if body.scope == PATHS.SCOPE_MASTER:
        PATHS.backup_master()

    con = sqlite3.connect(db)
    try:
        df.to_sql(code, con, if_exists="replace", index=False)
    finally:
        con.close()
    PATHS.stamp_updated(db)

    return {"ok": True, "updated": updated, "not_found": not_found, "filled_prediction": filled_sides}


# ─────────────────────────── 엔진 실시간 분석 ───────────────────────────
class AnalyzeBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    league: str                       # 개별지표 기준 리그(EPL 등)
    row: dict                         # {HT,AT,FW,FD,FL,FHW,KW,KD,KL,KHW,RT?...}


@app.post("/api/analyze")
def analyze(body: AnalyzeBody, user: dict = Depends(get_current_user)):
    """
    임의 배당 1경기를 엔진으로 즉시 분석 → 26개 지표 + 플핸 예측 반환.
    개별지표는 해당 리그 DB 기준. 통합(TF-/TK-)지표는 master면 통합DB,
    내 데이터면 그 리그 하나 기준(업로드 때와 같은 규칙).
    """
    _check_league_for(body.league, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    league_df = DATA.load_league_df(db, body.league)
    total_df = league_df if _is_user_scope(body.scope) else DATA.load_total_df(db)
    if league_df.empty:
        raise HTTPException(status_code=400,
                            detail=f"{body.league} 데이터가 비어 있습니다.")

    row = pd.Series(body.row)
    result = engine.analyze_row(row, league_df, total_df)  # 캐시는 내부 생성
    return {"result": DATA.series_to_dict(result)}


# ─────────────────────────── 통합DB 탭 ───────────────────────────
def _total_league_view(db: str, league: str) -> pd.DataFrame:
    """통합DB에서 리그 선택(ALL 또는 특정 리그)만 적용한 뷰."""
    total_df = DATA.load_total_df(db)
    if total_df.empty or league == "ALL" or "Source_League" not in total_df.columns:
        return total_df
    _check_league(league)
    return total_df[total_df["Source_League"] == league]


@app.get("/api/total/filters")
def total_filters(scope: str = PATHS.SCOPE_MASTER,
                  league: str = "ALL",
                  user: dict = Depends(get_current_user)):
    """통합DB용 시즌·라운드 선택지 — 리그 필터 반영 후 계산(리그 탭의 /filters와 동일 규칙)."""
    db = _resolve_scope_db(scope, user)
    view = _total_league_view(db, league)
    if view.empty or "S" not in view.columns:
        return {"seasons": [], "rounds_by_season": {}, "latest": {"season": "ALL", "round": "ALL"}}

    seasons = sorted([s for s in view["S"].dropna().unique().tolist()], reverse=True)
    rounds_by_season = {}
    for s in seasons:
        rs = view.loc[view["S"] == s, "R"].dropna().unique().tolist()
        rs = sorted(rs, key=_round_sort_key, reverse=True)
        rounds_by_season[str(s)] = [str(x) for x in rs]

    return {
        "seasons": [str(s) for s in seasons],
        "rounds_by_season": rounds_by_season,
        # 통합DB는 "전체 현황"이 기본 화면이라, 리그 탭과 달리 최근 시즌/라운드로
        # 좁히지 않고 전체를 기본값으로 보여준다.
        "latest": {"season": "ALL", "round": "ALL"},
    }


@app.get("/api/total")
def total_view(scope: str = PATHS.SCOPE_MASTER,
              league: str = "ALL",
              season: str = "ALL",
              round: str = "ALL",   # noqa: A002
              kw: Optional[float] = None,
              kd: Optional[float] = None,
              kl: Optional[float] = None,
              khw: Optional[float] = None,
              khd: Optional[float] = None,
              khl: Optional[float] = None,
              fw: Optional[float] = None,
              fd: Optional[float] = None,
              fl: Optional[float] = None,
              limit: int = 2000,
              user: dict = Depends(get_current_user)):
    """
    통합DB(6대 리그 합산) 조회. 리그·시즌·라운드·배당 9종 필터 + RT 결과분포 요약.
    저장된 값을 불러오기만 한다 (재계산은 /api/recompute/* 별도 호출).
    """
    db = _resolve_scope_db(scope, user)
    total_df = DATA.load_total_df(db)
    if total_df.empty:
        return {"columns": [], "rows": [], "total": 0, "grand_total": 0,
                "seasons": [], "season": None, "round": None, "rt_summary": None}

    view = _total_league_view(db, league)

    seasons = sorted(view["S"].dropna().astype(str).unique().tolist(), reverse=True) \
        if "S" in view.columns else []

    view, season, round = _apply_league_filters(
        view, season, round,
        {"KW": kw, "KD": kd, "KL": kl, "KHW": khw, "KHD": khd,
         "KHL": khl, "FW": fw, "FD": fd, "FL": fl})

    rt_summary = _rt_summary(view)

    return {
        "columns": list(total_df.columns),
        "rows": DATA.df_to_records(view.head(limit)),
        "total": len(view),
        "grand_total": len(total_df),
        "seasons": seasons,
        "season": season,
        "round": round,
        "rt_summary": rt_summary,
    }


# ─────────────────────────── 재계산 (통합DB 탭 버튼 2종) ───────────────────────────
class RecomputeBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    confirm: bool = False   # 전체 재계산 시 "확인" 체크 여부(프론트에서 강제)


@app.post("/api/recompute/pending")
def recompute_pending(body: RecomputeBody, user: dict = Depends(get_current_user)):
    """RT 없는 예정 경기만 최신 통합DB 기준으로 재계산 (과거 경기 무수정)."""
    db = _resolve_scope_db(body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    summary = engine.recompute_pending_matches(db)
    return {"summary": summary}


@app.post("/api/recompute/all")
def recompute_all(body: RecomputeBody, user: dict = Depends(get_current_user)):
    """과거 경기 포함 전체 재계산 (초기 세팅/오류 수정용, 느림). confirm=true 필수."""
    db = _resolve_scope_db(body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    summary = engine.recompute_all_matches(db)
    return {"summary": summary}


# ─────────────────────────── 재계산 ('내 데이터' 리그 1개 전용) ───────────────────────────
# engine.recompute_pending_matches/all(위)은 PATHS.LEAGUES(공식 6대리그) 테이블명을
# 그대로 훑기 때문에 'ul_1' 같은 내 데이터 테이블에는 아예 적용되지 않는다 — 그래서
# 국내배당을 새로 올려도 26개 지표·플핸예측이 저절로 다시 계산되지 않았다.
# engine.py는 계산 로직 수정 금지 대상이라, 그 함수는 그대로 두고 '내 데이터는 리그별로
# 완전 독립'이라는 원칙(다른 곳과 동일)에 따라 그 리그 하나만 재계산하는 버전을 여기 둔다.
class LeagueRecomputeBody(BaseModel):
    scope: str = PATHS.SCOPE_USER
    include_historical: bool = False
    confirm: bool = False


def _recompute_user_league(db: str, code: str, include_historical: bool) -> dict:
    league_df = DATA.load_league_df(db, code)
    if league_df.empty or "RT" not in league_df.columns:
        return {code: 0}

    rt_num = pd.to_numeric(league_df["RT"], errors="coerce")
    mask = pd.Series(True, index=league_df.index) if include_historical else rt_num.isna()
    n_target = int(mask.sum())
    if n_target == 0:
        return {code: 0}

    sub = league_df[mask]
    # 내 데이터는 통합(TF-/TK-) 지표도 그 리그 하나만으로 계산한다 — league_full_df와
    # total_df에 같은 league_df를 준다(_merge_and_save가 이미 쓰는 것과 같은 규칙).
    new_ind = engine._recompute_indicators_for_subset(sub, league_df, league_df)
    for c in new_ind.columns:
        if c not in league_df.columns:
            league_df[c] = np.nan
        league_df.loc[new_ind.index, c] = new_ind[c].values

    con = sqlite3.connect(db)
    try:
        league_df.to_sql(code, con, if_exists="replace", index=False)
    finally:
        con.close()
    PATHS.stamp_updated(db)
    return {code: n_target}


@app.post("/api/leagues/{code}/recompute")
def league_recompute(code: str, body: LeagueRecomputeBody, user: dict = Depends(get_current_user)):
    """
    '내 데이터' 리그 하나만 26개 지표·플핸예측을 다시 계산한다(그 리그 자신만 표본으로 씀).
    공식 데이터(6대리그)는 통합DB 탭의 /api/recompute/pending·all을 그대로 쓴다.
    """
    if not _is_user_scope(body.scope):
        raise HTTPException(status_code=400, detail="이 기능은 내 데이터 리그에서만 씁니다.")
    _check_league_for(code, body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if body.include_historical and not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    db = _resolve_scope_db(body.scope, user)
    summary = _recompute_user_league(db, code, body.include_historical)
    return {"summary": summary}


# ─────────────────────────── 상대전적 탭 ───────────────────────────
@app.get("/api/teams")
def teams(scope: str = PATHS.SCOPE_MASTER,
         code: Optional[str] = None,
         season: Optional[str] = None,
         user: dict = Depends(get_current_user)):
    """
    팀명 목록(상대전적 탭/리그탭 필터의 팀 선택용).
    code 지정 시 해당 리그로 한정(미지정 시 통합DB 전체 — 상대전적 탭에서 사용).
    season 지정("ALL" 제외) 시 그 시즌에 등장한 팀만으로 추가 제한.
    """
    db = _resolve_scope_db(scope, user)
    if code:
        _check_league_for(code, scope, user)
        df = DATA.load_league_df(db, code)
    else:
        df = DATA.load_total_df(db)
    if df.empty or "HT" not in df.columns or "AT" not in df.columns:
        return {"teams": []}
    if season and season != "ALL" and "S" in df.columns:
        df = df[df["S"].astype(str) == str(season)]
    names = set(df["HT"].dropna().astype(str).unique()) | \
        set(df["AT"].dropna().astype(str).unique())
    return {"teams": sorted(names)}


# ─────────────────────────── 🛠 마스터 관리 (관리자 전용) ───────────────────────────
@app.get("/api/admin/master/status")
def admin_master_status(admin: dict = Depends(get_admin_user)):
    mdb = PATHS.get_master_db()
    backups = [
        {"name": os.path.basename(p), "size_mb": PATHS.db_filesize_mb(p)}
        for p in PATHS.list_backups()
    ]
    return {
        "rows": PATHS.league_dashboard(mdb),
        "total_rows": PATHS.db_total_rows(mdb),
        "file_path": mdb,
        "size_mb": PATHS.db_filesize_mb(mdb),
        "updated_at": PATHS.get_meta(mdb, "updated_at"),
        "backups": backups,
    }


@app.post("/api/admin/master/backup")
def admin_master_backup(admin: dict = Depends(get_admin_user)):
    path = PATHS.backup_master()
    if not path:
        raise HTTPException(status_code=400, detail="백업할 데이터가 없습니다.")
    return {"name": os.path.basename(path)}


class RestoreBody(BaseModel):
    name: str
    confirm: bool = False


@app.post("/api/admin/master/restore")
def admin_master_restore(body: RestoreBody, admin: dict = Depends(get_admin_user)):
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    # 클라이언트가 임의 경로를 보낼 수 없도록, 실제 백업 목록에서만 이름을 찾는다.
    match = next((p for p in PATHS.list_backups() if os.path.basename(p) == body.name), None)
    if not match:
        raise HTTPException(status_code=404, detail="백업 파일을 찾을 수 없습니다.")
    try:
        PATHS.restore_backup(match)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"롤백 실패: {e}")
    return {"ok": True}


class DeleteLeagueBody(BaseModel):
    league: str
    confirm: bool = False


@app.post("/api/admin/master/delete_league")
def admin_master_delete_league(body: DeleteLeagueBody, admin: dict = Depends(get_admin_user)):
    _check_league(body.league)
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    mdb = PATHS.get_master_db()
    PATHS.backup_master()   # 삭제 전 자동 백업
    con = sqlite3.connect(mdb)
    try:
        con.execute(f'DROP TABLE IF EXISTS "{body.league}"')
        con.commit()
    finally:
        con.close()
    PATHS.stamp_updated(mdb)
    return {"ok": True}


# ─────────────────────────── 👑 계정 관리 (관리자 전용) ───────────────────────────
@app.get("/api/admin/users")
def admin_list_users(admin: dict = Depends(get_admin_user)):
    return {"users": AUTH.list_users(PATHS.get_auth_db())}


class AddUserBody(BaseModel):
    username: str
    password: str
    expiry: str = "permanent"
    role: str = "user"
    start_date: Optional[str] = None   # 비우면 오늘 날짜로 자동 설정


@app.post("/api/admin/users")
def admin_add_user(body: AddUserBody, admin: dict = Depends(get_admin_user)):
    if not PATHS.is_valid_username(body.username.strip()):
        raise HTTPException(status_code=400,
                            detail="아이디 형식 오류: 영문/숫자/_/- 3~32자만 사용 가능합니다.")
    ok, msg = AUTH.add_user(PATHS.get_auth_db(), body.username, body.password,
                            body.expiry, body.role, start_date=body.start_date)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    try:
        PATHS.on_account_created(body.username.strip())
    except Exception as e:
        return {"ok": True, "msg": msg, "warning": f"데이터 공간 생성 실패: {e}"}
    return {"ok": True, "msg": msg}


class ExpiryBody(BaseModel):
    expiry: str


@app.post("/api/admin/users/{username}/expiry")
def admin_update_expiry(username: str, body: ExpiryBody, admin: dict = Depends(get_admin_user)):
    ok, msg = AUTH.update_expiry(PATHS.get_auth_db(), username, body.expiry)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "msg": msg}


class StartDateBody(BaseModel):
    start_date: str


@app.post("/api/admin/users/{username}/start_date")
def admin_update_start_date(username: str, body: StartDateBody,
                            admin: dict = Depends(get_admin_user)):
    ok, msg = AUTH.update_start_date(PATHS.get_auth_db(), username, body.start_date)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "msg": msg}


class PasswordBody(BaseModel):
    password: str


@app.post("/api/admin/users/{username}/password")
def admin_change_password(username: str, body: PasswordBody, admin: dict = Depends(get_admin_user)):
    ok, msg = AUTH.change_password(PATHS.get_auth_db(), username, body.password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "msg": msg}


@app.delete("/api/admin/users/{username}")
def admin_delete_user(username: str, confirm: bool = False,
                      admin: dict = Depends(get_admin_user)):
    if not confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    if username == admin["username"]:
        raise HTTPException(status_code=400, detail="현재 로그인한 본인 계정은 삭제할 수 없습니다.")
    ok, msg = AUTH.delete_user(PATHS.get_auth_db(), username)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    try:
        PATHS.on_account_deleted(username)
    except Exception as e:
        return {"ok": True, "msg": msg, "warning": f"폴더 삭제 실패: {e}"}
    return {"ok": True, "msg": msg}


# ─────────────────────────── 👑 고객 데이터 열람 (C안: 읽기전용 + 로그) ───────────────────────────
@app.get("/api/admin/customer_data")
def admin_customer_data(admin: dict = Depends(get_admin_user)):
    return {"customers": PATHS.user_storage_summary()}


@app.get("/api/admin/customer_data/{username}/leagues")
def admin_customer_leagues(username: str, admin: dict = Depends(get_admin_user)):
    """고객이 데이터를 올려둔 리그 목록. 고객이 직접 만든 리그도 함께 보여준다."""
    udb = PATHS.get_user_db(username)
    out = [{"code": d["코드"], "label": d["리그"], "rows": d["경기수"]}
           for d in PATHS.league_dashboard(udb) if d["경기수"] > 0]
    for lg in USERLG.list_leagues(udb):
        n = PATHS.table_row_count(udb, lg["code"])
        if n > 0:
            out.append({"code": lg["code"], "label": lg["label"], "rows": n})
    return {"leagues": out}


_CUSTOMER_VIEW_COLS = ["L", "S", "R", "No", "DT", "TM", "HT", "HS", "RT", "AS", "AT",
                       "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL",
                       "FW", "FD", "FL", "FH", "FHW", "FHD", "FHL"]


@app.get("/api/admin/customer_data/{username}/{league}")
def admin_view_customer_data(username: str, league: str, admin: dict = Depends(get_admin_user)):
    """
    고객 업로드 원본을 읽기전용으로 열람. 관리자는 물리적으로 수정할 수 없다
    (읽기전용 접속). 열람 시 access_log 에 기록되어 분쟁 시 근거가 된다.
    """
    udb = PATHS.get_user_db(username)
    # 고객 DB는 6대리그(옛 데이터)와 고객이 직접 만든 리그가 섞여 있을 수 있다.
    if league not in PATHS.VALID_LEAGUES and league not in USERLG.valid_codes(udb):
        raise HTTPException(status_code=404, detail=f"알 수 없는 리그: {league}")
    try:
        con = sqlite3.connect(f"file:{udb}?mode=ro", uri=True)
        try:
            df = pd.read_sql(f'SELECT * FROM "{league}"', con)
        finally:
            con.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"열람 실패: {e}")

    PATHS.log_access(admin["username"], username, league, "view", len(df))
    show_cols = [c for c in _CUSTOMER_VIEW_COLS if c in df.columns]
    view = df[show_cols] if show_cols else df
    return {"columns": list(view.columns), "rows": DATA.df_to_records(view), "total": len(view)}


@app.get("/api/admin/access_log")
def admin_access_log(admin: dict = Depends(get_admin_user)):
    return {"logs": PATHS.list_access_log(100)}
