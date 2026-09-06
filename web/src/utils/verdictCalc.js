// 시스템 판정(새) — 픽은 배당 표 4칸, 신뢰도는 방향성 8칸(표본 가중)에서 낸다.
// MatchDetailModal.jsx(상세보기 '시스템 판정' 줄)과 LeagueTable.jsx(리그표 '판정' 칸)가
// 이 파일 하나를 같이 쓴다 — 따로 두면 두 화면이 같은 경기에 서로 다른 답을 낼 수 있다.
// 실측 근거·설계 이유는 이 함수들이 있던 자리(MatchDetailModal.jsx, 2026-09-06)의
// 주석에 원래 다 있었다 — 옮기면서 요약만 남겼다.

import { sysPickVerdict } from './systemVerdict'

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// 표본이 이만큼이면 그 줄을 '절반쯤' 믿는다 — 단계 가중치(줄 순서)와 표본 신뢰도
// (n/(n+SHRINK))를 곱해서, 표본이 적은 줄이 순서만으로 결론을 뒤집지 못하게 한다.
const SAMPLE_SHRINK = 10

export function weightedAnalysis(lines) {
  const acc = [0, 0, 0, 0]
  let wSum = 0
  lines.forEach((l, i) => {
    if (l.total <= 0) return
    const w = (i + 1) * (l.total / (l.total + SAMPLE_SHRINK))
    wSum += w
    for (let k = 0; k < 4; k += 1) acc[k] += (l.vals[k] / l.total) * 100 * w
  })
  if (wSum <= 0) return null
  return acc.map((v) => v / wSum)
}

// '가장 작은 하나를 배제'만 쓰면 정·플은 배제 대상이 둘이라 단일보다 작아지기가
// 거의 불가능해 사실상 안 나온다 — 그래서 한쪽 쌍이 압도적일 때만(80%+) 정·플을
// 먼저 집는다(실측으로 고른 기준선).
const DIR_PAIR_CUT = 80

// 픽용 이름 — 언제나 구체적인 넷(정무·정역·플핸무·플핸승) 중 하나를 낸다.
// '가장 작은 하나 배제'만 쓰므로 '정'·'플' 같은 일반값이 나오지 않는다.
//
// ⚠ 이게 directionName과 갈라져 있는 이유 (2026-09-06 실측) — 일반값은 표에 "한쪽 쌍이
// 압도적"임을 보여주려고 만든 표시용 개념인데, 그게 픽 계산까지 흘러들어가 사고를 냈다.
//   ① 통)해가 일반값이면 픽도 일반값이 되는데, 적중/보험 판정표(VERDICT_RULE)에는
//      구체적 이름만 있어 배지가 아예 안 떴다 — 초기 1,710건·배변 2,012건(전체의 5~6%).
//   ② 고립 뒤집기가 '리)해가 구체적일 때만' 발동하게 되어, 리)해가 일반값이면 통)해가
//      나머지 3칸과 완전히 반대인데도 그대로 픽이 됐다(사용자가 브레스트 경기에서 발견).
// 픽에서만 80% 규칙을 끄면 둘 다 사라진다. 실측(6대리그 36,010경기 × 초기·배변):
//   판정불가 3,722건 → 0건, 당첨률 초기 82.27%→82.82% · 배변 81.54%→82.29%,
//   적중률 초기 59.20%→60.32% · 배변 58.85%→60.30% (6개 리그 전부 같은 방향).
export function pickName(v) {
  if (!v) return null
  const [hs, hm, mu, yk] = v
  const cand = [['플핸무', hs], ['플핸승', hm], ['정역', mu], ['정무', yk]]
  return cand.reduce((best, c) => (c[1] < best[1] ? c : best))[0]
}

// 표시용 이름 — 방향성·배당 표에 그리는 값. 한쪽 쌍이 80%+면 '정'·'플'로 뭉뚱그린다.
export function directionName(v) {
  if (!v) return null
  const [hs, hm, mu, yk] = v
  if (hs + hm >= DIR_PAIR_CUT) return '정'
  if (mu + yk >= DIR_PAIR_CUT) return '플'
  return pickName(v)
}

// 정무·정역·정 = 정 방향(핸승+핸무 쪽 유력), 플핸무·플핸승·플 = 플 방향(무+역 쪽).
export const DIR_SIDE = { 정무: '정', 정역: '정', 정: '정', 플핸무: '플', 플핸승: '플', 플: '플' }

// 방향성 8칸(리그/통합 × 국/해)의 재료 — 승+패·승+무+패 두 줄만.
export const SCOPE_CODES = {
  리그: { 국: ['K-WL', 'K-WDL'], 해: ['F-WL', 'F-WDL'] },
  통합: { 국: ['TK-WL', 'TK-WDL'], 해: ['TF-WL', 'TF-WDL'] },
}

