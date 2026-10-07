"""패턴분석-01 실행 — 등급 판정 + 기간별 검증표 + 이번 회차 해당 경기. 먼저 p01_build.py로 재료 표를 만든다.
'해외 마감'을 두 가지로 잰다: Bet365판(앱의 해외배당 마감) · 12사판(12개 배당사 마감 평균). 둘 다 출력한다.

  python p01_run.py                 검증표 + 이번 회차(앞으로 10일) 경기
  python p01_run.py --model         S등급(학습 모델)까지 — 시즌마다 그 앞 시즌만으로 학습해 검증(약 2~4분)
  python p01_run.py --harmony       '국내 초기 정배 × 마감 그 팀 배당' 조화표(Bet365판·12사판)도 출력
"""
import io
import os
import sys
import tempfile
import warnings
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
if getattr(sys.stdout, "encoding", "").lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
OUT = os.environ.get("P01_OUT") or os.path.join(tempfile.gettempdir(), "betpro_pattern01")
ARGS = set(sys.argv[1:])
pd.set_option("display.width", 280)
pd.set_option("display.max_colwidth", 60)

# ── 패턴분석-01 기준값(2026-10-07 확정 — 바꾸면 '패턴분석-01'이 아니다) ──────────────────
CLOSE_DSHARE = 0.467     # 국내 접전형: 국내 초기 '정배 못 이김' 중 무의 몫 ≤ 0.467 ⇔ 역배 배당 ≤ 무 배당 × 0.876
DROP_B = -0.045          # Bet365판 B: 해외(Bet365) 마감 정배확률 − 국내 초기 정배확률 ≤ −4.5%p
DROP_C1 = -0.03          # C1: 같은 하락 ≤ −3%p
DROP_12 = -0.045         # 12사판 B12: 12사 마감 평균 정배확률 − 국내 초기 ≤ −4.5%p
DROP_12S = -0.065        # 12사판 B12s: ≤ −6.5%p (찾기·고르기 기간만 보고 고른 문턱)
DRAW_A = 0.277           # A: 12사 마감 평균 무 확률 ≥ 27.7%(12사 평균 무 배당 약 3.40 이하)
MODEL_S = 0.72           # S: B 안에서 학습 모델 확률 ≥ 0.72
DISC_MAX, SEL_MAX = 18, 21
LG = {"EPL": "EPL", "LALIGA": "라리가", "SERIEA": "세리에", "BUNDES": "분데스", "EREDIVISIE": "에레디비", "LIGUE1": "리그1"}

ALL = pd.read_parquet(os.path.join(OUT, "p01_data.parquet"))
ALL = ALL[ALL["hf"].notna()].copy()
ALL["period"] = np.where(ALL["sidx"] <= DISC_MAX, "찾기", np.where(ALL["sidx"] <= SEL_MAX, "고르기", "확인"))
close = ALL["k_dshare"] <= CLOSE_DSHARE
d365, d12 = ALL["x_ef_k_pf"], ALL["mb_k_dpf"]
ALL["B"] = close & (d365 <= DROP_B)
ALL["A"] = ALL["B"] & (ALL["mb_Lpd"] >= DRAW_A)
ALL["C1"] = close & (d365 <= DROP_C1)
ALL["C2"] = ALL["ef_flip"] == 1
ALL["B12s"] = close & (d12 <= DROP_12S)
ALL["A12s"] = ALL["B12s"] & (ALL["mb_Lpd"] >= DRAW_A)
ALL["B12"] = close & (d12 <= DROP_12)
ALL["A12"] = ALL["B12"] & (ALL["mb_Lpd"] >= DRAW_A)
ALL["C1_12"] = close & (d12 <= DROP_C1)
ALL["C2_12"] = ALL["mb_Lflip"] >= 0.5
ALL["BOTH_S"] = close & (d365 <= DROP_12S) & (d12 <= DROP_12S)
DONE = ALL["done"] & (ALL["orient_ok"] != 0)

