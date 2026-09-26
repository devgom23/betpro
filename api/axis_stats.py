"""플축·정축 실측 통계 — 결과가 쌓이면 스스로 다시 잰다 (2026-09-21 사용자 지정).

화면(web/src/utils/sampleDirection.js axisVerdict)이 뱃지를 붙이는 조건과 **똑같은 조건**으로
6대리그 전 경기를 '그 경기 날짜 이전 기록만으로' 다시 세서 등급별 적중률을 낸다.

  ① 표본 7개 섹션 '이 경기 방향 · 통합' 카운트 — engine.get_samples_fast와 같은 매칭
     (같은 배당 키, 6대리그 전체 풀). 같은 날 경기는 서로의 표본에 넣지 않는다.
     ⚠ engine.py는 한 글자도 안 건드린다 — 매칭 규칙만 옮겨 왔다.
  ② 자동 방향성 t = 경기당 흐름 × √n ÷ 1.585 → 레드(t≤−1)/블루(t≥1) 개수
  ③ 배당신호(정역반전·국≠해·해외접전), 최근 5시즌 전적, 시즌폼, 순위
  ④ 배당 모델 — 국초·해초·해배 승 확률 + 정배 홈 여부로 '배당만 보면 정배가 이길 확률'을
     로지스틱 회귀로 맞춘다. 화면은 이 계수로 경기별 기대치를 내고 등급 몫을 얹는다(A안).

결과는 data/master/axis_stats.json 한 파일. 결과(RT)가 바뀐 걸 감지하면(signature) 뒤에서
다시 계산한다 — 6대리그 약 3.6만 경기에 수 초.
"""
import json
import math
import os
import threading
import time
from collections import defaultdict
from datetime import date

import numpy as np
import pandas as pd

import betpro_paths as PATHS
import data_access as DATA

VERSION = 2   # 2: 표본 섹션 7개→5개(2026-09-26, 국·해 승+무+패 제외)
SECTIONS = ("fav", "pl", "ffav", "k_wl", "f_wl")
NSEC = len(SECTIONS)
P3_MIN = 4   # 예전 7개 중 5 → 5개 중 4(실측: 3으로 두면 P3 69.0% n=261로 흐려짐)
B_MIN = 4    # 예전 7개 중 6 → 5개 중 4(5로 두면 n=108로 줄고 앞시즌 68%)
FLOW_SD = 1.585
LATE_SEASONS = 6          # '최근 N시즌' 확인 구간
H2H_SEASONS = 5           # 전적은 이번 시즌 포함 최근 5시즌
H2H_BASE, H2H_K = 1.363, 5

TIER_TEXT = {
    "P1": "5레드 + 배당신호",
    "P3": "4레드↑ + 배당신호 + 전적 역배편 + 폼·순위 정배편 아님",
    "P2": "5레드 + 국내 정배배당 2.1 초과 + 전적 정배편 아님",
    "A": "정배배당 1.15↓ + 블루5 + 전적·순위·폼 전부 정배편",
    "B": "정배배당 1.20↓ + 블루4↑ + 전적·순위 정배편",
    "RED7": "5레드인데 플축 조건 없음",
}
MODEL_FEATURES = ("m_k", "m_f", "m_fe", "has_fe", "fav_home")

_LOCK = threading.Lock()
_STATE = {"running": False, "error": None}


def _path() -> str:
    return os.path.join(PATHS.get_master_dir(), "axis_stats.json")


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or f <= 0:
        return None
    return round(f, 2)


def _parse_date(dt):
    s = str(dt)
    try:
        return date(2000 + int(s[0:2]), int(s[3:5]), int(s[6:8]))
    except ValueError:
        return None


def _fav_home(w, l):
    """정배가 홈인가 — 둘 다 있고 다를 때만(동률은 정배 없음 = None). 화면 favHome과 같다."""
    if w is None or l is None or w == l:
        return None
    return w < l


def _pool_keys(g):
    kw, kd, kl, fw, fd, fl = g["KW"], g["KD"], g["KL"], g["FW"], g["FD"], g["FL"]
    k = {"K-W": kw, "K-L": kl, "F-W": fw, "F-L": fl,
         "K-WL": (kw, kl) if kw and kl else None,
         "F-WL": (fw, fl) if fw and fl else None,
         "K-WDL": (kw, kd, kl) if kw and kd and kl else None,
         "F-WDL": (fw, fd, fl) if fw and fd and fl else None,
         "K-PL": None}
    if kw and kl and kw != kl:
        hd = kw > kl
        pl = g["KHW"] if hd else g["KHL"]
        k["K-PL"] = (hd, pl) if pl else None
    return k


