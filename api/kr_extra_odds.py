"""
국내 추가배당(와이즈토토) — ±2·±3.5 핸디, 언더오버 2.5·3.5.

리그 표(KW~KHL)에는 ±1 핸디와 승무패만 담는다. 그 밖의 라인은 표에 보여줄 필요는 없고
'이번주 벳'에서 유형으로 골라 걸 수 있으면 되므로, 리그 테이블이 아니라 이 별도
테이블에 쌓는다 — 26개 지표·리그 표 캐시와 완전히 무관하다(2026-09-15 사용자 지정).

[저장 형태 — kr_extra_odds]
  경기 키: code · S · R(끝의 'R' 뗀 값) · HT · AT
    No는 안 쓴다 — 국배 가져오기 저장 경로에서 No가 기존 경기 기준으로 다시 매겨지는데
    (_reconcile_crawl_no), 그 전에 받아 둔 값과 어긋날 수 있다. K리그는 같은 시즌에 같은
    홈·원정 조합이 여러 번 나오므로 R까지 넣는다.
  market: 'H' 핸디 / 'U' 언더오버
  line  : H — 와이즈토토 표기 그대로 홈 기준 핸디(-2.0이면 홈 -2, +3.5면 원정 -3.5)
          U — 기준점(2.5, 3.5)
  K1·KX·K2   : 초기배당(변경 이력으로 복원한 값)
  EK1·EKX·EK2: 최종배당(가져온 순간 화면값)
    H — 1=홈 승 / X=무 / 2=홈 패 (KHW/KHD/KHL과 같은 홈 기준. 3.5는 무 칸 없음)
    U — 1=언더 / 2=오버 (X 없음)
"""
import re
import sqlite3
from datetime import datetime

TABLE = "kr_extra_odds"

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS "{TABLE}" (
    code TEXT NOT NULL,
    S TEXT NOT NULL,
    R TEXT NOT NULL,
    HT TEXT NOT NULL,
    AT TEXT NOT NULL,
    market TEXT NOT NULL,
    line REAL NOT NULL,
    K1 REAL, KX REAL, K2 REAL,
    EK1 REAL, EKX REAL, EK2 REAL,
    updated_dt TEXT,
    PRIMARY KEY (code, S, R, HT, AT, market, line)
)
"""

# 벳 유형 이름 — 사용자 지정(2026-09-15). 핸디는 정배 기준(기존 핸승/핸무/플핸이 ±1인 것과
# 같은 방식), 3.5는 무승부 칸이 없어 핸무가 없다.
HANDI_PICKS = ("2핸승", "2핸무", "2플핸", "3.5핸승", "3.5플핸")
OU_PICKS = ("2.5언더", "2.5오버", "3.5언더", "3.5오버")
EXTRA_PICKS = HANDI_PICKS + OU_PICKS

_HANDI_RE = re.compile(r"^(2|3\.5)(핸승|핸무|플핸)$")
_OU_RE = re.compile(r"^(2\.5|3\.5)(언더|오버)$")


def parse_pick(pick_type: str):
    """추가배당 유형이면 ('H', 크기, '핸승'|'핸무'|'플핸') 또는 ('U', 기준점, '언더'|'오버'),
    아니면 None."""
    if pick_type not in EXTRA_PICKS:
        return None
    m = _HANDI_RE.match(pick_type)
    if m:
        return ("H", float(m.group(1)), m.group(2))
    m = _OU_RE.match(pick_type)
    return ("U", float(m.group(1)), m.group(2))


def norm_round(r) -> str:
    return re.sub(r"[Rr]$", "", str(r).strip())


def _key(code, s, r, ht, at) -> tuple:
    return (str(code).strip(), str(s).strip(), norm_round(r), str(ht).strip(), str(at).strip())


def _f(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 1.0 else None


def upsert(db_path: str, code: str, items: list[tuple]) -> int:
    """items: [(S, R, HT, AT, extra_list)] — extra_list는 kr_crawler._to_row의 '_extra'.

    같은 라인을 다시 받으면 새 값으로 갱신하되, 이번에 비어 온 칸은 예전 값을 지우지
    않는다(마감 직전 한쪽 배당만 빠지는 경우가 있다). 쓴 줄 수를 돌려준다."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    for s, r, ht, at, extra in items:
        for x in extra or []:
            try:
                line = float(x["line"])
            except (KeyError, TypeError, ValueError):
                continue
            vals = [_f(x.get(c)) for c in ("K1", "KX", "K2", "EK1", "EKX", "EK2")]
            if all(v is None for v in vals):
                continue
            rows.append((*_key(code, s, r, ht, at), x["market"], line, *vals, now))
    if not rows:
        return 0
    con = sqlite3.connect(db_path)
    try:
        con.execute(_SCHEMA)
        con.executemany(f"""
            INSERT INTO "{TABLE}" (code, S, R, HT, AT, market, line,
                                   K1, KX, K2, EK1, EKX, EK2, updated_dt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (code, S, R, HT, AT, market, line) DO UPDATE SET
                K1 = COALESCE(excluded.K1, K1),
                KX = COALESCE(excluded.KX, KX),
                K2 = COALESCE(excluded.K2, K2),
                EK1 = COALESCE(excluded.EK1, EK1),
                EKX = COALESCE(excluded.EKX, EKX),
                EK2 = COALESCE(excluded.EK2, EK2),
                updated_dt = excluded.updated_dt
        """, rows)
        con.commit()
    finally:
        con.close()
    return len(rows)


