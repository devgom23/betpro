"""
해외 언더오버 배당(스코어맨 Bet365) — DB에 쌓기만 한다(2026-09-15 사용자 지정).

리그 표에는 칸이 없고 화면에도 안 보여준다. 국내 추가배당(kr_extra_odds)과 같은 경기 키
(code · S · R(끝 'R' 뗀 값) · HT · AT)로 한 경기 한 줄씩 저장한다.

  FOU  · FOUO  · FOUU   최초 기준점 · 오버 · 언더
  EFOU · EFOUO · EFOUU  라이브(=최종) 기준점 · 오버 · 언더
  기준점은 아시안 토탈이라 2.5뿐 아니라 2.75·3·3.25처럼 나오고, 배변 때 움직인다.
"""
import sqlite3
from datetime import datetime

from kr_extra_odds import _key
from scoreman_odds import OU_KEYS

TABLE = "f_ou_odds"

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS "{TABLE}" (
    code TEXT NOT NULL,
    S TEXT NOT NULL,
    R TEXT NOT NULL,
    HT TEXT NOT NULL,
    AT TEXT NOT NULL,
    FOU REAL, FOUO REAL, FOUU REAL,
    EFOU REAL, EFOUO REAL, EFOUU REAL,
    updated_dt TEXT,
    PRIMARY KEY (code, S, R, HT, AT)
)
"""


def pick_ou(odds: dict) -> dict | None:
    """match_odds 결과에서 언더오버 칸만 떼어낸다. 전부 비었으면 None."""
    ou = {k: odds.get(k) for k in OU_KEYS}
    return ou if any(v is not None for v in ou.values()) else None


def upsert(db_path: str, code: str, items: list[tuple]) -> int:
    """items: [(S, R, HT, AT, pick_ou 결과)]. 이번에 비어 온 칸은 예전 값을 지우지 않는다.
    쓴 경기 수를 돌려준다."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = [(*_key(code, s, r, ht, at), *[ou.get(k) for k in OU_KEYS], now)
            for s, r, ht, at, ou in items if ou]
    if not rows:
        return 0
    sets = ",\n                ".join(f"{k} = COALESCE(excluded.{k}, {k})" for k in OU_KEYS)
    con = sqlite3.connect(db_path)
    try:
        con.execute(_SCHEMA)
        con.executemany(f"""
            INSERT INTO "{TABLE}" (code, S, R, HT, AT, {", ".join(OU_KEYS)}, updated_dt)
            VALUES (?, ?, ?, ?, ?, {", ".join("?" for _ in OU_KEYS)}, ?)
            ON CONFLICT (code, S, R, HT, AT) DO UPDATE SET
                {sets},
                updated_dt = excluded.updated_dt
        """, rows)
        con.commit()
    finally:
        con.close()
    return len(rows)
