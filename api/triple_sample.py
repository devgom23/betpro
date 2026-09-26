"""상세보기 '표본' 섹션 — 12사 평균 승·패 + 국배 승·패가 둘 다 비슷한 과거 경기(2026-09-26 사용자 지정).

배답남 방식 표본: 이 경기와 '배당 모양'이 같았던 과거 경기를 찾아 그 결과(핸승·핸무·무·역)를 보여준다.
우리 기존 표본(정배배당 한 값)과 달리 승·패 두 값을 함께 보고, 12개 배당사 평균과 국내 배당(국배)을 둘 다 맞춘다.

[조건 — 승과 패가 둘 다 폭 안이어야 한다. 무는 조건이 아니라 참고]
  12사 평균(초기) : 스코어맨 12개 회사 초기 배당 평균(6곳 이상인 경기). 소수 둘째 자리로 반올림
                    — book_dir._avg2·화면 12개 배당사 표의 평균(mbMean)과 같은 규칙(끝자리 5는 올림)
  국배(초기)      : 국내 초기 배당(KW·KD·KL)
  위  영역 = 같은 리그 · 아래 영역 = 통합(다른 리그만 — 같은 리그 경기는 위에 이미 나오므로 뺀다)
  폭은 둘 다 완전 일치(±0칸)에서 시작해 0건이면 1칸씩 넓힌다(2026-09-26 사용자 지정)
  칸 = 소수 둘째 자리 한 눈금(0.01). 국내 호가 단위는 2.5 미만 0.01 · 2.5~5 0.05 · 5↑ 0.10이라
  2.5 이상 구간에서는 이 폭이 사실상 '같은 값'만 잡는다(도움말에도 적어 둠).
[넓히기] 시작 폭에서 표본이 0건이면 1칸씩 넓혀 1건 이상 나오는 첫 폭을 쓴다(2026-09-26, 최대 MAX_TICK칸).
     화면에는 '±N칸' — N=실제 쓴 폭(0이 완전 일치).
[시점] 이 경기 날짜 '이전'에 끝난(결과 RT 1~4) 경기만. 같은 날 경기는 서로 안 센다.
[정렬] 승·패 차이(12사+국배)의 합이 작은 순 → 무 차이 → 최근. 결과(RT)별로 갈라 칸마다 최대 PER_COLUMN장.

과거 26,483경기 실측(2026-09-26): 표본이 나오는 경기는 위 18.8%·아래 22.5%(둘 중 하나라도 33.7%)이고,
표본의 다수 방향(정/플)이 실제와 같았던 비율은 51~53%로 우연 수준 — 예측 근거가 아니라
'비슷한 배당의 과거 경기를 눈으로 보는 용도'다(메모리 reference-triple-match-sample).
"""
import sqlite3
import threading
import time

import numpy as np
import pandas as pd

import betpro_paths as PATHS
import data_access as DATA
import multibook_odds as MB
from kr_extra_odds import _key

START_TICK = 0        # 시작 폭(칸) — 완전 일치부터. 0건이면 1칸씩 넓힌다(같은 리그·통합 각각)
MIN_BOOKS = 6
PER_COLUMN = 12
MAX_TICK = 15        # 표본이 1건도 없을 때 폭을 넓히는 한계(칸) — 이보다 넓으면 '비슷한 배당'이라 하기 어렵다
BUSY_WINDOW = 600   # 초 — 12사 배당 저장이 이보다 최근이면(백필 중) 만들어 둔 색인을 그대로 쓴다

_CACHE = {"tok": None, "val": None}
_LOCK = threading.Lock()
_LG_LABEL = {"EPL": "EPL", "LALIGA": "라리가", "SERIEA": "세리에A", "BUNDES": "분데스", "EREDIVISIE": "에레디", "LIGUE1": "리그1"}


def _mb_state(mb_path):
    """(12사 배당 줄 수, 마지막 저장 시각) — 없으면 (0, None)."""
    try:
        con = sqlite3.connect(mb_path, timeout=30)
        try:
            return con.execute("SELECT COUNT(*), MAX(updated_dt) FROM mb_odds").fetchone()
        finally:
            con.close()
    except sqlite3.Error:
        return (0, None)


def _mb_busy(last):
    try:
        from datetime import datetime
        return bool(last) and (datetime.now() - datetime.strptime(last, "%Y-%m-%d %H:%M:%S")).total_seconds() < BUSY_WINDOW
    except (ValueError, TypeError):
        return False


def _f(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)


