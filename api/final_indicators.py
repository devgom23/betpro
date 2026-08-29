"""최신배당(배변 후) 기준 27개 지표 재계산.

'최신배당 불러오기'로 EK*/EF*(최종배당)를 받아온 경기에 대해, 그 최종배당이
어느 배당 구간에 속하는지 다시 매겨 27개 지표 표본을 새로 센다. 결과는 `E_`
접두사를 붙인 컬럼(예: 'E_F-W 1')에 저장해 화면에서 두 번째 줄로 보여준다.

⚠ engine.py의 계산 함수는 한 글자도 고치지 않는다. get_samples_fast()에 넘기는
  배당 칸만 최종배당으로 바꿔 끼우고 그대로 부른다 —
  '현재 경기 행'은 shadow_row(), '표본 풀'은 shadow_pool().

⚠ 2026-08-30 수정: 예전에는 표본 풀을 초기배당 그대로 뒀다. "과거 경기에게 그때 그
  배당은 바꿀 수 없는 사실"이라는 이유였는데, 그러면 이 경기의 '마감배당'을 과거
  경기의 '초기배당' 칸에서 찾게 되어 서로 다른 시점의 배당을 맞대는 꼴이 된다.
  실측에서 이 지표가 반대로 맞는다는 게 드러나 풀도 최종배당 기준으로 바꿨다
  (근거와 수치는 shadow_pool() 주석에 있다).
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
# 표본 풀도 배변배당으로 갈아끼우므로(shadow_pool) 그 원본 칸까지 같이 읽어야 한다.
PREP_COLS_E = PREP_COLS + list(FINAL_TO_BASE)

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


def shadow_pool(db: pd.DataFrame) -> pd.DataFrame:
    """표본 풀(비교 대상이 되는 과거 경기들)도 최종배당으로 갈아끼운 복사본.

    ⚠ 2026-08-30 이전에는 이걸 안 했다. 표본 풀은 초기배당 그대로 두고 '지금 이
      경기'만 최종배당으로 바꿔 찾았는데(shadow_row), 그러면 서로 다른 시점의
      배당을 맞대게 된다. 1.8로 열렸다가 1.5로 마감한 경기를 '초기배당 1.5' 칸에서
      찾으면, 그 칸에 든 건 처음부터 1.5였던 더 센 팀들이라 정배 쪽이 부풀려진다.
      실측(6대리그 32,466경기): 실제 결과가 '가장 작은 칸'이었던 비율이 초기 지표는
      20.5%(정보 있음)인데 배변 지표는 26.3%, 해외는 35.9%로 뒤집혔다. 배당이 안
      움직인 경기에서는 초기와 값이 같고(20.4% vs 20.5%) 움직인 경기에서만
      뒤집혔다 — 서랍을 잘못 여는 순간에만 망가진다는 뜻이다.

    최종배당이 없는 과거 경기는 그 칸을 NaN으로 둔다(초기배당으로 메우지 않는다).
    '안 움직였다'와 '아직 안 받아왔다'를 구분할 수 없는데, 초기배당으로 메우면
    바로 그 편향이 다시 섞여 들어오기 때문이다. get_samples_fast의 비교는 `==`라
    NaN은 자연히 어느 것과도 안 맞아 표본에서 빠진다.
    표본이 모자라지도 않는다 — 실측상 풀이 5%만 줄고, 지표별로는 오히려 늘었다
    (해)승+무+패는 표본 0건인 경기가 24.2% → 0.0%, 중앙값 5건 → 16건).
    """
    out = db.copy()
    for e_col, base_col in FINAL_TO_BASE.items():
        if base_col not in out.columns:
            continue
        v = pd.to_numeric(out[e_col], errors='coerce') if e_col in out.columns \
            else pd.Series(np.nan, index=out.index)
        out[base_col] = v.where(v > 0)      # 0·1.00 미만·빈칸은 배당이 아니다
    return out


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
    """통합DB(6대리그)의 _prep_db 캐시 — 계산에 쓰는 칸만 읽어 만든다.
    표본 풀도 최종배당 기준이라 EK*/EF*까지 읽고 shadow_pool로 갈아끼운다."""
    frames = []
    con = sqlite3.connect(db_path)
    try:
        tabs = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        for lg in leagues:
            if lg not in tabs:
                continue
            have = {r[1] for r in con.execute(f'PRAGMA table_info("{lg}")').fetchall()}
            sel = ', '.join(f'"{c}"' for c in PREP_COLS_E if c in have)
            if not sel:
                continue
            d = pd.read_sql(f'SELECT {sel} FROM "{lg}"', con)
            if len(d):
                frames.append(d)
    finally:
        con.close()
    total = pd.concat(frames, ignore_index=True) if frames else league_df
    return engine._prep_db(shadow_pool(total))


def attach_to_df(df: pd.DataFrame, idxs, db_path: str, leagues) -> int:
    """df의 idxs 행들을 최종배당 기준으로 재계산해 E_ 컬럼에 채워 넣는다.

    최종배당이 하나도 없는 행은 건드리지 않는다(계산해 봐야 초기배당과 같은 값이라
    두 줄로 보여줄 의미가 없고, 없던 값을 있는 것처럼 보이게 하지 않기 위해서다).
    반환: 실제로 재계산한 경기 수.
    """
    targets = [i for i in idxs if has_final_odds(df.loc[i].to_dict())]
    if not targets:
        return 0

    # 표본 풀도 최종배당 기준으로 — 이 경기만 바꾸고 풀을 그대로 두면 서로 다른
    # 시점의 배당을 맞대게 된다(shadow_pool 주석 참고).
    db_cache = engine._prep_db(shadow_pool(df))
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
