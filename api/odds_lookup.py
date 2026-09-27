"""통합DB '배당 조회'(2026-09-27 사용자 지정 — 목업 web/public/mockups/totaldb_mock.html).

넣은 배당(국배·국핸디·해배, 빈칸은 조건 제외)과 비슷한 과거 경기를 공식 6대리그 + 내 데이터 리그(K1·K2 등)에서
찾아, 결과(RT: 핸승·핸무·무·역)가 어떻게 났는지 보여준다. 6대리그가 아닌 경기도 배당만 있으면 쓸 수 있게 하는 게 목적.

- '칸' = 소수 둘째 자리 한 눈금(0.01). tick칸 안이면 같은 배당으로 본다(표본 섹션과 같은 말).
- 배당 시점: 초기(KW…) / 최신(EKW…, 없으면 초기).
- 국핸디는 기준점(KH)이 같은 경기만. KHW/KHL은 홈·원정 기준(저장값 그대로).
- 뒤집기(flip): 승·패를 바꿔(핸디는 기준점 부호도) 원정 정배 경기까지 같이 찾는다. RT는 정배 기준이라 합쳐도 뜻이 같다.
- 결과 난 경기(RT 1~4)만 센다.
리그 표는 DATA.load_league_df(캐시)로 읽고, 합친 배열은 DB가 바뀔 때만 다시 만든다.
"""
import threading

import numpy as np
import pandas as pd

import data_access as DATA

COLS = ["KW", "KD", "KL", "KH", "KHW", "KHD", "KHL", "FW", "FD", "FL",
        "EKW", "EKD", "EKL", "EKHW", "EKHD", "EKHL", "EFW", "EFD", "EFL"]
MAX_ROWS = 300

_CACHE: dict = {}
_LOCK = threading.Lock()


def _build(sources):
    frames = []
    for db, scope, code, label in sources:
        d = DATA.load_league_df(db, code)
        if d.empty or "RT" not in d.columns:
            continue
        keep = [c for c in ["S", "R", "No", "HT", "AT", "DT", "TM", "HS", "AS", "RT"] + COLS if c in d.columns]
        d = d[keep].copy()
        d["code"], d["scope"], d["lg"] = code, scope, label
        frames.append(d)
    if not frames:
        return None
    G = pd.concat(frames, ignore_index=True)
    for c in COLS + ["HS", "AS", "RT"]:
        G[c] = pd.to_numeric(G[c], errors="coerce") if c in G.columns else np.nan
    # 시즌 순번(리그 안에서) — 최근 N시즌 거르기용
    G["s_rank"] = 0
    for code, sub in G.groupby("code"):
        order = {s: i for i, s in enumerate(sorted(sub["S"].astype(str).unique(), reverse=True))}
        G.loc[sub.index, "s_rank"] = sub["S"].astype(str).map(order)
    G["date"] = pd.to_datetime("20" + G["DT"].astype(str).str[:8], format="%Y-%m-%d", errors="coerce")
    return G


def _index(sources):
    tok = tuple((db, code, DATA.tables_token(db, (code,))) for db, _, code, _ in sources)
    key = tuple((db, code) for db, _, code, _ in sources)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit and hit[0] == tok:
            return hit[1]
        G = _build(sources)
        _CACHE[key] = (tok, G)
        return G


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 1.0 else None


def _vals(G, phase, base):
    """시점별 값 — 최신이면 E* 칸, 없으면 초기 칸으로 채운다."""
    init = G[base].to_numpy(float)
    if phase == "final" and ("E" + base) in G.columns:
        fin = G["E" + base].to_numpy(float)
        return np.where(np.isnan(fin), init, fin)
    return init


def _match(G, q, phase, tick, flip):
    tol = tick / 100 + 1e-9
    m = np.ones(len(G), dtype=bool)
    used = False
    home_away = {"KW": "KL", "KL": "KW", "FW": "FL", "FL": "FW", "KHW": "KHL", "KHL": "KHW"}
    for base in ("KW", "KD", "KL", "FW", "FD", "FL", "KHW", "KHD", "KHL"):
        v = q.get(base)
        if v is None:
            continue
        used = True
        col = home_away.get(base, base) if flip else base
        arr = _vals(G, phase, col)
        with np.errstate(invalid="ignore"):
            m &= np.abs(arr - v) <= tol
    if any(q.get(b) is not None for b in ("KHW", "KHD", "KHL")) and q.get("KH") is not None:
        kh = G["KH"].to_numpy(float)
        m &= np.isclose(kh, -q["KH"] if flip else q["KH"])
    return m, used


