# -*- coding: utf-8 -*-
"""
WEB_BET PRO V1.0 - UI 모듈 (스코프 라우팅 / 대시보드 / 마스터 관리 / 열람)
================================================================================
본체(WEB_BET_PRO.py)의 코어 엔진을 건드리지 않기 위해 신규 UI 를 이 모듈로 분리.
본체는 이 모듈의 함수를 호출만 한다.

■ 담당
    - 스코프 선택 바 (📊 공식 데이터 / 👤 내 데이터)
    - 리그별 업로드 현황 대시보드
    - 🛠 마스터 관리 탭 (관리자)
    - 👑 계정관리 탭의 고객 데이터 열람 (C안 + access_log)

■ 담당하지 않음 (본체 유지)
    - _prep_db / get_samples_fast / analyze_dataframe / ProgramPredictor18
    - 스타일 함수, 멀티인덱스, 상대전적 렌더링
"""

import os
import io
import re
import sqlite3
import datetime

import pandas as pd
import streamlit as st

import betpro_paths as PATHS


# =============================================================
# 스코프 라우팅
# =============================================================

def init_scope():
    """세션에 스코프 기본값 주입. 로그인 직후 1회."""
    if 'scope' not in st.session_state:
        st.session_state['scope'] = PATHS.SCOPE_MASTER


def render_scope_bar():
    """
    💡 [업데이트 내용] 데이터 2원화 - 최상단 스코프 선택.
      - 📊 공식 데이터 : master.db (관리자가 배포, 고객은 열람만)
      - 👤 내 데이터   : user.db  (고객 본인 업로드, 본인만 RW)
    두 영역은 DB 파일 자체가 분리되어 완전 격리된다.
    """
    init_scope()
    c1, c2 = st.columns([3, 5])
    with c1:
        sel = st.radio(
            "데이터 영역", [PATHS.SCOPE_MASTER, PATHS.SCOPE_USER],
            format_func=lambda s: PATHS.SCOPE_LABEL[s],
            horizontal=True, key="scope_radio",
            label_visibility="collapsed",
        )
        st.session_state['scope'] = sel
    with c2:
        if sel == PATHS.SCOPE_MASTER:
            ts = PATHS.get_meta(PATHS.get_master_db(), 'updated_at', '-')
            _role = st.session_state.get('auth_role', 'user')
            _tag = "관리자 쓰기 가능" if _role == 'admin' else "열람 전용"
            st.caption(f"공식 데이터 · 최종 갱신 {ts} · {_tag}")
        else:
            st.caption("내 데이터 · 업로드한 경기만 분석됩니다 (공식 데이터와 완전 분리)")
    return sel


def current_scope() -> str:
    return st.session_state.get('scope', PATHS.SCOPE_MASTER)


def current_db() -> str:
    """현재 스코프의 DB 경로. 본체는 이 함수만 호출한다."""
    return PATHS.resolve_db(current_scope(), st.session_state.get('auth_user'))


def can_write_here() -> bool:
    """현재 스코프에 쓰기 가능한가."""
    return PATHS.can_write(current_scope(), st.session_state.get('auth_role', 'user'))


# =============================================================
# 대시보드
# =============================================================

def render_dashboard(db_path: str, scope: str, compact: bool = False):
    """
    💡 [업데이트 내용] 리그별 업로드 현황 대시보드.
      경기수 / 시즌범위 / 결과보유 / 예정(RT 없음=예측대상) / 국내배당 보유
    """
    rows = PATHS.league_dashboard(db_path)
    total = sum(r['경기수'] for r in rows)

    if scope == PATHS.SCOPE_USER and total == 0:
        st.info("아직 업로드한 데이터가 없습니다. 각 리그 탭 하단에서 엑셀을 업로드하세요.")
        return

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("총 경기", f"{total:,}")
    m2.metric("결과 보유", f"{sum(r['결과보유'] for r in rows):,}")
    m3.metric("예정 경기", f"{sum(r['예정'] for r in rows):,}")
    m4.metric("국내배당", f"{sum(r['국내배당'] for r in rows):,}")

    if not compact:
        df = pd.DataFrame(rows)[['리그', '경기수', '시즌', '결과보유', '예정', '국내배당']]
        st.dataframe(df, use_container_width=True, hide_index=True)

    # 💡 [업데이트 내용] 스코프 격리 고지 - 통합지표(13~17번)는 자기 DB 안에서만 산출.
    #    고객이 소량만 올리면 표본 부족으로 픽이 안 나오는 게 정상임을 명시.
    if scope == PATHS.SCOPE_USER:
        if total < 500:
            st.warning(
                f"⚠️ 통합지표(13~17번)는 **내 데이터 {total:,}건 범위에서만** 산출됩니다. "
                "표본이 적어 18/19/20번 예측이 대부분 관망(—)으로 표시될 수 있습니다.")
        else:
            st.caption(
                f"ℹ️ 통합지표(13~17번)는 내 데이터 {total:,}건 범위에서만 산출됩니다. "
                "공식 데이터와 섞이지 않습니다.")