# ── S등급용 학습 모델(Bet365판 +마감배당 재료 109개, 분석 때와 같은 설정) ──────────────────
FEAT_PRE = ("k_", "kh_", "f_", "fh_", "x_k_f_", "ek_", "ekh_", "ef_", "efh_", "x_ek_", "x_ef_", "x_f_ek", "mv_")
META = {"code", "S", "R", "HT", "AT", "No", "key", "date", "TM", "sidx", "RT", "HS", "AS", "done", "y", "orient_ok", "hf", "period"}
FEATS = [c for c in ALL.columns if c not in META and c.startswith(FEAT_PRE) and pd.api.types.is_numeric_dtype(ALL[c])]
PARAMS = dict(n_estimators=500, max_depth=4, learning_rate=0.03, subsample=0.8, colsample_bytree=0.6,
              min_child_weight=30, reg_lambda=5.0, tree_method="hist", n_jobs=8, eval_metric="logloss")
ALL["p_model"] = np.nan
if "--model" in ARGS:
    import xgboost as xgb
    D = ALL[DONE]
    for s in range(15, int(ALL["sidx"].max()) + 1):
        tr, te = D[D["sidx"] < s], D[D["sidx"] == s]
        if len(te) == 0:
            continue
        m = xgb.XGBClassifier(**PARAMS).fit(tr[FEATS], tr["y"])
        ALL.loc[te.index, "p_model"] = m.predict_proba(te[FEATS])[:, 1]
    up = ALL[~ALL["done"]]
    if len(up):   # 앞으로 치를 경기는 지금까지 끝난 경기 전부로 학습한 모델로
        m = xgb.XGBClassifier(**PARAMS).fit(D[FEATS], D["y"])
        ALL.loc[up.index, "p_model"] = m.predict_proba(up[FEATS])[:, 1]
    print(f"학습 모델 재료 {len(FEATS)}개(분석 때 109개) · 검증은 15시즌부터 · 돌릴 때마다 ±1%p 흔들림", flush=True)
ALL["S"] = ALL["B"] & (ALL["p_model"] >= MODEL_S)

# ── 1. 등급별 검증표 ──────────────────────────────────────────────────────────
TIERS = [
    ("Bet365판", "S", "B + 학습 모델 0.72↑"),
    ("Bet365판", "A", "B + 12사 마감 무 확률 27.7%↑"),
    ("Bet365판", "B", "국내 접전형 + 해외(Bet365) 마감 정배확률 −4.5%p↓"),
    ("Bet365판", "C1", "국내 접전형 + 해외 마감 −3%p↓"),
    ("Bet365판", "C2", "해외 마감 정배가 국내 초기와 반대"),
    ("12사판", "A12s", "B12s + 12사 마감 무 확률 27.7%↑"),
    ("12사판", "B12s", "국내 접전형 + 12사 마감 평균 정배확률 −6.5%p↓"),
    ("12사판", "A12", "B12 + 12사 마감 무 확률 27.7%↑"),
    ("12사판", "B12", "국내 접전형 + 12사 마감 평균 −4.5%p↓"),
    ("12사판", "C1_12", "국내 접전형 + 12사 마감 평균 −3%p↓"),
    ("12사판", "C2_12", "12사 절반 이상이 마감에 정배 반대"),
    ("함께", "BOTH_S", "Bet365·12사 둘 다 −6.5%p↓"),
]
X = ALL[DONE]
rows = []
for pan, t, desc in TIERS:
    s = X[X[t]]
    if len(s) == 0:
        continue
    seasons = X.loc[X["p_model"].notna(), "sidx"].nunique() if t == "S" else X["sidx"].nunique()
    r = {"판": pan, "등급": t, "조건": desc, "경기": len(s), "시즌당": round(len(s) / max(seasons, 1), 1)}
    for p in ("찾기", "고르기", "확인"):
        q = s[s["period"] == p]
        r[p] = round(q["y"].mean() * 100, 1) if len(q) else np.nan
    r["전체"] = round(s["y"].mean() * 100, 1)
    for k, lab in ((1, "핸승"), (3, "무"), (4, "역")):
        r[lab] = round((s["RT"] == k).mean() * 100, 1)
    lg = s.groupby("code")["y"].mean() * 100
    r["리그"] = f"{lg.min():.0f}~{lg.max():.0f}"
    rows.append(r)
