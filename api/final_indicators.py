"""최신배당(배변 후) 기준 27개 지표 재계산.

'최신배당 불러오기'로 EK*/EF*(최종배당)를 받아온 경기에 대해, 그 최종배당이
어느 배당 구간에 속하는지 다시 매겨 27개 지표 표본을 새로 센다. 결과는 `E_`
접두사를 붙인 컬럼(예: 'E_F-W 1')에 저장해 화면에서 두 번째 줄로 보여준다.

⚠ engine.py의 계산 함수는 한 글자도 고치지 않는다. get_samples_fast()에 넘기는
  '현재 경기 행'의 배당 칸만 최종배당으로 바꿔 끼우고(아래 shadow_row) 그대로 부른다.

⚠ 표본 풀(비교 대상이 되는 과거 경기들)은 초기배당 기준 그대로 둔다. 과거 경기에게
  '그때 그 배당'은 바꿀 수 없는 사실이고, 그 배당으로 어떤 결과가 났는지가 표본의
  의미이기 때문이다. 바뀌는 것은 "지금 이 경기를 어느 칸에서 찾을 것인가"뿐이다.
"""
from __future__ import annotations

import sqlite3

import numpy as np
import pandas as pd

import engine

# 27개 지표를 어느 표본 풀에서 세는지에 따라 둘로 나뉜다.
#   개별리그(19개) — 그 리그 안에서만 (해외 1~9, 국내 14~22, 27번 국)플핸)
#   통합DB(8개)    — 6대리그 전체에서 (해/통 10~13, 국/통 23~26)
# 목록·순서는 engine.analyze_row()의 logics_new_individual / logics_new_total과 같다.
IND_LEAGUE_CODES = ['F-W', 'F-L', 'F-WL', 'F-WDL', 'F-W-HW',
                    'F-W-HT', 'F-L-AT', 'F-WL-HT', 'F-WL-AT',
                    'K-W', 'K-L', 'K-WL', 'K-WDL', 'K-W-HW',
                    'K-W-HT', 'K-L-AT', 'K-WL-HT', 'K-WL-AT',
                    'K-PL']
IND_TOTAL_CODES = ['TF-W', 'TF-L', 'TF-WL', 'TF-WDL',
                   'TK-W', 'TK-L', 'TK-WL', 'TK-WDL']
IND_CODES = IND_LEAGUE_CODES + IND_TOTAL_CODES

# 최종배당 → 그 자리에 끼울 초기배당 칸. get_samples_fast()가 실제로 읽는 9칸만 있으면
# 된다(KH/FH 같은 핸디 부호나 KD 계열 중 안 쓰는 칸은 넣어도 계산에 영향이 없다).
FINAL_TO_BASE = {'EFW': 'FW', 'EFD': 'FD', 'EFL': 'FL', 'EFHW': 'FHW',
                 'EKW': 'KW', 'EKD': 'KD', 'EKL': 'KL',
                 'EKHW': 'KHW', 'EKHL': 'KHL'}

# _prep_db()가 표본 풀에서 실제로 읽는 컬럼. 통합DB를 만들 때 이 13개만 읽으면
# 251개 전부 읽는 것과 결과가 완전히 같으면서 16배 빠르다(실측 2,431ms → 155ms).
PREP_COLS = ['FW', 'FD', 'FL', 'FHW', 'KW', 'KD', 'KL', 'KHW', 'KHL',
             'HS', 'HT', 'AT', 'RT']

# 재계산 결과로 만들어지는 컬럼 전체 — 27개×4칸 + 플핸 예측 5칸.
E_SAMPLE_COLS = [f'E_{c} {i}' for c in IND_CODES for i in (1, 2, 3, 4)]
E_PH_COLS = ['E_PH_F', 'E_PH_K', 'E_PH_PICK', 'E_PH_HIT', 'E_PH_DOM']
E_ALL_COLS = E_SAMPLE_COLS + E_PH_COLS


