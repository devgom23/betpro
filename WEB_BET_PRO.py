# ==============================================================================
# WEB_BET PRO V2.3
# ==============================================================================
# 📌 버전 관리 원칙 (2026-07 부터)
#    · 소폭 수정/버그픽스 → V2.1, V2.2 ... 처럼 소수점 단위로 증가
#    · 대규모 구조 변경(엔진 교체, DB 구조 변경 등) → V3.0, V4.0 처럼 정수 단위로 증가
# ------------------------------------------------------------------------------
#
# [V2.3] 변경 이력 (V2.2 → V2.3)
# ------------------------------------------------------------------------------
#  1. 옛 18/19/20번 예측 엔진(ProgramPredictor18) 소스에서 완전 삭제
#     · V2.2에서 만든 "플핸 예측"(PH_F/PH_K/PH_PICK/PH_HIT/PH_DOM)으로
#       완전히 대체됨에 따라, 화면 표시뿐 아니라 계산 로직 자체를 제거
#     · 삭제된 것: ProgramPredictor18 클래스(RULEBOOK_T1/T2, 베이지안,
#       fav 구간별 픽/등급 재설계, 미시경보 등 전체) / apply_program_prediction_18()
#       / 관련 스타일 함수 5종(style_program_pick 등) / 화면 표의
#       Pick·등급·플핸·조합 컬럼(GRP_PICK, GRP_PROB)
#
#  2. 예측저장/자동채점(검증로그) 기능 전체 삭제
#     · 삭제된 것: [📌 예측저장] 버튼, "🔍 검증로그: 박제/채점/대기" 표시,
#       save_prediction_snapshot() / auto_grade_predictions() /
#       get_validation_status() / _ensure_prediction_log() / PREDLOG() /
#       prediction_log 테이블 관련 로직 전체
#     · 이 기능은 옛 예측(18/19/20번)의 실전 적중 여부를 채점하기 위한
#       것이었는데, 그 예측 자체가 삭제되어 함께 정리
#
#  3. 재계산 함수(_recompute_by_mask) 단순화
#     · 예정 경기 재계산 시 옛 예측(ProgramPredictor18.predict) 재계산
#       단계를 제거. 플핸 예측(PH_*)은 analyze_row()의 compute_plushandi()
#       에서 26개 지표와 함께 이미 계산되므로 별도 재계산 불필요
#
#  4. 이제 안 쓰는 부수 코드 정리
#     · get_stored_prediction() / _PRED_COLS (옛 예측 재계산 방지용,
#       예측 자체가 없어져 무의미해짐)
#
#  5. 검증: 실제 업로드→저장→표 렌더 전체 흐름에서 옛 예측 컬럼 완전
#     소멸 확인, 신규 플핸 예측(PH_*) 5종 정상 산출 확인, 실서버 무오류 확인
# ------------------------------------------------------------------------------
#
# [V2.2] 변경 이력 (V2.1 → V2.2)
# ------------------------------------------------------------------------------
#  1. 신규: 26개 지표 기반 "플핸 예측" 컬럼 5종
#     (표 배치: 해외배당 바로 뒤, 지표 1번 앞)
#     · 해)플핸 : 해외 13개 지표(1~13) 표본의 비핸승 비율(%)
#     · 국)플핸 : 국내 13개 지표(14~26) 표본의 비핸승 비율(%)
#     · PICK    : 플핸(역) / 플핸(무) / 플핸(핸무) / 핸승 / —(관망)
#                 괄호 안 = 비핸승 표본에서 가장 많이 나온 결과
#     · 실측    : 등급(S/A/B) 대신 "과거 실제 적중률(%)"을 직접 표시
#     · 비중    : 최다결과가 비핸승 표본에서 차지하는 비율(%)
#
#  2. [배경] 기존 18/19/20번 예측 엔진의 한계를 실측으로 확인
#     · 기존 엔진은 정배배당(fav) 구간이 픽/등급을 사실상 전부 결정하고
#       26개 지표는 거의 반영되지 않는 구조였음 (fav 1.50 이하 구간에서는
#       지표값과 무관하게 항상 동일한 픽이 나옴)
#     · 26개 지표로 4개 결과(핸승/핸무/무/역)를 맞히는 것은 어떤 조합
#       방식으로도 30~38%에 그쳐 베이스레이트(31%)와 차이가 없었음
#       (블록별 / 전체합산 / 합의투표 / 만장일치 / 배당대비 초과분 전부 검증)
#     · 원인: 26개 지표가 모두 "배당이 같은 과거 경기 찾기" 방식이라
#       배당 정보의 재포장에 가까움 (지표 핸승비율 ↔ fav 상관 -0.881)
#     · 반면 2분류(핸승 vs 비핸승)로 좁히면 지표에 실제 예측력이 존재
#
#  3. [실측 보정표] EPL 1,135경기 백테스트 기준
#     · 전체 베이스: 플핸 69.0%
#     · 비핸승 표본 중 '핸무'가 최다일 때 62.2%로 급락
#       (역 73.3% / 무 73.4%) → PICK에 괄호로 표기하고 색상 경고
#     · 해)플핸 85%+ & 역최다 → 85.7% (최고 구간)
#     · 해)플핸 40~50% 구간은 반대로 핸승이 60.0% → PICK을 '핸승'으로
#     · 50~60% 구간은 베이스 수준이라 정보가 없어 관망(—) 처리
#     · 검증(760경기): 화면 표시치 대비 실제 오차 최대 1.4%p
#
#  4. 기존 18/19/20번 예측 컬럼은 그대로 유지 (비교/검증 목적)
# ------------------------------------------------------------------------------
#
# [V2.1] 변경 이력 (V2.0 → V2.1)
# ------------------------------------------------------------------------------
#  1. 26개 지표 설명 주석 정리
#     · 상단 변수 정의서의 예전 병합형 표(예: "승+패/승+무+패 | FWL/FWDL"
#       한 줄에 두 지표)를 26개 항목 각각 개별 줄로 분리
#     · 실제 화면 표 헤더(GROUP_DEFS)도 전부 "~분석"으로 끝나게 표기 통일
#       (6·7·8·9번 및 19·20·21·22번에 빠져있던 "분석" 접미사 보완)
#
#  2. 로그인 화면 개선
#     · 자동로그인용 쿠키 컴포넌트가 아직 준비되지 않은 순간에는 로그인
#       폼을 바로 그리지 않고 "로그인 상태 확인 중..." 대기 문구만 표시
#       (자동로그인 성공 시 로그인 폼이 잠깐 보였다 사라지며 화면이
#       뒤섞여 보이던 문제 완화). 컴포넌트가 끝내 준비되지 않는 경우를
#       대비해 5회 초과 시 로그인 폼으로 진행하는 안전장치 포함
#     · 로그인 성공 후 "로그인 유지" 토큰을 쿠키에 저장하자마자 곧바로
#       화면을 새로고침(rerun)하면 브라우저의 실제 쿠키 저장이 끝나기 전에
#       화면이 넘어가버려 토큰이 반영되지 않을 수 있었던 문제 완화
#       (저장 후 짧게 대기한 뒤 rerun)
#     · "아이디 저장" 체크박스 추가 (다음 접속 시 아이디 자동 입력,
#       로그아웃해도 유지됨)
#
#  3. 분석표 행 선택 방식 (정정)
#     · [1차 시도] 행 선택 시 즉시 rerun 되는 게 불필요해 보여
#       on_select="rerun" → "ignore" 로 바꿨었으나, Streamlit 공식 문서 확인
#       결과 "ignore"는 선택 이벤트만 무시하는 게 아니라 "위젯이 아예 선택
#       가능한 입력처럼 동작하지 않음"을 의미해 체크박스/선택 UI 자체가
#       사라지는 회귀가 발생함 (사용자 스크린샷으로 확인)
#     · [정정] on_select="rerun" 으로 복귀. 선택 시 rerun은 발생하지만,
#       아래 6번(탭 지연 렌더링) 덕분에 rerun 자체가 훨씬 가벼워져 체감
#       속도는 개선됨. [선택한 경기 상세보기 생성] 버튼을 눌러야 상세가
#       열리는 동작과 [선택된 경기 해제] 버튼은 그대로 유지.
#
#  4. 조회 필터(시즌·라운드·배당 입력) - 폼(form) 처리로 전환
#     · [문제] 시즌/라운드를 바꾸거나 배당 입력칸에 글자 하나만 입력해도
#       그 즉시 전체 화면이 다시 로딩됐음. 정작 이 값들은 [🔍 조회]를
#       눌러야만 실제로 쓰이는데도 입력 중에 불필요한 로딩이 반복됨
#     · [해결] 시즌/라운드 선택 + 배당 입력칸 9개(KW/KD/KL/KHW/KHD/KHL/
#       FW/FD/FL)를 st.form()으로 묶음. 이제 값을 바꾸거나 입력하는 동안은
#       아무 로딩도 발생하지 않고, [🔍 조회] 버튼을 눌러야 그 시점의 값을
#       한번에 읽어와 반영한다.
#     · [부수 발견 및 수정] 위 작업 중, 기존 [↺ 초기화] 버튼이 "이미 그려진
#       위젯의 값은 이후에 직접 수정할 수 없다"는 Streamlit 규칙에 걸려
#       실제 클릭 시 앱이 죽는 잠재 버그를 발견해 함께 수정함. 위젯을
#       그리기 "전에" 리셋을 예약 처리하는 방식으로 변경해 에러 없이 정상
#       동작하도록 고침 (Streamlit 공식 테스트 도구로 재현·검증 완료).
#
#  5. 로그인 대기 로직 - 횟수 기준 → 시간 기준
#     · [문제] 자동로그인용 쿠키 컴포넌트 준비를 "재시도 5회"라는 횟수로
#       기다렸는데, 재시도 한 번이 느려지는 상황이면 실제로는 꽤 오래
#       멈춘 것처럼 보일 수 있었음 (새로고침 후 빈 화면+스피너 지속 원인)
#     · [해결] "최대 2초"라는 시간 상한으로 변경. 어떤 상황에서도 2초를
#       넘기면 무조건 로그인 화면으로 진행하도록 보장 (최악의 경우로
#       가정한 테스트에서 2.44초 만에 정상 진행되는 것 확인)
#
#  6. 리그 탭 지연 렌더링 - 핵심 성능 개선
#     · [문제] Streamlit의 st.tabs()는 기본적으로 화면에 보이지 않는 탭의
#       내용까지 매 rerun마다 전부 계산해서 전송한다. 리그 탭 6개가 전부
#       계산되면(실측 리그당 약 950ms) 로그인 직후나 아무 버튼을 눌러도
#       매번 약 5~6초가 소요되고 있었음 (로그인 후 로딩이 오래 걸리고,
#       화면 전환 중 로그인 폼과 메인 화면이 겹쳐 보이던 문제의 근본 원인)
#     · [해결] st.tabs(..., on_change="rerun")로 변경해 각 탭 컨테이너의
#       .open 속성으로 "지금 보이는 탭인지"를 판별, 보이지 않는 탭은 계산을
#       통째로 건너뛰도록 리그 6개 탭 + 통합DB탭 + 상대전적탭에 적용.
#       이제 현재 보고 있는 탭 1개만 계산되어 매 rerun마다 약 6배 빨라짐
#       (Streamlit 공식 테스트 도구로 "선택된 탭만 계속 계산되고 나머지는
#       전혀 계산되지 않음"을 재현·검증 완료)
#       그리기 "전에" 리셋을 예약 처리하는 방식으로 변경해 에러 없이 정상
#       동작하도록 고침 (Streamlit 공식 테스트 도구로 재현·검증 완료).
# ------------------------------------------------------------------------------
#
# [V2.0] 변경 이력 (V1.0 → V2.0)
# ------------------------------------------------------------------------------
#  1. 26개 분석지표 전면 개정 (기존 23개 지표 체계 → 신규 26개 코드체계)
#     · 코드 규칙: [T]{F|K}-{결과}[-{기준}]  (T=6대리그통합 / F=해외 / K=국내
#       결과=W·L·WL·WDL / 기준=HW 핸디정배·HT 홈팀·AT 원정팀)
#     · 해외(1~13)·국내(14~26) 완전 대칭 구조로 재설계
#     · 신규 추가 13종: TF-W, TF-L, K-WL, K-WDL, K-W-HW, K-W-HT, K-L-AT,
#       K-WL-HT, K-WL-AT, TK-W, TK-L (국내 배당도 해외와 동등하게 확장)
#     · 표에서 제외: 절삭률(WG/DG/LG), ROI(WR/DR/LR), WLWH/TWLWH/TWDLWH
#       (단, 예측엔진이 참조하므로 내부 산출은 계속 유지)
#
#  2. 화면 UI 개선
#     · 조회 기본값 = 최근 시즌·최근 라운드 자동 선택 (매번 조건 입력 불필요)
#     · 라운드 정렬 버그 수정 (문자정렬 시 9R>38R 되던 문제 → 숫자 추출 정렬)
#     · 표 헤더를 포터블 버전과 동일한 2줄 헤더로 복원 (그룹명+세부항목)
#     · RT(결과) 컬럼을 핸승/핸무/무/역 색상 텍스트로 정상 표시
#     · 상세 경기 정보: 표 행 클릭 → [선택한 경기 상세보기 생성] 버튼을
#       눌러야 열리도록 변경 + [선택된 경기 해제] 버튼 추가
#     · "Running..." 로딩 스피너를 화면 중앙에 표시하도록 CSS 수정
#
#  3. 예측(18/19/20번) 재계산 구조 개선 - 핵심 성능 개선
#     · [문제] 화면에서 시즌 변경/배당 입력/조회 등 조작할 때마다 이미 업로드
#       시 계산되어 저장된 예측을 처음부터 다시 계산하던 비효율 발견
#     · [해결] 업로드([💾저장]) 시점에만 26지표+예측을 계산해 DB에 저장하고,
#       화면 조회 시에는 저장된 값을 그대로 불러오기만 함 (재계산 제거)
#     · 예측 컬럼이 없는 구버전 데이터는 예외적으로만 1회 계산 (안내 문구 표시)
#
#  4. 신규: 통합/예측 수동 재계산 기능 (📈 통합DB 탭, 공식·내 데이터 공통)
#     · [🔄 통합 및 예측 분석] : RT 없는 예정 경기만 최신 통합DB 기준으로
#       재계산 (과거 경기는 절대 수정하지 않음, 평소 자주 사용하는 버튼)
#     · [🔧 전체 재계산] : 과거 경기까지 포함해 전체를 다시 계산 (초기 세팅
#       시 리그를 순서대로 올리면서 생기는 통합지표 불일치를 바로잡는 용도,
#       확인 체크박스로 보호된 별도 버튼)
#
#  5. 코드 정리
#     · 여러 차례 UI 실험(체크박스 표 방식 등) 과정에서 남은 미사용 함수
#       (flatten_columns, build_editor_styler) 제거
# ==============================================================================

