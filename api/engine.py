"""
BETPRO 분석 엔진 (engine.py)
──────────────────────────────────────────────────────────────
WEB_BET_PRO.py(Streamlit 본체)의 578~1135번 줄을 '한 글자도 바꾸지 않고'
그대로 떼어낸 순수 계산 모듈입니다. Streamlit 의존성이 전혀 없어
FastAPI 등 어떤 환경에서도 그대로 재사용할 수 있습니다.

포함 함수:
  find_header_row, normalize_team_names, _map_rt_value, preprocess_data,
  compute_domestic_nh_share(_fast), _prep_domestic_cache, _prep_db,
  get_samples(_fast), analyze_row, compute_plushandi, analyze_dataframe,
  recompute_pending_matches, recompute_all_matches (WEB_BET_PRO.py 1638~1738줄 이식)
포함 상수:
  RT_TEXT_MAP, PH_F_CODES, PH_K_CODES, PH_TABLE, PH_MIN_SAMPLE, PH_BASE_RATE

⚠️ 계산 로직은 절대 수정 금지 (오랜 실측 검증으로 확정된 부분).
   원본과 동기화가 필요하면 WEB_BET_PRO.py 해당 줄을 다시 복사하세요.
"""
import os
import sqlite3
import pandas as pd
import numpy as np

import betpro_paths as PATHS


def find_header_row(df_temp):
    for i, row in df_temp.iterrows():
        row_str = row.astype(str).values
        if 'DT' in row_str and 'HT' in row_str: return i
    return 0

def normalize_team_names(series):
    return series.astype(str).str.replace(r'\xa0', ' ', regex=True).str.strip().str.upper()


# 💡 [업데이트 내용] V1.0: 원본 한글 RT 매핑 테이블
#   실측(v18.0 6개 파일): '핸승' / '핸무' / '무(플)' / '역(플)' 4종만 존재.
#   '(플)' 은 접미사일 뿐 의미 분기 없음.
RT_TEXT_MAP = {'핸승': 1, '핸무': 2, '무(플)': 3, '역(플)': 4, '무': 3, '역': 4}


def _map_rt_value(v):
    """원본 RT(한글/숫자) → 1~4 코드. 판정 불가 시 NaN."""
    if v is None:
        return np.nan
    try:
        if pd.isna(v):
            return np.nan
    except Exception:
        pass
    s = str(v).strip()
    if s in RT_TEXT_MAP:
        return float(RT_TEXT_MAP[s])
    try:
        f = float(s)
        return f if f in (1.0, 2.0, 3.0, 4.0) else np.nan
    except (TypeError, ValueError):
        return np.nan


