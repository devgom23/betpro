"""패턴분석-01 재료 표 — 경기마다 정배 관점으로 돌린 배당 값(국내 초기·마감, 해외=Bet365 초기·마감, 12사 평균).
읽기 전용(DB에 쓰지 않는다). 결과: 임시 폴더 betpro_pattern01/p01_data.parquet

2026-10-07 분석(scratchpad pl_build.py)의 배당 부분을 식 그대로 옮긴 것 — 숫자가 같아야 패턴 기준이 그대로 맞는다.
정배(fav) = 저장 RT의 기준(국내 초기 정배, 없으면 해외 초기 정배). y = 플핸(RT 3·4) 여부, 결과 없는 경기는 NaN.
"""
import io
import os
import sqlite3
import sys
import tempfile
import time
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
if getattr(sys.stdout, "encoding", "").lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
OUT = os.environ.get("P01_OUT") or os.path.join(tempfile.gettempdir(), "betpro_pattern01")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "api"))
os.chdir(os.path.join(ROOT, "api"))
import betpro_paths as PATHS  # noqa: E402
import data_access as DATA  # noqa: E402
import multibook_odds as MB  # noqa: E402
from kr_extra_odds import _key  # noqa: E402

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:5.0f}s]", *a, flush=True)


db = PATHS.get_master_db()
frames = []
for code in PATHS.LEAGUES:
    d = DATA.load_league_df_ev(db, code).copy()   # 캐시본은 수정하지 않는다(CLAUDE.md 3장) — copy 먼저
    d["code"] = code
    frames.append(d)
df = pd.concat(frames, ignore_index=True)
n = len(df)


def num(c):
    return pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float) if c in df.columns else np.full(n, np.nan)


X = pd.DataFrame({"code": df["code"].to_numpy(), "S": df["S"].astype(str).to_numpy(), "R": df["R"].astype(str).to_numpy(),
                  "HT": df["HT"].astype(str).str.strip().to_numpy(), "AT": df["AT"].astype(str).str.strip().to_numpy()})
X["No"] = num("No")
X["key"] = ["|".join(map(str, _key(*t))) for t in zip(df["code"], df["S"], df["R"], df["HT"], df["AT"])]
dts = df["DT"].astype(str)
date = pd.to_datetime("20" + dts.str[:8], format="%Y-%m-%d", errors="coerce")
X["date"] = date.to_numpy()
X["TM"] = num("TM")
X["sidx"] = pd.to_numeric(X["S"].str[:2], errors="coerce")
RT, HS, AS = num("RT"), num("HS"), num("AS")
X["RT"], X["HS"], X["AS"] = RT, HS, AS
done = np.isin(RT, (1, 2, 3, 4))
X["done"] = done
X["y"] = np.where(done, np.isin(RT, (3, 4)).astype(float), np.nan)
for c in ("KW", "KD", "KL", "FW", "FD", "FL", "EFW", "EFD", "EFL", "EKW", "EKD", "EKL"):
    X[f"raw_{c}"] = num(c)

# ── 정배 방향 ─────────────────────────────────────────────────────────────
kw, kd, kl = num("KW"), num("KD"), num("KL")
fw, fd, fl = num("FW"), num("FD"), num("FL")
k_ok = (kw > 1) & (kl > 1) & (kw != kl)
f_ok = (fw > 1) & (fl > 1) & (fw != fl)
hf = np.where(k_ok, (kw < kl).astype(float), np.where(f_ok, (fw < fl).astype(float), np.nan))
X["hf"] = hf
X["fav_src_k"] = k_ok.astype(float)
gd = HS - AS
fgd = np.where(hf == 1, gd, -gd)
rt_calc = np.where(fgd >= 2, 1, np.where(fgd == 1, 2, np.where(fgd == 0, 3, 4))).astype(float)
X["orient_ok"] = np.where(done & ~np.isnan(gd) & ~np.isnan(hf), (rt_calc == RT).astype(float), np.nan)
log("경기", n, "완료", int(done.sum()), "정배 방향-RT 불일치", int((X["orient_ok"] == 0).sum()))


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
    X[f"{pre}_flip"] = np.where((w0 > 1) & (l0 > 1) & (w0 != l0) & ~np.isnan(hf), ((w0 < l0).astype(float) != hf).astype(float), np.nan)
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
log("국내·해외 배당 정리 끝")

# ── 12사(멀티북) 승무패 — 마감 평균 확률 ─────────────────────────────────────
con = sqlite3.connect(MB.db_path_for(PATHS.SCOPE_MASTER))
mb = pd.read_sql("SELECT code,S,R,HT,AT,book,EU_F1,EU_FX,EU_F2,EU_L1,EU_LX,EU_L2 FROM mb_odds", con)
con.close()
mb["key"] = ["|".join(map(str, _key(*t))) for t in zip(mb["code"], mb["S"], mb["R"], mb["HT"], mb["AT"])]
mb["hf"] = mb["key"].map(dict(zip(X["key"], X["hf"])))
mb = mb[mb["hf"].notna()].copy()
h1 = mb["hf"].to_numpy() == 1
for ph in ("F", "L"):
    w_, x_, l_ = mb[f"EU_{ph}1"].to_numpy(), mb[f"EU_{ph}X"].to_numpy(), mb[f"EU_{ph}2"].to_numpy()
    f_, g_ = np.where(h1, w_, l_), np.where(h1, l_, w_)
    ok = (f_ > 1) & (x_ > 1) & (g_ > 1)
    m = 1 / f_ + 1 / x_ + 1 / g_
    mb[f"{ph}pf"] = np.where(ok, (1 / f_) / m, np.nan)
    mb[f"{ph}pd"] = np.where(ok, (1 / x_) / m, np.nan)
    mb[f"{ph}pg"] = np.where(ok, (1 / g_) / m, np.nan)
    mb[f"{ph}flip"] = np.where(ok & (w_ != l_), ((w_ < l_) != h1).astype(float), np.nan)   # 이 회사의 정배가 국내 정배와 반대인가
    mb[f"{ph}of"], mb[f"{ph}od"], mb[f"{ph}og"] = np.where(ok, f_, np.nan), np.where(ok, x_, np.nan), np.where(ok, g_, np.nan)
g = mb.groupby("key")
A = pd.DataFrame({"mb_n": g["Lpf"].count(), "mb_Lpf": g["Lpf"].mean(), "mb_Lpd": g["Lpd"].mean(), "mb_Lpg": g["Lpg"].mean(),
                  "mb_Fpf": g["Fpf"].mean(), "mb_Fpd": g["Fpd"].mean(), "mb_Lflip": g["Lflip"].mean(),
                  # 화면처럼 회사 배당을 그대로 평균(정배 팀 · 무 · 역배 팀) — 사용자가 보는 '12사 평균 배당'
                  "m12_f": g["Lof"].mean(), "m12_d": g["Lod"].mean(), "m12_g": g["Log"].mean(),
                  "m12F_f": g["Fof"].mean(), "m12F_d": g["Fod"].mean(), "m12F_g": g["Fog"].mean()})
for c in A.columns:
    X[c] = X["key"].map(A[c])
X["mb_k_dpf"] = X["mb_Lpf"] - X["k_pf"]
log("12사 집계 끝")
X.to_parquet(os.path.join(OUT, "p01_data.parquet"))
log("저장", X.shape, os.path.join(OUT, "p01_data.parquet"))