import streamlit as st
import pandas as pd
import numpy as np
import sqlite3
import datetime
import os
import io
import re
import time
import streamlit.components.v1 as components

# [수정됨] Pandas Styler 렌더링 제한 확장 (262,144 -> 1,000,000)
pd.set_option("styler.render.max_elements", 1000000)

# ★★★★★소스 수정시 반드시 수정 및 변경되는 부분만 처리하고 다른곳은 수정 및 보완 하지 마세요 ★★★★★★
# ==============================================================================
# [WEB_BET PRO 데이터 변수 정의서 (Variable Glossary)]   V1.0
# ==============================================================================
#
# 1. 경기 기본 정보 (L, S, R, No, DT, TM, HT, HS, RT, AS, AT)
#    - L=리그, S=시즌, R=라운드, No=경기번호, DT=일자, TM=시간
#    - HT=홈팀, HS=홈득점 / AT=원정팀, AS=원정득점
#    - RT=경기결과 판정값 → 1=핸승, 2=핸무, 3=무, 4=역 (플러스핸디 +1.5 기준)
# 2. 해외 배당 (FW, FD, FL, FH, FHW, FHD, FHL)
#    - FW=승, FD=무, FL=패 / FH=핸디기준점, FHW=핸디승, FHD=핸디무, FHL=핸디패
# 3. 국내 배당 (KW, KD, KL, KH, KHW, KHD, KHL)
#    - KW=승, KD=무, KL=패 / KH=핸디기준점, KHW=핸디승, KHD=핸디무, KHL=핸디패
#
# 4. 분석 표본 변수 (Analysis Sample Variables) - [V2.0 : 26지표 체계]
#    ※ 각 지표는 4칸(1~4 = 핸승/핸무/무/역) 구조로, 현재 경기 조건과 일치하는
#      과거 표본이 각 결과별로 몇 건인지 카운트한 값 (자기 자신 1건은 제외)
#    ※ 코드 규칙: [T]{F|K}-{결과}[-{기준}]
#      T=6대리그 통합 / F=해외 / K=국내
#      결과 W·L·WL·WDL / 기준 HW=핸디정배·HT=홈팀·AT=원정팀
# ------------------------------------------------------------------------------
# | 그룹명 (Header Name)                    | 컬럼명    | 탐색범위 |
# ------------------------------------------------------------------------------
# | 1.  해외 승 분석                        | F-W       | 개별리그 |
# | 2.  해외 패 분석                        | F-L       | 개별리그 |
# | 3.  해외 승+패 분석                     | F-WL      | 개별리그 |
# | 4.  해외 승+무+패 분석                  | F-WDL     | 개별리그 |
# | 5.  해외 승+핸디정배 분석               | F-W-HW    | 개별리그 |
# | 6.  해외 승=홈팀 분석                   | F-W-HT    | 개별리그 |
# | 7.  해외 패=원정팀 분석                 | F-L-AT    | 개별리그 |
# | 8.  해외 승/패=홈팀 분석                | F-WL-HT   | 개별리그 |
# | 9.  해외 승/패=원정팀 분석              | F-WL-AT   | 개별리그 |
# | 10. 해외 통합 승 분석                   | TF-W      | 통합DB   |
# | 11. 해외 통합 패 분석                   | TF-L      | 통합DB   |
# | 12. 해외 통합 승+패 분석                | TF-WL     | 통합DB   |
# | 13. 해외 통합 승+무+패 분석             | TF-WDL    | 통합DB   |
# | 14. 국내 승 분석                        | K-W       | 개별리그 |
# | 15. 국내 패 분석                        | K-L       | 개별리그 |
# | 16. 국내 승+패 분석                     | K-WL      | 개별리그 |
# | 17. 국내 승+무+패 분석                  | K-WDL     | 개별리그 |
# | 18. 국내 승+핸디정배 분석               | K-W-HW    | 개별리그 |
# | 19. 국내 승=홈팀 분석                   | K-W-HT    | 개별리그 |
# | 20. 국내 패=원정팀 분석                 | K-L-AT    | 개별리그 |
# | 21. 국내 승/패=홈팀 분석                | K-WL-HT   | 개별리그 |
# | 22. 국내 승/패=원정팀 분석              | K-WL-AT   | 개별리그 |
# | 23. 국내 통합 승 분석                   | TK-W      | 통합DB   |
# | 24. 국내 통합 패 분석                   | TK-L      | 통합DB   |
# | 25. 국내 통합 승+패 분석                | TK-WL     | 통합DB   |
# | 26. 국내 통합 승+무+패 분석             | TK-WDL    | 통합DB   |
# ------------------------------------------------------------------------------
# * 통합DB: 현재 스코프(공식/내 데이터) 내부의 6대 리그 전체 합산.
#   공식 탭 → master.db / 내 데이터 탭 → 본인 user.db. 두 영역은 절대 섞이지 않는다.
#
# * 💡 [V2.0 삭제] 아래 항목은 화면 표에서 제외됨 (단, 예측엔진 내부 계산은 유지)
#   - 승무패 절삭률 WG/DG/LG, 승무패 ROI WR/DR/LR
#   - 승+패+핸승 WLWH / 통합 승+패+핸승 TWLWH / 통합 승+무+패+핸승 TWDLWH (완전 삭제)
#
# ==============================================================================
# 6. 예측 산출 컬럼 (Prediction Outputs) - [v5.0 ~ v7.0]
#    ※ fav = min(FW, FL) = 정배(이길 것으로 예상되는 쪽) 배당
#    ※ 8대 합의지표 = FWH/FWHT/TWDL/TWLWH/KW/KL/FLH/TWL 중 같은 결과를
#       2건 이상으로 가리키는(argmax) 지표 수
# ------------------------------------------------------------------------------
# | 18. 프로그램 예측 (PICK + 등급)  → "픽=사라는것 / 등급=신뢰도 / —=관망"     |
# |     · 픽 방향은 fav(정배배당)가 지배:                                        |
# |        fav≤1.95 → 핸승 / 1.95~2.25 → 무 / ≥2.25 → 역                         |
# |     · 등급 = 그 픽의 실제 적중 신뢰도 (절대 적중률 기준)                     |
# |        SS(≈63%) > S(≈49%) > A(≈40%) > B(≈32%) > —(관망: 베이스수준=사지마)   |
# |     · 핸승%/핸무%/무%/역% 4칸은 참고용 확률 표시                             |
# |     · 11,440경기·6시즌 검증, 매 시즌 SS+S+A 40~50% 안정 발화                 |
# |                                                                              |
# | 19. 플핸 등급 (비핸승 = 핸무+무+역 시그널)                                   |
# |     · 핸승을 제외한 결과(플러스핸디)가 나올 확률이 높은 경기를 탐지          |
# |     · S = 87%+ 안정픽  / A = 84%+ (세리에A·라리가 한정)                      |
# |       E = 고EV 역습픽 (fav≤1.55 & WR<−10 → 66% × 배당 1.7~1.8 = EV +9~18%)   |
# |     · 빈칸 = 미발동 (베이스 70% 수준, 강한 플핸 신호 없음)                   |
# |                                                                              |
# | 20. 조합 등급 (18 × 19 × 국내배당 도플갱어 3중 결합)                         |
# |     · 서로 다른 3개 데이터 소스가 합의할수록 적중률 상승                     |
# |     · 형식 = "방향 + 등급" (예: 플핸 SS / 핸승 B)                            |
# |        플핸 SS≈90% / 플핸 S≈82% / 플핸 A≈75% / 핸승 B≈61% / 핸승 C≈55%       |
# |     · 국내 도플갱어 = 같은 국내 정배배당을 가진 과거 경기들의 비핸승 비율    |
# ------------------------------------------------------------------------------
# * 모든 예측 수치는 과거 데이터 재검증(in-sample) 기준이며, 실전에서는 다소
#   낮을 수 있음. 베팅 결정과 자금 관리는 본인 판단으로 신중히.
# ==============================================================================

# ============================================================================================
# 💡 [업데이트 내용] WEB_BET PRO V1.0: 4-DB 컨테이너 구조로 전환
# --------------------------------------------------------------------------------------------
#   (1) auth.db                        계정 - master 재빌드/롤백과 무관하게 보존
#   (2) data/master/master.db          공식 데이터 - 관리자만 쓰기, 전 고객 열람
#   (3) data/users/{id}/user.db        개인 업로드 데이터 - 본인만 쓰기
#   (4) data/users/{id}/predlog.db     개인 예측로그(성적표) - 데이터와 운명 분리
#   (5) data/access_log.db             관리자 열람 기록
#
#   · 기존 DB_FILE_NAME(단일 Soccer_History.db) 상수를 제거하고 스코프별 함수로 대체
#   · 코어 엔진(_prep_db / get_samples_fast / analyze_dataframe)은
#     단 한 줄도 수정하지 않음. DB 경로만 주입된다.
#     (💡 [V2.3] 옛 예측엔진 ProgramPredictor18은 완전 삭제되어 이 목록에서 제외)
# ============================================================================================
import betpro_paths as PATHS
import betpro_ui as UI

PATHS.bootstrap()

AUTH_DB = PATHS.get_auth_db()          # (1) 계정 전용
LEAGUES = PATHS.LEAGUES


def DB():
    """(2)/(3) 현재 스코프의 데이터 DB. 공식=master.db / 내 데이터=user.db"""
    return UI.current_db()


# --- 0. 스타일(CSS) ---
st.set_page_config(page_title="WEB_BET PRO V1.0", layout="wide",
                   initial_sidebar_state="collapsed")

# ============================================================================================
# 💡 [업데이트 내용] v7.3W: 웹 로그인 게이트 (관리자 계정 관리형)
#   - 서버(내 PC)에서 실행, 고객은 브라우저로 접속하여 ID/PW 로그인
#   - 만료일 경과 시 자동 차단, 관리자가 기간 연장하면 즉시 재개
#   - 로그인 성공 후에만 본 화면(분석 기능) 노출
#   - 💡 [V1.0] 계정 저장소가 AUTH_DB(auth.db)로 분리됨. betpro_auth.py 는 무수정.
# ============================================================================================
import betpro_auth as AUTH

AUTH.ensure_default_admin(AUTH_DB)   # 최초 실행 시 기본 관리자 생성

# ════════════════════════════════════════════════════════════
# 💡 [업데이트 내용] V1.0 New: 자동 로그인 (로그인 유지)
# --------------------------------------------------------------
#  · 새로고침(F5)만 해도 로그아웃되던 문제 해결
#  · 쿠키에는 HMAC 서명 토큰만 저장. 비밀번호는 저장하지 않음
#  · 토큰 만료 = 계정 만료일 (permanent 계정이면 무기한)
#  · 매 접속 시 DB를 다시 조회 -> 계정 삭제/기간만료/비번변경 즉시 반영
#  ⚠ 공용 PC에서는 반드시 [로그아웃] 버튼을 눌러야 함 (쿠키가 남으면 다음 사람이 접속 가능)
# ════════════════════════════════════════════════════════════
COOKIE_NAME = 'betpro_auth'
COOKIE_ID_NAME = 'betpro_last_id'   # 💡 [신규] 아이디 저장용 쿠키 (평문, 민감정보 아님)
_COOKIES = None
try:
    from streamlit_cookies_manager import CookieManager
    _COOKIES = CookieManager(prefix='betpro/')
