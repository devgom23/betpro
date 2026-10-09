"""패턴분석-02 — 단통 플핸 확률 공식(2026-10-09). 읽기 전용(DB·학습 파일에 쓰지 않는다).

  python .claude/skills/pattern-analysis-02/scripts/p02_run.py            # 저장된 공식·등급표(학습 파일 stats.json의 unified) 보여주기
  python .claude/skills/pattern-analysis-02/scripts/p02_run.py --round    # + 아직 안 치른 경기의 플핸 확률 목록(약 20~40초)
  python .claude/skills/pattern-analysis-02/scripts/p02_run.py --retrain  # 최신 결과로 다시 학습(약 3분, data/master/plhan/ 갱신) 후 보여주기

공식·학습은 api/plhan_score.py(_train_unified)가 한다 — 여기서는 새로 계산하지 않고 그대로 불러 쓴다.
"""
import io
import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
sys.path.insert(0, os.path.join(ROOT, "api"))
sys.path.insert(0, ROOT)
if getattr(sys.stdout, "encoding", "").lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(ROOT, "api"))
import betpro_paths as PATHS  # noqa: E402
import plhan_score as PL  # noqa: E402

TERMS = {"mkt": "시장(12사 마감→Bet365 마감→국내 초기)", "mkt_init": "12사 초기", "mkt_k": "국내 초기", "pt45": "기존 점수 4점↑",
         "axpl": "플축", "axpl_init": "플축(초기 배당신호)", "p85": "플핸85", "first": "첫맞대결"}


def show_stats():
    with open(os.path.join(PL.OUT_DIR, "stats.json"), encoding="utf-8") as f:
        u = json.load(f).get("unified")
    if not u:
        print("학습 파일에 확률 공식이 없습니다 — --retrain 으로 학습하세요.")
        sys.exit(1)
    print(f"학습 {u['trained_at']} · 공식 학습 {u['train_games']:,}경기({u['train_seasons']}) · 시험 {u['test_games']:,}경기({u['test_seasons']})")
    for ph, nm in (("close", "마감판(Bet365 최신배당 있을 때)"), ("init", "초기판(최신배당 전)")):
        m = u[ph]
        print(f"\n[{nm}] logit P = {m['intercept']:+.3f} " + " ".join(f"{t['coef']:+.3f}·{TERMS.get(t['key'], t['key'])}" for t in m["terms"]))
        print("  등급(시험, 시즌마다 그 앞 시즌만 배운 공식)      경기   실제 플핸        예측   시즌당 | 찾기 / 고르기 / 최근 5시즌")
        for k, lb in zip(PL.UNI_GRADE_KEYS, ("75% 이상", "65~75%", "55~65%", "55% 미만")):
            c = u[f"{ph}_grades"][k]
            p = c["periods"]
            per = " / ".join(f"{h}/{n}" for h, n in (p["찾기"], p["고르기"], p["최근"]))
            print(f"  {lb:8s}  {c['n']:6,d}  {c['rate']:5.1f}% ({c['hit']:,})  {c['pred']:5.1f}%  {c['per_season']:7.1f} | {per}")
    for ph, v in u["first_test"].items():
        print(f"\n첫맞대결({ph}): 공식에 {'넣음' if v['used'] else '뺌'} — logloss {v['logloss_without']}→{v['logloss_with']}, "
              f"65%↑ 적중 {v['hi_without'][0]}/{v['hi_without'][1]} → {v['hi_with'][0]}/{v['hi_with'][1]}")
    print("찾기 = " + u["periods"]["찾기"] + " · 고르기 = " + u["periods"]["고르기"] + " · 최근 5시즌 = " + u["periods"]["최근"])
    return u


def upcoming(u):
    X, _df = PL.build_all(PATHS.get_master_db())
    lab = PL._h2h_home(X)
    X["p85"] = PL._plhan85_flags(X, lab)
    ax = PL._axis_flags(PATHS.get_master_db())
    X = X.merge(ax, on=["code", "S", "HT", "AT"], how="left")
    X = X[~X["done"] & X["k_pf"].notna() & (X["S"] == X["S"].max())].copy()
    for c in ("axpl", "axpl_init", "p85"):
        X[c] = X[c].fillna(0).astype(float)
    L = lambda p: PL._logit(p)  # noqa: E731
    mk = {"mkt": L(X["mb_L_pnw"].fillna(X["ef_pd"] + X["ef_pg"]).fillna(X["k_pd"] + X["k_pg"])),
          "mkt_init": L(X["mb_F_pnw"].fillna(X["f_pd"] + X["f_pg"]).fillna(X["k_pd"] + X["k_pg"])), "mkt_k": L(X["k_pd"] + X["k_pg"])}
    has_close = X["ef_pf"].notna()
    # 기존 점수 4점↑은 학습 모델·표본 카드가 필요해 이 스크립트에선 0으로 둔다 — 정확한 값은 상세보기 칩(서버 score)에서 본다.
    out = []
    for ph in ("close", "init"):
        m = u[ph]
        z = np.full(len(X), m["intercept"])
        for t in m["terms"]:
            v = mk[t["key"]] if t["key"] in mk else X.get(t["key"], pd.Series(0.0, index=X.index)).fillna(0).astype(float)
            z = z + t["coef"] * v
        out.append(pd.Series(1 / (1 + np.exp(-z)), index=X.index))
    X["P"] = np.where(has_close, out[0], out[1])
    X["판"] = np.where(has_close, "마감", "초기")
    X = X.sort_values("P", ascending=False)
    print(f"\n[이번 회차 이후 안 치른 경기 {len(X)}경기 — 플핸 확률 높은 순 상위 15 · 기존 점수 4점↑ 근거는 0으로 둠]")
    for r in X.head(15).itertuples():
        flags = " ".join(n for n, f in (("플축", r.axpl), ("플핸85", r.p85)) if f) or "—"
        print(f"  {r.P * 100:5.1f}% [{r.판}] {r.code:10s} {r.R:4s} {str(r.HT).strip()} vs {str(r.AT).strip()}  근거: {flags}")


if __name__ == "__main__":
    if "--retrain" in sys.argv:
        PL.train()
    u = show_stats()
    if "--round" in sys.argv:
        upcoming(u)