# =============================================================
# 🛠 마스터 관리 탭 (관리자 전용)
# =============================================================

def render_master_admin_tab():
    """
    💡 [업데이트 내용] v1.0 New: 마스터 관리 탭.
    master.db 의 현황/백업/롤백/리그별 초기화를 담당.
    업로드는 각 리그 탭(공식 스코프)에서 기존 파이프라인을 그대로 사용한다.
    """
    st.header("🛠 마스터 데이터 관리")
    st.caption("공식 데이터(master.db)를 갱신합니다. 전 고객에게 즉시 반영됩니다.")

    mdb = PATHS.get_master_db()

    st.subheader("📊 현재 현황")
    render_dashboard(mdb, PATHS.SCOPE_MASTER)
    st.caption(f"파일: {mdb} · {PATHS.db_filesize_mb(mdb)} MB · "
               f"최종 갱신 {PATHS.get_meta(mdb, 'updated_at', '-')}")

    st.markdown("---")
    st.subheader("💾 백업 / 롤백")
    backups = PATHS.list_backups()
    bc1, bc2 = st.columns([3, 1])
    with bc1:
        if backups:
            names = [os.path.basename(b) for b in backups]
            sel = st.selectbox("백업 파일 (최신순, 최근 5개 보관)", names, key="mst_bak_sel")
            sel_path = backups[names.index(sel)]
            st.caption(f"{PATHS.db_filesize_mb(sel_path)} MB")
        else:
            sel_path = None
            st.info("백업이 없습니다. 데이터 갱신 시 자동 생성됩니다.")
    with bc2:
        st.write("")
        if st.button("💾 지금 백업", use_container_width=True, key="mst_bak_now"):
            p = PATHS.backup_master()
            st.success(f"백업 완료: {os.path.basename(p)}" if p else "백업할 데이터 없음")
            st.rerun()
        if sel_path:
            _ok = st.checkbox("롤백 확인", key="mst_rb_ok")
            if st.button("↩️ 롤백", use_container_width=True, key="mst_rb_btn"):
                if not _ok:
                    st.warning("롤백 확인 체크박스를 선택하세요.")
                else:
                    try:
                        PATHS.restore_backup(sel_path)
                        st.success("롤백 완료. 새로고침하세요.")
                        st.rerun()
                    except Exception as e:
                        st.error(f"롤백 실패: {e}")

    st.markdown("---")
    st.subheader("🗑️ 리그별 초기화")
    dc1, dc2, dc3 = st.columns([2, 2, 1])
    with dc1:
        del_lg = st.selectbox("대상 리그", PATHS.LEAGUES,
                              format_func=lambda x: PATHS.LEAGUE_LABEL[x], key="mst_del_lg")
    with dc2:
        del_ok = st.checkbox(f"'{PATHS.LEAGUE_LABEL[del_lg]}' 전체 삭제 (되돌릴 수 없음)",
                             key="mst_del_ok")
    with dc3:
        st.write("")
        if st.button("❌ 삭제", type="primary", use_container_width=True, key="mst_del_btn"):
            if not del_ok:
                st.warning("확인 체크박스를 선택하세요.")
            else:
                PATHS.backup_master()   # 삭제 전 자동 백업
                con = sqlite3.connect(mdb)
                try:
                    con.execute(f'DROP TABLE IF EXISTS "{del_lg}"')
                    con.commit()
                finally:
                    con.close()
                PATHS.stamp_updated(mdb)
                st.success(f"{PATHS.LEAGUE_LABEL[del_lg]} 삭제 완료 (백업 생성됨)")
                st.rerun()

    st.markdown("---")
    st.info("💡 마스터 데이터 업로드는 각 리그 탭에서 상단 **📊 공식 데이터** 를 선택한 뒤 "
            "하단 '📤 새 경기 업로드'로 진행하세요. 관리자에게만 해당 UI가 보입니다.")


# =============================================================
# 고객 데이터 열람 (C안 + access_log)
# =============================================================

