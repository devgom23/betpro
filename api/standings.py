"""
시즌별 누적 순위(리그 테이블) + 폼(PPG) 계산.

각 경기 행에 그 경기를 치르기 '직전까지'의 성적을 붙인다.
그래서 1라운드는 아직 치른 경기가 없어 전부 비어 있고, 2라운드부터 값이 생긴다.

붙는 컬럼:
  HP  홈팀 순위          AP   원정팀 순위
  HTF 홈팀 전체경기 PPG   ATF  원정팀 전체경기 PPG
  HF  홈팀 홈경기 PPG     AF   원정팀 원정경기 PPG
  HRF 홈팀 최근5경기 PPG  ARF  원정팀 최근5경기 PPG   (상세보기 팝업 전용)
  HR10 홈팀 최근10경기 승패  AR10 원정팀 최근10경기 승패 (상세보기 팝업 전용)
  HR10H/AR10H  HR10/AR10과 한 글자씩 대응하는 홈("H")/원정("A") 표시 — 그 팀 기준으로
               그 경기가 홈경기였는지(화면에서 점으로 표시). (상세보기 팝업 전용)
  HREM/AREM    이 경기 포함 남은 경기 수          ┐ 시즌 막판 뱃지 — league를 넘겨야 붙는다
  HSTK/ASTK    뱃지 이름(우승경쟁·강등확정 …)      │ (STAKE_LINES 주석 참고, 남은 경기 10 이하만)
  HSTKT/ASTKT  경계선과의 승점 차 문구             │
  HSTKS/ASTKS  네 경계선 상태 요약(툴팁용)         ┘

최근5·최근10도 순위/폼과 마찬가지로 '그 시즌 안에서만' 센다 — 시즌이 바뀌면 리셋되고,
아직 그만큼 안 치렀으면 있는 경기까지만 쓴다.

순위 규칙(사용자 지정 = EPL/FIFA 표준):
  1. 승점            승3 / 무1 / 패0
  2. 골득실차        득점 - 실점
  3. 다득점          총 득점
  4. 승자승          동률 팀들끼리의 맞대결만 모아 승점 → 골득실차 → 다득점
  5. 승자승 원정득점  그 맞대결에서 원정으로 넣은 골
  (여기까지 모두 같으면 팀명 순으로 고정 — 매번 같은 결과가 나오게 하기 위함)

폼(PPG) 규칙: 승점 ÷ 경기수를 소수 둘째 자리로 반올림.
  파이썬 기본 round()는 은행가 반올림이라 2.125 같은 경계값에서 어긋나므로
  Decimal.quantize(ROUND_HALF_UP)을 쓴다(사용자 지정 방식).

⚠ 이 파일은 26개 지표 엔진(engine.py)과 무관하다. DB에 저장된 분석값은 전혀 건드리지 않고,
   경기 결과(HS/AS)만 읽어서 표시용 컬럼을 새로 만들어 붙일 뿐이다.
"""
import functools
import itertools
import re
from decimal import Decimal, ROUND_HALF_UP

import pandas as pd

HOME_RANK_COL = "HP"
AWAY_RANK_COL = "AP"
HOME_ALL_FORM_COL = "HTF"   # 홈팀이 치른 전체 경기 PPG
HOME_FORM_COL = "HF"        # 홈팀이 홈에서 치른 경기만의 PPG
AWAY_FORM_COL = "AF"        # 원정팀이 원정에서 치른 경기만의 PPG
AWAY_ALL_FORM_COL = "ATF"   # 원정팀이 치른 전체 경기 PPG