print("\n== 패턴분석-01 등급별 플핸(무+역) 적중률 — 찾기 09-10~18-19 · 고르기 19-20~21-22 · 확인 22-23~")
print(pd.DataFrame(rows).to_string(index=False))
print("\n기준값(2026-10-07) Bet365판: S 80.1~81.1%(175~181) · A 77.8%(500) · B 74.6%(747) · C1 70.9%(1,298) · C2 69.5%(1,599)")
print("              12사판: A12s 82.3%(147) · B12s 79.5%(259) · A12 77.2%(500) · B12 73.5%(769) · C1_12 70.1%(1,425) · C2_12 69.3%(1,845) · 둘다 77.6%(219)")
cur = int(X["sidx"].max())
cs = X[(X["sidx"] == cur)]
print(f"이번 시즌({cur}) 결과 난 경기: " + " · ".join(
    f"{t} {int(cs[t].sum())}경기 {cs.loc[cs[t], 'y'].mean()*100:.0f}%" if cs[t].sum() else f"{t} 0경기" for _, t, _ in TIERS))

# ── 1-2. 최근 5시즌만 — 시즌별(2026-10-07 사용자 지정: "5시즌 결과도 같이 저장") ─────────────────
last5 = sorted(X["sidx"].dropna().unique())[-5:]
R5 = X[X["sidx"].isin(last5)]
rows = []
for pan, t, desc in TIERS:
    s = R5[R5[t]]
    if len(s) == 0:
        continue
    r = {"판": pan, "등급": t, "경기": len(s), "플핸": int(s["y"].sum()), "플핸%": round(s["y"].mean() * 100, 1),
         "핸승": int((s["RT"] == 1).sum()), "핸무": int((s["RT"] == 2).sum())}
    for k in last5:
        g_ = s[s["sidx"] == k]
        r[f"{int(k)}-{int(k) + 1}"] = f"{g_['y'].mean()*100:.0f}%({len(g_)})" if len(g_) else "-"
    rows.append(r)
print(f"\n== 최근 5시즌({int(last5[0])}-{int(last5[0]) + 1}~{int(last5[-1])}-{int(last5[-1]) + 1}) 등급별 · 칸 = 플핸%(경기 수) · 핸승·핸무 = 실패")
print(pd.DataFrame(rows).to_string(index=False))
print(f"최근 5시즌 전체 {len(R5):,}경기 플핸 {R5['y'].mean()*100:.1f}% · 국내 접전형 {int((R5['k_dshare'] <= CLOSE_DSHARE).sum()):,}경기 "
      f"{R5.loc[R5['k_dshare'] <= CLOSE_DSHARE, 'y'].mean()*100:.1f}%")
print("기준값(2026-10-07, 22-23~26-27): A12s 94.1%(17) · B12s 84.6%(52) · 둘다 82.2%(45) · S 80.0%(65) · A 78.2%(78) · A12 75.3%(73)"
      " · C2 74.7%(344) · C2_12 73.2%(403) · B 72.9%(177) · B12 71.3%(181) · C1 68.9%(341) · C1_12 68.0%(384) / 전체 46.0% · 국내 접전형 59.2%")

# ── 2. 조화표(선택) ───────────────────────────────────────────────────────────
if "--harmony" in ARGS:
    kb = [1.0, 1.5, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.6]
    eb = [1.0, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 10]
    for col, nm in (("ef_f", "해외(Bet365) 마감"), ("m12_f", "12사 마감 평균")):
        H = X.assign(kb=pd.cut(X["k_f"], kb, right=False), eb=pd.cut(X[col], eb, right=False)).dropna(subset=["kb", "eb"])
        t = H.groupby(["kb", "eb"], observed=True)["y"].agg(["mean", "size"])
        tab = t.apply(lambda r: f"{r['mean']*100:3.0f}%({int(r['size']):4d})" if r["size"] >= 30 else "    -     ", axis=1).unstack("eb")
        print(f"\n== 조화표: 국내 초기 정배 배당(행) × {nm} '그 정배 팀' 배당(열) → 플핸 비율(경기 수)")
        print(tab.fillna("    -     ").to_string())

