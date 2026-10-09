"""상세보기 '플핸 점수' — 단통 플핸(무+역, RT3+4) 점수 0~5점 (2026-10-07 사용자 지정).

[점수 = 패턴(0~2) + 동의(0~3)]
  패턴 = 패턴분석-01(.claude/skills/pattern-analysis-01) — '국내 초기로는 접전인데 마감 시장이 국내 정배를 더 약하게 봤다'
    2점  B12s : 국내 접전형(국내 초기 역배 배당 ≤ 무 배당×0.876) + 12사 마감 평균 정배확률이 국내 초기보다 6.5%p↑ 낮음
    1점  B    : 국내 접전형 + Bet365(앱의 해외배당) 마감 정배확률이 4.5%p↑ 낮음
         또는 마감에서 정배가 뒤집힘(Bet365 마감 정배가 국내 초기 정배와 반대 팀, 또는 12사 절반 이상이 반대)
  동의 = 서로 다른 방식의 판단 3가지가 '플'이라고 하는 수
    S 모델    : 국내·Bet365 초기·마감 배당으로 만든 109칸을 배운 학습 모델(xgboost) 점수 ≥ 0.72
    12사 모델 : 12사 평균 배당(초기·마감 승무패·아시안핸디·오버언더와 그걸 골 수로 푼 값) 42칸을 배운 모델 ≥ 0.70
    합의 신호 : SIGNALS 6개 중 3개 이상(찾기 기간 09-10~18-19만 보고 고른 신호와 문턱)

[실측 — 2026-10-07, 6대리그 15-16~26-27(모델 점수가 있는 기간)]
  5점 96.2%(25/26) · 4점 80.6%(129/160) · 3점 67.7% · 2점 65.3% · 1점 58.1% · 0점 40.4%
  4점 이상 82.8%(154/186): 찾기 83.6% · 고르기 82.1% · 최근 5시즌 82.7% — 세 기간이 같다.
  (분석 경위: 메모리 reference-plhan-closing-drift-pattern)

[미래를 안 본다]
  모델: 과거 경기는 '그 시즌 이전 시즌만으로 배운 모델' 점수(OOS)를 저장해 두고 그 값을 쓴다.
        앞으로 치를 경기만 '지금까지 끝난 경기 전부로 배운 모델'로 그 자리에서 계산한다.
  같은 배당 표본(K-W 등): 그 경기 날짜 이전에 끝난 경기만 센다(앱에 저장된 26지표는 뒤 경기까지 섞여 있어 안 쓴다).
  표본 카드: triple_sample.query(phase='final') — 원래 날짜 이전 경기만 쓴다.

[학습] python api/plhan_score.py train  (약 10분, 읽기 전용) → data/master/plhan/
  model_s.json · model_12.json · oos.parquet(과거 경기 모델 점수) · stats.json(점수별 실측표)
"""
from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime

import warnings

import numpy as np
import pandas as pd
from scipy.special import gammaln

warnings.filterwarnings("ignore", category=pd.errors.PerformanceWarning)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:      # 명령줄(python api/plhan_score.py train)로 돌릴 때 — 서버에서는 이미 들어 있다
    sys.path.insert(0, _ROOT)
import betpro_paths as PATHS  # noqa: E402
import data_access as DATA  # noqa: E402
import multibook_odds as MB  # noqa: E402
from kr_extra_odds import _key  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(PATHS.get_master_db()), "plhan")

CLOSE_DSHARE = 0.467      # 국내 접전형: 무/(무+역배) 몫 ≤ 0.467 ⇔ 역배 배당 ≤ 무 배당 × 0.876
DSHARE_RATIO = 0.876
DROP_B = -0.045           # B: Bet365 마감 − 국내 초기 정배확률
DROP_B12S = -0.065        # B12s: 12사 마감 평균 − 국내 초기 정배확률
FLIP_SHARE = 0.5          # 12사 중 이 비율 이상이 마감에 정배 반대
S_CUT, M12_CUT, CONS_NEED = 0.72, 0.70, 3
BASE_PL = 0.462           # 같은 배당 표본 방향 점수의 '평소' 플핸 비율(18시즌 전체)
SIGNALS = [   # (키, 이름, 칸, 방향, 문턱) — 2026-10-07 찾기 기간에서 고른 그대로
    ("sbo", "Sbobet 정배확률 변화(초기→마감)", "mb_sbo_dpf", "<=", -0.04230623216862865),
    ("dirmin", "가장 레드인 배당사 방향 점수(마감)", "dirs_L_min", "<=", -5.8524),
    ("kw", "국배 승 같은배당 표본 방향(같은 리그)", "bd_K-W", ">=", 1.152),
    ("ekw", "국배 배변 승 같은배당 표본 방향(같은 리그)", "bd_EK-W", ">=", 1.152),
    ("tkw", "국배 승 같은배당 표본 방향(6대리그)", "bd_TK-W", ">=", 1.2842941784786597),
    ("card", "배변 표본 카드 무·역 비율", "cf_pl", ">=", 2 / 3),
]
XGB_PARAMS = dict(n_estimators=500, max_depth=4, learning_rate=0.03, subsample=0.8, colsample_bytree=0.6,
                  min_child_weight=30, reg_lambda=5.0, tree_method="hist", n_jobs=8, eval_metric="logloss")
