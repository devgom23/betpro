"""
6대리그 팀의 리그 외 경기(유럽대항전·자국 컵·슈퍼컵) — 일정·결과와 배당을 쌓는다
(2026-09-16 사용자 지정). 상세보기에서 "그 팀이 직전 10일 안에/다음에 뛰는 리그 외 경기"를
보여주려는 재료다. 친선경기는 뺀다.

[자료 출처 — 스코어맨 컵대회 일정 파일]
  jsData/matchResult/json/{시즌}/c{대회번호}_kr.json   (리그는 s{번호}, 컵은 c{번호})
  대회 목록·시즌 목록은 jsData/infoHeaderKr.js(스코어맨 전체 대회 목록)에서 읽는다.
  ScheduleList는 단계별로 나뉘고, 리그 페이즈·조별리그는 경기 배열이 바로 들어 있지만
  토너먼트는 [팀A, 팀B, 합계A, 합계B, [1차전, 2차전]] 꼴로 한 겹 더 싸여 있다.
  경기 배열: [경기번호, 대회번호, 상태, 시각, 홈팀번호, 원정팀번호, 최종스코어, 전반스코어, …,
             19번째=연장·승부차기 원문]
  상태: -1 = 끝남, 0 = 경기 전, 그 밖 = 진행 중·연기 등.

[팀 연결 — 이름이 아니라 스코어맨 팀번호로]
  스코어맨은 대회가 달라도 팀번호가 같다(아스널=19 등, 2026-09-16 6대리그 전부 확인).
  6대리그 시즌 일정 파일(s{번호})의 팀번호 → 이미 쓰는 팀명 치환 규칙(crawler 별칭) → 우리
  DB 팀명으로 연결표(sm_teams)를 만든다. 컵 쪽 팀명 치환 규칙은 따로 필요 없다.

[시각] 스코어맨 원본 시각은 화면보다 1시간 이르다 — 1시간 더해 저장한다
  (main.py _scoreman_kickoff와 같은 규칙, 우리 DB의 DT·TM과 같은 기준이 된다).

[저장 — master.db가 아닌 별도 파일 두 개]
  cup_matches.db — cup_matches(경기) · sm_teams(팀번호→DB 팀명)
  cup_odds.db    — cup_mb_odds(스코어맨 12개사, 경기×배당사) · cup_kr_odds(와이즈토토 국내배당)
                   · cup_odds_fetch(경기별 마지막 수집 상태 — 끝나지 않은 경기는 다시 받는다)
"""
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta

import betpro_paths as PATHS
import crawler as CRAWL
import kr_crawler as KC
import scoreman_odds as SM
from multibook_odds import VAL_COLS

# (스코어맨 대회번호, 키, 이름) — 1군 공식 대회만(친선 제외). 쿠프 드 라 리그(55)는
# 2020년에 없어져 최신 시즌엔 안 걸리지만 과거 백필용으로 둔다.
COMPS = [
    (103, "UCL", "챔피언스리그"),
    (113, "UEL", "유로파리그"),
    (2187, "UECL", "컨퍼런스리그"),
    (109, "USC", "UEFA 슈퍼컵"),
    (304, "CWC", "클럽월드컵"),
    (90, "FAC", "FA컵"),
    (84, "EFLC", "리그컵"),
    (385, "CSH", "커뮤니티실드"),
    (81, "CDR", "코파 델 레이"),
    (704, "SSC", "수페르코파(스페인)"),
    (83, "CIT", "코파 이탈리아"),
    (264, "ISC", "수페르코파(이탈리아)"),
    (51, "DFB", "DFB 포칼"),
    (842, "DSC", "슈퍼컵(독일)"),
    (54, "CDF", "쿠프 드 프랑스"),
    (55, "CDL", "쿠프 드 라 리그"),
    (698, "TDC", "트로페 데 샹피옹"),
    (59, "KNVB", "KNVB컵"),
    (58, "JCS", "요한 크루이프 실드"),
]

LEAGUE_IDS = CRAWL.DEFAULT_LEAGUE_IDS          # 6대리그 코드 → 스코어맨 리그번호
# 리그 일정도 같은 표(cup_matches)에 넣는다(2026-09-16) — 상세보기의 '직전·다음 경기'는
# 리그·컵을 가리지 않고 시간순으로 바로 앞·뒤 경기를 보여주기 때문이다. 다음 리그 경기는
# 아직 우리 DB에 등록 안 된 라운드일 수 있어 스코어맨 리그 일정에서 가져온다.
LEAGUE_LABEL = {"EPL": "EPL", "LALIGA": "라리가", "SERIEA": "세리에A",
                "BUNDES": "분데스", "EREDIVISIE": "에레디비지", "LIGUE1": "리그1"}