def render_user_data_viewer():
    """
    💡 [업데이트 내용] v1.0 New: 관리자의 고객 데이터 열람 (C안).
      - 관리자는 **열람만** 가능. 수정/삭제 불가 (읽기전용 connect).
      - 열람 시 access_log 에 기록 -> 분쟁 시 근거.
      - 상단 메타데이터는 로그 없이 조회, 원본 열람만 기록.
    """
    st.subheader("🗂️ 고객 업로드 현황")
    rows = PATHS.user_storage_summary()
    if not rows:
        st.info("업로드 데이터가 있는 고객 계정이 없습니다.")
        return

    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    st.markdown("---")
    st.subheader("🔍 원본 열람")
    st.caption("⚠️ 고객이 업로드한 원본 데이터를 조회합니다. 열람 기록이 남습니다. "
               "관리자는 열람만 가능하며 수정·삭제할 수 없습니다.")

    users = [r['아이디'] for r in rows]
    v1, v2, v3 = st.columns([2, 2, 1])
    with v1:
        tgt = st.selectbox("대상 계정", users, key="viewer_user")
    udb = PATHS.get_user_db(tgt)
    avail = [d['코드'] for d in PATHS.league_dashboard(udb) if d['경기수'] > 0]
    with v2:
        if not avail:
            st.info("데이터 없음")
            tgt_lg = None
        else:
            tgt_lg = st.selectbox("리그", avail,
                                  format_func=lambda x: PATHS.LEAGUE_LABEL[x],
                                  key="viewer_lg")
    with v3:
        st.write("")
        go = st.button("🔍 열람", type="primary", use_container_width=True, key="viewer_btn")

    if go and tgt_lg:
        try:
            # 읽기전용 open - 관리자도 고객 데이터를 물리적으로 수정할 수 없다
            con = sqlite3.connect(f"file:{udb}?mode=ro", uri=True)
            try:
                df = pd.read_sql(f'SELECT * FROM "{tgt_lg}"', con)
            finally:
                con.close()
        except Exception as e:
            st.error(f"열람 실패: {e}")
            df = None

        if df is not None:
            PATHS.log_access(st.session_state.get('auth_user', '?'), tgt,
                             tgt_lg, "view", len(df))
            st.success(f"'{tgt}' / {PATHS.LEAGUE_LABEL[tgt_lg]} - {len(df):,}건 (읽기 전용)")

            base = ['L', 'S', 'R', 'No', 'DT', 'TM', 'HT', 'HS', 'RT', 'AS', 'AT',
                    'KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL',
                    'FW', 'FD', 'FL', 'FH', 'FHW', 'FHD', 'FHL']
            show = [c for c in base if c in df.columns]
            df_show = df[show] if show else df
            st.dataframe(df_show, use_container_width=True, height=500)

            out = io.BytesIO()
            with pd.ExcelWriter(out, engine='xlsxwriter') as w:
                df_show.to_excel(w, index=False)
            st.download_button(f"📥 {tgt}_{tgt_lg}.xlsx", out.getvalue(),
                               f"{tgt}_{tgt_lg}.xlsx", key="viewer_dn")

    st.markdown("---")
    st.subheader("📜 열람 기록")
    logs = PATHS.list_access_log(100)
    if logs:
        st.dataframe(pd.DataFrame(logs), use_container_width=True, hide_index=True)
    else:
        st.caption("기록 없음")


# =============================================================
# 💡 [업데이트 내용] V1.0 New: 상세 경기 정보 (시안 반영)
# -------------------------------------------------------------
#  · 테이블에서 행을 클릭하면 해당 경기의 상세 정보를 표시
#  · 좌측: 국내/해외 배당 + 핸디 + 표본 카운트 + 프로그램 예측
#  · 우측: 두 팀의 과거 상대전적 (홈팀 기준)
#  ※ 코어 엔진 무수정. 이미 산출된 컬럼을 읽어서 보여주기만 한다.
# =============================================================

RT_NAME_MAP = {1: '핸승', 2: '핸무', 3: '무', 4: '역'}
RT_COLOR = {'핸승': '#1565C0', '핸무': '#64B5F6', '무': '#757575', '역': '#C62828'}


def _rt_label(v):
    """RT 코드 -> 한글. 결과 없으면 공란."""
    try:
        if pd.isna(v):
            return ''
        return RT_NAME_MAP.get(int(float(v)), '')
    except (TypeError, ValueError):
        s = str(v).strip()
        return s if s in RT_COLOR else ''


def _num(v, nd=2):
    """숫자 표기. 결측은 '-'."""
    try:
        if pd.isna(v):
            return '-'
        return f'{float(v):.{nd}f}'
    except (TypeError, ValueError):
        return '-'


def _rt_badge(txt):
    """결과를 색상 배지 HTML 로."""
    if not txt:
        return ''
    c = RT_COLOR.get(txt, '#9E9E9E')
    fg = '#0D1B2A' if txt == '핸무' else 'white'
    return (f'<span style="background:{c};color:{fg};padding:2px 10px;'
            f'border-radius:4px;font-weight:bold;font-size:12px;">{txt}</span>')


