// 대형 분석표의 2단 헤더 구성 + 서식/색상 규칙.
// WEB_BET_PRO.py의 apply_multi_index()/build_styler()(1422~1554줄)를 그대로 옮긴 것.
// 산출 로직은 건드리지 않고, "표시 순서·라벨·색상"만 그대로 재현한다.

import { formatDt } from '../../utils/format'

const GEN_COLS = ['L', 'S', 'R', 'No', 'DT', 'TM']
// 그 경기 '직전까지'의 시즌 성적. 백엔드가 조회 시 계산해 붙여준다.
//   HP/AP  = 홈팀/원정팀 순위
//   HTF/ATF = 홈팀/원정팀의 전체경기 PPG,  HF/AF = 홈팀 홈경기·원정팀 원정경기 PPG
const MATCH_COLS = [
  'HTF', 'HF', 'HP', 'HT', 'HS', 'RT', 'AS', 'AT', 'AP', 'AF', 'ATF',
]
const K_ODDS_COLS = ['KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL']
// FHW/FHD/FHL(해외 핸디승/무/패 배당)은 화면에서 숨긴다 — FHD는 데이터 자체가 거의
// 항상 공란이고(해외 핸디캡 시장엔 '무' 가격이 없음), FHW/FHL도 화면에 굳이 안 보여줘도
// 되는 참고값이라 뺐다. FH(핸디기준점)만 남긴다. 데이터·26개 지표 계산(FW+FHW 조합 등)
// 에는 전혀 영향 없다 — 여기서 빼도 백엔드는 그대로 갖고 있다가 계산에 쓴다.
const F_ODDS_COLS = ['FW', 'FD', 'FL', 'FH']

// 내 예측(별표/실제 벳팅 픽) — 화면에서 직접 클릭·팝업으로 입력하는 칸이라
// formatCell/cellStyle이 아니라 LeagueTable.jsx가 직접 렌더링한다.
// PICK_VERDICT(적중)는 저장되는 값이 아니라 내픽+RT로 그때그때 자동 계산한다
// (computeAutoVerdict 참고). MY_HIT은 '의견'으로 이름을 바꿔 배팅 비중 태그로 쓴다.
// MY_P('P')는 내픽과 별개로 "실제로 딱 찍었는지"만 남기는 참고용 태그(핸승/핸무/무/역)
// — 결과 판정(적중/보험/미적)에는 전혀 반영되지 않는다.
const MYPICK_COLS = [
  ['IMPORTANT', '중요'],
  ['PICK_VERDICT', '적중'],
  ['MY_PICK', '내픽'],
  ['MY_P', 'P'],
  ['MY_HIT', '의견'],
]

// 똥배 — 국내배당 KW/KL이 1.49 이하로 나온 "똥[안전]배당" 경기를 그 라운드 안에서
// 낮은 순으로 똥1, 똥2...로 매긴 값(DDONG), 그 경기가 무/역으로 뒤집힐 확률(DDONG_RISK),
// 실제 결과가 무/역이면 붙는 똥사(DDONGSA).
const DDONG_COLS = [
  ['DDONG', '똥'],
  ['DDONG_RISK', '분석'],
  ['DDONGSA', '똥사'],
]

// 똥사 위험도 등급 경계(%) — api/data_access.py의 _ddong_risk 주석에 실측 근거가 있다.
// 6대리그 실측 똥사율: 안전 17.6% / 보통 27.7% / 주의 32.9% / 위험 39.3%
const DDONG_RISK_CUTS = [22, 30, 37]

// ── 배변(배당변경) 두 줄 보기 ──
// 경기 하나를 위(초기배당)/아래(최종배당) 두 줄로 보여준다. 헤더에는 칸을 새로 만들지
// 않는다 — 아래 목록에 있는 칸만 위아래로 값이 갈리고, 나머지(경기정보 등 값이 하나뿐인
// 칸)는 위아래 셀을 합쳐(rowSpan) 한 번만 그린다.
//
// 국)지·해)지(NH_KI/NH_FI/PL_KI/PL_FI)는 26개 지표에서 나오는 값이라 지표 자체를
// 최종배당 조건으로 다시 계산해야 바뀐다(engine.py를 건드리는 별도 작업, 아직 안 함).
// 그래도 표 모양은 다른 확률 칸과 똑같이 두 줄로 맞추려고 값 없이(null) 등록해 둔다 —
// 아랫줄이 항상 빈칸(—)으로 나올 뿐, 위아래 셀이 합쳐지진 않는다.
// 값은 "아랫줄에 넣을 값을 담고 있는 컬럼". null이면 아랫줄을 빈칸으로 둔다.
export const FINAL_FIELD = {
  // 국내배당 — 와이즈토토 배당변경 이력의 '지금 값'
  KW: 'EKW', KD: 'EKD', KL: 'EKL', KH: 'EKH',
  KHW: 'EKHW', KHD: 'EKHD', KHL: 'EKHL',
  // 해외배당 — 스코어맨 Bet365 '라이브' 배당
  FW: 'EFW', FD: 'EFD', FL: 'EFL', FH: 'EFH',
  FHW: 'EFHW', FHD: 'EFHD', FHL: 'EFHL',
  // 배당에서 바로 나오는 파생값
  DDONG: 'E_DDONG', DDONG_RISK: 'E_DDONG_RISK', DDONGSA: 'E_DDONGSA',
  WIN_RISK: 'E_WIN_RISK', WIN_RISK_F: 'E_WIN_RISK_F',
  NH_KO: 'E_NH_KO', PL_KO: 'E_PL_KO',
  // 아직 최종배당 재계산이 없는 26지표 기반 값 — 아랫줄은 항상 빈칸.
  NH_KI: null, NH_FI: null, PL_KI: null, PL_FI: null,
}