# 컵·유럽대항전 짧은 이름(상세보기 표시용)
COMP_SHORT = {"UCL": "챔스", "UEL": "유로파", "UECL": "컨퍼런스", "USC": "UEFA슈퍼컵",
              "CWC": "클럽월드컵", "FAC": "FA컵", "EFLC": "리그컵", "CSH": "커뮤니티실드",
              "CDR": "국왕컵", "SSC": "수페르코파", "CIT": "코파이탈리아", "ISC": "수페르코파",
              "DFB": "포칼", "DSC": "독일슈퍼컵", "CDF": "프랑스컵", "CDL": "프랑스리그컵",
              "TDC": "트로페", "KNVB": "KNVB컵", "JCS": "크루이프실드"}
_STAGE_KO = {"League Round": "리그 페이즈", "Qualification": "예선", "Qualifi 1": "예선1",
             "Qualifi2": "예선2", "Qual.3": "예선3", "Knockouts": "녹아웃 PO", "Match": "",
             "Round 4": "4라운드"}
ADMIN = "admin"
GAP = 1.2                                      # 스코어맨 요청 간격(초) — backfill_multibook.py와 같다


def schedule_db() -> str:
    return os.path.join(PATHS.get_master_dir(), "cup_matches.db")


def odds_db() -> str:
    return os.path.join(PATHS.get_master_dir(), "cup_odds.db")


_SCHEMA_MATCHES = """
CREATE TABLE IF NOT EXISTS cup_matches (
    mid INTEGER PRIMARY KEY, lid INTEGER, comp TEXT, comp_name TEXT, season TEXT,
    stage TEXT, grp TEXT, kickoff TEXT, state INTEGER,
    home_id INTEGER, away_id INTEGER, home_name TEXT, away_name TEXT,
    hs INTEGER, as_ INTEGER, ht_score TEXT, extra TEXT, updated_dt TEXT
);
CREATE INDEX IF NOT EXISTS ix_cup_home ON cup_matches(home_id, kickoff);
CREATE INDEX IF NOT EXISTS ix_cup_away ON cup_matches(away_id, kickoff);
CREATE TABLE IF NOT EXISTS sm_teams (
    team_id INTEGER, code TEXT, season TEXT, db_name TEXT, sm_name TEXT, updated_dt TEXT,
    PRIMARY KEY (team_id, code, season)
);
"""

_SCHEMA_ODDS = f"""
CREATE TABLE IF NOT EXISTS cup_mb_odds (
    mid INTEGER, book TEXT, cid INTEGER, {", ".join(f"{c} REAL" for c in VAL_COLS)}, updated_dt TEXT,
    PRIMARY KEY (mid, book)
);
CREATE TABLE IF NOT EXISTS cup_kr_odds (
    mid INTEGER PRIMARY KEY, wt_league TEXT, wt_ht TEXT, wt_at TEXT,
    KW REAL, KD REAL, KL REAL, KHW REAL, KHD REAL, KHL REAL,
    EKW REAL, EKD REAL, EKL REAL, EKHW REAL, EKHD REAL, EKHL REAL,
    extra_json TEXT, updated_dt TEXT
);
CREATE TABLE IF NOT EXISTS cup_odds_fetch (
    mid INTEGER PRIMARY KEY, state_at_fetch INTEGER, fetched_dt TEXT
);
"""

_KR_COLS = ["KW", "KD", "KL", "KHW", "KHD", "KHL", "EKW", "EKD", "EKL", "EKHW", "EKHD", "EKHL"]