OOS_FROM = 15             # 학습 모델 점수는 15-16시즌부터(그 앞 시즌들로 배운다)
DISC_MAX, SEL_MAX = 18, 21
S_PREFIX = ("k_", "kh_", "f_", "fh_", "x_k_f_", "ek_", "ekh_", "ef_", "efh_", "x_ek_", "x_ef_", "x_f_ek", "mv_")
M12_FEATS = ["mb_Fpf", "mb_Fpd", "mb_Fpg", "mb_Lpf", "mb_Lpd", "mb_Lpg", "mb_Lpf_sd", "mb_Lpd_sd", "mb_Fpf_sd", "mb_Lpf_rng",
             "mb_L_dshare", "mb_F_dshare", "mb_L_pnw", "mb_F_pnw", "ah_Fline", "ah_Fp", "ou_Fline", "ou_Fp", "ah_Lline", "ah_Lp",
             "ou_Lline", "ou_Lp", "ps_F_T", "ps_F_s", "ps_F_pd", "ps_F_pg", "ps_F_p1", "ps_F_p2p", "ps_F_pl", "ps_F_lf", "ps_F_lg",
             "ps_L_T", "ps_L_s", "ps_L_pd", "ps_L_pg", "ps_L_p1", "ps_L_p2p", "ps_L_pl", "ps_L_lf", "ps_L_lg", "ps_harm_mb", "ps_draw_gap"]


def kstr(code, s, r, ht, at) -> str:
    return "|".join(map(str, _key(code, s, r, ht, at)))


# ═══════════════════════════ 재료 — 배당(국내·Bet365) ═══════════════════════════
def odds_frame(df: pd.DataFrame) -> pd.DataFrame:
    """리그 표 행들 → 정배 관점 배당 재료(S 모델 109칸 포함). 분석(scratchpad pl_build.py)과 같은 식·같은 칸 순서."""
    n = len(df)

    def num(c):
        return pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float) if c in df.columns else np.full(n, np.nan)

    X = pd.DataFrame({"code": df["code"].to_numpy(), "S": df["S"].astype(str).to_numpy(), "R": df["R"].astype(str).to_numpy(),
                      "HT": df["HT"].astype(str).str.strip().to_numpy(), "AT": df["AT"].astype(str).str.strip().to_numpy()},
                     index=df.index)
    X["key"] = [kstr(*t) for t in zip(X["code"], X["S"], X["R"], X["HT"], X["AT"])]
    date = pd.to_datetime("20" + df["DT"].astype(str).str[:8], format="%Y-%m-%d", errors="coerce")
    X["date"] = date.to_numpy()
    X["day"] = (date - pd.Timestamp("2000-01-01")).dt.days.to_numpy(dtype=float)
    X["sidx"] = pd.to_numeric(X["S"].str[:2], errors="coerce").to_numpy()
    RT, HS, AS = num("RT"), num("HS"), num("AS")
    X["RT"], X["HS"], X["AS"] = RT, HS, AS
    done = np.isin(RT, (1, 2, 3, 4))
    X["done"] = done
    X["y"] = np.where(done, np.isin(RT, (3, 4)).astype(float), np.nan)
    for c in ("KW", "KD", "KL", "EFW", "EFD", "EFL", "EKW"):
        X[f"raw_{c}"] = num(c)
    kw, kl, fw, fl = num("KW"), num("KL"), num("FW"), num("FL")
    k_ok = (kw > 1) & (kl > 1) & (kw != kl)
    f_ok = (fw > 1) & (fl > 1) & (fw != fl)
    hf = np.where(k_ok, (kw < kl).astype(float), np.where(f_ok, (fw < fl).astype(float), np.nan))
    X["hf"] = hf
    gd = HS - AS
    fgd = np.where(hf == 1, gd, -gd)
    rt_calc = np.where(fgd >= 2, 1, np.where(fgd == 1, 2, np.where(fgd == 0, 3, 4))).astype(float)
    X["orient_ok"] = np.where(done & ~np.isnan(gd) & ~np.isnan(hf), (rt_calc == RT).astype(float), np.nan)

    def orient(w, l):
        return np.where(hf == 1, w, l), np.where(hf == 1, l, w)

    def three(f_, d_, g_, pre):
        ok = (f_ > 1) & (d_ > 1) & (g_ > 1)
        m = 1 / f_ + 1 / d_ + 1 / g_
        X[f"{pre}_f"], X[f"{pre}_d"], X[f"{pre}_g"] = np.where(ok, f_, np.nan), np.where(ok, d_, np.nan), np.where(ok, g_, np.nan)
        X[f"{pre}_m"] = np.where(ok, m, np.nan)
        X[f"{pre}_pf"] = np.where(ok, (1 / f_) / m, np.nan)
        X[f"{pre}_pd"] = np.where(ok, (1 / d_) / m, np.nan)
        X[f"{pre}_pg"] = np.where(ok, (1 / g_) / m, np.nan)
        X[f"{pre}_dshare"] = X[f"{pre}_pd"] / (X[f"{pre}_pd"] + X[f"{pre}_pg"])

    def handi(h, hw, hd, hl, pre, p_notwin):
        side_ok = ((hf == 1) & (h < 0)) | ((hf == 0) & (h > 0))
        cov = np.where(hf == 1, hw, hl)
        pl = np.where(hf == 1, hl, hw)
        ok = side_ok & (cov > 1) & (hd > 1) & (pl > 1)
        with np.errstate(divide="ignore", invalid="ignore"):
            m = 1 / cov + 1 / hd + 1 / pl
            qc, qp, ql = (1 / cov) / m, (1 / hd) / m, (1 / pl) / m
            ratio = ql / p_notwin
        weird = ok & ((ratio < 0.6) | (ratio > 1.7))
        ok = ok & ~weird
        X[f"{pre}_cov"], X[f"{pre}_push"], X[f"{pre}_pl"] = [np.where(ok, v, np.nan) for v in (cov, hd, pl)]
        X[f"{pre}_hm"] = np.where(ok, m, np.nan)
        X[f"{pre}_qc"], X[f"{pre}_qp"], X[f"{pre}_ql"] = [np.where(ok, v, np.nan) for v in (qc, qp, ql)]
        X[f"{pre}_harm"] = np.where(ok, ql - p_notwin, np.nan)
        X[f"{pre}_push_share"] = np.where(ok, qp / (1 - ql), np.nan)
        X[f"{pre}_weird"] = weird.astype(float)

    with np.errstate(divide="ignore", invalid="ignore"):
        for pre, (w_, d_, l_), (h_, hw_, hd_, hl_) in (
                ("k", ("KW", "KD", "KL"), ("KH", "KHW", "KHD", "KHL")),
                ("ek", ("EKW", "EKD", "EKL"), ("EKH", "EKHW", "EKHD", "EKHL")),
                ("f", ("FW", "FD", "FL"), ("FH", "FHW", "FHD", "FHL")),
                ("ef", ("EFW", "EFD", "EFL"), ("EFH", "EFHW", "EFHD", "EFHL"))):
            a, b = orient(num(w_), num(l_))
            three(a, num(d_), b, pre)
            pnw = (X[f"{pre}_pd"] + X[f"{pre}_pg"]).to_numpy()
            handi(num(h_), num(hw_), num(hd_), num(hl_), pre + "h", pnw)
            w0, l0 = num(w_), num(l_)
            X[f"{pre}_flip"] = np.where((w0 > 1) & (l0 > 1) & (w0 != l0) & ~np.isnan(hf),
                                        ((w0 < l0).astype(float) != hf).astype(float), np.nan)
            X[f"{pre}_tie"] = np.where((w0 > 1) & (l0 > 1), (w0 == l0).astype(float), np.nan)
    for a, b in (("k", "f"), ("ek", "ef"), ("ek", "k"), ("ef", "f"), ("f", "ek"), ("ef", "k")):
        for q in ("pf", "pd", "pg"):
            X[f"x_{a}_{b}_{q}"] = X[f"{a}_{q}"] - X[f"{b}_{q}"]
        X[f"x_{a}_{b}_ql"] = X[f"{a}h_ql"] - X[f"{b}h_ql"]
    X["mv_k_same_f"] = np.sign(X["x_ek_k_pf"]) * np.sign(X["x_ef_f_pf"])
    X["k_gap"] = X["k_g"] - X["k_f"]
    X["f_gap"] = X["f_g"] - X["f_f"]
    X["ef_gap"] = X["ef_g"] - X["ef_f"]
    X["ek_gap"] = X["ek_g"] - X["ek_f"]
    return X