def preprocess_data(df_original):
    df = df_original.copy()
    df.columns = df.columns.astype(str).str.strip()
    
    rename_map = {'NO': 'No', 'no': 'No', 'Num': 'No', 'NUMBER': 'No', 'Time': 'TM', 'tm': 'TM', 'TIME': 'TM'}
    df = df.rename(columns=rename_map)
    
    cols_num = ['No', 'TM', 'HS', 'AS', 'FW', 'FD', 'FL', 'FH', 'FHW', 'FHD', 'FHL', 
                'KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL']
    
    for c in cols_num: 
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors='coerce')
        else:
            df[c] = np.nan

    # 💡 [업데이트 내용] v7.0 hotfix: 유효행 판정 기준에서 DT(날짜) 제외
    #   - 문제: 09-10 ~ 20-21 등 과거 시즌은 날짜(DT)가 비어있으나 팀명·점수·배당은
    #           정상 존재. 기존 dropna(['DT','HT','AT'])가 날짜 없는 옛 시즌을 통째로 삭제
    #           → 화면 시즌 선택에 21-22 이전 데이터가 안 나오던 원인
    #   - 해결: 경기 식별 필수값을 HT/AT(팀명)로만 한정. DT는 있으면 표기, 없으면 공란 유지
    req_cols = ['HT', 'AT']
    if all(col in df.columns for col in req_cols):
        df = df.dropna(subset=req_cols)

    # ════════════════════════════════════════════════════════════
    # 💡 [업데이트 내용] V1.0: RT 판정 방식 변경 (원본 신뢰)
    # --------------------------------------------------------------
    #  [기존] HS/AS/FW/FL 로 RT 를 매번 재계산 → 원본 한글 RT 를 읽지도 않고 덮어씀
    #  [문제] 해외 배당 FW==FL 동률 경기가 실제로 존재 → 정배 방향 판정 불가.
    #         실측 결과 원본 RT 와 재계산 RT 가 6개 리그 합계 약 280건 불일치.
    #  [변경] 원본 RT(한글 '핸승'/'핸무'/'무(플)'/'역(플)') 를 그대로 신뢰하여 매핑.
    #         RT 가 없으면 재계산하지 않고 NaN 유지.
    #  [의미] RT NaN = 결과 미확정 = 예정 경기 = 18/19/20번 예측 대상.
    #         적재는 하되 과거 표본 카운트에는 자동 미포함
    #         (get_samples_fast 가 RT==1~4 로만 매칭하므로 NaN 은 자연 제외됨)
    # ════════════════════════════════════════════════════════════
    if 'RT' in df.columns:
        df['RT'] = df['RT'].map(_map_rt_value)
    else:
        df['RT'] = np.nan

    if 'DT' in df.columns:
        # 💡 [업데이트 내용] v7.0 hotfix: 날짜 없는 과거 시즌은 NaT → 빈 문자열로 처리
        #   (기존엔 NaT가 'NaT'로 표기될 여지가 있어 방지)
        df['match_date'] = pd.to_datetime(df['DT'], errors='coerce')
        df['DT'] = df['match_date'].dt.strftime('%y-%m-%d (%a)')
        df['DT'] = df['DT'].where(df['match_date'].notna(), '')
    
    target_cols = [
        'L', 'S', 'R', 'No', 'DT', 'TM', 'HT', 'HS', 'RT', 'AS', 'AT',  
        'KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL',
        'FW', 'FD', 'FL', 'FH', 'FHW', 'FHD', 'FHL'
    ]
    
    df_clean = pd.DataFrame()
    for c in target_cols:
        if c in df.columns: df_clean[c] = df[c]
        
    if 'HT' in df_clean.columns: df_clean['HT'] = df_clean['HT'].astype(str).str.strip()
    if 'AT' in df_clean.columns: df_clean['AT'] = df_clean['AT'].astype(str).str.strip()

    return df_clean

# --- 2. 분석 엔진 ---



# 💡 [v5.2 New] 21번: 국내 정배배당 도플갱어 비핸승(플핸) 비율 계산
def compute_domestic_nh_share(row, total_db):
    """현재 경기의 국내 정배배당과 같은 배당을 가진 과거 경기들의
    비핸승(핸무+무+역) 비율을 반환. 표본 5 미만이면 None."""
    try:
        kw = row.get('KW'); kl = row.get('KL')
        kw = float(kw) if pd.notna(kw) else None
        kl = float(kl) if pd.notna(kl) else None
        if kw is None or kl is None or kw <= 1.0 or kl <= 1.0:
            return None
        kfav = round(min(kw, kl), 2)
        if total_db is None or total_db.empty:
            return None
        if 'KW' not in total_db.columns or 'KL' not in total_db.columns:
            return None
        db = total_db.copy()
        db_kw = pd.to_numeric(db['KW'], errors='coerce')
        db_kl = pd.to_numeric(db['KL'], errors='coerce')
        db_kfav = np.where(db_kw <= db_kl, db_kw, db_kl)
        db_kfav = np.round(db_kfav.astype(float), 2)
        mask = (db_kfav == kfav) & db['RT'].notna()
        rts = pd.to_numeric(db.loc[mask, 'RT'], errors='coerce').dropna()
        # 자기 자신 1건 제외 (현재 경기 결과가 있으면)
        cur_rt = row.get('RT')
        rt_list = list(rts.astype(int).values)
        try:
            if pd.notna(cur_rt) and int(float(cur_rt)) in rt_list:
                rt_list.remove(int(float(cur_rt)))
        except Exception:
            pass
        total = len(rt_list)
        if total < 5:
            return None
        non_h = sum(1 for r in rt_list if r != 1)
        return round(non_h / total, 4)
    except Exception:
        return None


# 💡 [v6.2 최적화] 국내 도플갱어 비핸승비율 - 사전계산 캐시(kfav 배열) 사용
def _prep_domestic_cache(total_db):
    """통합DB의 국내 정배배당(kfav)과 RT를 1회 추출."""
    try:
        if total_db is None or total_db.empty:
            return None
        if 'KW' not in total_db.columns or 'KL' not in total_db.columns:
            return None
        kw = pd.to_numeric(total_db['KW'], errors='coerce').to_numpy()
        kl = pd.to_numeric(total_db['KL'], errors='coerce').to_numpy()
        kfav = np.where(kw <= kl, kw, kl)
        kfav = np.round(kfav.astype(float), 2)
        rt = pd.to_numeric(total_db['RT'], errors='coerce').to_numpy()
        return {'kfav': kfav, 'rt': rt}
    except Exception:
        return None


