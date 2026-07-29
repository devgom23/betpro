"""
DB 읽기 + 엔진 호출 래퍼.
- 스코프(master/user)에 따라 올바른 DB 파일을 열어 리그/통합 데이터를 로드.
- 파일 mtime 기준의 아주 단순한 메모리 캐시로 반복 로드를 피한다
  (Streamlit의 st.cache_data + (path, mtime) 키 아이디어를 그대로 이식).
"""
import os
import sqlite3
import pandas as pd

from deps import PATHS
import engine
import standings

LEAGUES = PATHS.LEAGUES

# {(kind, db_path): (mtime, DataFrame)} 형태의 초경량 캐시
_CACHE = {}

PH_STATUS_COL = "PH_STATUS"
_RT_TEXT = {1: "핸승", 2: "핸무", 3: "무", 4: "역"}


def _pick_status(df: pd.DataFrame) -> pd.Series:
    """PICK(PH_PICK)과 실제 결과(RT)를 비교해 적중/미적/관망 표시용 컬럼을 만든다.
    PICK은 핸승 vs 비핸승(플핸)의 2분류 예측이다 — '플핸(무)'처럼 괄호 안은 비핸승
    표본 중 참고용 최다결과일 뿐, 그 세부 결과까지 맞혀야 적중인 게 아니라 실제
    결과가 핸승이 아니기만 하면 적중이다(engine.py compute_plushandi() 주석 참고).
    PICK이 '—'(관망)면 관망, 아직 결과가 없거나(RT 공란) PICK이 없으면 공란."""
    if "PH_PICK" not in df.columns or "RT" not in df.columns:
        return pd.Series([""] * len(df), index=df.index, dtype=object)
    rt_num = pd.to_numeric(df["RT"], errors="coerce")
    out = []
    for pick, rt in zip(df["PH_PICK"], rt_num):
        pick = "" if pd.isna(pick) else str(pick).strip()
        if not pick:
            out.append("")
        elif pick == "—":
            out.append("관망")
        elif pd.isna(rt) or int(rt) not in _RT_TEXT:
            out.append("")
        else:
            actual = _RT_TEXT[int(rt)]
            hit = (actual == "핸승") if pick == "핸승" else (actual != "핸승")
            out.append("적중" if hit else "미적")
    return pd.Series(out, index=df.index, dtype=object)


def _read_table(db_path: str, table: str) -> pd.DataFrame:
    if not os.path.exists(db_path):
        return pd.DataFrame()
    con = sqlite3.connect(db_path)
    try:
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if table not in names:
            return pd.DataFrame()
        return pd.read_sql(f'SELECT * FROM "{table}"', con)
    finally:
        con.close()


def load_league_df(db_path: str, league: str) -> pd.DataFrame:
    """단일 리그 로드(mtime 캐시)."""
    key = ("league:" + league, db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    df = _read_table(db_path, league)
    _CACHE[key] = (mt, df)
    return df


def load_league_df_ranked(db_path: str, league: str) -> pd.DataFrame:
    """
    단일 리그 + 시즌별 순위(HP/AP)·폼(HTF/HF/AF/ATF) 컬럼. 화면 표시·엑셀 다운로드 전용이다.

    ⚠ DB에 다시 쓰는 경로(업로드/삭제)에서는 절대 쓰지 말 것 — 표시용으로만 덧붙인
       컬럼들이 테이블에 저장되어 버린다. 그쪽은 load_league_df(원본)를 그대로 쓴다.
    계산이 리그당 0.4초쯤 걸리므로 원본과 같은 mtime 캐시에 담아 DB가 바뀔 때만 계산한다.
    """
    key = ("league_ranked:" + league, db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    # attach_rank_and_form()은 원본 df를 그대로 돌려줄 때가 있다(빈 데이터 등) —
    # 아래서 컬럼을 더 붙이기 전에 반드시 .copy()로 떼어내야 원본(raw) 캐시가
    # 오염되어 표시용 컬럼이 업로드/삭제 쪽으로 새어 들어가는 사고를 막는다.
    df = standings.attach_rank_and_form(load_league_df(db_path, league)).copy()
    df[PH_STATUS_COL] = _pick_status(df)
    _CACHE[key] = (mt, df)
    return df


def load_total_df(db_path: str) -> pd.DataFrame:
    """스코프 DB의 6개 리그를 합친 통합DB 로드(mtime 캐시)."""
    key = ("total", db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    frames = []
    for lg in LEAGUES:
        d = _read_table(db_path, lg)
        if len(d):
            d = d.copy()
            d["Source_League"] = lg
            frames.append(d)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    _CACHE[key] = (mt, df)
    return df


def df_to_records(df: pd.DataFrame):
    """DataFrame → JSON 안전한 레코드 리스트 (NaN→null, numpy타입 정리)."""
    import json
    if df is None or df.empty:
        return []
    return json.loads(df.to_json(orient="records", force_ascii=False,
                                 date_format="iso"))


def series_to_dict(s: pd.Series):
    """Series(엔진 결과) → JSON 안전한 dict."""
    import json
    return json.loads(pd.DataFrame([s]).to_json(orient="records",
                                                force_ascii=False)) [0]
