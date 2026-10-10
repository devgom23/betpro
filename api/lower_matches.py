"""6대리그 나라의 2부리그 경기 결과 — 상대전적에 2부 시절 맞대결까지 보여주려고 따로 쌓는다(2026-10-11 사용자 지정).

[무엇을] 스코어맨 리그 일정 파일 jsData/matchResult/json/{시즌}/s{번호}_kr.json — 1부(crawler.DEFAULT_LEAGUE_IDS)와 같은 모양.
  결과(스코어)만 쓴다. 배당은 받지 않는다.
[어디에] master.db가 아닌 별도 파일 lower_matches.db(마스터 폴더) — 리그 외 경기(cup_matches.db)와 같은 방식.
  lower_matches(경기) · lower_teams(스코어맨 팀번호 → 우리 DB 팀명, 시즌별)
[팀 연결] 스코어맨 팀명에 1부 수집과 같은 별칭(crawler.list_aliases)을 적용한 이름 = 우리 DB 팀명.
  스코어맨은 대회가 달라도 같은 팀에 같은 이름·번호를 쓴다(cup_matches.py 주석). in_top = 그 이름이 우리 1부 DB에 있는 팀인가.
  1부에 한 번도 없던 팀은 이름 그대로 둔다(우리 DB 맞대결에는 어차피 안 걸린다).
[시즌] 우리 1부 DB와 같은 2009-10부터. 나라 순서대로 받는다(사용자 지정 — 잉글랜드부터).
[실행] 명령 프롬프트에서 따로 — api/collect_lower.py.
"""
import os
import re
import sqlite3
import time
from datetime import datetime

import betpro_paths as PATHS
import crawler as CRAWL
import data_access as DATA
import scoreman_odds as SM
from cup_matches import _score, _walk, shown_kickoff

