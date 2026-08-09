// 대형 분석표의 2단 헤더 구성 + 서식/색상 규칙.
// WEB_BET_PRO.py의 apply_multi_index()/build_styler()(1422~1554줄)를 그대로 옮긴 것.
// 산출 로직은 건드리지 않고, "표시 순서·라벨·색상"만 그대로 재현한다.

const GEN_COLS = ['L', 'S', 'R', 'No', 'DT', 'TM']
// 그 경기 '직전까지'의 시즌 성적. 백엔드가 조회 시 계산해 붙여준다.
//   HP/AP  = 홈팀/원정팀 순위
//   HTF/ATF = 홈팀/원정팀의 전체경기 PPG,  HF/AF = 홈팀 홈경기·원정팀 원정경기 PPG
const MATCH_COLS = [
  'HTF', 'HF', 'HP', 'HT', 'HS', 'RT', 'AS', 'AT', 'AP', 'AF', 'ATF',
]
const K_ODDS_COLS = ['KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL']
const F_ODDS_COLS = ['FW', 'FD', 'FL', 'FH', 'FHW', 'FHD', 'FHL']

// 내 예측(별표/실제 벳팅 픽) — 화면에서 직접 클릭·팝업으로 입력하는 칸이라
// formatCell/cellStyle이 아니라 LeagueTable.jsx가 직접 렌더링한다.
const MYPICK_COLS = [
  ['IMPORTANT', '중요'],
  ['MY_PICK', '내픽'],
  ['MY_HIT', '적중'],
]

// 똥배 — 국내배당 KW/KL이 1.49 이하로 나온 "똥[안전]배당" 경기를 그 라운드 안에서
// 낮은 순으로 똥1, 똥2...로 매긴 값(DDONG)과, 실제 결과가 무/역이면 붙는 똥사(DDONGSA).
const DDONG_COLS = [
  ['DDONG', '똥'],
  ['DDONGSA', '똥사'],
]

// 핸승 위험도 — "플핸 예측"을 대체한다. 예전 PICK(플핸(무)/플핸(역)/...)은
// 실측 적중률이 아니라 고정 보정표 값이었고(예: 78% 표시인데 실제 52.8%),
// 여기 값은 전부 실측으로 검증했다(6대리그 13,410경기, columnGroups.js formatCell/
// cellStyle 쪽과 api/ev_model.py의 GRADE_BINS/WARN_GAP_PP 주석 참고).
const RISK_COLS = [
  ['VERDICT', '적중'],
  ['RISK', '위험'],
  ['GRADE', '등급'],
  ['ENGINE', '엔진'],
  ['WARN', '⚠'],
  ['ODD_FLAG', '상태'],
]

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
]

const SUB4 = ['핸승', '핸무', '무', '역']

