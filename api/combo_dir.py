"""승+패 배당 조합 방향성 — 배당이 완전히 똑같은 과거 경기만 모아 방향을 정한다.

리그 표의 배당대(정배배당 구간)나 26개 지표와는 완전히 다른 접근이다.
    "승 2.20 / 패 2.50 인 경기는 과거에 어떤 결과가 나왔나"
를 그대로 세서, 그중 **가장 적게 나온 결과 하나를 배제**하는 것이 방향성이다.
CLAUDE.md 5-1장의 "3way에서 1개가 안 나온다에 건다"와 정확히 같은 형태다.

    핸승(RT1) 배제 → 플핸무      핸무(RT2) 배제 → 플핸승
    무  (RT3) 배제 → 정역        역  (RT4) 배제 → 정무

2026-08-30 실측(6대리그 35,952경기, 그 경기 이전 표본만 써서 미래 정보 차단):
    해배·통합 표본 80.5% / 국배·통합 78.6% / 해배·리그 79.5% / 국배·리그 77.1%
    표본 20건 이상이면 80.8%까지 오른다. 방향성별로는 정무가 가장 잘 맞았다
    (해배 84.4%). 여섯 리그가 78~81%로 거의 같아 리그를 안 가린다.

⚠ 표본은 '통합(6대리그 합산)'을 기본으로 쓴다. 국배는 리그별로 쪼개면 조합당
   평균 2경기밖에 안 남아 방향성을 정할 수 없다(통합은 평균 6.7경기).

초기·배변 네 가지를 각각 따로 만든다 — 초기 표본은 초기 배당끼리, 배변 표본은
배변 배당끼리만 센다(섞으면 기준이 어긋난다). 배변도 과거가 3만 건 넘게 채워져
있어 표본이 만들어진다(국배 30,860 / 해배 33,991). 배변이 초기와 실제로 다른
경기는 국배 8,521건 · 해배 32,969건이라, 해배는 사실상 매번 다른 표를 보게 된다.

⚠ '가장 적게 나온 결과'가 동점이면 하나를 억지로 고르지 않는다. 동점인 것들을
   그대로 묶어서 돌려준다(예: 핸승·무가 둘 다 최소면 '플핸무/정역'). 표본이 작을수록
   동점이 흔해서(24경기짜리도 동점이 난다), 하나를 임의로 고르면 근거 없는 방향이
   화면에 뜨게 된다.
"""
from collections import defaultdict

import pandas as pd

import betpro_paths as PATHS

# 배제되는 RT → 방향성 이름
NAME_OF = {1: '플핸무', 2: '플핸승', 3: '정역', 4: '정무'}
RT_LABEL = {1: '핸승', 2: '핸무', 3: '무', 4: '역'}

# 네 가지 배당 조합. (접두어, 인덱스키, 승컬럼, 패컬럼, 리그인덱스키)
#   SPK=국내 초기 / SPF=해외 초기 / SPEK=국내 배변 / SPEF=해외 배변
SOURCES = [
    ('SPK', 'K', 'KW', 'KL', 'KLG'),
    ('SPF', 'F', 'FW', 'FL', 'FLG'),
    ('SPEK', 'EK', 'EKW', 'EKL', 'EKLG'),
    ('SPEF', 'EF', 'EFW', 'EFL', 'EFLG'),
]

# 화면에 붙는 컬럼.
#   *_NAME  방향성 이름(정무·정역·플핸무·플핸승). 최소값이 동점이면 '플핸무/정역'처럼 묶인다
#   *_EXCL  배제하는 결과(핸승·핸무·무·역). 동점이면 '핸승·무'
#   *_RATE  그 조합 표본에서 배제 대상이 안 나온 비율(%)
#   *_N     표본 경기 수
#   *_CNT   표본의 핸승/핸무/무/역 건수 — 툴팁용 "8·6·14·12"
#   *_LGN   같은 리그 안에서만 센 표본 수(참고용, 방향성은 통합으로 정한다)
#   *_TIE   최소값이 동점이었나(1/0) — 화면에서 흐리게 표시해 구분한다
COLS = []
for _p, *_ in SOURCES:
    COLS += [f'{_p}_NAME', f'{_p}_EXCL', f'{_p}_RATE', f'{_p}_N',
             f'{_p}_CNT', f'{_p}_LGN', f'{_p}_TIE']