def s_feats(X: pd.DataFrame) -> list:
    """S 모델 109칸 — 분석과 같은 순서(초기 배당 칸 먼저, 마감 배당 칸 나중). 학습이 칸을 무작위로 골라 쓰는
    부분(colsample)이 있어 순서가 다르면 결과가 조금 달라진다(2026-10-07 대조 때 판정 일치 99.0% → 순서 맞춰 100%)."""
    num = [c for c in X.columns if pd.api.types.is_numeric_dtype(X[c])]
    first = [c for c in num if c.startswith(S_PREFIX[:5])]
    return first + [c for c in num if c.startswith(S_PREFIX[5:]) and c not in first]


# ═══════════════════════════ 재료 — 12사(멀티북) ═══════════════════════════
KMAX = 12
_KS = np.arange(KMAX + 1)
_LG = gammaln(_KS + 1)


def _pmf(lam):
    lam = np.clip(lam, 1e-4, None)[:, None]
    return np.exp(_KS[None, :] * np.log(lam) - lam - _LG[None, :])


def _comps(line):
    q = np.round(line * 4) % 2 == 1
    return np.where(q, line - 0.25, line), np.where(q, line + 0.25, line)


def _wl(cdf, pm, c, off):
    fl = np.floor(c + 1e-9).astype(int)
    is_int = np.isclose(c, fl)
    idx = np.clip(fl + off, 0, cdf.shape[1] - 1)
    r = np.arange(len(c))
    le = np.where(fl + off < 0, 0.0, cdf[r, idx])
    eq = np.where((fl + off < 0) | (fl + off >= cdf.shape[1]), 0.0, pm[r, idx])
    return 1 - le, np.where(is_int, le - eq, le)


def _p_over(T, line):
    pm = _pmf(T)
    cdf = np.cumsum(pm, axis=1)
    c1, c2 = _comps(line)
    w1, l1 = _wl(cdf, pm, c1, 0)
    w2, l2 = _wl(cdf, pm, c2, 0)
    return (w1 + w2) / (w1 + w2 + l1 + l2)


def _diff_pmf(lf, lg_):
    pf_, pg_ = _pmf(lf), _pmf(lg_)
    out = np.zeros((len(lf), 2 * KMAX + 1))
    for i in range(KMAX + 1):
        for j in range(KMAX + 1):
            out[:, i - j + KMAX] += pf_[:, i] * pg_[:, j]
    return out


def _p_cover(T, s, line):
    pm = _diff_pmf((T + s) / 2, (T - s) / 2)
    cdf = np.cumsum(pm, axis=1)
    c1, c2 = _comps(line)
    w1, l1 = _wl(cdf, pm, c1, KMAX)
    w2, l2 = _wl(cdf, pm, c2, KMAX)
    return (w1 + w2) / (w1 + w2 + l1 + l2), pm


def _bisect(fun, target, lo, hi, it=36):
    lo = np.full(len(target), lo, dtype=float)
    hi = np.full(len(target), hi, dtype=float)
    for _ in range(it):
        mid = (lo + hi) / 2
        up = fun(mid) < target
        lo = np.where(up, mid, lo)
        hi = np.where(up, hi, mid)
    return (lo + hi) / 2