/** 이 칸이 위/아래 두 줄로 갈리는가. (값이 null인 항목도 갈라지므로 in으로 본다) */
export function splitsOnFinal(colKey) {
  return Object.prototype.hasOwnProperty.call(FINAL_FIELD, colKey)
}

// 배변(배당변경)을 표시할 배당 칸. 핸디 부호(KH/FH)는 배당이 아니라 방향이고,
// 똥배·확률 칸은 배당에서 파생된 값이라 여기에 넣지 않는다.
const ODDS_MOVE_COLS = ['KW', 'KD', 'KL', 'KHW', 'KHD', 'KHL',
                        'FW', 'FD', 'FL', 'FHW', 'FHD', 'FHL']

/** 초기 → 최종으로 배당이 움직인 방향. 1=올랐다, -1=내렸다, 0=그대로/값없음.
 *  배당이 내려간 쪽이 "돈이 몰린 쪽"이다. */
export function oddsMoveDir(row, colKey) {
  if (!row || !ODDS_MOVE_COLS.includes(colKey)) return 0
  const a = Number(row[colKey])
  const b = Number(row[FINAL_FIELD[colKey]])
  const blank = (v) => v == null || v === ''
  if (blank(row[colKey]) || blank(row[FINAL_FIELD[colKey]])) return 0
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return 0
  return b > a ? 1 : -1
}

/** 이 칸의 배당이 초기 → 최종으로 실제로 움직였는가. */
export function isOddsMoved(row, colKey) {
  return oddsMoveDir(row, colKey) !== 0
}

/** 이 경기에 최종배당이 있는가(= 두 줄로 보여줄 값이 있는가). */
export function hasFinalOdds(row) {
  return row != null && row.EKW != null && row.EKW !== ''
}

/** 아랫줄(최종배당)용 행 — 갈라지는 칸의 값만 최종배당 값으로 바꿔 끼운다.
 *  셀을 그리는 코드는 row[컬럼명]을 읽으므로, 값만 바꿔 끼우면 같은 코드가 그대로 돈다. */
export function toFinalRow(row) {
  const out = { ...row }
  for (const k in FINAL_FIELD) {
    const src = FINAL_FIELD[k]
    if (src == null) {
      out[k] = null                 // 해외배당 등 — 아랫줄은 빈칸
    } else {
      const v = row[src]
      out[k] = v === undefined ? null : v
    }
  }
  return out
}

// 핸승 위험도 (2026-08 재편) — '무엇이 나올 확률인가'로 묶고, 각 묶음 안에서
// '어디서 나온 값인가'로 나눈다. 예전 7칸(국정값/국플값/해정값/배당·AI/K값/F값/KF·AI)은
// 숫자 방향이 뒤섞여 있었고(일부는 핸승%, 일부는 플핸%), AI 2칸은 부품의 단순 평균이라
// 부품보다 구분력이 낮았다(배당AI -2.7/1000, 지표AI -0.9/1000, 부품과 상관 0.97~0.98).
//
//   정승 확률(RT 1+2)     : 승무패 배당에서만 나온다 — 핸디를 몰라 핸승/핸무를 못 가른다
//   플핸무 확률(RT 2+3+4) : 핸디배당·26지표. 보험 베팅(플핸+핸무)의 성공 확률 그 자체
//   플 확률(RT 3+4)       : 같은 세 출처
//
// ⚠ 한 출처 안에서 '정승'과 '플'은 정확한 여집합이다(실측 상관 -1.0000).
//   그래서 승무패 배당은 정승 묶음에만 넣었다.
// 핸무 칸은 두지 않는다 — '플핸무 − 플'로 나오고, 어느 출처로 보든 23~24%에 붙어
//   있어(폭 5.8~14.3%p) 구분력이 0.49~0.54로 거의 없다.
//
// 이름: 앞글자 = 출처 시장(국=국내/해=해외), 뒷글자 = 재료(플=핸디배당, 정=승무패배당,
//       지=26개 지표). 값은 전부 백엔드가 "그 일이 일어날 확률(%)"로 내려주므로
//       화면에서 100에서 빼는 뒤집기를 하지 않는다.
// 실측 보정 오차는 api/ev_model.py 상단 NEW_RISK_COLS 주석 참고.
const RISK_GROUPS = [
  ['정승 %', '', [
    ['WIN_RISK', '국)정'],
    ['WIN_RISK_F', '해)정'],
  ]],
  ['플핸무 %', '', [
    ['NH_KO', '국)플'],
    ['NH_KI', '국)지'],
    ['NH_FI', '해)지'],
  ]],
  ['플 %', '', [
    ['PL_KO', '국)플'],
    ['PL_KI', '국)지'],
    ['PL_FI', '해)지'],
  ]],
]