# 아래 6개는 상세보기 팝업 전용(분석표 본표에는 안 나온다)
HOME_RECENT5_COL = "HRF"    # 홈팀 최근 5경기 PPG
AWAY_RECENT5_COL = "ARF"    # 원정팀 최근 5경기 PPG
HOME_RECENT10_COL = "HR10"  # 홈팀 최근 10경기 승패 — 왼쪽이 과거, 오른쪽이 최신
AWAY_RECENT10_COL = "AR10"  # 원정팀 최근 10경기 승패 — 왼쪽이 최신, 오른쪽이 과거
HOME_RECENT10_HOME_COL = "HR10H"  # HR10과 같은 순서로, 그 경기가 홈경기였으면 'H' 아니면 ''
AWAY_RECENT10_HOME_COL = "AR10H"  # AR10과 같은 순서

RECENT_N = 5     # '최근5폼' 창 크기
RECENT10_N = 10  # '최근10경기 전적' 창 크기

# ── 시즌 막판 '무엇이 걸려 있나' 뱃지 (2026-09-12) ──
# 팀마다 남은 경기가 STAKE_WINDOW 이하가 되면, 그 라운드 직전 순위표로 경계선 4개(우승 · 챔스권 ·
# 유로파권(컨퍼런스 포함) · 강등 안전선)마다 수학적으로 확정/탈락/아직 걸림을 가린다.
#   확정 = 이 팀의 지금 승점 이상을 남은 경기로 따라올 수 있는 팀이 (경계 인원−1)팀 이하
#   탈락 = 이 팀이 남은 경기를 다 이겨도 이미 넘을 수 없는 팀이 경계 인원 이상
#   (승점이 같아지는 경우는 둘 다 '아직 걸림'으로 둔다 — 골득실·승자승으로 갈릴 수 있다)
# 실측(6대리그 완료 시즌 32,095경기, 2026-09-11): '걸린 것' 자체는 같은 배당끼리 비교하면
# 결과 차이가 없다(남은 경기 수까지 고정하면 어느 묶음도 z<1.9) — 배당에 이미 들어 있는
# 정보라 화면에서는 참고용 표시다. 결과가 달라지는 건 '시즌 마지막 2라운드'뿐이다
# (역 +3.67%p z=3.91 — web/src/utils/seasonStake.js 주석 참고).
STAKE_WINDOW = 10
# 리그별 경계 인원 (챔스권, 유로파권(컨퍼런스 포함), 강등 자리(플레이오프 포함)).
# 해마다 UEFA 배정이 바뀌면 여기만 고친다. 여기 없는 리그(사용자 리그 등)는 뱃지를 안 붙인다.
STAKE_LINES = {
    "EPL": (4, 6, 3), "LALIGA": (4, 6, 3), "SERIEA": (4, 6, 3),
    "BUNDES": (4, 6, 3), "LIGUE1": (3, 5, 3), "EREDIVISIE": (2, 6, 3),
}
HOME_REM_COL, AWAY_REM_COL = "HREM", "AREM"                # 이 경기 포함 남은 경기 수
HOME_STAKE_COL, AWAY_STAKE_COL = "HSTK", "ASTK"            # 뱃지 이름(우승경쟁·강등확정·걸린 것 없음 …)
HOME_STAKE_TXT_COL, AWAY_STAKE_TXT_COL = "HSTKT", "ASTKT"  # 경계선과의 승점 차('4위와 +1점')
HOME_STAKE_ALL_COL, AWAY_STAKE_ALL_COL = "HSTKS", "ASTKS"  # 네 경계선 상태 한 줄 요약(툴팁용)
HOME_STAKE_TRIPLE = (HOME_STAKE_COL, HOME_STAKE_TXT_COL, HOME_STAKE_ALL_COL)
AWAY_STAKE_TRIPLE = (AWAY_STAKE_COL, AWAY_STAKE_TXT_COL, AWAY_STAKE_ALL_COL)
STAKE_COLS = (HOME_REM_COL, AWAY_REM_COL) + HOME_STAKE_TRIPLE + AWAY_STAKE_TRIPLE

