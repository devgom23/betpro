"""표본 7섹션 '시스템 판정'(자동 방향성) 저장 — 2026-09-24 사용자 지정.

[왜 저장하나]
  예전엔 상세보기를 열 때마다 화면에서 계산하고 버렸다. 그러면 ① 방향성으로 경기를 검색할 수
  없고 ② 지난 경기를 나중에 열면 표본 아래 줄(반대 방향)이 '그 뒤에 치른 경기'까지 섞여 판정이
  슬쩍 바뀐다. 그래서 경기마다 시스템 판정을 DB에 남기고, 결과가 들어오면 고정한다.

[두 칸으로 나눠 저장]
  시스템 판정 — 이 파일, master.db `sample_dir` 테이블(공식 6대리그, 모든 계정 공통)
  내 판정     — my_picks.sample_notes.direction(계정별, 직접 고른 것만)
  화면·검색에 쓰는 값은 '내 판정이 있으면 그것, 없으면 시스템 판정'. 두 칸을 따로 둔 건
  나중에 "시스템이 맞았나, 내가 고친 게 맞았나"를 비교하려고(사용자: "내가 하면 사심이 들어가").

[언제 계산·고정하나]
  결과 없는 경기 — 리그 표가 바뀔 때마다(배당 등록·갱신 포함) 다시 계산한다. 화면의 표본 표와
                   똑같은 방식(위 줄=저장된 통합 지표, 아래 줄=지금 DB로 센 거울 경기)이라
                   화면 숫자와 판정이 어긋나지 않는다. (CLAUDE.md 4-1: 등록된 배당 전부로 매번)
  결과 들어온 경기 — 마지막으로 계산해 둔 값 그대로 locked=1. 이후 안 바뀐다.
  처음 채울 때 이미 결과가 있던 경기(과거 3.6만 건) — '그 경기 날짜 이전 경기만'으로 센 값
                   (src='asof', 2026-09-24 전수 실측과 같은 방식)으로 채우고 바로 고정.

[판정식] web/src/utils/sampleDirection.js autoSampleDirection과 **완전히 같아야 한다** —
  한쪽 기준을 바꾸면 다른 쪽도 같이 고칠 것(검증: 무작위 20만 표본 대조).
⚠ engine.py는 한 글자도 안 건드린다 — get_samples_fast를 부르기만 한다(4번 원칙).
"""
import math
import sqlite3
import threading
from collections import defaultdict
from datetime import datetime

import numpy as np
import pandas as pd

import betpro_paths as PATHS
import data_access as DATA
import engine
from my_picks import normalize

TABLE = "sample_dir"
KINDS = ("fav", "pl", "ffav", "k_wl", "f_wl", "k_wdl", "f_wdl")

# ── 판정식(sampleDirection.js와 같은 값) ────────────────────────────────
FLOW_MU = 0.1644
FLOW_SD = 1.5858
BLUE_T = 1.25
RED_T = -1.5
UNKNOWN_LO = -0.25
UNKNOWN_HI = 0.5

_MIRROR_SWAP = (("KW", "KL"), ("KHW", "KHL"), ("FW", "FL"))


def flow_t(vals):
    """[핸승,핸무,무,역] → 중심 보정 t (표본 0건이면 None)."""
    if not vals:
        return None
    n = sum(int(v or 0) for v in vals)
    if n <= 0:
        return None
    hs, hm, mu, yk = (int(v or 0) for v in vals)
    flow = (hs * 2 + hm - mu - yk * 2) / n
    return (flow - FLOW_MU) * math.sqrt(n) / FLOW_SD


def judge(self_vals, mirror_vals):
    """두 줄로 라벨을 낸다 → (라벨, 평균 t 또는 None)."""
    s, m = flow_t(self_vals), flow_t(mirror_vals)
    if s is None and m is None:
        return "표본없음", None
    if s is not None and m is not None and s != 0 and m != 0 and (s > 0) != (m > 0):
        return "엇갈림", (s + m) / 2
    ts = [v for v in (s, m) if v is not None]
    t = sum(ts) / len(ts)
    if t >= BLUE_T:
        return "블루", t
    if t >= UNKNOWN_HI:
        return "약블루", t
    if t > UNKNOWN_LO:
        return "몰라", t
    if t > RED_T:
        return "약레드", t
    return "레드", t


