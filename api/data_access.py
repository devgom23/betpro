"""
DB 읽기 + 엔진 호출 래퍼.
- 스코프(master/user)에 따라 올바른 DB 파일을 열어 리그/통합 데이터를 로드.
- 파일 mtime 기준의 아주 단순한 메모리 캐시로 반복 로드를 피한다
  (Streamlit의 st.cache_data + (path, mtime) 키 아이디어를 그대로 이식).
"""
import math
import os
import sqlite3
import numpy as np
import pandas as pd

from deps import PATHS
import engine
import standings

LEAGUES = PATHS.LEAGUES

# {(kind, db_path): (mtime, DataFrame)} 형태의 초경량 캐시
_CACHE = {}

# 똥사 위험도 — 똥배가 무/역으로 뒤집힐 확률(%). 6대리그 똥배 7,724건 실측 로지스틱 회귀.
#
# [왜 정배배당 하나만 쓰나 — 후보를 다 붙여보고 고른 결과]
#   과거 절반 시즌으로 학습해 이후 시즌으로 검증한 Brier(낮을수록 정확):
#     전체평균만 0.20618 / 정배배당만 0.20062 / +무배당 0.20099 / +라운드똥배수 0.20083
#     / +핸디배당 0.20083 / +팀성향 0.20118
#   가장 단순한 '정배배당만'이 가장 정확했다. 무배당은 정배배당과 상관 -0.888이라 같은
#   말을 하고(정배 1.35 이상이면 무배당은 거의 다 4.5 미만), 라운드 똥배 개수도 배당에
#   흡수된다. 팀 성향은 겉보기 차이의 23%만 진짜인 데다(나머지는 운) 실제로 붙여보니
#   방향조차 안 맞아서 정확도가 떨어졌다. 리그별 차이는 운을 걷어내면 0.00%p라 공통이다.
#
# 검증: 예측 구간별 실제 똥사율 오차 -3.4 ~ +1.8%p. 예측 범위는 14.6% ~ 42.4%.
DDONG_RISK_B0 = -4.8309
DDONG_RISK_B1 = 3.0372


def _ddong_risk(odds):
    """정배배당 → 똥사(무/역) 확률 %."""
    if odds is None or pd.isna(odds):
        return np.nan
    return 100.0 / (1.0 + math.exp(-(DDONG_RISK_B0 + DDONG_RISK_B1 * float(odds))))


def _ddong_columns(df: pd.DataFrame, w_col: str = "KW", l_col: str = "KL"):
    """똥배(DDONG)/똥사 위험도(DDONG_RISK)/똥사(DDONGSA) — 국내배당 KW·KL 중 1.49 이하인 값을 "똥"으로 보고,
    같은 라운드(시즌 S + 라운드 R) 안에서 낮은 배당 순으로 똥1, 똥2... 번호를 매긴다.
    KW·KL이 동시에 1.49 이하로 나오는 경우는 없다고 보고, 있어도 더 낮은 쪽 하나만 쓴다.
    똥사는 "똥배로 체크된"(DDONG 값이 있는) 경기 중에서만, 실제 결과(RT)가 무(3) 또는
    역(4)이면 붙는 표시다 — 똥배가 아닌 경기는 결과가 무/역이어도 똥사가 아니다.

    w_col/l_col로 어느 배당을 볼지 고른다 — 초기배당(KW/KL)과 최종배당(EKW/EKL) 둘 다
    같은 규칙으로 매기기 위해서다. 배당이 움직이면 똥배 순위 자체가 바뀔 수 있다
    (실측: FC서울 초기 1.49 → 최종 1.31)."""
    n = len(df)
    ddong = pd.Series([""] * n, index=df.index, dtype=object)
    ddongsa = pd.Series([""] * n, index=df.index, dtype=object)
    risk = pd.Series([np.nan] * n, index=df.index, dtype=float)
    if df.empty:
        return ddong, risk, ddongsa

    if w_col in df.columns and l_col in df.columns and "S" in df.columns and "R" in df.columns:
        kw = pd.to_numeric(df[w_col], errors="coerce")
        kl = pd.to_numeric(df[l_col], errors="coerce")
        groups: dict[tuple, list[tuple]] = {}
        for idx, s, r, w, l in zip(df.index, df["S"], df["R"], kw, kl):
            w_ok = pd.notna(w) and w <= 1.49
            l_ok = pd.notna(l) and l <= 1.49
            if not (w_ok or l_ok):
                continue
            cand = min(v for v, ok in ((w, w_ok), (l, l_ok)) if ok)
            groups.setdefault((s, r), []).append((idx, cand))
            risk.loc[idx] = _ddong_risk(cand)
        for items in groups.values():
            items.sort(key=lambda t: t[1])
            for rank, (idx, _) in enumerate(items, start=1):
                ddong.loc[idx] = f"똥{rank}"

    if "RT" in df.columns:
        rt_num = pd.to_numeric(df["RT"], errors="coerce")
        ddongsa[(ddong != "") & rt_num.isin([3, 4])] = "똥사"

    return ddong, risk, ddongsa