RANK_COLS = (HOME_RANK_COL, AWAY_RANK_COL)
FORM_COLS = (HOME_ALL_FORM_COL, HOME_FORM_COL, AWAY_FORM_COL, AWAY_ALL_FORM_COL)
RECENT_COLS = (HOME_RECENT5_COL, AWAY_RECENT5_COL,
               HOME_RECENT10_COL, AWAY_RECENT10_COL,
               HOME_RECENT10_HOME_COL, AWAY_RECENT10_HOME_COL)

_REQUIRED = ("S", "R", "HT", "AT", "HS", "AS")


# (승점, 경기수) 조합이 몇 백 가지뿐인데 리그 하나에 4만 번 가까이 불린다(EPL 실측
# 37,920회) — Decimal 계산을 매번 새로 하지 않고 한 번 낸 값을 그대로 쓴다.
@functools.lru_cache(maxsize=None)
def _ppg(pts, played):
    """승점 ÷ 경기수 → '2.24' 같은 소수 둘째 자리 문자열.
    아직 해당 경기를 안 치렀으면(경기수 0) 사용자 지정대로 '0.00'."""
    if not played:
        return "0.00"
    value = (Decimal(pts) / Decimal(played)).quantize(Decimal("0.01"),
                                                      rounding=ROUND_HALF_UP)
    return str(value)


def _round_num(v):
    """'9R'/'38R'/'12' 어느 표기든 숫자만 뽑아 라운드 순서를 정한다."""
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else 0


