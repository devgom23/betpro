# -*- coding: utf-8 -*-
"""
종합픽 — 픽 선택에 쓰는 4가지 신호를 한 화면에 모아 정리한다.

[왜 이렇게 만들었나]
  사장님이 픽을 고를 때 보시는 것은 ① 핸승 위험도 ② 지표별 표본의 치우침
  ③ 상대전적 ④ 홈/원정팀 최근 연승·연패, 이렇게 넷이다. 이 넷을 그냥 더해서
  하나의 점수로 만들면 안 된다 — 넷의 신뢰도가 전혀 다르기 때문이다.

  6대리그 36,088경기로 "배당이 똑같이 평가한 경기들만 모아놓고 비교해도 그 신호로
  결과가 갈리는가"를 실측했다(배AI 구간을 통제한 뒤 신호별 실제 핸승률 비교):

    · 배당(배AI)  — 거의 그대로 맞는다. 배AI 20/30/40/55% 구간의 실제 핸승률이
                    19.9/29.3/39.3/55.3%로, 배AI 값 자체가 이미 확률로 읽힌다.
    · 해외지표    — 배AI를 통제해도 3.9~6.2%p 격차가 남는다. 약하지만 실재한다.
                    단 쓰는 단계는 해/통)승·패(기준)와 해)승·패(리그 특성 보정) 둘뿐이다.
                    승+패·승+무+패는 배당이 이미 아는 정보라 계산에서 뺐다(화면엔 표시).
    · 상대전적    — 핸승 예측에는 못 쓴다. 승/무/패든 홈기준 승/무/패든 '같은 정배였던
                    맞대결의 커버율'이든, 배당 위에 얹어주는 값이 전부 0에 가깝다
                    (_h2h_goal_profile 주석에 신호별 실측 수치). 상대전적이 하는 말을
                    배당이 이미 다 알고 있기 때문이다. 남는 건 '맞대결 평균 총득점'
                    하나뿐이고 그것도 무(RT=3) 쪽에만 작게 듣는다 — 화면에만 보여준다.
    · 연승/연패   — 방향이 구간마다 뒤집힌다(정배 3연패가 어떤 구간은 16.8%,
                    다른 구간은 30.1%). 배당에 이미 반영돼 있어 추가 정보가 없다.
    · 국내지표    — 표본이 쌓인 경기가 37%뿐인 데다, 그 표본에서는 방향이 해외지표와
                    반대로 나온다(TK-W 기준 배AI 25~35% 구간에서 지표핸승 '낮음'이
                    실제 36.7%, '높음'이 27.1%). 해외지표와 상관 0.774로 같은 것을
                    보는데도 방향이 어긋난다 — 표본 편향으로 보이며 신뢰할 수 없어
                    계산에서 뺀다(화면에는 표본 수만 알린다).
    · 핸무        — 어떤 신호로 나눠도 격차가 0.2~4.2%p뿐. 예측 대상에서 뺀다. 배당이
                    보는 무 확률이 17%에서 33%로 두 배가 되는 동안에도 핸무는 22.7~24.3%
                    사이에서 꼼짝하지 않는다(35,852경기). 사실상 상수다.

  그래서 이 모듈은 배당을 기준선으로 고정하고, 해외지표 하나로만 작게 보정한다.
  국내지표·상대전적·시즌전적은 화면에 보여주되 숫자에는 넣지 않는다.

[건드리지 않는 것]
  engine.py의 26개 지표, ev_model.py의 핸승 위험도는 전혀 수정하지 않는다.
  이 모듈은 이미 계산되어 저장된 값들을 읽어 요약할 뿐이다.
"""
from __future__ import annotations

import math
import re

import numpy as np

# ── 배AI → 실제 핸승률 보정표 (6대리그 36,088경기 실측) ──
# 배AI는 이미 확률로 잘 맞아서 거의 항등에 가깝다. 다만 아주 낮은 구간(20% 미만)만
# 실제보다 낮게 나와서(배AI 10%대 → 실제 16.5%) 그 부분을 끌어올린다.
_CAL_X = [10.0, 22.5, 27.5, 32.5, 40.0, 55.0, 70.0]
_CAL_Y = [16.5, 22.3, 26.8, 32.6, 39.3, 55.3, 70.0]

MIN_H2H_SAMPLE = 3      # 이 미만이면 상대전적을 판단에서 뺀다

# 리그별 평균 총득점 — 상대전적 카드가 "이 맞대결은 골이 많이 나는 편인가"를 판정할 때
# 쓰는 기준선(AV). 6대리그 35,867경기 실측. 리그마다 0.5골 가까이 차이가 나서(리그1 2.62골
# vs 에레디비지 3.10골) 하나의 상수로는 못 쓴다.
_LEAGUE_AVG_GOALS = {
    "EPL": 2.80, "LALIGA": 2.67, "SERIEA": 2.69,
    "BUNDES": 3.02, "EREDIVISIE": 3.10, "LIGUE1": 2.62,
}
_AVG_GOALS_DEFAULT = 2.80   # 6대리그 전체 평균 — 내 데이터 등 리그를 모를 때
# 리그 평균에서 이만큼 벗어나면 저득점/다득점으로 본다. 맞대결 2,530쌍 기준 이 폭이면
# 저득점 26.9% / 보통 51.9% / 다득점 21.2%로 갈려서 세 칸이 고르게 찬다.
H2H_GOAL_BAND = 0.4