except Exception:
    _COOKIES = None   # 패키지 없으면 자동로그인만 비활성 (기존 로그인은 정상 동작)


def _cookie_ready():
    return _COOKIES is not None and _COOKIES.ready()


def _cookie_get():
    try:
        return _COOKIES.get(COOKIE_NAME) if _cookie_ready() else None
    except Exception:
        return None


def _cookie_get_id():
    """💡 [신규] 저장된 마지막 로그인 아이디 조회 (편의용, 민감정보 아님)."""
    try:
        return _COOKIES.get(COOKIE_ID_NAME) if _cookie_ready() else None
    except Exception:
        return None


def _cookie_set(token):
    try:
        if _cookie_ready():
            _COOKIES[COOKIE_NAME] = token
            _COOKIES.save()
    except Exception:
        pass


def _cookie_set_id(user_id):
    """💡 [신규] '아이디 저장' 체크 시 아이디를 쿠키에 저장."""
    try:
        if _cookie_ready():
            _COOKIES[COOKIE_ID_NAME] = user_id
            _COOKIES.save()
    except Exception:
        pass


def _cookie_clear_id():
    """💡 [신규] '아이디 저장' 해제 시 쿠키에서 삭제."""
    try:
        if _cookie_ready() and COOKIE_ID_NAME in _COOKIES:
            del _COOKIES[COOKIE_ID_NAME]
            _COOKIES.save()
    except Exception:
        pass


def _cookie_clear():
    try:
        if _cookie_ready() and COOKIE_NAME in _COOKIES:
            del _COOKIES[COOKIE_NAME]
            _COOKIES.save()
    except Exception:
        pass


if 'auth_user' not in st.session_state:
    st.session_state['auth_user'] = None
    st.session_state['auth_role'] = None
    st.session_state['auth_expiry'] = None


def _apply_login(username, role, expiry):
    """세션에 로그인 상태 주입 + 개인 데이터 공간 보장."""
    st.session_state['auth_user'] = username
    st.session_state['auth_role'] = role
    st.session_state['auth_expiry'] = expiry
    try:
        PATHS.ensure_user_space(username)
    except PATHS.InvalidUsernameError as _e:
        st.warning(f"개인 데이터 공간을 만들 수 없습니다: {_e}")
    UI.init_scope()


def _do_logout():
    _cookie_clear()          # 💡 [V1.0] 로그아웃 시 토큰 삭제
    for k in ['auth_user', 'auth_role', 'auth_expiry']:
        st.session_state[k] = None
    st.session_state['scope'] = PATHS.SCOPE_MASTER


# ── 쿠키 토큰으로 자동 로그인 시도 (세션이 비어있을 때만) ──
if not st.session_state.get('auth_user') and _cookie_ready():
    _tok = _cookie_get()
    if _tok:
        _tok_ok, _tok_info = AUTH.verify_token(AUTH_DB, _tok)
        if _tok_ok:
            _apply_login(_tok_info['username'], _tok_info['role'], _tok_info['expiry'])
        else:
            # 계정 삭제/만료/비번변경 등 -> 죽은 토큰 정리
            if _tok_info.get('code') not in ('NO_TOKEN',):
                _cookie_clear()
                if _tok_info.get('msg'):
                    st.session_state['_login_notice'] = _tok_info['msg']


# ── 로그인 화면 ──
if not st.session_state.get('auth_user'):
    # ════════════════════════════════════════════════════════════
    # 💡 [수정] 쿠키 매니저 준비 전 임시 대기 화면 - 횟수 기준 → 시간 기준
    # --------------------------------------------------------------
    #  [배경] streamlit_cookies_manager는 브라우저 쿠키를 읽기 위해
    #         보이지 않는 컴포넌트가 뜨는 데 한 박자(1회 rerun) 걸린다.
    #         이 순간에 로그인 폼을 바로 그려버리면, 자동로그인이 곧바로
    #         성공할 예정이어도 로그인 폼이 잠깐 나타났다 사라지며
    #         화면이 뒤섞여 보이는 원인이 된다.
    #  [문제] 이전엔 "재시도 5회"라는 횟수 기준으로 대기했는데, 재시도 한
    #         번 한 번이 느려지는 상황(네트워크 지연 등)이면 실제로는
    #         상당히 오래 멈춘 것처럼 보일 수 있었다 (새로고침 후 빈 화면 +
    #         스피너가 계속 도는 것처럼 보이던 원인으로 추정).
    #  [해결] "몇 번 재시도"가 아니라 "최대 몇 초"로 상한을 둔다. 실제
    #         경과 시간이 2초를 넘으면 컴포넌트 준비 여부와 상관없이
    #         무조건 로그인 폼으로 넘어간다 - 어떤 경우에도 2초 넘게
    #         화면이 멈춰 있지 않도록 보장.
    # ════════════════════════════════════════════════════════════
    _COOKIE_WAIT_LIMIT_SEC = 2.0
    if _COOKIES is not None and not _cookie_ready():
        _wait_start = st.session_state.get('_cookie_wait_start')
        if _wait_start is None:
            _wait_start = time.time()
            st.session_state['_cookie_wait_start'] = _wait_start
        _elapsed = time.time() - _wait_start
        if _elapsed < _COOKIE_WAIT_LIMIT_SEC:
            st.markdown("## 🔐 WEB_BET PRO")
            st.caption("로그인 상태 확인 중...")
            st.stop()
        # 2초 넘게 준비 안 되면 포기하고 로그인 폼으로 진행 (아래로 계속)
    else:
        st.session_state['_cookie_wait_start'] = None

    _c1, _c2, _c3 = st.columns([1, 1.2, 1])
    with _c2:
        st.markdown("## 🔐 WEB_BET PRO 로그인")
        st.caption("계정이 없거나 이용 기간이 만료된 경우 관리자에게 문의하세요.")

        # 자동로그인 실패 사유가 있으면 1회 표시
        _notice = st.session_state.pop('_login_notice', None)
        if _notice:
            st.info(_notice)

        # 💡 [신규] 저장된 아이디가 있으면 자동으로 채워줌
        _saved_id = _cookie_get_id() or ""
        _id = st.text_input("아이디", value=_saved_id, key="login_id")
        _pw = st.text_input("비밀번호", type="password", key="login_pw")
        _kc1, _kc2 = st.columns(2)
        with _kc1:
            # 💡 [V1.0 New] 로그인 유지 - 기본 체크
            _keep = st.checkbox("로그인 유지", value=True, key="login_keep",
                                help="이용 기간이 끝날 때까지 자동 로그인됩니다. "
                                     "공용 PC에서는 사용 후 반드시 로그아웃하세요.")
        with _kc2:
            # 💡 [신규] 아이디 저장
            _remember_id = st.checkbox("아이디 저장", value=bool(_saved_id),
                                       key="login_remember_id",
                                       help="다음 접속 시 아이디 입력칸이 자동으로 채워집니다.")
        if st.button("로그인", use_container_width=True, type="primary", key="login_btn"):
            _ok, _info = AUTH.verify_login(AUTH_DB, _id, _pw)
            if _ok:
                _apply_login(_id.strip(), _info.get('role', 'user'),
                             _info.get('expiry', 'permanent'))
                # 💡 [신규] 아이디 저장/삭제
                if _remember_id:
                    _cookie_set_id(_id.strip())
                else:
                    _cookie_clear_id()
                # 💡 [V1.0] 로그인 유지 체크 시 토큰 발급
                if _keep:
                    _t = AUTH.issue_token(AUTH_DB, _id.strip())
                    if _t:
                        _cookie_set(_t)
                # ════════════════════════════════════════════════════════════
                # 💡 [수정] 새로고침 시 로그아웃되던 문제 완화
                #   쿠키 저장(document.cookie 기록)은 브라우저 쪽에서 비동기로
                #   처리된다. 저장 명령 직후 곧바로 rerun 하면 실제 저장이
                #   끝나기 전에 화면이 넘어가 버려, 토큰이 브라우저에 반영되지
                #   않은 채로 넘어갈 수 있다 (다음 새로고침 시 자동로그인 실패
                #   → 로그아웃처럼 보이는 원인). 아주 짧게 대기 후 rerun.
                # ════════════════════════════════════════════════════════════
                time.sleep(0.15)
                st.rerun()
            else:
                st.error(_info.get('msg', '로그인 실패'))
                if _info.get('code') == 'EXPIRED':
                    st.info("이용 기간 연장은 관리자에게 문의해 주세요.")
    st.stop()

# ── 로그인 후: 상단 사용자 바 ──
_ub1, _ub2, _ub3 = st.columns([5, 2, 1])
with _ub1:
    _role_tag = "👑 관리자" if st.session_state['auth_role'] == 'admin' else "👤 사용자"
    st.caption(f"{_role_tag}  |  **{st.session_state['auth_user']}** 님 접속 중")
with _ub2:
    _dl = AUTH.days_left(st.session_state.get('auth_expiry'))
    if _dl is None:
        st.caption("이용 기간: 무기한")
    else:
        st.caption(f"이용 기간: {st.session_state['auth_expiry']} (D-{_dl})")
        if _dl <= 7:
            st.warning(f"⏰ {_dl}일 후 만료됩니다. 연장은 관리자에게 문의하세요.")
with _ub3:
    if st.button("로그아웃", key="logout_btn"):
        _do_logout()
        st.rerun()
st.markdown("""
<style>
    .block-container { padding-top: 3.5rem; padding-bottom: 1rem; }
    .stDataFrame [data-testid="stDataGridCellContent"] { padding: 0.2rem 0.5rem; font-size: 13px; }
    .stDataFrame [data-testid="stHeaderCellContent"] { 
        padding: 0.2rem 0.5rem; font-size: 13px; font-weight: bold; 
        text-align: center !important; white-space: pre-wrap !important; line-height: 1.2 !important;
    }
    div[data-testid="stFileUploader"] label { display: none; }
    div[data-testid="stFileUploader"] { padding-top: 0; }
    /* 💡 [수정3] "Running..." 상태 스피너를 화면 중앙에 크게 표시 */
    [data-testid="stStatusWidget"] {
        position: fixed !important;
        top: 45% !important; left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 99999 !important;
        background: rgba(20, 30, 45, 0.92) !important;
        padding: 18px 30px !important;
        border-radius: 12px !important;
        border: 1px solid #37474F !important;
        box-shadow: 0 6px 24px rgba(0,0,0,0.5) !important;
        transform-origin: center !important;
    }
    [data-testid="stStatusWidget"] * { font-size: 15px !important; }
</style>
""", unsafe_allow_html=True)

# --- 1. 헬퍼 함수 ---
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


# 💡 [업데이트 내용] V1.0: @st.cache_data 제거.
#   다중 접속 환경에서 35,828행 x 150컬럼 엑셀이 계정 수만큼 메모리에 캐싱되어
#   메모리 폭증을 유발. 다운로드는 클릭당 1회뿐이라 캐시 이득이 거의 없다.
def to_excel(df):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer)
    return output.getvalue()


