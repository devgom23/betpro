"""동배당(같은 회차에 국내배당이 똑같은 경기) — 회차별로 미리 묶어 둔다.

[왜 서버로 옮겼나 — 2026-09-23 사용자 지정]
  예전엔 화면(LeagueTable.jsx)이 /api/week_list(오늘이 속한 회차)를 받아 그 안에서만
  겹침을 찾았다. 그래서 회차가 넘어가면(예: 화요일 밤까지 금~화 회차였다가 수요일
  새벽에 수~목 회차로 바뀜) 바로 어제까지 보이던 지난 주말 경기들이 비교 대상에서
  통째로 빠져, 같은 배당이 여러 개여도 이중밑줄이 사라졌다. "오늘이 언제냐"에 따라
  같은 경기의 화면이 달라지는 구조였다.

  이제 6대리그 전 경기를 회차별로 묶어 두고(캐시), 화면은 자기가 그리는 경기의 회차만
  달라고 한다. 과거 회차를 열어도 그때 기준으로 정확히 같은 밑줄이 나온다.

[회차 기준]
  베팅내역(bet_slips._round_range)·화면(LeagueTable roundKey)과 **완전히 같은 규칙**을
  쓴다 — 금~월 묶음이고, 화·수·목 경기는 그 주에 이미 지나간 회차가 아니라 다가올
  금~월 회차에 붙인다. 회차 키는 그 묶음의 첫날(금요일) 'YYYY-MM-DD'.
  ⚠ main._current_week_block(금~화 / 수~목)과는 다른 규칙이다 — 그쪽은 '이번주 리스트'가
  오늘 기준으로 보여줄 구간을 정하는 용도라 여기 회차 묶음과 목적이 다르다.

[무엇을 같은 배당으로 보나 — 국배(와이즈토토) 기준]
  정배 : min(KW, KL). KW == KL(동배)은 어느 쪽이 정배인지 못 가려 제외.
  플핸 : 언더독 쪽 핸디배당(KW > KL이면 홈이 언더독 → KHW, 아니면 KHL).
  둘 다 소수 둘째 자리 문자열로 맞춰 비교한다(1.5와 1.50을 같은 값으로 본다).
  K1/K2(내 데이터)는 빼고 6대리그끼리만 본다 — 화면의 MAJOR_LEAGUES와 같은 범위.
"""
import re
from datetime import date, timedelta

import pandas as pd

import betpro_paths as PATHS
import data_access as DATA

_DT_RE = re.compile(r"(\d{2})-(\d{2})-(\d{2})")

# 화면에 넘기는 칸 — 호버 문구(utils/sameOdds.js)가 쓰는 값 전부.
COLS = ("S", "R", "No", "DT", "TM", "HT", "AT", "HS", "AS", "RT", "KW", "KL", "KHW", "KHL")


def round_key(dt_str) -> str | None:
    """DT('YY-MM-DD (Day)') → 그 경기가 속한 회차의 첫날(금요일) 'YYYY-MM-DD'."""
    m = _DT_RE.search(str(dt_str or ""))
    if not m:
        return None
    yy, mm, dd = (int(v) for v in m.groups())
    try:
        d = date(2000 + yy, mm, dd)
    except ValueError:
        return None
    wd = d.weekday()                       # 월=0 … 일=6
    if wd in (4, 5, 6):                    # 금·토·일
        friday = d - timedelta(days=wd - 4)
    elif wd == 0:                          # 월
        friday = d - timedelta(days=3)
    else:                                  # 화·수·목 → 다가올 금요일 회차
        friday = d + timedelta(days=4 - wd)
    return friday.isoformat()


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(f) or f <= 0 else f


def _fav_odds(row) -> str | None:
    w, l = _num(row.get("KW")), _num(row.get("KL"))
    if w is None or l is None or w == l:
        return None
    return f"{min(w, l):.2f}"


def _pl_odds(row) -> str | None:
    w, l = _num(row.get("KW")), _num(row.get("KL"))
    if w is None or l is None or w == l:
        return None
    v = _num(row.get("KHW") if w > l else row.get("KHL"))
    return None if v is None else f"{v:.2f}"


def _build(db: str) -> dict:
    """{회차: {'fav': {배당: [경기…]}, 'pl': {…}}} — 2경기 이상 겹친 것만 남긴다."""
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
            for kind, odds in (("fav", _fav_odds(rec)), ("pl", _pl_odds(rec))):
                if odds is None:
                    continue
                if item is None:
                    item = {"L": code, **{k: (None if pd.isna(v) else v) for k, v in rec.items()}}
                out.setdefault(rk, {"fav": {}, "pl": {}})[kind].setdefault(odds, []).append(item)
    for rk, kinds in out.items():
        for kind, groups in kinds.items():
            kinds[kind] = {o: g for o, g in groups.items() if len(g) >= 2}
    return {rk: kinds for rk, kinds in out.items() if kinds["fav"] or kinds["pl"]}


def index(db: str | None = None) -> dict:
    """회차별 동배당 묶음(캐시). DB가 바뀌면 data_access 캐시가 알아서 다시 만든다."""
    db = db or PATHS.get_master_db()
    return DATA.cached_derive(db, "same_odds_index", lambda: _build(db))


def for_rounds(rounds, db: str | None = None) -> dict:
    """요청한 회차들만 뽑아 준다 — 화면이 그리는 경기의 회차만 받아 가볍게 쓴다."""
    idx = index(db)
    return {rk: idx[rk] for rk in dict.fromkeys(rounds) if rk in idx}