// 26개 지표에서 나온 칸(국)지·해)지) — 배당에서 나온 칸과 성격이 달라 헤더에 표시한다.
const RISK_IDX_KEYS = new Set(['NH_KI', 'NH_FI', 'PL_KI', 'PL_FI'])
// 각 묶음에서 배당 기반 칸과 지표 기반 칸이 갈리는 자리(이 칸 뒤에 구분선).
const RISK_DIVIDER_KEYS = new Set(['NH_KO', 'PL_KO'])

// 핸승 위험도 5등급 색. 묶음마다 경계는 다르지만 색은 같은 것을 쓴다(cellStyle 참고).
const RISK_DEEP = { background: '#1B5E20', color: '#fff', fontWeight: 700 }
const RISK_GOOD = { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
const RISK_MID = { background: '#FBC02D', color: '#0D1B2A' }
const RISK_WARN = { background: '#EF6C00', color: '#fff', fontWeight: 700 }
const RISK_BAD = { background: '#C62828', color: '#fff', fontWeight: 700 }

// 26개 지표 그룹: [코드, 그룹제목]. 각 코드는 항상 4칸(핸승/핸무/무/역)으로 펼쳐진다.
const GROUP_DEFS = [
  ['F-W', '1. 해) 승 분석'],
  ['F-L', '2. 해) 패 분석'],
  ['F-WL', '3. 해) 승+패 분석'],
  ['F-WDL', '4. 해) 승+무+패 분석'],
  ['F-W-HW', '5. 해) 승+H핸 분석'],
  ['F-W-HT', '6. 해) 승=홈팀 분석'],
  ['F-L-AT', '7. 해) 패=원정팀 분석'],
  ['F-WL-HT', '8. 해) 승/패=홈팀 분석'],
  ['F-WL-AT', '9. 해) 승/패=원정팀 분석'],
  ['TF-W', '10. 해/통) 승 분석'],
  ['TF-L', '11. 해/통) 패 분석'],
  ['TF-WL', '12. 해/통) 승+패 분석'],
  ['TF-WDL', '13. 해/통) 승+무+패 분석'],
  ['K-W', '14. 국) 승 분석'],
  ['K-L', '15. 국) 패 분석'],
  ['K-WL', '16. 국) 승+패 분석'],
  ['K-WDL', '17. 국) 승+무+패 분석'],
  ['K-W-HW', '18. 국) 승+H핸 분석'],
  ['K-W-HT', '19. 국) 승=홈팀 분석'],
  ['K-L-AT', '20. 국) 패=원정팀 분석'],
  ['K-WL-HT', '21. 국) 승/패=홈팀 분석'],
  ['K-WL-AT', '22. 국) 승/패=원정팀 분석'],
  ['TK-W', '23. 국/통) 승 분석'],
  ['TK-L', '24. 국/통) 패 분석'],
  ['TK-WL', '25. 국/통) 승+패 분석'],
  ['TK-WDL', '26. 국/통) 승+무+패 분석'],
  // 27번만 찾는 기준이 다르다 — 나머지 26개는 "홈 칸/원정 칸"(자리 기준)인데
  // 이건 "정배/언더독"(역할 기준)으로, 플핸측 핸디배당이 같고 플핸측이 같은 편
  // (홈/원정)인 과거 경기만 센다. api/engine.py get_samples_fast의 'K-PL' 참고.
  ['K-PL', '27. 국) 플핸 분석'],
]

const SUB4 = ['핸승', '핸무', '무', '역']

const RT_DISPLAY = { 1: '핸승', 2: '핸무', 3: '무', 4: '역', 5: '취소', 6: '연기' }
const RT_CODE_FROM_TEXT = { 핸승: 1, 핸무: 2, 무: 3, 역: 4, 취소: 5, 연기: 6 }

function isBlank(v) {
  return v === null || v === undefined || v === ''
}

function toNum(v) {
  if (isBlank(v)) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function rtToText(v) {
  if (isBlank(v)) return ''
  const n = toNum(v)
  if (n !== null) return RT_DISPLAY[Math.trunc(n)] || ''
  return String(v)
}

function rtCodeOf(v) {
  if (isBlank(v)) return null
  const n = toNum(v)
  if (n !== null) return Math.trunc(n)
  return RT_CODE_FROM_TEXT[String(v).trim()] ?? null
}

// ── 컬럼 그룹 트리 만들기: 실제로 존재하는(백엔드가 내려준) 컬럼만 순서대로 배치 ──
// hideIndicators: 26개 지표 그룹(1~26번)을 아예 빼고 만든다 — 이번주 픽처럼 여러 리그를
// 한 표에 모아 보여줄 때, 그 표에서 다시 26개 지표까지 볼 일은 없어서 생략용으로 쓴다.
export function buildColumnGroups(availableCols, { hideIndicators = false } = {}) {
  const available = new Set(availableCols)
  const groups = []

  function addFlatGroup(label1, label2, cols) {
    const leaves = cols.filter((c) => available.has(c)).map((c) => ({ key: c, sub: c }))
    if (leaves.length) groups.push({ label1, label2, kind: 'flat', cols: leaves })
  }

  addFlatGroup('일반정보', '시즌 및 라운드 정보', GEN_COLS)
  addFlatGroup('경기정보', '홈팀 vs 원정팀', MATCH_COLS)

  const ddongLeaves = DDONG_COLS.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
  if (ddongLeaves.length) {
    groups.push({ label1: '똥배', label2: '', kind: 'flat', cols: ddongLeaves })
  }

  addFlatGroup('국내배당', '승(W) / 무(D) / 패(L)', K_ODDS_COLS)
  addFlatGroup('해외배당', '승(W) / 무(D) / 패(L)', F_ODDS_COLS)

  // PICK_VERDICT(적중)는 저장된 컬럼이 아니라 내픽+RT로 그때그때 계산하는 값이라
  // 백엔드가 내려준 컬럼 목록엔 절대 없다 — IMPORTANT/MY_PICK/MY_P/MY_HIT 중
  // 하나라도 있으면(=이 표에서 내 예측 기능 자체가 켜져 있으면) 무조건 같이 보여준다.
  const myPickActive = MYPICK_COLS.some(([k]) => k !== 'PICK_VERDICT' && available.has(k))
  if (myPickActive) {
    const myPickLeaves = MYPICK_COLS.map(([k, sub]) => ({ key: k, sub }))
    groups.push({ label1: '내 예측', label2: '', kind: 'mypick', cols: myPickLeaves })
  }

  for (const [label1, label2, cols] of RISK_GROUPS) {
    const leaves = cols.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
    if (leaves.length) groups.push({ label1, label2, kind: 'risk', cols: leaves })
  }

  if (!hideIndicators) {
    for (const [code, title] of GROUP_DEFS) {
      const leaves = SUB4.map((sub, i) => ({ key: `${code} ${i + 1}`, sub })).filter((c) =>
        available.has(c.key)
      )
      if (leaves.length) groups.push({ label1: title, label2: code, kind: 'indicator', cols: leaves })
    }
  }

  return groups
}

// ── 컬럼 폭 고정 ──
// 표마다(요일별로 따로 그려지는 이번주 리스트, 리그 탭 등) table-layout:auto가 그
// 표에 실제로 찍힌 값만 보고 각자 다시 폭을 계산해서, 같은 컬럼인데 표마다 폭이
// 들쑥날쑥해지는 문제가 있었다. 지금 DB에 실제로 있는 값 중 가장 긴 것을 기준으로
// (실측: 팀명 "천안시티FC" 등, api/main.py 응답을 canvas로 측정) 폭을 여기서
// 한 번만 고정해 헤더(th)에 적용한다 — table-layout은 auto 그대로라 이 폭보다
// 더 긴 값이 나오면 그 컬럼만 자연스럽게 넓어지고, 다른 컬럼은 안 흔들린다.
// RT·중요·적중·내픽·P·의견은 이미 RtBadge.css/.cell-badge/.mypick-btn의 min-width로
// 어느 표에서든 항상 같은 폭이 나와서 여기서 따로 안 잡는다.
const COL_WIDTH = {
  L: 64, S: 52, R: 42, No: 34, DT: 98, TM: 46,
  HTF: 44, HF: 44, AF: 44, ATF: 44,
  HP: 34, AP: 34,
  HT: 82, AT: 82,
  HS: 28, AS: 28,
  // 배변 화살표(.odds-arrow, ~11px)가 붙으면 안 붙은 셀보다 내용이 길어져서,
  // table-layout:auto인 표마다(요일별 이번주 리스트 등) 화살표 유무에 따라 이 컬럼
  // 폭이 표마다 미세하게 달라지는 문제가 있었다 — 화살표가 항상 붙어 있다고 치고
  // 폭을 고정한다. 57px까지 좁혀봤더니 두 자리 배당("10.XX" 등)에 화살표까지 붙는
  // 실제 사례에서 다시 표마다 어긋나 59px로 확정했다(실측: 요일별 이번주 리스트
  // 두 표에서 완전히 같은 폭으로 렌더링됨).
  KW: 59, KD: 59, KL: 59, KH: 36, KHW: 59, KHD: 59, KHL: 59,
  FW: 59, FD: 59, FL: 59, FH: 36,
  DDONG: 40, DDONG_RISK: 50, DDONGSA: 40,
  WIN_RISK: 50, WIN_RISK_F: 50,
  NH_KO: 50, NH_KI: 50, NH_FI: 50,
  PL_KO: 50, PL_KI: 50, PL_FI: 50,
}

// 26개 지표 그룹(핸승/핸무/무/역 표본수 칸)은 코드가 26개×4칸=104개라 하나하나
// 안 넣고 kind로 한 번에 잡는다(전부 같은 정수 표본수 형식).
export function columnWidth(group, col) {
  if (group.kind === 'indicator') return 40
  return COL_WIDTH[col.key]
}

// 그룹을 접었을 때 보이는 자리표시 헤더(일반정보 접힘의 리그/R/TM, 다른 그룹 접힘의
// '···')도 펼쳤을 때와 똑같이 폭을 고정한다 — 접었다 펼쳤다 해도 표가 안 흔들리게.
const COLLAPSED_GENERIC_WIDTH = 36
export function collapsedWidth(sub) {
  if (sub === '리그') return COL_WIDTH.L
  if (sub === 'R') return COL_WIDTH.R
  if (sub === 'TM') return COL_WIDTH.TM
  return COLLAPSED_GENERIC_WIDTH
}

// 핸승 위험도 칸에 붙는 추가 클래스. LeagueTable.jsx가 헤더(th)와 셀(td) 양쪽에 쓴다.
//   group-divider — 배당 기반 칸과 지표 기반 칸 사이를 가른다
//   risk-idx      — 26지표에서 나온 칸(국)지·해)지). 배당에서 나온 칸과 성격이 달라
//                   헤더에 옅은 틴트를 깐다(셀은 등급 색이 인라인으로 덮는다).
export function riskColClass(group, col) {
  if (group.kind !== 'risk') return ''
  let cls = ''
  if (RISK_DIVIDER_KEYS.has(col.key)) cls += ' group-divider'
  if (RISK_IDX_KEYS.has(col.key)) cls += ' risk-idx'
  return cls
}

// 그룹을 접기/펼치기 상태(Set)에서 식별하는 키. LeagueTable.jsx와, 그 바깥(조회
// 조건 줄)에서 접기 버튼을 같이 쓰는 LeaguePage.jsx가 함께 쓴다.
export function groupKey(g) {
  return g.label1
}

// 26개 지표 그룹을 해외(F-/TF-)/국내(K-/TK-) 묶음으로 한 번에 접고 펼 수 있게
// 나눈다. LeagueTable.jsx 내부 접기 버튼과 LeaguePage.jsx의 조회 조건 줄
// 접기 버튼이 같은 로직을 쓰도록 여기 하나로 모았다.
export function splitIndicatorBatches(groups) {
  function indicatorBatch(g) {
    if (g.kind !== 'indicator') return null
    const code = g.label2 || ''
    if (code.startsWith('TF-') || code.startsWith('F-')) return 1
    if (code.startsWith('TK-') || code.startsWith('K-')) return 2
    return null
  }
  return {
    batch1Groups: groups.filter((g) => indicatorBatch(g) === 1),
    batch2Groups: groups.filter((g) => indicatorBatch(g) === 2),
  }
}

// 승/패 배당(예: FW/FL) 기준 핸디 부호 추정 — 배당이 더 낮은(유리한) 쪽이 핸디를 준다.
// 결과·핸디 입력 화면(ResultEditModal)의 computeHandicap과 같은 규칙.
// 실제 등록된 핸디 라인(KH/FH)이 아직 없을 때, 표에서 잠정치를 보여주는 용도로만 쓴다.
function inferHandicapSign(w, l) {
  const wn = toNum(w)
  const ln = toNum(l)
  if (wn === null || ln === null) return null
  return wn > ln ? 1 : -1
}

// ── 셀 값 포맷 ──
export function formatCell(group, col, value, row) {
  const g1 = group.label1
  const sub = col.sub

  if (g1 === '똥배' && sub === '분석') {
    const n = toNum(value)
    return n === null ? '' : `${Math.round(n)}%`
  }
  if (g1 === '경기정보' && sub === 'RT') return rtToText(value)
  if (g1 === '경기정보' && (sub === 'HS' || sub === 'AS')) {
    const n = toNum(value)
    return n === null ? '' : String(Math.trunc(n))
  }
  if (g1 === '일반정보' && sub === 'No') {
    const n = toNum(value)
    return n === null ? '' : String(Math.trunc(n))
  }
  if (g1 === '일반정보' && sub === 'DT') return formatDt(value)
  if (g1 === '일반정보' && sub === 'TM') {
    const n = toNum(value)
    return n === null ? '' : String(Math.trunc(n)).padStart(4, '0')
  }
  if (g1 === '국내배당' || g1 === '해외배당') {
    let n = toNum(value)
    if (n === null && (sub === 'KH' || sub === 'FH') && row) {
      n = inferHandicapSign(row[sub === 'KH' ? 'KW' : 'FW'], row[sub === 'KH' ? 'KL' : 'FL'])
    }
    if (n === null) return ''
    if (sub === 'KH' || sub === 'FH') return (n >= 0 ? '+' : '') + n.toFixed(0)
    return n.toFixed(2)
  }
  if (group.kind === 'risk') {
    const n = toNum(value)
    if (n === null) return ''
    // 8칸 전부 백엔드가 "그 일이 일어날 확률(%)"로 내려준다 — 뒤집지 않는다.
    // (예전엔 국플값·배당·AI·KF·AI만 100에서 빼서 보여줘 방향이 뒤섞여 있었다.)
    return `${n.toFixed(0)}%`
  }
  if (SUB4.includes(sub)) {
    const n = toNum(value)
    return n === null ? '' : String(Math.trunc(n))
  }
  return isBlank(value) ? '' : String(value)
}

// ── 경기 시간대별 베팅 그룹 색상 ──
// 새벽 6시 이전 경기는 '전날 그룹'으로 취급한다 (예: 토요일 04:00 경기는 금요일 그룹).
const WEEKDAY_PREV = { Sun: 'Sat', Mon: 'Sun', Tue: 'Mon', Wed: 'Tue', Thu: 'Wed', Fri: 'Thu', Sat: 'Fri' }

const WEEKDAY_KO = { Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' }

// 그 경기가 속한 '베팅일'(날짜 + 요일). 색상만 필요한 bettingDayStyle과 달리, 요일별로
// 구간을 나눠 보여주는 화면(이번주 리스트)에서 묶음 키·제목으로 쓰려고 따로 둔다.
// 날짜는 실제 날짜 계산으로, 요일은 bettingDayStyle과 똑같은 표(WEEKDAY_PREV)로 옮겨
// 색과 제목이 항상 같은 요일을 가리키게 한다(백엔드 _betting_day_sort_key와 같은 규칙).
export function bettingDayOf(row) {
  if (!row || !row.DT) return null
  const s = String(row.DT)
  const m = /(\d{2})-(\d{2})-(\d{2})\s*\(([A-Za-z]{3})\)/.exec(s)
  if (!m) return null
  const [, yy, mm, dd, wd] = m
  const tm = toNum(row.TM)
  const hour = tm === null ? null : Math.floor(tm / 100)
  const early = hour !== null && hour < 6

  const d = new Date(2000 + Number(yy), Number(mm) - 1, Number(dd))
  if (early) d.setDate(d.getDate() - 1)
  const weekday = early ? (WEEKDAY_PREV[wd] || wd) : wd

  const p = (n) => String(n).padStart(2, '0')
  return {
    key: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    label: `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_KO[weekday] || weekday})`,
    weekday,
  }
}

// 일반정보 그룹을 접었을 때도 이 색을 그대로 보여줘야 해서(LeagueTable.jsx) export한다.
export function bettingDayStyle(row) {
  if (!row || !row.DT) return null
  const m = /\(([A-Za-z]{3})\)/.exec(String(row.DT))
  if (!m) return null
  let weekday = m[1]
  const tm = toNum(row.TM)
  const hour = tm === null ? null : Math.floor(tm / 100)
  if (hour !== null && hour < 6) weekday = WEEKDAY_PREV[weekday] || weekday

  if (weekday === 'Fri') return { background: '#F5B7B1', color: '#6E2C1E', fontWeight: 700 }
  if (weekday === 'Sat') return { background: '#A9DFBF', color: '#1B4D3E', fontWeight: 700 }
  if (weekday === 'Sun') return { background: '#A2D9E8', color: '#0B4F6C', fontWeight: 700 }
  if (weekday === 'Mon') return { background: '#D2B4DE', color: '#4A235A', fontWeight: 700 }
  return { background: '#F9E79F', color: '#7D6608', fontWeight: 700 } // 화/수/목: 그 외
}

// ── 배당 적중 표시 ──
// 순수 배당(KW/KD/KL, FW/FD/FL)은 실제 스코어(HS/AS) 그대로 승/무/패를 판정한다.
// 국내 핸디배당(KHW/KHD/KHL)은 핸디캡 부호(KH)를 홈 스코어에 반영한 "핸디 적용 후 스코어"로
// 판정해야 한다 — 예: HS=0,AS=0,KH=-1 이면 핸디 적용 후 홈은 -1이 되어 KHL(원정 승)이 적중.
// 해외 핸디배당(FHW/FHD/FHL)은 표시 대상에서 제외.
const ODDS_HIT_PLAIN_COLS = ['KW', 'KD', 'KL', 'FW', 'FD', 'FL']
const ODDS_HIT_KH_COLS = ['KHW', 'KHD', 'KHL']

function sideOf(home, away) {
  if (home === null || away === null) return null
  if (home > away) return 'W'
  if (home < away) return 'L'
  return 'D'
}

function oddsHitSide(row) {
  return sideOf(toNum(row?.HS), toNum(row?.AS))
}

function khHitSide(row) {
  const hs = toNum(row?.HS)
  const as_ = toNum(row?.AS)
  // 실제 등록된 핸디 라인(KH)이 없으면, KH 칸 자체도 그렇듯(cellStyle 참고)
  // KW/KL 배당 기준 잠정치로 대신한다 — 그래야 KH 칸에 보이는 값과
  // KHW/KHD/KHL 적중 표시가 서로 어긋나지 않는다.
  const kh = toNum(row?.KH) ?? inferHandicapSign(row?.KW, row?.KL)
  if (hs === null || as_ === null || kh === null) return null
  return sideOf(hs + kh, as_)
}

// 내 예측의 "의견"(옛 적중칸을 재활용 — 배팅 비중 태그, 옛 이름 '벳') 배지 색상.
// 계열별로 색을 묶는다: Pass는 회색, 나머지 P- 계열은 전부 같은 청회색, 벳 계열(B-)은 주황~파랑~보라, 축은 청록.
// 이름이 두 번 바뀌었으므로(패스→Pass, 메인벳→B-메인→B-Ma) 옛 이름도 같이 봐준다 —
// DB는 옮겼지만 혹시 남아 있는 값이 색 없이 뜨는 일을 막는 안전장치다.
export function myHitStyle(value) {
  if (value === 'Pass' || value === '패스') return { background: '#757575', color: '#fff', fontWeight: 700 }
  if (value === 'P-고민' || value === '패스고민') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-분산') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-엇갈') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-상대') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-똥배') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-원정') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-핸↑') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-관전') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'P-어렵') return { background: '#546E7A', color: '#fff', fontWeight: 700 }
  if (value === 'B-고민' || value === '벳고민') return { background: '#F57C00', color: '#fff', fontWeight: 700 }
  if (value === '축') return { background: '#00897B', color: '#fff', fontWeight: 700 }
  if (value === '축-Si' || value === '축-사이드') return { background: '#00695C', color: '#fff', fontWeight: 700 }
  if (value === 'B-Ma' || value === 'B-메인' || value === '메인벳') return { background: '#1565C0', color: '#fff', fontWeight: 700 }
  if (value === 'B-Si' || value === 'B-사이드' || value === 'S벳') return { background: '#6A1B9A', color: '#fff', fontWeight: 700 }
  return null
}