def _odds_table(row):
    """💡 좌측: 해당 경기의 배당 카드 (국내/해외 나란히)."""
    def g(k):
        return row.get(k)

    html = ['<table style="width:100%;border-collapse:collapse;font-size:13px;">']
    html.append(
        '<tr style="background:#1E2A38;color:#E0E0E0;">'
        '<th style="padding:6px;border:1px solid #37474F;">구분</th>'
        '<th style="padding:6px;border:1px solid #37474F;">승(홈)</th>'
        '<th style="padding:6px;border:1px solid #37474F;">무</th>'
        '<th style="padding:6px;border:1px solid #37474F;">패(원정)</th></tr>')

    for tag, w, d, l in [
            ('국내 배당', 'KW', 'KD', 'KL'),
            ('국내 핸디', 'KHW', 'KHD', 'KHL'),
            ('해외 배당', 'FW', 'FD', 'FL'),
            ('해외 핸디', 'FHW', 'FHD', 'FHL')]:
        html.append(
            f'<tr><td style="padding:6px;border:1px solid #37474F;font-weight:bold;">{tag}</td>'
            f'<td style="padding:6px;border:1px solid #37474F;text-align:center;">{_num(g(w))}</td>'
            f'<td style="padding:6px;border:1px solid #37474F;text-align:center;">{_num(g(d))}</td>'
            f'<td style="padding:6px;border:1px solid #37474F;text-align:center;">{_num(g(l))}</td></tr>')
    html.append('</table>')
    return ''.join(html)


def _prediction_card(row):
    """💡 18/19/20번 예측 요약."""
    p18 = str(row.get('프로그램 예측', '') or '—')
    g18 = str(row.get('프로그램 예측 등급', '') or '—')
    p19 = str(row.get('플핸등급', '') or '-')
    p20 = str(row.get('조합등급', '') or '-')

    probs = []
    for i, nm in enumerate(['핸승', '핸무', '무', '역'], start=1):
        v = row.get(f'프로그램 예측 {i}')
        probs.append(f'{nm} {_num(v, 1)}%')

    html = ['<table style="width:100%;border-collapse:collapse;font-size:13px;">']
    html.append(
        '<tr style="background:#1E2A38;color:#E0E0E0;">'
        '<th style="padding:6px;border:1px solid #37474F;">18. 프로그램 예측</th>'
        '<th style="padding:6px;border:1px solid #37474F;">19. 플핸</th>'
        '<th style="padding:6px;border:1px solid #37474F;">20. 조합</th></tr>')
    html.append(
        f'<tr><td style="padding:8px;border:1px solid #37474F;text-align:center;">'
        f'{_rt_badge(p18) if p18 in RT_COLOR else p18} &nbsp; <b>{g18}</b></td>'
        f'<td style="padding:8px;border:1px solid #37474F;text-align:center;"><b>{p19}</b></td>'
        f'<td style="padding:8px;border:1px solid #37474F;text-align:center;"><b>{p20}</b></td></tr>')
    html.append(
        f'<tr><td colspan="3" style="padding:6px;border:1px solid #37474F;'
        f'text-align:center;color:#90A4AE;">{" / ".join(probs)}</td></tr>')
    html.append('</table>')
    return ''.join(html)


def _sample_table(row):
    """💡 주요 지표의 표본 카운트 (핸승/핸무/무/역)."""
    inds = _SAMPLE_INDICATORS
    html = ['<table style="width:100%;border-collapse:collapse;font-size:12px;">']
    html.append(
        '<tr style="background:#1E2A38;color:#E0E0E0;">'
        '<th style="padding:5px;border:1px solid #37474F;">지표</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#1565C0;color:white;">핸승</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#64B5F6;color:#0D1B2A;">핸무</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#757575;color:white;">무</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#C62828;color:white;">역</th>'
        '<th style="padding:5px;border:1px solid #37474F;">토탈</th></tr>')
    for code, label in inds:
        vals = []
        for i in range(1, 5):
            v = row.get(f'{code} {i}')
            try:
                vals.append(0 if pd.isna(v) else int(float(v)))
            except (TypeError, ValueError):
                vals.append(0)
        tot = sum(vals)
        if tot == 0:
            continue
        cells = ''.join(
            f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">{v}</td>'
            for v in vals)
        html.append(
            f'<tr><td style="padding:5px;border:1px solid #37474F;">{label}</td>{cells}'
            f'<td style="padding:5px;border:1px solid #37474F;text-align:center;'
            f'font-weight:bold;">{tot}</td></tr>')
    html.append('</table>')
    return ''.join(html)


