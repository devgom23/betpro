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
import base64
import io
import os
import re
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta
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
import scoreman_odds as SCOREMAN  # noqa: E402
import final_indicators as FINALIND  # noqa: E402
import my_picks as MYPICKS     # noqa: E402
import bet_slips as BETSLIPS   # noqa: E402
import pick_ai as PICKAI       # noqa: E402
import combo_dir as COMBODIR   # noqa: E402
import standings               # noqa: E402
from deps import get_current_user, get_admin_user, COOKIE_NAME  # noqa: E402

# React 개발 서버(Vite=5173, CRA=3000) 등 허용 오리진
ALLOWED_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
]

app = FastAPI(title="BETPRO API", version="2.0.0",
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
    별도 스레드로 미리 데워둔다. 실패해도(파일 없음 등) 서버 기동에는 영향 없다.

    통합DB(load_total_df)도 같이 데운다 — 상세보기 팝업이 상대전적을 뽑을 때 쓰는데,
    리그 6개만 데워 놓으면 팝업을 처음 열 때 여기서 다시 합치느라 기다려야 했다."""
    import threading

    def _warm():
        try:
            db_path = PATHS.get_master_db()
            for lg in DATA.LEAGUES:
                DATA.load_league_df(db_path, lg)
            DATA.load_total_df(db_path)        # 통합DB 탭이 쓰는 전체 표
            DATA.load_total_h2h_df(db_path)    # 상세보기(상대전적)가 쓰는 슬림 표
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
    5(취소)·6(연기)는 실제 결과가 아니라서 제외 — 안 그러면 "총"이 4개 항목 합계보다 커진다."""
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


def _hit_summary(verdict: pd.Series):
    """내픽 적중/보험/미적 카운트 {적중,보험,미적,총}. (2026-08~ 내픽 기준으로 변경 —
    예전엔 모델의 사전예측(PH_PICK)이 실제와 맞았는지를 셌지만, "내가 찍은 픽이
    맞았는지"를 보고 싶다는 요청으로 _my_pick_verdict_series() 결과를 대신 센다.)
    유효한 판정이 하나도 없으면(내픽을 하나도 안 찍었으면) None."""
    if verdict is None or verdict.empty:
        return None
    s = verdict.fillna("")
    counts = {"적중": int((s == "적중").sum()), "보험": int((s == "보험").sum()),
              "미적": int((s == "미적").sum())}
    total = counts["적중"] + counts["보험"] + counts["미적"]
    if total == 0:
        return None
    counts["총"] = total
    return counts


def _odds_summary(df: pd.DataFrame):
    """조회 조건 안에서 국배(KW)·해배(FW)가 실제로 채워진 경기 수 {국배,해배,총}.
    엑셀 업로드·크롤링 모두 한 시장(국내/해외)의 승/무/패를 항상 함께 채우므로,
    대표로 W값 하나만 봐도 그 시장 등록 여부를 알 수 있다. 시즌별로 배당 입력이
    얼마나 진행됐는지 보려고 만든 것 — 내픽 적중/보험/미적 요약(_hit_summary)은 내픽을
    안 찍은 경기가 많으면 표본이 작아지니 이걸로 대체."""
    total = len(df)
    if total == 0:
        return None
    kw = pd.to_numeric(df["KW"], errors="coerce") if "KW" in df.columns else pd.Series(dtype="float64")
    fw = pd.to_numeric(df["FW"], errors="coerce") if "FW" in df.columns else pd.Series(dtype="float64")
    return {"국배": int(kw.notna().sum()), "해배": int(fw.notna().sum()), "총": total}


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
    df = DATA.load_league_df_ev(db, code)
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
    # "결과 없음" 86건이 전부 같은 게 아니다(2026-08-28 실측 — 에레디비지에 86건 중
    # 취소 74 · 미정 11 · 연기 1). pending_count(기존, 하위호환용)는 셋을 합친 값 그대로
    # 두고, 화면에 따로 보여주려는 쪽을 위해 취소·연기만 따로 센다.
    rt_num = pd.to_numeric(df["RT"], errors="coerce") if "RT" in df.columns else pd.Series(dtype=float)
    cancelled_count = int((rt_num == 5).sum())
    postponed_count = int((rt_num == 6).sum())
    return {
        "seasons": [str(s) for s in seasons],
        "rounds_by_season": rounds_by_season,
        "latest": {"season": latest_season, "round": latest_round},
        "total_rows": len(df),
        "rt_summary": rt_summary,
        "hit_summary": _hit_summary(_my_pick_verdict_series(df, user["username"], code, scope)),
        # 리그 관리 박스(내 데이터 재계산 버튼 옆)에 쓰는 요약 — 통합DB 탭 대시보드 표와 같은 항목.
        "season_range": f"{seasons[-1]} ~ {seasons[0]}" if seasons else "-",
        "pending_count": len(df) - rt_total,
        "cancelled_count": cancelled_count,
        "postponed_count": postponed_count,
        "kw_count": int(df["KW"].notna().sum()) if "KW" in df.columns else 0,
        "fw_count": int(df["FW"].notna().sum()) if "FW" in df.columns else 0,
    }


ODDS_FILTER_COLS = ["KW", "KD", "KL", "KHW", "KHD", "KHL", "FW", "FD", "FL"]
ODDS_TOLERANCE = 0.005   # 원본 조회 필터와 동일한 부동소수 오차 허용


def _reorder_postponed_last(df: pd.DataFrame, rt_col: str = "RT", rt_is_label: bool = False) -> pd.DataFrame:
    """연기(RT=6) 경기를 같은 시즌+라운드 안에서 맨 아래로 보낸다.
    No 값 자체는 절대 안 건드린다 — my_picks/bet_slips가 (S,R,No,HT,AT)로 경기를 찾기
    때문에 No를 바꾸면 이미 저장된 별표·메모·베팅내역이 조용히 끊어진다. 그래서 화면에
    보여주는 '순서'만 바꾸고, 같은 라운드 안에서 연기가 아닌 경기끼리·연기끼리는
    원래 순서(No 순서) 그대로 유지한다."""
    if df.empty or "S" not in df.columns or "R" not in df.columns or rt_col not in df.columns:
        return df
    post = (df[rt_col] == "연기") if rt_is_label else (pd.to_numeric(df[rt_col], errors="coerce") == 6)
    if not post.any():
        return df
    grp = df["S"].astype(str) + "\x00" + df["R"].astype(str)
    grp_order = grp.map({g: i for i, g in enumerate(dict.fromkeys(grp))})
    order = pd.DataFrame({
        "grp_order": grp_order, "post": post.astype(int), "orig": np.arange(len(df)),
    }, index=df.index).sort_values(["grp_order", "post", "orig"], kind="mergesort").index
    return df.loc[order]


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

    sub = _reorder_postponed_last(sub)
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
    # 표시용 순위(HP/AP) + 베팅 기대수익률(EV) 컬럼까지 붙은 표.
    # DB에 저장하지 않고 조회 때 계산하는 값이라, 경기가 쌓이면 값도 같이 갱신된다
    # (DB가 바뀌면 캐시가 풀리므로 — data_access.load_league_df_ev 참고).
    df = DATA.load_league_df_ev(db, code)
    if df.empty:
        # 데이터가 아직 없어도 can_write는 반드시 내려줘야 한다.
        # 이게 빠지면 "비어 있는 리그에 업로드" UI가 사라져 첫 등록 자체가 막힌다.
        return {"columns": [], "rows": [], "total": 0,
                "season": None, "round": None, "rt_summary": None, "hit_summary": None,
                "odds_summary": None,
                "can_write": PATHS.can_write(scope, user.get("role"))}

    sub, season, round = _apply_league_filters(
        df, season, round,
        {"KW": kw, "KD": kd, "KL": kl, "KHW": khw, "KHD": khd,
         "KHL": khl, "FW": fw, "FD": fd, "FL": fl})

    total = len(sub)
    page = sub.iloc[offset: offset + limit]
    # 승+패 배당 조합 방향성 — 보이는 행에만 붙인다(전체에 붙이면 헛일이 크다).
    page = COMBODIR.attach(page, DATA.load_combo_index(db), code)
    records = DATA.df_to_records(page)
    _attach_my_picks(records, user["username"], code, scope)
    return {
        "columns": list(df.columns) + COMBODIR.COLS
                   + ["IMPORTANT", "MY_PICK", "MY_P", "MY_HIT"],
        "rows": records,
        "total": total,
        "season": season,
        "round": round,
        "rt_summary": _rt_summary(sub),
        "hit_summary": _hit_summary(_my_pick_verdict_series(sub, user["username"], code, scope)),
        "odds_summary": _odds_summary(sub),
        "can_write": PATHS.can_write(scope, user.get("role")),
    }


# ───────────────── 시즌 지표 (똥배 격자 / 결과 격자 / 라운드 이력) ─────────────────
# 조회 조건이 "시즌 1개 + 라운드 1개"로 좁혀졌을 때만 만든다(사용자 지정) — 전체 조회에서는
# 라운드 축 자체가 의미가 없어 계산하지 않는다.
DDONG_MAX = 1.49          # 똥배 기준: 국내배당(KW/KL) 중 낮은 쪽이 이 값 이하 (표 컬럼과 동일 규칙)
_RT_MAIN = (1, 2, 3, 4)   # 취소(5)·연기(6)·결과없음은 어느 표에서도 세지 않는다


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
    """조회된 행마다 이 계정이 표시한 중요 별표(IMPORTANT — 0=없음/1=반개·보류/2=온별·
    중요)/내픽(MY_PICK)/P태그(MY_P)/적중여부(MY_HIT)/메모(MEMO)를 붙인다."""
    picks = MYPICKS.list_my_picks(username, code, scope)
    by_key = {_my_pick_key(p["S"], p["R"], p["No"], p["HT"], p["AT"]): p for p in picks}
    for row in records:
        p = by_key.get(_my_pick_key(row.get("S"), row.get("R"), row.get("No"), row.get("HT"), row.get("AT")))
        row["IMPORTANT"] = int(p["starred"]) if p else 0
        row["MY_PICK"] = p["pick"] if p else None
        row["MY_P"] = p["p"] if p else None
        row["MY_HIT"] = p["hit"] if p else None
        row["MEMO"] = p["memo"] if p else None
        row["MEMO_PRE"] = p["memo_pre"] if p else None
        row["REASON_TAG"] = p["reason_tag"] if p else None


# 내픽(MY_PICK)+RT 대조 규칙 — web/src/components/LeagueTable/columnGroups.js의
# PICK_VERDICT_MAP·computeAutoVerdict과 반드시 같은 값을 내야 한다(표 안 배지와
# 상단 요약 뱃지가 서로 다른 기준이면 안 되므로 로직을 그대로 복제했다 — 한쪽만
# 고치지 않도록 주의). 픽마다 "적중으로 치는 결과"·"보험(부분 환급)으로 치는
# 결과"가 다르다. 값 형식: {픽: (적중 RT코드 집합, 보험 RT코드 집합)}.
_MY_PICK_VERDICT_MAP = {
    "플핸무": ({3, 4}, {2}),
    "정무": ({1, 2}, {3}),
    "무핸무": ({2, 3}, set()),
    "플핸": ({3, 4}, set()),
    "정": ({1, 2}, set()),
    "핸승": ({1}, set()),
    "핸무": ({2}, set()),
    "무": ({3}, set()),
    "역": ({4}, set()),
}


def _my_pick_verdict(pick, rt) -> str:
    """내픽 하나 + RT 하나 → 적중/보험/미적. ''(빈 값)은 아직 판정 불가한 경우
    (내픽 없음·'대기'·결과 미정)."""
    if not pick or pd.isna(rt):
        return ""
    rule = _MY_PICK_VERDICT_MAP.get(pick)
    if not rule:
        return ""
    code = int(rt)
    if code not in (1, 2, 3, 4):
        return ""
    hit, insure = rule
    if code in hit:
        return "적중"
    if code in insure:
        return "보험"
    return "미적"


def _my_pick_verdict_series(df: pd.DataFrame, username: str, code: str, scope: str) -> pd.Series:
    """조회된 경기 전부(페이지 단위가 아니라 조회 조건에 맞는 전체)에 내픽 적중/보험/
    미적을 대조한다 — 상단 요약 뱃지가 표에 찍힌 낱개 배지와 항상 같은 기준을 쓰도록."""
    if df.empty:
        return pd.Series([], dtype=object)
    picks = MYPICKS.list_my_picks(username, code, scope)
    pick_map = {_my_pick_key(p["S"], p["R"], p["No"], p["HT"], p["AT"]): p["pick"] for p in picks}
    rt_num = pd.to_numeric(df["RT"], errors="coerce") if "RT" in df.columns else pd.Series(np.nan, index=df.index)
    s_col = df["S"] if "S" in df.columns else pd.Series(None, index=df.index)
    r_col = df["R"] if "R" in df.columns else pd.Series(None, index=df.index)
    no_col = df["No"] if "No" in df.columns else pd.Series(None, index=df.index)
    ht_col = df["HT"] if "HT" in df.columns else pd.Series(None, index=df.index)
    at_col = df["AT"] if "AT" in df.columns else pd.Series(None, index=df.index)
    out = [
        _my_pick_verdict(pick_map.get(_my_pick_key(s, r, no, ht, at)), rt)
        for s, r, no, ht, at, rt in zip(s_col, r_col, no_col, ht_col, at_col, rt_num)
    ]
    return pd.Series(out, index=df.index, dtype=object)


class MyPickBody(BaseModel):
    scope: str
    # 프론트가 표 행 값을 그대로 보내다 보니 No처럼 숫자로 오는 필드도 있다 —
    # 매칭 키는 문자열로 통일해서 저장하므로(upsert_my_pick), 여기선 원시 타입만 받아둔다.
    S: Union[str, int, float]
    R: Union[str, int, float]
    No: Union[str, int, float]
    HT: Union[str, int, float]
    AT: Union[str, int, float]
    # 0=표시 없음 / 1=반개(보류·고민중) / 2=온별(중요). upsert_my_pick이 0~2로 다시 자른다.
    starred: int = 0
    pick: Optional[str] = None
    p: Optional[str] = None
    hit: Optional[str] = None
    memo: Optional[str] = None
    memo_pre: Optional[str] = None
    reason_tag: Optional[str] = None


@app.post("/api/leagues/{code}/my_picks")
def save_my_pick(code: str, body: MyPickBody, user: dict = Depends(get_current_user)):
    """중요 별표/내픽/P태그/적중여부/메모(경기전·결과반성)/결과반성 태그 저장 — 계정
    개인 기록이라 scope(공식/내 데이터)와 무관하게 본인만 본다."""
    MYPICKS.upsert_my_pick(
        user["username"], code, body.scope,
        body.S, body.R, body.No, body.HT, body.AT,
        body.starred, body.pick, body.hit, body.memo, body.p, body.reason_tag,
        body.memo_pre,
    )
    return {"ok": True}


class SeasonNoteBody(BaseModel):
    scope: str = PATHS.SCOPE_USER
    season: str
    round: str
    memo: Optional[str] = None


@app.get("/api/leagues/{code}/season_note")
def get_season_note(code: str, scope: str = PATHS.SCOPE_USER,
                    season: str = "", round: str = "",   # noqa: A002
                    user: dict = Depends(get_current_user)):
    """'시즌 지표 ③ 과거 이력'에 단 메모 — 경기 하나가 아니라 리그+시즌+라운드 하나에 1개뿐."""
    _check_league_for(code, scope, user)
    memo = MYPICKS.get_season_note(user["username"], code, scope, season, round)
    return {"memo": memo}


@app.post("/api/leagues/{code}/season_note")
def save_season_note(code: str, body: SeasonNoteBody, user: dict = Depends(get_current_user)):
    _check_league_for(code, body.scope, user)
    MYPICKS.upsert_season_note(user["username"], code, body.scope, body.season, body.round, body.memo)
    return {"ok": True}


# ─────────────────────────── 상대전적 (상세 팝업용) ───────────────────────────
# 5="취소"는 아예 열리지 않은 경기(리그 자체 취소 등), 6="연기"는 날짜만 미뤄져
# 나중에 치러질 경기 표시용이다. 연기 경기는 실제로 열린 뒤 1~4로 고쳐 넣으면 된다.
# 둘 다 실제 결과가 아니므로 어느 집계에도 안 들어간다 — engine.py의
# 26개 지표 표본 카운트는 RT==1~4로만 매칭해서(get_samples_fast) 5·6은 자동으로 제외되므로
# 계산 로직에는 영향이 없다.
RT_LABELS = {1: "핸승", 2: "핸무", 3: "무", 4: "역", 5: "취소", 6: "연기"}


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


def _row_order_sort_key(df: pd.DataFrame) -> pd.DataFrame:
    """리그 표를 DB에 다시 쓸 때 물리적 행 순서를 정하는 키 — 시즌 -> 라운드 -> 실제
    경기일(베팅일 기준) -> No 순. No 값 자체는 절대 바꾸지 않는다(정렬에만 쓴다).

    연기됐다가 나중에 다른 날짜로 재편성된 경기는 원래 No가 그 라운드 안에서 훨씬
    이른 순번을 갖고 있어도(예: 라리가 26-27 1R 5번 셀타비고-오사수나, 원래 8/17
    예정이 8/27로 밀림) 실제 뛴 날짜를 기준으로 자리가 잡힌다 — No만 보고 정렬하면
    이런 경기가 표에서 엉뚱한 위치에 끼어 보인다.
    DT가 아직 비어 있으면(다음 재편성 날짜 미정) 그 라운드 맨 뒤로 보낸다.
    """
    s = df["S"].astype(str) if "S" in df.columns else pd.Series([""] * len(df), index=df.index)
    r = df["R"].map(_round_sort_key) if "R" in df.columns else pd.Series([0] * len(df), index=df.index)
    no = pd.to_numeric(df["No"], errors="coerce") if "No" in df.columns else pd.Series(np.nan, index=df.index)
    if "DT" in df.columns:
        tm_col = df["TM"] if "TM" in df.columns else pd.Series([None] * len(df), index=df.index)
        days, orders = [], []
        for dt_val, tm_val in zip(df["DT"], tm_col):
            # _betting_day_sort_key는 TM이 NaN이면 int(NaN)에서 죽는다(원래 호출부는
            # 항상 유효한 TM만 넘겨서 안 걸렸다) — 여기선 리그 표 전체를 훑으므로
            # TM이 비어 있는 옛날 경기도 나온다. None으로 미리 걸러 준다.
            tm_safe = tm_val if pd.notna(tm_val) else None
            d, o = _betting_day_sort_key(dt_val, tm_safe)
            if not _DT_RE.search(str(dt_val or "")):
                d = "9999-99-99"    # 날짜 미정 — 그 라운드 맨 뒤
            days.append(d)
            orders.append(o)
    else:
        days = [""] * len(df)
        orders = [0.0] * len(df)
    return pd.DataFrame({"S": s, "_r": r, "_day": days, "_order": orders, "_no": no}, index=df.index)


def _scope_league_labels(scope: str, user: dict) -> dict:
    """리그 코드 → 화면에 쓰는 리그명(라벨). 내 데이터는 사용자가 리그 생성 시
    직접 지은 이름(예: ul_2 → 'K2')이라 코드만으론 알아볼 수 없어 따로 매핑해준다."""
    if scope == PATHS.SCOPE_USER:
        return {lg["code"]: lg["label"] for lg in USERLG.list_leagues(_resolve_scope_db(scope, user))}
    return dict(PATHS.LEAGUE_LABEL)


@app.get("/api/weekly_picks")
def weekly_picks(user: dict = Depends(get_current_user)):
    """공식 데이터·내 데이터를 가리지 않고 별표(★=온별, starred==2)로 표시한 경기를
    전부 모아 보여준다. 반개(★반개=보류·고민중, starred==1)는 아직 확정 전이라 여기
    안 넣는다 — "이번주 벳"은 실제로 조합을 짤 대상이라 확정된 것만 섞여야 한다.
    리그 표와 같은 컬럼 구성을 그대로 쓰되 어느 리그 경기인지 알 수 있도록
    L(리그 코드)을 채워서 내려준다."""
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
                if p["starred"] == 2 and not p["wp_hidden"]
            }
            if not starred:
                continue
            # 핸승 위험도(RISK/WIN_RISK/WIN_RISK_F/AI_PICK/K_VALUE/F_VALUE/KF_AI)까지 붙은 표.
            df = DATA.load_league_df_ev(db, code)
            if df.empty:
                continue
            # 위험도 계산엔 리그 전체 이력이 필요해 df 자체는 그대로 두지만, 별표 몇 개 보자고
            # 수천 행×200개 컬럼을 전부 JSON 직렬화(df_to_records)할 필요는 없다 —
            # 여기서 별표 찍힌 행만 먼저 추려서 그만큼만 변환한다(리그당 실측 0.3~0.5초 절약).
            # 찾는 방향도 뒤집었다 — 예전엔 별표 하나 찾자고 리그 전체(수천 행)를 훑으며
            # 행마다 키를 새로 만들었다(실측 179ms/요청). 키→행번호 표를 캐시해 두고
            # 별표 개수만큼만 조회한다.
            key_index = _pick_key_index(db, code)
            keep_idx = sorted(key_index[k] for k in starred if k in key_index)
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
                rec["IMPORTANT"] = 2
                rec["MY_PICK"] = p["pick"]
                rec["MY_P"] = p["p"]
                rec["MY_HIT"] = p["hit"]
                rec["MEMO"] = p["memo"]
                rec["MEMO_PRE"] = p["memo_pre"]
                rows.append(rec)

    rows.sort(key=lambda r: _betting_day_sort_key(r.get("DT"), r.get("TM")))
    columns = ["L"] + [c for c in (list(rows[0].keys()) if rows else [])
                       if c not in ("L", "L_LABEL", "scope")]
    return {"columns": columns, "rows": rows, "total": len(rows)}