# 1부 코드 → (2부 스코어맨 번호, 화면 이름) — 대회 번호는 스코어맨 대회 목록(infoHeaderKr.js)에서 확인(2026-10-11)
LOWER = {
    "EPL": (37, "챔피언십"),
    "LALIGA": (33, "세군다"),
    "SERIEA": (40, "세리에B"),
    "BUNDES": (9, "2.분데스"),
    "EREDIVISIE": (17, "에이르스터"),
    "LIGUE1": (12, "리그2"),
}
FIRST_SEASON = 2009          # 2009-2010부터(우리 1부 DB와 같은 범위)
GAP = 1.2                    # 스코어맨 요청 간격(초) — cup_matches.GAP과 같다
ADMIN = "admin"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS lower_matches (
    mid INTEGER PRIMARY KEY, code TEXT, lid INTEGER, comp_name TEXT, season TEXT, S TEXT, rnd TEXT,
    kickoff TEXT, state INTEGER, home_id INTEGER, away_id INTEGER, home_name TEXT, away_name TEXT,
    hs INTEGER, as_ INTEGER, ht_score TEXT, updated_dt TEXT
);
CREATE INDEX IF NOT EXISTS ix_lower_pair ON lower_matches(home_name, away_name);
CREATE TABLE IF NOT EXISTS lower_teams (
    team_id INTEGER, code TEXT, season TEXT, db_name TEXT, sm_name TEXT, in_top INTEGER, updated_dt TEXT,
    PRIMARY KEY (team_id, code, season)
);
"""
_COLS = ["mid", "code", "lid", "comp_name", "season", "S", "rnd", "kickoff", "state", "home_id", "away_id",
         "home_name", "away_name", "hs", "as_", "ht_score"]


def db_path() -> str:
    return os.path.join(PATHS.get_master_dir(), "lower_matches.db")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(db_path(), timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(_SCHEMA)
    return con


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def seasons(upto: int | None = None) -> list:
    """['2009-2010', …, 이번 시즌]. upto = 마지막 시즌 시작 연도(없으면 오늘 기준 — 7월부터 새 시즌)."""
    if upto is None:
        now = datetime.now()
        upto = now.year if now.month >= 7 else now.year - 1
    return [f"{y}-{y + 1}" for y in range(FIRST_SEASON, upto + 1)]


def _short(season: str) -> str:
    """'2009-2010' → '09-10'(우리 DB의 S 표기)."""
    a, b = season.split("-")
    return f"{a[2:]}-{b[2:]}"


def _get(lid: int, season: str):
    """시즌 일정 파일 — 스코어맨이 가끔 연결을 끊어서 몇 번 다시 시도한다. 못 받으면 None."""
    for i in range(4):
        try:
            return SM._get_json(f"{SM.BASE_LEAGUE}/jsData/matchResult/json/{season}/s{lid}_kr.json",
                                f"{SM.BASE_LEAGUE}/league/{lid}")
        except SM.OddsError:
            time.sleep(2 * (i + 1))
    return None


def _rounds(d) -> list:
    """세리에·에레디처럼 {"sub_…": {"R_1": […]}}로 한 겹 더 싸인 경우를 펼친다(cup_matches.fetch_league_season과 같은 규칙)."""
    out = []
    for skey, node in (d.get("ScheduleList") or {}).items():
        if isinstance(node, dict) and str(skey).startswith("sub_"):
            out.extend(node.items())
        else:
            out.append((skey, node))
    return out


def collect(code: str, season_list: list | None = None, log=print) -> dict:
    """한 나라의 2부를 시즌 순서대로 받아 저장한다."""
    lid2, name2 = LOWER[code]
    aliases = CRAWL.list_aliases(PATHS.get_user_db(ADMIN), PATHS.SCOPE_MASTER, code)
    top = DATA.load_league_df(PATHS.get_master_db(), code)
    top_teams = set(top["HT"].astype(str).str.strip()) | set(top["AT"].astype(str).str.strip()) if len(top) else set()
    res = {"seasons": 0, "matches": 0, "done": 0, "failed": []}
    con = _connect()
    try:
        for season in season_list or seasons():
            d2 = _get(lid2, season)
            time.sleep(GAP)
            if not d2:
                res["failed"].append(season)
                log(f"{name2} {season} — 받기 실패")
                continue
            teams = {}
            for t in d2.get("TeamInfo") or []:
                if isinstance(t, list) and len(t) > 1:
                    db = aliases.get(t[1], t[1]).strip()
                    teams[t[0]] = (db, t[1], int(db in top_teams))
            rows = []
            for skey, node in _rounds(d2):
                rnd = str(skey).split("_")[-1]
                for g in _walk(node, lid2):
                    ko = shown_kickoff(g[3])
                    hs, as_ = _score(g[6])
                    rows.append({
                        "mid": g[0], "code": code, "lid": lid2, "comp_name": name2, "season": season, "S": _short(season),
                        "rnd": f"{rnd}R" if rnd.isdigit() else rnd,
                        "kickoff": ko.strftime("%Y-%m-%d %H:%M") if ko else None,
                        "state": g[2] if isinstance(g[2], int) else None,
                        "home_id": g[4], "away_id": g[5],
                        "home_name": teams.get(g[4], ("", "", 0))[0], "away_name": teams.get(g[5], ("", "", 0))[0],
                        "hs": hs, "as_": as_, "ht_score": g[7] or None,
                    })
            now = _now()
            con.executemany(
                f"INSERT INTO lower_matches ({', '.join(_COLS)}, updated_dt) VALUES ({', '.join('?' for _ in _COLS)}, ?) "
                "ON CONFLICT(mid) DO UPDATE SET " + ", ".join(f"{c} = excluded.{c}" for c in _COLS if c != "mid")
                + ", updated_dt = excluded.updated_dt",
                [tuple(r[c] for c in _COLS) + (now,) for r in rows])
            con.executemany(
                "INSERT INTO lower_teams (team_id, code, season, db_name, sm_name, in_top, updated_dt) VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(team_id, code, season) DO UPDATE SET db_name = excluded.db_name, sm_name = excluded.sm_name, "
                "in_top = excluded.in_top, updated_dt = excluded.updated_dt",
                [(tid, code, season, db, sm, top, now) for tid, (db, sm, top) in teams.items()])
            con.commit()
            done = sum(1 for r in rows if r["hs"] is not None and r["state"] == -1)
            res["seasons"] += 1
            res["matches"] += len(rows)
            res["done"] += done
            log(f"{name2} {season} — 경기 {len(rows)} (끝난 {done}) · 팀 {len(teams)} (1부 경험 {sum(v[2] for v in teams.values())})")
    finally:
        con.close()
    return res


def pair_matches(home: str, away: str) -> list:
    """두 팀(우리 DB 팀명)의 2부 맞대결 — 끝난 경기만, 최신순. 파일이 없으면 빈 목록."""
    if not os.path.exists(db_path()):
        return []
    a, b = str(home).strip(), str(away).strip()
    con = sqlite3.connect(db_path(), timeout=10)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT code, comp_name, S, rnd, kickoff, home_name, away_name, hs, as_ FROM lower_matches "
            "WHERE state = -1 AND hs IS NOT NULL AND ((home_name = ? AND away_name = ?) OR (home_name = ? AND away_name = ?)) "
            "ORDER BY kickoff DESC", (a, b, b, a)).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        con.close()
    return [dict(r) for r in rows]


def _rnd_no(v) -> int:
    m = re.search(r"\d+", str(v or ""))
    return int(m.group()) if m else 0