def compute_domestic_nh_share_fast(row, dcache):
    """사전계산 캐시로 비핸승 비율 계산."""
    try:
        if dcache is None:
            return None
        kw = row.get('KW'); kl = row.get('KL')
        kw = float(kw) if pd.notna(kw) else None
        kl = float(kl) if pd.notna(kl) else None
        if kw is None or kl is None or kw <= 1.0 or kl <= 1.0:
            return None
        kfav = round(min(kw, kl), 2)
        m = (dcache['kfav'] == kfav) & (~np.isnan(dcache['rt']))
        rts = dcache['rt'][m].astype(int)
        total = len(rts)
        # 자기 자신 1건 제외
        cur_rt = row.get('RT')
        try:
            if pd.notna(cur_rt):
                cr = int(float(cur_rt))
                # 한 건만 제외
                idx = np.where(rts == cr)[0]
                if len(idx) > 0:
                    rts = np.delete(rts, idx[0])
                    total -= 1
        except Exception:
            pass
        if total < 5:
            return None
        non_h = int(np.sum(rts != 1))
        return round(non_h / total, 4)
    except Exception:
        return None


# 💡 [v6.2 최적화] DB 전처리를 1회만 수행하고 캐싱
#   - 기존 get_samples는 매 호출(경기당 23회)마다 db.copy() + 7개 컬럼 숫자변환
#     + 팀명정규화를 반복 → 11,440경기에서 26만회 중복 전처리가 병목이었음
#   - _prep_db()로 숫자/팀명/RT를 numpy 배열로 1회 추출해 dict로 캐싱
#   - get_samples_fast()는 캐시(numpy 벡터)만 받아 비교 → copy/변환 제거
#   - 산출 결과값은 기존과 100% 동일 (라운딩·자기제외 로직 보존)
def _prep_db(db):
    """DB를 1회만 전처리하여 numpy 배열 캐시(dict) 반환."""
    cache = {}
    n = len(db)
    # 💡 [26지표] KHW(국내 핸디 정배배당) 추가 - 신규 K-W-HW 지표용
    for c in ['FW', 'FD', 'FL', 'FHW', 'KW', 'KD', 'KL', 'KHW']:
        if c in db.columns:
            cache[c] = pd.to_numeric(db[c], errors='coerce').round(2).to_numpy()
        else:
            cache[c] = np.full(n, np.nan)
    # HS (ROI Zone 조건용 - 라운딩 없이)
    if 'HS' in db.columns:
        cache['HS'] = pd.to_numeric(db['HS'], errors='coerce').to_numpy()
    # 팀명 정규화 (1회)
    if 'HT' in db.columns:
        cache['HT'] = normalize_team_names(db['HT']).to_numpy()
    else:
        cache['HT'] = np.full(n, '', dtype=object)
    if 'AT' in db.columns:
        cache['AT'] = normalize_team_names(db['AT']).to_numpy()
    else:
        cache['AT'] = np.full(n, '', dtype=object)
    # RT (정수화: 1~4)
    if 'RT' in db.columns:
        cache['RT'] = pd.to_numeric(db['RT'], errors='coerce').to_numpy()
    else:
        cache['RT'] = np.full(n, np.nan)
    return cache