# ─────────────────────────── 이번주 리스트 (요일별 전체 목록) ───────────────────────────
# 국내 프로토는 한 주를 '금~화'와 '수~목' 두 회차로 끊는다. 이 화면도 같은 단위로 보여준다
# — 오늘이 속한 묶음 하나만 띄우고, 수요일이 되면 자동으로 '수~목' 묶음으로 넘어간다.
_BLOCK_FRI_TUE = (4, 5)   # (기준요일 Fri=4, 길이 5일: 금·토·일·월·화)
_BLOCK_WED_THU = (2, 2)   # (기준요일 Wed=2, 길이 2일: 수·목)


def _current_week_block(today: date) -> tuple:
    """오늘이 속한 회차 묶음의 (시작일, 종료일, 라벨)."""
    wd = today.weekday()          # 월=0 … 일=6
    anchor, span = _BLOCK_WED_THU if wd in (2, 3) else _BLOCK_FRI_TUE
    start = today - timedelta(days=(wd - anchor) % 7)
    end = start + timedelta(days=span - 1)
    label = "수~목" if (anchor, span) == _BLOCK_WED_THU else "금~화"
    return start, end, label


@app.get("/api/week_list")
def week_list(start: Optional[str] = None, end: Optional[str] = None,
              user: dict = Depends(get_current_user)):
    """
    이번 회차(금~화 또는 수~목)에 열리는 경기를 공식·내 데이터 가리지 않고 전부 모은다.
    별표(★) 여부와 무관하게 그 기간의 모든 경기를 내려준다 — 이번주 픽(별표만)과 다른 점.
    start/end(YYYY-MM-DD)를 주면 그 구간을, 안 주면 오늘이 속한 묶음을 쓴다.

    기간 판정은 '베팅일' 기준이다(새벽 6시 이전 경기는 전날 묶음) — 화면에서 요일별로
    나누는 규칙(columnGroups.js bettingDayOf)과 어긋나면 구간 경계 경기가 사라져 보인다.
    """
    today = date.today()
    if start and end:
        try:
            d0 = date.fromisoformat(start)
            d1 = date.fromisoformat(end)
        except ValueError:
            raise HTTPException(status_code=400, detail="날짜는 YYYY-MM-DD 형식이어야 합니다.")
        label = ""
    else:
        d0, d1, label = _current_week_block(today)

    lo, hi = d0.isoformat(), d1.isoformat()
    # 원본 DT는 베팅일과 최대 하루 어긋나므로(새벽 경기) 넉넉히 훑은 뒤 정확히 거른다.
    raw_lo = (d0 - timedelta(days=1)).strftime("%y-%m-%d")
    raw_hi = (d1 + timedelta(days=1)).strftime("%y-%m-%d")

    rows: list[dict] = []
    for scope in (PATHS.SCOPE_MASTER, PATHS.SCOPE_USER):
        try:
            db = _resolve_scope_db(scope, user)
        except HTTPException:
            continue
        labels = _scope_league_labels(scope, user)
        for code in _scope_league_codes(scope, user):
            # EV/위험도는 리그 전체 이력이 있어야 계산되므로 전체에 붙은 표를 받아
            # 해당 날짜 행만 골라 쓴다(계산 자체는 DB가 바뀔 때만 다시 한다).
            df = DATA.load_league_df_ev(db, code)
            if df.empty or "DT" not in df.columns:
                continue
            dt_str = df["DT"].astype(str).str.slice(0, 8)
            rough = df[(dt_str >= raw_lo) & (dt_str <= raw_hi)]
            if rough.empty:
                continue
            keep = [i for i in rough.index
                    if lo <= _betting_day_sort_key(df.at[i, "DT"], df.at[i, "TM"])[0] <= hi]
            if not keep:
                continue
            records = DATA.df_to_records(df.loc[keep])
            _attach_my_picks(records, user["username"], code, scope)
            for rec in records:
                rec["L"] = code
                rec["L_LABEL"] = labels.get(code, code)
                rec["scope"] = scope
                rows.append(rec)

    rows.sort(key=lambda r: _betting_day_sort_key(r.get("DT"), r.get("TM")))
    columns = ["L"] + [c for c in (list(rows[0].keys()) if rows else [])
                       if c not in ("L", "L_LABEL", "scope")]
    return {"columns": columns, "rows": rows, "total": len(rows),
            "start": lo, "end": hi, "label": label}


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


