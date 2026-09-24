"""배당사별 '정배 표본' 방향성 — 12개 배당사가 각자 매긴 배당으로 과거 결과를 따로 센다
(2026-09-24 사용자 지정).

[왜 따로 세나]
  지금 시스템의 표본은 우리 DB에 든 배당(국내배당 + 해외배당=Bet365)으로 과거 경기를 찾는다.
  그런데 같은 경기를 피나클은 초기 2.07로, Bet365는 1.75로 볼 수 있다(에스파뇰 vs 엘체 실측). "피나클이 2.07을 매겼던 과거 경기들이 어떻게 끝났나"는 Bet365 1.75 표본과 다를
  수 있어서, 배당사마다 자기 배당으로 표본을 따로 세고 방향을 낸다.

[표본 — main 화면의 '정배 표본'과 같은 방식, 배당만 그 회사 것]
  그 회사의 정배배당(승·패 중 낮은 쪽, 소수 둘째 자리)이 같은 값인 과거 경기를
    · 이 경기 방향 줄 = 정배가 같은 자리(홈/원정)였던 경기
    · 반대 방향 줄   = 같은 값이 반대 자리에서 나온 경기
  로 나눠 결과(RT: 핸승/핸무/무/역 — 우리 DB 결과, 국내 핸디 기준)를 센다.
  초기(F)·마감(L) 배당으로 각각 한 번씩. 판정식은 sample_dir.judge 그대로
  (두 줄 평균 t · 중심보정 — 표본 방향성과 같은 기준).

[시점]
  경기를 날짜순으로 훑으며 '그 날짜 이전' 결과만 센다(같은 날짜끼리는 서로 안 셈).
  결과 전 경기 — 새로 계산해 저장(src='live'). 결과가 들어오면 그 값으로 고정(locked=1).
  처음부터 결과가 있던 과거 경기 — src='asof'. 백필로 더 옛날 시즌이 들어오면 표본이 늘어나므로
  매번 다시 계산한다(그때 화면에 보여준 적 없는 재구성 값이라 고정할 이유가 없다).

[저장] multibook.db `mb_dir` — master.db가 아니라 12사 배당과 같은 파일(multibook_odds.py 주석:
  백필이 몇 시간 도는 파일이라 master.db 캐시를 흔들지 않게 분리해 둔 것).
⚠ 참고 표시다 — 판정에 넣지 않는다. 회사별 표본이 Bet365 표본보다 결과를 잘 가르는지는
  백필이 끝난 뒤 실측해야 한다.
"""
import os
import sqlite3
import threading
from collections import defaultdict
from datetime import datetime

import betpro_paths as PATHS
import data_access as DATA
import multibook_odds as MB
from kr_extra_odds import _key
from sample_dir import judge