def _head_to_head(total_db, ht, at, limit=15):
    """
    💡 우측: 두 팀의 과거 상대전적.
    ★ 시안 명시: "상대전적의 결과는 홈팀 기준입니다"
      -> 현재 경기의 홈팀(ht)이 과거에 홈이었는지 원정이었는지 함께 표기.
    """
    if total_db is None or total_db.empty:
        return '<p style="color:#90A4AE;">데이터 없음</p>', None, None
    if 'HT' not in total_db.columns or 'AT' not in total_db.columns:
        return '<p style="color:#90A4AE;">데이터 없음</p>', None, None

    h = total_db['HT'].astype(str).str.strip()
    a = total_db['AT'].astype(str).str.strip()
    ht_s, at_s = str(ht).strip(), str(at).strip()
    m = total_db[((h == ht_s) & (a == at_s)) | ((h == at_s) & (a == ht_s))].copy()
    if m.empty:
        return f'<p style="color:#90A4AE;">{ht_s} vs {at_s} 맞대결 기록 없음</p>', None, None

    # ════════════════════════════════════════════════════════════
    # 💡 [수정] 정렬을 "시즌만 최신순" → "시즌+라운드 모두 최신순"으로 변경
    # --------------------------------------------------------------
    #  [문제] 기존엔 시즌만 내림차순 정렬해서, 같은 시즌 안에서는 원래 DB
    #    순서 그대로 나와 9R이 38R보다 앞에 나오는 등 뒤죽박죽이었음.
    #    (38R이 9R보다 나중 라운드=더 최근 경기인데도 위에 안 보임)
    #  [해결] 라운드 문자열("9R","38R")에서 숫자만 뽑아 시즌·라운드 모두
    #    내림차순으로 정렬 → 항상 가장 최근 경기가 맨 위.
    # ════════════════════════════════════════════════════════════
    if 'R' in m.columns:
        def _round_num(v):
            mm = re.search(r'\d+', str(v))
            return int(mm.group()) if mm else 0
        m['_r_num'] = m['R'].map(_round_num)
    else:
        m['_r_num'] = 0
    _sort_cols = [c for c in ['S', '_r_num'] if c in m.columns or c == '_r_num']
    m = m.sort_values(_sort_cols, ascending=False)
    m = m.drop(columns=['_r_num'])

    # 결과 집계 (홈팀 기준 = 현재 경기의 ht 관점)
    cnt = {'핸승': 0, '핸무': 0, '무': 0, '역': 0}
    for _, r in m.iterrows():
        lab = _rt_label(r.get('RT'))
        if lab in cnt:
            cnt[lab] += 1
    tot = sum(cnt.values())

    html = ['<table style="width:100%;border-collapse:collapse;font-size:12px;">']
    html.append(
        '<tr>'
        '<th style="padding:5px;border:1px solid #37474F;background:#1565C0;color:white;">핸승</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#64B5F6;color:#0D1B2A;">핸무</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#757575;color:white;">무</th>'
        '<th style="padding:5px;border:1px solid #37474F;background:#C62828;color:white;">역</th>'
        '<th style="padding:5px;border:1px solid #37474F;">토탈</th></tr>')
    html.append(
        f'<tr><td style="padding:5px;border:1px solid #37474F;text-align:center;">{cnt["핸승"]}</td>'
        f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">{cnt["핸무"]}</td>'
        f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">{cnt["무"]}</td>'
        f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">{cnt["역"]}</td>'
        f'<td style="padding:5px;border:1px solid #37474F;text-align:center;'
        f'font-weight:bold;">{tot}</td></tr></table><br>')

    # 경기 목록
    html.append('<table style="width:100%;border-collapse:collapse;font-size:12px;">')
    html.append(
        '<tr style="background:#1E2A38;color:#E0E0E0;">'
        '<th style="padding:5px;border:1px solid #37474F;">시즌</th>'
        '<th style="padding:5px;border:1px solid #37474F;">R</th>'
        '<th style="padding:5px;border:1px solid #37474F;">HT</th>'
        '<th style="padding:5px;border:1px solid #37474F;">HS</th>'
        '<th style="padding:5px;border:1px solid #37474F;">AS</th>'
        '<th style="padding:5px;border:1px solid #37474F;">AT</th>'
        '<th style="padding:5px;border:1px solid #37474F;">결과</th></tr>')
    for _, r in m.head(limit).iterrows():
        def _i(k):
            v = r.get(k)
            try:
                return '' if pd.isna(v) else str(int(float(v)))
            except (TypeError, ValueError):
                return str(v) if v else ''
        html.append(
            f'<tr><td style="padding:5px;border:1px solid #37474F;">{r.get("S","")}</td>'
            f'<td style="padding:5px;border:1px solid #37474F;">{r.get("R","")}</td>'
            f'<td style="padding:5px;border:1px solid #37474F;">{r.get("HT","")}</td>'
            f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">{_i("HS")}</td>'
            f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">{_i("AS")}</td>'
            f'<td style="padding:5px;border:1px solid #37474F;">{r.get("AT","")}</td>'
            f'<td style="padding:5px;border:1px solid #37474F;text-align:center;">'
            f'{_rt_badge(_rt_label(r.get("RT")))}</td></tr>')
    html.append('</table>')
    if len(m) > limit:
        html.append(f'<p style="color:#90A4AE;font-size:11px;">'
                    f'최근 {limit}경기만 표시 (총 {len(m)}경기)</p>')
    return ''.join(html), m, {'핸승': cnt['핸승'], '핸무': cnt['핸무'], '무': cnt['무'], '역': cnt['역'], '토탈': tot}


