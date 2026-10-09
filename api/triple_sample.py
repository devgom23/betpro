"""상세보기 '표본' 섹션 — 국배 승·무·패가 똑같은 과거 경기를, 해배(12사) 평균이 가장 비슷한 순으로(2026-10-09 규칙 변경).

[2026-10-09 사용자 지정 — 거르기·줄 세우기를 뒤집었다]
  예전: 12사 평균 승·패와 국배 승·패가 '둘 다' 폭 안이면 표본, 두 차이의 합이 작은 순.
  지금: ① 국배 승·무·패 3개가 모두 똑같은 과거 경기만 표본 — 0건이면 세 값 차이를 호가 단계 수로 '더한' 거리가 가장 작은 경기까지 넓힌다
        (같은 날 수정 — 처음엔 가장 크게 벌어진 한 값으로 쟀는데 2·0·5칸과 4·5·5칸이 같은 '5칸'이 됐다. 무도 조건에 든다).
        ② 그 안에서 12사 평균 승·무·패 차이의 합이 가장 작은 순 → 국배 차이 → 최근. 12사 평균이 없는 경기는 맨 뒤.
  → "국내가 같은 배당을 줬는데 해외 시장은 어떻게 봤고 결과가 어땠나"를 보는 구조. 초기·배변 둘 다 같은 규칙.
[후보 범위] 19-20 시즌 이후 경기만(MIN_SEASON, 같은 날 사용자 지정). 옛 규칙(legacy=True, 플핸 점수용)은 전체 시즌 그대로.
[국배 예측] (같은 날 사용자 지정 — "해배 평균으로 국배를 미리 짐작") predict_kr — 이 경기의 12사 평균 승·무·패와
  같았던(±N칸) 과거 경기들의 국배를 모아 가장 많이 나온 국배·중앙값을 보여준다. 국배가 아직 없는 경기에서 특히 쓴다.
  초기는 12사 초기 평균 → 국배 초기, 배변은 12사 마감 평균 → 국배 배변.

(아래는 2026-09-26 처음 만들 때의 설명 — 폭·시점·카드 규칙은 그대로다)

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
[배변 표본] (2026-10-04 사용자 지정 — "현재 표본을 초기 표본이라 하고 그 아래에 배변표본") 같은 방식인데 기준 배당만 바뀐다.
  12사 평균(마감)  : 스코어맨 12개 회사 마감 배당(EU_L1/LX/L2) 평균(6곳 이상) — 초기와 같은 반올림 규칙
  국배(배변)       : 국내 최신 배당(EKW·EKD·EKL) — '최신배당 불러오기'로 채워진 값
  과거 경기도 배변 값이 있는 경기만 표본 풀에 든다(결과 난 경기 중 국배 배변이 있는 건 약 94%).
  이번 경기에 국배 배변이 없으면(최신배당을 아직 안 불렀거나 배변 전) 표본을 만들지 않는다.
  query(phase="init"|"final")로 고른다 — 기본 init은 예전과 완전히 같다.
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
MAX_TICK = 15        # 표본이 1건도 없을 때 폭을 넓히는 한계(칸) — 이보다 넓으면 '비슷한 배당'이라 하기 어렵다(옛 규칙: 가장 크게 벌어진 한 값)
MIN_SEASON = 19      # 표본 후보는 이 시즌(19-20) 이후 경기만(2026-10-09 사용자 지정) — 옛 규칙(legacy)은 전체 그대로
MAX_STEPS = 12      # 새 규칙(2026-10-09)의 한계 — 국배 승·무·패 세 값 차이를 호가 단계 수로 더한 값(아래 odds_rank)
MAX_SUM = 30        # 국배 예측의 12사 평균 거리 한계 — 12사 평균은 소수 둘째 자리 평균값이라 호가 단위가 없어 0.01 칸 합 그대로
PRED_MIN = 10       # 국배 예측 — 해배 평균이 같은(±N칸) 과거 경기가 이만큼 모일 때까지 폭을 넓힌다
BUSY_WINDOW = 600   # 초 — 12사 배당 저장이 이보다 최근이면(백필 중) 만들어 둔 색인을 그대로 쓴다

_CACHE: dict = {}   # (db, 리그들) → {"tok", "val"} — 공식 6대리그와 내 데이터 K1·K2가 따로 쓴다
USER_CODES = ("ul_1", "ul_2")        # 내 데이터에서 표본을 내는 리그(K1·K2, 2026-09-27 사용자 지정)
BOOKS_MIN_POOL = 300   # 이 리그에 12사 평균이 있는 결과 난 경기가 이만큼 쌓이면 12사 조건을 쓴다(그 전엔 국배만)
_LOCK = threading.Lock()
_LG_LABEL = {"EPL": "EPL", "LALIGA": "라리가", "SERIEA": "세리에A", "BUNDES": "분데스", "EREDIVISIE": "에레디", "LIGUE1": "리그1",
             "ul_1": "K1", "ul_2": "K2"}


def odds_rank(x):
    """국내 배당을 '호가 단계 번호'로 바꾼다 — 두 값의 단계 번호 차이 = 사이에 놓인 호가 단계 수(2026-10-09 사용자 지정).
    국내 배당은 0.01씩 움직이지 않고 구간별 단위로만 움직인다(33,000경기 실측): 2.5 미만 0.01 · 2.5~5 0.05 · 5~10 0.10 · 10 이상 0.50.
    예) 무 3.00 → 2.95는 5칸이 아니라 1단계, 승 2.60 → 2.55도 1단계. 단위 경계(2.5·5·10)에서 번호가 이어지게 구간마다 누적한다."""
    x = np.asarray(x, dtype=float)
    return np.where(x < 2.5, x * 100,
           np.where(x < 5.0, 250 + (x - 2.5) / 0.05,
           np.where(x < 10.0, 300 + (x - 5.0) / 0.10, 350 + (x - 10.0) / 0.50)))


def _mb_state(mb_path):
    """(12사 배당 줄 수, 마지막 저장 시각) — 없으면 (0, None). 5초간 재사용(multibook_odds.mb_state)."""
    return MB.mb_state(mb_path) or (0, None)


def _mb_busy(last):
    try:
        from datetime import datetime
        return bool(last) and (datetime.now() - datetime.strptime(last, "%Y-%m-%d %H:%M:%S")).total_seconds() < BUSY_WINDOW
    except (ValueError, TypeError):
        return False


def _f(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)


def _avg_map(mb, cols):
    """12사 평균(소수 둘째 자리, 끝자리 5는 올림) — {경기키: (평균 3값, 회사 수)}. 6곳 미만 경기는 뺀다."""
    d = mb[["code", "S", "R", "HT", "AT"] + cols].copy()
    for c in cols:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d[(d[cols] > 1.0).all(axis=1)]
    for c in cols:                                 # 소수 셋째 자리까지 쓰는 회사가 있어 ×1000 정수로 더한다
        d[c] = (d[c] * 1000).round().astype("int64")
    g = d.groupby(["code", "S", "R", "HT", "AT"])
    sums = g[cols].sum()
    cnt = g.size()
    avg = ((2 * sums.values + 10 * cnt.values[:, None]) // (20 * cnt.values[:, None])) / 100.0   # 둘째 자리(끝자리 5는 올림)
    out = {}
    for (k, a, n) in zip(sums.index, avg, cnt.values):
        if n >= MIN_BOOKS:
            out[_key(*k)] = (a, int(n))
    return out


def _build(db, mb_path, codes):
    """전 경기 배열 — 날짜·리그·12사 평균 3값·국배 3값·결과와 카드에 쓸 값. 초기(A·K·H)와 배변(Af·Kf·Hf)을 같이 만든다."""
    con = sqlite3.connect(mb_path, timeout=30)
    try:
        mb = pd.read_sql("SELECT code,S,R,HT,AT,EU_F1,EU_FX,EU_F2,EU_L1,EU_LX,EU_L2 FROM mb_odds", con)
    finally:
        con.close()
    avg_map = _avg_map(mb, ["EU_F1", "EU_FX", "EU_F2"])
    avg_map_f = _avg_map(mb, ["EU_L1", "EU_LX", "EU_L2"])

    want = ["S", "R", "HT", "AT", "DT", "HS", "AS", "RT", "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL",
            "EKW", "EKD", "EKL", "EKH", "EKHW", "EKHD", "EKHL"]
    frames = []
    for code in codes:
        d = DATA.load_league_df(db, code)
        if d.empty:
            continue
        d = d.reindex(columns=want).copy()           # 배변 칸이 없는 리그(내 데이터 일부)는 빈 값
        d["code"] = code
        frames.append(d)
    G = pd.concat(frames, ignore_index=True)
    for c in want[5:]:
        G[c] = pd.to_numeric(G[c], errors="coerce")
    G["date"] = pd.to_datetime("20" + G["DT"].astype(str).str[:8], format="%Y-%m-%d", errors="coerce")
    keys = [_key(a, b, c, d, e) for a, b, c, d, e in zip(G["code"], G["S"], G["R"], G["HT"], G["AT"])]
    A = np.full((len(G), 3), np.nan)
    Af = np.full((len(G), 3), np.nan)
    nb = np.zeros(len(G), dtype=int)
    nbf = np.zeros(len(G), dtype=int)
    for i, k in enumerate(keys):
        v = avg_map.get(k)
        if v is not None:
            A[i] = v[0]
            nb[i] = v[1]
        v = avg_map_f.get(k)
        if v is not None:
            Af[i] = v[0]
            nbf[i] = v[1]

    def _k(cols):
        a = G[cols].to_numpy(float)
        return np.where(a > 1.0, np.round(a, 2), np.nan)

    K = _k(["KW", "KD", "KL"])
    Kf = _k(["EKW", "EKD", "EKL"])
    Kf[np.isnan(Kf).any(axis=1)] = np.nan             # 배변은 승·무·패 셋이 다 있어야 한다
    def _sno(v):
        t = str(v).strip()
        return float(int(t) % 100) if t.isdigit() and len(t) == 4 else (float(t[:2]) if t[:2].isdigit() else np.nan)
    sno = np.array([_sno(v) for v in G["S"]])
    days = G["date"].values.astype("datetime64[D]").astype("int64").astype(float)
    days[G["date"].isna().to_numpy()] = np.nan
    return {"G": G, "keys": keys, "kmap": {k: i for i, k in enumerate(keys)}, "A": A, "K": K, "nb": nb,
            "H": G[["KH", "KHW", "KHD", "KHL"]].to_numpy(float),
            "Af": Af, "Kf": Kf, "nbf": nbf, "Hf": G[["EKH", "EKHW", "EKHD", "EKHL"]].to_numpy(float),
            "days": days, "sno": sno, "rt": G["RT"].to_numpy(float), "code": G["code"].to_numpy(), "n": len(G)}


def _index(db, codes=None, mb_path=None):
    codes = tuple(codes or PATHS.LEAGUES)
    mb_path = mb_path or MB.db_path_for(PATHS.SCOPE_MASTER)
    cnt, last = _mb_state(mb_path)
    tok = (DATA.tables_token(db, codes), cnt, last)
    ck = (db, codes)
    with _LOCK:
        slot = _CACHE.setdefault(ck, {"tok": None, "val": None})
        if slot["tok"] == tok:
            return slot["val"]
        # 12사 배당을 명령 프롬프트 백필이 쓰는 중이면 만들어 둔 색인을 그대로 쓴다(리그 표가 그대로일 때만) —
        # 저장할 때마다 다시 만들면 서버가 그동안 느려진다(book_dir와 같은 사정).
        if slot["val"] is not None and _mb_busy(last) and slot["tok"][0] == tok[0]:
            return slot["val"]
        val = _build(db, mb_path, codes)
        slot["tok"], slot["val"] = tok, val
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
            "rt": int(r["RT"]), "A": [None if np.isnan(x) else float(x) for x in ix["A"][j]], "K": [float(x) for x in ix["K"][j]],
            "kh": _f(ix["H"][j][0]), "khw": _f(ix["H"][j][1]), "khd": _f(ix["H"][j][2]), "khl": _f(ix["H"][j][3])}


def _pick(ix, qi, mask, prev=None, legacy=False):
    """mask를 만족하는 경기들을 가까운 순으로 정렬해 결과별 카드로. prev = 더 좁은 폭의 표본 mask — 거기 든 경기는 카드에 prev=True(넓힌 탭에서 테두리 강조용)."""
    A, K = ix["A"], ix["K"]
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return {"n": 0, "cnt": [0, 0, 0, 0], "cards": {"1": [], "2": [], "3": [], "4": []}}
    # 줄 세우기(2026-10-09) — 12사(해배) 평균 승·무·패 차이 합이 작은 순 → 국배 승·무·패 차이 합 → 최근.
    # 12사 평균이 없는 쪽(이 경기든 과거 경기든)은 차이를 큰 값으로 두어 맨 뒤로 보낸다.
    if legacy:                                      # 옛 규칙(플핸 점수의 '표본 카드' 신호용) — 승·패 차이(12사+국배) → 무 차이 → 최근
        d_wl = (np.abs(A[idx, 0] - A[qi, 0]) + np.abs(A[idx, 2] - A[qi, 2])
                + np.abs(K[idx, 0] - K[qi, 0]) + np.abs(K[idx, 2] - K[qi, 2]))
        d_d = np.abs(A[idx, 1] - A[qi, 1]) + np.abs(K[idx, 1] - K[qi, 1])
        order = np.lexsort((-ix["days"][idx], d_d, np.round(d_wl, 6)))
    else:
        d_a = np.abs(A[idx] - A[qi]).sum(axis=1)
        d_a = np.where(np.isnan(d_a), 1e9, d_a)
        d_k = np.abs(K[idx] - K[qi]).sum(axis=1)
        order = np.lexsort((-ix["days"][idx], np.round(d_k, 6), np.round(d_a, 6)))
    idx = idx[order]
    rts = ix["rt"][idx].astype(int)
    cards = {str(k): [dict(_card(ix, j), prev=bool(prev is not None and prev[j])) for j in idx[rts == k][:PER_COLUMN]] for k in (1, 2, 3, 4)}
    return {"n": int(len(idx)), "cnt": [int((rts == k).sum()) for k in (1, 2, 3, 4)], "cards": cards}


def predict_kr(ix, qi, same, day):
    """국배 예측(2026-10-09 사용자 지정) — 이 경기의 12사 평균 승·무·패와 같았던 과거 경기들의 국배를 모은다.
    같은 리그에서 0칸(승·무·패 차이 합)부터 넓혀 PRED_MIN경기가 모이는 첫 폭을 쓰고, MAX_SUM칸까지 넓혀도 모자라면 6대리그 전체로 같은 방식.
    결과가 났는지는 안 따진다(국배는 경기 전에 이미 정해지는 값이라). 12사 평균이 없으면 None."""
    A, K = ix["A"], ix["K"]
    if np.isnan(A[qi]).any() or np.isnan(day):
        return None
    base = ~np.isnan(A).any(axis=1) & ~np.isnan(K).any(axis=1) & (ix["days"] < day)
    base[qi] = False
    with np.errstate(invalid="ignore"):
        da = np.rint(np.abs(A - A[qi]) * 100).sum(axis=1)       # 12사 평균 승·무·패 차이(칸)를 더한 값 — 표본 폭과 같은 재는 법
    da = np.where(np.isnan(da), 1e9, da)
    pick = None
    for scope_name, m in (("same", base & same), ("all", base)):
        d = np.sort(da[m])
        if len(d) >= PRED_MIN and d[PRED_MIN - 1] <= MAX_SUM:
            k = int(d[PRED_MIN - 1])
            pick = (scope_name, k, m & (da <= k))
            break
    if pick is None:                                  # 넓혀도 모자라면 전체에서 MAX_TICK칸 안에 있는 것만
        m = base & (da <= MAX_SUM)
        if not m.any():
            return {"n": 0, "tol": MAX_SUM / 100, "ticks": MAX_SUM, "scope": "all", "median": None}
        pick = ("all", MAX_SUM, m)
    scope_name, k, m = pick
    ks = K[m]
    n = int(m.sum())
    # 국배 세 값이 통째로 같은 경기는 드물어(대부분 1건씩) '가장 많이 나온 국배'는 뜻이 없다 — 값마다 중앙값과 가운데 절반 범위(25~75%)를 쓴다.
    med = [float(np.round(np.median(ks[:, j]), 2)) for j in range(3)]
    q25 = [float(np.round(np.percentile(ks[:, j], 25), 2)) for j in range(3)]
    q75 = [float(np.round(np.percentile(ks[:, j], 75), 2)) for j in range(3)]
    idx = np.where(m)[0]
    dist = np.abs(A[idx] - A[qi]).sum(axis=1)
    near = [dict(_card_lite(ix, j), dist=round(float(d), 2)) for j, d in zip(idx[np.lexsort((-ix["days"][idx], dist))][:5],
                                                                          np.sort(dist)[:5])]
    return {"n": n, "tol": k / 100, "ticks": k, "scope": scope_name, "median": med, "q25": q25, "q75": q75, "near": near,
            "A": [float(x) for x in A[qi]]}


def _card_lite(ix, j):
    G = ix["G"]
    r = G.iloc[j]
    return {"dt": str(r["date"])[:10], "lg": _LG_LABEL.get(r["code"], r["code"]), "ht": r["HT"], "at": r["AT"],
            "A": [float(x) for x in ix["A"][j]], "K": [float(x) for x in ix["K"][j]]}


def query(db, code, season, rnd, ht, at, codes=None, mb_path=None, phase="init", legacy=False):
    """이 경기의 위(같은 리그)·아래(다른 리그) 표본. 만들 수 없으면 {'ready': False, 'reason': ...}.
    codes·mb_path를 주면 그 리그들·그 12사 파일로(내 데이터 K1·K2). 기본은 공식 6대리그.
    phase='final'이면 배변(12사 마감 평균 + 국배 최신) 기준 — 같은 계산에 배열만 바꿔 끼운다.
    legacy=True면 2026-10-09 이전 규칙(12사 평균 승·패 + 국배 승·패가 둘 다 폭 안) — 플핸 점수(plhan_score._cards_pl)의 '표본 카드'
    신호가 옛 규칙으로 문턱을 정하고 학습했기 때문에 그쪽만 옛 규칙을 계속 쓴다(화면 표본은 새 규칙)."""
    ix = _index(db, codes, mb_path)
    ix0 = ix                                        # 초기 값(배변 표본의 '초기 대비 변화'를 보여주려고 따로 둔다)
    final = phase == "final"
    if final:
        ix = dict(ix, A=ix["Af"], K=ix["Kf"], H=ix["Hf"], nb=ix["nbf"])
    qi = ix["kmap"].get(_key(code, season, rnd, ht, at))
    if qi is None:
        return {"ready": False, "reason": "경기를 찾지 못했습니다"}
    A, K = ix["A"], ix["K"]
    same = ix["code"] == ix["code"][qi]
    done = np.isin(ix["rt"], (1, 2, 3, 4))
    # 12사 조건을 쓸지 — 이 리그에 12사 평균이 있는 결과 난 경기가 충분할 때만(K리그는 12사 과거 배당이
    # 아직 거의 없어 국배만으로 찾는다. 백필이 쌓이면 자동으로 12사 조건으로 바뀐다 — 2026-09-27).
    # 12사 평균은 이제 거르는 조건이 아니라 줄 세우는 기준이다(2026-10-09) — 리그에 12사 과거 배당이 충분하고 이 경기에도
    # 12사 평균이 있을 때만 'books'(12사 순 정렬), 아니면 'kr'(국배 차이·최근 순).
    use_books = bool(int((done & same & ~np.isnan(A).any(axis=1)).sum()) >= BOOKS_MIN_POOL)
    if legacy and use_books and np.isnan(A[qi]).any():
        return {"ready": False, "reason": f"12사 {'마감 ' if final else ''}평균을 낼 배당사가 {MIN_BOOKS}곳 미만이라 표본을 만들 수 없습니다"}
    use_books = use_books and not np.isnan(A[qi]).any()
    day = ix["days"][qi]
    if np.isnan(K[qi]).any():
        return {"ready": False, "reason": ("국내 배당 배변(최신배당)이 아직 없어 배변 표본을 만들 수 없습니다 — 리그 화면의 '최신배당 불러오기'로 채우면 만들어집니다"
                                           if final else "국내 배당(국배)이 아직 없어 표본을 만들 수 없습니다"),
                "predict": predict_kr(ix, qi, same, day), "phase": "final" if final else "init"}
    if np.isnan(day):
        return {"ready": False, "reason": "경기 날짜가 없어 표본을 만들 수 없습니다"}
    pool = done & ~np.isnan(K).any(axis=1) & (ix["days"] < day)
    if legacy and use_books:
        pool &= ~np.isnan(A).any(axis=1)
    if not legacy:
        pool &= ix["sno"] >= MIN_SEASON            # 19-20 시즌 이후 경기만(2026-10-09 사용자 지정)
    pool[qi] = False

    # 거르기 = 국배 승·무·패 셋 중 가장 크게 벌어진 칸 수(정수 칸) — 폭을 몇 칸으로 하든 dd <= 폭 비교 한 번이다
    # (옛 규칙: 국배 승·패 + 12사 평균 승·패 네 값 중 가장 크게 벌어진 칸 수)
    with np.errstate(invalid="ignore"):
        if legacy:
            diffs = [np.abs(K[:, 0] - K[qi, 0]), np.abs(K[:, 2] - K[qi, 2])]
            if use_books:
                diffs += [np.abs(A[:, 0] - A[qi, 0]), np.abs(A[:, 2] - A[qi, 2])]
            dd = np.rint(np.maximum.reduce(diffs) * 100)
        else:
            # 2026-10-09 사용자 지정 — 거리 = 국배 승·무·패 세 값 차이를 '더한' 값(0.01 칸이 아니라 국내 호가 단계 수 — odds_rank). 가장 크게 벌어진 한 값으로 재면
            # 2·0·5칸(릴-렌)과 4·5·5칸이 똑같이 '5칸'이 되어 덜 닮은 경기까지 같이 잡혔다(랑스-리옹 사례).
            # (2026-10-09 두 번째 수정 — 0.01 = 1칸으로 세면 무 3.00→2.95·승 2.60→2.55가 각각 5칸이 돼 사실상 이웃인 경기가 멀어진다.
            #  국내 호가 단위로 단계 수를 센다: odds_rank)
            dd = np.rint(np.abs(odds_rank(K) - odds_rank(K[qi]))).sum(axis=1)
    dd = np.where(np.isnan(dd), 1e9, dd)

    r = ix["G"].iloc[qi]
    lim = MAX_TICK if legacy else MAX_STEPS

    def widen(base, start):
        """start칸에서 시작해 표본이 1건이라도 나올 때까지 넓힌다(= 가장 가까운 경기의 칸 수). (결과, 쓴 칸 수) — MAX_TICK 안에 없으면 start칸의 빈 결과."""
        d = dd[base]
        k = max(start, int(d.min())) if d.size else None
        if k is None or k > lim:
            return _pick(ix, qi, base & (dd <= start), legacy=legacy), start
        return _pick(ix, qi, base & (dd <= k), legacy=legacy), k

    def nxt(base, k):
        """더 넓힌 미리보기 — 표본이 실제로 늘어나는(다른 표본이 처음 더해지는) 폭. 폭만 넓어지고 표본이 그대로인 칸은 건너뛴다
        (예: ±2칸 1건 → ±3칸 1건이면 ±4칸까지)."""
        d = dd[base & (dd > k)]
        if not d.size or int(d.min()) > lim:
            return None
        j = int(d.min())
        return {"tol": j / 100, "area": _pick(ix, qi, base & (dd <= j), prev=base & (dd <= k), legacy=legacy)}

    same_res, same_k = widen(pool & same, START_TICK)
    other_res, other_k = widen(pool & ~same, START_TICK)
    same_res["next"] = nxt(pool & same, same_k)
    other_res["next"] = nxt(pool & ~same, other_k)
    init = None
    if final:                                       # 배변 표본 — 이 경기의 초기 값(화면이 '1.71(0.04▼)'처럼 초기 대비 변화를 붙인다)
        init = {"A": [None if np.isnan(x) else float(x) for x in ix0["A"][qi]],
                "K": [None if np.isnan(x) else float(x) for x in ix0["K"][qi]],
                "kh": _f(ix0["H"][qi][0]), "khw": _f(ix0["H"][qi][1]), "khd": _f(ix0["H"][qi][2]), "khl": _f(ix0["H"][qi][3])}
    return {"ready": True,
            "mode": "books" if use_books else "kr",
            "game": {"init": init, "A": [None if np.isnan(x) else float(x) for x in A[qi]], "K": [float(x) for x in K[qi]], "n_books": int(ix["nb"][qi]),
                     "kh": _f(ix["H"][qi][0]), "khw": _f(ix["H"][qi][1]), "khd": _f(ix["H"][qi][2]), "khl": _f(ix["H"][qi][3]), "lg": _LG_LABEL.get(code, code)},
            "same": same_res, "other": other_res, "predict": predict_kr(ix, qi, same, day),
            "tol": {"same": same_k / 100, "other": other_k / 100},
            "ticks": {"same": same_k, "other": other_k},
            "start": START_TICK, "phase": "final" if final else "init",
            "dist": "max" if legacy else "sum"}
