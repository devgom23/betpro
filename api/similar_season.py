"""상세보기 '이번 시즌 유사 경기' — 정배당 기준 · 역배당 기준으로 승무패가 가장 비슷한 이번 시즌 경기를 리그마다 1개씩.

[무엇인가 — 2026-10-10 사용자 지정]
  사용자가 보던 분석 엑셀(스샷/토요일.xlsx)의 '정배 Point · 역배 Point' 옆으로 펼쳐지는 경기 줄을 옮긴 것.
  위 줄 = 이 경기의 국내 정배 배당(승·패 중 낮은 쪽)과 가장 가까운 경기, 아래 줄 = 역배 배당(높은 쪽)과 가장 가까운 경기.
  6대리그 칸마다 1경기씩 — 그날 아스널/리즈를 두고 "1.30에서 한 단계씩 올리며 가장 가까운 경기"를 찾은 방식을 리그별로 한 것.

[고르는 규칙 — 2026-10-10 표본 카드와 같은 '호가 단계'로 바꿈(사용자 지정)]
  - 이번 시즌(같은 S)·결과가 난 경기(RT 1~4)만, 이 경기 자신은 뺀다. 국내 초기 배당(KW·KD·KL)만 본다.
  - 정배가 같은 쪽(홈 정배면 홈 정배 경기만) — 홈/원정이 바뀌면 같은 배당도 뜻이 달라서.
  - 거리는 0.01 칸이 아니라 국내 호가 단계 수(triple_sample.odds_rank — 2.5 미만 0.01 · 2.5~5 0.05 · 5~10 0.10 · 10↑ 0.50).
  - 거르기: 기준 배당(정배 줄=정배, 역배 줄=역배)이 STEP_LIMIT(3)단계 안 + 무 배당이 DRAW_LIMIT(6)단계 안인 경기만
    (2026-10-10 사용자 지정 — 엑셀 제노아/피오렌티나 카드가 기준 배당 1~3단계 안이었다. "무도 들어가야 돼".
     무 6단계는 엑셀 20경기 카드 87장을 읽어 센 값: 무 차이 평균 4.9·중앙값 4단계, 6단계 안이 67%).
  - 리그마다 카드 1경기: 가장 비슷한 경기(승·무·패 세 값 호가 단계 합이 가장 작은 — 표본의 '합 N단계') 중 최근
    (2026-10-10 사용자 지정 — "가장 비슷한 경기 중 최근 순", 표본 카드와 같은 순서).
  - 카드 아래 결과 4칸(핸승·핸무·무·역) = 그 리그에서 위 거르기를 통과한 경기 전부의 결과 수(엑셀 카드 밑 4칸과 같은 뜻).
  - 한 줄에 ROW_MAX(3)칸까지 — 넘치면 합 단계가 작은(전체가 더 닮은) 리그 칸부터 남긴다(엑셀은 한 줄 0~4칸).
  ⚠ 참고 표시일 뿐이다 — 표본 1개짜리라 근거로 쓰지 않는다(메모리 reference-similar-game-search-arsenal-leeds).
"""
import re

import numpy as np
import pandas as pd

import betpro_paths as PATHS
import data_access as DATA
from triple_sample import odds_rank

STEP_LIMIT = 3   # 기준 배당이 허용하는 호가 단계(감으로 정한 값 — 엑셀 카드 1~3단계)
DRAW_LIMIT = 6   # 무 배당이 허용하는 호가 단계(엑셀 카드 87장 중 67%가 이 안)
ROW_MAX = 3      # 한 줄(정배·역배)에 보이는 카드 수 상한