def get_samples_fast(cache, logic, row):
    """전처리 캐시(numpy)를 받아 표본 카운트 [핸승,핸무,무,역] 반환."""
    try: fw = round(float(row.get('FW', 0)), 2)
    except: fw = 0
    try: fd = round(float(row.get('FD', 0)), 2)
    except: fd = 0
    try: fl = round(float(row.get('FL', 0)), 2)
    except: fl = 0
    try: fhw = round(float(row.get('FHW', 0)), 2)
    except: fhw = 0
    try: kw = round(float(row.get('KW', 0)), 2)
    except: kw = 0
    try: kd = round(float(row.get('KD', 0)), 2)
    except: kd = 0
    try: kl = round(float(row.get('KL', 0)), 2)
    except: kl = 0
    try: khw = round(float(row.get('KHW', 0)), 2)   # 💡 [26지표] 국내 핸디 정배배당
    except: khw = 0

    ht = normalize_team_names(pd.Series([row.get('HT', '')]))[0]
    at = normalize_team_names(pd.Series([row.get('AT', '')]))[0]

    cFW = cache['FW']; cFD = cache['FD']; cFL = cache['FL']; cFHW = cache['FHW']
    cKW = cache['KW']; cKD = cache['KD']; cKL = cache['KL']; cKHW = cache['KHW']
    cHT = cache['HT']; cAT = cache['AT']; cRT = cache['RT']

    try:
        if logic == 'FW': m = (cFW == fw)
        elif logic == 'FL': m = (cFL == fl)
        elif logic == 'FWL': m = (cFW == fw) & (cFL == fl)
        elif logic == 'FWDL': m = (cFW == fw) & (cFD == fd) & (cFL == fl)
        elif logic == 'FWH': m = (cFW == fw) & (cFHW == fhw)
        elif logic == 'FLH': m = (cFL == fl) & (cFHW == fhw)
        elif logic == 'FW-H': m = (cFW == fw)
        elif logic == 'FW-A': m = (cFL == fw)
        elif logic == 'FL-H': m = (cFW == fl)
        elif logic == 'FL-A': m = (cFL == fl)
        elif logic == 'WLWH': m = (cFW == fw) & (cFL == fl) & (cFHW == fhw)
        elif logic == 'FWHT': m = (cFW == fw) & (cHT == ht)
        elif logic == 'FLAT': m = (cFL == fl) & (cAT == at)
        elif logic == 'FWLHT': m = (cFW == fw) & (cFL == fl) & (cHT == ht)
        elif logic == 'FWLAT': m = (cFW == fw) & (cFL == fl) & (cAT == at)
        elif logic == 'KW': m = (cKW == kw)
        elif logic == 'KL': m = (cKL == kl)
        elif logic == 'TWL': m = (cFW == fw) & (cFL == fl)
        elif logic == 'TWDL': m = (cFW == fw) & (cFD == fd) & (cFL == fl)
        elif logic == 'TWLWH': m = (cFW == fw) & (cFL == fl) & (cFHW == fhw)
        elif logic == 'TWDLWH': m = (cFW == fw) & (cFD == fd) & (cFL == fl) & (cFHW == fhw)
        elif logic == 'TKWL': m = (cKW == kw) & (cKL == kl)
        elif logic == 'TKWDL': m = (cKW == kw) & (cKD == kd) & (cKL == kl)
        # ════════════════════════════════════════════════════════════
        # 💡 [26지표 신규 코드체계] F/K-결과-기준 (기존 로직 재사용, 소스만 교체)
        #   블록: F=해외 / K=국내 / TF=통합해외 / TK=통합국내
        #   결과: W/L/WL/WDL   기준: HW=핸디정배 / HT=홈팀 / AT=원정팀
        # ────────────────── 해외 개별 (1~9) ──────────────────
        elif logic == 'F-W': m = (cFW == fw)
        elif logic == 'F-L': m = (cFL == fl)
        elif logic == 'F-WL': m = (cFW == fw) & (cFL == fl)
        elif logic == 'F-WDL': m = (cFW == fw) & (cFD == fd) & (cFL == fl)
        elif logic == 'F-W-HW': m = (cFW == fw) & (cFHW == fhw)
        elif logic == 'F-W-HT': m = (cFW == fw) & (cHT == ht)
        elif logic == 'F-L-AT': m = (cFL == fl) & (cAT == at)
        elif logic == 'F-WL-HT': m = (cFW == fw) & (cFL == fl) & (cHT == ht)
        elif logic == 'F-WL-AT': m = (cFW == fw) & (cFL == fl) & (cAT == at)
        # ────────────────── 해외 통합 (10~13) ──────────────────
        elif logic == 'TF-W': m = (cFW == fw)
        elif logic == 'TF-L': m = (cFL == fl)
        elif logic == 'TF-WL': m = (cFW == fw) & (cFL == fl)
        elif logic == 'TF-WDL': m = (cFW == fw) & (cFD == fd) & (cFL == fl)
        # ────────────────── 국내 개별 (14~22) ──────────────────
        elif logic == 'K-W': m = (cKW == kw)
        elif logic == 'K-L': m = (cKL == kl)
        elif logic == 'K-WL': m = (cKW == kw) & (cKL == kl)
        elif logic == 'K-WDL': m = (cKW == kw) & (cKD == kd) & (cKL == kl)
        elif logic == 'K-W-HW': m = (cKW == kw) & (cKHW == khw)
        elif logic == 'K-W-HT': m = (cKW == kw) & (cHT == ht)
        elif logic == 'K-L-AT': m = (cKL == kl) & (cAT == at)
        elif logic == 'K-WL-HT': m = (cKW == kw) & (cKL == kl) & (cHT == ht)
        elif logic == 'K-WL-AT': m = (cKW == kw) & (cKL == kl) & (cAT == at)
        # ────────────────── 국내 통합 (23~26) ──────────────────
        elif logic == 'TK-W': m = (cKW == kw)
        elif logic == 'TK-L': m = (cKL == kl)
        elif logic == 'TK-WL': m = (cKW == kw) & (cKL == kl)
        elif logic == 'TK-WDL': m = (cKW == kw) & (cKD == kd) & (cKL == kl)
        else: return [0, 0, 0, 0]

        rt_sel = cRT[m]
        counts = [int(np.sum(rt_sel == v)) for v in (1.0, 2.0, 3.0, 4.0)]

        # 자기 자신 1건 제외 (현재 경기 결과)
        try:
            current_rt = row.get('RT')
            if not pd.isna(current_rt):
                current_rt = float(current_rt)
                if current_rt in (1.0, 2.0, 3.0, 4.0):
                    ix = int(current_rt) - 1
                    if counts[ix] > 0:
                        counts[ix] -= 1
        except: pass

        return counts
    except:
        return [0, 0, 0, 0]


