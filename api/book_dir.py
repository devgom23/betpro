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
import time
from collections import defaultdict
from datetime import datetime

import betpro_paths as PATHS
import data_access as DATA
import multibook_odds as MB
from kr_extra_odds import _key
from sample_dir import judge

TABLE = "mb_dir"
PHASES = ("F", "L")
AVG_BOOK = "AVG12"      # 13번째 배당사 '12사 평균' — mb_dir에만 있다(mb_odds에는 없음)
AVG_MIN_BOOKS = 3

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


def _avg2(total, n):
    """평균을 소수 둘째 자리로 — 끝자리가 딱 5면 올린다(1.245 → 1.25). total은 배당×1000 정수의 합(Vcbet 2.875처럼 셋째 자리까지 쓰는 회사가 있다).
    소수로 더해 round()하면 컴퓨터 소수 오차로 1.2449999…가 되어 1.24로 내려가기도 해서, 같은 경기가
    계산할 때마다 1.24/1.25로 흔들렸다(2026-09-25 발견, 약 4%). 정수로 더하고 나누면 순서와 무관하게
    늘 같은 값이다. 화면의 12사 평균 숫자(MatchDetailModal mbMean)도 같은 규칙을 쓴다."""
    return ((2 * total + 10 * n) // (20 * n)) / 100


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
    sums = defaultdict(lambda: {ph: [0, 0, 0] for ph in PHASES})   # 12사 평균용 — 경기별 승·패 배당×1000 합과 회사 수
    for code, s, r, ht, at, book, f1, f2, l1, l2 in rows:
        k = (code, s, r, ht, at)
        g = games.get(k)
        if g is None:
            continue
        by_book[book].append((g[0], g[1], k, {"F": _fav(f1, f2), "L": _fav(l1, l2)}))
        for ph, w, l in (("F", f1, f2), ("L", l1, l2)):
            try:
                w, l = float(w), float(l)
            except (TypeError, ValueError):
                continue
            if w > 0 and l > 0:
                acc_ = sums[k][ph]
                acc_[0] += round(w * 1000)
                acc_[1] += round(l * 1000)
                acc_[2] += 1
    # 13번째 배당사 '12사 평균'(2026-09-25 사용자 지정) — 회사들의 승·패 배당 평균(소수 둘째 자리)을
    # 한 회사의 배당처럼 보고 똑같이 센다. 평균 정배가 1.32면 과거에 평균 정배가 1.32였던 경기를 찾는다.
    # 3곳 미만만 배당을 낸 경기는 평균이 한두 회사 값과 같아 뜻이 없어 뺀다.
    for k, d in sums.items():
        favs = {ph: (_fav(_avg2(d[ph][0], d[ph][2]), _avg2(d[ph][1], d[ph][2])) if d[ph][2] >= AVG_MIN_BOOKS else None)
                for ph in PHASES}
        if favs["F"] or favs["L"]:
            g = games[k]
            by_book[AVG_BOOK].append((g[0], g[1], k, favs))

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
        # 이번에 다시 쓰이지 않은 재구성 값(asof)은 더 이상 나오지 않는 값이다 — 예: 배당이 고쳐져 평균
        # 승·패가 같아지면 정배가 없어진다. 남겨 두면 옛 방향이 화면에 계속 뜬다(2026-09-25 발견).
        # 결과가 들어와 고정된 값(live·locked)은 건드리지 않는다.
        con.execute(f"""DELETE FROM "{TABLE}" WHERE src = 'asof' AND locked = 0 AND updated_dt < ?""", (now,))
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
_STATE = {"running": False, "error": None, "token": None, "last": None, "done_at": 0.0}
COOLDOWN = 600   # 초 — 백필이 계속 저장하는 동안 요청마다 다시 세지 않게(자료가 많으면 한 번에 수십 초)


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


BUSY_WINDOW = 600   # 초 — mb_odds 마지막 저장이 이보다 최근이면 '백필 중'으로 본다


def _writing_now(mb_path) -> bool:
    try:
        con = sqlite3.connect(mb_path, timeout=30)
        try:
            last = con.execute("SELECT MAX(updated_dt) FROM mb_odds").fetchone()[0]
        finally:
            con.close()
        return bool(last) and (datetime.now() - datetime.strptime(last, "%Y-%m-%d %H:%M:%S")).total_seconds() < BUSY_WINDOW
    except (sqlite3.Error, ValueError, TypeError):
        return False


def _disk_fresh(db, mb_path) -> bool:
    """mb_dir가 마지막 12사 배당 저장·리그 DB 변경보다 나중에 계산돼 있나."""
    try:
        con = sqlite3.connect(mb_path, timeout=30)
        try:
            if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone():
                return False
            odds_last = con.execute("SELECT MAX(updated_dt) FROM mb_odds").fetchone()[0]
            dir_last = con.execute(f'SELECT MAX(updated_dt) FROM "{TABLE}"').fetchone()[0]
        finally:
            con.close()
        if not dir_last or (odds_last and dir_last < odds_last):
            return False
        league_last = datetime.fromtimestamp(os.path.getmtime(db)).strftime("%Y-%m-%d %H:%M:%S")
        return dir_last >= league_last
    except (sqlite3.Error, OSError):
        return False


def _run(db, mb_path, tok):
    try:
        _STATE["last"] = refresh(db, mb_path)
        _STATE["error"] = None
        _STATE["token"] = tok
        _STATE["done_at"] = time.time()
    except Exception as e:   # noqa: BLE001 — 뒤에서 도는 작업이라 실패를 상태로 남긴다
        _STATE["error"] = f"{type(e).__name__}: {e}"
    finally:
        with _LOCK:
            _STATE["running"] = False


def ensure(db=None, force=False) -> None:
    """force=True — 수집이 방금 끝났을 때(collect_jobs)는 쿨다운 없이 바로 센다."""
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
    # 명령 프롬프트 백필(backfill_multibook.py)이 지금 저장 중이면 미룬다 — 따로 도는 프로세스라
    # 위 대기열로는 안 잡힌다. 한 번 세는 데 33만 줄을 파이썬으로 훑어 수 분 걸리고 그동안 서버의
    # 다른 요청이 전부 느려져, 백필 중 상세보기가 10~17초씩 걸렸다(2026-09-25 실측). 이미 저장된
    # 결과(mb_dir)로 화면은 그대로 나오고, 백필이 멈춘 뒤 첫 상세보기에서 한 번만 다시 센다.
    if not force and _writing_now(mb_path):
        return
    tok = _token(db, mb_path)
    with _LOCK:
        if _STATE["running"] or _STATE["token"] == tok:
            return
        # 서버를 켠 직후(token 없음) 파일의 결과가 이미 최신이면 다시 세지 않는다 — 서버가 재시작될
        # 때마다(코드 저장 --reload 포함) 수 분씩 서버를 붙잡던 문제(2026-09-25). 명령 프롬프트에서
        # refresh()를 따로 돌려 둔 결과도 이 덕분에 그대로 쓴다.
        if _STATE["token"] is None and not force and _disk_fresh(db, mb_path):
            _STATE["token"] = tok
            _STATE["done_at"] = time.time()
            return
        if not force and time.time() - _STATE["done_at"] < COOLDOWN:
            return
        _STATE["running"] = True
    threading.Thread(target=_run, args=(db, mb_path, tok), name="book-dir", daemon=True).start()


def status() -> dict:
    return {k: _STATE[k] for k in ("running", "error", "last")}