def _write_h2h_table(wb, ws, h2h_out_df, start_row, start_col):
    """💡 [신규] 상대전적 표를 엑셀에 직접 써주는 공통 헬퍼.
    - 헤더: 진남색 배경 + 흰 글씨 (화면/다른 표와 동일한 스타일)
    - HS/AS: 이긴 팀(점수가 더 높은 쪽) 점수만 빨간 글씨로 표시
      (동점이면 둘 다 그대로 / 결측이면 그대로)
    단독 '상대전적 엑셀' 버튼과 '전체 엑셀'의 상대전적 부분에서 공용으로 쓴다."""
    hdr_fmt = wb.add_format({'bold': True, 'bg_color': '#1E2A38',
                              'font_color': 'white', 'border': 1})
    cell_fmt = wb.add_format({'border': 1})
    red_fmt = wb.add_format({'border': 1, 'font_color': '#C62828', 'bold': True})

    cols = list(h2h_out_df.columns)
    for ci, cname in enumerate(cols):
        ws.write(start_row, start_col + ci, cname, hdr_fmt)
        ws.set_column(start_col + ci, start_col + ci, 10)

    hs_idx = cols.index('HS') if 'HS' in cols else None
    as_idx = cols.index('AS') if 'AS' in cols else None

    for ri, (_, r) in enumerate(h2h_out_df.iterrows()):
        _row = start_row + 1 + ri
        # 승자 판정 (HS/AS 둘 다 있을 때만)
        hs_win = as_win = False
        if hs_idx is not None and as_idx is not None:
            try:
                _hs, _as = float(r.iloc[hs_idx]), float(r.iloc[as_idx])
                if not (pd.isna(_hs) or pd.isna(_as)):
                    hs_win = _hs > _as
                    as_win = _as > _hs
            except (TypeError, ValueError):
                pass
        for ci, cname in enumerate(cols):
            v = r.iloc[ci]
            if isinstance(v, float) and pd.isna(v):
                v = ''
            _fmt = cell_fmt
            if ci == hs_idx and hs_win:
                _fmt = red_fmt
            elif ci == as_idx and as_win:
                _fmt = red_fmt
            ws.write(_row, start_col + ci, v, _fmt)