def _score(v):
    """득점 → int. 아직 안 치른 경기(빈 값)는 None."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


class _Table:
    """한 시즌의 누적 성적표."""

    def __init__(self):
        self.pts = {}
        self.gf = {}
        self.ga = {}
        self.played = {}         # 팀 -> 치른 전체 경기수
        self.home_pts = {}       # 홈경기에서만 딴 승점
        self.home_played = {}
        self.away_pts = {}       # 원정경기에서만 딴 승점
        self.away_played = {}
        self.counted = 0     # 지금까지 순위에 반영된 경기 수
        self.pair = {}       # frozenset({A,B}) -> [(홈, 원정, 홈득점, 원정득점), ...]
        self.recent = {}     # 팀 -> [(딴 승점, 'W'/'D'/'L', 홈여부), ...] 치른 순서(과거→최신)

    def _mark(self, team, pts, letter, is_home):
        self.recent.setdefault(team, []).append((pts, letter, is_home))

    def add(self, home, away, hs, as_):
        self.gf[home] = self.gf.get(home, 0) + hs
        self.ga[home] = self.ga.get(home, 0) + as_
        self.gf[away] = self.gf.get(away, 0) + as_
        self.ga[away] = self.ga.get(away, 0) + hs
        self.played[home] = self.played.get(home, 0) + 1
        self.played[away] = self.played.get(away, 0) + 1
        self.home_played[home] = self.home_played.get(home, 0) + 1
        self.away_played[away] = self.away_played.get(away, 0) + 1
        if hs > as_:
            self.pts[home] = self.pts.get(home, 0) + 3
            self.home_pts[home] = self.home_pts.get(home, 0) + 3
            self._mark(home, 3, "W", True)
            self._mark(away, 0, "L", False)
        elif hs < as_:
            self.pts[away] = self.pts.get(away, 0) + 3
            self.away_pts[away] = self.away_pts.get(away, 0) + 3
            self._mark(home, 0, "L", True)
            self._mark(away, 3, "W", False)
        else:
            self.pts[home] = self.pts.get(home, 0) + 1
            self.pts[away] = self.pts.get(away, 0) + 1
            self.home_pts[home] = self.home_pts.get(home, 0) + 1
            self.away_pts[away] = self.away_pts.get(away, 0) + 1
            self._mark(home, 1, "D", True)
            self._mark(away, 1, "D", False)
        self.pair.setdefault(frozenset((home, away)), []).append((home, away, hs, as_))
        self.counted += 1

    def all_form(self, team):
        """전체 경기 PPG."""
        return _ppg(self.pts.get(team, 0), self.played.get(team, 0))

    def home_form(self, team):
        """홈경기만의 PPG."""
        return _ppg(self.home_pts.get(team, 0), self.home_played.get(team, 0))

    def away_form(self, team):
        """원정경기만의 PPG."""
        return _ppg(self.away_pts.get(team, 0), self.away_played.get(team, 0))

    def recent_form(self, team, n=RECENT_N):
        """최근 n경기 PPG. 아직 n경기를 안 치렀으면 치른 만큼만으로 계산한다."""
        last = self.recent.get(team, [])[-n:]
        return _ppg(sum(p for p, _, _ in last), len(last))

    def recent_results(self, team, n=RECENT10_N, newest_first=False):
        """최근 n경기 승패를 ['W','D','L',...]로. 기본은 과거→최신 순."""
        last = [ch for _, ch, _ in self.recent.get(team, [])[-n:]]
        return list(reversed(last)) if newest_first else last

    def recent_venues(self, team, n=RECENT10_N, newest_first=False):
        """최근 n경기가 그 팀 기준 홈경기였는지 [True/False,...]로.
        recent_results()와 항상 같은 순서·같은 길이가 되도록 만든다."""
        last = [is_home for _, _, is_home in self.recent.get(team, [])[-n:]]
        return list(reversed(last)) if newest_first else last

    def base_key(self, team):
        """1~3순위 기준: 승점, 골득실차, 다득점."""
        gf = self.gf.get(team, 0)
        ga = self.ga.get(team, 0)
        return (self.pts.get(team, 0), gf - ga, gf)


def _h2h_key(table, group, team):
    """동률 팀들끼리의 맞대결만 모아 승점/골득실/다득점/원정득점을 계산한다."""
    pts = gf = ga = away_gf = 0
    for a, b in itertools.combinations(sorted(group), 2):
        if team not in (a, b):
            continue
        for home, away, hs, as_ in table.pair.get(frozenset((a, b)), ()):
            if team == home:
                mine, theirs = hs, as_
            elif team == away:
                mine, theirs = as_, hs
                away_gf += as_
            else:
                continue
            gf += mine
            ga += theirs
            if mine > theirs:
                pts += 3
            elif mine == theirs:
                pts += 1
    return (pts, gf - ga, gf, away_gf)


def _ranks(table, teams):
    """현재 성적표로 팀별 순위(1등부터)를 매긴다."""
    base = {t: table.base_key(t) for t in teams}
    # 승점 → 골득실 → 다득점 내림차순, 마지막은 팀명 오름차순(결과 고정용)
    order = sorted(teams, key=lambda t: (-base[t][0], -base[t][1], -base[t][2], t))

    final = []
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and base[order[j + 1]] == base[order[i]]:
            j += 1
        group = order[i: j + 1]
        if len(group) > 1:
            # 1~3순위가 완전히 같은 팀들만 승자승으로 다시 가린다
            group = sorted(
                group,
                key=lambda t: tuple(-x for x in _h2h_key(table, group, t)) + (t,),
            )
        final.extend(group)
        i = j + 1

    return {t: n for n, t in enumerate(final, start=1)}


def _regular_teams(ht, at):
    """시즌을 정상적으로 치르는 팀 목록 — 가장 많이 나온 팀의 절반 이상 나온 팀만.
    팀 이름이 몇 경기만 다르게 들어간 행이 있으면(세리에 25-26이 21팀으로 잡힌다)
    그 이름까지 세면 팀 수와 남은 경기 수가 틀어진다."""
    cnt = {}
    for t in itertools.chain(ht, at):
        cnt[t] = cnt.get(t, 0) + 1
    if not cnt:
        return []
    top = max(cnt.values())
    return sorted(t for t, c in cnt.items() if c * 2 >= top)


def _signed(gap):
    return "동점" if gap == 0 else (f"+{gap}점" if gap > 0 else f"−{-gap}점")


_STAKE_FIGHT = ("우승경쟁", "챔스경쟁", "유로파경쟁", "강등경쟁")


def _stake_label(team, states, bounds, pos, order, pts):
    """네 경계선 상태 → (뱃지 이름, 승점 차 문구, 요약). 아직 걸린 선이 여럿이면 위쪽 선 하나만."""
    summary = " · ".join((f"우승 {states[0]}", f"챔스 {states[1]}", f"유로파 {states[2]}",
                          {"확정": "잔류 확정", "탈락": "강등 확정", "걸림": "강등권 걸림"}[states[3]]))
    for i, st in enumerate(states):
        if st != "걸림":
            continue
        b, p = bounds[i], pos[team]
        if p <= b:   # 지금 선 안쪽 — 선 밖 첫 팀과의 차
            gap = pts[team] - pts[order[b]]
            text = f"강등권({b + 1}위)과 {_signed(gap)}" if i == 3 else f"{b + 1}위와 {_signed(gap)}"
        else:        # 지금 선 밖 — 선 안 마지막 팀과의 차
            gap = pts[team] - pts[order[b - 1]]
            text = f"잔류선({b}위)과 {_signed(gap)}" if i == 3 else f"{b}위와 {_signed(gap)}"
        return _STAKE_FIGHT[i], text, summary
    if states[0] == "확정":
        label = "우승확정"
    elif states[1] == "확정":
        label = "챔스확정"
    elif states[2] == "확정":
        label = "유로파확정"
    elif states[3] == "탈락":
        label = "강등확정"
    else:
        label = "걸린 것 없음"
    return label, "", summary


def _round_stakes(table, ranks, regular, lines, total):
    """이 라운드 직전 성적표로 팀별 남은 경기 수와, 남은 경기가 STAKE_WINDOW 이하인 팀의
    (뱃지 이름, 승점 차 문구, 요약)을 만든다. STAKE_LINES 주석 참고."""
    if len(regular) < 4:
        return {}, {}
    rems = {t: total - table.played.get(t, 0) for t in regular}
    rems = {t: r for t, r in rems.items() if r > 0}      # 이 경기 포함 남은 경기
    if not any(r <= STAKE_WINDOW for r in rems.values()):
        return {}, rems
    pts = {t: table.pts.get(t, 0) for t in regular}
    mx = {t: pts[t] + 3 * rems.get(t, 0) for t in regular}
    order = sorted(regular, key=lambda t: ranks.get(t, 10 ** 6))
    pos = {t: i + 1 for i, t in enumerate(order)}
    cl, eu, rel = lines
    bounds = (1, cl, eu, len(regular) - rel)
    stakes = {}
    for t in regular:
        r = rems.get(t)
        if r is None or r > STAKE_WINDOW:
            continue
        threats = sum(1 for u in regular if u != t and mx[u] >= pts[t])
        above = sum(1 for u in regular if u != t and pts[u] > mx[t])
        states = ["확정" if threats <= b - 1 else "탈락" if above >= b else "걸림" for b in bounds]
        stakes[t] = _stake_label(t, states, bounds, pos, order, pts)
    return stakes, rems


def _attach_one_season(sdf, out, league=None):
    """한 시즌 분량(sdf)을 라운드 순서대로 훑으며 각 경기 '직전'의 순위·폼을 기록한다."""
    ht = sdf["HT"].astype(str).str.strip().tolist()
    at = sdf["AT"].astype(str).str.strip().tolist()
    teams = sorted(set(ht) | set(at))
    if not teams:
        return
    # 시즌 막판 뱃지 — 경계선 설정이 있는 리그만(STAKE_LINES). 남은 경기는 '팀 수로 정해지는
    # 전체 경기 수 − 치른 경기'로 센다 — 진행 중 시즌은 앞으로의 일정이 DB에 다 없어서
    # 행 개수로는 못 센다. 6대리그는 모두 홈·원정 두 번씩 도는 방식이다.
    lines = STAKE_LINES.get(league)
    regular = _regular_teams(ht, at) if lines else []
    total = 2 * (len(regular) - 1)

    # 라운드별 경기 위치를 한 번에 모아 둔다 — 예전엔 라운드마다 시즌 전체를 불리언
    # 마스크로 다시 걸러서(리그당 600번 넘게) 판다스 처리 비용이 대부분이었다.
    # 라운드 순서·라운드 안 경기 순서는 예전(dropna().unique() → _round_num 안정 정렬,
    # 마스크는 원래 행 순서 유지)과 똑같다: dict는 처음 나온 순서를 지키고 sorted는 안정 정렬.
    idx_list = sdf.index.tolist()
    hs_list = sdf["HS"].tolist()
    as_list = sdf["AS"].tolist()
    by_round = {}
    for pos, rnd in enumerate(sdf["R"].tolist()):
        if pd.isna(rnd):
            continue
        by_round.setdefault(rnd, []).append(pos)

    table = _Table()
    for rnd in sorted(by_round, key=_round_num):
        positions = by_round[rnd]

        # ① 이 라운드 경기들에는 '직전까지'의 순위·폼을 붙인다
        #    (아직 반영된 경기가 없으면 = 시즌 첫 라운드이므로 값 없음)
        if table.counted > 0:
            ranks = _ranks(table, teams)
            stakes, rems = _round_stakes(table, ranks, regular, lines, total) if lines else ({}, {})
            for pos in positions:
                idx, h, a = idx_list[pos], ht[pos], at[pos]
                out[HOME_RANK_COL][idx] = ranks.get(h)
                out[AWAY_RANK_COL][idx] = ranks.get(a)
                out[HOME_ALL_FORM_COL][idx] = table.all_form(h)
                out[HOME_FORM_COL][idx] = table.home_form(h)
                out[AWAY_FORM_COL][idx] = table.away_form(a)
                out[AWAY_ALL_FORM_COL][idx] = table.all_form(a)
                out[HOME_RECENT5_COL][idx] = table.recent_form(h)
                out[AWAY_RECENT5_COL][idx] = table.recent_form(a)
                # 홈팀은 왼쪽이 과거·오른쪽이 최신, 원정팀은 왼쪽이 최신·오른쪽이 과거로
                # 두 팀의 최신 경기가 가운데(맞대결 쪽)에서 만나게 배치한다.
                out[HOME_RECENT10_COL][idx] = "".join(table.recent_results(h))
                out[AWAY_RECENT10_COL][idx] = "".join(
                    table.recent_results(a, newest_first=True))
                # HR10/AR10과 한 글자씩(같은 자리수로) 대응하는 홈/원정 표시 — "H"/"A"
                out[HOME_RECENT10_HOME_COL][idx] = "".join(
                    "H" if v else "A" for v in table.recent_venues(h))
                out[AWAY_RECENT10_HOME_COL][idx] = "".join(
                    "H" if v else "A" for v in table.recent_venues(a, newest_first=True))
                for team, rem_col, stk_cols in ((h, HOME_REM_COL, HOME_STAKE_TRIPLE),
                                                (a, AWAY_REM_COL, AWAY_STAKE_TRIPLE)):
                    if team in rems:
                        out[rem_col][idx] = rems[team]
                    for col, val in zip(stk_cols, stakes.get(team, ())):
                        out[col][idx] = val

        # ② 그 다음에 이 라운드 결과를 성적표에 반영한다
        for pos in positions:
            hs_i, as_i = _score(hs_list[pos]), _score(as_list[pos])
            if hs_i is None or as_i is None:
                continue          # 아직 안 끝난 경기는 순위에 반영하지 않는다
            table.add(ht[pos], at[pos], hs_i, as_i)


# ─────────────────── 팀별 최고 연속 기록 (상세보기 팝업 전용) ───────────────────
# 위의 순위·폼·최근10은 전부 '그 시즌 안에서만' 세지만, 이 기록은 시즌 경계를 넘어
# 이어 센다 — 실제 축구 기록이 그렇게 매겨지기 때문이다(예: 아스널 49경기 무패).
# 기준은 실제 스코어(HS/AS)다. 핸디 결과(RT)가 아니라 순수하게 이기고 졌는지만 본다.
# 집계 범위는 '그 경기 직전까지' — 이 파일의 다른 지표들과 같은 원칙이라, 과거 경기를
# 다시 열어봐도 그 당시 기준 숫자가 나온다(그 경기 이후 기록은 안 섞인다).

def chrono_key(s, r, no):
    """시간순 정렬 키. DT는 70%가 비어 있어 못 쓰므로 시즌→라운드→경기번호로 세운다.
    시즌 문자열은 '09-10'~'26-27'(유럽)이든 '2013'~'2026'(K리그)이든 그냥 문자열로
    비교해도 연도순이 맞다."""
    try:
        n = float(no)
    except (TypeError, ValueError):
        n = 0.0
    return (str(s), _round_num(r), n)


def recent10_before(df, team, season, round_, no, newest_first=False):
    """'최근10경기 전적' 칸 하나하나가 어느 경기였는지 — 마우스를 올렸을 때 보여줄 정보.

    ⚠ 화면의 HR10/AR10 칸과 **한 칸씩 정확히 맞아야** 한다. 그래서 그 값을 만드는
      _attach_one_season()과 같은 규칙을 쓴다 —
        · 같은 시즌 안에서만 센다(연속기록 max_streaks_before는 시즌을 넘나드는 것과 다르다)
        · 그 경기 '직전까지'만 (자기 자신과 그 이후는 제외)
        · 결과가 없는 경기(예정·취소·연기)는 건너뛴다
        · 홈팀은 과거→최신, 원정팀은 최신→과거(newest_first=True)
    반환: [{DT, TM, HT, HS, AS, AT, RT, FW, FL, is_home, letter}, ...] 최대 10개.
    FW/FL(해외배당)을 같이 주는 이유는 HeadToHeadResult.jsx와 같다 — 국내·해외가 갈릴 때
    해외 쪽이 더 자주 맞아(6대리그 실측 +1.8%p) 팀명 옆 배당 표시를 해외로 통일했다.
    """
    t = str(team or "").strip()
    if not t or df is None or df.empty:
        return []
    if not all(c in df.columns for c in _REQUIRED):
        return []

    ht = df["HT"].astype(str).str.strip()
    at = df["AT"].astype(str).str.strip()
    same_season = df["S"].astype(str).str.strip() == str(season or "").strip()
    mine = df[((ht == t) | (at == t)) & same_season]
    if mine.empty:
        return []

    cutoff = chrono_key(season, round_, no)
    get = lambda r, c: (r[c] if c in mine.columns else None)  # noqa: E731
    rows = []
    for _, r in mine.iterrows():
        key = chrono_key(r["S"], r["R"], r["No"])
        if key >= cutoff:
            continue
        a, b = _score(r["HS"]), _score(r["AS"])
        if a is None or b is None:
            continue
        is_home = str(r["HT"]).strip() == t
        mine_, theirs = (a, b) if is_home else (b, a)
        rows.append((key, {
            "DT": _plain(get(r, "DT")), "TM": _plain(get(r, "TM")),
            "HT": str(r["HT"]).strip(), "AT": str(r["AT"]).strip(),
            "HS": a, "AS": b, "RT": _plain(get(r, "RT")),
            "FW": _plain(get(r, "FW")), "FL": _plain(get(r, "FL")),
            "is_home": is_home,
            "letter": "W" if mine_ > theirs else "L" if mine_ < theirs else "D",
        }))
    rows.sort(key=lambda x: x[0])
    out = [v for _, v in rows[-RECENT10_N:]]
    return list(reversed(out)) if newest_first else out


def _plain(v):
    """JSON으로 내보낼 수 있게 NaN/numpy 값을 파이썬 기본형으로."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return str(v).strip() or None


