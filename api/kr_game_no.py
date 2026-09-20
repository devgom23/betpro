"""
국배(와이즈토토) 경기 순번 — 그 회차 화면에 뜬 순서.

[왜 리그 표 컬럼이 아니라 별도 테이블인가]
  리그 표에 칸을 늘리려면 engine.preprocess_data()의 target_cols에 이름을 넣어야 하는데,
  그 함수는 오랜 실측 검증을 거쳐 확정된 분석 엔진이라 손대지 않는다(CLAUDE.md 4장).
  목록에 없는 컬럼은 저장 과정에서 통째로 버려지므로 리그 표로는 못 간다.
  그래서 추가배당(kr_extra_odds)과 똑같이 별도 테이블에 쌓는다 — 26개 지표·리그 표
  캐시와 완전히 무관하다(2026-09-20 사용자 지정).

[저장 형태 — kr_game_no]
  경기 키: code · S · R(끝의 'R' 뗀 값) · HT · AT
    No는 안 쓴다 — 국배 가져오기 저장 경로에서 No가 기존 경기 기준으로 다시 매겨져
    어긋날 수 있다(kr_extra_odds.py와 같은 이유). K리그는 같은 시즌에 같은 홈·원정
    조합이 여러 번 나오므로 R까지 넣는다.
  gno  : 와이즈토토 프로토 경기번호 원본(예: 2085). 그 해 안에서 계속 올라가는 번호라
         정렬 기준으로 그대로 쓸 수 있다. 한 경기가 승무패·핸디·언더오버로 여러 번호를
         갖는데, 그중 가장 작은 번호(=승무패 줄)를 그 경기의 번호로 본다.
  gyear: 그 번호가 매겨진 프로토 연도. 12월 말~1월 초에 걸친 라운드는 gno만으로 앞뒤를
         못 가리므로 (gyear, gno) 두 개를 묶어 정렬한다.
  kno  : 그 리그·라운드 안에서 와이즈토토 나열 순서대로 매긴 1..N 순번.
         "국배 기준 몇 번째 경기냐"가 이 값이다 — 화면 정렬과 구간대 분석이 이걸 쓴다.
         와이즈토토에 안 올라온 경기는 아예 행이 없다(번호를 억지로 채우지 않는다).
"""
import re
import sqlite3
from datetime import datetime

TABLE = "kr_game_no"

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS "{TABLE}" (
    code TEXT NOT NULL,
    S TEXT NOT NULL,
    R TEXT NOT NULL,
    HT TEXT NOT NULL,
    AT TEXT NOT NULL,
    gno INTEGER,
    gyear INTEGER,
    kno INTEGER,
    updated_dt TEXT,
    PRIMARY KEY (code, S, R, HT, AT)
)
"""


def norm_round(r) -> str:
    return re.sub(r"[Rr]$", "", str(r).strip())


def _key(code, s, r, ht, at) -> tuple:
    return (str(code).strip(), str(s).strip(), norm_round(r), str(ht).strip(), str(at).strip())


def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def upsert(db_path: str, code: str, items: list[tuple]) -> int:
    """items: [(S, R, HT, AT, gno, gyear, kno)] — 쓴 줄 수를 돌려준다.

    같은 경기를 다시 받으면 새 값으로 덮어쓴다(회차가 재편성되면 번호도 바뀐다).
    셋 다 비어 온 줄은 건너뛴다.
    """
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    for s, r, ht, at, gno, gyear, kno in items:
        vals = (_int_or_none(gno), _int_or_none(gyear), _int_or_none(kno))
        if all(v is None for v in vals):
            continue
        rows.append((*_key(code, s, r, ht, at), *vals, now))
    if not rows:
        return 0
    con = sqlite3.connect(db_path)
    try:
        con.execute(_SCHEMA)
        con.executemany(f"""
            INSERT INTO "{TABLE}" (code, S, R, HT, AT, gno, gyear, kno, updated_dt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (code, S, R, HT, AT) DO UPDATE SET
                gno = excluded.gno,
                gyear = excluded.gyear,
                kno = excluded.kno,
                updated_dt = excluded.updated_dt
        """, rows)
        con.commit()
    finally:
        con.close()
    return len(rows)


def load_index(db_path: str) -> dict:
    """{(code,S,R,HT,AT): {gno, gyear, kno}} — 테이블이 없으면 빈 dict."""
    con = sqlite3.connect(db_path)
    try:
        exists = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone()
        if not exists:
            return {}
        cur = con.execute(f'SELECT code, S, R, HT, AT, gno, gyear, kno FROM "{TABLE}"')
        return {_key(code, s, r, ht, at): {"gno": gno, "gyear": gyear, "kno": kno}
                for code, s, r, ht, at, gno, gyear, kno in cur.fetchall()}
    finally:
        con.close()


def lookup(index: dict, code, s, r, ht, at):
    return index.get(_key(code, s, r, ht, at))