def get_samples(db, logic, row):
    """[호환용] 단일 호출 시 내부에서 전처리 후 fast 경로 사용."""
    cache = _prep_db(db)
    return get_samples_fast(cache, logic, row)

def analyze_row(row, db, total_db, db_cache=None, total_cache=None, dom_cache=None):
    """[v6.2 최적화] 전처리 캐시를 받으면 재사용, 없으면 1회 생성.
    단일 호출 호환 유지 + 배치 호출 시 캐시 재사용으로 대폭 가속."""
    rd = row.to_dict() if hasattr(row, 'to_dict') else dict(row)
    if db_cache is None:
        db_cache = _prep_db(db)
    if total_cache is None:
        total_cache = _prep_db(total_db)
    if dom_cache is None:
        dom_cache = _prep_domestic_cache(total_db)

    logics_basic = ['FW', 'FL', 'FWL', 'FWDL', 'FWH', 'FLH', 'FW-H', 'FW-A', 'FL-H', 'FL-A', 'WLWH', 'FWHT', 'FLAT', 'FWLHT', 'FWLAT', 'KW', 'KL']
    res = {}

    for l in logics_basic:
        c = get_samples_fast(db_cache, l, rd)
        for i in range(4): res[f'{l} {i+1}'] = c[i]

    try:
        kw, kd, kl = float(rd.get('KW', 0)), float(rd.get('KD', 0)), float(rd.get('KL', 0))
        fw, fd, fl = float(rd.get('FW', 0)), float(rd.get('FD', 0)), float(rd.get('FL', 0))
        res['WG'] = round((kw / fw) * 100, 1) if fw > 0 else 0
        res['DG'] = round((kd / fd) * 100, 1) if fd > 0 else 0
        res['LG'] = round((kl / fl) * 100, 1) if fl > 0 else 0
    except:
        res['WG'] = 0; res['DG'] = 0; res['LG'] = 0
        fw = fd = fl = 0

    # ROI Zone 계산 (numpy 캐시 사용) - 원본과 동일하게 HS 존재 조건 사용
    try:
        if fw > 0 and fd > 0 and fl > 0 and total_cache is not None:
            tFW = total_cache['FW']
            tRT = total_cache['RT']
            tHS = total_cache.get('HS')
            margin = fw * 0.03
            z_min, z_max = fw - margin, fw + margin
            if tHS is not None:
                zmask = (tFW >= z_min) & (tFW <= z_max) & (~np.isnan(tHS))
            else:
                zmask = (tFW >= z_min) & (tFW <= z_max) & (~np.isnan(tRT))
            total_cnt = int(np.sum(zmask))
            if total_cnt > 0:
                rt_sel = tRT[zmask]
                p1 = np.sum(rt_sel == 1.0) / total_cnt
                p2 = np.sum(rt_sel == 2.0) / total_cnt
                p3 = np.sum(rt_sel == 3.0) / total_cnt
                p4 = np.sum(rt_sel == 4.0) / total_cnt
                if fw <= fl:
                    prob_home = p1 + p2; prob_away = p4
                else:
                    prob_home = p4; prob_away = p1 + p2
                res['WR'] = round((prob_home * fw - 1) * 100, 1)
                res['DR'] = round((p3 * fd - 1) * 100, 1)
                res['LR'] = round((prob_away * fl - 1) * 100, 1)
            else:
                res['WR'] = 0; res['DR'] = 0; res['LR'] = 0
        else:
            res['WR'] = 0; res['DR'] = 0; res['LR'] = 0
    except:
        res['WR'] = 0; res['DR'] = 0; res['LR'] = 0

    # 💡 [v3.3 New] 통합 패턴 검사 17번 로직 포함
    logics_total = ['TWL', 'TWDL', 'TWLWH', 'TWDLWH', 'TKWL', 'TKWDL']
    for l in logics_total:
        c = get_samples_fast(total_cache, l, rd)
        for i in range(4): res[f'{l} {i+1}'] = c[i]

    # ════════════════════════════════════════════════════════════
    # 💡 [26지표 신규 산출] 표 UI 전용 새 코드체계
    #   개별(F/K)=개별리그 db_cache / 통합(TF/TK)=6대리그 total_cache
    #   기존 지표(위)는 예측 엔진(18/19/20)이 참조하므로 그대로 유지.
    # ════════════════════════════════════════════════════════════
    # 개별리그 대상 (해외 1~9, 국내 14~22)
    logics_new_individual = [
        'F-W', 'F-L', 'F-WL', 'F-WDL', 'F-W-HW',
        'F-W-HT', 'F-L-AT', 'F-WL-HT', 'F-WL-AT',
        'K-W', 'K-L', 'K-WL', 'K-WDL', 'K-W-HW',
        'K-W-HT', 'K-L-AT', 'K-WL-HT', 'K-WL-AT',
    ]
    for l in logics_new_individual:
        c = get_samples_fast(db_cache, l, rd)
        for i in range(4): res[f'{l} {i+1}'] = c[i]

    # 통합DB 대상 (해외통합 10~13, 국내통합 23~26)
    logics_new_total = [
        'TF-W', 'TF-L', 'TF-WL', 'TF-WDL',
        'TK-W', 'TK-L', 'TK-WL', 'TK-WDL',
    ]
    for l in logics_new_total:
        c = get_samples_fast(total_cache, l, rd)
        for i in range(4): res[f'{l} {i+1}'] = c[i]

    # 💡 [v5.2 New] 21번: 국내 도플갱어 비핸승 비율 (캐시 사용)
    nh_share = compute_domestic_nh_share_fast(rd, dom_cache)
    res['K_NH_SHARE'] = nh_share if nh_share is not None else np.nan

    # 💡 [V2.2 New] 플핸(비핸승) 예측 5종 산출
    res.update(compute_plushandi(res))

    return pd.Series(res, dtype='object')