def max_streaks_before(df, team, season, round_, no):
    """team이 그 경기 '직전까지' 세운 최고 연속 기록 4종.

    홈·원정을 섞어 시간순으로 이어 세고, 결과가 아직 없는 경기(예정·취소·연기)는
    건너뛴다 — 연기된 경기 하나 때문에 연승이 끊기면 안 되기 때문이다.
    반환: {"win": 최다연승, "unbeaten": 최다무패, "winless": 최다무승, "lose": 최다연패,
           "played": 집계에 쓴 경기 수}
    """
    empty = {"win": 0, "unbeaten": 0, "winless": 0, "lose": 0, "played": 0}
    t = str(team or "").strip()
    if not t or df is None or df.empty:
        return empty
    if not all(c in df.columns for c in _REQUIRED):
        return empty

    ht = df["HT"].astype(str).str.strip()
    at = df["AT"].astype(str).str.strip()
    mine = df[(ht == t) | (at == t)]
    if mine.empty:
        return empty

    cutoff = chrono_key(season, round_, no)
    rows = []
    for s, r, n, h, hs, as_ in zip(mine["S"], mine["R"], mine["No"],
                                   mine["HT"].astype(str).str.strip(),
                                   mine["HS"], mine["AS"]):
        key = chrono_key(s, r, n)
        if key >= cutoff:          # 그 경기 자신과 그 이후는 제외
            continue
        a, b = _score(hs), _score(as_)
        if a is None or b is None:  # 아직 결과가 없는 경기는 건너뛴다(연속 안 끊음)
            continue
        mine_, theirs = (a, b) if h == t else (b, a)
        rows.append((key, "W" if mine_ > theirs else "L" if mine_ < theirs else "D"))

    if not rows:
        return empty
    rows.sort(key=lambda x: x[0])

    run = {"win": 0, "unbeaten": 0, "winless": 0, "lose": 0}
    best = {"win": 0, "unbeaten": 0, "winless": 0, "lose": 0}
    for _, ch in rows:
        run["win"] = run["win"] + 1 if ch == "W" else 0
        run["lose"] = run["lose"] + 1 if ch == "L" else 0
        run["unbeaten"] = run["unbeaten"] + 1 if ch in ("W", "D") else 0
        run["winless"] = run["winless"] + 1 if ch in ("D", "L") else 0
        for k in best:
            if run[k] > best[k]:
                best[k] = run[k]
    best["played"] = len(rows)
    return best


