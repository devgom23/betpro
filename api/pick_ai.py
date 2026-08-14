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
    · 상대전적    — 맞대결 RT를 그대로 세면(과거 각 경기의 정배가 커버했는지) 애매하다.
                    맞대결마다 정배가 다른 팀일 수 있어서(어느 시즌엔 A팀이 정배, 다음
                    시즌엔 B팀이 정배), "핸승이 잘 나온다"가 어느 팀 얘기인지 불분명하다.
                    그래서 오늘 정배인 그 팀이 과거 맞대결에서도 정배였던 경기만 추려
                    그때 커버했는지로 본다(_h2h_fav_signal 참고) — 극단값에서만 신호가 있다.
    · 연승/연패   — 방향이 구간마다 뒤집힌다(정배 3연패가 어떤 구간은 16.8%,
                    다른 구간은 30.1%). 배당에 이미 반영돼 있어 추가 정보가 없다.
    · 국내지표    — 표본이 쌓인 경기가 37%뿐인 데다, 그 표본에서는 방향이 해외지표와
                    반대로 나온다(TK-W 기준 배AI 25~35% 구간에서 지표핸승 '낮음'이
                    실제 36.7%, '높음'이 27.1%). 해외지표와 상관 0.774로 같은 것을
                    보는데도 방향이 어긋난다 — 표본 편향으로 보이며 신뢰할 수 없어
                    계산에서 뺀다(화면에는 표본 수만 알린다).
    · 핸무        — 어떤 신호로 나눠도 격차가 0.2~4.2%p뿐. 예측 대상에서 뺀다.

  그래서 이 모듈은 배당을 기준선으로 고정하고, 검증된 두 신호(해외지표·상대전적)
  로만 작게 보정한다. 연승/연패는 화면에 보여주되 숫자에는 넣지 않는다.

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

# 배AI 구간별 실측 핸무율 — 예측이 안 되는 값이라 "이만큼은 늘 깔린다"는 경고로만 쓴다.
_HANMU_X = [10.0, 22.5, 27.5, 32.5, 40.0, 55.0]
_HANMU_Y = [22.2, 22.7, 24.0, 25.3, 25.6, 23.3]

# 지표 표본이 이 미만이면 판단에 쓰지 않는다. 국내지표(K-*)는 대부분 여기서 걸린다.
MIN_IND_SAMPLE = 40
MIN_H2H_SAMPLE = 3      # 이 미만이면 상대전적을 판단에서 뺀다
H2H_FULL_WEIGHT = 10    # 맞대결 10경기면 상대전적 보정을 100% 반영

# 보정 상한 — 실측 격차(지표 3.9~6.2%p, 상대전적 극단값 7~11%p)를 넘지 않게 묶는다.
CAP_IND = 4.0
CAP_H2H = 4.0
CAP_CONSENSUS = 2.0
CAP_TOTAL = 10.0

# 해외지표 후보 — 구체적인(조건이 빡빡한) 순서. 표본이 되는 것 중 가장 구체적인 걸 쓴다.
# 구체적일수록 이 경기와 닮은 과거 경기만 세지만 그만큼 표본이 빨리 마른다.
_IND_ORDER = [
    ("F-WDL", "해) 승+무+패"),
    ("F-WL", "해) 승+패"),
    ("TF-WL", "해/통) 승+패"),
    ("F-W", "해) 승"),
    ("F-L", "해) 패"),
    ("TF-W", "해/통) 승"),
    ("TF-L", "해/통) 패"),
]
# 화면에 "치우친 지표"로 나열할 후보 (국내는 표본 부족 안내용으로 같이 넣는다)
_IND_ALL = _IND_ORDER + [
    ("K-WL", "국) 승+패"), ("K-W", "국) 승"), ("K-L", "국) 패"),
    ("TK-WL", "국/통) 승+패"), ("TK-W", "국/통) 승"),
]


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