# ─────────────────────────── 화면 스냅샷 ───────────────────────────
# 지금은 "저장만" 한다 — data/users/{계정}/snapshots/ 밑에 시각을 이름에 담아 쌓아 두고,
# 어디서 다시 볼지(목록 화면 등)는 나중에 정한다.

class SnapshotBody(BaseModel):
    page: str
    image: str  # data:image/png;base64,... 또는 순수 base64


@app.post("/api/snapshots")
def save_snapshot(body: SnapshotBody, user: dict = Depends(get_current_user)):
    m = re.match(r"^data:image/(png|jpeg);base64,(.+)$", body.image, re.DOTALL)
    raw_b64 = m.group(2) if m else body.image
    try:
        raw = base64.b64decode(raw_b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="이미지 데이터를 읽을 수 없습니다.")
    if not raw:
        raise HTTPException(status_code=400, detail="빈 이미지입니다.")

    d = PATHS.get_snapshots_dir(user["username"])
    os.makedirs(d, exist_ok=True)
    page = re.sub(r"[^A-Za-z0-9_-]", "_", body.page or "screen")[:40]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{ts}_{page}.png"
    with open(os.path.join(d, filename), "wb") as f:
        f.write(raw)
    return {"ok": True, "filename": filename}


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


def _pick_key_index(db: str, code: str) -> dict:
    """{(S,R,No,HT,AT) 정규화키: df 행번호}. 별표/내픽처럼 '경기 몇 개'를 리그 표에서
    찾아야 할 때, 리그 전체를 훑는 대신 이 표로 바로 집는다. DB가 바뀔 때만 다시 만든다."""
    def build():
        df = DATA.load_league_df(db, code)
        if df.empty or not {"S", "R", "No", "HT", "AT"}.issubset(df.columns):
            return {}
        sub = df[["S", "R", "No", "HT", "AT"]]
        return {_my_pick_key(s, r, no, ht, at): i
                for i, s, r, no, ht, at in sub.itertuples(name=None)}

    return DATA.cached_derive(db, "pick_key_index:" + code, build)