# ════════════════════════════════════════════════════════════
# 💡 [V2.2 New] 플핸(비핸승) 예측
# --------------------------------------------------------------
#  [배경] 기존 18/19/20번 예측은 정배배당(fav) 구간이 사실상 모든 것을
#    결정했고, 26개 지표는 거의 반영되지 않았다. 실측 검증 결과
#    26개 지표로 4개 결과(핸승/핸무/무/역)를 맞히는 것은 30~38%로
#    베이스레이트(31%)와 차이가 없었다.
#    반면 2분류(핸승 vs 비핸승=플핸)로 좁히면 지표에 실제 예측력이 있었다.
#
#  [구성]
#    해)플핸% : 해외 13개 지표(1~13) 표본의 비핸승 비율
#    국)플핸% : 국내 13개 지표(14~26) 표본의 비핸승 비율
#    PICK     : 플핸(역)/플핸(무)/플핸(핸무) / 핸승 / —(관망)
#               괄호 안은 비핸승 표본 중 가장 많이 나온 결과
#    실측     : 아래 보정표 기준, 과거 실제 적중률(%)
#    비중     : 그 최다결과가 비핸승 표본에서 차지하는 비율(%)
#
#  [실측 보정표 근거] EPL 1,135경기 백테스트
#    · 전체 베이스: 플핸 69.0%
#    · 플핸 안에서 '핸무'가 최다일 때 62.2%로 급락 (역 73.3% / 무 73.4%)
#    · 해)플핸 85%+ & 역최다 → 85.7% (최고 구간)
#    · 해)플핸 40~50% 구간은 오히려 핸승이 60.0%
#  ※ 표본 25건 미만 칸은 과적합 방지를 위해 구간 대표값으로 대체
# ════════════════════════════════════════════════════════════
PH_F_CODES = ['F-W', 'F-L', 'F-WL', 'F-WDL', 'F-W-HW',
              'F-W-HT', 'F-L-AT', 'F-WL-HT', 'F-WL-AT',
              'TF-W', 'TF-L', 'TF-WL', 'TF-WDL']
