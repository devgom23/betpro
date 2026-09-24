"""시즌분석 — 6대리그 라운드를 프로토 회차에 놓은 시즌 표 + 회차별 주간 라운드 지표(2026-09-24 사용자 지정).

사용자가 엑셀(통합 문서1)로 손으로 그리던 표를 시즌 전체로 자동화한 것이다.
  열  : 프로토 회차 — 주말(금~화, 1회차·2회차…), 주중 라운드가 있는 평일(수~목), 빈 주말은 휴식기로 묶음
  칸  : 그 회차에 놓인 리그 라운드 + 결과 (정 = 핸승+핸무 / 플 = 무+역)
  라운드는 경기가 가장 많이 열린 회차에 놓고, 다른 주로 옮겨 치른 경기는 연기·앞당김으로 따로 적되
  결과는 그 라운드에 합쳐 센다(엑셀의 '라리가 6R(6/3)'이 이 방식이었다).

[날짜]
  회차 배치는 프로토 기준(한국 날짜 — same_odds.round_key와 같은 규칙).
  연기·앞당김과 '요일'은 현지 경기일 기준 — 한국 시각 정오 전 킥오프는 현지 전날 경기로 본다
  (유럽 금요일 밤 경기가 한국 토요일 새벽으로 잡히면 요일표가 사용자 엑셀과 어긋났다).
[자료]
  결과·배당 = master.db 리그 표.
  이번 시즌은 스코어맨 일정(cup_matches.db, '리그 외 경기 및 결과 수집'이 받음)으로
    ① 앞으로 열릴 경기(우리 DB에 아직 없음)와 ② 연기된 경기의 새 날짜를 채운다
    — 우리 DB는 연기 경기를 원래 날짜에 두고 결과를 6(연기)로 적어 두기 때문이다.
  지난 시즌은 스코어맨 일정이 없지만, 우리 DB에 연기 경기가 실제로 치른 날짜로 들어 있다.
"""
import os
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

import pandas as pd

import betpro_paths as PATHS
import cup_matches as CUP
import data_access as DATA

LEAGUE_LABEL = {"EPL": "EPL", "LALIGA": "라리가", "SERIEA": "세리에A", "BUNDES": "분데스",
                "EREDIVISIE": "에레디", "LIGUE1": "리그1"}
WD = "월화수목금토일"
DDONG_MAX = 1.49      # 똥배 — main.py DDONG_MAX와 같은 값


def _week(d: date):
    """프로토 회차 첫날과 종류 — 수·목=평일(그 주 수요일), 금·토·일=주말(그 주 금요일), 월·화=지난 금요일."""
    wd = d.weekday()
    if wd in (2, 3):
        return d - timedelta(days=wd - 2), "평일"
    if wd >= 4:
        return d - timedelta(days=wd - 4), "주말"
    return d - timedelta(days=wd + 3), "주말"


def _round_no(v) -> int:
    return int(re.sub(r"\D", "", str(v)) or 0)


def _sm_season(season: str) -> str:
    a, b = season.split("-")
    return f"20{a}-20{b}"


def seasons(db=None) -> list:
    db = db or PATHS.get_master_db()
    out = set()
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df(db, code)
        if not df.empty:
            out.update(str(s) for s in df["S"].dropna().unique())
    return sorted(out, reverse=True)


def _schedule(season: str) -> dict:
    """스코어맨 일정 — {(리그, 라운드, 홈, 원정): (한국 날짜, 시)}. 없는 시즌이면 {}."""
    path = CUP.schedule_db()
    if not os.path.exists(path):
        return {}
    con = sqlite3.connect(path)
    try:
        names = {r[0]: r[1] for r in con.execute("SELECT team_id, db_name FROM sm_teams")}
        rows = con.execute(
            f"SELECT comp, stage, kickoff, home_id, away_id, home_name, away_name FROM cup_matches "
            f"WHERE season = ? AND comp IN ({','.join('?' * len(PATHS.LEAGUES))})",
            (_sm_season(season), *PATHS.LEAGUES)).fetchall()
    except sqlite3.Error:
        return {}
    finally:
        con.close()
    out = {}
    for comp, stage, ko, hid, aid, hn, an in rows:
        try:
            dt = datetime.strptime(ko, "%Y-%m-%d %H:%M")
        except (TypeError, ValueError):
            continue
        out[(comp, _round_no(stage), names.get(hid, hn), names.get(aid, an))] = (dt.date(), dt.hour)
    return out


def _num(v):
    f = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(f) else float(f)