ADDED_COLS = RANK_COLS + FORM_COLS + RECENT_COLS + STAKE_COLS


def attach_rank_and_form(df, group_cols=("S",), league=None):
    """
    경기 데이터에 순위(HP/AP)·폼(HTF/HF/AF/ATF)·최근전적(HRF/ARF/HR10/AR10)
    컬럼을 붙여 새 DataFrame을 돌려준다.
    group_cols 로 따로 집계할 단위를 정한다 — 리그 하나면 ("S",),
    여러 리그가 섞인 통합DB면 ("Source_League", "S").
    league 를 주면(예: 'EPL') 시즌 막판 뱃지(HREM/AREM·HSTK/ASTK …)도 붙인다 — 테이블의
    L 컬럼은 약칭이 제각각이라('EP'·'La'…) 리그 이름을 따로 받는다(STAKE_LINES 참고).
    """
    if df is None or df.empty:
        return df
    if not all(c in df.columns for c in _REQUIRED):
        return df

    keys = [c for c in group_cols if c in df.columns]
    if not keys:
        return df

    buckets = {c: {} for c in ADDED_COLS}
    for _, sdf in df.groupby(keys, sort=False, dropna=False):
        _attach_one_season(sdf, buckets, league)

    out = df.copy()
    for col in ADDED_COLS:
        out[col] = pd.Series(buckets[col], dtype=object).reindex(df.index)
    return out