# ════════════════════════════════════════════════════════════
# 💡 [신규] 엑셀 다운로드도 화면과 동일한 2단 헤더로 출력
# --------------------------------------------------------------
#  [배경] 지금까지 엑셀 다운로드는 pandas 기본 방식(1줄 평평한 헤더)만
#         썼는데, 화면 표는 "그룹명(1단) + 세부항목(2단)" 구조라 서로
#         안 맞았음. apply_multi_index()가 만드는 (그룹, 세부) 라벨을
#         그대로 엑셀의 병합된 2행 헤더로 옮겨 화면과 동일하게 맞춘다.
#  [방식] pandas 기본 헤더는 끄고(header=False), 1~2행을 xlsxwriter로
#         직접 써서 같은 그룹명을 가진 연속된 열을 병합(merge_range).
#         RT는 화면처럼 한글(핸승/핸무/무/역)로 표기.
#  [실패 대비] 어떤 이유로든 실패하면 기존 to_excel()로 자동 대체.
# ════════════════════════════════════════════════════════════
def to_excel_display(df):
    """화면과 동일한 2단 헤더(그룹+세부항목) 구조로 엑셀 생성."""
    try:
        disp = apply_multi_index(df)
        for c in list(disp.columns):
            if isinstance(c, tuple) and c[1] == 'RT':
                disp[c] = disp[c].map(rt_to_text)

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            # 💡 pandas는 "멀티인덱스 컬럼 + index=False" 조합을 지원하지 않음
            #   (NotImplementedError). 헤더는 어차피 직접 쓸 것이므로,
            #   데이터만 쓸 임시 사본은 컬럼을 단순 인덱스로 바꿔서 우회한다.
            cols = list(disp.columns)   # [(그룹, 세부), ...] - 헤더 작성용 원본 보존
            data_only = disp.copy()
            data_only.columns = range(len(cols))
            data_only.to_excel(writer, sheet_name='조회결과', index=False,
                               header=False, startrow=2)
            wb = writer.book
            ws = writer.sheets['조회결과']

            hdr_fmt = wb.add_format({
                'bold': True, 'align': 'center', 'valign': 'vcenter',
                'bg_color': '#1E2A38', 'font_color': '#FFFFFF',
                'border': 1, 'text_wrap': True,
            })

            n = len(cols)

            # ── 1행: 같은 그룹명을 가진 연속 열을 병합 ──
            i = 0
            while i < n:
                group = cols[i][0]
                j = i
                while j + 1 < n and cols[j + 1][0] == group:
                    j += 1
                if j > i:
                    ws.merge_range(0, i, 0, j, group, hdr_fmt)
                else:
                    ws.write(0, i, group, hdr_fmt)
                i = j + 1

            # ── 2행: 세부 항목명 ──
            for idx, (_grp, sub) in enumerate(cols):
                ws.write(1, idx, sub, hdr_fmt)

            ws.set_row(0, 32)
            ws.set_row(1, 18)
            for idx in range(n):
                ws.set_column(idx, idx, 10)

        return output.getvalue()
    except Exception:
        # 실패 시 기존 방식(단순 1줄 헤더)으로 안전하게 대체
        return to_excel(df)



# ============================================================================================
# ============================================================================================
# 💡 WEB_BET PRO V1.0 FINAL  (웹 로그인 서버판 + 데이터 2원화)
# ============================================================================================
# 💡 [업데이트 내용] V1.0: 데이터 2원화 (공식 master.db / 개인 user.db)
#   · 📊 공식 데이터 : 관리자가 배포하는 6대 리그 공식 DB. 고객은 열람 전용
#   · 👤 내 데이터   : 고객이 직접 업로드한 데이터. 본인만 읽기/쓰기
#   · 두 영역은 DB 파일 자체가 분리되어 완전 격리 (통합지표 13~17번도 스코프 내부에서만 산출)
#   · 관리자는 고객 데이터를 '열람만' 가능 (읽기전용 connect + access_log 기록)
#   · 계정(auth.db)·예측로그(predlog.db)를 별도 파일로 분리 → 데이터 재빌드와 운명 분리
# ============================================================================================
# 💡 [업데이트 내용] v7.3W: 웹 로그인 방식 전환 (설치형 → 서버형)
#   · 서버(운영자 PC)에서 실행하고 고객은 브라우저로 접속 → 고객 설치 불필요
#   · 로그인: ID/PW + 이용기간(만료일). 만료 시 자동 차단, 관리자 연장 시 즉시 재개
#   · 👑 계정관리 탭(관리자 전용): 계정 목록/추가/삭제/기간연장/비밀번호 변경
#   · 비밀번호는 PBKDF2-HMAC-SHA256 해시 저장 (평문 미저장)
#   · betpro_auth.py 모듈 필요 (같은 폴더)
# ============================================================================================
# ════════════════════════════════════════════════════════════
# 💡 [V2.3] 옛 18/19/20번 예측 엔진(ProgramPredictor18) 완전 삭제
# --------------------------------------------------------------
#   실측 검증 결과, fav(정배배당) 구간이 픽/등급을 사실상 전부 결정하고
#   26개 지표는 거의 반영되지 않는 구조였으며, 4개 결과(핸승/핸무/무/역)
#   맞히기는 어떤 방식으로도 베이스레이트(31%)와 차이가 없었음이 확인됨.
#   이후 V2.2에서 만든 '플핸 예측'(PH_F/PH_K/PH_PICK/PH_HIT/PH_DOM,
#   compute_plushandi 함수)으로 완전히 대체되어, 구엔진과 여기 딸려있던
#   예측저장/자동채점(prediction_log) 기능까지 전부 제거함.
# ════════════════════════════════════════════════════════════

# --- 3. 스타일 함수 (원본 렌더링 로직 보존) ---

# ════════════════════════════════════════════════════════════
# 💡 [V2.2 New] 플핸 예측 컬럼 스타일
# ════════════════════════════════════════════════════════════
def style_ph_pick(val):
    """PICK: 플핸(역)=진보라 / 플핸(무)=보라 / 플핸(핸무)=주의(주황) / 핸승=파랑"""
    s = str(val).strip()
    if s.startswith('플핸'):
        if '(역)' in s:
            return 'background-color: #4A148C; color: white; font-weight: bold;'
        if '(무)' in s:
            return 'background-color: #6A1B9A; color: white; font-weight: bold;'
        if '(핸무)' in s:
            # 실측 적중률이 확 떨어지는 구간 → 주의색
            return 'background-color: #E65100; color: white; font-weight: bold;'
        return 'background-color: #7B1FA2; color: white;'
    if s == '핸승':
        return 'background-color: #1565C0; color: white; font-weight: bold;'
    return 'color: #9E9E9E;'


def style_ph_hit(val):
    """실측 적중률: 높을수록 진하게"""
    try:
        v = float(val)
    except (TypeError, ValueError):
        return ''
    if v >= 80:
        return 'background-color: #1B5E20; color: white; font-weight: bold;'
    if v >= 75:
        return 'background-color: #2E7D32; color: white; font-weight: bold;'
    if v >= 70:
        return 'background-color: #66BB6A; color: #0D1B2A;'
    if v >= 65:
        return 'background-color: #C5E1A5; color: #1B5E20;'
    return 'color: #9E9E9E;'


def style_ph_share(val):
    """해)플핸 / 국)플핸 비율: 베이스(69%) 대비 높낮이"""
    try:
        v = float(val)
    except (TypeError, ValueError):
        return ''
    if v >= 85:
        return 'background-color: #311B92; color: white; font-weight: bold;'
    if v >= 80:
        return 'background-color: #512DA8; color: white;'
    if v >= 75:
        return 'background-color: #9575CD; color: #1A1A1A;'
    if v < 50:
        # 플핸 신호 약함 = 핸승 쪽 신호
        return 'background-color: #1565C0; color: white; font-weight: bold;'
    return ''


def style_fh(val):
    """핸디캡 기준점: 음수(정배 핸디)=파랑 / 양수=빨강"""
    try:
        v = float(val)
    except (TypeError, ValueError):
        return ''
    if v < 0:
        return 'color: #1565C0; font-weight: bold;'
    if v > 0:
        return 'color: #C62828; font-weight: bold;'
    return ''


def style_rt_column(val):
    """RT 결과 컬럼: 1=핸승(파랑) / 2=핸무(하늘) / 3=무(회색) / 4=역(빨강)"""
    try:
        if pd.isna(val):
            return ''
        v = int(float(val))
    except (TypeError, ValueError):
        s = str(val).strip()
        v = {'핸승': 1, '핸무': 2, '무': 3, '역': 4}.get(s, 0)
    if v == 1:
        return 'background-color: #1565C0; color: white; font-weight: bold;'
    if v == 2:
        return 'background-color: #64B5F6; color: #0D1B2A; font-weight: bold;'
    if v == 3:
        return 'background-color: #757575; color: white; font-weight: bold;'
    if v == 4:
        return 'background-color: #C62828; color: white; font-weight: bold;'
    return ''


RT_DISPLAY = {1: '핸승', 2: '핸무', 3: '무', 4: '역'}


def rt_to_text(v):
    """RT 코드 → 한글 표기. NaN(예정 경기)은 공란."""
    try:
        if pd.isna(v):
            return ''
        return RT_DISPLAY.get(int(float(v)), '')
    except (TypeError, ValueError):
        return str(v) if v else ''


# ============================================================================================
# 💡 멀티인덱스 헤더 구성 (원본 3x2 요약표 배열 및 '합' 행 렌더링 로직 보존)
# ============================================================================================
# ════════════════════════════════════════════════════════════
# 💡 [업데이트 내용] V1.0: 시안 반영 - 컬럼 그룹 순서/라벨 재정의
#   1단 = 그룹 제목 + 부제(설명) / 2단 = 세부 컬럼명
#   순서: 일반정보 → 경기정보 → 국내배당 → 해외배당 → 절삭률/ROI
#         → 해)프로그램 예측 → 해)플핸 예측 → 지표 1~23
#   ※ 산출 로직 무수정. 표시 순서와 라벨만 변경.
# ════════════════════════════════════════════════════════════
GEN_COLS = ['L', 'S', 'R', 'No', 'DT', 'TM']          # 일반정보
MATCH_COLS = ['HT', 'HS', 'RT', 'AS', 'AT']            # 경기정보
BASE_COLS = GEN_COLS + MATCH_COLS                      # (호환 유지)
K_ODDS_COLS = ['KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL']
F_ODDS_COLS = ['FW', 'FD', 'FL', 'FH', 'FHW', 'FHD', 'FHL']

GRP_GEN = '일반정보\n시즌 및 라운드 정보'
GRP_MATCH = '경기정보\n홈팀 vs 원정팀'
GRP_KODDS = '국내배당\n승(W) / 무(D) / 패(L)'
GRP_FODDS = '해외배당\nhttps://www.scoreman123.com/'
GRP_CUT = '11. 절삭률\n(국내/해외)*100'
GRP_ROI = '12. ROI\n통합DB Zone 기대수익'
# 💡 [V2.2 New] 26개 지표 기반 플핸 예측 (해외배당과 지표1번 사이에 배치)
GRP_PH = '플핸 예측\n26개 지표 기반 · 실측 적중률'

# 4칸(핸승/핸무/무/역) 구조 지표 그룹 정의: (그룹라벨, [지표코드...])
# ════════════════════════════════════════════════════════════
# 💡 [업데이트 내용] V2.0: 26지표 룰북 전면 개정 (데브곰 신규 체계)
#   형식 = "N. 블록) 제목\n코드"
#   해외(1~13) / 국내(14~26) 완전 대칭 구조. 모든 항목명 끝에 "분석" 통일.
#   코드체계: [T]{F|K}-{결과}[-{기준}]
#     T=6대리그통합 / F=해외 / K=국내
#     결과 W·L·WL·WDL / 기준 HW=핸디정배·HT=홈팀·AT=원정팀
#   ※ 삭제: WLWH, TWLWH, TWDLWH, 절삭률(WG/DG/LG), ROI(WR/DR/LR)
#     (단, 예측 엔진용 기존 지표 산출은 내부적으로 유지)
# ════════════════════════════════════════════════════════════
GROUP_DEFS = [
    # ── 해외 개별 (1~9) ──
    ('1. 해) 승 분석\nF-W', ['F-W']),
    ('2. 해) 패 분석\nF-L', ['F-L']),
    ('3. 해) 승+패 분석\nF-WL', ['F-WL']),
    ('4. 해) 승+무+패 분석\nF-WDL', ['F-WDL']),
    ('5. 해) 승+H핸 분석\nF-W-HW', ['F-W-HW']),
    ('6. 해) 승=홈팀 분석\nF-W-HT', ['F-W-HT']),
    ('7. 해) 패=원정팀 분석\nF-L-AT', ['F-L-AT']),
    ('8. 해) 승/패=홈팀 분석\nF-WL-HT', ['F-WL-HT']),
    ('9. 해) 승/패=원정팀 분석\nF-WL-AT', ['F-WL-AT']),
    # ── 해외 통합 (10~13) ──
    ('10. 해/통) 승 분석\nTF-W', ['TF-W']),
    ('11. 해/통) 패 분석\nTF-L', ['TF-L']),
    ('12. 해/통) 승+패 분석\nTF-WL', ['TF-WL']),
    ('13. 해/통) 승+무+패 분석\nTF-WDL', ['TF-WDL']),
    # ── 국내 개별 (14~22) ──
    ('14. 국) 승 분석\nK-W', ['K-W']),
    ('15. 국) 패 분석\nK-L', ['K-L']),
    ('16. 국) 승+패 분석\nK-WL', ['K-WL']),
    ('17. 국) 승+무+패 분석\nK-WDL', ['K-WDL']),
    ('18. 국) 승+H핸 분석\nK-W-HW', ['K-W-HW']),
    ('19. 국) 승=홈팀 분석\nK-W-HT', ['K-W-HT']),
    ('20. 국) 패=원정팀 분석\nK-L-AT', ['K-L-AT']),
    ('21. 국) 승/패=홈팀 분석\nK-WL-HT', ['K-WL-HT']),
    ('22. 국) 승/패=원정팀 분석\nK-WL-AT', ['K-WL-AT']),
    # ── 국내 통합 (23~26) ──
    ('23. 국/통) 승 분석\nTK-W', ['TK-W']),
    ('24. 국/통) 패 분석\nTK-L', ['TK-L']),
    ('25. 국/통) 승+패 분석\nTK-WL', ['TK-WL']),
    ('26. 국/통) 승+무+패 분석\nTK-WDL', ['TK-WDL']),
]