def mb_frame(mb: pd.DataFrame, hf_map: dict) -> pd.DataFrame:
    """12사 배당 행(경기×회사) → 경기별 집계(정배 관점). 분석과 같은 식."""
    mb = mb.copy()
    mb["key"] = [kstr(*t) for t in zip(mb["code"], mb["S"], mb["R"], mb["HT"], mb["AT"])]
    mb["hf"] = mb["key"].map(hf_map)
    mb = mb[mb["hf"].notna()].copy()
    if mb.empty:
        return pd.DataFrame()
    for c in ("EU_F1", "EU_FX", "EU_F2", "EU_L1", "EU_LX", "EU_L2", "AH_FG", "AH_F1", "AH_F2", "AH_LG", "AH_L1", "AH_L2",
              "OU_FG", "OU_FO", "OU_FU", "OU_LG", "OU_LO", "OU_LU"):
        mb[c] = pd.to_numeric(mb[c], errors="coerce")
    h1 = mb["hf"].to_numpy() == 1
    with np.errstate(divide="ignore", invalid="ignore"):
        for ph in ("F", "L"):
            w_, x_, l_ = mb[f"EU_{ph}1"].to_numpy(), mb[f"EU_{ph}X"].to_numpy(), mb[f"EU_{ph}2"].to_numpy()
            f_, g_ = np.where(h1, w_, l_), np.where(h1, l_, w_)
            ok = (f_ > 1) & (x_ > 1) & (g_ > 1)
            m = 1 / f_ + 1 / x_ + 1 / g_
            mb[f"{ph}pf"] = np.where(ok, (1 / f_) / m, np.nan)
            mb[f"{ph}pd"] = np.where(ok, (1 / x_) / m, np.nan)
            mb[f"{ph}pg"] = np.where(ok, (1 / g_) / m, np.nan)
            mb[f"{ph}flip"] = np.where(ok & (w_ != l_), ((w_ < l_) != h1).astype(float), np.nan)
            mb[f"{ph}of"] = np.where(ok, f_, np.nan)
            mb[f"{ph}od"] = np.where(ok, x_, np.nan)
            mb[f"{ph}og"] = np.where(ok, g_, np.nan)
            lg = mb[f"AH_{ph}G"].to_numpy()
            a1, a2 = mb[f"AH_{ph}1"].to_numpy(), mb[f"AH_{ph}2"].to_numpy()
            mb[f"{ph}ah"] = np.where(h1, lg, -lg)
            fp, dp = np.where(h1, a1, a2), np.where(h1, a2, a1)
            okA = (fp > 1) & (dp > 1) & ~np.isnan(lg)
            mb[f"{ph}ahp"] = np.where(okA, (1 / fp) / (1 / fp + 1 / dp), np.nan)
            og, oo, ou = mb[f"OU_{ph}G"].to_numpy(), mb[f"OU_{ph}O"].to_numpy(), mb[f"OU_{ph}U"].to_numpy()
            okO = (oo > 1) & (ou > 1) & ~np.isnan(og)
            mb[f"{ph}ou"] = np.where(okO, og, np.nan)
            mb[f"{ph}oup"] = np.where(okO, (1 / oo) / (1 / oo + 1 / ou), np.nan)
            mb.loc[~okA, f"{ph}ah"] = np.nan
    mb["dpf"] = mb["Lpf"] - mb["Fpf"]
    g = mb.groupby("key")
    A = pd.DataFrame({
        "mb_n": g["Lpf"].count(),
        "mb_Fpf": g["Fpf"].mean(), "mb_Fpd": g["Fpd"].mean(), "mb_Fpg": g["Fpg"].mean(),
        "mb_Lpf": g["Lpf"].mean(), "mb_Lpd": g["Lpd"].mean(), "mb_Lpg": g["Lpg"].mean(),
        "mb_Lpf_sd": g["Lpf"].std(), "mb_Lpd_sd": g["Lpd"].std(), "mb_Fpf_sd": g["Fpf"].std(),
        "mb_Lpf_rng": g["Lpf"].max() - g["Lpf"].min(),
        "mb_Lflip": g["Lflip"].mean(),
        "m12_f": g["Lof"].mean(), "m12_d": g["Lod"].mean(), "m12_g": g["Log"].mean(),
        "m12F_f": g["Fof"].mean(), "m12F_d": g["Fod"].mean(), "m12F_g": g["Fog"].mean(),
    })
    sbo = mb[mb["book"] == "Sbobet"].set_index("key")
    A["mb_sbo_dpf"] = sbo["dpf"].groupby(level=0).first()
    for ph in ("F", "L"):
        for col_line, col_p, nm in ((f"{ph}ah", f"{ph}ahp", "ah"), (f"{ph}ou", f"{ph}oup", "ou")):
            s = mb[["key", col_line, col_p]].dropna()
            if s.empty:
                A[f"{nm}_{ph}line"], A[f"{nm}_{ph}p"] = np.nan, np.nan
                continue
            cnt = s.groupby(["key", col_line]).size().rename("c").reset_index()
            cnt = cnt.sort_values(["key", "c"], ascending=[True, False]).drop_duplicates("key")
            s = s.merge(cnt[["key", col_line]], on=["key", col_line])
            out = s.groupby("key").agg(line=(col_line, "first"), p=(col_p, "mean"))
            A[f"{nm}_{ph}line"] = out["line"]
            A[f"{nm}_{ph}p"] = out["p"]
    # 골 수 모델(포아송)로 시장이 본 총골·골차 역산
    for ph in ("F", "L"):
        cols = [f"ou_{ph}line", f"ou_{ph}p", f"ah_{ph}line", f"ah_{ph}p"]
        m = A[cols].notna().all(axis=1)
        for nm in ("T", "s", "pd", "pg", "p1", "p2p", "pl", "lf", "lg"):
            A[f"ps_{ph}_{nm}"] = np.nan
        if m.any():
            idx = A.index[m]
            oul, oup = A.loc[idx, f"ou_{ph}line"].to_numpy(float), A.loc[idx, f"ou_{ph}p"].to_numpy(float)
            ahl, ahp = A.loc[idx, f"ah_{ph}line"].to_numpy(float), A.loc[idx, f"ah_{ph}p"].to_numpy(float)
            T = _bisect(lambda t: _p_over(t, oul), oup, 0.8, 6.0)
            S_ = _bisect(lambda s: _p_cover(T, s, ahl)[0], ahp, -1.5, 3.5)
            S_ = np.clip(S_, -T + 0.05, T - 0.05)
            _, pm = _p_cover(T, S_, ahl)
            A.loc[idx, f"ps_{ph}_T"] = T
            A.loc[idx, f"ps_{ph}_s"] = S_
            A.loc[idx, f"ps_{ph}_pd"] = pm[:, KMAX]
            A.loc[idx, f"ps_{ph}_pg"] = pm[:, :KMAX].sum(axis=1)
            A.loc[idx, f"ps_{ph}_p1"] = pm[:, KMAX + 1]
            A.loc[idx, f"ps_{ph}_p2p"] = pm[:, KMAX + 2:].sum(axis=1)
            A.loc[idx, f"ps_{ph}_pl"] = A.loc[idx, f"ps_{ph}_pd"] + A.loc[idx, f"ps_{ph}_pg"]
            A.loc[idx, f"ps_{ph}_lf"] = (T + S_) / 2
            A.loc[idx, f"ps_{ph}_lg"] = (T - S_) / 2
    A["mb_L_dshare"] = A["mb_Lpd"] / (A["mb_Lpd"] + A["mb_Lpg"])
    A["mb_F_dshare"] = A["mb_Fpd"] / (A["mb_Fpd"] + A["mb_Fpg"])
    A["mb_L_pnw"] = A["mb_Lpd"] + A["mb_Lpg"]
    A["mb_F_pnw"] = A["mb_Fpd"] + A["mb_Fpg"]
    A["ps_harm_mb"] = A["ps_L_pl"] - (A["mb_Lpd"] + A["mb_Lpg"])
    A["ps_draw_gap"] = A["mb_Lpd"] - A["ps_L_pd"]
    return A