def load_index(db_path: str) -> dict:
    """{(code,S,R,HT,AT): [ {market, line, K1..EK2}, ... ]} — 테이블이 없으면 빈 dict."""
    con = sqlite3.connect(db_path)
    try:
        exists = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone()
        if not exists:
            return {}
        cur = con.execute(f"""
            SELECT code, S, R, HT, AT, market, line, K1, KX, K2, EK1, EKX, EK2
            FROM "{TABLE}"
        """)
        out: dict = {}
        for code, s, r, ht, at, market, line, *vals in cur.fetchall():
            out.setdefault(_key(code, s, r, ht, at), []).append({
                "market": market, "line": line,
                "K1": vals[0], "KX": vals[1], "K2": vals[2],
                "EK1": vals[3], "EKX": vals[4], "EK2": vals[5],
            })
        return out
    finally:
        con.close()


def lookup(index: dict, code, s, r, ht, at) -> list:
    return index.get(_key(code, s, r, ht, at), [])


def pick_handi_line(lines: list, size: float, home_is_fav):
    """크기가 size(2 또는 3.5)인 핸디 줄을 고른다.

    와이즈토토는 핸디를 정배 쪽에 붙인다(홈 정배면 -, 원정 정배면 +). 배당이 크게 움직여
    같은 크기의 -·+ 줄이 둘 다 남아 있으면, 지금 정배(home_is_fav)와 부호가 맞는 줄을 쓴다.
    home_is_fav를 모르면(None) 먼저 나온 줄을 쓴다. 없으면 None."""
    cands = [x for x in lines if x["market"] == "H" and abs(abs(float(x["line"])) - size) < 1e-6]
    if not cands:
        return None
    if len(cands) > 1 and home_is_fav is not None:
        for x in cands:
            if (float(x["line"]) < 0) == home_is_fav:
                return x
    return cands[0]


def judge(pick_type: str, hs, as_, handi_line) -> str | None:
    """추가배당 유형 한 다리를 스코어로 판정한다. 판정할 수 없으면 None(=대기).

    handi_line: 핸디 유형일 때 pick_handi_line로 고른 줄(그 부호로 정배를 정한다).
      핸디 N 정배 기준 — 정배 득실차 − N > 0 핸승 / = 0 핸무 / < 0 플핸
      언더오버 L — 총득점 < L 언더 / > L 오버
    """
    p = parse_pick(pick_type)
    if p is None:
        return None
    try:
        h, a = int(float(hs)), int(float(as_))
    except (TypeError, ValueError):
        return None
    market, size, kind = p
    if market == "U":
        total = h + a
        if kind == "언더":
            return "적중" if total < size else "미적중"
        return "적중" if total > size else "미적중"
    if handi_line is None:
        return None
    fav_home = float(handi_line["line"]) < 0
    adj = (h - a if fav_home else a - h) - size
    outcome = "핸승" if adj > 0 else ("핸무" if adj == 0 else "플핸")
    return "적중" if outcome == kind else "미적중"