SUB4 = ['핸승', '핸무', '무', '역']


def apply_multi_index(df):
    """
    💡 [V1.0 시안 반영] 2단 멀티인덱스 헤더 구성.
      1단 = 그룹 제목 + 부제 / 2단 = 세부 컬럼명
    순서: 일반정보 → 경기정보 → 국내배당 → 해외배당 → 절삭률 → ROI
          → 해)프로그램 예측(%) → 해)플핸 예측 → 지표 1~23
    존재하는 컬럼만 골라 순서대로 배치한다 (없는 컬럼은 자동 스킵).
    """
    cols = []
    tuples = []

    def _add(group, label, col):
        if col in df.columns:
            cols.append(col)
            tuples.append((group, label))

    # ── 일반정보 / 경기정보 (시안: 두 그룹으로 분리) ──
    for c in GEN_COLS:
        _add(GRP_GEN, c, c)
    for c in MATCH_COLS:
        _add(GRP_MATCH, c, c)

    # ── 배당 ──
    for c in K_ODDS_COLS:
        _add(GRP_KODDS, c, c)
    for c in F_ODDS_COLS:
        _add(GRP_FODDS, c, c)

    # 💡 [V1.1] 절삭률(WG/DG/LG)·ROI(WR/DR/LR)는 새 26지표 룰북에서 표 제외
    #   (산출은 계속되지만 표에는 표시하지 않음. 예측 엔진은 계속 사용)

    # ════════════════════════════════════════════════════════════
    # 💡 [V2.2 New] 플핸 예측 - 해외배당 바로 뒤, 지표 1번 앞에 배치
    #   해)플핸% : 해외 13지표 비핸승 비율
    #   국)플핸% : 국내 13지표 비핸승 비율
    #   PICK     : 플핸(역)/플핸(무)/플핸(핸무) / 핸승 / —
    #   실측     : 백테스트 기준 실제 적중률(%)
    #   비중     : 최다결과가 비핸승 표본에서 차지하는 비율(%)
    # ════════════════════════════════════════════════════════════
    _add(GRP_PH, '해)플핸', 'PH_F')
    _add(GRP_PH, '국)플핸', 'PH_K')
    _add(GRP_PH, 'PICK', 'PH_PICK')
    _add(GRP_PH, '실측', 'PH_HIT')
    _add(GRP_PH, '비중', 'PH_DOM')

    # ── 4칸 구조 지표 그룹 (신규 26지표) ──
    for group_label, inds in GROUP_DEFS:
        for ind in inds:
            for i, sub in enumerate(SUB4, start=1):
                col = f'{ind} {i}'
                if col in df.columns:
                    cols.append(col)
                    tuples.append((group_label, sub))

    df_out = df[cols].copy()
    df_out.columns = pd.MultiIndex.from_tuples(tuples)
    return df_out


def build_styler(df_disp, df_src):
    """
    💡 [원본 보존] 스타일 적용. 멀티인덱스 적용 후 호출.
    df_disp: apply_multi_index 결과 / df_src: 원본(컬럼명 단일)
    """
    sty = df_disp.style

    def _safe_map(colname, func):
        for c in df_disp.columns:
            if c[1] == colname or c[0].endswith(colname):
                try:
                    sty.map(func, subset=pd.IndexSlice[:, [c]])
                except Exception:
                    pass

    try:
        # 💡 [V1.0] 그룹 라벨 상수로 매칭 (시안 반영으로 그룹명이 바뀜)
        for c in df_disp.columns:
            _g, _s = c[0], c[1]
            if _g == GRP_MATCH and _s == 'RT':
                sty.map(style_rt_column, subset=pd.IndexSlice[:, [c]])
            elif (_g == GRP_FODDS and _s == 'FH') or (_g == GRP_KODDS and _s == 'KH'):
                sty.map(style_fh, subset=pd.IndexSlice[:, [c]])
            elif _g == GRP_PH and _s == 'PICK':
                sty.map(style_ph_pick, subset=pd.IndexSlice[:, [c]])
            elif _g == GRP_PH and _s == '실측':
                sty.map(style_ph_hit, subset=pd.IndexSlice[:, [c]])
            elif _g == GRP_PH and _s in ('해)플핸', '국)플핸'):
                sty.map(style_ph_share, subset=pd.IndexSlice[:, [c]])
    except Exception:
        pass

    # ════════════════════════════════════════════════════════════
    # 💡 [업데이트 내용] V1.0 hotfix: 숫자 표기 포맷
    #   - HS/AS/No/TM = 정수 (2.000000 → 2)
    #   - 배당(KW~KHL, FW~FHL) = 소수점 2자리 (1.180000 → 1.18)
    #   - 핸디기준점(KH/FH) = 부호 포함 1자리 (-1.0 → -1.0 / +1.0)
    #   - 절삭률/ROI = 1자리 / 확률 = 1자리
    #   - 결측(NaN)은 'None' 대신 공란
    # ════════════════════════════════════════════════════════════
    try:
        _fmt = {}
        for c in df_disp.columns:
            _g, _s = c[0], c[1]
            if _g == GRP_MATCH and _s == 'RT':
                # 💡 [V1.0 hotfix] RT는 코드(1~4) 대신 한글 표기 (핸승/핸무/무/역)
                #   예정 경기(NaN)는 공란
                _fmt[c] = rt_to_text
            elif _g == GRP_MATCH and _s in ('HS', 'AS'):
                _fmt[c] = lambda v: '' if pd.isna(v) else f'{int(float(v))}'
            elif _g == GRP_GEN and _s in ('No', 'TM'):
                _fmt[c] = lambda v: '' if pd.isna(v) else f'{int(float(v))}'
            elif _g in (GRP_KODDS, GRP_FODDS):
                if _s in ('KH', 'FH'):
                    _fmt[c] = lambda v: '' if pd.isna(v) else f'{float(v):+.1f}'
                else:
                    _fmt[c] = lambda v: '' if pd.isna(v) else f'{float(v):.2f}'
            elif _g in (GRP_CUT, GRP_ROI):
                _fmt[c] = lambda v: '' if pd.isna(v) else f'{float(v):.1f}'
            elif _g == GRP_PH:
                if _s == 'PICK':
                    _fmt[c] = lambda v: '' if (v is None or (isinstance(v, float) and pd.isna(v))) else str(v)
                else:
                    # 해)플핸 / 국)플핸 / 실측 / 비중 = % 표기
                    _fmt[c] = lambda v: '' if pd.isna(v) else f'{float(v):.0f}%'
            elif _s in SUB4:
                # 4칸 표본 카운트 = 정수
                _fmt[c] = lambda v: '' if pd.isna(v) else f'{int(float(v))}'
        if _fmt:
            sty.format(_fmt, na_rep='')
    except Exception:
        pass

    return sty


# ============================================================================================
# --- 4. 메인 실행부 ---
# 💡 [업데이트 내용] V1.0: 스코프 바 렌더 + 스코프별 DB 라우팅 + 탭 인덱스 하드코딩 제거
# ============================================================================================
st.title("⚽ WEB_BET PRO V1.0")

# 💡 [V1.0 New] 데이터 영역(스코프) 선택 - 공식 / 내 데이터
SCOPE = UI.render_scope_bar()
CAN_WRITE = UI.can_write_here()

st.markdown("---")


# 💡 [V1.0] 스코프별 통합DB 캐시 로드
#   캐시 키에 (db_path, mtime)을 넣어 master 갱신 시 전 고객 캐시가 자동 무효화된다.
@st.cache_data(show_spinner=False)
def load_total_db(_cache_key):
    """현재 스코프 DB의 6대 리그 전체를 합쳐 통합DB 반환."""
    db_path, _mtime = _cache_key
    if not os.path.exists(db_path):
        return pd.DataFrame()
    frames = []
    conn = sqlite3.connect(db_path)
    try:
        tabs = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        for lg in LEAGUES:
            if lg not in tabs:
                continue
            try:
                d = pd.read_sql(f'SELECT * FROM "{lg}"', conn)
                if len(d) > 0:
                    d['Source_League'] = lg
                    frames.append(d)
            except Exception:
                continue
    finally:
        conn.close()
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


@st.cache_data(show_spinner=False)
def load_league_db(_cache_key, league):
    """현재 스코프 DB에서 단일 리그 로드."""
    db_path, _mtime = _cache_key
    if not os.path.exists(db_path):
        return pd.DataFrame()
    conn = sqlite3.connect(db_path)
    try:
        tabs = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if league not in tabs:
            return pd.DataFrame()
        return pd.read_sql(f'SELECT * FROM "{league}"', conn)
    except Exception:
        return pd.DataFrame()
    finally:
        conn.close()


CUR_DB = DB()
CACHE_KEY = (CUR_DB, PATHS.db_mtime(CUR_DB))
TOTAL_DB = load_total_db(CACHE_KEY)


# ════════════════════════════════════════════════════════════
# 💡 [신규] '통합 및 예측 분석' 버튼 - RT 없는 예정 경기만 선택 재계산
# --------------------------------------------------------------
#  [배경] 리그를 하나씩 업로드하면, 통합(TF-/TK-) 지표는 "그 순간까지의"
#         통합DB 기준으로 계산된다. 예를 들어 EPL을 올린 뒤 라리가를 올리면
#         EPL의 통합지표는 라리가 신규 데이터를 반영하지 못한 채로 남는다.
#  [원칙] 결과(RT)가 있는 과거 경기는 이미 끝난 경기라 다시 계산할 필요가
#         없으므로 절대 건드리지 않는다. RT가 없는 예정 경기(실제 베팅
#         대상)만, 이 버튼을 누른 시점의 최신 통합DB 기준으로 26개 지표와
#         18/19/20번 예측을 다시 계산해 그 경기들만 갱신한다.
#  [자동화 안 함] 업로드할 때마다 자동으로 전체를 재계산하면 리그가 늘어날
#         수록 느려지므로, 사용자가 오늘 올릴 데이터를 다 올린 뒤 이 버튼을
#         한 번 눌러줄 때만 실행되는 수동(온디맨드) 방식으로 둔다.
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
        for lg in LEAGUES:
            if lg not in tabs:
                continue
            d = pd.read_sql(f'SELECT * FROM "{lg}"', conn)
            if len(d) > 0:
                d['Source_League'] = lg
                frames.append(d)
        total_df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

        summary = {}
        for lg in LEAGUES:
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
            #    💡 [V2.3] 플핸 예측(PH_F/PH_K/PH_PICK/PH_HIT/PH_DOM)은
            #    analyze_row() 안의 compute_plushandi()에서 지표와 함께
            #    계산되므로, 지표 재계산 한 번으로 플핸 예측도 같이 갱신된다.
            #    (예전 ProgramPredictor18 재계산 단계는 완전 삭제)
            new_ind = _recompute_indicators_for_subset(sub, league_df, total_df)
            for c in new_ind.columns:
                if c not in league_df.columns:
                    league_df[c] = np.nan
                league_df.loc[new_ind.index, c] = new_ind[c].values

            league_df.to_sql(lg, conn, if_exists='replace', index=False)
    finally:
        conn.close()

    PATHS.stamp_updated(db_path)
    st.cache_data.clear()   # load_total_db/load_league_db 캐시 무효화 - 갱신값 즉시 반영
    return summary


def recompute_pending_matches(db_path):
    """RT 없는 예정 경기만 골라 최신 통합DB 기준으로 26지표+예측을 재계산해 저장.
    RT 있는 과거 경기는 전혀 수정하지 않는다. (일상적으로 자주 쓰는 빠른 버전)
    반환: {리그코드: 갱신건수} 딕셔너리."""
    return _recompute_by_mask(db_path, include_historical=False)


# ════════════════════════════════════════════════════════════
# 💡 [신규] '전체 재계산(과거 경기 포함)' - 초기 세팅/오류 수정용
# --------------------------------------------------------------
#  [배경] 처음 시스템을 세팅할 때 과거(RT있는) 데이터만 리그별로 하나씩
#         올리면, 먼저 올린 리그의 통합(TF-/TK-) 지표는 그 순간까지 올라온
#         리그만 반영된 채로 저장된다. recompute_pending_matches는 RT있는
#         과거 경기를 일부러 건드리지 않으므로, 나중에 다른 리그를 다 올려도
#         먼저 올린 리그의 과거 경기 통합지표는 영원히 그 상태로 남는다.
#  [용도] 6개 리그를 전부 올린 직후 딱 한 번, 또는 데이터를 대대적으로
#         정정한 뒤에 한 번씩만 눌러주는 무거운 작업. 과거 경기까지 전부
#         다시 계산하므로 경기 수가 많으면 수 분 이상 걸릴 수 있다.
# ════════════════════════════════════════════════════════════
def recompute_all_matches(db_path):
    """RT 유무와 무관하게 전체 경기를 최신 통합DB 기준으로 26지표+예측 재계산.
    반환: {리그코드: 갱신건수} 딕셔너리."""
    return _recompute_by_mask(db_path, include_historical=True)