// name = 표에 그리는 이름(일반값 가능) / pick = 픽 계산에 쓰는 구체적 이름.
export function scopeCell(row, codes, final) {
  const lines = codes.map((code) => {
    const vals = [1, 2, 3, 4].map((i) => {
      const v = numOrNull(row[`${final ? 'E_' : ''}${code} ${i}`])
      return v === null ? 0 : Math.trunc(v)
    })
    return { vals, total: vals.reduce((a, b) => a + b, 0) }
  })
  const v = weightedAnalysis(lines)
  return {
    name: v ? directionName(v) : null,
    pick: v ? pickName(v) : null,
    total: lines.reduce((a, l) => a + l.total, 0),
  }
}

// 배당 표 4칸(리)국·리)해·통)국·통)해)의 재료 — 정배 방향(FW/FL, KW/KL)에 따라
// 승 또는 패 한 줄만 고른다.
//
// ⚠ 2026-09-06: '승=홈팀·패=원정팀' 줄을 재료에서 뺐다. 그 줄은 조건이 가장 빡세
// 표본이 늘 제일 적은데(리)해 중앙값 6건 · 리)국 1건), 하필 배열 맨 뒤라 위치
// 가중치를 제일 크게 받아 비중이 과했다 — 리)해에서는 표본 6건짜리가 평균 40.5%를
// 먹었고, 3경기 중 1경기(34.4%)는 '표본이 제일 적은 줄이 비중이 제일 큰 줄'이었다.
// 그 결과 표본 몇 건짜리의 0이 전체 최소칸을 정해 이름이 뒤집히는 일이 생겼다
// (사용자 제보: 발렌시아·함부르크 경기).
// 6대리그 36,010경기 × 초기·배변 실측 — 빼면 칸 정확도가 오른다:
//   리)해 당첨률 초기 80.18%→81.33%(z=5.87) · 배변 80.16%→81.84%(z=9.03)
//   리)국 당첨률 초기 80.15%→80.16%(z=0.04) · 배변 78.71%→78.97%(z=1.77)
//   최종 판정   초기 82.82%→82.80%(z=-0.24) · 배변 82.29%→82.45%(z=2.19)
// 리)국은 이득이 거의 없지만 손해도 없고, 빼면 리)국·통)국이 '승·패 + 플핸'으로
// 같은 모양이 되어 국내·통합의 구성이 대칭이 된다.
export function oddsScopeCodes(row) {
  const dirOf = (wKey, lKey) => {
    const w = numOrNull(row[wKey])
    const l = numOrNull(row[lKey])
    return (w === null || l === null || w === l) ? null : (w < l ? 'W' : 'L')
  }
  const dom = dirOf('KW', 'KL')
  const forr = dirOf('FW', 'FL')
  return {
    리국: [dom && `K-${dom}`, 'K-PL'].filter(Boolean),
    리해: [forr && `F-${forr}`].filter(Boolean),
    통국: [dom && `TK-${dom}`, 'TK-PL'].filter(Boolean),
    통해: [forr && `TF-${forr}`].filter(Boolean),
  }
}

const DIR_CAP_N = 40

// 뒤집을 때 대안을 찾는 순서 — 해외 우선, 그다음 통합 우선(앱 전체의 기존 원칙).
const FLIP_ORDER = ['리해', '통국', '리국']

// 픽 — 배당 표 4칸 중 통)해가 기본. 나머지 3칸이 **전부** 반대편이면(고립) 그쪽으로 뒤집는다.
//
// 뒤집는 범위를 '완전 고립'까지로 묶은 근거 (6대리그 36,010경기 × 초기·배변 실측):
//   · 한 칸이라도 통)해 편이면(2칸만 반대) 그때도 뒤집으면 오히려 손해다
//     — 초기 z=-3.70, 배변 z=-3.46으로 둘 다 뚜렷하게 나빠진다.
//   · 완전 고립일 때 뒤집는 것 자체의 이득은 사실상 0이다(초기 z=-1.65, 배변 z=+1.64로
//     방향이 시점마다 갈린다). 그래도 남겨 둔 이유는 실측이 동률이기 때문 —
//     4칸 중 3칸이 반대인데 소수를 따라가는 화면은 볼 때마다 의심하게 된다.
//
// 예전에는 이 뒤집기가 '리)해가 구체적 이름일 때만' 발동해서, 리)해가 일반값이면
// 고립인데도 통)해가 그대로 픽이 됐다(pickName 주석의 ② 참고). 이제 4칸 모두 pick으로
// 계산하므로 일반값이 없고, 그 빈틈도 없다.
export function resolveOddsPhasePick(row, final) {
  const codes = oddsScopeCodes(row)
  const pickOf = (key) => scopeCell(row, codes[key], final).pick
  const picks = { 리국: pickOf('리국'), 리해: pickOf('리해'), 통국: pickOf('통국'), 통해: pickOf('통해') }
  const base = picks.통해
  if (!base) return { pick: null, flipped: false }
  const others = FLIP_ORDER.map((k) => picks[k]).filter(Boolean)
  const agree = others.filter((n) => DIR_SIDE[n] === DIR_SIDE[base]).length
  if (others.length > 0 && agree === 0) {
    const want = DIR_SIDE[base] === '정' ? '플' : '정'
    const alt = FLIP_ORDER.map((k) => picks[k]).find((n) => n && DIR_SIDE[n] === want)
    if (alt) return { pick: alt, flipped: true }
  }
  return { pick: base, flipped: false }
}