def _self_query(g, keys, sec):
    """섹션의 '이 경기 방향' 로직 코드와 찾는 키 — main._direction_samples와 같은 규칙."""
    kw, kl, fw, fl = g["KW"], g["KL"], g["FW"], g["FL"]
    if sec == "fav":
        if not (kw and kl and kw != kl):
            return None
        code = "K-W" if kw < kl else "K-L"
    elif sec == "ffav":
        if not (fw and fl and fw != fl):
            return None
        code = "F-W" if fw < fl else "F-L"
    elif sec == "pl":
        if not (kw and kl and kw != kl):
            return None
        code = "K-PL"
    else:
        code = {"k_wl": "K-WL", "f_wl": "F-WL", "k_wdl": "K-WDL", "f_wdl": "F-WDL"}[sec]
    key = keys[code]
    return None if key is None else (code, key)


def _load_rows(db):
    rows = []
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df_ev(db, code)
        if df.empty:
            continue
        for rec in df.to_dict("records"):
            d = _parse_date(rec.get("DT"))
            if d is None:
                continue
            g = {c: _num(rec.get(c)) for c in ("KW", "KD", "KL", "KHW", "KHL", "FW", "FD", "FL",
                                                "EKW", "EKL", "EFW", "EFD", "EFL")}
            for c in ("HTF", "ATF", "HP", "AP", "HS", "AS"):
                v = rec.get(c)
                try:
                    g[c] = None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
                except (TypeError, ValueError):
                    g[c] = None
            rt = _num(rec.get("RT"))
            g.update({"L": code, "S": str(rec.get("S")), "HT": str(rec.get("HT", "")).strip(),
                      "AT": str(rec.get("AT", "")).strip(), "date": d,
                      "RT": int(rt) if rt in (1.0, 2.0, 3.0, 4.0) else None})
            rows.append(g)
    rows.sort(key=lambda g: g["date"])
    return rows


def signature(db) -> str:
    """결과가 바뀌었는지 가늠하는 값 — 리그별 (경기 수, 결과 있는 경기 수, RT 합)."""
    parts = []
    for code in PATHS.LEAGUES:
        df = DATA.load_league_df(db, code)
        if df.empty or "RT" not in df.columns:
            parts.append(f"{code}:0")
            continue
        rt = pd.to_numeric(df["RT"], errors="coerce")
        parts.append(f"{code}:{len(df)}:{int(rt.notna().sum())}:{int(rt.fillna(0).sum())}")
    return "|".join(parts)


def _features(rows):
    """경기마다 뱃지 조건 재료를 만든다(전부 그 경기 이전 기준)."""
    by_date = defaultdict(list)
    for i, g in enumerate(rows):
        by_date[g["date"]].append(i)
    keys = [_pool_keys(g) for g in rows]
    pool = defaultdict(lambda: [0, 0, 0, 0])
    h2h = defaultdict(list)     # frozenset(팀쌍) → [(시즌번호, 홈팀, 홈득점, 원정득점)]
    out = [None] * len(rows)
    for d in sorted(by_date):
        idxs = by_date[d]
        for i in idxs:
            g = rows[i]
            nred = nblue = 0
            for sec in SECTIONS:
                q = _self_query(g, keys[i], sec)
                vals = pool.get(q) if q else None
                n = sum(vals) if vals else 0
                if n <= 0:
                    continue
                flow = (vals[0] * 2 + vals[1] - vals[2] - vals[3] * 2) / n
                t = flow * math.sqrt(n) / FLOW_SD
                nred += t <= -1
                nblue += t >= 1
            si = int(g["S"][:2]) if g["S"][:2].isdigit() else None
            pts = cnt = 0
            for (ms, mh, hs, as_) in h2h[frozenset((g["HT"], g["AT"]))]:
                if si is None or not (si - (H2H_SEASONS - 1) <= ms <= si):
                    continue
                mine, theirs = (hs, as_) if mh == g["HT"] else (as_, hs)
                pts += 3 if mine > theirs else 1 if mine == theirs else 0
                cnt += 1
            out[i] = {"nred": nred, "nblue": nblue,
                      "h2h_home": (pts + H2H_BASE * H2H_K) / (cnt + H2H_K) - H2H_BASE}
        for i in idxs:
            g = rows[i]
            if g["RT"] is not None:
                for code, key in keys[i].items():
                    if key is not None:
                        pool[(code, key)][g["RT"] - 1] += 1
            if g["HS"] is not None and g["AS"] is not None and g["S"][:2].isdigit():
                h2h[frozenset((g["HT"], g["AT"]))].append((int(g["S"][:2]), g["HT"], g["HS"], g["AS"]))
    return out


