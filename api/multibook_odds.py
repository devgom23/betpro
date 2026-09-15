"""
스코어맨 12개 배당사 초기·마감 배당 — DB에 쌓기만 한다(2026-09-15 사용자 지정).

[왜 master.db가 아니라 별도 파일(multibook.db)인가]
  과거 경기 백필은 몇 시간씩 따로 도는 프로세스다. 그게 master.db에 쓰면 API 서버는
  '알리지 않은 변경'으로 보고 리그 캐시를 통째로 버려서 화면이 계속 느려진다
  (data_access.py _token 주석). 경기당 12줄이라 양도 커서(3만 경기 ≈ 40만 줄) 파일을 나눈다.

[저장 형태 — mb_odds] 한 줄 = 경기 하나 × 배당사 하나
  경기 키: code · S · R(끝 'R' 뗀 값) · HT · AT (kr_extra_odds와 같은 키, DB 팀명 기준)
  mid: 스코어맨 경기 ID · book: 배당사 이름 · 나머지 칸은 scoreman_odds.match_books 참고.
"""
import os
import sqlite3
from datetime import datetime

import betpro_paths as PATHS
from kr_extra_odds import _key

TABLE = "mb_odds"
VAL_COLS = [f"{m}_{s}{k}" for s in ("F", "L") for m, ks in
            (("EU", ("1", "X", "2")), ("AH", ("G", "1", "2")), ("OU", ("G", "O", "U"))) for k in ks]

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS "{TABLE}" (
    code TEXT NOT NULL, S TEXT NOT NULL, R TEXT NOT NULL, HT TEXT NOT NULL, AT TEXT NOT NULL,
    mid TEXT, book TEXT NOT NULL, cid INTEGER,
    {", ".join(f"{c} REAL" for c in VAL_COLS)},
    updated_dt TEXT,
    PRIMARY KEY (code, S, R, HT, AT, book)
)
"""


def db_path_for(scope: str, username: str | None = None) -> str:
    base = (PATHS.get_master_dir() if scope == PATHS.SCOPE_MASTER
            else os.path.dirname(PATHS.get_user_db(username)))
    return os.path.join(base, "multibook.db")


def _connect(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(path, timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(_SCHEMA)
    return con


def upsert(path: str, code: str, s, r, ht, at, mid, books: list[dict]) -> int:
    """경기 하나의 배당사 줄들을 저장한다. 이번에 비어 온 칸은 예전 값을 지우지 않는다."""
    if not books:
        return 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    k = _key(code, s, r, ht, at)
    rows = [(*k, str(mid), b["book"], b.get("cid"), *[b.get(c) for c in VAL_COLS], now) for b in books]
    sets = ", ".join(f"{c} = COALESCE(excluded.{c}, {c})" for c in VAL_COLS)
    con = _connect(path)
    try:
        con.executemany(f"""
            INSERT INTO "{TABLE}" (code, S, R, HT, AT, mid, book, cid, {", ".join(VAL_COLS)}, updated_dt)
            VALUES ({", ".join("?" for _ in range(8 + len(VAL_COLS) + 1))})
            ON CONFLICT (code, S, R, HT, AT, book) DO UPDATE SET
                mid = excluded.mid, cid = excluded.cid, {sets}, updated_dt = excluded.updated_dt
        """, rows)
        con.commit()
    finally:
        con.close()
    return len(rows)


def done_keys(path: str, code: str, s) -> set:
    """이미 저장된 경기 키 — 백필을 이어서 돌릴 때 건너뛴다."""
    if not os.path.exists(path):
        return set()
    con = _connect(path)
    try:
        return {tuple(x) for x in con.execute(
            f'SELECT DISTINCT code, S, R, HT, AT FROM "{TABLE}" WHERE code = ? AND S = ?',
            (code, str(s).strip()))}
    finally:
        con.close()