def dir_min(md: pd.DataFrame, fav_side: dict) -> pd.Series:
    """배당사별 마감 방향 t를 국내 정배 관점으로 돌려(그 회사 정배가 반대 자리면 부호 반대) 가장 작은 값."""
    md = md[(md["book"] != "AVG12") & (md["phase"] == "L")].copy()
    if md.empty:
        return pd.Series(dtype=float)
    md["key"] = [kstr(*t) for t in zip(md["code"], md["S"], md["R"], md["HT"], md["AT"])]
    md["fs"] = md["key"].map(fav_side)
    md = md[md["fs"].isin(["H", "A"])]
    md["t"] = pd.to_numeric(md["t"], errors="coerce")
    md["to"] = md["t"] * np.where(md["pos"] == md["fs"], 1.0, -1.0)
    return md.groupby("key")["to"].min()


def _bd(c34, n):
    return (c34 / n - BASE_PL) * np.sqrt(n) / 0.5 if n > 0 else np.nan


def _cents(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) or v <= 0 else int(round(float(v) * 100))


def _cards_pl(db, code, S, R, HT, AT):
    """배변 표본 카드(같은 리그 + 다른 리그) 중 무·역 비율과 장 수. 카드가 없으면 (NaN, 0)."""
    import triple_sample as TS
    try:
        q = TS.query(db, code, S, R, HT, AT, phase="final")
    except Exception:  # noqa: BLE001
        return np.nan, 0
    if not q.get("ready"):
        return np.nan, 0
    rts = [int(kk) for area in ("same", "other") for kk in "1234" for _ in (q.get(area) or {}).get("cards", {}).get(kk, [])]
    if not rts:
        return np.nan, 0
    return float(np.isin(rts, (3, 4)).mean()), len(rts)


def _cent_arr(s):
    return (pd.to_numeric(s, errors="coerce").round(2) * 100).round().to_numpy(dtype=float)


def _league_arrays(db, code):
    """리그 하나 — 키→행 번호, 국배 승(초기·마감) 배당(센트), 결과, 날짜. 그 리그 테이블이 바뀔 때만 다시 만든다."""
    def build():
        d = DATA.load_league_df(db, code)
        keys = [kstr(code, *t) for t in zip(d["S"], d["R"], d["HT"], d["AT"])]
        return {"pos": {k: i for i, k in enumerate(keys)}, "kw": _cent_arr(d["KW"]), "ekw": _cent_arr(d["EKW"]),
                "rt": pd.to_numeric(d["RT"], errors="coerce").to_numpy(dtype=float),
                "date": pd.to_datetime("20" + d["DT"].astype(str).str[:8], format="%Y-%m-%d", errors="coerce").to_numpy()}
    return DATA.cached_derive(db, "plhan_arr:" + code, build, tables=(code,))


def _total_arrays(db):
    def build():
        parts = [_league_arrays(db, c) for c in PATHS.LEAGUES]
        return {k: np.concatenate([p_[k] for p_ in parts]) for k in ("kw", "rt", "date")}
    return DATA.cached_derive(db, "plhan_arr:ALL", build, tables=tuple(PATHS.LEAGUES))


def _sample_dir(arr, col, cents, day0):
    """같은 배당(센트)이었던 '그 경기 날짜 이전에 끝난' 경기의 방향 점수와 경기 수."""
    if cents is None or pd.isna(day0):
        return np.nan, 0
    msk = (arr[col] == cents) & np.isin(arr["rt"], (1, 2, 3, 4)) & (arr["date"] < np.datetime64(day0))
    n_ = int(msk.sum())
    return (_bd(int(np.isin(arr["rt"][msk], (3, 4)).sum()), n_) if n_ else np.nan), n_


# ═══════════════════════════ 점수 ═══════════════════════════
def pattern_points(close, d365, d12, flip365, flip12):
    b12s = bool(close) and d12 is not None and not np.isnan(d12) and d12 <= DROP_B12S
    b = bool(close) and d365 is not None and not np.isnan(d365) and d365 <= DROP_B
    flip = (flip365 == 1) or (flip12 is not None and not np.isnan(flip12) and flip12 >= FLIP_SHARE)
    return (2 if b12s else 1 if (b or flip) else 0), bool(b), bool(b12s), bool(flip)


def _sig_on(op, v, t):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return False
    return v <= t if op == "<=" else v >= t