TABLE = "mb_dir"
PHASES = ("F", "L")

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS "{TABLE}" (
    code TEXT NOT NULL, S TEXT NOT NULL, R TEXT NOT NULL, HT TEXT NOT NULL, AT TEXT NOT NULL,
    book TEXT NOT NULL, phase TEXT NOT NULL,
    odds REAL, pos TEXT, label TEXT, t REAL,
    s1 INTEGER, s2 INTEGER, s3 INTEGER, s4 INTEGER,
    m1 INTEGER, m2 INTEGER, m3 INTEGER, m4 INTEGER,
    src TEXT, locked INTEGER NOT NULL DEFAULT 0, updated_dt TEXT,
    PRIMARY KEY (code, S, R, HT, AT, book, phase)
)
"""


def _fav(w, l):
    """(정배배당, 자리 'H'/'A') — 둘 다 있고 다를 때만."""
    try:
        w, l = round(float(w), 2), round(float(l), 2)
    except (TypeError, ValueError):
        return None
    if not (w > 0 and l > 0) or w == l:
        return None
    return (w, "H") if w < l else (l, "A")


def _matches(db):
    """리그 경기 키 → (날짜 'YY-MM-DD', RT 또는 None)."""
    out = {}
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df(db, code)
        if df.empty:
            continue
        for r in df[["S", "R", "HT", "AT", "DT", "RT"]].to_dict("records"):
            d = str(r.get("DT") or "")[:8]
            if len(d) != 8:
                continue
            try:
                rt = int(float(r.get("RT")))
            except (TypeError, ValueError):
                rt = None
            out[_key(code, r["S"], r["R"], r["HT"], r["AT"])] = (d, rt if rt in (1, 2, 3, 4) else None)
    return out


def compute(db, mb_path):
    """({(key, book, phase): dict}, 경기표) — 배당사별로 날짜순 누적해 as-of 판정을 낸다."""
    if not os.path.exists(mb_path):
        return {}, {}
    games = _matches(db)
    con = sqlite3.connect(mb_path, timeout=30)
    try:
        rows = con.execute(
            "SELECT code, S, R, HT, AT, book, EU_F1, EU_F2, EU_L1, EU_L2 FROM mb_odds").fetchall()
    finally:
        con.close()
    by_book = defaultdict(list)
    for code, s, r, ht, at, book, f1, f2, l1, l2 in rows:
        k = (code, s, r, ht, at)
        g = games.get(k)
        if g is None:
            continue
        by_book[book].append((g[0], g[1], k, {"F": _fav(f1, f2), "L": _fav(l1, l2)}))

    out = {}
    for book, items in by_book.items():
        items.sort(key=lambda x: x[0])
        acc = {ph: defaultdict(lambda: [0, 0, 0, 0]) for ph in PHASES}
        i = 0
        while i < len(items):
            j = i
            while j < len(items) and items[j][0] == items[i][0]:
                j += 1
            day = items[i:j]
            for _d, _rt, k, favs in day:
                for ph in PHASES:
                    fv = favs[ph]
                    if fv is None:
                        continue
                    odds, pos = fv
                    other = "A" if pos == "H" else "H"
                    s_cnt = list(acc[ph][(pos, odds)])
                    m_cnt = list(acc[ph][(other, odds)])
                    label, t = judge(s_cnt, m_cnt)
                    out[(k, book, ph)] = {"odds": odds, "pos": pos, "label": label, "t": t,
                                          "self": s_cnt, "mirror": m_cnt}
            for _d, rt, _k, favs in day:
                if rt is None:
                    continue
                for ph in PHASES:
                    fv = favs[ph]
                    if fv is not None:
                        acc[ph][(fv[1], fv[0])][rt - 1] += 1
            i = j
    return out, games


def _connect(mb_path):
    con = sqlite3.connect(mb_path, timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(_SCHEMA)
    return con


def refresh(db=None, mb_path=None) -> dict:
    """결과 전 경기는 새 값, 결과 들어온 live 경기는 고정, 과거 as-of 경기는 다시 계산."""
    db = db or PATHS.get_master_db()
    mb_path = mb_path or MB.db_path_for(PATHS.SCOPE_MASTER)
    if not os.path.exists(mb_path):
        return {"rows": 0}
    res, games = compute(db, mb_path)
    con = _connect(mb_path)
    try:
        have = {(tuple(r[:5]), r[5], r[6]): (r[7], r[8])
                for r in con.execute(f'SELECT code, S, R, HT, AT, book, phase, src, locked FROM "{TABLE}"')}
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        write, lock = [], []
        for (k, book, ph), v in res.items():
            old = have.get((k, book, ph))
            finished = games[k][1] is not None
            if old and old[0] == "live" and old[1]:
                continue                                     # 결과 뒤 고정된 값
            if old and old[0] == "live" and finished:
                lock.append((*k, book, ph))                  # 결과 전 마지막 값 그대로 고정
                continue
            src = "asof" if finished else "live"
            write.append((*k, book, ph, v["odds"], v["pos"], v["label"],
                          None if v["t"] is None else round(v["t"], 4),
                          *v["self"], *v["mirror"], src, now))
        con.executemany(f"""
            INSERT OR REPLACE INTO "{TABLE}" (code, S, R, HT, AT, book, phase, odds, pos, label, t,
                s1, s2, s3, s4, m1, m2, m3, m4, src, locked, updated_dt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)""", write)
        con.executemany(f"""UPDATE "{TABLE}" SET locked = 1, updated_dt = '{now}'
            WHERE code=? AND S=? AND R=? AND HT=? AND AT=? AND book=? AND phase=?""", lock)
        con.commit()
    finally:
        con.close()
    return {"rows": len(write), "locked": len(lock)}


def get(code, row, mb_path=None) -> dict:
    """상세보기용 — {book: {'F': {...}, 'L': {...}}}."""
    mb_path = mb_path or MB.db_path_for(PATHS.SCOPE_MASTER)
    if not os.path.exists(mb_path):
        return {}
    k = _key(code, row.get("S"), row.get("R"), row.get("HT"), row.get("AT"))
    con = sqlite3.connect(mb_path, timeout=30)
    try:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone():
            return {}
        rows = con.execute(f"""SELECT book, phase, odds, pos, label, t, s1, s2, s3, s4, m1, m2, m3, m4, src, locked
            FROM "{TABLE}" WHERE code=? AND S=? AND R=? AND HT=? AND AT=?""", k).fetchall()
    finally:
        con.close()
    out = {}
    for b, ph, odds, pos, label, t, *rest in rows:
        out.setdefault(b, {})[ph] = {"odds": odds, "pos": pos, "label": label, "t": t,
                                     "self": rest[0:4], "mirror": rest[4:8],
                                     "src": rest[8], "locked": bool(rest[9])}
    return out


# ── 뒤에서 자동으로 — 리그 결과나 12사 배당(백필 포함)이 바뀌면 다시 돈다 ──────────
_LOCK = threading.Lock()
_STATE = {"running": False, "error": None, "token": None, "last": None}


def _token(db, mb_path):
    """다시 셀 때가 됐나 — 리그 결과가 바뀌었거나 12사 배당(mb_odds)이 늘거나 갱신됐을 때.
    ⚠ 파일 수정 시각을 쓰면 안 된다: 우리 계산 결과(mb_dir)도 같은 파일에 쓰므로, 저장 →
    시각 바뀜 → 또 계산이 끝없이 돈다(WAL이라 시각이 늦게 바뀌어 '저장 뒤 값 기억'도 빗나감,
    2026-09-24 실제로 상세보기가 20초 넘게 멈췄다). 그래서 mb_odds 표 내용만 본다."""
    try:
        con = sqlite3.connect(mb_path, timeout=30)
        try:
            mb = con.execute("SELECT COUNT(*), MAX(updated_dt) FROM mb_odds").fetchone()
        finally:
            con.close()
    except sqlite3.Error:
        mb = None
    return (DATA.tables_token(db, tuple(PATHS.LEAGUES)), mb)


def _run(db, mb_path, tok):
    try:
        _STATE["last"] = refresh(db, mb_path)
        _STATE["error"] = None
        _STATE["token"] = tok
    except Exception as e:   # noqa: BLE001 — 뒤에서 도는 작업이라 실패를 상태로 남긴다
        _STATE["error"] = f"{type(e).__name__}: {e}"
    finally:
        with _LOCK:
            _STATE["running"] = False


def ensure(db=None) -> None:
    db = db or PATHS.get_master_db()
    mb_path = MB.db_path_for(PATHS.SCOPE_MASTER)
    if not os.path.exists(mb_path):
        return
    # 12개사 배당을 내려받는 중이면 기다린다 — 경기 하나 저장할 때마다 다시 세면 낭비라서,
    # 대기열이 다 비었을 때(collect_jobs.queue_league_books) 한 번만 센다.
    try:
        import collect_jobs
        if collect_jobs._books["pending"] > 0:
            return
    except Exception:  # noqa: BLE001
        pass
    tok = _token(db, mb_path)
    with _LOCK:
        if _STATE["running"] or _STATE["token"] == tok:
            return
        _STATE["running"] = True
    threading.Thread(target=_run, args=(db, mb_path, tok), name="book-dir", daemon=True).start()


def status() -> dict:
    return {k: _STATE[k] for k in ("running", "error", "last")}