# ════════════════════════════════════════════════════════════
# 💡 [업데이트 내용] V1.0: 탭 구성 - 인덱스 하드코딩 제거
#   기존: tabs[0]~tabs[8] 처럼 정수 인덱스로 접근 → 탭 추가 시 전부 어긋남
#   변경: TAB 딕셔너리(이름→객체)로 접근. 관리자 탭 유무에 따라 개수가 달라져도 안전.
# ════════════════════════════════════════════════════════════
IS_ADMIN = st.session_state.get('auth_role') == 'admin'

tab_names = [PATHS.LEAGUE_LABEL[lg] for lg in LEAGUES]      # 6대 리그
tab_names += ['📈 통합DB', '🆚 상대전적']
if IS_ADMIN:
    tab_names += ['🛠 마스터관리', '👑 계정관리']

_tab_objs = st.tabs(tab_names, on_change="rerun", key="active_tab_key")
TAB = {name: obj for name, obj in zip(tab_names, _tab_objs)}


# ════════════════════════════════════════════════════════════
# 리그 탭 loop
# ════════════════════════════════════════════════════════════
for _lg in LEAGUES:
    with TAB[PATHS.LEAGUE_LABEL[_lg]]:
        # ════════════════════════════════════════════════════════════
        # 💡 [V2.1 성능개선] 탭 지연 렌더링 (Streamlit 1.5x+ .open 속성 활용)
        #   [문제] st.tabs()는 기본적으로 화면에 안 보이는 탭까지 매 rerun마다
        #     전부 계산한다. 리그 6개 탭이 전부 계산되면 (실측 리그당 약 1초,
        #     6개 약 6초) 로그인 직후·아무 버튼 클릭 시마다 불필요하게 느려짐.
        #   [해결] st.tabs(..., on_change="rerun") 로 바꾸면 각 탭 컨테이너의
        #     .open 속성으로 "지금 보이는 탭인지" 알 수 있다. 보이지 않는
        #     탭은 계산을 통째로 건너뛰어 5/6의 불필요한 작업을 제거한다.
        # ════════════════════════════════════════════════════════════
        if TAB[PATHS.LEAGUE_LABEL[_lg]].open:
            _label = PATHS.LEAGUE_LABEL[_lg]
            df_league = load_league_db(CACHE_KEY, _lg)

            if df_league.empty:
                if SCOPE == PATHS.SCOPE_USER:
                    st.info(f"{_label} 데이터가 없습니다. 아래에서 엑셀을 업로드하세요.")
                else:
                    st.info(f"{_label} 공식 데이터가 아직 없습니다."
                            + ("" if IS_ADMIN else " 관리자에게 문의하세요."))
            else:
                # ════════════════════════════════════════════════════════════
                # 💡 [업데이트 내용] V1.0 New: 조회 필터 (시안 반영)
                #   시즌/라운드 + 국내배당 / 국내플핸배당 / 해외배당 직접 입력
                #   [조회] 버튼을 눌러야 실제 조회. [초기화]로 조건 리셋.
                #   빈 칸은 조건에서 제외. 배당은 ±0.005 오차 허용(부동소수 대비).
                # ════════════════════════════════════════════════════════════
                _seasons = sorted(df_league['S'].dropna().astype(str).unique(), reverse=True) \
                    if 'S' in df_league.columns else []
                # 💡 [수정3] 라운드 숫자 추출 정렬 (문자 정렬 시 9R > 38R 되는 버그 방지)
                def _round_key(v):
                    m = re.search(r'\d+', str(v))
                    return (int(m.group()) if m else 0, str(v))
                _all_rounds = sorted(df_league['R'].dropna().astype(str).unique(),
                                     key=_round_key) \
                    if 'R' in df_league.columns else []

                # ════════════════════════════════════════════════════════════
                # 💡 [수정1] 디폴트 = 최근 시즌 · 최근 라운드
                #   _seasons 는 내림차순이라 [0]이 최신 시즌.
                #   최신 시즌 안에서 최근 라운드([-1])를 기본 선택.
                #   최초 진입(조회 전)에도 이 조건으로 자동 조회되도록 _fq 주입.
                # ════════════════════════════════════════════════════════════
                _fq = f"q_{_lg}"          # 조회 조건 저장 키

                _def_season = _seasons[0] if _seasons else '시즌전체'
                if _def_season != '시즌전체' and 'R' in df_league.columns:
                    _rounds_in_season = sorted(
                        df_league.loc[df_league['S'].astype(str) == _def_season, 'R']
                        .dropna().astype(str).unique(), key=_round_key)
                    _def_round = _rounds_in_season[-1] if _rounds_in_season else '라운드 전체'
                else:
                    _def_round = '라운드 전체'

                # 최초 진입 시 기본 조건 자동 주입 (한 번만)
                if _fq not in st.session_state:
                    st.session_state[_fq] = {
                        'S': _def_season, 'R': _def_round,
                        'KW': '', 'KD': '', 'KL': '',
                        'KHW': '', 'KHD': '', 'KHL': '',
                        'FW': '', 'FD': '', 'FL': '',
                    }

                # ════════════════════════════════════════════════════════════
                # 💡 [수정] 초기화(↺) 버그 수정: 위젯 인스턴스화 "전에" 리셋 처리
                # --------------------------------------------------------------
                #  [문제 발견] 기존 코드는 위젯이 이미 그려진 뒤(버튼 클릭 시점)에
                #    st.session_state[위젯키] = "" 로 직접 값을 지웠는데, Streamlit은
                #    "이미 그려진 위젯의 세션값은 그 이후에 직접 수정할 수 없다"는
                #    규칙이 있어 실제로 클릭하면 앱이 죽는 잠재 버그였다
                #    (StreamlitAPIException: cannot be modified after ... instantiated).
                #  [해결] 리셋을 "예약 플래그"로 처리. 초기화 버튼을 누르면 플래그만
                #    세우고 rerun → 다음 실행에서 위젯을 그리기 "전" 이 블록에서
                #    세션값을 지운 뒤 위젯을 그린다. 이러면 에러 없이 정상 작동.
                # ════════════════════════════════════════════════════════════
                _reset_flag_key = f"_do_reset_{_lg}"
                if st.session_state.get(_reset_flag_key):
                    for _k in [f"kw_{_lg}", f"kd_{_lg}", f"kl_{_lg}",
                               f"khw_{_lg}", f"khd_{_lg}", f"khl_{_lg}",
                               f"fw_{_lg}", f"fd_{_lg}", f"fl_{_lg}"]:
                        st.session_state[_k] = ""
                    st.session_state[f"s_{_lg}"] = _def_season
                    st.session_state[f"r_{_lg}"] = _def_round
                    st.session_state[_reset_flag_key] = False

                # selectbox 기본 인덱스 = 최근 시즌/라운드
                # (단, 위젯이 이미 그려진 뒤엔 index보다 session_state 값이 우선 적용됨)
                _s_opts = ['시즌전체'] + _seasons
                _r_opts = ['라운드 전체'] + _all_rounds
                _s_idx = _s_opts.index(_def_season) if _def_season in _s_opts else 0
                _r_idx = _r_opts.index(_def_round) if _def_round in _r_opts else 0

                # ════════════════════════════════════════════════════════════
                # 💡 [수정] 시즌/라운드 선택 + 배당 입력칸을 st.form()으로 묶음
                # --------------------------------------------------------------
                #  [문제] 지금까지는 selectbox를 바꾸거나 배당칸에 글자 하나만
                #    입력해도 그 즉시 전체 스크립트가 다시 실행됐다(Streamlit
                #    위젯의 기본 동작). 정작 이 값들은 [🔍 조회]를 눌러야만
                #    실제로 쓰이는데, 입력하는 동안 계속 불필요한 로딩이 발생.
                #  [해결] st.form() 안에 넣으면 폼 안의 위젯은 값이 바뀌어도
                #    그 자체로는 rerun 되지 않고, [조회]/[초기화] 버튼
                #    (st.form_submit_button)을 눌러야 그 시점의 값들을 한번에
                #    읽어와 rerun 한다.
                # ════════════════════════════════════════════════════════════
                with st.form(key=f"filter_form_{_lg}"):
                    fc1, fc2, fc3, fc4, fc5 = st.columns([2.2, 2.2, 2.2, 2.2, 1.2])
                    with fc1:
                        st.markdown("**시즌 및 라운드 입력**")
                        _c1, _c2 = st.columns(2)
                        with _c1:
                            _sel_s = st.selectbox("시즌", _s_opts, index=_s_idx,
                                                  key=f"s_{_lg}", label_visibility="collapsed")
                        with _c2:
                            _sel_r = st.selectbox("라운드", _r_opts, index=_r_idx,
                                                  key=f"r_{_lg}", label_visibility="collapsed")
                    with fc2:
                        st.markdown("**국내 배당 입력 영역**")
                        _k1, _k2, _k3 = st.columns(3)
                        _kw = _k1.text_input("KW", key=f"kw_{_lg}", placeholder="홈 배당",
                                             label_visibility="collapsed")
                        _kd = _k2.text_input("KD", key=f"kd_{_lg}", placeholder="무 배당",
                                             label_visibility="collapsed")
                        _kl = _k3.text_input("KL", key=f"kl_{_lg}", placeholder="원정 배당",
                                             label_visibility="collapsed")
                    with fc3:
                        st.markdown("**국내 플핸 배당 입력영역**")
                        _p1, _p2, _p3 = st.columns(3)
                        _khw = _p1.text_input("KHW", key=f"khw_{_lg}", placeholder="홈 배당",
                                              label_visibility="collapsed")
                        _khd = _p2.text_input("KHD", key=f"khd_{_lg}", placeholder="무 배당",
                                              label_visibility="collapsed")
                        _khl = _p3.text_input("KHL", key=f"khl_{_lg}", placeholder="원정 배당",
                                              label_visibility="collapsed")
                    with fc4:
                        st.markdown("**해외 배당 입력영역**")
                        _f1, _f2, _f3 = st.columns(3)
                        _fw = _f1.text_input("FW", key=f"fw_{_lg}", placeholder="홈 배당",
                                             label_visibility="collapsed")
                        _fd = _f2.text_input("FD", key=f"fd_{_lg}", placeholder="무 배당",
                                             label_visibility="collapsed")
                        _fl = _f3.text_input("FL", key=f"fl_{_lg}", placeholder="원정 배당",
                                             label_visibility="collapsed")
                    with fc5:
                        st.markdown("&nbsp;", unsafe_allow_html=True)
                        _b1, _b2 = st.columns(2)
                        # 💡 [수정] st.button → st.form_submit_button (폼 안에서는 이것만 사용 가능)
                        _reset_clicked = _b1.form_submit_button(
                            "↺", help="조건 초기화", use_container_width=True)
                        _go_clicked = _b2.form_submit_button(
                            "🔍 조회", type="primary", use_container_width=True)

                # ── 폼 제출 처리 (폼 밖에서) ──
                if _reset_clicked:
                    st.session_state[_reset_flag_key] = True   # 다음 실행에서 위젯 그리기 전 리셋
                    st.session_state[_fq] = {
                        'S': _def_season, 'R': _def_round,
                        'KW': '', 'KD': '', 'KL': '',
                        'KHW': '', 'KHD': '', 'KHL': '',
                        'FW': '', 'FD': '', 'FL': '',
                    }
                    st.rerun()
                if _go_clicked:
                    st.session_state[_fq] = {
                        'S': _sel_s, 'R': _sel_r,
                        'KW': _kw, 'KD': _kd, 'KL': _kl,
                        'KHW': _khw, 'KHD': _khd, 'KHL': _khl,
                        'FW': _fw, 'FD': _fd, 'FL': _fl,
                    }

                # ── 💡 [V1.0] 조회 버튼을 누른 조건으로만 필터링 ──
                _q = st.session_state.get(_fq)
                df_view = df_league.copy()
                if _q:
                    if _q['S'] != '시즌전체' and 'S' in df_view.columns:
                        df_view = df_view[df_view['S'].astype(str) == _q['S']]
                    if _q['R'] != '라운드 전체' and 'R' in df_view.columns:
                        df_view = df_view[df_view['R'].astype(str) == _q['R']]
                    for _col in ['KW', 'KD', 'KL', 'KHW', 'KHD', 'KHL', 'FW', 'FD', 'FL']:
                        _val = str(_q.get(_col, '')).strip()
                        if not _val or _col not in df_view.columns:
                            continue
                        try:
                            _target = float(_val)
                        except ValueError:
                            st.warning(f"{_col} 배당값이 숫자가 아닙니다: {_val}")
                            continue
                        _series = pd.to_numeric(df_view[_col], errors='coerce')
                        df_view = df_view[(_series - _target).abs() < 0.005]
                    _cond = [f"{k}={v}" for k, v in _q.items()
                             if str(v).strip() and v not in ('시즌전체', '라운드 전체')]
                    st.caption(f"🔍 조회 조건: {' · '.join(_cond) if _cond else '전체'}"
                               f"  →  **{len(df_view):,}경기**")
                else:
                    st.caption(f"{_label} · 전체 {len(df_league):,}경기 "
                               f"(조건 입력 후 [조회]를 누르세요)")

                if not df_view.empty:
                    # ── 💡 [V2.3] 26개 지표와 함께 저장된 값을 그대로 사용 ──
                    df_raw = df_view

                    # 💡 [V1.0 New] 요약 바 + 상단 버튼 (시안 반영)
                    _sa, _sb = st.columns([5, 2.4])
                    with _sa:
                        if 'RT' in df_raw.columns:
                            _rtv = pd.to_numeric(df_raw['RT'], errors='coerce').dropna()
                            _n = len(_rtv)
                            if _n > 0:
                                _s1, _s2, _s3, _s4, _s5 = st.columns([2, 1, 1, 1, 1])
                                _s1.markdown(f"**등록된 경기수 {len(df_raw):,}**")
                                for _c, _code, _nm, _clr in [
                                        (_s2, 1, '핸승', '#1565C0'), (_s3, 2, '핸무', '#64B5F6'),
                                        (_s4, 3, '무', '#757575'), (_s5, 4, '역', '#C62828')]:
                                    _cnt = int((_rtv == _code).sum())
                                    _c.markdown(
                                        f"<span style='color:{_clr};font-weight:bold;'>{_nm}</span> "
                                        f"{_cnt:,} <span style='background:#2E7D32;color:white;"
                                        f"padding:1px 6px;border-radius:8px;font-size:11px;'>"
                                        f"{_cnt / _n * 100:.1f}%</span>",
                                        unsafe_allow_html=True)
                            else:
                                st.markdown(f"**등록된 경기수 {len(df_raw):,}** "
                                            f"<span style='color:#90A4AE;'>(결과 미확정)</span>",
                                            unsafe_allow_html=True)
                    with _sb:
                        _t1, _t2 = st.columns(2)
                        # 💡 [시안] 표 위에 '상세보기 생성' / '엑셀 다운로드' 배치
                        _detail_click = _t1.button("📄 선택한 경기 상세보기 생성",
                                                   key=f"detail_{_lg}",
                                                   use_container_width=True)
                        # 엑셀 = 현재 조회된 표 그대로 다운로드
                        _t2.download_button("📥 엑셀 다운로드", to_excel_display(df_raw),
                                            f"{_label}_조회결과.xlsx",
                                            key=f"dl_{_lg}", use_container_width=True)

                    # ── 표시용 ──
                    df_show = df_raw.copy()

                    # ════════════════════════════════════════════════════════════
                    # 💡 [수정] 포터블 버전과 동일한 2줄 헤더 방식으로 복귀
                    #  · st.dataframe + 멀티인덱스 → 위=그룹명 / 아래=핸승·핸무·무·역
                    #  · 색상·RT텍스트·숫자포맷 모두 Styler 로 유지
                    #  · 선택: 행 클릭(on_select) → [생성] 버튼으로 상세 열기
                    # ════════════════════════════════════════════════════════════
                    # 💡 [정정] on_select="ignore"는 선택 자체가 안 되는 것으로 확인됨
                    # --------------------------------------------------------------
                    #  [지난 시도] "선택은 즉시 반영, 서버 재계산은 안 함"을 노려
                    #         on_select="ignore" 로 바꿨었는데, Streamlit 공식 문서
                    #         확인 결과 ignore는 "선택 이벤트를 무시"하는 게 아니라
                    #         "위젯이 아예 선택 가능한 입력처럼 동작하지 않음"을
                    #         의미했다. 즉 체크박스/선택 UI 자체가 사라져 버렸다
                    #         (화면 캡처로 확인: 체크박스 없이 행 번호만 보임).
                    #  [재수정] on_select="rerun" 으로 복귀 - 선택 시 rerun은
                    #         발생하지만, 앞서 적용한 "탭 지연 렌더링"과 "예측
                    #         재계산 제거" 덕분에 이제 rerun 자체가 훨씬 가벼워져
                    #         (보이는 탭 1개만 계산) 체감 속도는 개선된 상태.
                    #  · [생성] 눌러야 상세 열림 / 선택 시 [해제] 버튼 노출은 그대로 유지
                    # ════════════════════════════════════════════════════════════
                    # ════════════════════════════════════════════════════════════
                    # 💡 [수정] [해제] 버튼을 눌러도 체크박스가 그대로 남는 문제
                    # --------------------------------------------------------------
                    #  [문제] session_state.pop(_sel_key) 로 선택값 자체는 정상적으로
                    #         비워지지만(파이썬 쪽 값은 확인됨), 화면에 실제로 그려지는
                    #         체크박스는 같은 위젯 key를 계속 재사용하다 보니 시각적으로
                    #         갱신되지 않고 체크된 채로 남는 경우가 있었다.
                    #  [해결] "리셋 카운터"를 두어, [해제]를 누를 때마다 카운터를 올리고
                    #         그 값을 테이블의 key에 포함시킨다. 그러면 Streamlit이
                    #         완전히 새로운 위젯으로 인식해 처음부터 다시 그리므로
                    #         체크박스도 확실히 초기화된 상태로 나타난다.
                    # ════════════════════════════════════════════════════════════
                    _reset_ctr_key = f"tbl_reset_ctr_{_lg}"
                    if _reset_ctr_key not in st.session_state:
                        st.session_state[_reset_ctr_key] = 0
                    _sel_key = f"tbl_{_lg}_{st.session_state[_reset_ctr_key]}"
                    _pick_state = f"picked_{_lg}"   # 확정된 선택 위치

                    _ev = None
                    try:
                        df_disp = apply_multi_index(df_show)
                        sty = build_styler(df_disp, df_show)
                        _ev = st.dataframe(sty, use_container_width=True, height=560,
                                           on_select="rerun", selection_mode="single-row",
                                           key=_sel_key)
                    except Exception as _e:
                        _ev = st.dataframe(df_show, use_container_width=True, height=560,
                                           on_select="rerun", selection_mode="single-row",
                                           key=_sel_key)
                        st.caption(f"(스타일 렌더 생략: {_e})")

                    # 현재 클릭된 행
                    _rows_sel = []
                    try:
                        _rows_sel = _ev.selection.rows if _ev is not None else []
                    except Exception:
                        _rows_sel = []

                    # ── 💡 [수정5] 선택되면 [해제] 버튼 노출 ──
                    if _rows_sel:
                        _rc1, _rc2 = st.columns([2, 6])
                        with _rc1:
                            if st.button("✖ 선택된 경기 해제", key=f"clr_{_lg}",
                                         use_container_width=True):
                                st.session_state.pop(_pick_state, None)
                                # 💡 위젯 key를 새로 바꿔 체크박스를 강제 초기화
                                st.session_state[_reset_ctr_key] += 1
                                st.rerun()
                        with _rc2:
                            _p = _rows_sel[0]
                            if 0 <= _p < len(df_show):
                                _r = df_show.iloc[_p]
                                st.caption(f"✅ 선택됨: {_r.get('S','')} {_r.get('R','')} · "
                                           f"{_r.get('HT','')} vs {_r.get('AT','')}  →  "
                                           f"[선택한 경기 상세보기 생성]을 누르세요.")

                    # ── 💡 [수정4] '생성' 버튼을 눌러야 상세가 열림 ──
                    if _detail_click:
                        if _rows_sel:
                            st.session_state[_pick_state] = _rows_sel[0]
                        else:
                            st.warning("표에서 경기 행을 먼저 클릭한 뒤 눌러주세요.")

                    # 확정된 선택이 있고, 그 행이 아직 선택된 상태면 상세 표시
                    _picked = st.session_state.get(_pick_state)
                    if _picked is not None and _picked in _rows_sel:
                        if 0 <= _picked < len(df_show):
                            _match = df_show.iloc[_picked]

                            @st.dialog("📋 상세 경기 정보", width="large")
                            def _show_detail(_m=_match):
                                UI.render_match_detail(_m, TOTAL_DB)

                            _show_detail()
                    elif not _rows_sel:
                        st.caption("💡 표에서 경기 행을 클릭하고 "
                                   "[📄 선택한 경기 상세보기 생성]을 누르면 상세 정보가 열립니다.")

            # ════════════════════════════════════════════════════════════
            # 💡 [업데이트 내용] V1.0: 업로드/삭제 UI는 쓰기 권한이 있을 때만 렌더
            #   공식 스코프 + 일반 고객 → 업로드 UI 자체가 보이지 않음 (열람 전용)
            # ════════════════════════════════════════════════════════════
            st.markdown("---")
            if not CAN_WRITE:
                st.caption("🔒 공식 데이터는 열람 전용입니다. "
                           "본인 데이터를 분석하려면 상단에서 **👤 내 데이터** 를 선택하세요.")
            else:
                with st.expander(f"📤 {_label} 새 경기 업로드"):
                    _up = st.file_uploader("엑셀 파일", type=['xlsx', 'xls'],
                                           key=f"up_{_lg}")
                    if _up is not None:
                        try:
                            _tmp = pd.read_excel(_up, header=None, nrows=10)
                            _hr = find_header_row(_tmp)
                            _new = pd.read_excel(_up, header=_hr)
                            _new = preprocess_data(_new)
                            st.write(f"읽어온 유효 경기: **{len(_new):,}건**")
                            st.dataframe(_new.head(20), use_container_width=True)

                            if st.button("💾 저장", type="primary", key=f"save_{_lg}"):
                                # 💡 [V1.0] 공식 스코프 저장 시 자동 백업 (롤백 가능)
                                if SCOPE == PATHS.SCOPE_MASTER:
                                    PATHS.backup_master()

                                _old = load_league_db(CACHE_KEY, _lg)
                                if not _old.empty:
                                    _merged = pd.concat([_old, _new], ignore_index=True)
                                else:
                                    _merged = _new

                                # 💡 [v7.0 hotfix] 중복 제거 키에서 DT 제외
                                #   DT는 70~87% 결측 → 키에 넣으면 정상 경기가 대량 오삭제됨
                                _key = [c for c in ['L', 'S', 'R', 'No', 'HT', 'AT']
                                        if c in _merged.columns]
                                if _key:
                                    _before = len(_merged)
                                    _merged = _merged.drop_duplicates(subset=_key, keep='last')
                                    _dup = _before - len(_merged)
                                else:
                                    _dup = 0

                                # 분석 산출 (엔진 무수정)
                                with st.spinner("분석 산출 중... (경기 수에 따라 수 분 소요)"):
                                    _tot_new = load_total_db(CACHE_KEY)
                                    if _tot_new.empty:
                                        _tot_new = _merged
                                    _res = analyze_dataframe(_merged, _tot_new)
                                    _final = pd.concat(
                                        [_merged.reset_index(drop=True),
                                         _res.reset_index(drop=True)], axis=1)
                                    # 💡 [V2.3] 26개 지표 산출 시 플핸 예측(PH_*)도 함께
                                    #   analyze_row()의 compute_plushandi()에서 자동 계산됨.
                                    #   (예전 ProgramPredictor18 예측 계산 단계는 완전 삭제)

                                _conn = sqlite3.connect(DB())
                                try:
                                    _final.to_sql(_lg, _conn, if_exists='replace', index=False)
                                finally:
                                    _conn.close()

                                PATHS.stamp_updated(DB())
                                st.cache_data.clear()
                                st.success(
                                    f"저장 완료: {len(_final):,}건 "
                                    f"(중복 제거 {_dup:,})")
                                st.rerun()
                        except Exception as _e:
                            st.error(f"업로드 실패: {_e}")