# 보정 상한 — 실측 격차(지표 3.9~6.2%p)를 넘지 않게 묶는다.
# 상대전적 보정(CAP_H2H)과 합치 보너스(CAP_CONSENSUS)는 실측 근거가 없어 계산에서
# 빠졌고, 그에 딸린 상수·헬퍼도 같이 지웠다(compute()의 ③·⑤ 주석 참고).
CAP_IND = 4.0
CAP_TOTAL = 10.0

# 계단식 보정 비율 — 해)승·패 표본이 "기준(root)인 해/통)승·패 표본" 대비 몇 %면 그 단계를
# 절반쯤 반영할지(_blend의 k). 6대리그 실측에서 리그마다 원래 표본 규모(에레디비지 vs EPL
# 등)는 최대 2배 가까이 달라도 이 비율 자체는 거의 같았다(14~18%, 6개 리그 중앙값).
# 절대 표본 수(예: "40경기") 대신 이 비율로 기준을 잡으면, 원래 표본이 적은 리그·시즌
# 초반에도 자동으로 눈높이가 낮아져서 리그별로 따로 상수를 관리할 필요가 없다.
#
# 승+패·승+무+패 단계의 비율 상수는 뺐다 — 그 두 단계를 계산에서 제외했기 때문이다
# (_foreign_indicator 안의 실측 주석 참고).
IND_RATIO_SINGLE_OVER_TOTAL = 0.16