def _build_full_detail_excel(row, h2h_df, h2h_summary, ht, at, s, r_):
    """💡 [신규] 상세 경기 정보 전체(기본정보+배당+예측+지표별표본+상대전적)를
    화면과 동일하게 '한 시트' 안에 좌(기본정보~지표) / 우(상대전적)로 배치."""
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        wb = writer.book
        hdr_fmt = wb.add_format({'bold': True, 'bg_color': '#1E2A38',
                                  'font_color': 'white', 'border': 1})
        cell_fmt = wb.add_format({'border': 1})
        title_fmt = wb.add_format({'bold': True, 'font_size': 13})

        ws = wb.add_worksheet('상세정보')
        writer.sheets['상세정보'] = ws
        ws.set_column(0, 0, 14)
        ws.set_column(1, 5, 12)

        # 💡 오른쪽(상대전적) 블록이 시작되는 열. 왼쪽 블록 최대 폭(지표
        #   표: 지표/핸승/핸무/무/역/토탈 = 6열)보다 한 칸 띄워서 배치.
        RCOL = 7

        # ════════════════════════════════════════════════════════════
        # 좌측: 경기정보 + 배당 + 예측 + 지표별 표본
        # ════════════════════════════════════════════════════════════
        ri = 0
        ws.write(ri, 0, f'{ht} vs {at}', title_fmt); ri += 2

        rt_txt = _rt_label(row.get('RT')) or '예정 경기'
        basic_rows = [
            ('시즌', row.get('S', '')), ('라운드', row.get('R', '')),
            ('일자', row.get('DT', '') or ''), ('홈팀', ht), ('원정팀', at),
            ('홈득점', row.get('HS', '')), ('원정득점', row.get('AS', '')),
            ('결과', rt_txt),
        ]
        for label, val in basic_rows:
            ws.write(ri, 0, label, hdr_fmt)
            ws.write(ri, 1, '' if (val is None or (isinstance(val, float) and pd.isna(val))) else val, cell_fmt)
            ri += 1
        ri += 1

        # ── 배당표 (💡 핸디 컬럼 삭제) ──
        ws.write(ri, 0, '💰 배당', title_fmt); ri += 1
        ws.write_row(ri, 0, ['구분', '승(홈)', '무', '패(원정)'], hdr_fmt); ri += 1
        for tag, w, d, l in [
                ('국내 배당', 'KW', 'KD', 'KL'),
                ('국내 핸디', 'KHW', 'KHD', 'KHL'),
                ('해외 배당', 'FW', 'FD', 'FL'),
                ('해외 핸디', 'FHW', 'FHD', 'FHL')]:
            ws.write_row(ri, 0, [
                tag,
                _to_num_or_blank(row.get(w)), _to_num_or_blank(row.get(d)),
                _to_num_or_blank(row.get(l))], cell_fmt)
            ri += 1
        ri += 1

        # ── 예측 ──
        ws.write(ri, 0, '🎯 예측 (18/19/20번)', title_fmt); ri += 1
        ws.write_row(ri, 0, ['프로그램 예측', '등급', '플핸등급', '조합등급'], hdr_fmt); ri += 1
        ws.write_row(ri, 0, [
            str(row.get('프로그램 예측', '') or '—'),
            str(row.get('프로그램 예측 등급', '') or '—'),
            str(row.get('플핸등급', '') or '-'),
            str(row.get('조합등급', '') or '-')], cell_fmt)
        ri += 2
        ws.write_row(ri, 0, ['핸승%', '핸무%', '무%', '역%'], hdr_fmt); ri += 1
        ws.write_row(ri, 0, [
            _to_num_or_blank(row.get('프로그램 예측 1')),
            _to_num_or_blank(row.get('프로그램 예측 2')),
            _to_num_or_blank(row.get('프로그램 예측 3')),
            _to_num_or_blank(row.get('프로그램 예측 4'))], cell_fmt)
        ri += 2

        # ── 지표별 표본 ──
        ws.write(ri, 0, '📊 지표별 표본', title_fmt); ri += 1
        ws.write_row(ri, 0, ['지표', '핸승', '핸무', '무', '역', '토탈'], hdr_fmt); ri += 1
        for code, label in _SAMPLE_INDICATORS:
            vals = []
            for i in range(1, 5):
                v = row.get(f'{code} {i}')
                try:
                    vals.append(0 if pd.isna(v) else int(float(v)))
                except (TypeError, ValueError):
                    vals.append(0)
            tot = sum(vals)
            if tot == 0:
                continue
            ws.write_row(ri, 0, [label] + vals + [tot], cell_fmt)
            ri += 1

        # ════════════════════════════════════════════════════════════
        # 우측: 상대전적 (RCOL열부터, 맨 위 1행에 맞춰 시작)
        #   💡 [수정] 화면처럼 핸승/핸무/무/역/토탈 요약행을 맨 위에 추가.
        #     FH(핸디) 컬럼은 배당표와 마찬가지로 제거.
        # ════════════════════════════════════════════════════════════
        ws.write(0, RCOL, f'{ht} vs {at} 상대전적 (결과는 각 경기 홈팀 기준)', title_fmt)
        if h2h_summary is not None:
            ws.write_row(1, RCOL, ['핸승', '핸무', '무', '역', '토탈'], hdr_fmt)
            ws.write_row(2, RCOL, [
                h2h_summary.get('핸승', 0), h2h_summary.get('핸무', 0),
                h2h_summary.get('무', 0), h2h_summary.get('역', 0),
                h2h_summary.get('토탈', 0)], cell_fmt)
        _h2h_start = 4
        if h2h_df is not None and len(h2h_df) > 0:
            _cols = [c for c in ['S', 'R', 'DT', 'HT', 'HS', 'AS', 'AT', 'RT',
                                  'FW', 'FD', 'FL']
                     if c in h2h_df.columns]
            _out_df = h2h_df[_cols].copy()
            if 'RT' in _out_df.columns:
                _out_df['RT'] = _out_df['RT'].map(_rt_label)
            _write_h2h_table(wb, ws, _out_df, _h2h_start, RCOL)
        else:
            ws.write(_h2h_start, RCOL, '맞대결 기록 없음')

    return output.getvalue()


def _to_num_or_blank(v):
    """엑셀 셀에 넣기 위한 숫자/공란 변환."""
    try:
        if v is None or pd.isna(v):
            return ''
        return float(v)
    except (TypeError, ValueError):
        return ''


# 💡 [신규] 지표별표본 엑셀 시트에서도 재사용할 수 있도록 지표 목록을 분리
_SAMPLE_INDICATORS = [
    ('FW', '해) 승'), ('FL', '해) 패'),
    ('FWL', '해) 승+패'), ('FWDL', '해) 승+무+패'),
    ('FWH', '해) 승+H승'), ('FLH', '해) 패+H승'),
    ('KW', '국) 승'), ('KL', '국) 패'),
    ('TWL', '통) 승+패'), ('TWDL', '통) 승+무+패'),
    ('TWLWH', '통) 승+패+H승'),
    ('TKWL', '통) 국내 승+패'), ('TKWDL', '통) 국내 승+무+패'),
]