PH_K_CODES = ['K-W', 'K-L', 'K-WL', 'K-WDL', 'K-W-HW',
              'K-W-HT', 'K-L-AT', 'K-WL-HT', 'K-WL-AT',
              'TK-W', 'TK-L', 'TK-WL', 'TK-WDL']

# (해)플핸 구간, 최다결과) → 실측 적중률(%)
PH_TABLE = {
    ('85+', '역'): 85.7, ('85+', '무'): 72.7, ('85+', '핸무'): 73.0,
    ('80', '역'): 73.9, ('80', '무'): 77.4, ('80', '핸무'): 75.0,
    ('75', '역'): 73.4, ('75', '무'): 77.8, ('75', '핸무'): 70.0,
    ('70', '역'): 77.5, ('70', '무'): 72.9, ('70', '핸무'): 64.9,
    ('60', '역'): 66.0, ('60', '무'): 71.7, ('60', '핸무'): 66.0,
}
PH_MIN_SAMPLE = 10          # 블록 표본 최소치
PH_BASE_RATE = 69.0         # 전체 플핸 베이스레이트(%)


def _ph_block(res, codes):
    """블록의 4칸 합계와 표본수 반환. 표본 부족이면 None."""
    tot = [0, 0, 0, 0]
    for c in codes:
        for i in range(4):
            v = res.get(f'{c} {i+1}', 0)
            try:
                tot[i] += 0 if pd.isna(v) else int(float(v))
            except (TypeError, ValueError):
                pass
    n = sum(tot)
    return (tot, n) if n >= PH_MIN_SAMPLE else None


def compute_plushandi(res):
    """플핸 예측 5개 값을 dict로 반환."""
    out = {'PH_F': np.nan, 'PH_K': np.nan, 'PH_PICK': '',
           'PH_HIT': np.nan, 'PH_DOM': np.nan}
    try:
        fb = _ph_block(res, PH_F_CODES)
        if fb is None:
            return out
        tf, nf = fb
        f_sh = (tf[1] + tf[2] + tf[3]) / nf
        out['PH_F'] = round(f_sh * 100, 1)

        kb = _ph_block(res, PH_K_CODES)
        if kb is not None:
            tk, nk = kb
            out['PH_K'] = round(((tk[1] + tk[2] + tk[3]) / nk) * 100, 1)

        # 비핸승 표본 중 최다 결과
        sub = [tf[1], tf[2], tf[3]]          # 핸무, 무, 역
        if sum(sub) == 0:
            return out
        di = sub.index(max(sub))
        dom = {0: '핸무', 1: '무', 2: '역'}[di]
        out['PH_DOM'] = round(max(sub) / sum(sub) * 100, 1)

        # ── PICK 및 실측 결정 ──
        if f_sh >= 0.60:
            band = ('85+' if f_sh >= 0.85 else '80' if f_sh >= 0.80
                    else '75' if f_sh >= 0.75 else '70' if f_sh >= 0.70 else '60')
            out['PH_PICK'] = f'플핸({dom})'
            out['PH_HIT'] = PH_TABLE.get((band, dom), PH_BASE_RATE)
        elif f_sh < 0.50:
            # 플핸 신호가 약하면 반대로 핸승이 유력 (실측 60.0%)
            out['PH_PICK'] = '핸승'
            out['PH_HIT'] = 60.0
        else:
            out['PH_PICK'] = '—'      # 50~60%: 베이스 수준, 관망
            out['PH_HIT'] = np.nan
        return out
    except Exception:
        return out


# 💡 [v6.2 최적화] 배치 분석: DB 전처리를 1회만 하고 전 행에 재사용
def analyze_dataframe(df_tot, total_db):
    """df_tot 전체를 분석. 전처리 캐시를 1회 생성해 모든 행에 재사용.
    반환: analyze_row 결과를 모은 DataFrame (인덱스 정렬 동일)."""
    db_cache = _prep_db(df_tot)
    total_cache = _prep_db(total_db)
    dom_cache = _prep_domestic_cache(total_db)

    rows_out = []
    for _, row in df_tot.iterrows():
        rows_out.append(
            analyze_row(row, df_tot, total_db,
                        db_cache=db_cache, total_cache=total_cache, dom_cache=dom_cache)
        )
    res = pd.DataFrame(rows_out, index=df_tot.index)
    return res


