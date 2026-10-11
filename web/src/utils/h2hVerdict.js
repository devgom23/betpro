// 상대전적 우세 판정 — 홈우세 / 전적보합 / 원정우세.
//
// 홈기준(그 경기의 홈팀이 실제로 이 구장에서 그 원정팀을 상대한 기록)만으로 판정한다
// (2026-09-20 사용자 지정 — "전체 전적을 섞으니 명확하지 않다. 홈팀 기준 원정팀과의
// 전적 방향을 알려주는 거다"). 예전엔 전체기준(모든 맞대결)과 홈기준을 섞어 5단계로
// 냈는데, 두 축이 다른 방향을 가리킬 때(홈만우세·원정만우세) 뱃지가 뭘 말하는지
// 헷갈렸다 — 그래서 홈기준 하나로 단순화한다.
//
// '첫 맞대결'(전혀 안 만남)과 '이 구장에서는 처음'(다른 데서는 만났지만 홈 기록 0건)은
// 구분한다 — 전자만 첫맞대결 뱃지, 후자는 홈 표본이 없으니 자연히 '전적보합'이 된다
// (below h2hVerdict의 wdlAll null 체크 참고).
//
// ── 아래 상수는 전부 실측값이다 (2026-09-02, 8개 리그 41,974경기 / 팀-쌍 3,616개) ──
//
// [1] 기준선이 두 개인 이유 — 홈경기만 모으면 홈어드밴티지 때문에 승점이 원래 높다.
//     전체기준 평균 1.363점(승 37.0% 무 25.3% 패 37.7%)
//     홈기준   평균 1.582점(승 44.3% 무 25.3% 패 30.4%)
//     하나로 쓰면 홈우세가 과하게 뜬다.
//
// [2] 표본 보정(SHRINK)이 필요한 이유 — 보정 없이 재면 2~3경기짜리 기록의 상위 20%가
//     3.00점(전승)이다. 그건 우세가 아니라 표본이 작은 것이다. 그래서 평균 쪽으로
//     끌어당긴다(지표별 표본의 SAMPLE_SHRINK와 같은 발상).
//       3승0무0패(3경기)  3.00 → 1.98      5승6무1패(12경기) 1.75 → 1.64
//       4승1무0패(5경기)  2.60 → 2.09      14승4무2패(20경기) 2.30 → 2.11
//     작은 표본만 눌리고 큰 표본은 거의 그대로 남는다.
//
// [3] 여유폭 ±0.30인 이유 — 옛 5단계 분포(±0.30)에서 '~만' 계열을 우세/열세 쪽에
//     합치면 그대로 지금 3단계 비율이 나온다(hHi/hLo 조건 자체가 같아 재측정 불필요 —
//     홈우세=hHi는 옛 '홈우세∪홈만우세'와, 원정우세=hLo는 '원정우세∪원정만우세'와
//     정확히 같은 조건이었다):
//       ±0.25 → 홈우세 34% / 보합 31% / 원정우세 35%
//       ±0.30 → 홈우세 28% / 보합 42% / 원정우세 31%  ← 채택
//       ±0.35 → 홈우세 25% / 보합 49% / 원정우세 25%
//     ±0.30이면 판정 불가(보합)가 절반 아래고 우세/열세가 4경기에 1번 꼴로 뜬다.
const BASE_HOME = 1.582
const SHRINK = 5
const MARGIN = 0.30

// wdl_summary 한 덩어리({W:{total},D:{total},L:{total}})에서 경기수와 승점합을 뽑는다.
function tally(wdl) {
  if (!wdl) return null
  const w = Number(wdl.W?.total) || 0
  const d = Number(wdl.D?.total) || 0
  const l = Number(wdl.L?.total) || 0
  const n = w + d + l
  return n > 0 ? { n, w, d, l, points: w * 3 + d } : null
}

// 표본이 작을수록 평균 쪽으로 끌어당긴 승점/경기.
function adjusted(t, base) {
  return t ? (t.points + base * SHRINK) / (t.n + SHRINK) : null
}

/**
 * @param {object} wdlAll  전체기준 wdl_summary — '첫 맞대결'인지만 가른다(다른 데서도
 *   전혀 안 만났는지). 판정 방향에는 더 이상 안 쓴다.
 * @param {object} wdlHome 홈기준 wdl_summary_home — 판정은 이 값 하나로만 낸다.
 * @returns {{label, tone, title}|null} 맞대결 기록이 아예 없으면 null(첫 맞대결).
 *   다른 데서는 만났지만 이 구장 기록이 0건이면 '전적보합'으로 떨어진다(표본 없음).
 */