def _num(v):
    """숫자로 못 읽는 값(빈칸·문자열)은 전부 None."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _interp(x, xs, ys):
    if x is None:
        return None
    return float(np.interp(x, xs, ys))


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _ind_counts(row, code):
    """지표 하나의 표본 4칸(핸승/핸무/무/역)을 읽어 (핸승수, 총수)로."""
    vals = []
    for i in (1, 2, 3, 4):
        v = _num(row.get(f"{code} {i}"))
        vals.append(0.0 if v is None else v)
    return vals, sum(vals)


# 지표 하나의 "핸승 예상 %"를 핸승 비율만으로 보지 않고, 핸무·무·역 비율까지 반영해서
# 계산하는 회귀식 계수 — 6대리그 35,428경기를 leave-one-out(그 경기 자신은 표본에서
# 뺀 채) 방식으로 "핸무·무·역 비율이 늘 때 실제 핸승률이 얼마나 떨어지는지" 선형회귀로
# 실측했다(경기 자신이 자기 조건에 트리비얼하게 포함되는 걸 배제한 정직한 검증).
#   해/통) 지표(표본 큰 광범위 지표): 절편 77.8, 핸무 -24.6, 무 -86.9, 역 -95.0
#   해) 지표(단일 리그 지표):        절편 62.3, 핸무 -11.4, 무 -53.7, 역 -77.3
# 핸무는 핸승에 가까운 결과라 약하게만 나쁜 신호지만, 무·역은 둘 다 "언더독이 진짜
# 잘한 경기"라 거의 똑같이 강하게 나쁜 신호였다 — 감으로 정한 "역이 핸무의 2배"보다
# 실제로는 4~7배 격차였고, 무와 역은 오히려 거의 동급(1.1~1.4배)이었다.
# 해)승+패·해)승+무+패는 표본이 작아 따로 회귀를 낼 수 없어, 같은 "해당 리그" 소속인
# 해)승·해)패와 같은 계수를 쓴다.
_REG_TOTAL = {"intercept": 77.8, "hm": -24.6, "mu": -86.9, "yk": -95.0}   # 해/통)
_REG_SINGLE = {"intercept": 62.3, "hm": -11.4, "mu": -53.7, "yk": -77.3}  # 해) 단일·승+패·승+무+패

# 국내지표(국/통)승·패, TK-W/TK-L)는 해외지표와 달리 리그마다 회귀계수가 크게 다르다
# (6대리그 실측 — 리그당 표본 1,287~4,626건, leave-one-out). "핸무" 계수 부호까지
# 라리가(-19.3)와 세리에A(+34.6)에서 정반대로 나와서, 해외지표처럼 전 리그 공통 계수
# 하나로 뭉뚱그리면 안 되고 리그별로 따로 쓴다. 국)승·패(리그 단일)·국)승+패·국)승+무+패는
# 표본이 리그당 0~260건뿐이고 상관관계도 리그마다 들쭉날쭉(-0.57~+0.71)해서 회귀식을
# 못 냈다 — 화면 표에는 그대로 보여주되(사장님이 직접 판단), 계산엔 통합(국/통) 리그별
# 계수를 그대로 재사용한다.
_REG_DOMESTIC_BY_LEAGUE = {
    "LIGUE1":     {"intercept": 45.3, "hm": 11.3,  "mu": -3.8,  "yk": -81.4},
    "BUNDES":     {"intercept": 50.2, "hm": 34.1,  "mu": -35.1, "yk": -78.5},
    "SERIEA":     {"intercept": 43.6, "hm": 34.6,  "mu": -25.9, "yk": -78.4},
    "EPL":        {"intercept": 49.8, "hm": 22.8,  "mu": -37.1, "yk": -71.7},
    "LALIGA":     {"intercept": 66.8, "hm": -19.3, "mu": -61.9, "yk": -85.1},
    "EREDIVISIE": {"intercept": 64.1, "hm": 1.8,   "mu": -50.1, "yk": -93.0},
}
_REG_DOMESTIC_DEFAULT = {"intercept": 53.3, "hm": 14.2, "mu": -35.7, "yk": -81.4}  # 6개 리그 평균(리그 코드 모를 때)


def _level_hit_pct(vals, total, reg):
    """지표 하나의 표본(vals=[핸승,핸무,무,역], total)을 회귀식(reg)에 넣어
    '핸승 예상 %'를 낸다 — 핸승 비율뿐 아니라 핸무·무·역 비율까지 반영한다."""
    if total <= 0:
        return 0.0
    frac_hm, frac_mu, frac_yk = vals[1] / total, vals[2] / total, vals[3] / total
    pred = reg["intercept"] + reg["hm"] * frac_hm + reg["mu"] * frac_mu + reg["yk"] * frac_yk
    return _clamp(pred, 0.0, 100.0)


def _blend_weight(level_total, k):
    """레벨 표본(level_total)이 k(그 레벨의 '적당한 크기' 기준)만큼이면 0.5, 그보다
    많으면 더 크게, 적으면 더 작게 — _blend와 _blend_vec이 같은 가중치를 쓰도록
    한곳에 모아둔다."""
    return level_total / (level_total + k) if level_total > 0 else 0.0


def _blend(est, level_total, level_hit, k):
    """레벨 표본(level_total)을 k에 비례해서 기존 추정치(est)에 섞는다. 원 표본 숫자를
    그대로 더하지 않고 비율(적중률)만 섞기 때문에, 지표끼리 포함관계(예: 해)승+무+패
    표본은 전부 해)승 표본에도 들어있음)여도 같은 경기를 중복으로 세지 않는다."""
    w = _blend_weight(level_total, k)
    return level_hit * w + est * (1 - w) if level_total > 0 else est


def _blend_vec(prev_vec, level_total, level_vec, k):
    """_blend와 같은 가중치로, [핸승,핸무,무,역] 네 값을 한꺼번에 섞는다 — 화면 표의
    '종합' 행(각 단계를 실제로 얼마나 반영했는지 그대로 보여주는 가중평균)에 쓴다."""
    if level_total <= 0:
        return prev_vec
    w = _blend_weight(level_total, k)
    return [lv * w + pv * (1 - w) for pv, lv in zip(prev_vec, level_vec)]


def _foreign_indicator(row, scope):
    """해외지표 계단식 보정.

    조건이 빡빡한(표본이 적지만 이 경기와 더 닮은) 지표일수록 '기준 표본 대비 얼마나
    큰지'에 비례해서만 영향을 주고, 조건이 느슨한(표본이 많지만 덜 구체적인) 지표를
    출발점으로 삼는다 — 그래서 표본이 딱 40개를 못 넘겨도 통째로 버려지지 않고, 있는
    만큼은 결과에 스며든다.

    정배 방향(오늘 W쪽이 정배인지 L쪽이 정배인지)에 맞는 지표 계열만 쓴다 — 승·패
    지표는 서로 다른 배당 컬럼(FW/FL) 기준이라 정배가 반대쪽이면 표본 자체가 안 맞는다.
    승+패·승+무+패는 두 컬럼을 동시에 맞추는 조건이라 정배 방향과 무관하게 고정이다.

    반환: (ind_used, hit_pct, ind_levels)
      ind_used   : (code, label, vals, total) — 출발점(root)으로 쓴 지표. None이면 판단 불가.
      hit_pct    : 계단식으로 보정된 최종 핸승률(%).
      ind_levels : 화면 근거표용 — [{code,label,sample,hs_pct,hm_pct,mu_pct,yk_pct}, ...],
                   표시 순서(승/승+패/승+무+패/통합승)로 4단계 전부 담는다 — 표본이
                   0인 단계는 0/0/0/0으로 그대로 담는다.
    """
    fw = _num(row.get("FW"))
    fl = _num(row.get("FL"))
    if fw is None or fl is None or fw == fl:
        return None, None, []
    fav_col = "W" if fw < fl else "L"
    single_code, single_label = ("F-W", "승") if fav_col == "W" else ("F-L", "패")
    total_code, total_label = ("TF-W", "통) 승") if fav_col == "W" else ("TF-L", "통) 패")

    single_vals, single_total = _ind_counts(row, single_code)
    wl_vals, wl_total = _ind_counts(row, "F-WL")
    wdl_vals, wdl_total = _ind_counts(row, "F-WDL")
    # scope='user'는 리그 하나뿐이라 통합(TF-*) 지표가 F-*와 항상 같은 값이라 안 쓴다
    # (지표별 표본에서 TF-*/TK-* 행을 숨기는 것과 같은 이유 — compute() 문서 참고).
    total_vals, total_total = (None, 0) if scope == "user" else _ind_counts(row, total_code)

    def raw_pcts(vals, total):
        return [v / total * 100.0 for v in vals]

    if total_total > 0:
        est = _level_hit_pct(total_vals, total_total, _REG_TOTAL)
        raw = raw_pcts(total_vals, total_total)   # [핸승,핸무,무,역] 가중평균 — 화면 '종합' 행용
        root_total = total_total
        used = (total_code, total_label, total_vals, total_total)
        if single_total > 0:
            k = max(1.0, root_total * IND_RATIO_SINGLE_OVER_TOTAL)
            est = _blend(est, single_total, _level_hit_pct(single_vals, single_total, _REG_SINGLE), k)
            raw = _blend_vec(raw, single_total, raw_pcts(single_vals, single_total), k)
    elif single_total > 0:
        est = _level_hit_pct(single_vals, single_total, _REG_SINGLE)
        raw = raw_pcts(single_vals, single_total)
        root_total = single_total
        used = (single_code, single_label, single_vals, single_total)
    else:
        return None, None, []

    # ⚠ 승+패(F-WL)·승+무+패(F-WDL)는 계산에 넣지 않는다 — 화면 표에는 그대로 보여준다.
    #   [실측 근거] 저장된 지표 표본에는 그 경기 자신이 항상 들어 있어(자기 배당과 자기
    #   배당은 같으니까) 그대로 봐도, 자기만 1건 빼도 편향이 생긴다. 그래서 35,570경기를
    #   시즌·라운드 순으로 훑으며 "그 경기 이전 경기만"으로 표본을 다시 쌓아 검증했다.
    #     · 표본이 너무 적다 — 그 시점까지 쌓인 중앙값이 승+패 6건, 승+무+패 2건뿐이고
    #       10건이라도 모이는 경기가 각각 34.9%, 17.5%에 불과하다.
    #     · 신호가 없다 — 배당을 통제한 회귀에서 t값이 전부 1.4 미만.
    #     · 세게 줄수록 나빠진다 — 검증 시즌 Brier가 기준선 대비 안 씀 -0.29‰ /
    #       현재값 -0.40‰ / 5배 세게 -0.48‰ / 완전반영 -0.55‰로 단조롭게 악화.
    #       400개 조합 격자탐색에서도 상위 8개 중 7개가 "승+패 안 씀"이었다.
    #     · 6대리그를 합친 해/통)승+패(중앙값 29건)·해/통)승+무+패(10건)로 표본을 5배
    #       키워도 t값 1.4 미만으로 똑같았다. 표본이 적어서가 아니라 배당과 같은 정보라서
    #       안 나온다 — 승+패는 '승·패 배당이 둘 다 같은 경기'라 배당 기준선도 같다.
    #   남는 건 해/통)승·패(기준)와 해)승·패(리그 특성 보정, 넓은 단계 위에서 t=2.36)뿐이다.

    # 표본이 0인 단계도 국내지표와 똑같이 0/0/0/0으로 그대로 보여준다 — 표에서 아예
    # 빠지면 "이 단계 자체가 없나 보다"로 헷갈릴 수 있다.
    # 순서는 넓은 단계 → 좁은 단계. 계산이 통합(root)에서 출발해 조건을 좁혀가며 섞는
    # 순서와 같아서, 표를 위에서 아래로 읽으면 값이 어떻게 만들어졌는지 그대로 따라간다.
    levels = []
    for code, label, vals, total in [
        (total_code, total_label, total_vals, total_total),
        (single_code, single_label, single_vals, single_total),
        ("F-WL", "승+패", wl_vals, wl_total),
        ("F-WDL", "승+무+패", wdl_vals, wdl_total),
    ]:
        if total > 0:
            levels.append({
                "code": code, "label": label, "sample": int(total),
                # counts — 화면에서 % 아래에 원래 경기 수를 같이 보여준다. %만으로는
                # 3건 중 2건(66.7%)과 972건 중 649건(66.8%)이 똑같아 보이기 때문이다.
                "counts": [int(v) for v in vals],
                "hs_pct": round(vals[0] / total * 100.0, 1),
                "hm_pct": round(vals[1] / total * 100.0, 1),
                "mu_pct": round(vals[2] / total * 100.0, 1),
                "yk_pct": round(vals[3] / total * 100.0, 1),
            })
        else:
            levels.append({
                "code": code, "label": label, "sample": 0,
                "counts": [0, 0, 0, 0],
                "hs_pct": 0.0, "hm_pct": 0.0, "mu_pct": 0.0, "yk_pct": 0.0,
            })
    # '분석' 행 — 핸승 칸은 위 단계들을 회귀식(_level_hit_pct)으로 보정하며 실제로 최종
    # 계산(est, = 기준선 편차의 재료)에 쓴 그 값 그대로다. 핸무·무·역은 대응하는 회귀식이
    # 따로 없어(핸승 여부만 실측 검증했다) 원본 비율을 같은 가중치로 섞은 값인데, 그걸
    # 그대로 쓰면 네 칸 합이 100%에 안 맞으니 "핸승을 뺀 나머지(100−핸승)"를 그 셋의
    # 원래 비율 그대로 나눠서 맞춘다 — 셋 사이의 상대적인 크기는 안 바뀌고, 총합만 맞아진다.
    remaining = 100.0 - est
    rest_sum = raw[1] + raw[2] + raw[3]
    if rest_sum > 0:
        scale = remaining / rest_sum
        hm_pct, mu_pct, yk_pct = raw[1] * scale, raw[2] * scale, raw[3] * scale
    else:
        hm_pct = mu_pct = yk_pct = remaining / 3.0
    levels.append({
        "code": "SUM", "label": "분석", "sample": None,
        "hs_pct": round(est, 1), "hm_pct": round(hm_pct, 1),
        "mu_pct": round(mu_pct, 1), "yk_pct": round(yk_pct, 1),
    })

    return used, est, levels


def _domestic_indicator(row, scope, code):
    """국내지표 계단식 보정 — 구조는 _foreign_indicator와 같지만(정배 방향에 맞는 지표
    선택 → 느슨한 지표(국/통)에서 빡빡한 지표(국)승+무+패)로 표본 비례 가중 반영), 계산에
    쓰는 회귀식이 다르다. 국)승·패(리그 단일)·국)승+패·국)승+무+패는 리그별로도 신호가
    없거나 표본이 너무 적어(모듈 상단 _REG_DOMESTIC_BY_LEAGUE 주석 참고) 통합(국/통)의
    리그별 회귀식을 그대로 재사용한다. 이 함수의 결과(est)는 최종 확률 계산에는 넣지
    않고 화면에 참고용으로만 보여준다 — compute()의 '국내지표' 신호 참고.

    반환 형태는 _foreign_indicator와 동일: (ind_used, hit_pct, ind_levels).
    """
    kw = _num(row.get("KW"))
    kl = _num(row.get("KL"))
    if kw is None or kl is None or kw == kl:
        return None, None, []
    fav_col = "W" if kw < kl else "L"
    single_code, single_label = ("K-W", "승") if fav_col == "W" else ("K-L", "패")
    total_code, total_label = ("TK-W", "통) 승") if fav_col == "W" else ("TK-L", "통) 패")
    reg = _REG_DOMESTIC_BY_LEAGUE.get(code, _REG_DOMESTIC_DEFAULT)

    single_vals, single_total = _ind_counts(row, single_code)
    wl_vals, wl_total = _ind_counts(row, "K-WL")
    wdl_vals, wdl_total = _ind_counts(row, "K-WDL")
    total_vals, total_total = (None, 0) if scope == "user" else _ind_counts(row, total_code)

    def raw_pcts(vals, total):
        return [v / total * 100.0 for v in vals]

    if total_total > 0:
        est = _level_hit_pct(total_vals, total_total, reg)
        raw = raw_pcts(total_vals, total_total)
        root_total = total_total
        used = (total_code, total_label, total_vals, total_total)
        if single_total > 0:
            k = max(1.0, root_total * IND_RATIO_SINGLE_OVER_TOTAL)
            est = _blend(est, single_total, _level_hit_pct(single_vals, single_total, reg), k)
            raw = _blend_vec(raw, single_total, raw_pcts(single_vals, single_total), k)
    elif single_total > 0:
        est = _level_hit_pct(single_vals, single_total, reg)
        raw = raw_pcts(single_vals, single_total)
        root_total = single_total
        used = (single_code, single_label, single_vals, single_total)
    else:
        return None, None, []

    # 승+패(K-WL)·승+무+패(K-WDL)는 해외지표와 같은 이유로 계산에 넣지 않는다
    # (_foreign_indicator의 실측 주석 참고). 국내는 표본이 더 적어서 근거가 더 분명하다.

    # 국내지표는 승+패·승+무+패 표본이 아예 없는 경기가 흔하다(모듈 상단
    # _REG_DOMESTIC_BY_LEAGUE 주석 참고 — 리그당 0~260건뿐). 해외지표처럼 표본 있는
    # 줄만 골라 보여주면 "이 단계는 아예 없나 보다"로 헷갈릴 수 있어, 국내지표는 표본이
    # 0이어도 4단계(단일·승+패·승+무+패·통합) 줄을 전부 0/0/0/0으로 보여준다.
    levels = []
    # 순서는 해외지표와 똑같이 넓은 단계 → 좁은 단계
    for lv_code, label, vals, total in [
        (total_code, total_label, total_vals, total_total),
        (single_code, single_label, single_vals, single_total),
        ("K-WL", "승+패", wl_vals, wl_total),
        ("K-WDL", "승+무+패", wdl_vals, wdl_total),
    ]:
        if total > 0:
            levels.append({
                "code": lv_code, "label": label, "sample": int(total),
                "counts": [int(v) for v in vals],   # 해외지표와 같은 이유(위 주석 참고)
                "hs_pct": round(vals[0] / total * 100.0, 1),
                "hm_pct": round(vals[1] / total * 100.0, 1),
                "mu_pct": round(vals[2] / total * 100.0, 1),
                "yk_pct": round(vals[3] / total * 100.0, 1),
            })
        else:
            levels.append({
                "code": lv_code, "label": label, "sample": 0,
                "counts": [0, 0, 0, 0],
                "hs_pct": 0.0, "hm_pct": 0.0, "mu_pct": 0.0, "yk_pct": 0.0,
            })
    remaining = 100.0 - est
    rest_sum = raw[1] + raw[2] + raw[3]
    if rest_sum > 0:
        scale = remaining / rest_sum
        hm_pct, mu_pct, yk_pct = raw[1] * scale, raw[2] * scale, raw[3] * scale
    else:
        hm_pct = mu_pct = yk_pct = remaining / 3.0
    levels.append({
        "code": "SUM", "label": "분석", "sample": None,
        "hs_pct": round(est, 1), "hm_pct": round(hm_pct, 1),
        "mu_pct": round(mu_pct, 1), "yk_pct": round(yk_pct, 1),
    })

    return used, est, levels


def _home_is_fav(row):
    """정배(시장이 강하다고 본 쪽)가 홈인지. 국내배당 우선, 없으면 해외배당."""
    for w, l in (("KW", "KL"), ("FW", "FL")):
        a, b = _num(row.get(w)), _num(row.get(l))
        if a is not None and b is not None and a != b:
            return a < b
    return None


def _round_num(v):
    m = re.search(r"\d+", str(v or ""))
    return int(m.group()) if m else 0


_RT_LABEL = {1: "핸승", 2: "핸무", 3: "무", 4: "역"}


def _team_is_fav(m, team):
    """그 경기(m)에서 team이 정배였는지. team이 그 경기의 홈이면 그대로,
    원정이면 홈 기준을 뒤집는다. RT는 항상 '정배가 커버했는지' 기준의 값이라
    (팀이 홈/원정 어느 쪽이었든) 뒤집어 읽을 필요 없이 그대로 쓸 수 있다."""
    home_fav = _home_is_fav(m)
    if home_fav is None:
        return None
    is_home = str(m.get("HT") or "").strip() == team
    return home_fav if is_home else (not home_fav)


def _season_record(today_row: dict, matches: list | None, team: str):
    """team의 이번 시즌 경기 중 '오늘과 같은 정배/역배 구도'였던 경기만 추려
    핸디캡 결과(핸승/핸무/무/역)를 센다 — 상대전적과 같은 방식으로, 오늘 이
    팀이 처한 상황과 실제로 비교 가능한 경기만 골라 본다."""
    if not team:
        return None
    today_fav = _team_is_fav(today_row, team)
    if today_fav is None:
        return None
    counts = {"핸승": 0, "핸무": 0, "무": 0, "역": 0}
    total = 0
    for m in matches or []:
        if _team_is_fav(m, team) != today_fav:
            continue
        rt = _num(m.get("RT"))
        if rt is None or int(rt) not in _RT_LABEL:
            continue
        counts[_RT_LABEL[int(rt)]] += 1
        total += 1
    return {"fav": today_fav, "counts": counts, "total": total}


def _season_side_text(side_label, rec):
    if not rec:
        return f"{side_label} 정배 판정 불가"
    role = "정" if rec["fav"] else "역"
    if rec["total"] == 0:
        return f"{side_label}({role}) 이번 시즌 표본 없음"
    c = rec["counts"]
    return f"{side_label}({role}) 핸승({c['핸승']}) 핸무({c['핸무']}) 무({c['무']}) 역({c['역']})"


def _season_row(side_label, rec):
    """화면이 표로 그릴 수 있게 구조화한 한 줄 — value_text(문장)와 같은 내용을
    행/열이 맞는 표로도 보여주기 위한 것(가독성: 숫자를 나열식 문장 대신 표로)."""
    if not rec:
        return {"side": side_label, "role": None, "total": 0, "counts": None}
    return {
        "side": side_label,
        "role": "정" if rec["fav"] else "역",
        "total": rec["total"],
        "counts": rec["counts"],
    }


def _h2h_goal_profile(h2h: dict | None, code: str):
    """맞대결이 평소 골이 많이 나는 대결인지를 리그 평균과 비교해 본다.

    [왜 승/무/패가 아니라 득점인가 — 6대리그 실측]
      상대전적으로 핸승을 맞히려는 시도는 전부 실패했다. 배당 기준선 위에 얹어주는
      값(Brier 순개선)을 재보면 전체기준 승률 +0.006‰, 홈기준 승률 +0.031‰,
      홈기준-전체기준 차이 +0.013‰, 오늘과 같은 홈/원정 입장의 승률 +0.000‰,
      그리고 여기서 쓰던 '같은 정배였던 맞대결 커버율'조차 +0.015‰였다. 의미가
      있으려면 +0.5‰는 넘어야 하니 전부 사실상 0이다(게다가 정답을 보고 맞춘
      in-sample 값이라 실전은 더 낮다). 이유는 단순하다 — 맞대결 승률이 좋을수록
      실제 핸승률도 23%→37%로 오르지만, 배당도 25%→38%로 똑같이 따라 오른다.
      상대전적이 하는 말을 배당이 이미 다 알고 있다.

      유일하게 남은 것이 맞대결 평균 총득점이다. 정배 강도를 통제해도 총득점이 1골
      적어질 때마다 '무'가 +1.99%p 늘고(t=2.89) 핸승이 -1.74%p 준다(t=2.47).
      최근 3경기만 봐도 같은 크기로 나온다(무 t=2.91). 반면 '역'은 -0.70%p(t=1.10)로
      효과가 없다 — 저득점 맞대결에 약한 정배가 많이 섞여 있어서 역이 늘어 보일 뿐,
      정배 강도를 맞춰놓으면 사라진다.

      핸무는 어떤 값으로 갈라도 24% 근처에 고정이라 아예 예측 대상이 아니다.
      저득점 맞대결에선 정배가 이기는 횟수 자체가 줄지만(59.9%→49.5%) 이기더라도
      1골 차로 겨우 이기는 비율이 늘어(41.7%→48.7%) 둘이 정확히 상쇄되기 때문이다.

      다만 이 효과도 1골당 2%p 수준이라 크지 않다. 그래서 계산에는 넣지 않고
      화면에 표시만 한다(국내지표와 같은 취급).
    """
    goals = []
    for m in (h2h or {}).get("matches") or []:
        hs, a_s = _num(m.get("HS")), _num(m.get("AS"))
        if hs is None or a_s is None:
            continue
        goals.append(hs + a_s)
    if len(goals) < MIN_H2H_SAMPLE:
        return None
    avg = sum(goals) / len(goals)
    league_avg = _LEAGUE_AVG_GOALS.get(code, _AVG_GOALS_DEFAULT)
    gap = avg - league_avg
    label = "저득점" if gap <= -H2H_GOAL_BAND else ("다득점" if gap >= H2H_GOAL_BAND else "보통")
    return {"n": len(goals), "avg": avg, "league_avg": league_avg, "label": label}


def compute(row: dict, h2h: dict | None = None, scope: str = "master",
           season_matches: dict | None = None, code: str = "") -> dict:
    """경기 한 건의 종합픽을 계산한다.

    row            : 상세보기가 이미 들고 있는 경기 한 줄(배AI·지표표본 전부 포함)
    h2h            : _head_to_head_calc() 결과. summary에 {핸승/핸무/무/역/총} 카운트가 들어 있다.
    scope          : 'user'면 통합(TF-*) 지표를 쓰지 않는다 — 내 데이터는 리그가 하나뿐이라
                     통합 대상이 없어 TF-*가 F-*와 항상 같은 값이 된다(상세보기 지표별 표본에서
                     같은 이유로 TK-*/TF-* 행을 숨기고 있다).
    season_matches : {"home": [...], "away": [...]} — 홈팀/원정팀이 이번 시즌 치른 경기
                     원본 목록(main.py._season_matches). '시즌전적' 신호에 쓴다.
    code           : 리그 코드(EPL 등). 국내지표 회귀식이 리그마다 달라 _domestic_indicator에
                     그대로 넘긴다 — 없으면(내 데이터 등) 6개 리그 평균 계수로 대신한다.
    """
    signals = []
    warnings = []

    # ── ① 기준선: 배당이 말하는 핸승 확률 ──
    ai = _num(row.get("AI_PICK"))
    if ai is None:
        ai = _num(row.get("RISK"))
    base_hit = _interp(ai, _CAL_X, _CAL_Y)

    if base_hit is None:
        # 배당이 없으면 기준선 자체가 없다 — 보정만 남아봐야 의미가 없으므로 여기서 끝낸다.
        return {
            "available": False,
            "reason": str(row.get("ODD_FLAG") or "").strip() or "배당 정보가 없어 계산할 수 없습니다",
            "signals": [], "warnings": [],
        }

    # ── ② 해외지표: 계단식 보정(_foreign_indicator 참고) ──
    ind_used, ind_hit, ind_levels = _foreign_indicator(row, scope)

    adj_ind = 0.0
    ind_dir = 0
    if ind_used:
        _, _, _, root_total = ind_used
        gap = ind_hit - ai
        adj_ind = _clamp(gap * 0.15, -CAP_IND, CAP_IND)   # 실측 격차(3.9~6.2%p)에 맞춘 축소 반영
        ind_dir = 1 if adj_ind >= 1.0 else (-1 if adj_ind <= -1.0 else 0)
        # 화면에 큼직하게 보여줄 "핸승 예상 %"는 계단식 보정값(ind_hit)을 그대로 쓰지 않는다.
        # 6대리그로 leave-one-out 실측해보니 ind_hit 단독은 예측 구간과 실제 핸승률이
        # 거의 무관했다(Brier 0.243, 그냥 전체평균(0.211)보다 나쁨) — 지표 혼자서는 절대
        # 확률을 못 맞힌다는 뜻. 반면 배당 기준선(base_hit)에 이 보정치(adj_ind)를 더한 값은
        # 기준선 단독(Brier 0.2005)과 비슷하거나 살짝 더 나은 정확도(Brier 0.2003)를 보였다
        # — 배당이 이미 대부분의 정보를 담고 있고, 해외지표는 거기 얹는 작은 힌트일 뿐이라는
        # 모듈 상단 주석의 설계 의도와 일치한다. 그래서 표시용 숫자는 기준선+보정치로 만든다.
        ind_hit_shown = _clamp(base_hit + adj_ind, 1.0, 99.0)
        signals.append({
            "key": "ind", "label": "해외지표", "state": "ok",
            "sample": int(root_total),
            "value_text": f"{adj_ind:+.1f}% 보정된 핸승 예상 {ind_hit_shown:.0f}%",
            "levels": ind_levels,
            "dir": ind_dir, "adjust": round(adj_ind, 1),
        })
    else:
        signals.append({
            "key": "ind", "label": "해외지표", "state": "none",
            "value_text": "표본이 없어 판단 제외",
            "dir": 0, "adjust": 0.0,
        })

    # 국내지표: 해외지표와 같은 방식(_domestic_indicator)으로 계단식 보정을 계산은
    # 하지만, 리그 단일(국)승·패)·국)승+패·국)승+무+패는 리그별로 확인해도 신호가
    # 없거나 표본이 너무 적어(모듈 상단 _REG_DOMESTIC_BY_LEAGUE 주석 참고) 최종
    # 확률 계산(adj_total)에는 아직 넣지 않는다 — state를 'info'로 둬서 배지도
    # "참고용"으로만 뜨게 한다. 화면 표(핸승/핸무/무/역 + 분석 행)는 그대로 보여줘서
    # 사장님이 국배를 더 채워 넣어가며 직접 판단할 수 있게 한다.
    dom_used, dom_hit, dom_levels = _domestic_indicator(row, scope, code)
    if dom_used:
        signals.append({
            "key": "ind_k", "label": "국내지표", "state": "info",
            "value_text": f"핸승 예상 {dom_hit:.0f}%(전체 계산 반영 안 함)",
            "levels": dom_levels,
            "dir": 0, "adjust": 0.0,
        })
    else:
        signals.append({
            "key": "ind_k", "label": "국내지표", "state": "info",
            "value_text": "표본 부족 — 판정 불가",
            "dir": 0, "adjust": 0.0,
        })

    # ── ③ 상대전적: 참고 카드(확률 계산에는 반영하지 않음) ──
    # 예전에는 '오늘과 같은 정배였던 맞대결의 커버율'로 핸승 확률을 ±4%까지 움직였는데,
    # 실측에서 그 보정이 배당 위에 얹어주는 값이 사실상 0이라 뺐다(_h2h_goal_profile
    # 주석에 6대리그 수치 전부 있음). 대신 유일하게 신호가 남은 '맞대결 평균 총득점'을
    # 리그 평균과 비교해 보여만 준다.
    # 합치 보너스가 쓰던 '커버율 방향(h2h_dir)' 계산도 그 보너스를 없애면서 같이 지웠다.
    adj_h2h = 0.0
    goal_prof = _h2h_goal_profile(h2h, code)
    if goal_prof:
        signals.append({
            "key": "h2h", "label": "상대전적", "state": "info",
            "sample": goal_prof["n"],
            "value_text": (f"평균 득점 {goal_prof['avg']:.1f}골 · {goal_prof['label']}"
                           f" (AV {goal_prof['league_avg']:.1f}골)"),
            "dir": 0, "adjust": 0.0,
        })
    else:
        signals.append({
            "key": "h2h", "label": "상대전적", "state": "none",
            "sample": 0,
            "value_text": f"맞대결 기록이 {MIN_H2H_SAMPLE}경기 미만이라 표시할 수 없습니다",
            "dir": 0, "adjust": 0.0,
        })

    # ── ④ 시즌전적: 홈팀·원정팀 각각, 이번 시즌 '오늘과 같은 정배/역배 구도'였던
    # 경기만 추려 핸디캡 결과를 센다. 상대전적처럼 표본이 갈리는 조건이라 계산에는
    # 안 넣고 참고용으로만 보여준다(상대전적만큼 검증되지 않았고, 시즌 초반엔 표본이
    # 금방 말라 신뢰하기 어렵다).
    ht_name = str(row.get("HT") or "").strip()
    at_name = str(row.get("AT") or "").strip()
    home_rec = _season_record(row, (season_matches or {}).get("home"), ht_name)
    away_rec = _season_record(row, (season_matches or {}).get("away"), at_name)
    season_text = f"{_season_side_text('홈', home_rec)}\n{_season_side_text('원정', away_rec)}"
    signals.append({
        "key": "season", "label": "시즌전적", "state": "info",
        "value_text": season_text,
        "rows": [_season_row("홈", home_rec), _season_row("원", away_rec)],
        "note": "오늘과 같은 정배/역배 구도였던 이번 시즌 경기만 모은 값 — 확률 계산에는 반영하지 않습니다",
        "dir": 0, "adjust": 0.0,
    })

    # ── ⑤ 합치 보너스: 제거됨 ──
    # 예전에는 '해외지표와 상대전적이 같은 방향이면 ±2% 더 벌린다'는 항목이 있었다.
    # 근거가 "두 신호가 일치할 때 실측 12%p 격차"였는데, 그 두 신호 중 하나인 상대전적이
    # 실측에서 배당 위에 얹어주는 값이 0으로 나와 계산에서 빠졌다(_h2h_goal_profile 주석).
    # 값이 없는 신호와의 일치는 의미가 없다. 짝을 국내지표로 바꿔도 봤지만, 두 지표가
    # 동시에 방향을 가리키는 경기가 30,391건 중 77건(0.25%)뿐이라 성립하지 않았다.
    # 그래서 보너스와 안내 문구를 함께 뺐다 — 카드에 안 보이는 값이 확률을 움직이는 게
    # 제일 나쁘다. consensus/consensus_text는 화면이 아직 참조하므로 빈 값으로 유지한다.
    adj_con = 0.0
    consensus = ""
    consensus_text = ""

    # ── ⑥ 최종 ──
    adj_total = _clamp(adj_ind + adj_h2h + adj_con, -CAP_TOTAL, CAP_TOTAL)
    final_hit = _clamp(base_hit + adj_total, 1.0, 99.0)
    final_pl = 100.0 - final_hit

    # 등급은 화면에 실제로 찍히는 정수값으로 가른다 — 79.6%를 "80%"로 보여주면서
    # 등급만 79 기준으로 매기면 "80%인데 왜 한 단계 아래냐"가 된다.
    pl_shown = round(final_pl)
    if pl_shown >= 80:
        grade, grade_key = "매우 유리", "best"
    elif pl_shown >= 73:
        grade, grade_key = "유리", "good"
    elif pl_shown >= 65:
        grade, grade_key = "보통", "mid"
    elif pl_shown >= 55:
        grade, grade_key = "불리", "bad"
    else:
        grade, grade_key = "매우 불리", "worst"

    flag = str(row.get("ODD_FLAG") or "").strip()
    if flag:
        warnings.append(f"배당 이상 표시({flag})가 있어 기준선 신뢰도가 낮습니다.")

    return {
        "available": True,
        "base": {
            "ai_pick": round(ai, 1),
            "hit": round(base_hit, 1),
            "pl": round(100.0 - base_hit, 1),
        },
        "signals": signals,
        "adjust": {
            "ind": round(adj_ind, 1),
            "h2h": round(adj_h2h, 1),
            "consensus": round(adj_con, 1),
            "total": round(adj_total, 1),
        },
        "consensus": consensus,
        "consensus_text": consensus_text,
        "final": {
            "hit": round(final_hit, 1),
            "pl": round(final_pl, 1),
            "grade": grade,
            "grade_key": grade_key,
        },
        "warnings": warnings,
    }