# ════════════════════════════════════════════════════════════
# 📈 통합DB 탭
# 💡 [V1.0] 통합DB는 현재 스코프 내부에서만 합산 (공식/개인 완전 격리)
# ════════════════════════════════════════════════════════════
with TAB['📈 통합DB']:
    # 💡 [V2.1 성능개선] 지연 렌더링 - 이 탭이 열려있을 때만 계산
    if TAB['📈 통합DB'].open:
        st.header("📈 통합DB (6대 리그 합산)")

        UI.render_dashboard(CUR_DB, SCOPE)

        # ════════════════════════════════════════════════════════════
        # 💡 [신규] 통합 및 예측 분석 버튼 - 공식/내 데이터 스코프 공통
        #   쓰기 권한이 있는 경우에만 노출 (공식=관리자, 내 데이터=본인 항상)
        #   RT 없는 예정 경기만 최신 통합DB 기준으로 재계산. 과거 경기는 무수정.
        # ════════════════════════════════════════════════════════════
        if CAN_WRITE:
            st.markdown("---")
            st.subheader("🔄 통합 및 예측 분석")
            st.caption("결과(RT)가 없는 **예정 경기만** 골라, 지금까지 올린 모든 리그를 합친 "
                       "최신 통합 데이터 기준으로 26개 지표와 예측을 다시 계산합니다. "
                       "이미 끝난 경기(결과 있음)는 전혀 건드리지 않습니다. "
                       "여러 리그를 오늘 나눠서 올렸다면, 다 올린 뒤 마지막에 한 번 눌러주세요.")
            if st.button("🔄 통합 및 예측 분석 실행", key="btn_recompute_pending", type="primary"):
                with st.spinner("예정 경기 재분석 중... (경기 수에 따라 다소 시간이 걸립니다)"):
                    _summary = recompute_pending_matches(CUR_DB)
                _lines = [f"{PATHS.LEAGUE_LABEL[lg]} {n}건"
                          for lg, n in _summary.items() if n > 0]
                if _lines:
                    st.success("재분석 완료 → " + " · ".join(_lines))
                else:
                    st.info("재분석 대상(결과 없는 예정 경기)이 없습니다.")
                st.rerun()

            # ════════════════════════════════════════════════════════════
            # 💡 [신규] 전체 재계산(과거 경기 포함) - 초기 세팅/오류 수정용 별도 버튼
            #   위 버튼과 달리 RT 있는 과거 경기까지 전부 다시 계산한다.
            #   경기 수가 많으면 시간이 오래 걸리므로 확인 체크박스로 보호.
            # ════════════════════════════════════════════════════════════
            st.markdown("")
            with st.expander("🔧 전체 재계산 (과거 경기 포함 · 초기 세팅용)"):
                st.caption(
                    "리그를 하나씩 순서대로 올릴 때, 먼저 올린 리그의 **과거 경기** 통합지표는 "
                    "그 시점까지 올라온 리그만 반영된 채로 남습니다. 6개 리그를 처음 다 올렸거나 "
                    "데이터를 대대적으로 정정한 직후, **딱 한 번** 눌러 전체를 최신 기준으로 맞추세요. "
                    "과거 경기까지 전부 다시 계산하므로 경기 수가 많으면 수 분 이상 걸릴 수 있습니다.")
                _full_ok = st.checkbox(
                    "과거 경기를 포함해 전체를 다시 계산합니다 (시간이 걸릴 수 있음)",
                    key="chk_recompute_all")
                if st.button("🔧 전체 재계산 실행", key="btn_recompute_all"):
                    if not _full_ok:
                        st.warning("위 확인 체크박스를 선택한 뒤 눌러주세요.")
                    else:
                        with st.spinner("전체 경기 재계산 중... (경기 수에 따라 수 분 이상 소요될 수 있습니다)"):
                            _summary_all = recompute_all_matches(CUR_DB)
                        _lines_all = [f"{PATHS.LEAGUE_LABEL[lg]} {n}건"
                                      for lg, n in _summary_all.items() if n > 0]
                        if _lines_all:
                            st.success("전체 재계산 완료 → " + " · ".join(_lines_all))
                        else:
                            st.info("재계산할 데이터가 없습니다.")
                        st.rerun()

        if TOTAL_DB.empty:
            st.info("통합할 데이터가 없습니다.")
        else:
            st.markdown("---")
            tc1, tc2, tc3 = st.columns([2, 2, 3])
            with tc1:
                _tl = st.selectbox("리그", ['전체'] + [PATHS.LEAGUE_LABEL[l] for l in LEAGUES],
                                   key="tot_lg")
            _tv = TOTAL_DB.copy()
            if _tl != '전체':
                _code = [k for k, v in PATHS.LEAGUE_LABEL.items() if v == _tl][0]
                _tv = _tv[_tv['Source_League'] == _code]
            with tc2:
                _ts_list = sorted(_tv['S'].dropna().astype(str).unique(), reverse=True) \
                    if 'S' in _tv.columns else []
                _ts = st.selectbox("시즌", ['전체'] + _ts_list, key="tot_s")
            if _ts != '전체' and 'S' in _tv.columns:
                _tv = _tv[_tv['S'].astype(str) == _ts]
            with tc3:
                st.caption(f"{len(_tv):,} / {len(TOTAL_DB):,} 경기")

            # ── 결과 분포 요약 ──
            if 'RT' in _tv.columns:
                _rt = pd.to_numeric(_tv['RT'], errors='coerce').dropna()
                if len(_rt) > 0:
                    m1, m2, m3, m4 = st.columns(4)
                    for _col, _code_v, _name in [
                            (m1, 1, '핸승'), (m2, 2, '핸무'), (m3, 3, '무'), (m4, 4, '역')]:
                        _n = int((_rt == _code_v).sum())
                        _col.metric(_name, f"{_n:,}", f"{_n / len(_rt) * 100:.1f}%")

            st.dataframe(_tv.head(2000), use_container_width=True, height=500)
            st.download_button("📥 통합DB 엑셀", to_excel(_tv),
                               f"통합DB_{_tl}_{_ts}.xlsx", key="dl_total")