// 내픽+RT를 그때그때 대조해 적중/보험/미적을 자동 판정한다(저장값 아님).
// 픽마다 "적중으로 치는 결과"·"보험(부분 환급)으로 치는 결과"가 다르다 — 나머지는 전부 미적.
const PICK_VERDICT_MAP = {
  플핸무: { hit: [3, 4], insure: [2] },
  정무: { hit: [1, 2], insure: [3] },
  무핸무: { hit: [2, 3], insure: [] },
  플핸: { hit: [3, 4], insure: [] },
  정: { hit: [1, 2], insure: [] },
  핸승: { hit: [1], insure: [] },
  핸무: { hit: [2], insure: [] },
  무: { hit: [3], insure: [] },
  역: { hit: [4], insure: [] },
}

export function computeAutoVerdict(pick, rt) {
  if (isBlank(pick)) return ''
  const rule = PICK_VERDICT_MAP[pick]
  if (!rule) return ''
  const code = rtCodeOf(rt)
  if (code === null || code < 1 || code > 4) return ''
  if (rule.hit.includes(code)) return '적중'
  if (rule.insure.includes(code)) return '보험'
  return '미적'
}

// 내 예측의 자동 "적중" 배지 색상 — 예전 핸승위험도 그룹의 적중(VERDICT) 배색을 그대로 쓴다.
export function pickVerdictStyle(value) {
  if (value === '적중') return { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)', fontWeight: 700 }
  if (value === '보험') return { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)', fontWeight: 700 }
  if (value === '미적') return { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)', fontWeight: 700 }
  return null
}