const RT_DISPLAY = { 1: '핸승', 2: '핸무', 3: '무', 4: '역', 5: '취소' }
const RT_CODE_FROM_TEXT = { 핸승: 1, 핸무: 2, 무: 3, 역: 4, 취소: 5 }

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

  const myPickLeaves = MYPICK_COLS.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
  if (myPickLeaves.length) {
    groups.push({ label1: '내 예측', label2: '', kind: 'mypick', cols: myPickLeaves })
  }

  const riskLeaves = RISK_COLS.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
  if (riskLeaves.length) {
    groups.push({ label1: '핸승 위험도', label2: '배당 기준 · 낮을수록 안전', kind: 'risk', cols: riskLeaves })
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

  if (g1 === '경기정보' && sub === 'RT') return rtToText(value)
  if (g1 === '경기정보' && (sub === 'HS' || sub === 'AS')) {
    const n = toNum(value)
    return n === null ? '' : String(Math.trunc(n))
  }
  if (g1 === '일반정보' && sub === 'No') {
    const n = toNum(value)
    return n === null ? '' : String(Math.trunc(n))
  }
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
    if (sub === '적중' || sub === '등급' || sub === '상태') return isBlank(value) ? '' : String(value)
    if (sub === '⚠') return value === 1 || value === '1' || value === true ? '⚠' : ''
    const n = toNum(value)
    return n === null ? '' : `${n.toFixed(0)}%`
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

// 내 예측의 "적중" 배지 색상 — 플핸예측 쪽 적중(PH_STATUS)과 같은 배색을 그대로 쓴다.
export function myHitStyle(value) {
  if (value === '적중') return { background: '#FDD835', color: '#0D1B2A', fontWeight: 700 }
  if (value === '미적') return { background: '#C62828', color: '#fff', fontWeight: 700 }
  if (value === '패스') return { background: '#757575', color: '#fff', fontWeight: 700 }
  if (value === '고민') return { background: '#F57C00', color: '#fff', fontWeight: 700 }
  return null
}

// 내 예측의 "내픽" 배지 색상 — 축플/축정은 다른 픽보다 중요한 픽이라 골드 배경(적중
// 배지보다 채도를 낮춘 톤)은 유지하고, 둘을 구분하도록 글자색만 달리한다(축플=빨강, 축정=파랑).
export function myPickStyle(value) {
  if (value === '축플') return { background: '#D9C36A', color: '#C62828', fontWeight: 700 }
  if (value === '축정') return { background: '#D9C36A', color: '#1565C0', fontWeight: 700 }
  return null
}

// 폼(PPG) 칸 색상 — 상세보기 팝업의 폼 지표와 같은 구간 색상(3.00~2.00 녹색 /
// 1.99~1.00 노란색 / 0.99~0.00 갈색). 표에서는 칸 전체가 아니라 뱃지로만 보여준다.
export function formStyle(value) {
  const n = toNum(value)
  if (n === null) return null
  if (n >= 2) return { background: '#2E7D32', color: '#000', fontWeight: 400 }
  if (n >= 1) return { background: '#FBC02D', color: '#000', fontWeight: 400 }
  return { background: '#8D6E63', color: '#000', fontWeight: 400 }
}

// ── 셀 배경/글자색 (인라인 style 객체로 반환) ──
// row는 HS/AS처럼 '이 행의 다른 컬럼 값'을 봐야 할 때만 쓴다(예: 이긴 팀 점수 강조).
export function cellStyle(group, col, value, row) {
  const g1 = group.label1
  const sub = col.sub

  if (g1 === '일반정보' && (sub === 'DT' || sub === 'TM')) return bettingDayStyle(row)

  // 똥사 — 똥배(강한 정배)인데 실제 결과가 무/역으로 뒤집힌 경우라 눈에 띄게 빨간 글씨로.
  if (g1 === '똥배' && sub === '똥사' && !isBlank(value)) {
    return { color: '#C62828', fontWeight: 700 }
  }

  // 배당 적중 표시 — '적중'(PH_STATUS) 칸과 같은 노란 배경으로 표시한다.
  // 예정 경기(스코어 없음)는 표시 없음. 그 칸 자체에 배당값이 없으면(공란) 적중
  // 여부와 무관하게 표시하지 않는다 — 숫자 없는 칸이 노랗게만 칠해지는 걸 막는다.
  if ((g1 === '국내배당' || g1 === '해외배당') && (ODDS_HIT_PLAIN_COLS.includes(sub) || ODDS_HIT_KH_COLS.includes(sub))) {
    if (toNum(value) === null) return null
    const side = ODDS_HIT_KH_COLS.includes(sub) ? khHitSide(row) : oddsHitSide(row)
    if (side && sub.endsWith(side)) return { background: '#FDD835', color: '#0D1B2A', fontWeight: 700 }
    return null
  }

  if (g1 === '경기정보' && (sub === 'HS' || sub === 'AS') && row) {
    const hs = toNum(row.HS)
    const as_ = toNum(row.AS)
    if (hs !== null && as_ !== null && hs !== as_) {
      const winner = hs > as_ ? 'HS' : 'AS'
      if (sub === winner) return { color: '#C62828', fontWeight: 700 }
    }
    return null
  }

  if (g1 === '경기정보' && sub === 'RT') {
    const code = rtCodeOf(value)
    if (code === 1) return { background: '#1565C0', color: '#fff', fontWeight: 700 }
    if (code === 2) return { background: '#64B5F6', color: '#0D1B2A', fontWeight: 700 }
    if (code === 3) return { background: '#757575', color: '#fff', fontWeight: 700 }
    if (code === 4) return { background: '#C62828', color: '#fff', fontWeight: 700 }
    if (code === 5) return { background: '#546E7A', color: '#fff', fontWeight: 700 }
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
    if (n < 0) return { ...base, color: '#1565C0', fontWeight: 700 }
    if (n > 0) return { ...base, color: '#C62828', fontWeight: 700 }
    return base
  }

  if (group.kind === 'risk' && sub === '적중') {
    // 결과가 무·역이면 보험(플핸+핸무) 벳이 실제로 적중한 것 / 핸무면 원금만 건진 것 /
    // 핸승이면 전액 손실 — 예측이 아니라 그 경기가 실제로 어떻게 끝났는지의 판정이다.
    if (value === '적중') return { background: '#FDD835', color: '#0D1B2A', fontWeight: 700 }
    if (value === '보험') return { background: '#00897B', color: '#fff', fontWeight: 700 }
    if (value === '미적') return { background: '#C62828', color: '#fff', fontWeight: 700 }
    return null
  }

  // 위험(RISK)·엔진(ENGINE) 둘 다 "핸승 날 확률(%)" 값이라 같은 색 등급을 쓴다 —
  // api/ev_model.py의 GRADE_BINS(안전~15/양호~25/보통~35/주의~45/위험~)와 맞춘 경계.
  if (group.kind === 'risk' && (sub === '위험' || sub === '엔진')) {
    const n = toNum(value)
    if (n === null) return { color: '#9E9E9E' }
    if (n < 15) return { background: '#1B5E20', color: '#fff', fontWeight: 700 }
    if (n < 25) return { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
    if (n < 35) return { background: '#FBC02D', color: '#0D1B2A' }
    if (n < 45) return { background: '#EF6C00', color: '#fff', fontWeight: 700 }
    return { background: '#C62828', color: '#fff', fontWeight: 700 }
  }

  if (group.kind === 'risk' && sub === '등급') {
    const s = isBlank(value) ? '' : String(value)
    if (s === '안전') return { background: '#1B5E20', color: '#fff', fontWeight: 700 }
    if (s === '양호') return { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
    if (s === '보통') return { background: '#FBC02D', color: '#0D1B2A' }
    if (s === '주의') return { background: '#EF6C00', color: '#fff', fontWeight: 700 }
    if (s === '위험') return { background: '#C62828', color: '#fff', fontWeight: 700 }
    return null
  }

  // ⚠ — 엔진이 배당보다 낙관적일 때만 뜬다(api/ev_model.py WARN_GAP_PP 주석 참고).
  // 실측: 이 표시가 붙은 경기는 핸승률 47.8%(안 붙은 경기는 30.2%) — 지표만 보고
  // 안심하면 안 되는 경기라는 뜻이라 항상 눈에 띄는 빨간색으로 강조한다.
  if (group.kind === 'risk' && sub === '⚠') {
    if (value === 1 || value === '1' || value === true) {
      return { color: '#C62828', fontWeight: 700 }
    }
    return null
  }

  if (group.kind === 'risk' && sub === '상태') {
    return isBlank(value) ? null : { color: '#9E9E9E' }
  }

  return null
}
