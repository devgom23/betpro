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
// PICK_VERDICT(적중)는 저장되는 값이 아니라 내픽+RT로 그때그때 자동 계산한다
// (computeAutoVerdict 참고). MY_HIT은 '벳'으로 이름을 바꿔 배팅 비중 태그로 쓴다.
const MYPICK_COLS = [
  ['IMPORTANT', '중요'],
  ['PICK_VERDICT', '적중'],
  ['MY_PICK', '내픽'],
  ['MY_HIT', '벳'],
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
// cellStyle 쪽과 api/ev_model.py 상단 주석 참고).
// 배당 기반 값(핸승값/국정값/해정값/배당·AI) → 26개 지표 기반 값(K값/F값/KF·AI)
// 순서. LeagueTable.jsx riskSubDividerClass가 배당·AI 뒤에 구분선을 넣는다.
const RISK_COLS = [
  ['RISK', '핸승값'],
  ['WIN_RISK', '국정값'],
  ['WIN_RISK_F', '해정값'],
  ['AI_PICK', '배당·AI'],
  ['K_VALUE', 'K값'],
  ['F_VALUE', 'F값'],
  ['KF_AI', 'KF·AI'],
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

  // PICK_VERDICT(적중)는 저장된 컬럼이 아니라 내픽+RT로 그때그때 계산하는 값이라
  // 백엔드가 내려준 컬럼 목록엔 절대 없다 — IMPORTANT/MY_PICK/MY_HIT 중 하나라도
  // 있으면(=이 표에서 내 예측 기능 자체가 켜져 있으면) 무조건 같이 보여준다.
  const myPickActive = MYPICK_COLS.some(([k]) => k !== 'PICK_VERDICT' && available.has(k))
  if (myPickActive) {
    const myPickLeaves = MYPICK_COLS.map(([k, sub]) => ({ key: k, sub }))
    groups.push({ label1: '내 예측', label2: '', kind: 'mypick', cols: myPickLeaves })
  }

  const riskLeaves = RISK_COLS.filter(([k]) => available.has(k)).map(([k, sub]) => ({ key: k, sub }))
  if (riskLeaves.length) {
    groups.push({
      label1: '핸승 위험도',
      label2: '국/해배 배당률 분석 / 26개 지표분석',
      kind: 'risk',
      cols: riskLeaves,
    })
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
    const n = toNum(value)
    if (n === null) return ''
    if (sub === '배당·AI' || sub === 'KF·AI') return `플${(100 - n).toFixed(0)}%`
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

// 내 예측의 "벳"(옛 적중칸을 재활용 — 배팅 비중 태그) 배지 색상.
export function myHitStyle(value) {
  if (value === '패스') return { background: '#757575', color: '#fff', fontWeight: 700 }
  if (value === '패스고민') return { background: '#8D6E63', color: '#fff', fontWeight: 700 }
  if (value === '벳고민') return { background: '#F57C00', color: '#fff', fontWeight: 700 }
  if (value === '축') return { background: '#00897B', color: '#fff', fontWeight: 700 }
  if (value === '메인벳') return { background: '#1565C0', color: '#fff', fontWeight: 700 }
  if (value === 'S벳') return { background: '#6A1B9A', color: '#fff', fontWeight: 700 }
  return null
}

// 내픽+RT를 그때그때 대조해 적중/보험/미적을 자동 판정한다(저장값 아님).
// 픽마다 "적중으로 치는 결과"·"보험(부분 환급)으로 치는 결과"가 다르다 — 나머지는 전부 미적.
const PICK_VERDICT_MAP = {
  플핸무: { hit: [3, 4], insure: [2] },
  정무: { hit: [1, 2], insure: [3] },
  축정: { hit: [1, 2], insure: [] },
  축플: { hit: [3, 4], insure: [] },
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

// 내 예측의 "내픽" 칸 색상 — 축플/축정은 다른 픽보다 중요한 픽이라 골드 배경(적중
// 배지보다 채도를 낮춘 톤)은 유지하고, 둘을 구분하도록 글자색만 달리한다(축플=빨강, 축정=파랑).
// 나머지 픽은 뱃지가 아니라 칸 전체 배경으로 정배 쪽/플핸 쪽을 구분한다.
export function myPickStyle(value) {
  if (value === '축플') return { background: 'var(--chip-yellow-bg)', color: 'var(--chip-red-fg)', fontWeight: 700 }
  if (value === '축정') return { background: 'var(--chip-yellow-bg)', color: 'var(--chip-blue-fg)', fontWeight: 700 }
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
export function cellStyle(group, col, value, row) {
  const g1 = group.label1
  const sub = col.sub

  if (g1 === '일반정보' && (sub === 'DT' || sub === 'TM')) return bettingDayStyle(row)

  // 똥사 — 똥배(강한 정배)인데 실제 결과가 무/역으로 뒤집힌 경우라 눈에 띄게 빨간 글씨로.
  if (g1 === '똥배' && sub === '똥사' && !isBlank(value)) {
    return { color: 'var(--danger-text)', fontWeight: 700 }
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

  // 핸승값(RISK)·배AI·K값·F값·KFAI 모두 "핸승 날 확률(%)" 값이라 같은 색 등급을 쓴다 —
  // 실측 검증(6대리그 13,410경기, api/ev_model.py 상단 주석 참고) 경계: 15/25/35/45%.
  if (group.kind === 'risk' && ['핸승값', '배당·AI', 'K값', 'F값', 'KF·AI'].includes(sub)) {
    const n = toNum(value)
    if (n === null) return { color: '#9E9E9E' }
    if (n < 15) return { background: '#1B5E20', color: '#fff', fontWeight: 700 }
    if (n < 25) return { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
    if (n < 35) return { background: '#FBC02D', color: '#0D1B2A' }
    if (n < 45) return { background: '#EF6C00', color: '#fff', fontWeight: 700 }
    return { background: '#C62828', color: '#fff', fontWeight: 700 }
  }

  // 국정값·해정값(WIN_RISK/WIN_RISK_F) — "정배가 실제로 이길 확률"이라 핸승값과는
  // 분포 자체가 다르다(실측 6대리그 15,834경기 결과 대부분이 31~90% 구간에 몰려
  // 있다 — 핸승값 경계를 그대로 쓰면 거의 전부 '위험' 한 가지 색으로만 칠해진다).
  // 그래서 경계를 따로 잡았다: 31~40%→실제 37.8% / 41~50%→44.6% / 51~60%→57.0% /
  // 61~70%→68.2% / 71~80%→75.3% / 81~90%→88.4%.
  if (group.kind === 'risk' && (sub === '국정값' || sub === '해정값')) {
    const n = toNum(value)
    if (n === null) return { color: '#9E9E9E' }
    if (n < 40) return { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 } // 양호
    if (n < 55) return { background: '#FBC02D', color: '#0D1B2A' }                  // 보통
    if (n < 70) return { background: '#EF6C00', color: '#fff', fontWeight: 700 }    // 주의
    return { background: '#C62828', color: '#fff', fontWeight: 700 }                // 위험
  }

  return null
}