def _read_table(db_path: str, table: str) -> pd.DataFrame:
    if not os.path.exists(db_path):
        return pd.DataFrame()
    con = sqlite3.connect(db_path)
    try:
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if table not in names:
            return pd.DataFrame()
        return pd.read_sql(f'SELECT * FROM "{table}"', con)
    finally:
        con.close()


def load_league_df(db_path: str, league: str) -> pd.DataFrame:
    """단일 리그 로드(mtime 캐시)."""
    key = ("league:" + league, db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    df = _read_table(db_path, league)
    _CACHE[key] = (mt, df)
    return df


def load_league_df_ranked(db_path: str, league: str) -> pd.DataFrame:
    """
    단일 리그 + 시즌별 순위(HP/AP)·폼(HTF/HF/AF/ATF) 컬럼. 화면 표시·엑셀 다운로드 전용이다.

    ⚠ DB에 다시 쓰는 경로(업로드/삭제)에서는 절대 쓰지 말 것 — 표시용으로만 덧붙인
       컬럼들이 테이블에 저장되어 버린다. 그쪽은 load_league_df(원본)를 그대로 쓴다.

    여기서는 캐시하지 않는다 — 화면·엑셀은 전부 load_league_df_ev(이 표에 EV까지 붙인
    것)를 쓰고, 이 함수는 그 중간 단계로만 불린다. 중간 결과까지 캐시하면 리그마다
    같은 데이터를 세 벌(원본/ranked/ev) 들고 있게 되어 메모리만 128MB 더 먹는다.
    실제 계산은 ev 캐시가 풀렸을 때(=DB가 바뀌었을 때)만 일어난다.
    """
    # attach_rank_and_form()은 원본 df를 그대로 돌려줄 때가 있다(빈 데이터 등) —
    # 아래서 컬럼을 더 붙이기 전에 반드시 .copy()로 떼어내야 원본(raw) 캐시가
    # 오염되어 표시용 컬럼이 업로드/삭제 쪽으로 새어 들어가는 사고를 막는다.
    df = standings.attach_rank_and_form(load_league_df(db_path, league)).copy()
    df["DDONG"], df["DDONG_RISK"], df["DDONGSA"] = _ddong_columns(df)
    # 최종배당(배변 후) 기준 똥배 — 화면에서 초기/최종 두 줄로 나란히 보여준다.
    # E_ 접두사 = 최종배당에서 나온 값(End). 저장되는 값이 아니라 조회할 때 만든다.
    df["E_DDONG"], df["E_DDONG_RISK"], df["E_DDONGSA"] = _ddong_columns(df, "EKW", "EKL")
    return df


def load_league_df_ev(db_path: str, league: str) -> pd.DataFrame:
    """load_league_df_ranked + EV/핸승위험도 컬럼(ev_model.attach_for_league)까지 붙인 표.
    화면(리그 조회·이번주 리스트·이번주 픽)이 쓰는 최종 형태다.

    EV 부착은 리그 전체 이력으로 확률표를 만들어 전 행에 붙이는 작업이라 리그당 80~110ms
    (6대리그+내 데이터 합계 실측 686ms)가 든다. 예전엔 화면마다 매 요청 다시 계산해서
    이번주 리스트/픽이 캐시가 데워진 뒤에도 항상 700ms 넘게 걸렸다 — DB가 바뀔 때만
    다시 계산하도록 원본과 같은 mtime 캐시에 얹는다.

    ⚠ 캐시된 df를 그대로 돌려주므로 받는 쪽에서 값을 고쳐 쓰면 안 된다(조회·필터·직렬화만).
      ev_model.attach_for_league 자체는 입력을 복사해 쓰므로 ranked 캐시는 오염되지 않는다.
    """
    import ev_model
    return cached_derive(db_path, "league_ev:" + league,
                         lambda: ev_model.attach_for_league(load_league_df_ranked(db_path, league)))


def load_total_df(db_path: str) -> pd.DataFrame:
    """스코프 DB의 6개 리그를 합친 통합DB 로드(mtime 캐시).

    ⚠ 여기서 리그를 읽을 때는 반드시 load_league_df(캐시)를 쓴다 — 예전엔 _read_table을
      직접 불러서, 같은 리그가 이미 캐시에 올라와 있는데도 6개를 전부 디스크에서 다시
      읽었다(실측 2,345ms → 캐시 재사용 69ms, 34배). 상세보기 팝업이 이 함수를 쓰는데
      DB에 뭔가 저장할 때마다 mtime이 바뀌어 캐시가 풀리므로, 저장 직후 팝업을 처음
      열면 매번 2.3초를 기다려야 했다.
      아래 d.copy()가 있어서 캐시된 원본에 Source_League가 새어 들어갈 걱정은 없다.
    """
    key = ("total", db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    frames = []
    for lg in LEAGUES:
        d = load_league_df(db_path, lg)
        if len(d):
            d = d.copy()
            d["Source_League"] = lg
            frames.append(d)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    _CACHE[key] = (mt, df)
    return df


# 상대전적·시즌전적이 실제로 읽는 컬럼만 추린 목록.
#
# 리그 테이블은 컬럼이 370개 가까이 된다(26개 지표 + 배당 + 순위/폼 등). 그런데
# 상대전적 계산(_head_to_head_calc)과 시즌전적(_season_matches)이 보는 건 아래 14개
# 뿐이다. 예전엔 상세보기 팝업이 열릴 때마다 통합DB를 만들려고 370컬럼짜리 리그 6개를
# 통째로 읽었다 — 실측 3,545ms(리그당 520~640ms). 같은 데이터를 14컬럼만 읽으면
# 178ms(20배)이고, 계산 결과는 완전히 동일하다(summary/wdl/matches 전부 대조 확인).
#
# ⚠ 여기에 없는 컬럼을 상대전적 쪽에서 쓰기 시작하면 조용히 KeyError가 아니라 "그
#   컬럼이 없는 것처럼" 동작한다(_head_to_head_calc가 `if c in m.columns`로 거른다).
#   상대전적/시즌전적/엑셀에서 새 컬럼을 쓰려면 반드시 이 목록에 먼저 추가할 것.
# "No"는 상대전적 화면에는 안 나오지만 연속기록(standings.max_streaks_before)이 경기
# 순서를 매기는 데 쓴다 — 빼면 그 함수가 KeyError를 낸다.
H2H_COLS = ["S", "R", "No", "DT", "TM", "HT", "HS", "AS", "AT", "RT",
            "KW", "KD", "KL", "FW", "FD", "FL"]


def _read_table_slim(db_path: str, table: str, cols: list) -> pd.DataFrame:
    """테이블에서 지정한 컬럼만 읽는다(없는 컬럼은 조용히 건너뛴다)."""
    if not os.path.exists(db_path):
        return pd.DataFrame()
    con = sqlite3.connect(db_path)
    try:
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if table not in names:
            return pd.DataFrame()
        have = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
        use = [c for c in cols if c in have]
        if not use:
            return pd.DataFrame()
        sel = ", ".join(f'"{c}"' for c in use)
        return pd.read_sql(f'SELECT {sel} FROM "{table}"', con)
    finally:
        con.close()


def load_league_h2h_df(db_path: str, league: str) -> pd.DataFrame:
    """단일 리그 — 상대전적용 슬림 표(mtime 캐시). 내 데이터(user 스코프)가 쓴다."""
    key = ("league_h2h:" + league, db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    df = _read_table_slim(db_path, league, H2H_COLS)
    _CACHE[key] = (mt, df)
    return df


def load_total_h2h_df(db_path: str) -> pd.DataFrame:
    """6개 리그를 합친 상대전적용 슬림 통합DB(mtime 캐시).

    load_total_df(370컬럼)와 행 수·값이 같고 컬럼만 14개로 줄인 것이다. 상세보기 팝업과
    상대전적 탭은 이쪽을 쓴다 — 저장 직후처럼 캐시가 풀린 상태에서 팝업을 처음 열 때
    4.1초를 기다리던 게 0.3초대로 줄어든다.

    ⚠ 화면 표(리그 조회·엑셀)는 여전히 load_league_df_ev를 써야 한다. 이 표에는 지표도
      배당(E*)도 순위도 없다.
    """
    key = ("total_h2h", db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    frames = []
    for lg in LEAGUES:
        d = load_league_h2h_df(db_path, lg)
        if len(d):
            d = d.copy()
            d["Source_League"] = lg
            frames.append(d)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    _CACHE[key] = (mt, df)
    return df


def load_combo_index(db_path: str) -> dict:
    """승+패 배당 조합 → 과거 결과 건수 표(mtime 캐시).

    combo_dir.attach()가 리그 표에 방향성 컬럼을 붙일 때 쓴다. 조합 전수를 세려면
    통합DB를 한 번 훑어야 해서, 요청마다 다시 만들면 리그 조회가 그만큼 느려진다.
    """
    import combo_dir as CD
    return cached_derive(db_path, "combo_index", lambda: CD.build_index(load_total_df(db_path)))


def cached_derive(db_path: str, key_name: str, build):
    """DataFrame이 아닌 '파생 결과'(인덱스·집계 등)도 같은 mtime 캐시에 얹는다.

    build()는 캐시가 없거나 DB가 바뀌었을 때만 호출된다. 리그 df처럼 DB 내용에서만
    나오는 값이라면 무엇이든 담을 수 있어, 요청마다 같은 계산을 반복하는 걸 막는다.
    (베팅내역의 RT 인덱스가 요청마다 리그 전체를 다시 훑느라 실측 155ms를 매번 썼다.)
    캐시 키에 db_path가 들어가므로 계정별 user.db끼리 섞이지 않는다.
    """
    key = (key_name, db_path)
    mt = PATHS.db_mtime(db_path)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]
    val = build()
    _CACHE[key] = (mt, val)
    return val


def df_to_records(df: pd.DataFrame):
    """DataFrame → JSON 안전한 레코드 리스트 (NaN→null, numpy타입 정리)."""
    import json
    if df is None or df.empty:
        return []
    return json.loads(df.to_json(orient="records", force_ascii=False,
                                 date_format="iso"))