def _pos(v):
    """양수인 배당이면 float, 아니면 None(빈칸·0·문자 전부 None)."""
    try:
        if v is None or pd.isna(v):
            return None
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def shadow_row(rd: dict) -> dict:
    """최종배당을 초기배당 자리에 끼운 '그림자 행'.

    한쪽 최종배당만 들어온 경기(예: 국내만 갱신)는 없는 쪽을 초기배당으로 둔다 —
    "안 바뀌었다"로 보는 것이 맞고, 그래야 그쪽 지표가 0으로 비지 않는다.
    """
    out = dict(rd)
    for e_col, base_col in FINAL_TO_BASE.items():
        v = _pos(rd.get(e_col))
        if v is not None:
            out[base_col] = v
    return out


def has_final_odds(rd: dict) -> bool:
    """최종배당이 하나라도 들어온 경기인가(= 재계산할 가치가 있는가)."""
    return any(_pos(rd.get(c)) is not None for c in FINAL_TO_BASE)


def recompute_row(rd: dict, db_cache: dict, total_cache: dict) -> dict:
    """한 경기의 27개 지표를 최종배당 기준으로 다시 세어 E_ 컬럼 dict로 반환."""
    sr = shadow_row(rd)

    # engine.compute_plushandi()는 접두사 없는 코드명('F-W 1')으로 읽으므로
    # 계산 중에는 원래 이름을 쓰고, 마지막에 한 번에 E_를 붙인다.
    res = {}
    for code in IND_LEAGUE_CODES:
        counts = engine.get_samples_fast(db_cache, code, sr)
        for i in range(4):
            res[f'{code} {i + 1}'] = counts[i]
    for code in IND_TOTAL_CODES:
        counts = engine.get_samples_fast(total_cache, code, sr)
        for i in range(4):
            res[f'{code} {i + 1}'] = counts[i]

    out = {f'E_{k}': v for k, v in res.items()}
    for k, v in engine.compute_plushandi(res).items():
        out[f'E_{k}'] = v
    return out


def load_total_prep(db_path: str, league_df: pd.DataFrame, leagues) -> dict:
    """통합DB(6대리그)의 _prep_db 캐시 — 계산에 쓰는 13개 컬럼만 읽어 만든다."""
    frames = []
    con = sqlite3.connect(db_path)
    try:
        tabs = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        for lg in leagues:
            if lg not in tabs:
                continue
            have = {r[1] for r in con.execute(f'PRAGMA table_info("{lg}")').fetchall()}
            sel = ', '.join(f'"{c}"' for c in PREP_COLS if c in have)
            if not sel:
                continue
            d = pd.read_sql(f'SELECT {sel} FROM "{lg}"', con)
            if len(d):
                frames.append(d)
    finally:
        con.close()
    total = pd.concat(frames, ignore_index=True) if frames else league_df
    return engine._prep_db(total)


def attach_to_df(df: pd.DataFrame, idxs, db_path: str, leagues) -> int:
    """df의 idxs 행들을 최종배당 기준으로 재계산해 E_ 컬럼에 채워 넣는다.

    최종배당이 하나도 없는 행은 건드리지 않는다(계산해 봐야 초기배당과 같은 값이라
    두 줄로 보여줄 의미가 없고, 없던 값을 있는 것처럼 보이게 하지 않기 위해서다).
    반환: 실제로 재계산한 경기 수.
    """
    targets = [i for i in idxs if has_final_odds(df.loc[i].to_dict())]
    if not targets:
        return 0

    db_cache = engine._prep_db(df)
    total_cache = load_total_prep(db_path, df, leagues)

    # 없는 E_ 컬럼은 한 번에 붙인다 — 113개를 df[c]=...로 하나씩 넣으면 pandas가
    # 내부 블록을 매번 쪼개 느려지고 PerformanceWarning을 낸다.
    missing = [c for c in E_ALL_COLS if c not in df.columns]
    if missing:
        df[missing] = pd.DataFrame(
            {c: ('' if c == 'E_PH_PICK' else np.nan) for c in missing},
            index=df.index)

    for i in targets:
        for k, v in recompute_row(df.loc[i].to_dict(), db_cache, total_cache).items():
            df.at[i, k] = v
    return len(targets)
