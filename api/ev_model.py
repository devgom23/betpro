# -*- coding: utf-8 -*-
"""
베팅 기대수익률(EV) 계산.

[왜 필요한가]
  국내 핸디배당은 마진이 약 15%다(내재확률 합계 실측 1.150). 그래서 아무 경기나
  걸면 평균 -13%가 구조적으로 깔린다. 특히 "플핸+핸무를 같이 거는 보험 베팅"은
  3개 결과 중 2개를 덮는 방식이라 마진을 전액 부담한다 — 실측 EV가 배당 구간과
  무관하게 0.86~0.90에 붙어 있고, 이론값 1/1.15=0.870과 일치한다.
  따라서 이 모듈의 목적은 "걸 경기를 추천"하는 게 아니라 "기대값이 마이너스인
  경기를 걸러내"는 데 있다.

[계산 방식]
  확률 = 같은 리그 · 같은 정배배당 구간의 과거 경기에서 실제로 나온 빈도
  EV   = 그 확률 × 이 경기에 실제로 걸린 배당
  EV 1.0 = 본전. 1.0을 넘어야만 장기적으로 이익이다.

  표본은 리그별로 나눈다(리그마다 성격이 크게 다르다 — 똥배 비중이 리그1은 5.8%,
  에레디비지에는 24.6%). 표본이 MIN_SAMPLE 미만이면 계산하지 않고 비워 둔다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import engine   # 26지표 코드 목록(PH_F_CODES/PH_K_CODES)과 표본 하한만 빌려 쓴다

# 정배배당(KW/KL 중 낮은 쪽) 구간. 실측상 이 경계에서 결과 분포가 뚜렷이 갈린다.
ODDS_BINS = [0, 1.15, 1.25, 1.35, 1.50, 1.70, 2.00, 2.50, 99]
ODDS_LABELS = ['~1.15', '1.15~1.25', '1.25~1.35', '1.35~1.49',
               '1.50~1.70', '1.70~2.00', '2.00~2.50', '2.50~']

MIN_SAMPLE = 100        # 이 미만이면 확률 추정을 신뢰하지 않고 공란 처리
RT_MAIN = (1, 2, 3, 4)

# 배당이 말하는 확률 ÷ 그 구간의 과거 실제 확률. 정상 행은 이 비율이 5~95분위에서
# 0.86~1.20에 모여 있다. 이 범위를 크게 벗어나면 시장의 견해차가 아니라 데이터 문제다.
#
# 실제로 걸러지는 대표 사례: KH 컬럼은 핸디 "방향(±1)"만 저장하는데, 초강팀 경기는
# 실제로 -1.5나 -2 라인으로 걸린 경우가 있다(리버풀 KW=1.14인데 핸승 배당 2.50 등).
# 결과(RT)는 1골 라인 기준으로 기록돼 있어 배당과 기준이 어긋나므로 EV를 낼 수 없다.
RATIO_LO, RATIO_HI = 0.6, 1.7

# 결과 컬럼 이름 — 표에 그대로 실린다
EV_COLS = ['EV_WIN', 'EV_DRAW', 'EV_PL', 'EV_COVER', 'EV_BEST', 'EV_N', 'ODD_FLAG']

# 핸승값(RISK) 색상 경계(15/25/35/45%, web/src/.../columnGroups.js에서 색을 칠할 때 씀)의
# 근거 — 실측 검증(6대리그 13,410경기): 안전 10.9%/양호 19.2%/보통 30.1%/주의 40.9%/위험 52.1%
# — 5구간 전부 표시값과 실제 핸승률의 오차가 1.3%p 이내였다.
RISK_COLS = ['RISK', 'WIN_RISK', 'WIN_RISK_F', 'AI_PICK', 'K_VALUE', 'F_VALUE', 'KF_AI']

# ════════════════════════════════════════════════════════════
# 값별 8칸 (2026-08 재편) — 리그 표는 이제 이쪽을 쓴다.
#
# 위 RISK_COLS는 pick_ai.py와 상세보기 팝업이 참조하므로 그대로 둔다.
# 여기 6칸은 덧붙이는 것이고, 정배승 2칸은 WIN_RISK/WIN_RISK_F를 그대로 쓴다.
#
#   정배 승리확률(RT 1+2) : 국)정 = WIN_RISK   해)정 = WIN_RISK_F
#   플핸무 확률(RT 2+3+4) : 국)플 = NH_KO   국)지 = NH_KI   해)지 = NH_FI
#   플 확률(RT 3+4)       : 국)플 = PL_KO   국)지 = PL_KI   해)지 = PL_FI
#
# ⚠ 한 출처 안에서 '정배승'과 '플'은 정확한 여집합이다(실측 상관 -1.0000, 합 100.00%).
#   그래서 승무패 배당은 정배승만 내고, 핸디배당·26지표는 플핸무와 플만 낸다.
#   핸무는 '플핸무 − 플'로 나오므로 칸을 따로 두지 않는다 — 실측상 어느 출처로 보든
#   23~24%에 붙어 있고(5~95% 폭이 5.8~14.3%p뿐) 구분력도 0.49~0.54로 거의 없다.
#
# 실측 보정 오차(가중평균, 6대리그):
#   정배승  국)정 1.66p · 해)정 1.32p
#   플핸무  국)플 1.07p · 국)지 1.32p · 해)지 0.38p
#   플      국)플 1.69p · 국)지 1.45p · 해)지 0.27p   ← 해)지 두 칸이 가장 정확
# ════════════════════════════════════════════════════════════
NEW_RISK_COLS = ['NH_KO', 'NH_KI', 'NH_FI', 'PL_KO', 'PL_KI', 'PL_FI']

# 국정값·해정값(정배가 그냥 이길 확률)을 배AI 평균에 넣기 전에 핸승값과 같은
# 스케일(실제 핸승률 기준)로 맞추는 변환 곡선. 핸승값은 "핸디까지 커버해서 이길
# 확률"이라 정배 승리 확률(국정값·해정값, 평균 52%대)보다 항상 낮게 나온다
# (핸무처럼 이기긴 해도 핸승은 아닌 경우가 섞여 있어서) — 이 변환 없이 그대로
# 평균 내면 핸승값(평균 30%대)과 스케일이 달라 배AI 색상이 핸승값 기준과 어긋난다.
# 실측(6대리그, 국정값+해정값 통합 51,000+경기, 10%p 구간별 실제 핸승률):
#   35%→16.8% / 45%→22.5% / 55%→31.6% / 65%→41.4% / 75%→52.1% / 85%→67.7%
_WIN_TO_HANDSEUNG_X = [35.0, 45.0, 55.0, 65.0, 75.0, 85.0]
_WIN_TO_HANDSEUNG_Y = [16.8, 22.5, 31.6, 41.4, 52.1, 67.7]


def _win_to_handseung(pct: pd.Series) -> pd.Series:
    """국정값/해정값(정배 승리 확률, %)을 핸승값과 같은 실제-핸승률 스케일로 변환한다."""
    arr = pct.to_numpy(dtype='float64')
    out = np.interp(arr, _WIN_TO_HANDSEUNG_X, _WIN_TO_HANDSEUNG_Y)
    return pd.Series(out, index=pct.index).where(pct.notna())


def _num(df: pd.DataFrame, name: str) -> pd.Series:
    if name not in df.columns:
        return pd.Series(np.nan, index=df.index, dtype='float64')
    return pd.to_numeric(df[name], errors='coerce')


def _idx_pl_share(df: pd.DataFrame, codes: list) -> pd.Series:
    """26개 지표 블록에서 '무+역'(=순수 플핸)이 차지하는 비율(%).

    engine.compute_plushandi()가 PH_F/PH_K를 만드는 방식과 똑같이 13개 지표의
    4칸을 전부 더한 뒤, 3번(무)·4번(역) 칸만 분자로 쓴다. 표본 하한도 같은
    PH_MIN_SAMPLE을 써야 PH_F/PH_K와 값이 나오는 경기가 서로 어긋나지 않는다.
    """
    tot = pd.Series(0.0, index=df.index)
    pl = pd.Series(0.0, index=df.index)
    for code in codes:
        for i in range(4):
            col = f'{code} {i + 1}'
            if col not in df.columns:
                continue
            v = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
            tot = tot + v
            if i >= 2:                     # 3=무, 4=역
                pl = pl + v
    share = pl / tot.where(tot > 0) * 100
    return share.where(tot >= engine.PH_MIN_SAMPLE)


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    """EV 계산에 필요한 파생값을 붙인다(원본은 그대로 두고 사본 반환).

    핸디 3way 배당 매핑 — KH는 홈팀에게 주는 핸디캡이라 부호로 정배가 갈린다.
      KH=-1 (홈이 정배): 핸승=KHW, 플핸=KHL
      KH=+1 (원정이 정배): 핸승=KHL, 플핸=KHW
    이 매핑은 실측으로 검증했다(내재 핸승확률 31.0% vs 실제 30.9%, 오차 0.1p.
    좌우를 바꾸면 오차가 14.1p로 벌어진다).
    """
    d = df.copy()
    kw, kl, kh = _num(d, 'KW'), _num(d, 'KL'), _num(d, 'KH')
    khw, khd, khl = _num(d, 'KHW'), _num(d, 'KHD'), _num(d, 'KHL')

    d['_fav'] = pd.concat([kw, kl], axis=1).min(axis=1)
    d['_rt'] = _num(d, 'RT')
    d['_bucket'] = pd.cut(d['_fav'], ODDS_BINS, labels=ODDS_LABELS, right=False)

    # KH가 -1/+1이 아니면(공란 포함) 어느 팀이 핸디를 받았는지 알 수 없어 핸디배당을
    # 핸승/플핸에 배정할 수 없다. 이런 행은 아예 계산 대상에서 뺀다 —
    # 여기서 부호를 넘겨짚으면 반대쪽 배당을 집어 EV가 9.0처럼 터무니없이 나온다.
    kh_ok = kh.isin([-1.0, 1.0])
    home_fav = kh == -1
    d['_o_win'] = np.where(kh_ok, np.where(home_fav, khw, khl), np.nan)
    d['_o_draw'] = np.where(kh_ok, khd, np.nan)
    d['_o_pl'] = np.where(kh_ok, np.where(home_fav, khl, khw), np.nan)

    # 데이터 이상 감지 ①: KH 부호가 가리키는 정배와 1X2 배당이 가리키는 정배가 서로 다른 행.
    mismatch = kh_ok & kw.notna() & kl.notna() & ((kw < kl) != home_fav)
    d['_bad'] = (~kh_ok) | mismatch
    d['_bad_reason'] = np.where(mismatch, '핸디방향', np.where(~kh_ok, '핸디없음', ''))
    return d


def build_table(hist: pd.DataFrame) -> dict:
    """과거 경기(결과 있음)에서 배당구간별 실제 발생 빈도표를 만든다.

    hist는 이미 prepare()를 거친, 그리고 "이 리그" 것만 걸러진 DataFrame이어야 한다.
    반환: {구간라벨: {'n':표본수, 'p_win':핸승확률, 'p_draw':핸무확률, 'p_pl':플핸확률}}
    """
    out = {}
    if hist.empty:
        return out
    done = hist[hist['_rt'].isin(RT_MAIN) & ~hist['_bad']]
    for label, g in done.groupby('_bucket', observed=True):
        n = len(g)
        if n < MIN_SAMPLE:
            continue
        out[str(label)] = {
            'n': int(n),
            'p_win': float((g['_rt'] == 1).mean()),
            'p_draw': float((g['_rt'] == 2).mean()),
            'p_pl': float(g['_rt'].isin([3, 4]).mean()),
        }
    return out


def attach(df: pd.DataFrame, table: dict) -> pd.DataFrame:
    """각 경기에 EV 컬럼과 '핸승 위험도' 컬럼을 붙여 돌려준다(prepare된 df를 받는다).

    EV_WIN/EV_DRAW/EV_PL = 각 단독 베팅의 기대수익률(과거 구간 평균 확률 기준)
    EV_COVER             = 플핸+핸무를 같이 거는 보험 베팅(사장님 실제 방식)의 기대수익률.
                           두 쪽에 나눠 걸어 어느 쪽이 터져도 같은 금액을 회수하는
                           합성배당 1/(1/플핸 + 1/핸무)을 쓴다. 나누는 비율을 어떻게
                           바꿔도 EV는 두 단독 EV의 가중평균이라 이 값 근처를 벗어나지 못한다.
    EV_BEST              = 위 4개 중 최대값 (1.0 미만이면 "걸 게 없는 경기")

    RISK/WIN_RISK/WIN_RISK_F/AI_PICK/K_VALUE/F_VALUE/KF_AI는 build_table(과거 구간 평균)과 무관하게 이 경기
    "자신의" 배당에서 직접 뽑는다 — 구간 평균보다 오차가 훨씬 작다(모듈 상단 주석 참고).
    """
    n = len(df)
    blank = pd.Series(np.nan, index=df.index, dtype='float64')
    res = {c: blank.copy() for c in ('EV_WIN', 'EV_DRAW', 'EV_PL', 'EV_COVER', 'EV_BEST', 'EV_N')}
    res['ODD_FLAG'] = pd.Series([''] * n, index=df.index, dtype=object)
    for c in RISK_COLS + NEW_RISK_COLS:
        res[c] = blank.copy()

    o_win = _num(df, '_o_win').where(lambda s: s > 1)   # 배당 1 이하는 입력 오류(원금도 안 되는 배당은 없다)
    o_draw = _num(df, '_o_draw').where(lambda s: s > 1)
    o_pl = _num(df, '_o_pl').where(lambda s: s > 1)
    margin = 1 / o_win + 1 / o_draw + 1 / o_pl
    no_odds = o_win.isna() | o_draw.isna() | o_pl.isna()

    weird = pd.Series(False, index=df.index)
    if table:
        keys = df['_bucket'].astype(str)
        pw = pd.to_numeric(keys.map(lambda k: table.get(k, {}).get('p_win')), errors='coerce')
        pdr = pd.to_numeric(keys.map(lambda k: table.get(k, {}).get('p_draw')), errors='coerce')
        ppl = pd.to_numeric(keys.map(lambda k: table.get(k, {}).get('p_pl')), errors='coerce')
        cnt = keys.map(lambda k: table.get(k, {}).get('n'))

        # 데이터 이상 감지 ②: 이 경기 배당이 스스로 말하는 확률과 그 구간의 과거 실제
        # 확률이 세 결과 중 하나라도 크게 어긋나면 계산하지 않는다(위 RATIO_LO/HI 주석 참고).
        for o, p in ((o_win, pw), (o_draw, pdr), (o_pl, ppl)):
            ratio = ((1 / o) / margin) / p
            weird |= (ratio < RATIO_LO) | (ratio > RATIO_HI)
        weird = weird.fillna(False)

        ok = ~df['_bad'] & ~weird & ~no_odds
        res['EV_WIN'] = (pw * o_win).where(ok)
        res['EV_DRAW'] = (pdr * o_draw).where(ok)
        res['EV_PL'] = (ppl * o_pl).where(ok)
        cover_odds = 1 / (1 / o_pl + 1 / o_draw)
        res['EV_COVER'] = ((ppl + pdr) * cover_odds).where(ok)
        res['EV_BEST'] = pd.concat(
            [res['EV_WIN'], res['EV_DRAW'], res['EV_PL'], res['EV_COVER']], axis=1
        ).max(axis=1)
        res['EV_N'] = pd.to_numeric(cnt, errors='coerce').where(ok)

    ok_risk = ~df['_bad'] & ~weird & ~no_odds
    res['ODD_FLAG'] = pd.Series(
        np.where(df['_bad'], df['_bad_reason'],
                 np.where(no_odds, '배당없음',
                          np.where(weird, '배당이상', ''))),
        index=df.index, dtype=object)

    # 핸승값 — 이 경기 핸디배당(KHW/KHD/KHL)에서 마진을 제거해 뽑은 핸승 확률(%)
    risk = ((1 / o_win) / margin * 100).where(ok_risk)
    res['RISK'] = risk

    # 국정값 — 핸디캡과 무관하게 "정배가 실제로 이길 확률(%)". KW/KD/KL(국내 승무패 배당)
    # 자체에서 마진을 걷어낸 값이다. 핸승값은 핸디 커버 여부를 묻지만 이건 그냥
    # 실제 스코어로 이기느냐만 묻는 거라 답이 다르다 — KH 방향 판정도 필요 없다
    # (정배는 KW/KL 중 배당이 낮은 쪽으로 그냥 정해진다).
    kw_ = _num(df, 'KW').where(lambda s: s > 1)
    kd_ = _num(df, 'KD').where(lambda s: s > 1)
    kl_ = _num(df, 'KL').where(lambda s: s > 1)
    fav_win_odds_k = pd.concat([kw_, kl_], axis=1).min(axis=1)
    margin_k = 1 / kw_ + 1 / kd_ + 1 / kl_
    win_risk = (1 / fav_win_odds_k) / margin_k * 100
    res['WIN_RISK'] = win_risk

    # 해정값 — 국정값과 같은 계산을 해외 승무패 배당(FW/FD/FL)으로 한 값.
    fw_ = _num(df, 'FW').where(lambda s: s > 1)
    fd_ = _num(df, 'FD').where(lambda s: s > 1)
    fl_ = _num(df, 'FL').where(lambda s: s > 1)
    fav_win_odds_f = pd.concat([fw_, fl_], axis=1).min(axis=1)
    margin_f = 1 / fw_ + 1 / fd_ + 1 / fl_
    win_risk_f = (1 / fav_win_odds_f) / margin_f * 100
    res['WIN_RISK_F'] = win_risk_f

    # 배AI — 핸승값(핸디배당)·국정값(국내 승무패)·해정값(해외 승무패) 중 있는 값들의
    # 평균을 종합 핸승확률로 삼는다. 국정값·해정값은 핸승값과 스케일이 달라(위
    # _win_to_handseung 주석 참고) 평균 내기 전에 먼저 핸승률 스케일로 변환한다.
    # 화면에는 100에서 뺀 "플핸 확률"로 표시한다(플핸이 나올 확률이 높을수록 좋다는 뜻).
    win_risk_adj = _win_to_handseung(win_risk)
    win_risk_f_adj = _win_to_handseung(win_risk_f)
    res['AI_PICK'] = pd.concat([risk, win_risk_adj, win_risk_f_adj], axis=1).mean(axis=1, skipna=True)

    # K값 — 국내 13개 지표(PH_K=비핸승%)를 핸승% 기준으로 뒤집은 값. 참고용(배당이 더 정확).
    # F값 — 해외 13개 지표(PH_F=비핸승%)를 핸승% 기준으로 뒤집은 값. 마찬가지로 참고용.
    ph_k = _num(df, 'PH_K')
    ph_f = _num(df, 'PH_F')
    k_value = 100 - ph_k
    f_value = 100 - ph_f
    res['K_VALUE'] = k_value
    res['F_VALUE'] = f_value

    # KFAI — K값·F값(26개 지표 기반)만으로 낸 종합 핸승확률. 배AI(배당 기반)와는
    # 완전히 다른 신호원이라 따로 구분해 둔다. 화면 표시는 배AI와 동일하게 플핸%.
    res['KF_AI'] = pd.concat([k_value, f_value], axis=1).mean(axis=1, skipna=True)

    # ── 값별 8칸 (모듈 상단 NEW_RISK_COLS 주석 참고) ──
    # 전부 "그 일이 일어날 확률(%)"로 통일해 내려보낸다 — 화면에서 100에서 빼는
    # 뒤집기를 하지 않도록. 정배승 2칸은 위 WIN_RISK/WIN_RISK_F를 그대로 쓴다.
    res['NH_KO'] = 100 - risk                                  # 국)플 — 국내 핸디배당
    res['PL_KO'] = ((1 / o_pl) / margin * 100).where(ok_risk)   # 국)플 — 같은 배당의 플핸 칸
    res['NH_KI'] = ph_k                                        # 국)지 — 저장된 PH_K 그대로
    res['NH_FI'] = ph_f                                        # 해)지 — 저장된 PH_F 그대로
    res['PL_KI'] = _idx_pl_share(df, engine.PH_K_CODES)
    res['PL_FI'] = _idx_pl_share(df, engine.PH_F_CODES)

    out = df.copy()
    for c in EV_COLS + RISK_COLS + NEW_RISK_COLS:
        out[c] = res[c]
    return out.drop(columns=[c for c in out.columns if c.startswith('_')])


def attach_for_league(df: pd.DataFrame) -> pd.DataFrame:
    """리그 하나의 전체 표를 받아 EV 컬럼까지 붙여 돌려주는 편의 함수.

    확률 추정에 쓰는 표본은 "결과가 나온 과거 경기 전부"다. 예정 경기도 같은
    표를 참조해 EV가 계산되므로, 아직 안 열린 경기도 판정할 수 있다.
    """
    p = prepare(df)
    return attach(p, build_table(p))
