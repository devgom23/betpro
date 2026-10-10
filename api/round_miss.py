"""라운드별 판정 빗나감 — 시즌분석의 '세팅값이 얼마나 틀리는가' 표(2026-10-10 사용자 지정).

사용자가 엑셀로 손으로 그리던 표("라운드 마다 속성")를 자동화한 것이다.
  세팅값 = 국배·해배 판정(레드/블루)  — 정 쪽(블루) 또는 플 쪽(레드)
  빗나감 = 세팅과 결과가 반대로 나온 경기
    정배→플핸 : 세팅 정(블루)인데 결과가 무·역(RT 3·4)
    플핸→정배 : 세팅 플(레드)인데 결과가 핸승·핸무(RT 1·2)

[판정을 어떻게 다시 만드는가]
  저장된 26지표(표본 건수)는 DB 전체로 센 값이라 그 경기보다 '나중' 경기까지 섞여 있다. 그걸 쓰면
  지난 시즌 판정이 미래를 보고 낸 것이 되어 '얼마나 틀리나'를 잴 수 없다. 그래서 이 모듈은 건수를
  **그 라운드 첫 경기 날짜보다 앞선 경기만으로** 다시 센다(한 라운드의 경기는 모두 같은 정보를 쓴다).
  판정 규칙은 화면(verdictCalc.js)과 같다 — 배당이 같은 과거 경기 4칸(핸승·핸무·무·역) 건수를
  줄 순서·표본 수로 가중해 평균내고, 핸승(hs)이 역(yk) 이하면 플 쪽(플핸무), 아니면 정 쪽(정무).
  '국배 세팅값'은 통)국 줄이 의견을 내면 그것, 없으면 리)국 줄. 해배는 통)해 → 리)해.
  배변 판정은 정배 쪽 배당이 실제로 움직인 시장만 배변 배당으로, 안 움직였으면 초기 값으로 센다
  (marketMoved와 같은 규칙).
  engine.py는 건드리지 않는다 — 같은 "배당이 같은 경기" 규칙(소수 둘째 자리 일치)을 numpy로 따로 센다.
  저장값(E_ 컬럼)과 같은 답이 나오는지는 verify()로 대조한다(asof=False, 시간 제한 없음).

[범위] 표시는 20-21 시즌부터(MIN_SEASON). 표본 풀은 그 전 시즌(09-10~)까지 전부 쓴다.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

import betpro_paths as PATHS
import data_access as DATA
import kr_game_no as KNO

MIN_SEASON = "20-21"
BIG = 100000              # 날짜(일수)를 키 뒤에 붙이는 자릿수 — 키*BIG + 날짜
SHRINK = 10               # verdictCalc.js SAMPLE_SHRINK
WEAK_N = 15               # opinionLabel — 표본 15건 미만이면 (약)
WEAK_MARGIN = 10          # 핸승%와 역%의 차이가 10%p 미만이면 (약)
WD = "월화수목금토일"

ODDS_INIT = ["FW", "FD", "FL", "KW", "KD", "KL", "KHW", "KHL"]
ODDS_FIN = ["EFW", "EFD", "EFL", "EKW", "EKD", "EKL", "EKHW", "EKHL"]
BASE_OF = dict(zip(ODDS_FIN, ODDS_INIT))
NEED = ["S", "R", "DT", "TM", "HT", "AT", "HS", "AS", "RT"] + ODDS_INIT + ODDS_FIN

CODES = ["K-W", "K-L", "K-PL", "TK-W", "TK-L", "TK-PL", "F-W", "F-L", "TF-W", "TF-L"]


def _round_no(v) -> int:
    return int(re.sub(r"\D", "", str(v)) or 0)


def _pos(s) -> np.ndarray:
    """양수 배당만 float, 나머지는 NaN."""
    v = pd.to_numeric(s, errors="coerce").to_numpy(float)
    return np.where(np.isfinite(v) & (v > 0), v, np.nan)


def _cents(v: np.ndarray) -> np.ndarray:
    """소수 둘째 자리 정수(배당 1.27 → 127). 없으면 -1. engine의 round(2) 같음 비교와 같다."""
    out = np.full(len(v), -1, np.int64)
    ok = np.isfinite(v)
    out[ok] = np.rint(v[ok] * 100).astype(np.int64)
    return out


def _frame(db: str) -> pd.DataFrame:
    """6대리그 전부(표본 풀 + 판정 대상)를 한 표로 — 날짜·라운드 번호·배당(원본 실수)."""
    parts = []
    for li, code in enumerate(PATHS.LEAGUES):
        df = DATA.load_league_df(db, code)
        if df.empty:
            continue
        d = df[[c for c in NEED if c in df.columns]].copy()
        for c in NEED:
            if c not in d.columns:
                d[c] = np.nan
        d["lg"] = code
        d["li"] = li
        d["dd"] = DATA._ddong_columns(df)[0]        # 똥1·똥2… — 리그 표와 같은 계산(국내 초기배당 1.49 이하, 같은 라운드 안 낮은 순)
        d["ddo"] = np.where(d["dd"] != "", np.fmin(pd.to_numeric(df["KW"], errors="coerce"), pd.to_numeric(df["KL"], errors="coerce")), np.nan)   # 그 똥 경기의 정배배당
        parts.append(d)
    t = pd.concat(parts, ignore_index=True)
    s = t["DT"].astype(str)
    t["date"] = pd.to_datetime("20" + s.str[0:2] + "-" + s.str[3:5] + "-" + s.str[6:8], errors="coerce")
    t = t[t["date"].notna()].reset_index(drop=True)
    t["ord"] = ((t["date"] - pd.Timestamp("2000-01-01")).dt.days).astype(np.int64)
    t["r"] = t["R"].map(_round_no)
    t["S"] = t["S"].astype(str)
    rt = pd.to_numeric(t["RT"], errors="coerce")
    t["rt"] = np.where(rt.isin([1, 2, 3, 4]), rt, 0).astype(np.int64)
    t["cancel"] = rt == 5
    t["hour"] = (pd.to_numeric(t["TM"], errors="coerce").fillna(1500) // 100).astype(int)
    # 라운드 첫 경기 날짜 — 그 라운드 경기가 모두 같은 '이전 정보'를 쓴다(취소 경기는 날짜가 의미 없어 뺀다).
    first = t[~t["cancel"]].groupby(["lg", "S", "r"])["ord"].min().rename("rstart")
    t = t.join(first, on=["lg", "S", "r"])
    t["rstart"] = t["rstart"].fillna(t["ord"]).astype(np.int64)
    return t


def _asof_counts(key_pool, ord_pool, rt_pool, key_q, ord_q, strict=True) -> np.ndarray:
    """키가 같은 풀 경기 중 날짜가 ord_q보다 앞선 것의 결과별(RT 1~4) 건수 — 질의 n행 × 4."""
    ok = (key_pool >= 0) & (rt_pool > 0)
    kp, op, rp = key_pool[ok], ord_pool[ok], rt_pool[ok]
    comp = kp * BIG + op
    order = np.argsort(comp, kind="stable")
    comp_s, r_s = comp[order], rp[order]
    cum = np.zeros((len(r_s) + 1, 4), np.int64)
    for k in range(4):
        cum[1:, k] = np.cumsum(r_s == k + 1)
    base = np.where(key_q >= 0, key_q, 0) * BIG
    lo = np.searchsorted(comp_s, base, "left")
    hi = np.searchsorted(comp_s, base + ord_q, "left" if strict else "right")
    out = cum[hi] - cum[lo]
    out[key_q < 0] = 0
    return out


def _keys(c: dict) -> dict:
    """한 시점(초기/배변)의 배당(cents)에서 코드별 '같은 경기' 키를 만든다 — 없으면 -1."""
    kw, kl, khw, khl, fw, fl = c["KW"], c["KL"], c["KHW"], c["KHL"], c["FW"], c["FL"]
    kok = (kw > 0) & (kl > 0) & (kw != kl)
    home_dog = kw > kl
    pl = np.where(home_dog, khw, khl)
    k_pl = np.where(kok & (pl > 0), home_dog.astype(np.int64) * 1_000_000 + pl, -1)
    return {"W": {"K": kw, "F": fw}, "L": {"K": kl, "F": fl}, "PL": k_pl}


def _counts(t: pd.DataFrame, q_idx: np.ndarray, phase: str, asof: bool) -> dict:
    """코드 10개 × (질의 행 수 × 4) 건수. phase='init'|'final'."""
    init = {c: _cents(_pos(t[c])) for c in ODDS_INIT}
    fin = {BASE_OF[c]: _cents(_pos(t[c])) for c in ODDS_FIN}
    if phase == "init":
        pool_c = init
        qry_c = init
    else:                              # 풀은 배변배당만(없으면 NaN — shadow_pool), 질의 행은 없는 칸을 초기값으로(shadow_row)
        pool_c = fin
        qry_c = {c: np.where(fin[c] > 0, fin[c], init[c]) for c in ODDS_INIT}
    pk = _keys(pool_c)
    qk = _keys({c: v[q_idx] for c, v in qry_c.items()})
    ordv, rtv, li = t["ord"].to_numpy(), t["rt"].to_numpy(), t["li"].to_numpy()
    qord = (t["rstart"].to_numpy() if asof else np.full(len(t), BIG - 1, np.int64))[q_idx]
    qli = li[q_idx]
    out = {}
    for code in CODES:
        body = code.split("-")[1]                      # W / L / PL
        mk = "K" if "K" in code.split("-")[0] else "F"
        key_pool = pk["PL"] if body == "PL" else pk[body][mk]
        key_q = qk["PL"] if body == "PL" else qk[body][mk]
        if code.startswith("T"):                       # 통합 — 6대리그 전체 풀
            out[code] = _asof_counts(key_pool, ordv, rtv, key_q, qord, strict=asof)
        else:                                          # 개별 — 그 리그 풀(리그 번호를 키 앞에 붙여 섞이지 않게)
            sh = 10 ** 10
            kp2 = np.where(key_pool >= 0, key_pool + li * sh, -1)
            kq2 = np.where(key_q >= 0, key_q + qli * sh, -1)
            out[code] = _asof_counts(kp2, ordv, rtv, kq2, qord, strict=asof)
        if not asof:                                   # 대조용 — engine.get_samples_fast의 '자기 자신 1건 제외'와 같게
            r = rtv[q_idx]
            ix = np.where(r > 0, r - 1, 0)
            has = (r > 0) & (out[code][np.arange(len(q_idx)), ix] > 0)
            out[code][np.arange(len(q_idx))[has], ix[has]] -= 1
    return out


def _moved(t: pd.DataFrame, q_idx: np.ndarray, code: str) -> np.ndarray:
    """verdictCalc.js marketMoved — 그 코드 시장의 정배 쪽 배당이 초기→배변에서 달라졌나(모르면 True)."""
    g = lambda c: pd.to_numeric(t[c], errors="coerce").to_numpy(float)[q_idx]
    if code.endswith("PL"):
        w, l = g("KW"), g("KL")
        bad = ~np.isfinite(w) | ~np.isfinite(l) | (w == l)
        a = np.where(w > l, g("KHW"), g("KHL"))
        b = np.where(w > l, g("EKHW"), g("EKHL"))
    elif code.split("-")[0] in ("K", "TK"):
        w, l = g("KW"), g("KL")
        bad = ~np.isfinite(w) | ~np.isfinite(l) | (w == l)
        a = np.where(w < l, g("KW"), g("KL"))
        b = np.where(w < l, g("EKW"), g("EKL"))
    else:
        w, l = g("FW"), g("FL")
        bad = ~np.isfinite(w) | ~np.isfinite(l) | (w == l)
        a = np.where(w < l, g("FW"), g("FL"))
        b = np.where(w < l, g("EFW"), g("EFL"))
    return bad | ~np.isfinite(a) | ~np.isfinite(b) | (a != b)


def _cell(lines: list) -> tuple:
    """줄들(각 n×4 건수) → (정/플 쪽 +1/-1/0, 표본 합, 핸승%, 역%). verdictCalc.js weightedAnalysis + pickName."""
    n = lines[0].shape[0]
    acc = np.zeros((n, 4))
    wsum = np.zeros(n)
    total = np.zeros(n, np.int64)
    for i, v in enumerate(lines):
        t = v.sum(axis=1)
        total += t
        ok = t > 0
        w = np.where(ok, (i + 1) * (t / (t + SHRINK)), 0.0)
        wsum += w
        acc += np.where(ok[:, None], v / np.where(ok, t, 1)[:, None] * 100 * w[:, None], 0.0)
    has = wsum > 0
    pct = acc / np.where(has, wsum, 1)[:, None]
    side = np.where(has, np.where(pct[:, 0] <= pct[:, 3], -1, 1), 0)       # 핸승 ≤ 역 → 플핸무(플, -1)
    return side, total, pct[:, 0], pct[:, 3]


def settings(t: pd.DataFrame, q_idx: np.ndarray, phase: str, asof: bool = True) -> dict:
    """국배·해배 세팅값(정 +1 / 플 -1 / 없음 0) + 약 여부. phase='init'|'final'."""
    fin_any = np.zeros(len(q_idx), bool)
    if phase == "final":
        fin_any = np.any([_pos(t[c])[q_idx] > 0 for c in ODDS_FIN], axis=0)
    cnt_i = _counts(t, q_idx, "init", asof)
    cnt_f = _counts(t, q_idx, "final", asof) if phase == "final" else None

    def line(code):
        if phase == "init":
            return cnt_i[code]
        use = _moved(t, q_idx, code) & fin_any      # 배변 배당이 하나도 없는 경기는 초기 판정으로(CLAUDE.md 4-1)
        return np.where(use[:, None], cnt_f[code], cnt_i[code])

    g = lambda c: pd.to_numeric(t[c], errors="coerce").to_numpy(float)[q_idx]
    kw, kl, fw, fl = g("KW"), g("KL"), g("FW"), g("FL")
    kdir = np.where(np.isfinite(kw) & np.isfinite(kl) & (kw != kl), np.where(kw < kl, 1, 2), 0)   # 1=W 2=L 0=없음
    fdir = np.where(np.isfinite(fw) & np.isfinite(fl) & (fw != fl), np.where(fw < fl, 1, 2), 0)

    def cell(prefix, dirv, with_pl):
        a, b = line(f"{prefix}-W"), line(f"{prefix}-L")
        first = np.where((dirv == 1)[:, None], a, np.where((dirv == 2)[:, None], b, 0))
        lines = [first]
        if with_pl:
            lines.append(line(f"{prefix}-PL"))
        side, total, hs, yk = _cell(lines)
        # 방향이 없으면 첫 줄은 0건이라 가중치가 안 붙고 PL 줄만 남는다 — 단 PL 줄의 순번이 1→2로 달라지는데
        # 줄이 하나뿐이면 가중치 크기가 결과에 영향이 없다(화면은 줄을 걸러 내므로 순번이 0이 된다).
        return side, total, hs, yk

    lk = cell("K", kdir, True)
    tk = cell("TK", kdir, True)
    lf = cell("F", fdir, False)
    tf = cell("TF", fdir, False)

    def opinion(tong, lig):
        use_t = tong[0] != 0
        side = np.where(use_t, tong[0], lig[0])
        total = np.where(use_t, tong[1], lig[1])
        hs = np.where(use_t, tong[2], lig[2])
        yk = np.where(use_t, tong[3], lig[3])
        weak = (total < WEAK_N) | (np.abs(hs - yk) < WEAK_MARGIN)
        return side, weak

    k_side, k_weak = opinion(tk, lk)
    f_side, f_weak = opinion(tf, lf)

    # 시스템 판정(verdictCalc.js resolveOddsPhasePick + oddsPhaseSplit) — 통)해가 기본, 나머지 3칸(리)해·통)국·리)국)에
    # 의견이 있는데 전부 반대면 뒤집고, 국(통)국→리)국)과 해(통)해→리)해) 의견이 갈리면 엇갈림.
    # 엇갈림 경기는 해 쪽 방향으로 적중/보험/미적을 매기는 앱 규칙(phaseVerdict)을 그대로 따른다.
    n = len(q_idx)
    base = tf[0]
    other = np.stack([lf[0], tk[0], lk[0]], axis=1)
    has_o = other != 0
    agree = (has_o & (other == base[:, None])).sum(axis=1)
    flip = (base != 0) & has_o.any(axis=1) & (agree == 0)
    first = other[np.arange(n), np.argmax(has_o, axis=1)]
    resolved = np.where(flip, first, base)
    dom = np.where(tk[0] != 0, tk[0], lk[0])
    forr = np.where(tf[0] != 0, tf[0], lf[0])
    split = (base != 0) & (dom != 0) & (forr != 0) & (dom != forr)
    verdict = np.where(base == 0, 0, np.where(split, forr, resolved))
    return {"k": k_side, "kw": k_weak, "f": f_side, "fw": f_weak, "v": verdict, "vs": split,
            "raw": {"lk": lk, "tk": tk, "lf": lf, "tf": tf}}


def _wd_of(ord_: int, hour: int) -> str:
    d = pd.Timestamp("2000-01-01") + pd.Timedelta(days=int(ord_))
    if hour < 12:
        d -= pd.Timedelta(days=1)
    return WD[d.weekday()]


def build(db: str | None = None) -> pd.DataFrame:
    """20-21 시즌 이후 결과가 있는 경기마다 배변 국배·해배 세팅값(그 라운드 이전 경기만) 한 줄씩."""
    db = db or PATHS.get_master_db()
    t = _frame(db)
    q = np.where((t["S"] >= MIN_SEASON).to_numpy() & ~t["cancel"].to_numpy())[0]
    st = settings(t, q, "final", asof=True)
    sub = t.iloc[q]
    out = pd.DataFrame({
        "lg": sub["lg"].to_numpy(), "S": sub["S"].to_numpy(), "r": sub["r"].to_numpy(),
        "ord": sub["ord"].to_numpy(), "hour": sub["hour"].to_numpy(),
        "ht": sub["HT"].astype(str).str.strip().to_numpy(), "at": sub["AT"].astype(str).str.strip().to_numpy(),
        "hs": pd.to_numeric(sub["HS"], errors="coerce").to_numpy(),
        "as_": pd.to_numeric(sub["AS"], errors="coerce").to_numpy(),
        "rt": sub["rt"].to_numpy(), "dd": sub["dd"].fillna("").to_numpy(), "ddo": sub["ddo"].to_numpy(),
        "k": st["k"], "kw": st["kw"], "f": st["f"], "fw": st["fw"], "v": st["v"], "vs": st["vs"],
    })
    return out


# ───────────────────────── 집계(화면용) ─────────────────────────
def get(db: str | None = None) -> pd.DataFrame:
    """캐시 — 리그 표가 바뀌면 다시 만든다(약 5초). 경기 하나 = 한 줄."""
    db = db or PATHS.get_master_db()
    return DATA.cached_derive(db, "round_miss:v5", lambda: build(db), tables=tuple(PATHS.LEAGUES))


def _miss_counts(df: pd.DataFrame, side_col: str, split_col: str | None = None) -> pd.DataFrame:
    """라운드(리그·시즌·라운드)마다 [전체 경기, 결과 난 경기, 세팅 낸 경기, 정→플(무·역), 플→정(핸무·핸승),
    그중 엇갈림(엇(정)·엇(플)) 판정이었던 경기 — 판정 기준(split_col)일 때만]."""
    d = df.assign(done=df["rt"] > 0, has=df[side_col] != 0,
                  sp=df[split_col].astype(bool) if split_col else False)
    jung, pl = d[side_col] == 1, d[side_col] == -1
    g = d.groupby(["lg", "S", "r"])
    out = pd.DataFrame({
        "tot": g.size(),
        "done": g["done"].sum(),
        "set": d[d["done"] & d["has"]].groupby(["lg", "S", "r"]).size(),
        "jp_mu": d[jung & (d["rt"] == 3)].groupby(["lg", "S", "r"]).size(),
        "jp_yk": d[jung & (d["rt"] == 4)].groupby(["lg", "S", "r"]).size(),
        "pj_hm": d[pl & (d["rt"] == 2)].groupby(["lg", "S", "r"]).size(),
        "pj_hs": d[pl & (d["rt"] == 1)].groupby(["lg", "S", "r"]).size(),
        "jp_sp": d[jung & d["sp"] & d["rt"].isin([3, 4])].groupby(["lg", "S", "r"]).size(),
        "pj_sp": d[pl & d["sp"] & d["rt"].isin([1, 2])].groupby(["lg", "S", "r"]).size(),
    }).fillna(0).astype(int)
    return out


def summary(db: str | None = None) -> dict:
    """{market(v 판정·k 국배·f 해배): {리그: {시즌: {라운드: [전체, 결과, 세팅, 정→플 무, 정→플 역, 플→정 핸무, 플→정 핸승, 그중 엇(정), 그중 엇(플)]}}}} + 시즌·리그 목록."""
    df = get(db)
    out = {"seasons": sorted(df["S"].unique(), reverse=True), "leagues": [], "v": {}, "k": {}, "f": {}, "minSeason": MIN_SEASON}
    out["leagues"] = [{"code": c, "label": LEAGUE_LABEL.get(c, c)} for c in PATHS.LEAGUES]
    for mk, col in (("v", "v"), ("k", "k"), ("f", "f")):
        cnt = _miss_counts(df, col, "vs" if mk == "v" else None)
        res: dict = {}
        for (lg, s, r), row in cnt.iterrows():
            res.setdefault(lg, {}).setdefault(s, {})[int(r)] = [int(x) for x in row.tolist()]
        out[mk] = res
    return out


LEAGUE_LABEL = {"EPL": "EPL", "LALIGA": "라리가", "SERIEA": "세리에A", "BUNDES": "분데스",
                "EREDIVISIE": "에레디", "LIGUE1": "리그1"}


def detail(lg: str, r: int, db: str | None = None) -> dict:
    """한 리그의 한 라운드를 시즌별로 — 경기마다 국배·해배 세팅값과 결과, 와이즈토토 순서(kno)."""
    db = db or PATHS.get_master_db()
    df = get(db)
    sub = df[(df["lg"] == lg) & (df["r"] == r)].sort_values(["S", "ord", "hour"], ascending=[False, True, True])
    kidx = DATA.cached_derive(db, "kr_game_no_index", lambda: KNO.load_index(db), tables=("kr_game_no",))
    seasons = {}
    for rec in sub.to_dict("records"):
        kn = KNO.lookup(kidx, lg, rec["S"], r, rec["ht"], rec["at"])
        seasons.setdefault(rec["S"], []).append({
            "ht": rec["ht"], "at": rec["at"],
            "hs": None if pd.isna(rec["hs"]) else int(rec["hs"]), "as": None if pd.isna(rec["as_"]) else int(rec["as_"]),
            "rt": rec["rt"] or None, "dd": rec["dd"] or None, "ddo": None if pd.isna(rec["ddo"]) else round(float(rec["ddo"]), 2), "k": int(rec["k"]), "kw": bool(rec["kw"]), "f": int(rec["f"]), "fw": bool(rec["fw"]), "v": int(rec["v"]), "vs": bool(rec["vs"]),
            "d": str((pd.Timestamp("2000-01-01") + pd.Timedelta(days=int(rec["ord"]))).date()),
            "wd": _wd_of(rec["ord"], rec["hour"]), "kno": kn["kno"] if kn else None,
        })
    for gl in seasons.values():          # 와이즈토토 순서가 있으면 그 순서, 없으면 날짜·시각 순
        if all(g["kno"] is not None for g in gl):
            gl.sort(key=lambda g: g["kno"])
    return {"league": lg, "round": r, "seasons": seasons}
