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
    df = standings.attach_rank_and_form(load_league_df(db_path, league))
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