export function h2hVerdict(wdlAll, wdlHome) {
  if (!tally(wdlAll)) return null           // 첫 맞대결 — 판정할 게 없다
  const th = tally(wdlHome)
  const h = adjusted(th, BASE_HOME)

  let label
  if (h === null) label = '전적보합'          // 이 구장에서는 아직 안 만남 — 표본 없음
  else if (h >= BASE_HOME + MARGIN) label = '홈우세'
  else if (h <= BASE_HOME - MARGIN) label = '원정우세'
  else label = '전적보합'

  // 색은 앱 전체 축 그대로 — 홈 쪽=파랑 / 원정 쪽=빨강 / 판정 불가=회색.
  const tone = label === '홈우세' ? 'blue' : label === '원정우세' ? 'red' : 'gray'

  const fmt = (t, adj) => (t
    ? `${t.w}승 ${t.d}무 ${t.l}패 (${t.n}경기) 승점/경기 ${(t.points / t.n).toFixed(2)}`
      + ` → 표본보정 ${adj.toFixed(2)} (평균 ${BASE_HOME.toFixed(2)})`
    : '이 구장에서는 아직 안 만남')

  return {
    label,
    tone,
    // 화면 표기가 '홈우세/전적보합' 단어 대신 승/무/패 숫자로 바뀌어(2026-09-22
    // 사용자 지정) 호출부가 이 셋을 직접 읽는다. th가 없으면(이 구장 기록 0건) 0/0/0.
    w: th?.w ?? 0,
    d: th?.d ?? 0,
    l: th?.l ?? 0,
    n: th?.n ?? 0,
    title: `홈팀 기준 이 구장 상대전적 판정(전체 맞대결이 아니라 홈 경기만 본다).\n`
      + `${fmt(th, h)}\n`
      + `기준: 표본보정 승점이 평균에서 ±${MARGIN.toFixed(2)} 넘게 벗어나면 우세/열세.`
      + ` 표본이 작으면 평균 쪽으로 끌어당겨(가상의 평균 경기 ${SHRINK}판을 섞어) 판정한다.`,
  }
}

// ── 최근(이번 시즌 제외 최근 5개 시즌) 홈전적 (2026-09-22 사용자 지정) ────────────
// "전적 보합/우세" 위 h2hVerdict는 그대로 두고(다른 신호(플핸85·같은방향)가 이미
// 그 값으로 실측·측정돼 있어 손대지 않는다), 같은 경기의 상대전적 칩에 "최근에는
// 어땠나"를 나란히 보여주기 위한 것 — 사용자 사례(AS로마 vs 인터밀란)에서 전체는
// 5승6무6패(전적보합)인데 최근 5시즌(21-22~25-26)은 0승0무5패(원정우세)로 완전히
// 갈렸다. "최근"의 정의(사용자 지정): 이번 시즌은 빼고 그 직전 5개 시즌.
// 판정식은 h2hVerdict와 완전히 같다(기준선 1.582·보정K=5·여유폭±0.30) — 표본만 다르다.
// matches는 새 API 호출 없이 /api/pick_ai가 이미 주는 h2h.matches(limit=500, cross=True,
// 이 경기 이전까지 전부)를 그대로 쓴다.
// 반환: null = 이 창 안에서 이 구장 맞대결이 0건 — 호출부가 '전적보합'이 아니라
// '－'(표본 자체가 없음)로 그려서 "쟀더니 팽팽하다"와 구분한다.
// 시즌 순번 — 유럽식 '26-27'은 앞 두 자리(26), K리그처럼 연도 한 해가 한 시즌인 '2026'은 뒤 두 자리(26).
// ⚠ 2026-09-27 수정 — 예전엔 둘 다 앞 두 자리만 읽어 '2023'·'2024'·'2026'이 전부 20이 됐다.
//   그래서 K리그(내 데이터 리그)는 '최근5'(이번 시즌 제외 최근 5시즌) 창에 한 경기도 안 들어가
//   항상 '최근5 －'로 나왔다(사용자 제보: K1 22R 강원 vs 인천).
export function seasonIdx(s) {
  const t = String(s || '').trim()
  if (/^\d{4}$/.test(t)) return Number(t) % 100
  const n = parseInt(t.slice(0, 2), 10)
  return Number.isFinite(n) ? n : null
}