def _build_rt_index(df: pd.DataFrame) -> dict:
    """리그 df → {(S,R,No,HT,AT): (RT라벨, DT)} 인덱스. 베팅내역이 다리마다 실제 결과를
    찾을 때 쓴다. DB 내용에서만 나오는 값이라 DATA.cached_derive로 캐시해 둔다."""
    idx: dict = {}
    if df.empty or not {"S", "R", "No", "HT", "AT", "RT"}.issubset(df.columns):
        return idx
    has_dt = "DT" in df.columns
    cols = ["S", "R", "No", "HT", "AT", "RT"] + (["DT"] if has_dt else [])
    for row in df[cols].itertuples(index=False, name=None):
        s, r, no, ht, at, rt = row[:6]
        dt = row[6] if has_dt else None
        idx[_my_pick_key(s, r, no, ht, at)] = (_rt_label(rt), dt)
    return idx


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
    # 그 인덱스를 DATA의 mtime 캐시에 얹어 요청이 끝나도 남긴다 — 예전엔 이 함수
    # 안의 지역 dict라 화면을 열 때마다 리그 전체를 다시 훑었다(실측 155ms/요청).
    def rt_index_for(sc: str, code: str) -> dict:
        db = db_for(sc)
        return DATA.cached_derive(db, f"rt_index:{code}",
                                  lambda: _build_rt_index(df_for(sc, code)))

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

    둘 다 '상대전적용 슬림 표'(DATA.H2H_COLS 14개 컬럼)를 쓴다 — 전체 표는 컬럼이 370개라
    읽는 데만 3.5초가 걸리는데, 상대전적·시즌전적이 보는 건 그중 14개뿐이다. 새 컬럼을
    쓰려면 DATA.H2H_COLS에 먼저 넣어야 한다(없으면 조용히 무시된다).
    """
    if scope != PATHS.SCOPE_USER:
        return DATA.load_total_h2h_df(db)
    if not code:
        return pd.DataFrame()
    return DATA.load_league_h2h_df(db, code)


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
    result = PICKAI.compute(body.row, h2h, scope=body.scope, season_matches=season_matches, code=body.code)
    # 상세보기의 "상대전적" 카드가 여기서 이미 구한 h2h를 그대로 재사용하도록 함께
    # 내려준다 — 예전엔 이 계산(리그 마스킹·정렬·WDL 집계)을 /api/head_to_head가
    # 팝업을 열 때마다 통째로 한 번 더 했다(같은 두 팀, 같은 데이터를 두 번 계산).
    result["h2h"] = h2h
    # 최고 연속 기록(최다연승/무패/무승/연패). 상대전적은 통합DB를 뒤지지만 이 값은
    # 사용자 지정대로 '그 리그 안에서만' 세므로 리그 하나만 따로 읽는다.
    result["streaks"] = _team_streaks(db if ht and at else None, body.scope, body.code,
                                      ht, at, body.row)
    # '최근10경기 전적' 칸에 마우스를 올렸을 때 보여줄 경기 정보. 위 streaks와 같은
    # 슬림 표를 쓰므로 읽기 비용이 더 붙지 않는다.
    result["recent10"] = _team_recent10(db if ht and at else None, body.scope, body.code,
                                        ht, at, body.row)
    return result


def _league_slim_df(db, code):
    """연속기록·최근10에 함께 쓰는 슬림 표(없으면 None).
    370컬럼짜리 전체 표를 읽으면 리그 하나당 콜드 620ms가 더 붙는다."""
    if not db or not code:
        return None
    league_df = DATA.load_league_h2h_df(db, code)
    return None if league_df.empty else league_df


def _team_streaks(db, scope, code, ht, at, row) -> dict:
    """두 팀의 최고 연속 기록을 그 리그 데이터로만 구한다(없으면 None)."""
    if not ht or not at:
        return None
    league_df = _league_slim_df(db, code)
    if league_df is None:
        return None
    args = (row.get("S"), row.get("R"), row.get("No"))
    return {
        "home": standings.max_streaks_before(league_df, ht, *args),
        "away": standings.max_streaks_before(league_df, at, *args),
    }


def _team_recent10(db, scope, code, ht, at, row) -> dict:
    """최근10경기 칸 하나하나가 어느 경기였는지. 화면 칸 순서와 같게 만든다 —
    홈팀은 과거→최신, 원정팀은 최신→과거(standings.recent10_before 주석 참고)."""
    if not ht or not at:
        return None
    league_df = _league_slim_df(db, code)
    if league_df is None:
        return None
    args = (row.get("S"), row.get("R"), row.get("No"))
    return {
        "home": standings.recent10_before(league_df, ht, *args),
        "away": standings.recent10_before(league_df, at, *args, newest_first=True),
    }


@app.get("/api/leagues/{code}/match_excel")
def match_excel_download(code: str,
                         scope: str = PATHS.SCOPE_MASTER,
                         season: str = "",
                         round: str = "",   # noqa: A002
                         no: str = "",
                         hlimit: int = 100000,   # 엑셀은 화면과 달리 자리 제약이 없어 사실상 전부 담는다
                         user: dict = Depends(get_current_user)):
    """
    상세보기 팝업을 지금 화면 그대로 엑셀 한 시트로 내려받는다 — 확률 지표·배당·
    지표별 표본(전체)·시즌전적·폼 지표·최근10경기+연속기록·상대전적·내픽/의견/메모까지.
    /api/pick_ai·team_bet_record와 같은 함수를 그대로 불러 쓰므로, 여기서 새로
    계산하는 값은 없다(화면과 다시 어긋날 일이 없다).
    """
    _check_league_for(code, scope, user)
    db = _resolve_scope_db(scope, user)
    df = DATA.load_league_df_ev(db, code)   # 화면 팝업과 같은 폼/최근전적/EV가 담기도록
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

    # 리그 표와 같은 값을 팝업에서도 쓰도록 승+패 조합 방향성을 붙인다.
    records = DATA.df_to_records(
        COMBODIR.attach(sub.head(1), DATA.load_combo_index(db), code))
    _attach_my_picks(records, user["username"], code, scope)   # 내픽/P/의견/메모/별표
    row = records[0]
    ht = str(row.get("HT") or "").strip()
    at = str(row.get("AT") or "").strip()

    h2h_df = _h2h_source_df(db, scope, code)
    h2h = _head_to_head_calc(h2h_df, ht, at, cross=True, limit=hlimit)

    # 시즌전적 — /api/pick_ai가 계산하는 것과 완전히 같은 함수(PICKAI.compute)를
    # 같은 입력으로 불러서 쓴다. h2h는 season 신호 계산에 안 쓰이지만 인터페이스가
    # 같아 그대로 넘긴다.
    season_matches = {"home": _season_matches(h2h_df, ht, row.get("S")),
                      "away": _season_matches(h2h_df, at, row.get("S"))}
    pick_result = PICKAI.compute(row, h2h, scope=scope, season_matches=season_matches, code=code)
    season_signal = next((s for s in pick_result.get("signals", []) if s.get("key") == "season"), None)
    season_rows = season_signal.get("rows") if season_signal else None

    streaks = _team_streaks(db, scope, code, ht, at, row)
    ht_record = team_bet_record(ht, user)
    at_record = team_bet_record(at, user)

    buf = XLS.build_match_excel(row, h2h, scope=scope, season_rows=season_rows, streaks=streaks,
                                ht_record=ht_record, at_record=at_record)
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
    df = DATA.load_league_df_ev(db, code)   # 화면과 같은 순위(HP/AP)가 담기도록
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
        list(df.columns) + ["IMPORTANT", "MY_PICK", "MY_P", "MY_HIT", "MEMO"], records, title=shown)
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
        # .loc 대입이 아니라 .where를 쓴다 — 새 값이 통째로 비어 있는 칸(예: 국배만
        # 긁어와 해외배당이 전부 None)에 .loc로 넣으면 float64 칸에 object를 꽂는 꼴이라
        # pandas가 FutureWarning을 내고 다음 버전에서는 오류가 된다. .where는 필요한
        # 형변환을 알아서 하고 결과도 같다.
        joined[c] = joined[c].where(~blank, joined[oc])
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
    #    최종배당(EKW~EKHL)은 '계산값'이 아니라 원본 데이터라 여기서 얼리면 안 된다 —
    #    경기 직전까지 계속 움직이므로 다시 받아올 때마다 갱신돼야 한다.
    raw_cols = set(XLS.RAW_DATA_COLS)
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
    # 순서를 그대로 보여주므로 같은 라운드 안에서 뒤죽박죽으로 보인다. 값 자체는 그대로이니
    # 저장 직전에 시즌·라운드·실제 경기일·No 순으로 다시 정렬해 둔다(_row_order_sort_key).
    if {"S", "R", "No"}.issubset(final.columns):
        final = final.loc[_row_order_sort_key(final).sort_values(
            ["S", "_r", "_day", "_order", "_no"], kind="stable").index]
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

    # 국내 핸디 방향(KH/EKH) 자동 채움 — 국배를 불러와 저장할 때 핸디 방향까지
    # 그 자리에서 정해 같이 저장한다. 예전엔 "결과·핸디 입력" 팝업을 열어 따로
    # 저장해야만 KH가 채워졌는데, 그 전까지는 KH가 비어 있어 플핸 확률(ev_model의
    # NH_KO 등)이 계산되지 않았다(2026-08-25 K1 25R 실측으로 발견). 프론트
    # ResultEditModal.jsx의 computeHandicap()과 정확히 같은 규칙 — 홈승배당이
    # 원정승배당보다 크면 홈이 약체라는 뜻이라 원정이 정배(+1), 아니면 홈이 정배(-1).
    # 스코어맨(해외배당) 저장은 국내배당 칸이 항상 빈 값이라 그대로 지나간다.
    # ⚠ 초기·최종을 각각 따로 판정한다 — 배당이 크게 움직이면 정배가 뒤집힐 수 있다.
    #   해외(EFH)도 같은 규칙으로 채운다. FH(해외 초기)는 예전부터 화면에서 사람이
    #   넣거나 ResultEditModal이 계산해 주던 값이라 여기서 건드리지 않는다.
    for w_col, l_col, h_col in (("KW", "KL", "KH"), ("EKW", "EKL", "EKH"),
                                ("EFW", "EFL", "EFH")):
        if not {w_col, l_col}.issubset(raw.columns):
            continue
        w = pd.to_numeric(raw[w_col], errors="coerce")
        l = pd.to_numeric(raw[l_col], errors="coerce")
        # ⚠ raw.get(없는칸)은 None을 주고, pd.to_numeric(None)은 Series가 아니라
        #   스칼라 NaN을 준다 — 그대로 .isna()를 부르면 터진다. 칸이 없으면 빈
        #   Series를 만들어 쓴다(스코어맨 크롤은 EKH 칸 자체가 없어 실제로 터졌다).
        h_now = (pd.to_numeric(raw[h_col], errors="coerce") if h_col in raw.columns
                 else pd.Series(np.nan, index=raw.index, dtype="float64"))
        need_fill = h_now.isna() & w.notna() & l.notna()
        if need_fill.any():
            raw[h_col] = h_now.where(~need_fill, np.where(w > l, 1.0, -1.0))

    for c in XLS.RAW_DATA_COLS:
        if c not in raw.columns:
            raw[c] = None
    new = engine.preprocess_data(raw[XLS.RAW_DATA_COLS])
    if new.empty:
        raise HTTPException(status_code=400,
                            detail="유효한 경기가 없습니다. 홈팀·원정팀이 채워져 있는지 확인하세요.")
    return _merge_and_save(db, body.code, body.scope, new, body.confirm)


# ═══════════════════════ 국내배당(와이즈토토) 가져오기 ═══════════════════════
# 스코어맨(해외배당) 크롤과 흐름은 같지만 목적이 다르다 — 이미 있는 경기의
# 국내배당 칸(KW~KHL)만 채우는 '백필 전용' 기능이라 새 경기를 만들지 않는다.
# 저장은 새 엔드포인트 없이 기존 /api/crawl/save(= _merge_and_save)를 그대로 쓴다.
#
# 예전엔 젠토토를 긁었는데 로그인한 크롬 창이 필요해 자주 실패했다. 와이즈토토는
# 로그인 없이 HTTP로 받아오므로 브라우저 자체가 없다(api/kr_crawler.py 상단 주석 참고).
# 젠토토용 코드는 v2.0에서 지웠다(_삭제백업_v2.0/ 과 git 이력에 남아 있다).
#
# 아래 이름은 와이즈토토 화면에 실제로 찍히는 리그 표기다 — 2026년 99회차 응답에서
# 직접 확인했다: EFL챔 / EPL / J1리그 / J2리그 / K리그1 / K리그2 / MLS / 독슈퍼컵 /
# 라리가 / 세리에A / 에레디비 / 축ASEA챔 / 코파리베 / 프리그1.
# 이 표기와 한 글자라도 다르면 그 리그 경기를 하나도 못 찾는다(회차마다 표기가
# 바뀌면 화면에서 직접 고쳐 넣으면 그 값이 저장돼 다음부터 먼저 쓰인다).
KR_LEAGUE_NAME_GUESS = {
    "K1": "K리그1", "K2": "K리그2", "EP": "EPL",
    "La": "라리가", "BD": "분데스리", "SA": "세리에A", "Er": "에레디비", "L1": "프리그1",
}


def _season_round_date_range(db: str, code: str, season: str, round_: str):
    """그 시즌·라운드 경기들의 첫 날짜와 마지막 날짜(datetime). 날짜가 없으면 (None, None).

    DT는 '26-08-22 (Sat)' 꼴로 저장돼 있다. 회차 자동 탐색이 이 범위를 기준으로
    와이즈토토 회차를 찾는다.
    """
    df = DATA.load_league_df(db, code)
    if df.empty or not {"S", "R", "DT"}.issubset(df.columns):
        return None, None

    def _norm(v):
        return re.sub(r"[Rr]$", "", str(v).strip())

    sel = df[(df["S"].astype(str).str.strip() == str(season).strip())
             & (df["R"].astype(str).apply(_norm) == _norm(round_))]
    days = []
    for v in sel.get("DT", pd.Series(dtype=object)).dropna():
        try:
            days.append(datetime.strptime(str(v)[:8], "%y-%m-%d"))
        except ValueError:
            continue
    return (min(days), max(days)) if days else (None, None)


class CrawlKrFetchBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    season: str            # 이 리그의 시즌(S) — 매칭용
    round: str              # noqa: A003 — 이 리그의 라운드(R, 예: '21R') — 매칭용
    league_name: Optional[str] = None   # 비우면 기본 추정값 사용
    year: str = ""          # 와이즈토토 회차의 연도(예: 2026)
    kr_round: str = ""      # 와이즈토토 그 해의 회차번호(예: 99). 앱의 R과 무관.


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
        # 사용자가 직접 입력해 저장해 둔 리그명이 있으면 그걸 우선 쓰고(젠토토가 시즌마다
        # 표기를 바꿔도 다시 입력하기 전까지 유지), 없을 때만 자동 추정값을 쓴다.
        "default_league_name": CRAWL.get_league_name(udb, scope, code) or KR_LEAGUE_NAME_GUESS.get(label, label),
        "latest_season": latest_season,
        "latest_round": latest_round,
    }


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
    saved_name = CRAWL.get_league_name(udb, body.scope, body.code)
    league_name = (body.league_name or saved_name or KR_LEAGUE_NAME_GUESS.get(label, "")).strip()
    if not league_name:
        raise HTTPException(status_code=400,
                            detail="와이즈토토 리그명을 확인할 수 없습니다. 직접 입력해 주세요.")
    # 사용자가 입력한(또는 화면에 채워져 있던) 리그명을 저장해 둔다 — 사이트가 시즌마다
    # 표기를 바꿔도, 다음에 이 리그 팝업을 열 때 자동 추정값 대신 이 값이 먼저 채워진다.
    CRAWL.set_league_name(udb, body.scope, body.code, league_name)

    # 회차는 사용자가 알 필요가 없다 — 이 리그의 그 시즌·라운드 경기 날짜를 DB에서 읽어
    # 그 날짜가 들어 있는 와이즈토토 회차를 스스로 찾는다. 회차를 직접 넣었을 때만
    # 그 회차를 그대로 쓴다(특정 회차만 콕 집어 다시 받고 싶을 때).
    try:
        if str(body.year).strip() and str(body.kr_round).strip():
            raw = KRCRAWL.fetch_domestic(league_name, body.year.strip(), body.kr_round.strip())
        else:
            d0, d1 = _season_round_date_range(db, body.code, body.season, body.round)
            if d0 is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{body.season} {body.round}' 경기의 날짜가 비어 있어 회차를 찾을 수 "
                           "없습니다. 먼저 해배 가져오기로 날짜를 채우거나, 회차를 직접 넣어 주세요.")
            raw = KRCRAWL.fetch_by_dates(league_name, d0, d1)
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
                # 최종배당(배변 후)도 같이 넘긴다 — 여기서 빠뜨리면 화면에서 저장할 때
                # 초기배당만 반영되고 최종배당은 조용히 사라진다.
                **{c: r.get(c) for c in XLS.FINAL_ODDS_COLS},
                "_note": r.get("_note", ""),
            })

    return {
        "count": raw["count"], "fail_cnt": raw["fail_cnt"],
        # 배당이 바뀌어 초기배당으로 되돌린 경기 수 — 화면 요약에 같이 보여준다.
        "changed_cnt": raw.get("changed_cnt", 0),
        "matched": len(matched_rows), "rows": matched_rows, "unmatched": unmatched,
        "teams": teams, "unknown_teams": unknown,
    }


class CrawlKrResultsBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    season: str            # 이 리그의 시즌(S) — 매칭용
    round: str              # noqa: A003 — 이 리그의 라운드(R) — 매칭용
    league_name: Optional[str] = None   # 비우면 국배 가져오기에 저장된 값(또는 기본 추정값) 사용
    year: str = ""          # 와이즈토토 회차 연도를 직접 지정할 때만
    kr_round: str = ""      # 와이즈토토 회차번호를 직접 지정할 때만


@app.post("/api/crawl/kr/fetch_results")
def crawl_kr_fetch_results(body: CrawlKrResultsBody, user: dict = Depends(get_current_user)):
    """
    결과·핸디 입력 팝업의 '결과 불러오기' — 와이즈토토에서 끝난 경기 스코어(HS/AS)를
    가져와 이 리그의 season/round에 이미 있는 경기와 (홈팀,원정팀)으로 매칭한다.
    RT(핸승/핸무/무/역)는 여기서 계산하지 않는다 — 화면에 지금 입력돼 있는(또는 저장은
    안 했지만 방금 고친) 핸디 부호로 그 자리에서 판정해야 해서, 그 계산은 프론트에서 한다.
    """
    _check_league_for(body.code, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    udb = _user_db_of(user)
    label = _l_value(db, body.scope, body.code)
    saved_name = CRAWL.get_league_name(udb, body.scope, body.code)
    league_name = (body.league_name or saved_name or KR_LEAGUE_NAME_GUESS.get(label, "")).strip()
    if not league_name:
        raise HTTPException(status_code=400,
                            detail="와이즈토토 리그명을 확인할 수 없습니다. '국배 가져오기'에서 먼저 리그명을 설정해 주세요.")

    try:
        if str(body.year).strip() and str(body.kr_round).strip():
            raw = KRCRAWL.fetch_results(league_name, body.year.strip(), body.kr_round.strip())
        else:
            d0, d1 = _season_round_date_range(db, body.code, body.season, body.round)
            if d0 is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{body.season} {body.round}' 경기의 날짜가 비어 있어 회차를 찾을 수 "
                           "없습니다. 먼저 해배 가져오기로 날짜를 채우거나, 회차를 직접 넣어 주세요.")
            raw = KRCRAWL.fetch_results_by_dates(league_name, d0, d1)
    except KRCRAWL.CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))

    aliases = CRAWL.list_aliases(udb, body.scope, body.code, source="kr")
    rows = CRAWL.apply_aliases(raw["rows"], aliases)

    df = DATA.load_league_df(db, body.code)
    matched_rows, unmatched = [], []

    def _round_norm(v):
        return re.sub(r"[Rr]$", "", str(v).strip())

    if df.empty or not {"S", "R", "HT", "AT", "No"}.issubset(df.columns):
        unmatched = [f"{r['HT']} vs {r['AT']}" for r in rows]
    else:
        season_q = str(body.season).strip()
        round_q = _round_norm(body.round)
        season_round = df[(df["S"].astype(str).str.strip() == season_q) &
                          (df["R"].astype(str).apply(_round_norm) == round_q)]
        row_map = {}
        for _, r in season_round.iterrows():
            key = (str(r["HT"]).strip(), str(r["AT"]).strip())
            row_map[key] = (r["S"], r["R"], float(r["No"]))

        for r in rows:
            pair = (str(r["HT"]).strip(), str(r["AT"]).strip())
            hit = row_map.get(pair)
            if hit is None:
                unmatched.append(f"{r['HT']} vs {r['AT']}")
                continue
            s_val, r_val, no_val = hit
            matched_rows.append({
                "S": s_val, "R": r_val, "No": no_val,
                "HT": r["HT"], "AT": r["AT"],
                "HS": r["HS"], "AS": r["AS"],
            })

    return {
        "count": raw["count"], "matched": len(matched_rows),
        "rows": matched_rows, "unmatched": unmatched,
    }


@app.post("/api/crawl/kr/aliases")
def crawl_kr_save_aliases(body: CrawlAliasBody, user: dict = Depends(get_current_user)):
    """국내배당(젠토토) 팀명 치환 규칙 저장 — 스코어맨 치환 규칙과는 별도로 저장된다."""
    _check_league_for(body.code, body.scope, user)
    udb = _user_db_of(user)
    n = CRAWL.save_aliases(udb, body.scope, body.code, body.mapping, source="kr")
    return {"ok": True, "saved": n,
            "aliases": CRAWL.list_aliases(udb, body.scope, body.code, source="kr")}


# ═══════════════════════ 최신배당(배변) 불러오기 ═══════════════════════
# "결과·핸디 입력"·"국배 가져오기"와 달리 이미 저장돼 있는 경기의 최종배당(EK*/EF*)
# 칸만 다시 받아 덮어쓴다. 초기배당(KW~KHL/FW~FHL)·26개 지표·플핸예측·RT는 절대
# 건드리지 않는다 — 그 값들은 preprocess_data/_merge_and_save를 거치지 않고,
# 이미 로드한 df에서 EK*/EF* 칸만 직접 바꿔 그대로 다시 쓴다.
def _scoreman_season(season: str) -> str:
    """DB 시즌 표기 -> 스코어맨 표기. '26-27' -> '2026-2027', '2026'(K리그) -> 그대로."""
    s = str(season).strip()
    m = re.match(r"^(\d{2})-(\d{2})$", s)
    if not m:
        return s

    def full(y):
        y = int(y)
        return 2000 + y if y < 80 else 1900 + y
    return f"{full(m.group(1))}-{full(m.group(2))}"


# ─────────────────── 새 라운드 자동 가져오기 (크롬 창 불필요) ───────────────────
class NextRoundBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    code: str
    season: str = ""        # 비우면 DB의 최신 시즌
    round: str = ""         # noqa: A003 — 비우면 "최신 라운드 + 1"
    with_overseas: bool = True   # 해외배당(스코어맨)까지 받을지
    with_domestic: bool = True   # 국내배당(와이즈토토)까지 받을지


def _scoreman_kickoff(dt_raw):
    """스코어맨 일정 JSON의 킥오프('2026-08-22 23:00') -> ('2026-08-23', 0.0).

    ⚠ 정확히 1시간을 더해야 한다. 스코어맨 JSON의 시각은 사이트 기준 시간대라
      화면에 보이는 값보다 1시간 이르다(crawler.py _date_time의 같은 주석 참고 —
      크롬 창으로 긁는 기존 경로는 data-t 대신 '화면에 찍힌 시각'을 쓰기 때문에
      이 보정이 이미 들어가 있다). 보정 없이 저장하면 기존에 저장된 경기와 TM이
      1시간씩 어긋나고, 자정 근처 경기는 날짜까지 하루 밀린다.
      실측 대조(라리가 26-27 2R): 보정 전 10경기 중 TM 8건·DT 1건 불일치 -> 보정 후 0건.

    날짜/시각을 못 읽으면 ("", None).
    """
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})", str(dt_raw or "").strip())
    if not m:
        d_part = str(dt_raw or "").partition(" ")[0]
        return d_part, None
    y, mo, d, hh, mi = (int(x) for x in m.groups())
    shown = datetime(y, mo, d, hh, mi) + timedelta(hours=1)
    return shown.strftime("%Y-%m-%d"), float(f"{shown.hour:02d}{shown.minute:02d}")


def _latest_season_round(df: pd.DataFrame):
    """리그 표에서 (최신 시즌, 그 시즌의 최신 라운드). 없으면 (None, None)."""
    if df.empty or "S" not in df.columns or "R" not in df.columns:
        return None, None
    seasons = sorted([s for s in df["S"].dropna().unique().tolist()], key=str)
    if not seasons:
        return None, None
    s = str(seasons[-1])
    rounds = df.loc[df["S"].astype(str) == s, "R"].dropna().unique().tolist()
    if not rounds:
        return s, None
    return s, str(sorted(rounds, key=_round_sort_key)[-1])


def _scoreman_league_id(udb: str, scope: str, code: str):
    """저장된 스코어맨 리그 주소에서 리그 ID만 뽑는다. 없으면 None."""
    m = re.search(r"/league/(\d+)", CRAWL.get_source(udb, scope, code) or "")
    return int(m.group(1)) if m else None


def _round_num_of(v) -> str:
    """'20R' -> '20' — 라운드 표기에서 숫자만."""
    return re.sub(r"[Rr]$", "", str(v).strip())


@app.post("/api/crawl/next_round")
def crawl_next_round(body: NextRoundBody, user: dict = Depends(get_current_user)):
    """"새 라운드 가져오기" — 시즌·라운드를 사람이 입력하지 않고 스스로 찾아서 가져온다.

    기존 해배 가져오기는 크롬 창을 띄워 사용자가 시즌·라운드를 직접 골라야 했는데,
    스코어맨은 시즌 전체 일정을 JSON으로도 주기 때문에 브라우저 없이 다음 라운드를
    특정할 수 있다(백필 스크립트가 쓰던 것과 같은 경로).

    흐름: DB 최신 라운드 -> +1 -> 스코어맨 일정에서 그 라운드 경기 -> 팀명 치환 ->
          킥오프 순으로 No 부여 -> 해외배당·국내배당 붙이기.

    저장은 하지 않는다 — 화면에서 눈으로 확인한 뒤 기존 /api/crawl/save로 저장한다.
    배당은 둘 다 best effort다: 스코어맨이 막혀 있거나 프로토 회차가 아직 발행 전이면
    그 부분만 비워서 돌려주고 사유를 같이 알려준다(경기 목록 자체는 그대로 쓸 수 있다).
    """
    _check_league_for(body.code, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    udb = _user_db_of(user)

    df = DATA.load_league_df(db, body.code)
    if df.empty:
        raise HTTPException(status_code=400,
                            detail="이 리그에 저장된 경기가 없습니다. 첫 라운드는 엑셀 업로드나 "
                                   "기존 해배 가져오기로 등록해 주세요.")

    latest_s, latest_r = _latest_season_round(df)
    season = str(body.season).strip() or latest_s
    if not season:
        raise HTTPException(status_code=400, detail="시즌을 찾을 수 없습니다.")

    league_id = _scoreman_league_id(udb, body.scope, body.code)
    if not league_id:
        raise HTTPException(status_code=400,
                            detail="스코어맨 리그 주소를 확인할 수 없습니다. "
                                   "'해배 가져오기'에서 먼저 주소를 저장해 주세요.")

    try:
        sched = SCOREMAN.season_schedule(league_id, _scoreman_season(season))
    except SCOREMAN.OddsError as e:
        raise HTTPException(status_code=400, detail=f"스코어맨 일정을 못 받았습니다: {e}")
    if not sched:
        raise HTTPException(status_code=400,
                            detail=f"스코어맨에 '{season}' 시즌 일정이 없습니다. 시즌 표기를 확인해 주세요.")

    # 목표 라운드 결정 — 직접 지정했으면 그대로, 아니면 DB 최신 + 1.
    if str(body.round).strip():
        want = _round_sort_key(body.round)
    elif latest_r:
        want = _round_sort_key(latest_r) + 1
    else:
        want = 1

    sched = CRAWL.apply_aliases(sched, CRAWL.list_aliases(udb, body.scope, body.code))
    games = [g for g in sched if _round_sort_key(g.get("R")) == want]
    if not games:
        avail = sorted({_round_sort_key(g.get("R")) for g in sched})
        raise HTTPException(
            status_code=400,
            detail=f"스코어맨 '{season}' 시즌에 {want}R이 없습니다"
                   f"(있는 라운드: {avail[0]}R~{avail[-1]}R). 시즌이 끝났다면 새 시즌은 "
                   "엑셀 업로드나 기존 해배 가져오기로 시작해 주세요.")

    round_label = f"{want}R"

    # 이미 DB에 있는 라운드인지 알려준다(막지는 않는다 — 다시 받아 덮어쓸 수도 있다).
    already = int(((df["S"].astype(str).str.strip() == season)
                   & (df["R"].astype(str).apply(_round_num_of) == str(want))).sum())

    # 킥오프 시각 순으로 정렬해 No를 1번부터 매긴다(경기 순서 소팅 규칙과 같은 기준).
    games.sort(key=lambda g: str(g.get("dt") or ""))
    L = _l_value(db, body.scope, body.code)
    rows = []
    for i, g in enumerate(games, start=1):
        d_part, tm = _scoreman_kickoff(g.get("dt"))
        rows.append({
            "L": L, "S": season, "R": round_label, "No": float(i),
            "DT": d_part, "TM": tm,
            "HT": g.get("HT", ""), "AT": g.get("AT", ""),
            "_mid": g.get("mid"),
        })

    # ── 해외배당(스코어맨) ── 막혀 있으면 그 부분만 빈 채로 둔다.
    overseas_filled = 0
    overseas_error = None
    if body.with_overseas:
        for r in rows:
            try:
                o = SCOREMAN.match_odds(r["_mid"])
            except SCOREMAN.OddsError as e:
                overseas_error = str(e)
                break
            if o.get("FW") is not None or o.get("EFW") is not None:
                for c in ("FW", "FD", "FL", "FHW", "FHL",
                          "EFW", "EFD", "EFL", "EFHW", "EFHL"):
                    if o.get(c) is not None:
                        r[c] = o[c]
                overseas_filled += 1
            # 남의 서버 — 몰아치면 IP 단위로 막힌다(refresh_final_odds와 같은 텀).
            time.sleep(0.15)
        if not overseas_filled and not overseas_error:
            overseas_error = ("스코어맨에 이 라운드 배당이 아직 없습니다"
                              "(경기 직전에 올라오거나, 요청이 일시 차단된 상태일 수 있습니다).")

    # ── 국내배당(와이즈토토) ── 프로토 회차가 아직 없으면 정상적으로 비어 있다.
    domestic_filled = 0
    domestic_error = None
    if body.with_domestic:
        label = _l_value(db, body.scope, body.code)
        league_name = (CRAWL.get_league_name(udb, body.scope, body.code)
                       or KR_LEAGUE_NAME_GUESS.get(label, "")).strip()
        days = []
        for r in rows:
            try:
                days.append(datetime.strptime(str(r["DT"])[:10], "%Y-%m-%d"))
            except ValueError:
                continue
        if not league_name:
            domestic_error = "와이즈토토 리그명이 설정돼 있지 않습니다('국배 가져오기'에서 지정)."
        elif not days:
            domestic_error = "경기 날짜를 읽지 못해 프로토 회차를 찾을 수 없습니다."
        else:
            try:
                raw = KRCRAWL.fetch_by_dates(league_name, min(days), max(days))
                kr_rows = CRAWL.apply_aliases(
                    raw["rows"], CRAWL.list_aliases(udb, body.scope, body.code, source="kr"))
                kidx = {(str(k["HT"]).strip(), str(k["AT"]).strip()): k for k in kr_rows}
                for r in rows:
                    k = kidx.get((str(r["HT"]).strip(), str(r["AT"]).strip()))
                    if not k:
                        continue
                    for c in ("KW", "KD", "KL", "KHW", "KHD", "KHL",
                              "EKW", "EKD", "EKL", "EKHW", "EKHD", "EKHL"):
                        if k.get(c) is not None:
                            r[c] = k[c]
                    domestic_filled += 1
            except KRCRAWL.CrawlError as e:
                domestic_error = str(e)

    teams = _league_teams(db, body.code)
    unknown = sorted({t for r in rows for t in (r["HT"], r["AT"]) if t and t not in teams})
    for r in rows:
        r.pop("_mid", None)

    return {
        "season": season, "round": round_label,
        "latest_season": latest_s, "latest_round": latest_r,
        "count": len(rows), "rows": rows,
        "already_saved": already,
        "overseas_filled": overseas_filled, "overseas_error": overseas_error,
        "domestic_filled": domestic_filled, "domestic_error": domestic_error,
        "teams": teams, "unknown_teams": unknown,
    }



class RefreshFinalOddsBody(BaseModel):
    scope: str = PATHS.SCOPE_MASTER
    season: str
    round: str   # noqa: A003
    # 27개 지표 재계산은 라운드당 CPU를 꽤 쓴다(통합DB 재구성 포함). 과거
    # 대량 백필처럼 이 API를 초 단위로 연달아 두드릴 때 켜 두면, 파이썬 GIL
    # 특성상 그 사이 화면 조회 요청까지 줄줄이 밀려 앱이 멈춘 것처럼 보인다
    # (실측: 조회 0.1초 → 3초, 서버 90초 응답지연). 화면에서 누르는 평소
    # 사용(기본값 True)은 그대로 계산해서 즉시 보여주고, 대량 백필 스크립트만
    # False로 꺼서 배당만 빠르게 받게 한다 — 지표는 나중에 일괄 재계산하면 된다.
    recompute_indicators: bool = True


@app.post("/api/leagues/{code}/refresh_final_odds")
def refresh_final_odds(code: str, body: RefreshFinalOddsBody, user: dict = Depends(get_current_user)):
    """"최신배당 불러오기" — 이 시즌·라운드 경기들의 국내·해외 최종배당(배변 후)만
    다시 받아 채운다. 국내는 와이즈토토, 해외는 스코어맨 Bet365 라이브 배당이다.
    """
    _check_league_for(code, body.scope, user)
    db = _resolve_scope_db(body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if str(body.season) == "ALL" or str(body.round) == "ALL":
        raise HTTPException(status_code=400,
                            detail="최신배당 불러오기는 시즌·라운드를 하나씩 골라야 합니다(전체 불가).")

    df = DATA.load_league_df(db, code)
    if df.empty or not {"S", "R", "HT", "AT", "DT"}.issubset(df.columns):
        raise HTTPException(status_code=400, detail="이 리그에 저장된 경기가 없습니다.")

    def _rnorm(v):
        return re.sub(r"[Rr]$", "", str(v).strip())

    mask = ((df["S"].astype(str).str.strip() == str(body.season).strip())
            & (df["R"].astype(str).apply(_rnorm) == _rnorm(body.round)))
    idxs = df.index[mask].tolist()
    if not idxs:
        raise HTTPException(status_code=400, detail="그 시즌·라운드에 저장된 경기가 없습니다.")

    udb = _user_db_of(user)
    label = _l_value(db, body.scope, code)

    def _f(v):
        # 1.00은 실제 배당이 아니다(마켓 특례 표기) — KRCRAWL·SCOREMAN이 이미 원천에서
        # 걸러 주지만, 여기서도 한 번 더 막아 둔다(2026-08-28 전수조사·정리).
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return x if x > 1.0 else None

    for c in ("EKW", "EKD", "EKL", "EKH", "EKHW", "EKHD", "EKHL",
              "EFW", "EFD", "EFL", "EFH", "EFHW", "EFHD", "EFHL"):
        if c not in df.columns:
            df[c] = np.nan

    # ── 국내(와이즈토토) ──
    kr_updated = 0
    kr_error = None
    league_name = (CRAWL.get_league_name(udb, body.scope, code)
                    or KR_LEAGUE_NAME_GUESS.get(label, ""))
    if not league_name:
        kr_error = "와이즈토토 리그명을 확인할 수 없습니다. '국배 가져오기'에서 먼저 설정해 주세요."
    else:
        try:
            d0, d1 = _season_round_date_range(db, code, body.season, body.round)
            if d0 is None:
                kr_error = "경기 날짜가 비어 있어 회차를 찾을 수 없습니다."
            else:
                raw = KRCRAWL.fetch_by_dates(league_name, d0, d1)
                aliases = CRAWL.list_aliases(udb, body.scope, code, source="kr")
                rows = CRAWL.apply_aliases(raw["rows"], aliases)
                kidx = {(r["HT"].strip(), r["AT"].strip()): r for r in rows}
                for i in idxs:
                    r = kidx.get((str(df.at[i, "HT"]).strip(), str(df.at[i, "AT"]).strip()))
                    if not r:
                        continue
                    ekw, ekl = _f(r.get("EKW")), _f(r.get("EKL"))
                    if ekw is None:                 # 최종배당 자체가 없으면 건드리지 않는다
                        continue
                    for c, key in (("EKW", "EKW"), ("EKD", "EKD"), ("EKL", "EKL"),
                                  ("EKHW", "EKHW"), ("EKHD", "EKHD"), ("EKHL", "EKHL")):
                        v = _f(r.get(key))
                        if v is not None:
                            df.at[i, c] = v
                    if ekl is not None:
                        df.at[i, "EKH"] = 1.0 if ekw > ekl else -1.0
                    kr_updated += 1
        except KRCRAWL.CrawlError as e:
            kr_error = str(e)

    # ── 해외(스코어맨 Bet365) ──
    ef_updated = 0
    ef_error = None
    source_url = CRAWL.get_source(udb, body.scope, code)
    m = re.search(r"/league/(\d+)", source_url or "")
    league_id = int(m.group(1)) if m else None
    if not league_id:
        ef_error = "스코어맨 리그 주소를 확인할 수 없습니다. '해배 가져오기'에서 먼저 설정해 주세요."
    else:
        try:
            sched = SCOREMAN.season_schedule(league_id, _scoreman_season(body.season))
            f_aliases = CRAWL.list_aliases(udb, body.scope, code)   # source="" — 스코어맨 치환규칙
            sched = CRAWL.apply_aliases(sched, f_aliases)
            # 날짜는 매칭 키에 안 쓴다 — 스코어맨과 DB의 킥오프 시각이 리그 전체에 걸쳐
            # 한 시간씩 어긋나 있어(예: 스코어맨 23:30 ↔ DB 00:30), 자정을 넘나드는 경기는
            # 날짜까지 하루 바뀌어 팀명이 맞는데도 못 찾는 문제가 있었다. 한 시즌 안에서
            # 같은 (홈,원정) 순서 조합은 리그전 특성상 한 번만 나오므로 팀명만으로 충분하다.
            sidx = {}
            for g in sched:
                sidx[(str(g.get("HT", "")).strip(), str(g.get("AT", "")).strip())] = g
            for i in idxs:
                g = sidx.get((str(df.at[i, "HT"]).strip(), str(df.at[i, "AT"]).strip()))
                if not g:
                    continue
                try:
                    o = SCOREMAN.match_odds(g["mid"])
                except SCOREMAN.OddsError:
                    continue
                # 경기당 한 번씩 남의 서버를 두드리는 것이라 살짝 텀을 둔다 — 짧은 시간에
                # 몰아치면 사이트가 IP 단위로 한동안 막아 버린다(실측: 150건 연속 요청 후
                # 차단, 시간이 지나도 안 풀리는 걸로 보아 쿨다운이 김. 버튼은 보통 한 라운드
                # 6~10경기만 다루므로 이 정도 텀으로는 실사용에서 체감되지 않는다).
                time.sleep(0.15)
                efw, efl = o.get("EFW"), o.get("EFL")
                if efw is None:                     # Bet365에 라이브 배당이 없으면 건드리지 않는다
                    continue
                for c in ("EFW", "EFD", "EFL", "EFHW", "EFHL"):
                    if o.get(c) is not None:
                        df.at[i, c] = o[c]
                if efl is not None:
                    df.at[i, "EFH"] = 1.0 if efw > efl else -1.0
                ef_updated += 1
        except SCOREMAN.OddsError as e:
            ef_error = str(e)

    # ── 최종배당 기준 27개 지표 재계산 ──
    # 새로 받은 최종배당이 어느 배당 구간에 속하는지 다시 매겨 표본을 새로 센다.
    # 표본 풀(과거 경기)은 초기배당 그대로 — 자세한 이유는 final_indicators.py 상단.
    ind_updated = 0
    if kr_updated or ef_updated:
        if body.recompute_indicators:
            leagues = [code] if _is_user_scope(body.scope) else PATHS.LEAGUES
            ind_updated = FINALIND.attach_to_df(df, idxs, db, leagues)

        con = sqlite3.connect(db)
        try:
            df.to_sql(code, con, if_exists="replace", index=False)
        finally:
            con.close()
        PATHS.stamp_updated(db)

    return {
        "domestic_updated": kr_updated, "domestic_error": kr_error,
        "overseas_updated": ef_updated, "overseas_error": ef_error,
        "indicators_updated": ind_updated,
        "target_count": len(idxs),
    }


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
RT_LABEL_TO_NUM = {"핸승": 1, "핸무": 2, "무": 3, "역": 4, "취소": 5, "연기": 6}
HANDICAP_CHOICES = {-1.0, 1.0}
# RT/KH/FH/DT를 뺀 나머지 직접입력 대상 — 전부 순수 숫자(시간·스코어·배당)라 규칙이 동일하다.
SCORE_FIELDS = ("HS", "AS")
ODDS_FIELDS_EDIT = ("KW", "KD", "KL", "KHW", "KHD", "KHL", "FW", "FD", "FL", "FHW", "FHD", "FHL")
NUMERIC_EDIT_FIELDS = ("TM",) + SCORE_FIELDS + ("KH", "FH") + ODDS_FIELDS_EDIT


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

    cols = ["S", "R", "No", "DT", "TM", "HT", "AT", "HS", "AS", "RT",
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
            # 연기(RT=6)는 같은 라운드 안에서 맨 아래로 — No 값은 안 바꾸고 표시 순서만.
            "post": (view["RT_label"] == "연기").astype(int),
            "No": pd.to_numeric(view["No"], errors="coerce"),
        }, index=view.index)
        view = view.loc[sort_key.sort_values(["S", "R", "post", "No"]).index]
    return {"rows": DATA.df_to_records(view), "season": season, "round": round,
            "total": len(sub)}


class EditRowItem(BaseModel):
    S: str
    R: str
    No: float
    HT: str
    AT: str
    RT: Optional[str] = None    # '핸승'/'핸무'/'무'/'역'/'취소'/'연기' 또는 None(지우기)
    DT: Optional[str] = None    # 'YY-MM-DD (요일)' — 프론트에서 완성된 문자열로 보낸다
    TM: Optional[float] = None  # HHMM
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
        if item.TM is not None:
            h, m = divmod(int(item.TM), 100)
            if not (0 <= h <= 23 and 0 <= m <= 59):
                raise HTTPException(status_code=400,
                                    detail=f"TM은 0000~2359(HHMM) 사이여야 합니다: {item.TM!r}")
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
    if "DT" not in df.columns:
        df["DT"] = None   # DT는 'YY-MM-DD (요일)' 문자열이라 숫자로 강제하지 않는다.

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
        df.loc[idx, "DT"] = item.DT
        for field in NUMERIC_EDIT_FIELDS:
            val = getattr(item, field)
            df.loc[idx, field] = val if val is not None else np.nan
        updated += len(idx)
        touched_idx.extend(idx)

    filled_sides = _fill_missing_ph_side(df, db, body.scope, touched_idx)

    # DT를 고쳤을 수 있으니(연기 경기 재편성 등) 저장 전에 표시 순서를 다시 잡는다.
    # No 값 자체는 안 바꾼다 — _row_order_sort_key 참고.
    if {"S", "R", "No"}.issubset(df.columns):
        df = df.loc[_row_order_sort_key(df).sort_values(
            ["S", "_r", "_day", "_order", "_no"], kind="stable").index]
        df = df.reset_index(drop=True)

    if body.scope == PATHS.SCOPE_MASTER:
        PATHS.backup_master()

    con = sqlite3.connect(db)
    try:
        df.to_sql(code, con, if_exists="replace", index=False)
    finally:
        con.close()
    PATHS.stamp_updated(db)

    return {"ok": True, "updated": updated, "not_found": not_found, "filled_prediction": filled_sides}


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


# ─────────────────────────── 재계산 (리그 1개만) ───────────────────────────
# engine.recompute_pending_matches/all(위)은 PATHS.LEAGUES(공식 6대리그)를 통째로 훑는다.
# 그래서 ① 'ul_1' 같은 내 데이터 테이블에는 아예 적용되지 않고, ② 공식 데이터에서는
# EPL 하나만 고쳐도 6개 리그가 전부 다시 계산돼 몇 분씩 걸린다.
# engine.py는 계산 로직 수정 금지 대상이라 그 함수는 그대로 두고, 리그 하나만 돌리는
# 버전을 여기 둔다.
#
# ★ 리그 하나만 돌려도 결과가 같은 이유 —
#   engine._recompute_by_mask를 보면 통합지표(TF-/TK-)의 표본이 되는 total_df를 루프
#   '시작 전에 한 번' 만들고, 리그마다 그 같은 값을 그대로 넘긴다. 루프 안에서 갱신하지
#   않는다. 즉 A리그를 다시 계산해도 B리그의 표본은 안 바뀐다(지표 재계산은 배당·RT 같은
#   원본을 건드리지 않으므로 표본 자체가 불변이다). 그래서 같은 total_df만 넘겨주면
#   리그를 하나씩 따로 돌린 결과와 6개를 한꺼번에 돌린 결과가 완전히 같다.
#   실측 대조: EPL 6,480행 × 지표 전 컬럼 비교 → 불일치 0건.
class LeagueRecomputeBody(BaseModel):
    scope: str = PATHS.SCOPE_USER
    include_historical: bool = False
    confirm: bool = False


def _recompute_one_league(db: str, code: str, include_historical: bool, scope: str) -> dict:
    league_df = DATA.load_league_df(db, code)
    if league_df.empty or "RT" not in league_df.columns:
        return {code: 0}

    rt_num = pd.to_numeric(league_df["RT"], errors="coerce")
    mask = pd.Series(True, index=league_df.index) if include_historical else rt_num.isna()
    n_target = int(mask.sum())
    if n_target == 0:
        return {code: 0}

    # 통합(TF-/TK-) 지표의 표본이 스코프마다 다르다.
    #   내 데이터 → 그 리그 하나 (리그별 완전 독립 — _merge_and_save와 같은 규칙)
    #   공식     → 6대리그를 합친 통합DB (engine._recompute_by_mask가 쓰는 것과 같은 값)
    total_df = league_df if _is_user_scope(scope) else DATA.load_total_df(db)
    if total_df.empty:
        total_df = league_df

    # ⚠ 캐시된 df를 그대로 고치면 다음 요청이 오염된 값을 받는다 — 반드시 복사본에 쓴다.
    league_df = league_df.copy()
    sub = league_df[mask]
    new_ind = engine._recompute_indicators_for_subset(sub, league_df, total_df)
    for c in new_ind.columns:
        if c not in league_df.columns:
            league_df[c] = np.nan
        league_df.loc[new_ind.index, c] = new_ind[c].values

    # ── 배변배당(최신배당) 기준 지표(E_ 접두사)도 같이 다시 센다 ──
    # 위와 같은 대상(sub) 중, 최종배당(EKW~EFHL)이 실제로 들어와 있는 경기만
    # final_indicators.attach_to_df()가 골라서 채운다 — 최종배당이 없는 경기는
    # 손댈 게 없어 그대로 둔다. 비교 표본(과거 경기 풀)은 항상 초기배당 기준으로
    # 고정한다는 원칙은 그 함수 안에서 그대로 지켜진다(engine.py는 안 건드림).
    leagues_for_total = [code] if _is_user_scope(scope) else PATHS.LEAGUES
    FINALIND.attach_to_df(league_df, sub.index, db, leagues_for_total)

    if not _is_user_scope(scope):
        PATHS.backup_master()     # 공식 데이터는 덮어쓰기 전에 자동 백업

    con = sqlite3.connect(db)
    try:
        league_df.to_sql(code, con, if_exists="replace", index=False)
    finally:
        con.close()
    PATHS.stamp_updated(db)
    return {code: n_target}


@app.post("/api/leagues/{code}/recompute")
def league_recompute(code: str, body: LeagueRecomputeBody, user: dict = Depends(get_current_user)):
    """리그 하나만 26개 지표·플핸예측을 다시 계산한다.

    초기배당 기준과 배변배당(최신배당) 기준 둘 다 다시 센다 — 배변배당 쪽은 최종배당
    (EKW~EFHL)이 이미 들어와 있는 경기에만 채워진다(_recompute_one_league 안의
    FINALIND.attach_to_df 참고). include_historical=False면 예정 경기만, True면
    과거 경기까지 전부가 대상이다.

    표본(모집단)은 스코프에 따라 다르다 — 내 데이터는 그 리그 하나, 공식 데이터는
    6대리그를 합친 통합DB. 공식 데이터라도 '쓰는 대상'은 이 리그 하나뿐이라 다른 리그
    테이블은 건드리지 않으며, 값은 6개를 한꺼번에 돌렸을 때와 같다(위 ★ 주석 참고).

    6개를 한 번에 돌리고 싶으면 통합DB 탭의 /api/recompute/pending·all을 쓴다.
    """
    _check_league_for(code, body.scope, user)
    if not PATHS.can_write(body.scope, user.get("role")):
        raise HTTPException(status_code=403, detail="이 스코프에는 쓰기 권한이 없습니다.")
    if body.include_historical and not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true 로 재확인이 필요합니다.")
    db = _resolve_scope_db(body.scope, user)
    summary = _recompute_one_league(db, code, body.include_historical, body.scope)
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