def lookup(sources, q, phase="init", tick=2, seasons=0, flip=False, sort="near"):
    G = _index(sources)
    if G is None:
        return {"ready": False, "reason": "조회할 리그 데이터가 없습니다"}
    q = {k: _num(v) for k, v in q.items() if k != "KH"} | {"KH": None if q.get("KH") in (None, "") else float(q["KH"])}
    done = np.isin(G["RT"].to_numpy(float), (1, 2, 3, 4))
    if seasons:
        done &= G["s_rank"].to_numpy() < seasons
    m1, used = _match(G, q, phase, tick, False)
    if not used:
        return {"ready": False, "reason": "배당을 하나 이상 넣어 주세요"}
    mask = done & m1
    if flip:
        m2, _ = _match(G, q, phase, tick, True)
        mask |= done & m2
    sub = G[mask].copy()
    rt = sub["RT"].astype(int).to_numpy()
    n = len(sub)
    cnt = [int((rt == k).sum()) for k in (1, 2, 3, 4)]
    pct = (lambda a: round(a / n * 100, 2) if n else None)

    # 비교용 — 같은 정배배당대(±0.05)의 평소 정 단통(선택 리그·시즌 전체)
    base = None
    fav_q = min([x for x in (q.get("KW"), q.get("KL")) if x is not None], default=None)
    if fav_q is not None:
        kw, kl = _vals(G, phase, "KW"), _vals(G, phase, "KL")
        with np.errstate(invalid="ignore"):
            fav = np.fmin(kw, kl)
            bm = done & (np.abs(fav - fav_q) <= 0.05 + 1e-9)
        brt = G["RT"].to_numpy(float)[bm]
        if len(brt):
            base = {"lo": round(fav_q - 0.05, 2), "hi": round(fav_q + 0.05, 2), "n": int(len(brt)),
                    "jung": round(float(np.isin(brt, (1, 2)).mean()) * 100, 2)}

    def group(keys):
        out = []
        for k, g in sub.groupby(keys, sort=False):
            r = g["RT"].astype(int).to_numpy()
            out.append({"key": k, "n": int(len(g)), "cnt": [int((r == x).sum()) for x in (1, 2, 3, 4)],
                        "jung": round(float(np.isin(r, (1, 2)).mean()) * 100, 2)})
        return sorted(out, key=lambda x: -x["n"])

    by_lg = group("lg")
    recent = sub["s_rank"].to_numpy() < 3
    by_season = []
    for lab, mk in (("최근 3시즌", recent), ("그 이전", ~recent)):
        r = rt[mk]
        by_season.append({"key": lab, "n": int(len(r)), "jung": round(float(np.isin(r, (1, 2)).mean()) * 100, 2) if len(r) else None})

    # 가까운 순: 넣은 값과의 차이 합(작을수록 가까움)
    dist = np.zeros(n)
    for b in ("KW", "KD", "KL", "FW", "FD", "FL", "KHW", "KHD", "KHL"):
        v = q.get(b)
        if v is None:
            continue
        arr = _vals(sub, phase, b)
        dist += np.where(np.isnan(arr), 0, np.minimum(np.abs(arr - v), 1))
    sub["_d"] = dist
    if sort == "recent":
        sub = sub.sort_values("date", ascending=False)
    elif sort == "result":
        sub = sub.sort_values(["RT", "_d"])
    else:
        sub = sub.sort_values(["_d", "date"], ascending=[True, False])

    def f(v):
        return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)

    rows = []
    for _, r in sub.head(MAX_ROWS).iterrows():
        rows.append({
            "code": r["code"], "scope": r["scope"], "lg": r["lg"],
            "S": str(r["S"]), "R": str(r["R"]), "No": f(r.get("No")),
            "HT": r["HT"], "AT": r["AT"], "DT": str(r["DT"]), "TM": f(r.get("TM")),
            "HS": f(r["HS"]), "AS": f(r["AS"]), "RT": int(r["RT"]),
            "K": [f(_v) for _v in (_pick(r, phase, "KW"), _pick(r, phase, "KD"), _pick(r, phase, "KL"))],
            "KH": f(r.get("KH")),
            "KHx": [f(_v) for _v in (_pick(r, phase, "KHW"), _pick(r, phase, "KHD"), _pick(r, phase, "KHL"))],
            "F": [f(_v) for _v in (_pick(r, phase, "FW"), _pick(r, phase, "FD"), _pick(r, phase, "FL"))],
        })
    return {"ready": True, "n": n, "cnt": cnt, "pct": [pct(c) for c in cnt],
            "jung": pct(cnt[0] + cnt[1]), "pl": pct(cnt[2] + cnt[3]),
            "jungmu": pct(cnt[0] + cnt[1] + cnt[2]), "plmu": pct(cnt[1] + cnt[2] + cnt[3]),
            "base": base, "by_league": by_lg, "by_season": by_season, "rows": rows, "shown": len(rows)}


def _pick(r, phase, base):
    v = r.get(base)
    if phase == "final":
        e = r.get("E" + base)
        if e is not None and not (isinstance(e, float) and np.isnan(e)):
            return e
    return v


def search_games(sources, text, limit=20):
    """'경기에서 불러오기' — 팀 이름이 들어간 최근 경기(결과 전 포함) 목록과 그 배당."""
    G = _index(sources)
    text = str(text or "").strip()
    if G is None or not text:
        return []
    m = G["HT"].astype(str).str.contains(text, regex=False) | G["AT"].astype(str).str.contains(text, regex=False)
    sub = G[m].sort_values("date", ascending=False).head(limit)

    def f(v):
        return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)

    return [{"lg": r["lg"], "code": r["code"], "S": str(r["S"]), "R": str(r["R"]), "HT": r["HT"], "AT": r["AT"],
             "DT": str(r["DT"]), "done": not pd.isna(r["RT"]),
             "init": {k: f(r.get(k)) for k in ("KW", "KD", "KL", "KH", "KHW", "KHD", "KHL", "FW", "FD", "FL")},
             "final": {k: f(_pick(r, "final", k)) for k in ("KW", "KD", "KL", "KHW", "KHD", "KHL", "FW", "FD", "FL")}}
            for _, r in sub.iterrows()]
