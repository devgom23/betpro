// 상대전적 우세 판정 — 홈우세 / 홈만우세 / 전적보합 / 원정만우세 / 원정우세.
//
// 두 축을 각각 우세·보합·열세로 나눈 뒤 3x3을 5칸으로 접는다(기준팀 = 그 경기의 홈팀):
//   전체기준 = 그 상대와의 모든 맞대결에서 홈팀의 승/무/패
//   홈기준   = 그중 홈팀이 실제로 홈이었던 경기만
//
//   전체우세 + 홈열세아님 → 홈우세      (전체적으로 원정팀에게 안 진다)
//   홈우세 + 전체우세아님 → 홈만우세    (전적은 밀려도 홈에서만은 안 진다)
//   전체열세 + 홈우세아님 → 원정우세    (전체적으로 원정팀이 지지 않는다)
//   홈열세 + 전체열세아님 → 원정만우세  (이 구장에서만 원정팀이 지지 않는다)
//   나머지                → 전적보합
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
// [3] 여유폭 ±0.30인 이유 — 판정 분포가 이렇게 갈린다:
//       ±0.25 → 홈우세 28% / 홈만우세 6% / 보합 31% / 원정만우세 6% / 원정우세 29%
//       ±0.30 → 홈우세 23% / 홈만우세 5% / 보합 42% / 원정만우세 6% / 원정우세 25%
//       ±0.35 → 홈우세 20% / 홈만우세 5% / 보합 49% / 원정만우세 4% / 원정우세 21%
//     ±0.30이면 판정 불가(보합)가 절반 아래고 우세/열세가 4경기에 1번 꼴로 뜬다.
//
// [4] '~만우세'가 4~6%로 작은 건 구조적이다 — 홈경기가 전체 전적 안에 이미 들어
//     있어서 두 축이 엇갈리기 어렵다. 실측에서 '전체우세인데 홈열세'와 '전체열세인데
//     홈우세'는 41,933건 중 **0건**이었다(모순 조합은 아예 안 나온다).
const BASE_ALL = 1.363
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
 * @param {object} wdlAll  전체기준 wdl_summary
 * @param {object} wdlHome 홈기준 wdl_summary_home
 * @returns {{label, tone, title}|null} 맞대결 기록이 없으면 null
 */
export function h2hVerdict(wdlAll, wdlHome) {
  const ta = tally(wdlAll)
  if (!ta) return null                      // 첫 맞대결 — 판정할 게 없다
  const th = tally(wdlHome)
  const a = adjusted(ta, BASE_ALL)
  const h = adjusted(th, BASE_HOME)

  const aHi = a >= BASE_ALL + MARGIN
  const aLo = a <= BASE_ALL - MARGIN
  const hHi = h !== null && h >= BASE_HOME + MARGIN
  const hLo = h !== null && h <= BASE_HOME - MARGIN

  let label
  if (aHi && !hLo) label = '홈우세'
  else if (hHi && !aHi) label = '홈만우세'
  else if (aLo && !hHi) label = '원정우세'
  else if (hLo && !aLo) label = '원정만우세'
  else label = '전적보합'

  // 색은 앱 전체 축 그대로 — 홈 쪽=파랑 / 원정 쪽=빨강 / 판정 불가=회색.
  // ('만'이 붙은 것도 같은 색을 쓴다 — 글자로 이미 구분되고, 5색 스케일을 새로
  //  만들면 이 앱의 파랑/빨강 축과 싸운다.)
  const tone = label.startsWith('홈') ? 'blue' : label.startsWith('원정') ? 'red' : 'gray'

  const fmt = (t, adj, base) => (t
    ? `${t.w}승 ${t.d}무 ${t.l}패 (${t.n}경기) 승점/경기 ${(t.points / t.n).toFixed(2)}`
      + ` → 표본보정 ${adj.toFixed(2)} (평균 ${base.toFixed(2)})`
    : '없음')

  return {
    label,
    tone,
    title: `홈팀 기준 상대전적 판정.\n`
      + `전체기준: ${fmt(ta, a, BASE_ALL)}\n`
      + `홈기준: ${fmt(th, h, BASE_HOME)}\n`
      + `기준: 표본보정 승점이 평균에서 ±${MARGIN.toFixed(2)} 넘게 벗어나면 우세/열세.`
      + ` 표본이 작으면 평균 쪽으로 끌어당겨(가상의 평균 경기 ${SHRINK}판을 섞어) 판정한다.`,
  }
}