def _streak(seq: str, newest_first: bool):
    """최근 연승/연패. 양수=연승, 음수=연패, 0=직전이 무승부.
    HR10은 왼쪽이 과거(오른쪽 끝이 최신), AR10은 왼쪽이 최신이라 방향을 맞춰 읽는다."""
    s = str(seq or "").strip()
    if not s:
        return None
    ordered = s if newest_first else s[::-1]    # 항상 '최신부터'로 통일
    head = ordered[0]
    if head not in ("W", "L"):
        return 0
    n = 0
    for ch in ordered:
        if ch != head:
            break
        n += 1
    return n if head == "W" else -n


def _streak_text(st):
    if st is None:
        return "-"
    if st == 0:
        return "직전 무"
    return f"{abs(st)}연{'승' if st > 0 else '패'}"


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


def _h2h_fav_signal(today_row: dict, h2h: dict | None):
    """상대전적을 '오늘 정배인 그 팀' 기준으로 다시 센다.

    맞대결 RT를 그냥 더하면(_head_to_head_calc의 summary) 애매하다 — RT는 '그 경기의
    정배가 커버했는지'인데, 맞대결마다 정배가 다른 팀일 수 있다(배당이 바뀌거나 팀
    전력이 바뀌면 정배가 뒤집힌다). 그래서 "핸승 70%"가 나와도 그게 오늘 정배인 팀
    얘기인지 상대팀 얘기인지 알 수 없다.

    여기서는 오늘 정배인 팀 이름을 먼저 정하고, 과거 맞대결 중 "그 팀이 그때도
    정배였던" 경기만 추려 그중 몇 번 커버했는지를 본다 — 오늘과 같은 구도였던
    경기만 보는 셈이라 해석이 분명해진다. 대신 표본이 raw summary보다 작아진다
    (맞대결 자체가 적은 데다 그중 절반 정도만 정배가 오늘과 같다).
    """
    ht = str(today_row.get("HT") or "").strip()
    today_home_fav = _home_is_fav(today_row)
    if not ht or today_home_fav is None:
        return None, "오늘 배당으로 정배를 판정할 수 없어 상대전적을 참고할 수 없습니다"
    at = str(today_row.get("AT") or "").strip()
    today_fav_name = ht if today_home_fav else at

    matches = (h2h or {}).get("matches") or []
    kept_rt = []
    for m in matches:
        m_home_fav = _home_is_fav(m)
        if m_home_fav is None:
            continue   # 그 경기는 배당이 없어 정배를 못 정함 — 표본에서 뺀다
        m_fav_name = str(m.get("HT") or "").strip() if m_home_fav else str(m.get("AT") or "").strip()
        if m_fav_name != today_fav_name:
            continue   # 그때는 정배가 상대팀이었던 경기 — 오늘과 구도가 다르니 뺀다
        rt = _num(m.get("RT"))
        if rt is not None and int(rt) in (1, 2, 3, 4):
            kept_rt.append(int(rt))

    return {"fav_name": today_fav_name, "rt": kept_rt}, None