# ════════════════════════════════════════════════════════════
# 🆚 상대전적 탭 (원본 양날개 W/D/L 렌더링 로직 보존)
# ════════════════════════════════════════════════════════════
with TAB['🆚 상대전적']:
    # 💡 [V2.1 성능개선] 지연 렌더링 - 이 탭이 열려있을 때만 계산
    if TAB['🆚 상대전적'].open:
        st.header("🆚 상대전적")

        if TOTAL_DB.empty:
            st.info("데이터가 없습니다.")
        else:
            _teams = sorted(set(TOTAL_DB['HT'].dropna().astype(str).unique())
                            | set(TOTAL_DB['AT'].dropna().astype(str).unique()))
            hc1, hc2 = st.columns(2)
            with hc1:
                _t1 = st.selectbox("팀 A", _teams, key="h2h_1")
            with hc2:
                _t2 = st.selectbox("팀 B", _teams,
                                   index=min(1, len(_teams) - 1), key="h2h_2")

            if _t1 and _t2 and _t1 != _t2:
                _m = TOTAL_DB[
                    ((TOTAL_DB['HT'].astype(str) == _t1) & (TOTAL_DB['AT'].astype(str) == _t2)) |
                    ((TOTAL_DB['HT'].astype(str) == _t2) & (TOTAL_DB['AT'].astype(str) == _t1))
                ].copy()

                if _m.empty:
                    st.info(f"{_t1} vs {_t2} 맞대결 기록이 없습니다.")
                else:
                    # ── 💡 [원본 보존] 양날개 W/D/L 집계 ──
                    _w1 = _w2 = _d = 0
                    for _, _r in _m.iterrows():
                        try:
                            _hs = float(_r.get('HS')); _as = float(_r.get('AS'))
                        except (TypeError, ValueError):
                            continue
                        if pd.isna(_hs) or pd.isna(_as):
                            continue
                        _home = str(_r.get('HT', ''))
                        if _hs > _as:
                            _winner = _home
                        elif _hs < _as:
                            _winner = str(_r.get('AT', ''))
                        else:
                            _d += 1
                            continue
                        if _winner == _t1:
                            _w1 += 1
                        elif _winner == _t2:
                            _w2 += 1

                    wc1, wc2, wc3 = st.columns(3)
                    wc1.metric(f"🔵 {_t1} 승", f"{_w1}")
                    wc2.metric("⚪ 무", f"{_d}")
                    wc3.metric(f"🔴 {_t2} 승", f"{_w2}")

                    st.caption(f"총 {len(_m):,} 경기")
                    _cols = [c for c in ['Source_League', 'S', 'R', 'DT',
                                         'HT', 'HS', 'AS', 'AT', 'RT',
                                         'FW', 'FD', 'FL', 'FH']
                             if c in _m.columns]
                    _md = _m[_cols].copy() if _cols else _m
                    if 'RT' in _md.columns:
                        _md['RT'] = _md['RT'].map(rt_to_text)
                    st.dataframe(_md, use_container_width=True, height=420)
            elif _t1 == _t2:
                st.caption("서로 다른 두 팀을 선택하세요.")


# ════════════════════════════════════════════════════════════
# 🛠 마스터관리 탭 (관리자 전용) - 💡 [V1.0 New]
# ════════════════════════════════════════════════════════════
if IS_ADMIN:
    with TAB['🛠 마스터관리']:
        UI.render_master_admin_tab()


# ════════════════════════════════════════════════════════════
# 👑 계정관리 탭 (관리자 전용)
# 💡 [V1.0] add_user 성공 시 on_account_created / delete_user 성공 시 on_account_deleted 훅 추가
# ════════════════════════════════════════════════════════════
if IS_ADMIN:
    with TAB['👑 계정관리']:
        st.header("👑 계정 관리")

        _users = AUTH.list_users(AUTH_DB)
        st.dataframe(pd.DataFrame(_users) if _users else pd.DataFrame(),
                     use_container_width=True, hide_index=True)

        st.markdown("---")
        st.subheader("➕ 계정 추가")
        ac1, ac2, ac3, ac4 = st.columns([2, 2, 2, 1])
        with ac1:
            _nid = st.text_input("아이디", key="acc_id")
        with ac2:
            _npw = st.text_input("비밀번호", type="password", key="acc_pw")
        with ac3:
            _nex = st.text_input("만료일 (YYYY-MM-DD 또는 permanent)",
                                 value="permanent", key="acc_ex")
        with ac4:
            _nrole = st.selectbox("역할", ['user', 'admin'], key="acc_role")

        st.caption("ℹ️ 아이디는 개인 데이터 폴더명으로 사용됩니다. "
                   "영문/숫자/언더스코어/하이픈 3~32자만 가능합니다.")

        if st.button("계정 생성", type="primary", key="acc_add"):
            # 💡 [V1.0] 폴더명 안전성 사전 검증 (경로 탈출 차단)
            if not PATHS.is_valid_username(_nid.strip()):
                st.error("아이디 형식 오류: 영문/숫자/_/- 3~32자만 사용 가능합니다.")
            else:
                _ok, _msg = AUTH.add_user(AUTH_DB, _nid, _npw, _nex, _nrole)
                if _ok:
                    # 💡 [V1.0 New] 개인 데이터 공간 초기화 훅
                    try:
                        PATHS.on_account_created(_nid.strip())
                    except Exception as _e:
                        st.warning(f"계정은 생성됐으나 데이터 공간 생성 실패: {_e}")
                    st.success(_msg)
                    st.rerun()
                else:
                    st.error(_msg)

        st.markdown("---")
        st.subheader("🔧 계정 수정")
        _unames = [u['username'] for u in _users] if _users else []
        if _unames:
            ec1, ec2, ec3 = st.columns([2, 2, 2])
            with ec1:
                _tu = st.selectbox("대상 계정", _unames, key="acc_tgt")
            with ec2:
                _tex = st.text_input("새 만료일", value="permanent", key="acc_newex")
                if st.button("기간 변경", key="acc_exbtn"):
                    _ok, _msg = AUTH.update_expiry(AUTH_DB, _tu, _tex)
                    (st.success if _ok else st.error)(_msg)
                    if _ok:
                        st.rerun()
            with ec3:
                _tpw = st.text_input("새 비밀번호", type="password", key="acc_newpw")
                if st.button("비밀번호 변경", key="acc_pwbtn"):
                    _ok, _msg = AUTH.change_password(AUTH_DB, _tu, _tpw)
                    (st.success if _ok else st.error)(_msg)

            st.markdown("##### 🗑️ 계정 삭제")
            dl1, dl2 = st.columns([3, 1])
            with dl1:
                _dok = st.checkbox(
                    f"'{_tu}' 계정과 **개인 데이터 전체**를 삭제합니다 (되돌릴 수 없음)",
                    key="acc_delok")
            with dl2:
                if st.button("❌ 삭제", key="acc_delbtn"):
                    if not _dok:
                        st.warning("확인 체크박스를 선택하세요.")
                    elif _tu == st.session_state.get('auth_user'):
                        st.error("현재 로그인한 본인 계정은 삭제할 수 없습니다.")
                    else:
                        _ok, _msg = AUTH.delete_user(AUTH_DB, _tu)
                        if _ok:
                            # 💡 [V1.0 New] 개인 폴더 삭제 훅 (user.db + predlog.db)
                            try:
                                PATHS.on_account_deleted(_tu)
                            except Exception as _e:
                                st.warning(f"계정은 삭제됐으나 폴더 삭제 실패: {_e}")
                            st.success(_msg)
                            st.rerun()
                        else:
                            st.error(_msg)

        st.markdown("---")
        # 💡 [V1.0 New] 고객 데이터 열람 (C안: 읽기전용 + access_log 기록)
        UI.render_user_data_viewer()