# ═══════════════════════════ 학습(관리자·명령줄) ═══════════════════════════
def _log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def build_all(db=None):
    """6대리그 전 경기 재료 표(모델 학습·실측표용)."""
    db = db or PATHS.get_master_db()
    frames = []
    for code in PATHS.LEAGUES:
        d = DATA.load_league_df(db, code).copy()
        d["code"] = code
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    X = odds_frame(df)
    con = sqlite3.connect(MB.db_path_for(PATHS.SCOPE_MASTER))
    try:
        mb = pd.read_sql("SELECT * FROM mb_odds", con)
        md = pd.read_sql("SELECT code,S,R,HT,AT,book,phase,pos,t FROM mb_dir", con)
    finally:
        con.close()
    A = mb_frame(mb, dict(zip(X["key"], X["hf"])))
    X = X.join(A, on="key")
    X["mb_k_dpf"] = X["mb_Lpf"] - X["k_pf"]
    fs = dict(zip(X["key"], np.where(X["hf"] == 1, "H", np.where(X["hf"] == 0, "A", ""))))
    X["dirs_L_min"] = X["key"].map(dir_min(md, fs))
    return X, df


def _asof_samples(X: pd.DataFrame) -> pd.DataFrame:
    """같은 배당 표본(K-W 리그 · EK-W 리그 · K-W 6대리그) — 그 경기 날짜 이전에 끝난 경기만."""
    out = {c: np.full(len(X), np.nan) for c in ("bd_K-W", "bd_EK-W", "bd_TK-W")}
    kw = [_cents(v) for v in X["raw_KW"]]
    ekw = [_cents(v) for v in X["raw_EKW"]]
    code = X["code"].to_numpy()
    day = X["day"].to_numpy()
    rt = X["RT"].to_numpy()
    done = X["done"].to_numpy()
    order = np.argsort(np.where(np.isnan(day), 1e9, day), kind="stable")
    cnt = defaultdict(lambda: [0, 0])     # 키 → [플핸 수, 경기 수]
    pos = 0
    n = len(X)
    while pos < n:
        d0 = day[order[pos]]
        j = pos
        while j < n and (day[order[j]] == d0 or (np.isnan(d0) and np.isnan(day[order[j]]))):
            j += 1
        batch = order[pos:j]
        for i in batch:
            for col, k in (("bd_K-W", ("L", code[i], kw[i])), ("bd_EK-W", ("E", code[i], ekw[i])), ("bd_TK-W", ("T", kw[i]))):
                if k[-1] is None:
                    continue
                c = cnt.get(k)
                out[col][i] = _bd(c[0], c[1]) if c and c[1] > 0 else np.nan
        for i in batch:
            if not done[i] or np.isnan(day[i]):
                continue
            pl = 1 if rt[i] in (3, 4) else 0
            for k in (("L", code[i], kw[i]), ("E", code[i], ekw[i]), ("T", kw[i])):
                if k[-1] is None:
                    continue
                c = cnt[k]
                c[0] += pl
                c[1] += 1
        pos = j
    return pd.DataFrame(out, index=X.index)


