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

RANK_COLS = (HOME_RANK_COL, AWAY_RANK_COL)
FORM_COLS = (HOME_ALL_FORM_COL, HOME_FORM_COL, AWAY_FORM_COL, AWAY_ALL_FORM_COL)
RECENT_COLS = (HOME_RECENT5_COL, AWAY_RECENT5_COL,
               HOME_RECENT10_COL, AWAY_RECENT10_COL,
               HOME_RECENT10_HOME_COL, AWAY_RECENT10_HOME_COL)

_REQUIRED = ("S", "R", "HT", "AT", "HS", "AS")


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


def _attach_one_season(sdf, out):
    """한 시즌 분량(sdf)을 라운드 순서대로 훑으며 각 경기 '직전'의 순위·폼을 기록한다."""
    ht = sdf["HT"].astype(str).str.strip()
    at = sdf["AT"].astype(str).str.strip()
    teams = sorted(set(ht) | set(at))
    if not teams:
        return

    table = _Table()
    rounds = sorted(sdf["R"].dropna().unique(), key=_round_num)

    for rnd in rounds:
        mask = sdf["R"] == rnd
        rdf = sdf[mask]

        # ① 이 라운드 경기들에는 '직전까지'의 순위·폼을 붙인다
        #    (아직 반영된 경기가 없으면 = 시즌 첫 라운드이므로 값 없음)
        if table.counted > 0:
            ranks = _ranks(table, teams)
            for idx, h, a in zip(rdf.index, ht[mask], at[mask]):
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

        # ② 그 다음에 이 라운드 결과를 성적표에 반영한다
        for h, a, hs, as_ in zip(ht[mask], at[mask], rdf["HS"], rdf["AS"]):
            hs_i, as_i = _score(hs), _score(as_)
            if hs_i is None or as_i is None:
                continue          # 아직 안 끝난 경기는 순위에 반영하지 않는다
            table.add(h, a, hs_i, as_i)


# ─────────────────── 팀별 최고 연속 기록 (상세보기 팝업 전용) ───────────────────
# 위의 순위·폼·최근10은 전부 '그 시즌 안에서만' 세지만, 이 기록은 시즌 경계를 넘어
# 이어 센다 — 실제 축구 기록이 그렇게 매겨지기 때문이다(예: 아스널 49경기 무패).
# 기준은 실제 스코어(HS/AS)다. 핸디 결과(RT)가 아니라 순수하게 이기고 졌는지만 본다.
# 집계 범위는 '그 경기 직전까지' — 이 파일의 다른 지표들과 같은 원칙이라, 과거 경기를
# 다시 열어봐도 그 당시 기준 숫자가 나온다(그 경기 이후 기록은 안 섞인다).

def _chrono_key(s, r, no):
    """시간순 정렬 키. DT는 70%가 비어 있어 못 쓰므로 시즌→라운드→경기번호로 세운다.
    시즌 문자열은 '09-10'~'26-27'(유럽)이든 '2013'~'2026'(K리그)이든 그냥 문자열로
    비교해도 연도순이 맞다."""
    try:
        n = float(no)
    except (TypeError, ValueError):
        n = 0.0
    return (str(s), _round_num(r), n)


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

    cutoff = _chrono_key(season, round_, no)
    rows = []
    for s, r, n, h, hs, as_ in zip(mine["S"], mine["R"], mine["No"],
                                   mine["HT"].astype(str).str.strip(),
                                   mine["HS"], mine["AS"]):
        key = _chrono_key(s, r, n)
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


ADDED_COLS = RANK_COLS + FORM_COLS + RECENT_COLS


def attach_rank_and_form(df, group_cols=("S",)):
    """
    경기 데이터에 순위(HP/AP)·폼(HTF/HF/AF/ATF)·최근전적(HRF/ARF/HR10/AR10)
    컬럼을 붙여 새 DataFrame을 돌려준다.
    group_cols 로 따로 집계할 단위를 정한다 — 리그 하나면 ("S",),
    여러 리그가 섞인 통합DB면 ("Source_League", "S").
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
        _attach_one_season(sdf, buckets)

    out = df.copy()
    for col in ADDED_COLS:
        out[col] = pd.Series(buckets[col], dtype=object).reindex(df.index)
    return out
