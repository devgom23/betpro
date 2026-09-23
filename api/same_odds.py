"""동배당(같은 프로토 회차에 국내배당이 똑같은 경기) — 회차별로 미리 묶어 둔다.

[왜 서버로 옮겼나 — 2026-09-23 사용자 지정]
  예전엔 화면(LeagueTable.jsx)이 /api/week_list(오늘이 속한 회차)를 받아 그 안에서만
  겹침을 찾았다. 그래서 회차가 넘어가면 어제까지 보이던 지난 회차 밑줄이 통째로
  사라졌다. 이제 6대리그 전 경기를 회차별로 묶어 두고(캐시), 화면은 자기가 그리는
  경기의 회차만 달라고 한다 — 언제 보든 같은 결과가 나온다.

[회차 기준 — 프로토 회차(금~화 / 수~목)]
  ⚠ 2026-09-23 사용자 지적으로 고쳤다. 처음엔 베팅내역(bet_slips._round_range)과 같은
  금~월(화·수·목은 다가올 회차) 규칙을 썼는데, 그러면 수요일 경기가 주말 경기와 한
  회차로 묶인다. 프로토는 **금~화 / 수~목**으로 회차가 끊긴다(kr_crawler.py 주석과
  main._current_week_block도 같은 규칙).
  프로토 경기번호(gno)로 검증했다 — 2026년 9월:
    9/11 금~화(9/12~9/15) gno 739~1760 · 9/16 수~목(9/16~9/17) gno 1939~2304
    9/18 금~화(9/18~9/21) gno 2533~3651
  회차마다 번호 대역이 뚜렷이 갈린다. 회차 키는 그 묶음의 첫날('YYYY-MM-DD') —
  금~화는 금요일, 수~목은 수요일이라 날짜만으로 안 겹친다.

[무엇을 같은 배당으로 보나 — 국배(와이즈토토) 기준]
  정배 : min(승, 패). 승 == 패(동배)는 어느 쪽이 정배인지 못 가려 제외.
  플핸 : 언더독 쪽 핸디배당(승 > 패면 홈이 언더독 → 핸디승, 아니면 핸디패).
  초기(KW…)와 배변(EKW…) **양쪽 다** 따로 묶는다(2026-09-23 사용자 지정 — 배변으로만
  같아지는 경기가 실제로 있다). 소수 둘째 자리 문자열로 맞춰 비교한다.
  K1/K2(내 데이터)는 빼고 6대리그끼리만 본다.
"""
import re
from datetime import date, timedelta

import pandas as pd

import betpro_paths as PATHS
import data_access as DATA

_DT_RE = re.compile(r"(\d{2})-(\d{2})-(\d{2})")

# 화면이 쓰는 칸 — 경기 식별 + 결과 + 초기·배변 배당(승무패·핸디) 전부.
COLS = ("S", "R", "No", "DT", "TM", "HT", "AT", "HS", "AS", "RT",
        "KW", "KD", "KL", "KHW", "KHD", "KHL",
        "EKW", "EKD", "EKL", "EKHW", "EKHD", "EKHL")

# 묶음 종류 — (응답 키, 배당 컬럼 접두사, 정배/플핸)
KINDS = (("fav", "", "fav"), ("pl", "", "pl"),
         ("efav", "E", "fav"), ("epl", "E", "pl"))


def round_key(dt_str) -> str | None:
    """DT('YY-MM-DD (Day)') → 그 경기가 속한 프로토 회차의 첫날 'YYYY-MM-DD'."""
    m = _DT_RE.search(str(dt_str or ""))
    if not m:
        return None
    yy, mm, dd = (int(v) for v in m.groups())
    try:
        d = date(2000 + yy, mm, dd)
    except ValueError:
        return None
    wd = d.weekday()                      # 월=0 … 일=6
    if wd in (2, 3):                      # 수·목 → 그 주 수요일
        return (d - timedelta(days=wd - 2)).isoformat()
    if wd >= 4:                           # 금·토·일 → 그 주 금요일
        return (d - timedelta(days=wd - 4)).isoformat()
    return (d - timedelta(days=wd + 3)).isoformat()   # 월·화 → 지난 금요일


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(f) or f <= 0 else f


def odds_of(row, prefix: str, kind: str) -> str | None:
    """그 경기의 '정배' 또는 '플핸' 배당값(문자열). 못 가리면 None.
    prefix='' 초기 · 'E' 배변. 화면(LeagueTable favOddsKey/plOddsKey)과 같은 규칙."""
    w, l = _num(row.get(prefix + "KW")), _num(row.get(prefix + "KL"))
    if w is None or l is None or w == l:
        return None
    if kind == "fav":
        return f"{min(w, l):.2f}"
    v = _num(row.get(prefix + ("KHW" if w > l else "KHL")))
    return None if v is None else f"{v:.2f}"