def train(db=None):
    import xgboost as xgb
    t0 = time.time()
    db = db or PATHS.get_master_db()
    X, _df = build_all(db)
    _log("재료 표", X.shape)
    X = X.join(_asof_samples(X))
    SF = s_feats(X)
    D = X[X["done"] & X["hf"].notna() & (X["orient_ok"] != 0)].copy()
    _log("학습 경기", len(D), "S 재료", len(SF), "12사 재료", len(M12_FEATS))
    pS = pd.Series(np.nan, index=X.index)
    p12 = pd.Series(np.nan, index=X.index)
    last = int(np.nanmax(D["sidx"]))
    for s in range(OOS_FROM, last + 1):
        tr, te = D[D["sidx"] < s], D[D["sidx"] == s]
        if te.empty:
            continue
        pS[te.index] = xgb.XGBClassifier(**XGB_PARAMS).fit(tr[SF], tr["y"]).predict_proba(te[SF])[:, 1]
        p12[te.index] = xgb.XGBClassifier(**XGB_PARAMS).fit(tr[M12_FEATS], tr["y"]).predict_proba(te[M12_FEATS])[:, 1]
        _log(f"시즌 {s} 검증 점수 끝")
    os.makedirs(OUT_DIR, exist_ok=True)
    ms = xgb.XGBClassifier(**XGB_PARAMS).fit(D[SF], D["y"])
    m12 = xgb.XGBClassifier(**XGB_PARAMS).fit(D[M12_FEATS], D["y"])
    ms.save_model(os.path.join(OUT_DIR, "model_s.json"))
    m12.save_model(os.path.join(OUT_DIR, "model_12.json"))
    oos = pd.DataFrame({"key": X["key"], "pS": pS, "p12": p12}).dropna(subset=["pS"])
    oos.to_parquet(os.path.join(OUT_DIR, "oos.parquet"), index=False)
    _log("모델 저장")
    # 실측표 — 모델 점수(OOS) 있는 경기만. 표본 카드는 그 경기들만 센다(시간이 걸린다).
    E = D[D.index.isin(oos.index)].copy()
    E["pS"], E["p12"] = pS[E.index], p12[E.index]
    cf = []
    for i, r in enumerate(E.itertuples(index=False)):
        cf.append(_cards_pl(db, r.code, r.S, r.R, r.HT, r.AT)[0])
        if i % 3000 == 0:
            _log(f"표본 카드 {i}/{len(E)}")
    E["cf_pl"] = cf
    close = E["k_dshare"] <= CLOSE_DSHARE
    pat = np.where(close & (E["mb_k_dpf"] <= DROP_B12S), 2,
                   np.where((close & (E["x_ef_k_pf"] <= DROP_B)) | (E["ef_flip"] == 1) | (E["mb_Lflip"] >= FLIP_SHARE), 1, 0))
    cons = sum((E[c] <= t) if op == "<=" else (E[c] >= t) for _, _, c, op, t in SIGNALS)
    agree = (E["pS"] >= S_CUT).astype(int) + (E["p12"] >= M12_CUT).astype(int) + (cons >= CONS_NEED).astype(int)
    E["pts"] = pat + agree.to_numpy()
    per = np.where(E["sidx"] <= DISC_MAX, "찾기", np.where(E["sidx"] <= SEL_MAX, "고르기", "최근"))
    E["per"] = per
    nseason = E["sidx"].nunique()

    def cell(s):
        return {"n": int(len(s)), "hit": int(s["y"].sum()), "rate": round(float(s["y"].mean()) * 100, 1) if len(s) else None,
                "per_season": round(len(s) / nseason, 1), "cov": round(float((s["RT"] == 1).mean()) * 100, 1) if len(s) else None,
                "push": round(float((s["RT"] == 2).mean()) * 100, 1) if len(s) else None,
                "periods": {p: [int(s.loc[s["per"] == p, "y"].sum()), int((s["per"] == p).sum())] for p in ("찾기", "고르기", "최근")}}
    ladder = {str(k): cell(E[E["pts"] == k]) for k in range(6)}
    ladder["4+"] = cell(E[E["pts"] >= 4])
    stats = {
        "trained_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "games": int(len(E)), "train_games": int(len(D)),
        "seasons": f"{int(E['sidx'].min())}-{int(E['sidx'].min()) + 1}~{int(E['sidx'].max())}-{int(E['sidx'].max()) + 1}",
        "periods": {"찾기": f"{OOS_FROM}-{OOS_FROM + 1}~{DISC_MAX}-{DISC_MAX + 1}", "고르기": f"{DISC_MAX + 1}-{DISC_MAX + 2}~{SEL_MAX}-{SEL_MAX + 1}",
                    "최근": f"{SEL_MAX + 1}-{SEL_MAX + 2}~"},
        "ladder": ladder, "s_feats": SF, "m12_feats": M12_FEATS,
    }
    with open(os.path.join(OUT_DIR, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    _log(f"끝 ({time.time() - t0:.0f}초) — 5점 {ladder['5']['rate']}%({ladder['5']['hit']}/{ladder['5']['n']}) · 4점 이상 {ladder['4+']['rate']}%")
    _reset_cache()
    return stats


# ═══════════════════════════ 상세보기 한 경기 ═══════════════════════════
_LOCK = threading.Lock()
_CACHE: dict = {}


def _reset_cache():
    with _LOCK:
        _CACHE.clear()


def _artifacts():
    with _LOCK:
        if "art" in _CACHE:
            return _CACHE["art"]
        art = {"stats": None, "oos": {}, "ms": None, "m12": None}
        try:
            with open(os.path.join(OUT_DIR, "stats.json"), encoding="utf-8") as f:
                art["stats"] = json.load(f)
            o = pd.read_parquet(os.path.join(OUT_DIR, "oos.parquet"))
            art["oos"] = {k: (a, b) for k, a, b in zip(o["key"], o["pS"], o["p12"])}
            import xgboost as xgb
            art["ms"], art["m12"] = xgb.XGBClassifier(), xgb.XGBClassifier()
            art["ms"].load_model(os.path.join(OUT_DIR, "model_s.json"))
            art["m12"].load_model(os.path.join(OUT_DIR, "model_12.json"))
        except (OSError, ValueError, KeyError):
            pass
        _CACHE["art"] = art
        return art


def _f(v, nd=4):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(v) else round(v, nd)


def score(code: str, S: str, R: str, HT: str, AT: str, db=None) -> dict:
    db = db or PATHS.get_master_db()
    if code not in PATHS.LEAGUES:
        return {"ready": False, "reason": "공식 6대리그에서만 계산합니다(12사 배당이 거기만 있다)"}
    league = DATA.load_league_df(db, code)
    key = kstr(code, S, R, HT, AT)
    la = _league_arrays(db, code)
    if key not in la["pos"]:
        return {"ready": False, "reason": "경기를 찾지 못했습니다"}
    row = league.iloc[[la["pos"][key]]].copy()       # 캐시본은 건드리지 않는다 — 한 줄을 떼어 복사
    row["code"] = code
    X = odds_frame(row)
    r = X.iloc[0]
    if np.isnan(r["hf"]) or np.isnan(r["k_pf"]):
        return {"ready": False, "reason": "국내 초기 배당이 아직 없습니다", "state": "nodom"}
    con = sqlite3.connect(MB.db_path_for(PATHS.SCOPE_MASTER))
    try:
        mb = pd.read_sql("SELECT * FROM mb_odds WHERE code=? AND HT=? AND AT=? AND S=?", con,
                         params=(code, str(HT).strip(), str(AT).strip(), str(S).strip()))
        md = pd.read_sql("SELECT code,S,R,HT,AT,book,phase,pos,t FROM mb_dir WHERE code=? AND HT=? AND AT=? AND S=?", con,
                         params=(code, str(HT).strip(), str(AT).strip(), str(S).strip()))
    finally:
        con.close()
    A = mb_frame(mb, {key: r["hf"]})
    m = A.loc[key] if key in A.index else pd.Series(dtype=float)
    g = lambda c: m.get(c, np.nan) if len(m) else np.nan  # noqa: E731
    fs = {key: "H" if r["hf"] == 1 else "A"}
    dmin = dir_min(md, fs).get(key, np.nan) if len(md) else np.nan
    # 같은 배당 표본(그 경기 날짜 이전에 끝난 경기)
    day0 = r["date"]
    ta = _total_arrays(db)
    bd_kw, n_kw = _sample_dir(la, "kw", _cents(r["raw_KW"]), day0)
    bd_ekw, n_ekw = _sample_dir(la, "ekw", _cents(r["raw_EKW"]), day0)
    bd_tkw, n_tkw = _sample_dir(ta, "kw", _cents(r["raw_KW"]), day0)
    cf_pl, n_cards = _cards_pl(db, code, S, R, HT, AT)
    vals = {"mb_sbo_dpf": g("mb_sbo_dpf"), "dirs_L_min": dmin, "bd_K-W": bd_kw, "bd_EK-W": bd_ekw, "bd_TK-W": bd_tkw, "cf_pl": cf_pl}
    extra = {"bd_K-W": f"표본 {n_kw}경기", "bd_EK-W": f"표본 {n_ekw}경기", "bd_TK-W": f"표본 {n_tkw}경기", "cf_pl": f"카드 {n_cards}장"}
    signals = [{"key": k, "name": nm, "value": _f(vals[c]), "op": op, "cut": round(t, 4), "on": bool(_sig_on(op, vals[c], t)),
                "note": extra.get(c, "")} for k, nm, c, op, t in SIGNALS]
    cons = sum(s["on"] for s in signals)
    # 패턴
    close = bool(r["k_dshare"] <= CLOSE_DSHARE)
    d365 = r["x_ef_k_pf"]
    d12 = g("mb_Lpf") - r["k_pf"] if len(m) else np.nan
    pat, b, b12s, flip = pattern_points(close, d365, d12, r["ef_flip"], g("mb_Lflip"))
    has365, has12 = not np.isnan(r["ef_pf"]), not np.isnan(g("mb_Lpf"))
    # 모델 점수 — 끝난 경기는 '그 시즌 이전만 배운' 저장 점수, 앞으로 치를 경기는 지금 모델로
    art = _artifacts()
    pS = p12 = None
    model_src = None
    if bool(r["done"]) and key in art["oos"]:
        pS, p12 = (_f(v) for v in art["oos"][key])
        model_src = "그 시즌 이전 시즌만으로 배운 모델 점수"
    elif bool(r["done"]) and not (r["sidx"] >= OOS_FROM):
        model_src = f"{OOS_FROM}-{OOS_FROM + 1}시즌 이전 경기는 미래를 안 본 모델 점수가 없어 두 모델은 빼고 셉니다"
    elif art["ms"] is not None:
        Xs = X.copy()
        for c in A.columns:
            Xs[c] = g(c)
        Xs["mb_k_dpf"] = d12
        sf = (art["stats"] or {}).get("s_feats") or s_feats(Xs)
        if has365:
            pS = _f(art["ms"].predict_proba(Xs[sf].astype(float))[:, 1][0])
        if has12:
            p12 = _f(art["m12"].predict_proba(Xs[M12_FEATS].astype(float))[:, 1][0])
        model_src = ("마지막 학습 뒤에 끝난 경기 — 이 경기를 배우지 않은 지금 모델 점수" if bool(r["done"])
                     else "지금까지 끝난 경기 전부로 배운 모델 점수")
    agree = [
        {"key": "s", "name": "S 모델(국내·Bet365 배당)", "value": pS, "cut": S_CUT, "on": pS is not None and pS >= S_CUT},
        {"key": "m12", "name": "12사 모델(12사 평균 배당)", "value": p12, "cut": M12_CUT, "on": p12 is not None and p12 >= M12_CUT},
        {"key": "cons", "name": "합의 신호(6개 중)", "value": cons, "cut": CONS_NEED, "on": cons >= CONS_NEED},
    ]
    n_agree = sum(a["on"] for a in agree)
    # 앞으로 치를 경기는 Bet365 마감(최신배당)을 불러와야 계산한다 — 12사만으로 내면 S 모델이 빠져 낮게 나온다.
    state = "ok" if (has365 or (bool(r["done"]) and has12)) else "wait"
    total_pts = pat + n_agree
    stats = art["stats"] or {}
    ladder = stats.get("ladder") or {}
    show = ladder.get("4+") if total_pts >= 5 else ladder.get(str(total_pts))

    def need(drop, margin):
        p = r["k_pf"] + drop
        return _f(1 / (p * (margin if margin and not np.isnan(margin) else 1.05)), 2) if p > 0 else None

    m12F = 1 / g("m12F_f") + 1 / g("m12F_d") + 1 / g("m12F_g") if len(m) else np.nan
    fav_team = r["HT"] if r["hf"] == 1 else r["AT"]
    return {
        "ready": True, "state": state, "score": total_pts if state == "ok" else None,
        "pattern": {
            "points": pat, "close": close, "B": b, "B12s": b12s, "flip": bool(flip), "fav": fav_team,
            "k_odds": [_f(r["raw_KW"], 2), _f(r["raw_KD"], 2), _f(r["raw_KL"], 2)],
            "k_fav": _f(r["k_f"], 2), "k_draw": _f(r["k_d"], 2), "k_dog": _f(r["k_g"], 2), "dog_cut": _f(r["k_d"] * DSHARE_RATIO, 2),
            "k_pf": _f(r["k_pf"]), "ef_pf": _f(r["ef_pf"]), "mb_pf": _f(g("mb_Lpf")),
            "ef_fav_odds": _f(r["ef_f"], 2), "m12_fav_odds": _f(g("m12_f"), 2),
            "d365": _f(d365), "d12": _f(d12), "flip365": bool(r["ef_flip"] == 1), "flip12": _f(g("mb_Lflip"), 3),
            "need365": need(DROP_B, r["f_m"]), "need12": need(DROP_B12S, m12F),
            "cut365": DROP_B, "cut12": DROP_B12S, "has365": has365, "has12": has12,
        },
        "agree": {"count": n_agree, "items": agree, "signals": signals, "model_src": model_src},
        "ladder": ladder, "show": show, "stats_at": stats.get("trained_at"), "stats_seasons": stats.get("seasons"),
        "stats_periods": stats.get("periods"),
    }


if __name__ == "__main__":
    if getattr(sys.stdout, "encoding", "").lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    if len(sys.argv) > 1 and sys.argv[1] == "train":
        train()
    else:
        print(__doc__)
