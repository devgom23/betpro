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

const PH_COLS = [
  ['PH_STATUS', '적중'],
  ['PH_F', '해)플핸'],
  ['PH_K', '국)플핸'],
  ['PH_PICK', 'PICK'],
  ['PH_HIT', '실측'],
  ['PH_DOM', '비중'],
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
export function buildColumnGroups(availableCols) {
  const available = new Set(availableCols)
  const groups = []

  function addFlatGroup(label1, label2, cols) {
    const leaves = cols.filter((c) => available.has(c)).map((c) => ({ key: c, sub: c }))
    if (leaves.length) groups.push({ label1, label2, kind: 'flat', cols: leaves })
  }

  addFlatGroup('일반정보', '시즌 및 라운드 정보', GEN_COLS)
  addFlatGroup('경기정보', '홈팀 vs 원정팀', MATCH_COLS)
  addFlatGroup('국내배당', '승(W) / 무(D) / 패(L)', K_ODDS_COLS)
  addFlatGroup('해외배당', '승(W) / 무(D) / 패(L)', F_ODDS_COLS)

  const myPickLeaves = MYPICK_COLS.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
  if (myPickLeaves.length) {
    groups.push({ label1: '내 예측', label2: '', kind: 'mypick', cols: myPickLeaves })
  }

  const phLeaves = PH_COLS.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
  if (phLeaves.length) {
    groups.push({ label1: '플핸 예측', label2: '26개 지표 기반 · 실측 적중률', kind: 'ph', cols: phLeaves })
  }

  for (const [code, title] of GROUP_DEFS) {
    const leaves = SUB4.map((sub, i) => ({ key: `${code} ${i + 1}`, sub })).filter((c) =>
      available.has(c.key)
    )
    if (leaves.length) groups.push({ label1: title, label2: code, kind: 'indicator', cols: leaves })
  }

  return groups
}

// ── 셀 값 포맷 ──
export function formatCell(group, col, value) {
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
    const n = toNum(value)
    if (n === null) return ''
    if (sub === 'KH' || sub === 'FH') return (n >= 0 ? '+' : '') + n.toFixed(0)
    return n.toFixed(2)
  }
  if (group.kind === 'ph') {
    if (sub === 'PICK' || sub === '적중') return isBlank(value) ? '' : String(value)
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

function bettingDayStyle(row) {
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
  const kh = toNum(row?.KH)
  if (hs === null || as_ === null || kh === null) return null
  return sideOf(hs + kh, as_)
}

// 내 예측의 "적중" 배지 색상 — 플핸예측 쪽 적중(PH_STATUS)과 같은 배색을 그대로 쓴다.
export function myHitStyle(value) {
  if (value === '적중') return { background: '#FDD835', color: '#0D1B2A', fontWeight: 700 }
  if (value === '미적') return { background: '#C62828', color: '#fff', fontWeight: 700 }
  if (value === '패스') return { background: '#757575', color: '#fff', fontWeight: 700 }
  return null
}

// ── 셀 배경/글자색 (인라인 style 객체로 반환) ──
// row는 HS/AS처럼 '이 행의 다른 컬럼 값'을 봐야 할 때만 쓴다(예: 이긴 팀 점수 강조).
export function cellStyle(group, col, value, row) {
  const g1 = group.label1
  const sub = col.sub

  if (g1 === '일반정보' && (sub === 'DT' || sub === 'TM')) return bettingDayStyle(row)

  // 폼(PPG) 칸 — 상세보기 팝업의 폼 지표와 같은 구간 색상(3.00~2.00 녹색 /
  // 1.99~1.00 노란색 / 0.99~0.00 갈색). HP/AP는 순위라 대상에서 뺀다.
  if (g1 === '경기정보' && ['HTF', 'HF', 'AF', 'ATF'].includes(sub)) {
    const n = toNum(value)
    if (n === null) return null
    if (n >= 2) return { background: '#2E7D32', color: '#fff', fontWeight: 700 }
    if (n >= 1) return { background: '#FBC02D', color: '#fff', fontWeight: 700 }
    return { background: '#8D6E63', color: '#fff', fontWeight: 700 }
  }

  // 배당 적중 표시 — '적중'(PH_STATUS) 칸과 같은 노란 배경으로 표시한다.
  // 예정 경기(스코어 없음)는 표시 없음.
  if ((g1 === '국내배당' || g1 === '해외배당') && (ODDS_HIT_PLAIN_COLS.includes(sub) || ODDS_HIT_KH_COLS.includes(sub))) {
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
    const n = toNum(value)
    if (n === null) return null
    if (n < 0) return { color: '#1565C0', fontWeight: 700 }
    if (n > 0) return { color: '#C62828', fontWeight: 700 }
    return null
  }

  if (group.kind === 'ph' && sub === '적중') {
    if (value === '적중') return { background: '#FDD835', color: '#0D1B2A', fontWeight: 700 }
    // 보험: 핸승 여부(큰 분류)는 맞혔지만 괄호 안 세부결과(핸무/무/역)는 다르게 나온 경우.
    if (value === '보험') return { background: '#00897B', color: '#fff', fontWeight: 700 }
    if (value === '미적') return { background: '#C62828', color: '#fff', fontWeight: 700 }
    if (value === '관망') return { background: '#757575', color: '#fff', fontWeight: 700 }
    return null
  }

  if (group.kind === 'ph' && sub === 'PICK') {
    const s = isBlank(value) ? '' : String(value).trim()
    if (s.startsWith('플핸')) {
      if (s.includes('(역)')) return { background: '#4A148C', color: '#fff', fontWeight: 700 }
      if (s.includes('(무)')) return { background: '#6A1B9A', color: '#fff', fontWeight: 700 }
      if (s.includes('(핸무)')) return { background: '#E65100', color: '#fff', fontWeight: 700 }
      return { background: '#7B1FA2', color: '#fff' }
    }
    if (s === '핸승') return { background: '#1565C0', color: '#fff', fontWeight: 700 }
    return { color: '#9E9E9E' }
  }

  if (group.kind === 'ph' && sub === '실측') {
    const n = toNum(value)
    if (n === null) return { color: '#9E9E9E' }
    if (n >= 80) return { background: '#1B5E20', color: '#fff', fontWeight: 700 }
    if (n >= 75) return { background: '#2E7D32', color: '#fff', fontWeight: 700 }
    if (n >= 70) return { background: '#66BB6A', color: '#0D1B2A' }
    if (n >= 65) return { background: '#C5E1A5', color: '#1B5E20' }
    return { color: '#9E9E9E' }
  }

  if (group.kind === 'ph' && (sub === '해)플핸' || sub === '국)플핸')) {
    const n = toNum(value)
    if (n === null) return null
    if (n >= 85) return { background: '#311B92', color: '#fff', fontWeight: 700 }
    if (n >= 80) return { background: '#512DA8', color: '#fff' }
    if (n >= 75) return { background: '#9575CD', color: '#1A1A1A' }
    if (n < 50) return { background: '#1565C0', color: '#fff', fontWeight: 700 }
    return null
  }

  return null
}