def _build(db, mb_path):
    """전 경기 배열 — 날짜·리그·12사 평균 3값·국배 3값·결과와 카드에 쓸 값."""
    con = sqlite3.connect(mb_path, timeout=30)
    try:
        mb = pd.read_sql("SELECT code,S,R,HT,AT,EU_F1,EU_FX,EU_F2 FROM mb_odds", con)
    finally:
        con.close()
    cols = ["EU_F1", "EU_FX", "EU_F2"]
    for c in cols:
        mb[c] = pd.to_numeric(mb[c], errors="coerce")
    mb = mb[(mb[cols] > 1.0).all(axis=1)]
    for c in cols:                                 # 소수 셋째 자리까지 쓰는 회사가 있어 ×1000 정수로 더한다
        mb[c] = (mb[c] * 1000).round().astype("int64")
    g = mb.groupby(["code", "S", "R", "HT", "AT"])
    sums = g[cols].sum()
    cnt = g.size()
    avg = ((2 * sums.values + 10 * cnt.values[:, None]) // (20 * cnt.values[:, None])) / 100.0   # 둘째 자리(끝자리 5는 올림)
    avg_map = {}
    for (k, a, n) in zip(sums.index, avg, cnt.values):
        if n >= MIN_BOOKS:
            avg_map[_key(*k)] = (a, int(n))

    frames = []
    for code in PATHS.LEAGUES:
        d = DATA.load_league_df(db, code)
        if d.empty:
            continue
        d = d[["S", "R", "HT", "AT", "DT", "HS", "AS", "RT", "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL"]].copy()
        d["code"] = code
        frames.append(d)
    G = pd.concat(frames, ignore_index=True)
    for c in ("HS", "AS", "RT", "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL"):
        G[c] = pd.to_numeric(G[c], errors="coerce")
    G["date"] = pd.to_datetime("20" + G["DT"].astype(str).str[:8], format="%Y-%m-%d", errors="coerce")
    keys = [_key(a, b, c, d, e) for a, b, c, d, e in zip(G["code"], G["S"], G["R"], G["HT"], G["AT"])]
    A = np.full((len(G), 3), np.nan)
    nb = np.zeros(len(G), dtype=int)
    for i, k in enumerate(keys):
        v = avg_map.get(k)
        if v is not None:
            A[i] = v[0]
            nb[i] = v[1]
    K = G[["KW", "KD", "KL"]].to_numpy(float)
    K = np.where(K > 1.0, np.round(K, 2), np.nan)
    days = G["date"].values.astype("datetime64[D]").astype("int64").astype(float)
    days[G["date"].isna().to_numpy()] = np.nan
    return {"G": G, "keys": keys, "kmap": {k: i for i, k in enumerate(keys)}, "A": A, "K": K, "nb": nb,
            "days": days, "rt": G["RT"].to_numpy(float), "code": G["code"].to_numpy(), "n": len(G)}


def _index(db):
    mb_path = MB.db_path_for(PATHS.SCOPE_MASTER)
    cnt, last = _mb_state(mb_path)
    tok = (DATA.tables_token(db, tuple(PATHS.LEAGUES)), cnt, last)
    with _LOCK:
        if _CACHE["tok"] == tok:
            return _CACHE["val"]
        # 12사 배당을 명령 프롬프트 백필이 쓰는 중이면 만들어 둔 색인을 그대로 쓴다(리그 표가 그대로일 때만) —
        # 저장할 때마다 다시 만들면 서버가 그동안 느려진다(book_dir와 같은 사정).
        if _CACHE["val"] is not None and _mb_busy(last) and _CACHE["tok"][0] == tok[0]:
            return _CACHE["val"]
        val = _build(db, mb_path)
        _CACHE["tok"], _CACHE["val"] = tok, val
        return val


def warm(db):
    try:
        _index(db)
    except Exception:  # noqa: BLE001 — 미리 만들기는 실패해도 서버에 영향 없다
        pass


def _card(ix, j):
    G = ix["G"]
    r = G.iloc[j]
    return {"dt": str(r["date"])[:10], "lg": _LG_LABEL.get(r["code"], r["code"]), "S": str(r["S"]), "R": str(r["R"]),
            "ht": r["HT"], "at": r["AT"], "hs": None if pd.isna(r["HS"]) else int(r["HS"]), "as_": None if pd.isna(r["AS"]) else int(r["AS"]),
            "rt": int(r["RT"]), "A": [float(x) for x in ix["A"][j]], "K": [float(x) for x in ix["K"][j]],
            "kh": _f(r["KH"]), "khw": _f(r["KHW"]), "khd": _f(r["KHD"]), "khl": _f(r["KHL"])}


def _pick(ix, qi, mask):
    """mask를 만족하는 경기들을 가까운 순으로 정렬해 결과별 카드로."""
    A, K = ix["A"], ix["K"]
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return {"n": 0, "cnt": [0, 0, 0, 0], "cards": {"1": [], "2": [], "3": [], "4": []}}
    d_wl = (np.abs(A[idx, 0] - A[qi, 0]) + np.abs(A[idx, 2] - A[qi, 2])
            + np.abs(K[idx, 0] - K[qi, 0]) + np.abs(K[idx, 2] - K[qi, 2]))
    d_d = np.abs(A[idx, 1] - A[qi, 1]) + np.abs(K[idx, 1] - K[qi, 1])
    order = np.lexsort((-ix["days"][idx], d_d, np.round(d_wl, 6)))
    idx = idx[order]
    rts = ix["rt"][idx].astype(int)
    cards = {str(k): [_card(ix, j) for j in idx[rts == k][:PER_COLUMN]] for k in (1, 2, 3, 4)}
    return {"n": int(len(idx)), "cnt": [int((rts == k).sum()) for k in (1, 2, 3, 4)], "cards": cards}


def query(db, code, season, rnd, ht, at):
    """이 경기의 위(같은 리그)·아래(다른 리그) 표본. 만들 수 없으면 {'ready': False, 'reason': ...}."""
    ix = _index(db)
    qi = ix["kmap"].get(_key(code, season, rnd, ht, at))
    if qi is None:
        return {"ready": False, "reason": "경기를 찾지 못했습니다"}
    A, K = ix["A"], ix["K"]
    if np.isnan(A[qi]).any():
        return {"ready": False, "reason": f"12사 평균을 낼 배당사가 {MIN_BOOKS}곳 미만이라 표본을 만들 수 없습니다"}
    if np.isnan(K[qi]).any():
        return {"ready": False, "reason": "국내 배당(국배)이 아직 없어 표본을 만들 수 없습니다"}
    day = ix["days"][qi]
    if np.isnan(day):
        return {"ready": False, "reason": "경기 날짜가 없어 표본을 만들 수 없습니다"}
    pool = (np.isin(ix["rt"], (1, 2, 3, 4)) & ~np.isnan(A).any(axis=1) & ~np.isnan(K).any(axis=1)
            & (ix["days"] < day))
    pool[qi] = False

    def within(tick):
        e = tick + 1e-9
        return (np.abs(A[:, 0] - A[qi, 0]) <= e) & (np.abs(A[:, 2] - A[qi, 2]) <= e) \
            & (np.abs(K[:, 0] - K[qi, 0]) <= e) & (np.abs(K[:, 2] - K[qi, 2]) <= e)

    same = ix["code"] == ix["code"][qi]
    r = ix["G"].iloc[qi]

    def widen(base, start):
        """start칸에서 시작해 표본이 1건이라도 나올 때까지 1칸씩 넓힌다. (결과, 쓴 칸 수) — 끝까지 없으면 start칸의 빈 결과."""
        for k in range(start, MAX_TICK + 1):
            m = base & within(k / 100)
            if m.any():
                return _pick(ix, qi, m), k
        return _pick(ix, qi, base & within(start / 100)), start

    def nxt(base, k, n0):
        """더 넓힌 미리보기 — 표본이 실제로 늘어나는(다른 표본이 처음 더해지는) 폭까지 1칸씩 넓힌다.
        폭만 넓어지고 표본이 그대로면 볼 게 없으므로 건너뛴다(예: ±2칸 1건 → ±3칸 1건이면 ±4칸까지)."""
        for j in range(k + 1, MAX_TICK + 1):
            m = base & within(j / 100)
            if int(m.sum()) > n0:
                return {"tol": j / 100, "area": _pick(ix, qi, m)}
        return None

    same_res, same_k = widen(pool & same, START_TICK)
    other_res, other_k = widen(pool & ~same, START_TICK)
    same_res["next"] = nxt(pool & same, same_k, same_res["n"])
    other_res["next"] = nxt(pool & ~same, other_k, other_res["n"])
    return {"ready": True,
            "game": {"A": [float(x) for x in A[qi]], "K": [float(x) for x in K[qi]], "n_books": int(ix["nb"][qi]),
                     "kh": _f(r["KH"]), "khw": _f(r["KHW"]), "khd": _f(r["KHD"]), "khl": _f(r["KHL"]), "lg": _LG_LABEL.get(code, code)},
            "same": same_res, "other": other_res,
            "tol": {"same": same_k / 100, "other": other_k / 100},
            "ticks": {"same": same_k, "other": other_k},
            "start": START_TICK}