// 신뢰도 — 방향성 8칸(시점 안 가림) 중 이 픽과 같은 편인 '표본 가중 비율'(0~1).
// 칸마다 1표가 아니라 표본 수(40에서 상한)만큼 가중한다 — 실측(cap 5~100 스윕)으로
// 40이 최적이었다. 표본 있는 칸이 하나도 없으면(극히 드묾, 0.1%) null.
export function oddsPhaseWeightedRatio(row, pick) {
  if (!pick || !DIR_SIDE[pick]) return null
  let num = 0
  let den = 0
  for (const sc of ['리그', '통합']) {
    for (const mkt of ['국', '해']) {
      for (const final of [false, true]) {
        const { name, total } = scopeCell(row, SCOPE_CODES[sc][mkt], final)
        if (name && DIR_SIDE[name] && total > 0) {
          const w = Math.min(total, DIR_CAP_N)
          den += w
          if (DIR_SIDE[name] === DIR_SIDE[pick]) num += w
        }
      }
    }
  }
  return den > 0 ? num / den : null
}

// [하한, 당첨률%, 표본] — 표본 가중 일치 비율 구간별(6대리그 실측, 커버리지 99.9%).
// 2026-09-06 두 번 다시 쟀다 — ① 픽을 구체적 이름으로 바꾸면서, ② 배당 4칸 재료에서
// 승=홈팀·패=원정팀 줄을 빼면서(oddsScopeCodes 주석). 픽이 바뀌면 '픽과 같은 편' 비율도
// 바뀌므로 옛 표를 그대로 쓰면 안 된다. 전체 평균 당첨률 초기 82.80% · 배변 82.45%
// (적중률 초기 60.35% · 배변 60.44%).
export const ODDS_PHASE_WEIGHTED_GRADE = {
  초기: [
    { min: 0.90, rate: 85.35, n: 12318 },
    { min: 0.80, rate: 83.35, n: 5032 },
    { min: 0.65, rate: 82.20, n: 6505 },
    { min: 0.40, rate: 80.28, n: 7297 },
    { min: 0, rate: 80.13, n: 4525 },
  ],
  배변: [
    { min: 0.90, rate: 85.71, n: 12285 },
    { min: 0.80, rate: 83.78, n: 4963 },
    { min: 0.65, rate: 81.63, n: 6397 },
    { min: 0.40, rate: 79.75, n: 7216 },
    { min: 0, rate: 77.83, n: 4714 },
  ],
}

function weightedGradeOf(label, ratio) {
  const rows = ODDS_PHASE_WEIGHTED_GRADE[label]
  for (const row of rows) {
    if (ratio >= row.min) return row
  }
  return rows[rows.length - 1]
}

export function starsOfNew(rate) {
  if (rate >= 83) return 3
  if (rate >= 78) return 2
  return 1
}

// 초기/배변 판정 하나 — pick(정무·플핸무 등) + stars(1~3) + rate/n(실측 근거) +
// verdict(적중/보험/미적, 결과가 있을 때만).
export function phaseVerdict(row, final, label) {
  const { pick, flipped } = resolveOddsPhasePick(row, final)
  if (!pick) return { label, pick: null }
  const ratio = oddsPhaseWeightedRatio(row, pick)
  const cell = ratio !== null ? weightedGradeOf(label, ratio) : null
  const rate = cell ? cell.rate : null
  const n = cell ? cell.n : null
  const stars = rate !== null ? starsOfNew(rate) : null
  const verdict = sysPickVerdict(pick, row.RT)
  return { label, pick, flipped, ratio, rate, n, stars, verdict }
}