def _pos(v):
    """양수 배당이면 float, 아니면 None(빈칸·0·1 이하·문자 전부 None)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 1 else None


def _combo(w, l):
    a, b = _pos(w), _pos(l)
    return None if a is None or b is None else (round(a, 2), round(b, 2))


def build_index(total_df: pd.DataFrame) -> dict:
    """통합DB에서 (승,패) 조합 → 결과 건수 표를 만든다(네 가지 배당 각각).

    돌려주는 값:
        {'K': {조합: [핸승,핸무,무,역]}, 'F':…, 'EK':…, 'EF':…,
         'KLG': {(리그,조합): 표본수}, 'FLG':…, 'EKLG':…, 'EFLG':…}
    리그별은 건수만 센다 — 방향성은 통합으로 정하고, 리그 표본은 참고로만 보여준다.
    """
    keys = [s[1] for s in SOURCES]
    idx = {k: defaultdict(lambda: [0, 0, 0, 0]) for k in keys}
    idx.update({s[4]: defaultdict(int) for s in SOURCES})
    if total_df is None or total_df.empty:
        return {k: dict(v) for k, v in idx.items()}
    lg_col = 'Source_League' if 'Source_League' in total_df.columns else None
    # 없는 배당 컬럼(내 데이터 리그 등)은 건너뛴다
    use = [s for s in SOURCES if s[2] in total_df.columns and s[3] in total_df.columns]
    if 'RT' not in total_df.columns or not use:
        return {k: dict(v) for k, v in idx.items()}
    cols = ['RT'] + [c for s in use for c in (s[2], s[3])] + ([lg_col] if lg_col else [])
    for row in total_df[cols].itertuples(index=False):
        try:
            rt = int(float(row[0]))
        except (TypeError, ValueError):
            continue
        if rt not in (1, 2, 3, 4):
            continue
        lg = row[-1] if lg_col else None
        for i, (_p, key, _wc, _lc, lgkey) in enumerate(use):
            c = _combo(row[1 + i * 2], row[2 + i * 2])
            if c is None:
                continue
            idx[key][c][rt - 1] += 1
            if lg is not None:
                idx[lgkey][(lg, c)] += 1
    return {k: dict(v) for k, v in idx.items()}


def _direction(counts, self_rt=None):
    """건수 4칸에서 '가장 적게 나온 것'을 배제 대상으로 고른다.

    self_rt를 주면 그 경기 자신을 표본에서 뺀다 — 이미 결과가 있는 과거 경기를
    볼 때 자기 결과로 자기를 맞히는 꼴이 되지 않게 한다.

    최소값이 동점이면 하나를 억지로 고르지 않고 동점인 것을 전부 돌려준다
    (bads가 2개 이상). 표본이 작을수록 동점이 흔한데, 그때 임의로 하나를 집으면
    근거 없는 방향이 화면에 뜬다. 동점인 것들은 배제 대상이 서로 다를 뿐
    '가장 적게 나왔다'는 점은 같으므로 적중률(100 − 그 결과 비율)도 서로 같다.

    단, 넷이 전부 동점이면(예: 1·1·1·1) '가장 적게 나온 것'이라는 말 자체가
    성립하지 않는다 — 뺄 것을 못 고르므로 방향성이 없다. 그때는 None을 돌려준다.
    (셋이 동점인 경우도 남는 건 하나뿐이라 사실상 "하나만 빼면 된다"가 아니라
     "셋 중 아무거나"가 되지만, 그래도 하나는 확실히 제외되므로 정보가 있다.)

    돌려주는 값: (배제 RT 목록, 표본 수, 4칸 건수) / 방향을 못 정하면 None
    """
    c = list(counts)
    if self_rt in (1, 2, 3, 4):
        c[self_rt - 1] -= 1
    n = sum(c)
    if n <= 0:
        return None
    lo = min(c)
    bads = [i + 1 for i, v in enumerate(c) if v == lo]
    if len(bads) == 4:
        return None
    return bads, n, c


def attach(df: pd.DataFrame, idx: dict, league: str | None = None) -> pd.DataFrame:
    """리그 표에 방향성 컬럼을 붙인 사본을 돌려준다(원본은 건드리지 않는다)."""
    out = df.copy()
    for col in COLS:
        out[col] = None
    if not idx or 'RT' not in df.columns:
        return out

    for p, key, wc, lc, lgkey in SOURCES:
        if wc not in df.columns or lc not in df.columns:
            continue
        names, excls, rates, ns, cnts, lgns, ties = [], [], [], [], [], [], []
        for rt_v, w, l in zip(df['RT'], df[wc], df[lc]):
            c = _combo(w, l)
            name = excl = cnt = None
            rate = n = lgn = None
            tie = None
            if c is not None and c in idx.get(key, {}):
                try:
                    self_rt = int(float(rt_v))
                except (TypeError, ValueError):
                    self_rt = None
                got = _direction(idx[key][c], self_rt if self_rt in (1, 2, 3, 4) else None)
                if got:
                    bads, total, cc = got
                    # 동점이면 '플핸무/정역', 배제도 '핸승·무'로 묶어서 보여준다.
                    name = '/'.join(NAME_OF[b] for b in bads)
                    excl = '·'.join(RT_LABEL[b] for b in bads)
                    # 동점인 것들은 건수가 같으므로 어느 걸 써도 적중률이 같다.
                    rate = round(100.0 * (total - cc[bads[0] - 1]) / total, 1)
                    n = total
                    cnt = '·'.join(str(x) for x in cc)
                    tie = 1 if len(bads) > 1 else 0
                    if league:
                        lgn = idx.get(lgkey, {}).get((league, c))
                        if lgn and self_rt in (1, 2, 3, 4):
                            lgn -= 1
            names.append(name)
            excls.append(excl)
            rates.append(rate)
            ns.append(n)
            cnts.append(cnt)
            lgns.append(lgn)
            ties.append(tie)
        out[f'{p}_NAME'] = names
        out[f'{p}_EXCL'] = excls
        out[f'{p}_RATE'] = rates
        out[f'{p}_N'] = ns
        out[f'{p}_CNT'] = cnts
        out[f'{p}_LGN'] = lgns
        out[f'{p}_TIE'] = ties
    return out