def _implied(w, dr, l):
    if not (w and dr and l):
        return None, None
    inv = 1 / w + 1 / dr + 1 / l
    return (1 / w) / inv, (1 / l) / inv


def _logit(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def model_row(g):
    """배당 모델 입력 — 화면 axisExpected와 같은 식. 정배 = 국내 초기(KW<KL이면 홈)."""
    fh = g["KW"] < g["KL"]
    pk = _implied(g["KW"], g["KD"], g["KL"])
    pf = _implied(g["FW"], g["FD"], g["FL"])
    pe = _implied(g["EFW"], g["EFD"], g["EFL"])
    side = 0 if fh else 1
    p_k = pk[side]
    p_f = pf[side] if pf[0] is not None else p_k
    p_fe = pe[side] if pe[0] is not None else p_f
    return [_logit(p_k), _logit(p_f), _logit(p_fe), 1.0 if pe[0] is not None else 0.0, 1.0 if fh else 0.0]


def _fit_logit(X, y, iters=50):
    X = np.column_stack([np.ones(len(X)), X])
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ b))
        w = p * (1 - p)
        h = X.T @ (X * w[:, None]) + 1e-6 * np.eye(X.shape[1])
        step = np.linalg.solve(h, X.T @ (y - p))
        b += step
        if np.abs(step).max() < 1e-9:
            break
    return b


def _side3(x, hi, lo):
    return "정배" if x >= hi else "역배" if x <= lo else "보합"