def compute(row: dict, h2h: dict | None = None, scope: str = "master") -> dict:
    """경기 한 건의 종합픽을 계산한다.

    row   : 상세보기가 이미 들고 있는 경기 한 줄(배AI·지표표본·최근10경기 전부 포함)
    h2h   : _head_to_head_calc() 결과. summary에 {핸승/핸무/무/역/총} 카운트가 들어 있다.
    scope : 'user'면 통합(TF-*) 지표를 쓰지 않는다 — 내 데이터는 리그가 하나뿐이라
            통합 대상이 없어 TF-*가 F-*와 항상 같은 값이 된다(상세보기 지표별 표본에서
            같은 이유로 TK-*/TF-* 행을 숨기고 있다).
    """
    signals = []
    warnings = []

    # ── ① 기준선: 배당이 말하는 핸승 확률 ──
    ai = _num(row.get("AI_PICK"))
    if ai is None:
        ai = _num(row.get("RISK"))
    base_hit = _interp(ai, _CAL_X, _CAL_Y)
    hanmu = _interp(ai, _HANMU_X, _HANMU_Y)

    if base_hit is None:
        # 배당이 없으면 기준선 자체가 없다 — 보정만 남아봐야 의미가 없으므로 여기서 끝낸다.
        return {
            "available": False,
            "reason": str(row.get("ODD_FLAG") or "").strip() or "배당 정보가 없어 계산할 수 없습니다",
            "signals": [], "warnings": [],
        }

    # ── ② 해외지표: 표본이 되는 것 중 가장 구체적인 지표로 보정 ──
    ind_used = None
    for code, label in _IND_ORDER:
        if scope == "user" and code.startswith("TF-"):
            continue
        vals, total = _ind_counts(row, code)
        if total >= MIN_IND_SAMPLE:
            ind_used = (code, label, vals, total, vals[0] / total * 100.0)
            break

    adj_ind = 0.0
    ind_dir = 0
    if ind_used:
        code, label, vals, total, ind_hit = ind_used
        gap = ind_hit - ai
        adj_ind = _clamp(gap * 0.15, -CAP_IND, CAP_IND)   # 실측 격차(3.9~6.2%p)에 맞춘 축소 반영
        ind_dir = 1 if adj_ind >= 1.0 else (-1 if adj_ind <= -1.0 else 0)
        signals.append({
            "key": "ind", "label": "해외지표", "state": "ok",
            "used": label, "sample": int(total),
            "value_text": f"{label} 표본 {int(total)}경기 중 핸승 {ind_hit:.0f}%",
            "detail": {"핸승": vals[0], "핸무": vals[1], "무": vals[2], "역": vals[3]},
            "dir": ind_dir, "adjust": round(adj_ind, 1),
        })
    else:
        signals.append({
            "key": "ind", "label": "해외지표", "state": "none",
            "value_text": f"표본 {MIN_IND_SAMPLE}경기 미만 — 판단 제외",
            "dir": 0, "adjust": 0.0,
        })

    # 국내지표는 상태만 알리고 계산에는 넣지 않는다 — 표본이 쌓인 경기가 37%뿐인 데다
    # 그 표본에서 방향이 해외지표와 반대로 나와(모듈 상단 주석 참고) 믿을 수 없다.
    k_codes = [c for c, _ in _IND_ALL
               if c.startswith("K-") or (c.startswith("TK-") and scope != "user")]
    k_best = max(((c, _ind_counts(row, c)[1]) for c in k_codes),
                 key=lambda x: x[1], default=(None, 0))
    signals.append({
        "key": "ind_k", "label": "국내지표", "state": "info",
        "value_text": (f"최대 표본 {int(k_best[1])}경기" if k_best[1] >= MIN_IND_SAMPLE
                       else f"최대 표본 {int(k_best[1])}경기 — 표본 부족"),
        "note": "실측에서 방향이 해외지표와 반대로 나와 확률 계산에는 넣지 않습니다",
        "dir": 0, "adjust": 0.0,
    })

    # ── ③ 상대전적: 오늘과 같은 정배/역배 구도였던 맞대결만 추려 커버율을 본다 ──
    adj_h2h = 0.0
    h2h_dir = 0
    h2h_fav, h2h_skip_reason = _h2h_fav_signal(row, h2h)
    h2h_total = len(h2h_fav["rt"]) if h2h_fav else 0
    if h2h_fav and h2h_total >= MIN_H2H_SAMPLE:
        cover_n = sum(1 for rt in h2h_fav["rt"] if rt == 1)
        h2h_hit = cover_n / h2h_total * 100.0
        weight = min(h2h_total, H2H_FULL_WEIGHT) / H2H_FULL_WEIGHT
        adj_h2h = _clamp((h2h_hit - ai) * 0.10 * weight, -CAP_H2H, CAP_H2H)
        h2h_dir = 1 if adj_h2h >= 1.0 else (-1 if adj_h2h <= -1.0 else 0)
        signals.append({
            "key": "h2h", "label": "상대전적", "state": "ok",
            "sample": h2h_total,
            "value_text": (f"'{h2h_fav['fav_name']}' 정배였던 맞대결 {h2h_total}경기 중 "
                           f"핸승 {cover_n}회 ({h2h_hit:.0f}%)"),
            "dir": h2h_dir, "adjust": round(adj_h2h, 1),
        })
        if h2h_total < 5:
            warnings.append(f"상대전적 표본이 {h2h_total}경기로 적어 참고 수준입니다.")
    elif h2h_skip_reason:
        signals.append({
            "key": "h2h", "label": "상대전적", "state": "none",
            "sample": 0, "value_text": h2h_skip_reason,
            "dir": 0, "adjust": 0.0,
        })
    else:
        signals.append({
            "key": "h2h", "label": "상대전적", "state": "none",
            "sample": h2h_total,
            "value_text": f"같은 정배 구도였던 맞대결 {h2h_total}경기 — {MIN_H2H_SAMPLE}경기 미만이라 판단 제외",
            "dir": 0, "adjust": 0.0,
        })

    # ── ④ 최근 흐름: 보여주기만 하고 숫자에는 넣지 않는다 ──
    home_fav = _home_is_fav(row)
    h_st = _streak(row.get("HR10"), newest_first=False)
    a_st = _streak(row.get("AR10"), newest_first=True)
    if home_fav is None:
        flow_text = f"홈 {_streak_text(h_st)} / 원정 {_streak_text(a_st)}"
    else:
        fav_st, dog_st = (h_st, a_st) if home_fav else (a_st, h_st)
        flow_text = f"정배 {_streak_text(fav_st)} / 역배 {_streak_text(dog_st)}"
    signals.append({
        "key": "flow", "label": "최근 흐름", "state": "info",
        "value_text": flow_text,
        "note": "배당에 이미 반영돼 있어 확률 계산에는 넣지 않습니다",
        "dir": 0, "adjust": 0.0,
    })

    # ── ⑤ 합치 보너스: 두 신호가 같은 방향일 때만 (실측 12%p 격차의 잔여분) ──
    # 두 신호가 '판단에 쓸 만큼 표본이 있는지'와 '어느 쪽으로 기울었는지'는 다른 문제라
    # 메시지를 따로 구분한다(표본은 있는데 양쪽 다 밋밋한 경우가 흔하다).
    ind_ok = ind_used is not None
    h2h_ok = h2h_total >= MIN_H2H_SAMPLE
    adj_con = 0.0
    if not (ind_ok and h2h_ok):
        missing = "해외지표" if not ind_ok else "상대전적"
        consensus = "정보부족"
        consensus_text = f"{missing} 표본이 부족해 두 신호의 합치 여부를 볼 수 없습니다"
    elif ind_dir != 0 and h2h_dir != 0 and ind_dir == h2h_dir:
        adj_con = CAP_CONSENSUS * ind_dir
        consensus = "핸승" if ind_dir > 0 else "플핸"
        consensus_text = f"지표·상대전적이 모두 {consensus} 쪽으로 일치 — 기준선에서 더 벌어질 수 있습니다"
    elif ind_dir != 0 and h2h_dir != 0:
        consensus = "불일치"
        consensus_text = "지표와 상대전적이 서로 반대를 가리킴 — 배당 기준선을 따르는 편이 낫습니다"
    else:
        consensus = "중립"
        consensus_text = "두 신호 모두 배당 기준선과 크게 다르지 않습니다"

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
    if hanmu:
        warnings.append(f"플핸으로 걸어도 핸무가 약 {hanmu:.0f}% 확률로 깔려 있습니다(예측 불가 구간).")

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
        "hanmu": round(hanmu, 1) if hanmu else None,
        "warnings": warnings,
    }