# ── 3. 이번 회차(앞으로 치를 경기) ───────────────────────────────────────────────
today = pd.Timestamp(datetime.now().date())
U = ALL[(~ALL["done"]) & (ALL["date"] >= today - timedelta(days=1)) & (ALL["date"] <= today + timedelta(days=10))].copy()
if len(U) == 0:
    print("\n앞으로 10일 안에 치를 경기가 DB에 없습니다.")
    sys.exit(0)


def need(r, drop, margin_col):
    """그 판에서 등급이 되려면 마감에 '그 정배 팀' 배당이 대략 얼마 이상이어야 하나(무·역배 몫은 초기 비율 유지 가정)."""
    if np.isnan(r["k_pf"]):
        return np.nan
    p = r["k_pf"] + drop
    m = r[margin_col] if margin_col in r and not np.isnan(r[margin_col]) else 1.05
    return 1 / (p * m)


U["m12F_m"] = 1 / U["m12F_f"] + 1 / U["m12F_d"] + 1 / U["m12F_g"]
out = []
for _, r in U.sort_values(["date", "TM"]).iterrows():
    g365 = next((t for t in ("S", "A", "B", "C1", "C2") if r[t]), "")
    g12 = next((t for t in ("A12s", "B12s", "A12", "B12", "C1_12", "C2_12") if r[t]), "")
    cl = bool(r["k_dshare"] <= CLOSE_DSHARE)
    out.append({
        "날짜": str(r["date"])[5:10], "리그": LG.get(r["code"], r["code"]), "R": r["R"], "경기": f'{r["HT"]}-{r["AT"]}',
        "국내초기": f'{r["raw_KW"]:.2f}/{r["raw_KD"]:.2f}/{r["raw_KL"]:.2f}' if not np.isnan(r["raw_KW"]) else "없음",
        "접전형": "O" if cl else "",
        "Bet365마감": f"{r['ef_f']:.2f}" if not np.isnan(r["ef_f"]) else "없음",
        "B기준": f"{need(r, DROP_B, 'f_m'):.2f}↑" if cl else "",
        "12사마감": f"{r['m12_f']:.2f}" if not np.isnan(r["m12_f"]) else "없음",
        "B12s기준": f"{need(r, DROP_12S, 'm12F_m'):.2f}↑" if cl else "",
        "하락365": f"{r['x_ef_k_pf']*100:+.1f}" if not np.isnan(r["x_ef_k_pf"]) else "",
        "하락12": f"{r['mb_k_dpf']*100:+.1f}" if not np.isnan(r["mb_k_dpf"]) else "",
        "12사무%": f"{r['mb_Lpd']*100:.1f}" if not np.isnan(r["mb_Lpd"]) else "",
        "모델": f"{r['p_model']:.2f}" if not np.isnan(r["p_model"]) else "",
        "Bet365판": g365, "12사판": g12,
    })
O = pd.DataFrame(out)
n_nodom = int((O["국내초기"] == "없음").sum())
print(f"\n== 이번 회차(오늘 {today:%m-%d} 기준 앞으로 10일) {len(O)}경기 · 국내 초기 배당 아직 없음 {n_nodom}경기")
show = O[(O["Bet365판"] != "") | (O["12사판"] != "") | (O["접전형"] == "O")]
print("등급 붙은 경기와 '국내 접전형'(감시 대상)만:")
print(show.to_string(index=False) if len(show) else "해당 경기 없음")
print("※ 국내 초기가 '없음'이면 아직 국내 배당이 안 올라온 경기 — 올라온 뒤 다시 돌린다."
      " 마감이 '없음'이면 배변(최신배당)을 안 불러온 것 — 킥오프 가까이 불러온 뒤 다시."
      " 'B기준'·'B12s기준'은 마감에서 그 정배 팀 배당이 이 값 이상이면 그 등급이 된다는 대략치.")