def build(season: str, db=None) -> dict:
    db = db or PATHS.get_master_db()
    sched = _schedule(season)
    games = []          # 경기 하나 = dict
    seen = set()
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df(db, code)
        if df.empty:
            continue
        df = df[df["S"].astype(str) == season]
        for rec in df.to_dict("records"):
            r = _round_no(rec.get("R"))
            ht, at = str(rec.get("HT") or "").strip(), str(rec.get("AT") or "").strip()
            s = str(rec.get("DT") or "")
            try:
                d = date(2000 + int(s[0:2]), int(s[3:5]), int(s[6:8]))
            except ValueError:
                continue
            tm = _num(rec.get("TM"))
            hour = int(tm // 100) if tm is not None else 15
            rt = _num(rec.get("RT"))
            rt = int(rt) if rt is not None else None
            sk = (code, r, ht, at)
            # 결과 전이거나 연기(6)로 적힌 경기는 스코어맨 일정의 (새) 날짜를 쓴다.
            if sk in sched and rt not in (1, 2, 3, 4):
                d, hour = sched[sk]
            seen.add(sk)
            kw, kl = _num(rec.get("KW")), _num(rec.get("KL"))
            fav_home = None if kw is None or kl is None or kw == kl else kw < kl
            games.append({"lg": code, "r": r, "ht": ht, "at": at, "d": d, "hour": hour,
                          "rt": rt if rt in (1, 2, 3, 4) else None,
                          "hs": _num(rec.get("HS")), "as": _num(rec.get("AS")),
                          "fav": None if fav_home is None else (ht if fav_home else at),
                          "favOdds": None if fav_home is None else round(min(kw, kl), 2),
                          "cancel": rt == 5})
    for (code, r, ht, at), (d, hour) in sched.items():     # 우리 DB에 아직 없는 앞으로의 경기
        if (code, r, ht, at) not in seen:
            games.append({"lg": code, "r": r, "ht": ht, "at": at, "d": d, "hour": hour, "rt": None,
                          "hs": None, "as": None, "fav": None, "favOdds": None, "cancel": False})
    if not games:
        return {"season": season, "leagues": [], "cols": [], "res": {}, "moved": {}, "games": {}}

    # ① 라운드 → 경기가 가장 많이 열린 회차(취소 경기는 날짜가 의미 없어 뺀다)
    by_round = defaultdict(list)
    week_type, week_days = {}, defaultdict(set)
    for g in games:
        by_round[(g["lg"], g["r"])].append(g)
        if g["cancel"]:
            continue
        k, t = _week(g["d"])
        week_type[k] = t
        week_days[k].add(g["d"])
    placed = defaultdict(dict)
    moved = {}
    for (lg, r), gl in by_round.items():
        c = Counter(_week(g["d"])[0] for g in gl if not g["cancel"])
        if not c:
            continue
        k = c.most_common(1)[0][0]
        placed[k][lg] = r
        end = k + timedelta(days=1 if week_type[k] == "평일" else 4)
        late, early = [], []
        for g in gl:
            if g["cancel"]:
                continue
            ld = g["d"] - timedelta(days=1) if g["hour"] < 12 else g["d"]   # 현지 경기일
            item = {"d": str(ld), "ht": g["ht"], "at": g["at"]}
            if ld > end:
                late.append(item)
            elif ld < k - timedelta(days=2):     # 같은 주 하루 먼저(현지 화·목 밤)는 앞당김 아님
                early.append(item)
        if late or early:
            moved[f"{lg}|{r}"] = {"late": sorted(late, key=lambda x: x["d"]), "early": early}

    # ② 열 — 주말 회차 전부 + 라운드가 놓인 평일 + 빈 주말은 휴식기로 묶는다
    weekends = sorted(k for k, t in week_type.items() if t == "주말")
    cols, n = [], 0
    k, last = weekends[0], max(week_type)
    while k <= last:
        wed = k - timedelta(days=2)
        if wed in placed and week_type.get(wed) == "평일":
            days = sorted(week_days[wed])
            cols.append({"type": "평일", "key": str(wed), "label": "평일",
                         "from": str(days[0]), "to": str(days[-1]), "rounds": placed[wed]})
        if k in placed:
            n += 1
            days = sorted(d for d in week_days[k] if _week(d)[0] == k)
            cols.append({"type": "주말", "key": str(k), "label": f"{n}회차",
                         "from": str(k), "to": str(days[-1] if days else k), "rounds": placed[k]})
        elif cols and cols[-1]["type"] == "휴식기":
            cols[-1]["to"] = str(k + timedelta(days=3))
        else:
            cols.append({"type": "휴식기", "key": str(k), "label": "휴식기",
                         "from": str(k), "to": str(k + timedelta(days=3)), "rounds": {}})
        k += timedelta(days=7)

    # ③ 라운드 결과와 경기 목록(주간 지표용 — 요일은 현지 경기일)
    res, out_games = {}, {}
    for (lg, r), gl in by_round.items():
        c = [sum(1 for g in gl if g["rt"] == v) for v in (1, 2, 3, 4)]
        res[f"{lg}|{r}"] = {"c": c, "n": len(gl), "done": sum(c)}
        out_games[f"{lg}|{r}"] = [
            {"ht": g["ht"], "at": g["at"], "d": str(g["d"]),
             "wd": WD[(g["d"] - timedelta(days=1) if g["hour"] < 12 else g["d"]).weekday()],
             "rt": g["rt"], "fav": g["fav"], "favOdds": g["favOdds"]}
            for g in sorted(gl, key=lambda x: (x["d"], x["hour"]))]
    return {"season": season,
            "leagues": [{"code": c, "label": LEAGUE_LABEL.get(c, c)} for c in PATHS.LEAGUES],
            "cols": cols, "res": res, "moved": moved, "games": out_games, "ddongMax": DDONG_MAX}


def get(season: str, db=None) -> dict:
    """캐시 — 리그 표나 스코어맨 일정 파일이 바뀌면 다시 만든다."""
    db = db or PATHS.get_master_db()
    try:
        mt = os.path.getmtime(CUP.schedule_db())
    except OSError:
        mt = 0
    return DATA.cached_derive(db, f"season_view:{season}:{mt}", lambda: build(season, db),
                              tables=tuple(PATHS.LEAGUES))