# ════════════════════════════════════════════════════════════
# 💡 재계산 (WEB_BET_PRO.py 1638~1738줄 이식)
#   통합DB 탭의 재계산 버튼 2종이 호출하는 로직. 계산 자체는 위 analyze_row와
#   동일하며, 여기서는 "어떤 행을 다시 계산해 DB에 되쓸지"만 다룬다.
#   원본의 st.cache_data.clear() 호출은 제거했다 — FastAPI 쪽 캐시(data_access.py)는
#   (파일경로, mtime) 키를 쓰므로 아래 PATHS.stamp_updated()가 DB 파일을 건드리는
#   순간 자동으로 무효화된다. 별도 캐시 클리어가 필요 없다.
# ════════════════════════════════════════════════════════════
def _recompute_indicators_for_subset(sub_df, league_full_df, total_df):
    """sub_df(RT 없는 행)만 26개 지표를 재계산해 인덱스가 맞는 DataFrame으로 반환.
    개별리그 지표는 league_full_df, 통합(TF-/TK-) 지표는 total_df 기준."""
    db_cache = _prep_db(league_full_df)
    total_cache = _prep_db(total_df)
    dom_cache = _prep_domestic_cache(total_df)
    rows_out = []
    for _, row in sub_df.iterrows():
        rows_out.append(
            analyze_row(row, league_full_df, total_df,
                        db_cache=db_cache, total_cache=total_cache, dom_cache=dom_cache))
    return pd.DataFrame(rows_out, index=sub_df.index)


def _recompute_by_mask(db_path, include_historical):
    """공통 재계산 로직.
    include_historical=False → RT 없는 예정 경기만 (일상 사용, 빠름)
    include_historical=True  → 전체 경기(과거 포함) 재계산 (초기 세팅/오류 수정용, 느림)
    반환: {리그코드: 갱신건수} 딕셔너리."""
    if not db_path or not os.path.exists(db_path):
        return {}

    conn = sqlite3.connect(db_path)
    try:
        tabs = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

        # 최신 통합DB (이 함수 호출 시점 기준, 6개 리그 전체 합산)
        frames = []
        for lg in PATHS.LEAGUES:
            if lg not in tabs:
                continue
            d = pd.read_sql(f'SELECT * FROM "{lg}"', conn)
            if len(d) > 0:
                d['Source_League'] = lg
                frames.append(d)
        total_df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

        summary = {}
        for lg in PATHS.LEAGUES:
            if lg not in tabs:
                continue
            league_df = pd.read_sql(f'SELECT * FROM "{lg}"', conn)
            if league_df.empty or 'RT' not in league_df.columns:
                continue

            rt_num = pd.to_numeric(league_df['RT'], errors='coerce')
            if include_historical:
                mask = pd.Series(True, index=league_df.index)   # 전체 경기
            else:
                mask = rt_num.isna()                             # RT 없음(예정 경기)만
            n_target = int(mask.sum())
            summary[lg] = n_target
            if n_target == 0:
                continue

            sub = league_df[mask]

            # ① 26개 지표(+플핸 예측 PH_*) 재계산
            #    플핸 예측(PH_F/PH_K/PH_PICK/PH_HIT/PH_DOM)은 analyze_row() 안의
            #    compute_plushandi()에서 지표와 함께 계산되므로, 지표 재계산
            #    한 번으로 플핸 예측도 같이 갱신된다.
            new_ind = _recompute_indicators_for_subset(sub, league_df, total_df)
            for c in new_ind.columns:
                if c not in league_df.columns:
                    league_df[c] = np.nan
                league_df.loc[new_ind.index, c] = new_ind[c].values

            league_df.to_sql(lg, conn, if_exists='replace', index=False)
    finally:
        conn.close()

    PATHS.stamp_updated(db_path)
    return summary


def recompute_pending_matches(db_path):
    """RT 없는 예정 경기만 골라 최신 통합DB 기준으로 26지표+예측을 재계산해 저장.
    RT 있는 과거 경기는 전혀 수정하지 않는다. (일상적으로 자주 쓰는 빠른 버전)
    반환: {리그코드: 갱신건수} 딕셔너리."""
    return _recompute_by_mask(db_path, include_historical=False)


def recompute_all_matches(db_path):
    """RT 유무와 무관하게 전체 경기를 최신 통합DB 기준으로 26지표+예측 재계산.
    반환: {리그코드: 갱신건수} 딕셔너리."""
    return _recompute_by_mask(db_path, include_historical=True)