def _digits(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def _num(df, c):
    return pd.to_numeric(df[c], errors="coerce").to_numpy(float) if c in df.columns else np.full(len(df), np.nan)


def _card(r, diff, steps, total):
    def f(v):
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return None if np.isnan(x) else x
    return {
        "league": r.get("Source_League"), "s": r.get("S"), "r": r.get("R"), "dt": r.get("DT"),
        "ht": r.get("HT"), "hs": f(r.get("HS")), "at": r.get("AT"), "as_": f(r.get("AS")), "rt": f(r.get("RT")),
        "kw": f(r.get("KW")), "kd": f(r.get("KD")), "kl": f(r.get("KL")),
        "khw": f(r.get("KHW")), "khd": f(r.get("KHD")), "khl": f(r.get("KHL")),
        "diff": round(diff, 2), "steps": int(steps), "total_steps": int(total),
    }


def for_match(code: str, s: str, r: str, ht: str, at: str, db: str | None = None) -> dict | None:
    db = db or PATHS.get_master_db()
    t = DATA.load_total_df(db)
    if t.empty:
        return None
    season = t[t["S"].astype(str).str.strip() == str(s).strip()]
    hts, ats = season["HT"].astype(str).str.strip(), season["AT"].astype(str).str.strip()
    is_me = ((season["Source_League"] == code) & (hts == str(ht).strip()) & (ats == str(at).strip())
             & (season["R"].map(_digits) == _digits(r)))
    me = season[is_me]
    if me.empty:
        return None
    kw0, kd0, kl0 = (pd.to_numeric(me.iloc[0].get(c), errors="coerce") for c in ("KW", "KD", "KL"))
    if any(pd.isna(v) or v <= 0 for v in (kw0, kd0, kl0)) or kw0 == kl0:
        return None
    home_fav = kw0 < kl0

    pool = season[~is_me]
    kw, kd, kl, rt = _num(pool, "KW"), _num(pool, "KD"), _num(pool, "KL"), _num(pool, "RT")
    ok = (kw > 0) & (kd > 0) & (kl > 0) & (kw != kl) & np.isin(rt, [1, 2, 3, 4]) & ((kw < kl) == home_fav)
    pool, kw, kd, kl, rt = pool[ok], kw[ok], kd[ok], kl[ok], rt[ok]
    fav, dog = np.minimum(kw, kl), np.maximum(kw, kl)
    fav0, dog0 = min(kw0, kl0), max(kw0, kl0)
    step = lambda a, b: np.rint(np.abs(odds_rank(a) - odds_rank(b)))  # noqa: E731
    st_d = step(kd, kd0)                                            # 무 배당 단계
    total = step(kw, kw0) + st_d + step(kl, kl0)                    # 승·무·패 세 값 호가 단계 합
    dkey = pd.to_datetime(pool["DT"].astype(str).str.split(" ").str[0], format="%y-%m-%d", errors="coerce")
    recent = -dkey.fillna(pd.Timestamp(0)).astype("int64").to_numpy() // 10**9   # 작을수록 최근

    out = {"base": {"fav": round(float(fav0), 2), "dog": round(float(dog0), 2), "home_fav": bool(home_fav)},
           "leagues": [{"code": c, "label": PATHS.LEAGUE_LABEL.get(c, c)} for c in PATHS.LEAGUES]}
    for basis, val, base in (("fav", fav, fav0), ("dog", dog, dog0)):
        diff = np.round(val - base, 2)
        st = step(val, base)
        cards = {}
        for c in PATHS.LEAGUES:
            m = (pool["Source_League"].to_numpy() == c) & (st <= STEP_LIMIT) & (st_d <= DRAW_LIMIT)
            if not m.any():
                continue
            idx = np.flatnonzero(m)
            best = idx[np.lexsort((recent[idx], total[idx]))[0]]
            cards[c] = _card(pool.iloc[best].to_dict(), float(diff[best]), st[best], total[best])
            cards[c]["counts"] = [int((rt[idx] == k).sum()) for k in (1, 2, 3, 4)]   # 핸승·핸무·무·역
            cards[c]["_recent"] = int(recent[best])
        keep = sorted(cards, key=lambda c: (cards[c]["total_steps"], cards[c]["_recent"]))[:ROW_MAX]
        for c in cards:
            cards[c].pop("_recent")
        out[basis] = {c: cards[c] for c in cards if c in keep}
    return out