function seasonLabel(k, yearly) {
  const a = ((k % 100) + 100) % 100
  if (yearly) return `20${String(a).padStart(2, '0')}`
  const b = (a + 1) % 100
  return `${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
}

export const RECENT_SEASONS = 5

export function h2hVerdictRecent(matches, host, season) {
  const si = seasonIdx(season)
  if (si === null || !Array.isArray(matches)) return null
  const yearly = /^\d{4}$/.test(String(season || '').trim())
  const lo = si - RECENT_SEASONS
  const hi = si - 1
  let w = 0
  let d = 0
  let l = 0
  for (const m of matches) {
    if (String(m.HT || '').trim() !== host) continue
    const ms = seasonIdx(m.S)
    if (ms === null || ms < lo || ms > hi) continue
    const hs = Number(m.HS)
    const as = Number(m.AS)
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue
    if (hs > as) w += 1
    else if (hs === as) d += 1
    else l += 1
  }
  const n = w + d + l
  if (n === 0) return null   // 이 창 안엔 이 구장 맞대결이 없다 — '표본없음'
  const points = w * 3 + d
  const h = (points + BASE_HOME * SHRINK) / (n + SHRINK)
  let label
  if (h >= BASE_HOME + MARGIN) label = '홈우세'
  else if (h <= BASE_HOME - MARGIN) label = '원정우세'
  else label = '전적보합'
  const tone = label === '홈우세' ? 'blue' : label === '원정우세' ? 'red' : 'gray'
  return {
    label,
    tone,
    w,
    d,
    l,
    n,
    title: `최근 ${RECENT_SEASONS}시즌(이번 시즌 제외, ${seasonLabel(lo, yearly)}~${seasonLabel(hi, yearly)}) 홈 상대전적.\n`
      + `${w}승 ${d}무 ${l}패 (${n}경기) → 표본보정 ${h.toFixed(2)} (평균 ${BASE_HOME.toFixed(2)})\n`
      + `기준은 위 전체 판정과 같습니다(±${MARGIN.toFixed(2)}, 보정 K=${SHRINK}) — 표본만 최근 것으로 좁혔습니다.`,
  }
}

// 상대전적 W/D/L × 핸승/핸무/무/역 집계 — HeadToHeadResult(상대전적 섹션)와 상세보기 참고 줄 전적 요약표가 같이 쓴다
// (2026-10-10 HeadToHeadResult.jsx에서 옮김 — 컴포넌트 파일이 함수를 내보내면 화면 자동 새로고침이 깨진다).
// 기간을 좁히면 위 요약표(전체기준/홈기준)도 그 기간만으로 다시 세야 한다.
// 백엔드 _wdl_breakdown(api/main.py)과 같은 규칙을 그대로 옮긴 것이다 — 기준 팀이
// 그 경기에서 홈이었든 원정이었든 실제 스코어로 W/D/L을 판정하고, 그 안에서 RT를 쪼갠다.
// 스코어가 없는 경기(예정·취소)는 백엔드와 똑같이 뺀다.
//
// 기간을 안 좁혔을 때는 이걸 쓰지 않고 백엔드 값을 그대로 쓴다 — 경기 목록은 limit으로
// 잘릴 수 있어서(총 N경기 중 최근 200경기만), 잘린 목록으로 다시 세면 백엔드 값보다
// 작게 나온다. 3·5년 창은 limit보다 훨씬 짧아 잘릴 일이 없다.
export function wdlBreakdown(matches, referenceTeam, homeOnly) {
  const out = {
    W: { total: 0, breakdown: {} },
    D: { total: 0, breakdown: {} },
    L: { total: 0, breakdown: {} },
  }
  matches.forEach((m) => {
    const hs = m.HS
    const as_ = m.AS
    if (hs === null || hs === undefined || as_ === null || as_ === undefined) return
    const rowHt = String(m.HT ?? '').trim()
    if (homeOnly && rowHt !== referenceTeam) return
    const mine = rowHt === referenceTeam ? hs : as_
    const theirs = rowHt === referenceTeam ? as_ : hs
    const letter = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'
    const lab = m.RT_label || '기타'
    out[letter].breakdown[lab] = (out[letter].breakdown[lab] || 0) + 1
    out[letter].total += 1
  })
  return out
}


// ── 1·2부 맞대결 합치기(2026-10-11 사용자 지정) ────────────────────────────────
// 서버 상대전적 응답의 matches(1부) + lower(2부, api/lower_matches.py)를 한 목록으로 — 날짜순(최신이 위).
// L = 1 · 2(1부/2부). 2부는 배당·RT가 없어 결과(승/무/패)·승점만 뜻이 있다.
// 상대전적 표·요약표, 경기지표 '참고' 줄 '전적'이 같이 쓴다. 플핸85·첫맞대결·축 판정은 1부만 그대로 쓴다(실측한 기준).
export function h2hDateKey(m) {
  const s = String(m.DT || '')
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (a) return a[0]
  const b = /^(\d{2})-(\d{2})-(\d{2})/.exec(s)
  return b ? `20${b[1]}-${b[2]}-${b[3]}` : ''
}

export function withLowerH2h(matches, lower) {
  const top = (matches || []).map((m) => ({ ...m, L: 1 }))
  if (!lower?.length) return top
  return [...top, ...lower.map((m) => ({ ...m, L: 2 }))].sort((x, y) => h2hDateKey(y).localeCompare(h2hDateKey(x)))
}