def compute(db=None) -> dict:
    db = db or PATHS.get_master_db()
    t0 = time.time()
    sig = signature(db)
    rows = _load_rows(db)
    feats = _features(rows)

    recs = []
    for g, f in zip(rows, feats):
        if g["RT"] is None or g["KW"] is None or g["KL"] is None or g["KD"] is None:
            continue
        fh = g["KW"] < g["KL"]
        sg = 1 if fh else -1
        kf = _fav_home(g["KW"], g["KL"])
        flip = any(a is not None and b is not None and a != b for a, b in (
            (kf, _fav_home(g["EKW"], g["EKL"])),
            (_fav_home(g["FW"], g["FL"]), _fav_home(g["EFW"], g["EFL"]))))
        ff = _fav_home(g["FW"], g["FL"])
        split = kf is not None and ff is not None and kf != ff
        fw, fl = g["EFW"] or g["FW"], g["EFL"] or g["FL"]
        close = fw is not None and fl is not None and min(fw, fl) >= 2.5
        form = (g["HTF"] - g["ATF"]) * sg if g["HTF"] is not None and g["ATF"] is not None else 0.0
        rank = (g["AP"] - g["HP"]) * sg / 10 if g["HP"] is not None and g["AP"] is not None else 0.0
        recs.append({
            "S": g["S"], "L": g["L"], "y": 1 if g["RT"] in (1, 2) else 0,
            "jung": min(g["KW"], g["KL"]),
            "pl_odds": g["KHW"] if g["KW"] > g["KL"] else g["KHL"],
            "nred": f["nred"], "nblue": f["nblue"], "cue": flip or split or close,
            "h2h": _side3(f["h2h_home"] * sg, 0.3, -0.3),
            "form": _side3(form, 0.5, -0.2), "rank": _side3(rank, 0.8, -0.2),
            "x": model_row(g),
        })
    d = pd.DataFrame(recs)
    X = np.array(d["x"].tolist())
    y = d["y"].to_numpy(float)
    coef = _fit_logit(X, y)
    d["pm"] = 1 / (1 + np.exp(-(np.column_stack([np.ones(len(X)), X]) @ coef)))

    seasons = sorted(d["S"].unique())
    late_set = set(seasons[-LATE_SEASONS:])
    d["late"] = d["S"].isin(late_set)

    p1 = (d.nred == NSEC) & d.cue
    p3 = (d.nred >= P3_MIN) & d.cue & (d.h2h == "역배") & (d.form != "정배") & (d["rank"] != "정배")
    p2 = (d.nred == NSEC) & (d.jung > 2.1) & (d.h2h != "정배")
    ja = (d.jung <= 1.15) & (d.nblue == NSEC) & (d.h2h == "정배") & (d["rank"] == "정배") & (d.form == "정배")
    jb = (d.jung <= 1.2) & (d.nblue >= B_MIN) & (d.h2h == "정배") & (d["rank"] == "정배") & ~ja
    red7 = (d.nred == NSEC) & ~(p1 | p2 | p3)

    def tier(m, side):
        sub = d[m]
        n = len(sub)
        if n == 0:
            return {"n": 0}
        hit = sub.y if side == "정" else 1 - sub.y
        exp = sub.pm if side == "정" else 1 - sub.pm
        od = sub.jung if side == "정" else sub.pl_odds
        ok = od.notna()
        roi = float(np.where(hit[ok] == 1, od[ok], 0).sum() / ok.sum()) if ok.sum() else None
        early, late = hit[~sub.late], hit[sub.late]
        pct = lambda s: round(float(s.mean()) * 100, 2) if len(s) else None  # noqa: E731
        rate = float(hit.mean()) * 100
        expv = float(exp.mean()) * 100
        return {"n": n, "rate": round(rate, 2), "exp": round(expv, 2), "uplift": round(rate - expv, 2),
                "early": pct(early), "early_n": int(len(early)), "late": pct(late), "late_n": int(len(late)),
                "roi": round(roi, 3) if roi is not None else None,
                "per_season": round(len(late) / LATE_SEASONS, 1)}

    tiers = {k: dict(tier(m, s), text=TIER_TEXT[k], side=s) for k, m, s in (
        ("P1", p1, "플"), ("P3", p3, "플"), ("P2", p2, "플"), ("A", ja, "정"), ("B", jb, "정"),
        ("RED7", red7, "플"))}
    tiers["PL_ANY"] = dict(tier(p1 | p2 | p3, "플"), text="플축 P1·P2·P3 중 하나라도", side="플")
    return {
        "version": VERSION,
        "computed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_sec": round(time.time() - t0, 1),
        "signature": sig,
        "games": int(len(d)),
        "seasons": {"first": seasons[0], "last": seasons[-1],
                    "early": f"{seasons[0]}~{seasons[-LATE_SEASONS - 1]}" if len(seasons) > LATE_SEASONS else None,
                    "late": f"{seasons[-LATE_SEASONS]}~{seasons[-1]}"},
        "model": {"features": list(MODEL_FEATURES), "coef": [round(float(c), 6) for c in coef]},
        "tiers": tiers,
    }


def _save(stats):
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _path())


def load():
    try:
        with open(_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _run(db):
    try:
        _save(compute(db))
        _STATE["error"] = None
    except Exception as e:   # noqa: BLE001 — 뒤에서 도는 작업이라 실패를 상태로 남긴다
        _STATE["error"] = f"{type(e).__name__}: {e}"
    finally:
        with _LOCK:
            _STATE["running"] = False


def start(db=None) -> bool:
    """뒤에서 다시 잰다. 이미 돌고 있으면 False."""
    db = db or PATHS.get_master_db()
    with _LOCK:
        if _STATE["running"]:
            return False
        _STATE["running"] = True
    threading.Thread(target=_run, args=(db,), name="axis-stats", daemon=True).start()
    return True


def get(db=None) -> dict:
    """저장된 통계 + 상태. 결과가 바뀌었으면(또는 아직 없으면) 뒤에서 다시 재기 시작한다."""
    db = db or PATHS.get_master_db()
    stats = load()
    stale = stats is None or stats.get("version") != VERSION or stats.get("signature") != signature(db)
    if stale:
        start(db)
    return {"stats": stats, "stale": stale, "running": _STATE["running"], "error": _STATE["error"]}