// 정배 쪽(정무/정/핸승/핸무)과 플핸 쪽(플핸/플핸무/무/역/무핸무)을 셀 색만으로 바로
// 구분하기 위한 그룹 — RtBadge와 같은 파랑/빨강 축을 그대로 쓴다.
const MY_PICK_FAV_GROUP = new Set(['정무', '정', '핸승', '핸무'])
const MY_PICK_DOG_GROUP = new Set(['플핸', '플핸무', '무', '역', '무핸무'])

// 내 예측의 "내픽" 칸 색상 — 뱃지가 아니라 칸 전체 배경으로 정배 쪽/플핸 쪽을 구분한다.
export function myPickStyle(value) {
  if (MY_PICK_FAV_GROUP.has(value)) {
    return { background: 'var(--chip-blue-bg)', color: 'var(--chip-blue-fg)', fontWeight: 700 }
  }
  if (MY_PICK_DOG_GROUP.has(value)) {
    return { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)', fontWeight: 700 }
  }
  return null
}

// 폼(PPG) 칸 색상 — 상세보기 팝업의 폼 지표와 완전히 같은 스타일(3.00~2.00 녹색 /
// 1.99~1.00 노란색 / 0.99~0.00 갈색, 흰 굵은 글씨)로 칸 전체를 칠한다.
export function formStyle(value) {
  const n = toNum(value)
  if (n === null) return null
  if (n >= 2) return { background: '#2E7D32', color: '#fff', fontWeight: 700 }
  if (n >= 1) return { background: '#FBC02D', color: '#fff', fontWeight: 700 }
  return { background: '#8D6E63', color: '#fff', fontWeight: 700 }
}