def _connect(path: str, schema: str) -> sqlite3.Connection:
    con = sqlite3.connect(path, timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(schema)
    return con


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ─────────────────────────── 스코어맨 읽기 ───────────────────────────
def comp_seasons() -> dict:
    """스코어맨 전체 대회 목록에서 {대회번호: [시즌 표기, …]}."""
    r = SM._sess().get(f"{SM.BASE_LEAGUE}/jsData/infoHeaderKr.js", timeout=20)
    text = r.content.decode("utf-8-sig", errors="replace")
    out = {}
    for body in re.findall(r"arr\[\d+\] = (\[.*?\]);\s*$", text, flags=re.M):
        try:
            a = json.loads(body)
        except ValueError:
            continue
        for c in (a[4] if len(a) > 4 and isinstance(a[4], list) else []):
            p = str(c).split(",")
            if p and p[0].isdigit():
                out[int(p[0])] = [x for x in p[4:] if x]
    return out


def shown_kickoff(raw: str):
    """스코어맨 원본 시각 → 화면 시각(1시간 더함). 못 읽으면 None."""
    try:
        return (datetime.strptime(str(raw).strip()[:16], "%Y-%m-%d %H:%M") + timedelta(hours=1))
    except ValueError:
        return None


def _is_match(node, lid) -> bool:
    return (isinstance(node, list) and len(node) >= 8 and isinstance(node[0], int)
            and node[1] == lid and isinstance(node[3], str))


def _walk(node, lid):
    if _is_match(node, lid):
        yield node
    elif isinstance(node, list):
        for x in node:
            yield from _walk(x, lid)
    elif isinstance(node, dict):
        for x in node.values():
            yield from _walk(x, lid)


def _score(s):
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(s or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def fetch_comp_season(lid: int, key: str, name: str, season: str, errors: list | None = None) -> list:
    """대회 하나 × 시즌 하나의 경기 목록(저장용 dict). 못 받으면 빈 목록 — errors를 주면
    거기에 대회 이름을 적어 둔다(수집 결과에 '받기 실패'로 알리려고)."""
    try:
        d = SM._get_json(f"{SM.BASE_LEAGUE}/jsData/matchResult/json/{season}/c{lid}_kr.json",
                         f"{SM.BASE_LEAGUE}/league/{lid}")
    except SM.OddsError:
        if errors is not None:
            errors.append(name)
        return []
    teams = {t[0]: t[1] for t in (d.get("TeamList") or []) if isinstance(t, list) and t}
    kinds = {str(k[0]): k[2] for k in (d.get("CupKindList") or []) if isinstance(k, list) and len(k) > 2}
    out = []
    for skey, node in (d.get("ScheduleList") or {}).items():
        m = re.match(r"^G(\d+)([A-Za-z]*)$", str(skey))
        stage = kinds.get(m.group(1), "") if m else ""
        grp = m.group(2) if m else ""
        for g in _walk(node, lid):
            ko = shown_kickoff(g[3])
            hs, as_ = _score(g[6])
            out.append({
                "mid": g[0], "lid": lid, "comp": key, "comp_name": name, "season": season,
                "stage": stage, "grp": grp,
                "kickoff": ko.strftime("%Y-%m-%d %H:%M") if ko else None,
                "state": g[2] if isinstance(g[2], int) else None,
                "home_id": g[4], "away_id": g[5],
                "home_name": teams.get(g[4], ""), "away_name": teams.get(g[5], ""),
                "hs": hs, "as_": as_, "ht_score": g[7] or None,
                "extra": (g[19] if len(g) > 19 else "") or None,
            })
    return out


def fetch_league_season(code: str, season: str, errors: list | None = None) -> list:
    """6대리그 한 시즌 일정(스코어맨 s{번호}) — cup_matches와 같은 모양, comp=리그코드, stage='5R'."""
    lid = LEAGUE_IDS[code]
    try:
        d = SM._get_json(f"{SM.BASE_LEAGUE}/jsData/matchResult/json/{season}/s{lid}_kr.json",
                         f"{SM.BASE_LEAGUE}/league/{lid}")
    except SM.OddsError:
        if errors is not None:
            errors.append(LEAGUE_LABEL[code])
        return []
    teams = {t[0]: t[1] for t in (d.get("TeamInfo") or []) if isinstance(t, list) and len(t) > 1}
    # 세리에A·에레디비지는 한 겹 더 싸여 있다 — {"sub_2948": {"R_1": [...], ...}}
    # (나머지 리그는 {"R_1": [...]}). 싸여 있으면 안쪽 R_n을 꺼내 쓴다.
    rounds = []
    for skey, node in (d.get("ScheduleList") or {}).items():
        if isinstance(node, dict) and str(skey).startswith("sub_"):
            rounds.extend(node.items())
        else:
            rounds.append((skey, node))
    out = []
    for skey, node in rounds:
        rnd = str(skey).split("_")[-1]
        for g in _walk(node, lid):
            ko = shown_kickoff(g[3])
            hs, as_ = _score(g[6])
            out.append({
                "mid": g[0], "lid": lid, "comp": code, "comp_name": LEAGUE_LABEL[code], "season": season,
                "stage": f"{rnd}R" if rnd.isdigit() else rnd, "grp": "",
                "kickoff": ko.strftime("%Y-%m-%d %H:%M") if ko else None,
                "state": g[2] if isinstance(g[2], int) else None,
                "home_id": g[4], "away_id": g[5],
                "home_name": teams.get(g[4], ""), "away_name": teams.get(g[5], ""),
                "hs": hs, "as_": as_, "ht_score": g[7] or None, "extra": None,
            })
    return out


def build_team_map(season_db: str = "2026-2027", errors: list | None = None) -> dict:
    """{스코어맨 팀번호: (리그코드, DB 팀명, 스코어맨 팀명)} — 6대리그 그 시즌 일정 파일 기준.
    못 받은 리그는 errors에 적는다."""
    udb = PATHS.get_user_db(ADMIN)
    out = {}
    for code, lid in LEAGUE_IDS.items():
        try:
            d = SM._get_json(f"{SM.BASE_LEAGUE}/jsData/matchResult/json/{season_db}/s{lid}_kr.json",
                             f"{SM.BASE_LEAGUE}/league/{lid}")
        except SM.OddsError:
            if errors is not None:
                errors.append(LEAGUE_LABEL[code])
            continue
        aliases = CRAWL.list_aliases(udb, PATHS.SCOPE_MASTER, code)
        for t in d.get("TeamInfo") or []:
            if isinstance(t, list) and len(t) > 1:
                out[t[0]] = (code, aliases.get(t[1], t[1]), t[1])
        time.sleep(0.3)
    return out


# ─────────────────────────── 저장 ───────────────────────────
_MATCH_COLS = ["mid", "lid", "comp", "comp_name", "season", "stage", "grp", "kickoff", "state",
               "home_id", "away_id", "home_name", "away_name", "hs", "as_", "ht_score", "extra"]


def save_matches(rows: list) -> int:
    if not rows:
        return 0
    con = _connect(schedule_db(), _SCHEMA_MATCHES)
    try:
        now = _now()
        con.executemany(
            f"INSERT INTO cup_matches ({', '.join(_MATCH_COLS)}, updated_dt) "
            f"VALUES ({', '.join('?' for _ in _MATCH_COLS)}, ?) "
            f"ON CONFLICT(mid) DO UPDATE SET "
            + ", ".join(f"{c} = excluded.{c}" for c in _MATCH_COLS if c != "mid")
            + ", updated_dt = excluded.updated_dt",
            [tuple(r[c] for c in _MATCH_COLS) + (now,) for r in rows])
        con.commit()
    finally:
        con.close()
    return len(rows)


def save_team_map(team_map: dict, season_db: str) -> None:
    con = _connect(schedule_db(), _SCHEMA_MATCHES)
    try:
        now = _now()
        con.executemany(
            "INSERT INTO sm_teams (team_id, code, season, db_name, sm_name, updated_dt) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(team_id, code, season) DO UPDATE SET db_name = excluded.db_name, "
            "sm_name = excluded.sm_name, updated_dt = excluded.updated_dt",
            [(tid, code, season_db, db_name, sm_name, now) for tid, (code, db_name, sm_name) in team_map.items()])
        con.commit()
    finally:
        con.close()


def _odds_state(con) -> dict:
    return {mid: st for mid, st in con.execute("SELECT mid, state_at_fetch FROM cup_odds_fetch")}


def save_mb_odds(mid: int, state, books: list) -> None:
    con = _connect(odds_db(), _SCHEMA_ODDS)
    try:
        now = _now()
        if books:
            con.executemany(
                f"INSERT INTO cup_mb_odds (mid, book, cid, {', '.join(VAL_COLS)}, updated_dt) "
                f"VALUES (?, ?, ?, {', '.join('?' for _ in VAL_COLS)}, ?) "
                f"ON CONFLICT(mid, book) DO UPDATE SET cid = excluded.cid, "
                + ", ".join(f"{c} = COALESCE(excluded.{c}, {c})" for c in VAL_COLS)
                + ", updated_dt = excluded.updated_dt",
                [(mid, b["book"], b.get("cid"), *[b.get(c) for c in VAL_COLS], now) for b in books])
        con.execute(
            "INSERT INTO cup_odds_fetch (mid, state_at_fetch, fetched_dt) VALUES (?, ?, ?) "
            "ON CONFLICT(mid) DO UPDATE SET state_at_fetch = excluded.state_at_fetch, "
            "fetched_dt = excluded.fetched_dt", (mid, state, now))
        con.commit()
    finally:
        con.close()


def save_kr_odds(items: list) -> int:
    """items: [(mid, 와이즈토토 리그명, 와이즈토토 홈, 와이즈토토 원정, kr_crawler._to_row 결과)]"""
    if not items:
        return 0
    con = _connect(odds_db(), _SCHEMA_ODDS)
    try:
        now = _now()
        con.executemany(
            f"INSERT INTO cup_kr_odds (mid, wt_league, wt_ht, wt_at, {', '.join(_KR_COLS)}, extra_json, updated_dt) "
            f"VALUES (?, ?, ?, ?, {', '.join('?' for _ in _KR_COLS)}, ?, ?) "
            f"ON CONFLICT(mid) DO UPDATE SET wt_league = excluded.wt_league, wt_ht = excluded.wt_ht, "
            f"wt_at = excluded.wt_at, "
            + ", ".join(f"{c} = COALESCE(excluded.{c}, {c})" for c in _KR_COLS)
            + ", extra_json = COALESCE(excluded.extra_json, extra_json), updated_dt = excluded.updated_dt",
            [(mid, lg, ht, at, *[_num(row.get(c)) for c in _KR_COLS],
              json.dumps(row.get("_extra") or [], ensure_ascii=False) if row.get("_extra") else None, now)
             for mid, lg, ht, at, row in items])
        con.commit()
    finally:
        con.close()
    return len(items)


# ─────────────────────────── 조회(상세보기용) ───────────────────────────
def team_ids_for(db_name: str, code: str) -> list:
    """우리 DB 팀명 → 스코어맨 팀번호(시즌마다 따로 저장돼도 번호는 같다)."""
    path = schedule_db()
    if not os.path.exists(path):
        return []
    con = sqlite3.connect(path)
    try:
        return [r[0] for r in con.execute(
            "SELECT DISTINCT team_id FROM sm_teams WHERE db_name = ? AND code = ?", (db_name, code))]
    finally:
        con.close()


def matches_around(team_ids: list, center: datetime, days: int = 10) -> list:
    """그 팀이 center 기준 앞뒤 days일 안에 뛴(뛸) 리그 외 경기 — 시각 순."""
    path = schedule_db()
    if not team_ids or not os.path.exists(path):
        return []
    lo = (center - timedelta(days=days)).strftime("%Y-%m-%d %H:%M")
    hi = (center + timedelta(days=days)).strftime("%Y-%m-%d %H:%M")
    ph = ",".join("?" for _ in team_ids)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            f"SELECT * FROM cup_matches WHERE (home_id IN ({ph}) OR away_id IN ({ph})) "
            f"AND kickoff BETWEEN ? AND ? ORDER BY kickoff",
            (*team_ids, *team_ids, lo, hi)).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def _extra_outcome(extra: str):
    """연장·승부차기 원문 → (연장 스코어 (홈,원정)|None, 승부차기 스코어 문자열|None, 승자 1/2|None).

    원문 예: ';|;|;|90,1-1;4-4;1,2-2;4-1;1'  (2026-09-16 실측으로 읽은 칸 뜻)
      90,1-1  정규시간 스코어 / 4-4 두 경기 합계(단판이면 빈칸) / 1,2-2 연장 끝 스코어
      4-1     승부차기 / 마지막 1·2 = 이 대결에서 올라간 쪽(1=홈, 2=원정)
    """
    if not extra:
        return None, None, None
    tail = str(extra).split("|")[-1]
    parts = tail.split(";")
    if len(parts) < 5 or not parts[0].startswith("90,"):
        return None, None, None
    et = None
    m = re.match(r"^1,(\d+)-(\d+)$", parts[2].strip())
    if m:
        et = (int(m.group(1)), int(m.group(2)))
    pens = parts[3].strip() or None
    winner = int(parts[4]) if parts[4].strip() in ("1", "2") else None
    return et, pens, winner


def _connect_ro(path: str):
    if not os.path.exists(path):
        return None
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def _standings_before(con, code: str, season: str, rnd: int, names: dict) -> dict:
    """리그 한 시즌에서 rnd 라운드보다 앞 라운드(끝난 경기)로 매긴 {팀번호: (순위, 승점)}.

    앱의 리그 화면 순위(HP/AP, standings._attach_one_season)와 같은 숫자가 나오도록
    ① 날짜가 아니라 라운드 순서로 자르고(연기된 경기도 원래 라운드에 넣는다)
    ② 동률 마지막 기준인 팀 이름도 우리 DB 이름으로 쓴다.
    (2026-09-16 실측: 킥오프 시각 기준으로 자르고 팀번호로 정렬했을 때는 26-27 191경기 중
    124경기가 앱 순위와 달랐다 — 초반 라운드 동률 팀이 많아서.)"""
    import standings as ST
    table = ST._Table()
    teams = set()
    rows = con.execute(
        "SELECT stage, home_id, away_id, hs, as_, state FROM cup_matches WHERE comp = ? AND season = ?",
        (code, season)).fetchall()
    key = {}
    for r in rows:
        for t in (r["home_id"], r["away_id"]):
            key[t] = names.get(t) or f"~{t}"
        teams.update(key[t] for t in (r["home_id"], r["away_id"]))
    done = [r for r in rows if r["state"] == -1 and r["hs"] is not None
            and (_round_no(r["stage"]) or 0) < rnd]
    for r in sorted(done, key=lambda x: _round_no(x["stage"]) or 0):
        table.add(key[r["home_id"]], key[r["away_id"]], r["hs"], r["as_"])
    if table.counted == 0:
        return {}
    ranks = ST._ranks(table, sorted(teams))
    return {t: (ranks.get(k), table.pts.get(k, 0)) for t, k in key.items()}


def _round_no(stage) -> int | None:
    m = re.match(r"^(\d+)R$", str(stage or ""))
    return int(m.group(1)) if m else None


def _describe(con, m: dict, my_ids: set, center: datetime, names: dict) -> dict:
    """경기 하나 → 상세보기 표 한 줄(그 팀 기준)."""
    ko = datetime.strptime(m["kickoff"], "%Y-%m-%d %H:%M")
    is_home = m["home_id"] in my_ids
    opp_id = m["away_id"] if is_home else m["home_id"]
    opp_name = names.get(opp_id) or (m["away_name"] if is_home else m["home_name"])
    is_league = m["comp"] in LEAGUE_LABEL
    if is_league:
        comp = comp_short = f"{LEAGUE_LABEL[m['comp']]} {m['stage']}"
        rnd = _round_no(m["stage"])
        rank_pts = (_standings_before(con, m["comp"], m["season"], rnd, names).get(opp_id)
                    if rnd else None)
        if rank_pts and rank_pts[0]:
            opp_name = f"{opp_name}({rank_pts[0]}위/{rank_pts[1]}점)"
    else:
        stage = _STAGE_KO.get(m["stage"], m["stage"] or "")
        comp_short = COMP_SHORT.get(m["comp"], m["comp_name"])
        comp = " ".join(x for x in (comp_short, stage) if x)

    score, result, note = None, None, ""
    if m["state"] == -1 and m["hs"] is not None:
        h, a = m["hs"], m["as_"]
        et, pens, winner = _extra_outcome(m["extra"])
        if et and et != (h, a):
            h, a = et
            note = "연장"
        mine, theirs = (h, a) if is_home else (a, h)
        score = f"{mine}-{theirs}"
        if pens:
            ph, pa = (pens.split("-") + ["", ""])[:2]
            p_mine, p_theirs = (ph, pa) if is_home else (pa, ph)
            note = f"승부차기 {p_mine}-{p_theirs}"
        if mine != theirs:
            result = "승" if mine > theirs else "패"
        elif pens and winner in (1, 2):
            result = "승" if (winner == 1) == is_home else "패"
        else:
            result = "무"
    days = (ko.date() - center.date()).days
    return {
        "kickoff": m["kickoff"], "days": days, "is_league": is_league,
        "comp": comp, "comp_short": comp_short,
        "venue": "홈" if is_home else "원정", "opponent": opp_name,
        "score": score, "result": result, "note": note,
        "finished": m["state"] == -1, "state": m["state"],
    }


def team_prev_next(code: str, db_name: str, center: datetime, max_days: int = 30) -> dict:
    """그 팀의 이 경기 바로 앞·뒤 경기(리그·컵 구분 없이 1경기씩, 앞뒤 max_days일 안).
    이 경기 자체(같은 시각 ±12시간)는 뺀다."""
    con = _connect_ro(schedule_db())
    if con is None:
        return {"prev": None, "next": None}
    try:
        ids = {r[0] for r in con.execute(
            "SELECT DISTINCT team_id FROM sm_teams WHERE db_name = ? AND code = ?", (db_name, code))}
        if not ids:
            return {"prev": None, "next": None}
        names = {r[0]: r[1] for r in con.execute("SELECT team_id, db_name FROM sm_teams")}
        ph = ",".join("?" for _ in ids)
        lo = (center - timedelta(days=max_days)).strftime("%Y-%m-%d %H:%M")
        hi = (center + timedelta(days=max_days)).strftime("%Y-%m-%d %H:%M")
        rows = [dict(r) for r in con.execute(
            f"SELECT * FROM cup_matches WHERE (home_id IN ({ph}) OR away_id IN ({ph})) "
            f"AND kickoff BETWEEN ? AND ? ORDER BY kickoff", (*ids, *ids, lo, hi))]
        prev = nxt = None
        for m in rows:
            ko = datetime.strptime(m["kickoff"], "%Y-%m-%d %H:%M")
            gap_h = (ko - center).total_seconds() / 3600
            if abs(gap_h) < 12:
                continue
            if gap_h < 0:
                prev = m
            elif nxt is None:
                nxt = m
        return {
            "prev": _describe(con, prev, ids, center, names) if prev else None,
            "next": _describe(con, nxt, ids, center, names) if nxt else None,
        }
    finally:
        con.close()


# ─────────────────────────── 수집(한 시즌) ───────────────────────────
def _season_window(season: str):
    """'26-27' → (2026-07-01, 2027-06-30, 스코어맨 리그 시즌 '2026-2027', 받을 컵 시즌 후보)."""
    m = re.match(r"^(\d{2})-(\d{2})$", season.strip())
    if not m:
        raise ValueError(f"시즌 표기를 모르겠습니다: {season} (예: 26-27)")
    y1, y2 = 2000 + int(m.group(1)), 2000 + int(m.group(2))
    return (datetime(y1, 7, 1), datetime(y2, 6, 30, 23, 59), f"{y1}-{y2}",
            {f"{y1}-{y2}", str(y1), str(y2), f"{y1 - 1}-{y1}"})


def collect_season(season: str, with_odds: bool = True, log=print) -> dict:
    start, end, league_season, cand = _season_window(season)
    now = datetime.now()

    # ① 팀 연결표 — 6대리그 중 하나라도 못 받으면 그 리그 팀 경기가 통째로 빠지므로 멈춘다.
    #    (스코어맨이 잠깐 연결을 끊는 때가 있다 — 2026-09-17 실측, 몇 분 뒤 다시 된다.)
    map_errors = []
    team_map = build_team_map(league_season, map_errors)
    if map_errors:
        raise RuntimeError(f"스코어맨이 {', '.join(map_errors)} 일정 연결을 거부했습니다. "
                           "잠시 뒤 다시 눌러 주세요.")
    save_team_map(team_map, league_season)
    log(f"팀 연결표: 6대리그 {len(team_map)}팀")

    failed = []
    # ①-2 6대리그 일정(직전·다음 경기 찾기용)
    n_league = 0
    for code in LEAGUE_IDS:
        rows = fetch_league_season(code, league_season, failed)
        save_matches(rows)
        n_league += len(rows)
        time.sleep(0.5)
    log(f"6대리그 일정 {n_league}경기")

    # ② 일정
    seasons_of = comp_seasons()
    all_rows = []
    for lid, key, name in COMPS:
        got = 0
        for s in seasons_of.get(lid, []):
            if s not in cand:
                continue
            rows = [r for r in fetch_comp_season(lid, key, name, s, failed)
                    if r["kickoff"] and start.strftime("%Y-%m-%d") <= r["kickoff"][:10] <= end.strftime("%Y-%m-%d")]
            got += len(rows)
            all_rows += rows
            time.sleep(0.5)
        log(f"  {name}: {got}경기")
    # 같은 경기가 두 시즌 파일에 겹쳐 있을 수 있다 — 경기번호로 하나만 남긴다
    uniq = {r["mid"]: r for r in all_rows}
    save_matches(list(uniq.values()))
    ours = [r for r in uniq.values() if r["home_id"] in team_map or r["away_id"] in team_map]
    log(f"일정 저장 {len(uniq)}경기 (그중 6대리그 팀 경기 {len(ours)})")

    if failed:
        log(f"받기 실패: {', '.join(failed)} — 다음 수집 때 다시 받는다")
    result = {"matches": len(uniq), "ours": len(ours), "mb_odds": 0, "kr_odds": 0, "failed": failed}
    if not with_odds:
        return result

    # ③ 스코어맨 12개사 배당 — 6대리그 팀 경기 중 이미 시작했거나 7일 안에 열리는 경기만.
    #    끝난 경기를 이미 받았으면 건너뛰고, 끝나기 전에 받았던 경기는 다시 받는다(마감 배당 갱신).
    con = _connect(odds_db(), _SCHEMA_ODDS)
    try:
        fetched = _odds_state(con)
    finally:
        con.close()
    horizon = (now + timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
    todo = [r for r in ours if r["kickoff"] <= horizon and fetched.get(r["mid"]) != -1]
    log(f"12개사 배당 받을 경기 {len(todo)}")
    for i, r in enumerate(sorted(todo, key=lambda x: x["kickoff"]), 1):
        try:
            books = SM.match_books(r["mid"])
        except SM.OddsError as e:
            log(f"  배당 실패 {r['mid']} {r['home_name']}-{r['away_name']}: {e}")
            time.sleep(5)
            continue
        save_mb_odds(r["mid"], r["state"], books)
        result["mb_odds"] += 1
        if i % 25 == 0 or i == len(todo):
            log(f"  12개사 {i}/{len(todo)}")
        time.sleep(GAP)

    # ④ 와이즈토토 국내배당 — 그 기간 회차를 전부 읽어, 6대리그 리그전이 아닌 줄을
    #    날짜(±1일)·팀(DB 팀명)으로 스코어맨 경기에 붙인다.
    result["kr_odds"] = _collect_kr(ours, team_map, start, min(end, now + timedelta(days=7)), log)
    return result


def _collect_kr(ours: list, team_map: dict, d0: datetime, d1: datetime, log) -> int:
    udb = PATHS.get_user_db(ADMIN)
    # 와이즈토토 팀명 → DB 팀명: 6대리그 국배 치환 규칙을 전부 합친다(컵에선 리그가 섞인다).
    wt2db = {}
    league_names = {"EPL", "라리가", "분데스리", "세리에A", "에레디비", "프리그1"}
    for code in LEAGUE_IDS:
        wt2db.update(CRAWL.list_aliases(udb, PATHS.SCOPE_MASTER, code, source="kr"))
        saved = CRAWL.get_league_name(udb, PATHS.SCOPE_MASTER, code)
        if saved:
            league_names.add(saved)
    db_names = {v[1] for v in team_map.values()}

    def to_db(name):
        n = str(name or "").strip()
        n = wt2db.get(n, n)
        return n if n in db_names else None

    # (날짜, DB 팀명) → 스코어맨 경기. 한 팀은 하루에 한 경기뿐이라 겹치지 않는다.
    by_day_team = {}
    for r in ours:
        day = datetime.strptime(r["kickoff"][:10], "%Y-%m-%d")
        for tid in (r["home_id"], r["away_id"]):
            if tid in team_map:
                by_day_team[(day, team_map[tid][1])] = r

    rounds = []
    for y in sorted({d0.year, d1.year}):
        lo = d0 if d0.year == y else datetime(y, 1, 1)
        hi = d1 if d1.year == y else datetime(y, 12, 31)
        rounds += [(y, rnd) for rnd in KC.find_rounds_for_dates(y, lo, hi)]
    log(f"와이즈토토 회차 {len(rounds)}개 확인")

    items = {}
    for y, rnd in rounds:
        html = KC.fetch_round_html(y, rnd)
        if not html:
            continue
        for rec in KC._parse_round(html, "").values():
            if rec["league"] in league_names:
                continue
            ht_db, at_db = to_db(rec["HT"]), to_db(rec["AT"])
            if not ht_db and not at_db:
                continue
            try:
                day = datetime.strptime(str(rec["date"])[:10], "%Y-%m-%d")
            except ValueError:
                continue
            hit = None
            for dd in (0, -1, 1):
                for name in (ht_db, at_db):
                    if name and (day + timedelta(days=dd), name) in by_day_team:
                        hit = by_day_team[(day + timedelta(days=dd), name)]
                        break
                if hit:
                    break
            if not hit:
                continue
            # 홈·원정이 뒤바뀌어 붙지 않게 — 알아본 쪽이 스코어맨 경기의 같은 자리여야 한다.
            sm_home = team_map.get(hit["home_id"], (None, None))[1]
            sm_away = team_map.get(hit["away_id"], (None, None))[1]
            if (ht_db and ht_db != sm_home) or (at_db and at_db != sm_away):
                continue
            items[hit["mid"]] = (hit["mid"], rec["league"], rec["HT"], rec["AT"], KC._to_row(rec))
        time.sleep(0.3)
    n = save_kr_odds(list(items.values()))
    log(f"와이즈토토 국내배당 {n}경기 연결")
    return n