def _build(db: str) -> dict:
    """{회차: {종류: {배당: [경기…]}}} — 2경기 이상 겹친 것만 남긴다."""
    out: dict[str, dict[str, dict[str, list]]] = {}
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df_ev(db, code)
        if df.empty:
            continue
        cols = [c for c in COLS if c in df.columns]
        for rec in df[cols].to_dict("records"):
            rk = round_key(rec.get("DT"))
            if rk is None:
                continue
            item = None
            for key, prefix, kind in KINDS:
                odds = odds_of(rec, prefix, kind)
                if odds is None:
                    continue
                if item is None:
                    item = {"L": code, **{k: (None if pd.isna(v) else v) for k, v in rec.items()}}
                slot = out.setdefault(rk, {k: {} for k, _, _ in KINDS})
                slot[key].setdefault(odds, []).append(item)
    for rk, kinds in out.items():
        for key in list(kinds):
            kinds[key] = {o: g for o, g in kinds[key].items() if len(g) >= 2}
    return {rk: kinds for rk, kinds in out.items() if any(kinds.values())}


def index(db: str | None = None) -> dict:
    """회차별 동배당 묶음(캐시). DB가 바뀌면 data_access 캐시가 알아서 다시 만든다."""
    db = db or PATHS.get_master_db()
    return DATA.cached_derive(db, "same_odds_index_v2", lambda: _build(db))


def for_rounds(rounds, db: str | None = None) -> dict:
    """요청한 회차들만 뽑아 준다 — 화면이 그리는 경기의 회차만 받아 가볍게 쓴다."""
    idx = index(db)
    return {rk: idx[rk] for rk in dict.fromkeys(rounds) if rk in idx}


def _trio(rec, prefix: str, kind: str):
    """화면에 '(1.59/3.45/4.60)'으로 찍을 세 칸과, 그중 동배당인 칸의 위치(hit).
    정배는 승·무·패, 플핸은 핸디 승·무·패를 보여준다 — 동배 기준이 되는 값이 그 안에
    들어 있어야 어디가 겹친 건지 눈으로 보인다(2026-09-23 사용자 지정)."""
    w, l = _num(rec.get(prefix + "KW")), _num(rec.get(prefix + "KL"))
    if w is None or l is None or w == l:
        return None, None
    base = prefix + ("KH" if kind == "pl" else "K")
    vals = [_num(rec.get(base + s)) for s in ("W", "D", "L")]
    hit = (0 if w < l else 2) if kind == "fav" else (0 if w > l else 2)
    return [None if v is None else f"{v:.2f}" for v in vals], hit


def _sort_key(g):
    return (str(g.get("DT") or ""), str(g.get("TM") or ""))


def for_match(row: dict, db: str | None = None) -> dict | None:
    """상세보기 '같은 회차 동배당 결과' 섹션 — 이 경기가 속한 묶음 4종(초기·배변 ×
    정배·플핸)에서 자기 자신을 뺀 나머지. 같은 배당이 없으면 games=[]로 둔다
    (배변이 초기와 똑같아도 줄을 지우지 않는다 — '움직였다가 제자리로 왔구나'까지
    보이게, 2026-09-23 사용자 지정)."""
    rk = round_key(row.get("DT"))
    if rk is None:
        return None
    kinds = index(db).get(rk) or {}
    me = (str(row.get("S")), str(row.get("R")), str(row.get("HT")).strip(), str(row.get("AT")).strip())
    out = {"round": rk, "groups": []}
    for key, prefix, kind in KINDS:
        odds = odds_of(row, prefix, kind)
        if odds is None:
            continue
        games = []
        for g in sorted(kinds.get(key, {}).get(odds, []), key=_sort_key):
            if (str(g.get("S")), str(g.get("R")), str(g.get("HT")).strip(),
                    str(g.get("AT")).strip()) == me:
                continue
            trio, hit = _trio(g, prefix, kind)
            games.append({
                "league": PATHS.LEAGUE_LABEL.get(g.get("L"), g.get("L")),
                "round": str(g.get("R") or "").strip(),
                "dt": g.get("DT"), "tm": g.get("TM"),
                "home": str(g.get("HT") or "").strip(),
                "away": str(g.get("AT") or "").strip(),
                "hs": None if g.get("HS") is None else int(g["HS"]),
                "as_": None if g.get("AS") is None else int(g["AS"]),
                "rt": None if g.get("RT") is None else int(g["RT"]),
                "odds": trio, "hit": hit,
            })
        out["groups"].append({"key": key, "phase": "배변" if prefix else "초기",
                              "kind": kind, "odds": odds, "games": games})
    return out if out["groups"] else None