// ── 셀 배경/글자색 (인라인 style 객체로 반환) ──
// row는 HS/AS처럼 '이 행의 다른 컬럼 값'을 봐야 할 때만 쓴다(예: 이긴 팀 점수 강조).
function cellStyleImpl(group, col, value, row) {
  const g1 = group.label1
  const sub = col.sub

  // DT(날짜)는 자릿수가 일정하지 않아 가운데 정렬이면 들쑥날쑥해 보인다 — 왼쪽 정렬로 고정.
  if (g1 === '일반정보' && sub === 'DT') return { ...(bettingDayStyle(row) || {}), textAlign: 'left' }
  if (g1 === '일반정보' && sub === 'TM') return bettingDayStyle(row)

  // 똥사 — 똥배(강한 정배)인데 실제 결과가 무/역으로 뒤집힌 경우라 눈에 띄게 빨간 글씨로.
  if (g1 === '똥배' && sub === '똥사' && !isBlank(value)) {
    return { color: 'var(--danger-text)', fontWeight: 700 }
  }

  // 분석 — 똥사 위험도(%)를 4단계 옅은 배경 틴트로. 숫자만 두고 색으로 등급을 읽게 해
  // 라운드 전체를 훑을 수 있게 한다(RT·PICK 배지와 같은 칩 톤).
  if (g1 === '똥배' && sub === '분석') {
    const n = toNum(value)
    if (n === null) return undefined
    const [safe, mid, warn] = DDONG_RISK_CUTS
    const tone =
      n < safe ? 'blue' : n < mid ? 'gray' : n < warn ? 'yellow' : 'red'
    return {
      background: `var(--chip-${tone}-bg)`,
      color: `var(--chip-${tone}-fg)`,
      fontWeight: 700,
    }
  }

  // 배당 적중 표시 — '적중'(PH_STATUS) 칸과 같은 노란 배경으로 표시한다.
  // 예정 경기(스코어 없음)는 표시 없음. 그 칸 자체에 배당값이 없으면(공란) 적중
  // 여부와 무관하게 표시하지 않는다 — 숫자 없는 칸이 노랗게만 칠해지는 걸 막는다.
  if ((g1 === '국내배당' || g1 === '해외배당') && (ODDS_HIT_PLAIN_COLS.includes(sub) || ODDS_HIT_KH_COLS.includes(sub))) {
    if (toNum(value) === null) return null
    const side = ODDS_HIT_KH_COLS.includes(sub) ? khHitSide(row) : oddsHitSide(row)
    // 배변 화살표(빨강/파랑, --chip-*-fg)가 이 배경 위에서도 잘 보이도록 채도 낮은
    // 칩 톤(--chip-yellow-*)을 쓴다. 예전 원색 노랑(#FDD835)은 화살표와 명도가 비슷해 묻혔다.
    if (side && sub.endsWith(side)) {
      return { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)', fontWeight: 700 }
    }
    return null
  }

  if (g1 === '경기정보' && (sub === 'HS' || sub === 'AS') && row) {
    const hs = toNum(row.HS)
    const as_ = toNum(row.AS)
    if (hs !== null && as_ !== null && hs !== as_) {
      const winner = hs > as_ ? 'HS' : 'AS'
      if (sub === winner) return { color: 'var(--chip-red-fg)', fontWeight: 700 }
    }
    return null
  }

  if (g1 === '경기정보' && sub === 'RT') {
    const code = rtCodeOf(value)
    if (code === 1) return { background: 'var(--chip-blue-bg)', color: 'var(--chip-blue-fg)', fontWeight: 700 }
    if (code === 2) return { background: 'var(--chip-green-bg)', color: 'var(--chip-green-fg)', fontWeight: 700 }
    if (code === 3) return { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)', fontWeight: 700 }
    if (code === 4) return { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)', fontWeight: 700 }
    if (code === 5) return { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)', fontWeight: 700 }
    return null
  }

  if ((g1 === '해외배당' && sub === 'FH') || (g1 === '국내배당' && sub === 'KH')) {
    // 핸디캡 라인(KH/FH) 칸은 옆 배당 칸들과 구분되도록 아주 연한 흰색 배경을 항상 깐다.
    let n = toNum(value)
    if (n === null && row) {
      n = inferHandicapSign(row[sub === 'KH' ? 'KW' : 'FW'], row[sub === 'KH' ? 'KL' : 'FL'])
    }
    const base = { background: 'rgba(255, 255, 255, 0.06)' }
    if (n === null) return base
    if (n < 0) return { ...base, color: 'var(--chip-blue-fg)', fontWeight: 700 }
    if (n > 0) return { ...base, color: 'var(--chip-red-fg)', fontWeight: 700 }
    return base
  }

  // 핸승 위험도 3묶음 — 색 규칙은 한 문장이다: "초록이면 플핸에 유리".
  //   플핸무·플 확률 → 높을수록 초록 (그 일이 날 확률이니 클수록 좋다)
  //   정배 승리확률  → 낮을수록 초록 (정배가 셀수록 플핸에 불리하다)
  // 묶음마다 값의 분포가 완전히 달라 경계를 따로 잡았다. 같은 '국)플'이라도
  // 어느 묶음에 있느냐로 갈리므로 sub가 아니라 group.label1로 판정한다.
  if (group.kind === 'risk') {
    const n = toNum(value)
    if (n === null) return { color: '#9E9E9E' }

    // 플핸무 — 예전 핸승값 경계(15/25/35/45%)를 그대로 뒤집은 값.
    // 실측 분포: 평균 68~70%, 5~95% 범위 44~85%.
    if (group.label1 === '플핸무 %') {
      if (n >= 85) return RISK_DEEP
      if (n >= 75) return RISK_GOOD
      if (n >= 65) return RISK_MID
      if (n >= 55) return RISK_WARN
      return RISK_BAD
    }

    // 플 — 분포가 플핸무와 완전히 다르다(실측 평균 44~46%, 5~95% 범위 20~62%).
    // 플핸무 경계를 그대로 쓰면 거의 전부 빨강으로만 칠해진다.
    if (group.label1 === '플 %') {
      if (n >= 55) return RISK_DEEP
      if (n >= 48) return RISK_GOOD
      if (n >= 41) return RISK_MID
      if (n >= 34) return RISK_WARN
      return RISK_BAD
    }

    // 정승 확률(WIN_RISK/WIN_RISK_F) — 실측 6대리그 15,834경기 결과가 31~90%에
    // 몰려 있다. 31~40%→실제 37.8% / 41~50%→44.6% / 51~60%→57.0% / 61~70%→68.2% /
    // 71~80%→75.3% / 81~90%→88.4%.
    if (n < 40) return RISK_GOOD    // 양호
    if (n < 55) return RISK_MID     // 보통
    if (n < 70) return RISK_WARN    // 주의
    return RISK_BAD                 // 위험
  }

  return null
}

// 국내배당/해외배당은 숫자 자릿수가 들쭉날쭉해 가운데 정렬이면 배변 화살표(.odds-arrow) 위치가
// 셀마다 흔들려 보인다 — 왼쪽 정렬로 고정해 화살표가 항상 같은 자리에 붙게 한다.
export function cellStyle(group, col, value, row) {
  const style = cellStyleImpl(group, col, value, row)
  // KH/FH(핸디캡 라인)는 배변 화살표가 붙지 않는 칸이라 가운데 정렬 그대로 둔다.
  if ((group.label1 === '국내배당' || group.label1 === '해외배당') && col.sub !== 'KH' && col.sub !== 'FH') {
    return { textAlign: 'left', ...(style || {}) }
  }
  return style
}