def render_match_detail(row, total_db):
    """
    💡 [V1.0 New] 상세 경기 정보 본문.
    row: 선택된 경기 1건 (Series) / total_db: 상대전적 검색용 통합DB
    """
    ht = str(row.get('HT', '')).strip()
    at = str(row.get('AT', '')).strip()
    s = str(row.get('S', ''))
    r_ = str(row.get('R', ''))
    dt = str(row.get('DT', '') or '')
    rt = _rt_label(row.get('RT'))

    st.markdown(f"### {ht} vs {at}")
    _meta = f"{s} · {r_}"
    if dt:
        _meta += f" · {dt}"
    if rt:
        st.markdown(f"{_meta} &nbsp;&nbsp; 결과 {_rt_badge(rt)}", unsafe_allow_html=True)
    else:
        st.markdown(f"{_meta} &nbsp;&nbsp; <span style='color:#90A4AE;'>예정 경기</span>",
                    unsafe_allow_html=True)

    # 스코어
    try:
        hs = row.get('HS'); a_s = row.get('AS')
        if pd.notna(hs) and pd.notna(a_s):
            st.markdown(
                f"<h2 style='text-align:center;margin:6px 0;'>"
                f"{ht} &nbsp; {int(float(hs))} : {int(float(a_s))} &nbsp; {at}</h2>",
                unsafe_allow_html=True)
    except (TypeError, ValueError):
        pass

    c1, c2 = st.columns(2)
    with c1:
        st.markdown("##### 💰 배당")
        st.markdown(_odds_table(row), unsafe_allow_html=True)
        st.markdown("##### 🎯 예측")
        st.markdown(_prediction_card(row), unsafe_allow_html=True)
        st.markdown("##### 📊 지표별 표본")
        st.markdown(_sample_table(row), unsafe_allow_html=True)
    with c2:
        st.markdown("##### 🆚 상대전적")
        st.caption("결과는 각 경기의 홈팀 기준입니다.")
        h2h_html, h2h_df, h2h_summary = _head_to_head(total_db, ht, at)
        st.markdown(h2h_html, unsafe_allow_html=True)

        # 💡 [수정] 배당 핸디 컬럼과 마찬가지로 상대전적 엑셀에서도 FH 제거
        #   + 헤더에 색상/테두리 스타일 적용, RT는 한글로 표기 (통합 엑셀과 동일하게)
        _bcol1, _bcol2 = st.columns(2)
        with _bcol1:
            if h2h_df is not None and len(h2h_df) > 0:
                _cols = [c for c in ['S', 'R', 'DT', 'HT', 'HS', 'AS', 'AT', 'RT',
                                     'FW', 'FD', 'FL']
                         if c in h2h_df.columns]
                _h2h_out = h2h_df[_cols].copy()
                if 'RT' in _h2h_out.columns:
                    _h2h_out['RT'] = _h2h_out['RT'].map(_rt_label)

                _out = io.BytesIO()
                with pd.ExcelWriter(_out, engine='xlsxwriter') as w:
                    ws_h2h = w.book.add_worksheet('상대전적')
                    w.sheets['상대전적'] = ws_h2h
                    _write_h2h_table(w.book, ws_h2h, _h2h_out, 0, 0)

                st.download_button(
                    "📥 상대전적 엑셀", _out.getvalue(),
                    f"상대전적_{ht}_vs_{at}.xlsx",
                    key=f"h2h_dl_{ht}_{at}_{s}_{r_}",
                    use_container_width=True)
        with _bcol2:
            # 💡 [수정] 전체 엑셀 다운로드 버튼을 상대전적 엑셀 버튼 옆으로 이동
            try:
                _full_excel = _build_full_detail_excel(row, h2h_df, h2h_summary, ht, at, s, r_)
                st.download_button(
                    "📥 상세 경기 정보 전체 엑셀", _full_excel,
                    f"상세정보_{ht}_vs_{at}_{s}_{r_}.xlsx",
                    key=f"full_detail_dl_{ht}_{at}_{s}_{r_}",
                    use_container_width=True)
            except Exception as _e:
                st.caption(f"(엑셀 생성 실패: {_e})")

    # ════════════════════════════════════════════════════════════
    # 💡 [신규] 상세 경기 정보 전체(기본정보+배당+예측+지표별표본+상대전적)를
    #   시트 3개로 묶은 엑셀 파일로 다운로드. 위 "상대전적 엑셀"은 상대전적
    #   만 담는 기존 버튼이라 그대로 유지하고, 이건 화면 전체를 담는 버튼.
    # ════════════════════════════════════════════════════════════
    st.markdown("---")
    try:
        _full_excel = _build_full_detail_excel(row, h2h_df, ht, at, s, r_)
        st.download_button(
            "📥 상세 경기 정보 전체 엑셀 다운로드", _full_excel,
            f"상세정보_{ht}_vs_{at}_{s}_{r_}.xlsx",
            key=f"full_detail_dl_{ht}_{at}_{s}_{r_}",
            use_container_width=True)
    except Exception as _e:
        st.caption(f"(엑셀 생성 실패: {_e})")