# ── 화면 표본 표와 같은 두 줄 카운트 (main._direction_samples의 통합 줄과 같은 규칙) ──

def mirror_row(row_dict: dict) -> dict:
    """홈·원정을 맞바꾼 거울 경기 — 반대 방향 줄을 엔진으로 세는 데 쓴다."""
    m = dict(row_dict)
    for a, b in _MIRROR_SWAP:
        m[a], m[b] = row_dict.get(b), row_dict.get(a)
    m["RT"] = None
    return m


def stored_counts(row_dict: dict, ind: str) -> list:
    """등록 때 저장해 둔 지표 칸('TK-W 1'~'TK-W 4')을 [핸승,핸무,무,역]으로."""
    out = []
    for i in range(1, 5):
        try:
            v = float(row_dict.get(f"{ind} {i}"))
        except (TypeError, ValueError):
            v = float("nan")
        out.append(0 if np.isnan(v) else int(v))
    return out


def _pos(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 and not math.isnan(f) else None


def section_specs(row_dict: dict) -> dict:
    """섹션별 (이 경기 방향 통합 지표, 반대 방향 통합 지표). 배당이 없어 못 가리는 섹션은 뺀다."""
    out = {}
    kw, kl = _pos(row_dict.get("KW")), _pos(row_dict.get("KL"))
    if kw and kl and kw != kl:
        out["fav"] = ("TK-W", "TK-L") if kw < kl else ("TK-L", "TK-W")
        out["pl"] = ("TK-PL", "TK-PL")
    fw, fl = _pos(row_dict.get("FW")), _pos(row_dict.get("FL"))
    if fw and fl and fw != fl:
        out["ffav"] = ("TF-W", "TF-L") if fw < fl else ("TF-L", "TF-W")
    out["k_wl"] = ("TK-WL", "TK-WL")
    out["f_wl"] = ("TF-WL", "TF-WL")
    out["k_wdl"] = ("TK-WDL", "TK-WDL")
    out["f_wdl"] = ("TF-WDL", "TF-WDL")
    return out


def total_cache(db):
    """6대리그 통합 풀 엔진 캐시 — main._direction_samples와 같은 키라 같이 쓴다."""
    return DATA.cached_derive(
        db, "sample_prep:total", lambda: engine._prep_db(DATA.load_total_df(db)),
        tables=tuple(PATHS.LEAGUES))


def live_judgment(row_dict: dict, cache) -> dict:
    """결과 없는 경기용 — 화면 표본 표 숫자 그대로 판정. {kind: (라벨, t)}."""
    specs = section_specs(row_dict)
    mir = mirror_row(row_dict)
    out = {}
    for kind in KINDS:
        if kind not in specs:
            out[kind] = ("표본없음", None)
            continue
        self_ind, mir_ind = specs[kind]
        out[kind] = judge(stored_counts(row_dict, self_ind),
                          engine.get_samples_fast(cache, mir_ind, mir))
    return out


# ── 과거 경기용: 그 경기 날짜 이전 경기만으로 센 두 줄 ────────────────────────

def asof_judgments(db) -> dict:
    """{키: {kind: (라벨, t)}} — 6대리그 전 경기를 날짜순으로 훑으며 '그 날짜 이전'만 센다.
    같은 날짜 경기끼리는 서로 표본에 안 넣는다. engine.get_samples_fast와 같은 매칭
    (배당 소수 둘째 자리 정확 일치)을 누적 카운터로 옮긴 것이다."""
    recs = []
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df(db, code)
        if df.empty:
            continue
        for r in df.to_dict("records"):
            d = str(r.get("DT") or "")[:8]
            if len(d) != 8:
                continue
            g = {c: (round(_pos(r.get(c)), 2) if _pos(r.get(c)) else None)
                 for c in ("KW", "KD", "KL", "KHW", "KHL", "FW", "FD", "FL")}
            rt = _pos(r.get("RT"))
            g.update(key=_key(code, r), d=d, rt=int(rt) if rt in (1.0, 2.0, 3.0, 4.0) else None)
            recs.append(g)
    recs.sort(key=lambda g: g["d"])

    acc = {k: defaultdict(lambda: [0, 0, 0, 0]) for k in
           ("kw", "kl", "fw", "fl", "kwl", "fwl", "kwdl", "fwdl", "pl")}
    out = {}
    i = 0
    while i < len(recs):
        j = i
        while j < len(recs) and recs[j]["d"] == recs[i]["d"]:
            j += 1
        day = recs[i:j]
        for g in day:
            kw, kd, kl, fw, fd, fl = g["KW"], g["KD"], g["KL"], g["FW"], g["FD"], g["FL"]
            pairs = {}
            if kw and kl and kw != kl:
                v = min(kw, kl)
                pairs["fav"] = (acc["kw"][v], acc["kl"][v]) if kw < kl else (acc["kl"][v], acc["kw"][v])
                hd = kw > kl
                po = g["KHW"] if hd else g["KHL"]
                if po:
                    pairs["pl"] = (acc["pl"][(hd, po)], acc["pl"][(not hd, po)])
            if fw and fl and fw != fl:
                v = min(fw, fl)
                pairs["ffav"] = (acc["fw"][v], acc["fl"][v]) if fw < fl else (acc["fl"][v], acc["fw"][v])
            if kw and kl:
                pairs["k_wl"] = (acc["kwl"][(kw, kl)], acc["kwl"][(kl, kw)])
            if fw and fl:
                pairs["f_wl"] = (acc["fwl"][(fw, fl)], acc["fwl"][(fl, fw)])
            if kw and kd and kl:
                pairs["k_wdl"] = (acc["kwdl"][(kw, kd, kl)], acc["kwdl"][(kl, kd, kw)])
            if fw and fd and fl:
                pairs["f_wdl"] = (acc["fwdl"][(fw, fd, fl)], acc["fwdl"][(fl, fd, fw)])
            out[g["key"]] = {k: (judge(*pairs[k]) if k in pairs else ("표본없음", None)) for k in KINDS}
        for g in day:
            if g["rt"] is None:
                continue
            ix = g["rt"] - 1
            kw, kd, kl, fw, fd, fl = g["KW"], g["KD"], g["KL"], g["FW"], g["FD"], g["FL"]
            if kw:
                acc["kw"][kw][ix] += 1
            if kl:
                acc["kl"][kl][ix] += 1
            if fw:
                acc["fw"][fw][ix] += 1
            if fl:
                acc["fl"][fl][ix] += 1
            if kw and kl:
                acc["kwl"][(kw, kl)][ix] += 1
                if kw != kl:
                    hd = kw > kl
                    po = g["KHW"] if hd else g["KHL"]
                    if po:
                        acc["pl"][(hd, po)][ix] += 1
            if fw and fl:
                acc["fwl"][(fw, fl)][ix] += 1
            if kw and kd and kl:
                acc["kwdl"][(kw, kd, kl)][ix] += 1
            if fw and fd and fl:
                acc["fwdl"][(fw, fd, fl)][ix] += 1
        i = j
    return out


# ── 저장소 ─────────────────────────────────────────────────────────────

def _key(code, r) -> tuple:
    return (code, normalize(r.get("S")), normalize(r.get("R")), normalize(r.get("No")),
            normalize(r.get("HT")), normalize(r.get("AT")))


def _connect(db):
    con = sqlite3.connect(db, timeout=30)
    cols = ", ".join(f"{k} TEXT, {k}_t REAL" for k in KINDS)
    con.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            code TEXT NOT NULL, S TEXT NOT NULL, R TEXT NOT NULL, No TEXT NOT NULL,
            HT TEXT NOT NULL, AT TEXT NOT NULL,
            {cols},
            locked INTEGER NOT NULL DEFAULT 0,
            src TEXT, updated_dt TEXT,
            PRIMARY KEY (code, S, R, No, HT, AT)
        )""")
    return con


def _existing(db) -> dict:
    con = _connect(db)
    try:
        rows = con.execute(f"SELECT code, S, R, No, HT, AT, locked, "
                           + ", ".join(f"{k}, {k}_t" for k in KINDS) + f" FROM {TABLE}").fetchall()
    finally:
        con.close()
    out = {}
    for r in rows:
        vals = {k: (r[7 + i * 2], r[8 + i * 2]) for i, k in enumerate(KINDS)}
        out[tuple(r[:6])] = (int(r[6]), vals)
    return out


def _upsert(db, items):
    """items: [(key, {kind:(라벨,t)}, locked, src)]"""
    if not items:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cols = ["code", "S", "R", "No", "HT", "AT"] + [c for k in KINDS for c in (k, f"{k}_t")] \
        + ["locked", "src", "updated_dt"]
    sql = (f"INSERT OR REPLACE INTO {TABLE} ({', '.join(cols)}) "
           f"VALUES ({', '.join('?' for _ in cols)})")
    data = []
    for key, vals, locked, src in items:
        row = list(key)
        for k in KINDS:
            lab, t = vals.get(k, ("표본없음", None))
            row += [lab, None if t is None else round(float(t), 4)]
        row += [int(locked), src, now]
        data.append(row)
    with DATA.table_write(db, TABLE):
        con = _connect(db)
        try:
            con.executemany(sql, data)
            con.commit()
        finally:
            con.close()


def refresh(db=None) -> dict:
    """결과 없는 경기는 다시 계산, 결과 들어온 경기는 고정, 처음 보는 과거 경기는 as-of로 채운다."""
    db = db or PATHS.get_master_db()
    have = _existing(db)
    cache = None
    asof = None
    items = []
    n_live = n_lock = n_asof = 0
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df(db, code)
        if df.empty:
            continue
        for r in df.to_dict("records"):
            key = _key(code, r)
            finished = _pos(r.get("RT")) in (1.0, 2.0, 3.0, 4.0)
            old = have.get(key)
            if old and old[0]:
                continue                                   # 이미 고정됨
            if finished:
                if old:                                    # 결과 전 마지막 값 그대로 고정
                    items.append((key, old[1], 1, "live"))
                    n_lock += 1
                else:                                      # 처음 보는 과거 경기
                    if asof is None:
                        asof = asof_judgments(db)
                    items.append((key, asof.get(key, {}), 1, "asof"))
                    n_asof += 1
                continue
            if cache is None:
                cache = total_cache(db)
            vals = live_judgment(r, cache)
            if not old or old[1] != {k: (lab, None if t is None else round(float(t), 4))
                                     for k, (lab, t) in vals.items()}:
                items.append((key, vals, 0, "live"))
                n_live += 1
    _upsert(db, items)
    return {"live": n_live, "locked": n_lock, "asof": n_asof}


# ── 뒤에서 자동으로 돌리기(axis_stats.py와 같은 꼴) ──────────────────────────
_LOCK = threading.Lock()
_STATE = {"running": False, "error": None, "token": None, "last": None}


def _run(db, tok):
    try:
        _STATE["last"] = refresh(db)
        _STATE["token"] = tok
        _STATE["error"] = None
    except Exception as e:   # noqa: BLE001 — 뒤에서 도는 작업이라 실패를 상태로 남긴다
        _STATE["error"] = f"{type(e).__name__}: {e}"
    finally:
        with _LOCK:
            _STATE["running"] = False


def ensure(db=None) -> None:
    """리그 표가 지난 계산 뒤로 바뀌었으면 뒤에서 다시 돈다. 요청을 기다리게 하지 않는다."""
    db = db or PATHS.get_master_db()
    tok = DATA.tables_token(db, tuple(PATHS.LEAGUES))
    with _LOCK:
        if _STATE["running"] or _STATE["token"] == tok:
            return
        _STATE["running"] = True
    threading.Thread(target=_run, args=(db, tok), name="sample-dir", daemon=True).start()


def status() -> dict:
    return {k: _STATE[k] for k in ("running", "error", "last")}


def get(code: str, row: dict, db=None):
    """상세보기용 — 이 경기의 저장된 시스템 판정. 아직 없으면 None."""
    db = db or PATHS.get_master_db()
    key = _key(code, row)
    con = _connect(db)
    try:
        r = con.execute(f"SELECT locked, src, updated_dt, "
                        + ", ".join(f"{k}, {k}_t" for k in KINDS)
                        + f" FROM {TABLE} WHERE code=? AND S=? AND R=? AND No=? AND HT=? AND AT=?",
                        key).fetchone()
    finally:
        con.close()
    if not r:
        return None
    return {"locked": bool(r[0]), "src": r[1], "updated": r[2],
            "labels": {k: {"label": r[3 + i * 2], "t": r[4 + i * 2]} for i, k in enumerate(KINDS)}}
