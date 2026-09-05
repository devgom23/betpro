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

export function directionName(v) {
  if (!v) return null
  const [hs, hm, mu, yk] = v
  if (hs + hm >= DIR_PAIR_CUT) return '정'
  if (mu + yk >= DIR_PAIR_CUT) return '플'
  const cand = [['플핸무', hs], ['플핸승', hm], ['정역', mu], ['정무', yk]]
  return cand.reduce((best, c) => (c[1] < best[1] ? c : best))[0]
}

// 정무·정역·정 = 정 방향(핸승+핸무 쪽 유력), 플핸무·플핸승·플 = 플 방향(무+역 쪽).
export const DIR_SIDE = { 정무: '정', 정역: '정', 정: '정', 플핸무: '플', 플핸승: '플', 플: '플' }

// 방향성 8칸(리그/통합 × 국/해)의 재료 — 승+패·승+무+패 두 줄만.
export const SCOPE_CODES = {
  리그: { 국: ['K-WL', 'K-WDL'], 해: ['F-WL', 'F-WDL'] },
  통합: { 국: ['TK-WL', 'TK-WDL'], 해: ['TF-WL', 'TF-WDL'] },
}

export function scopeCell(row, codes, final) {
  const lines = codes.map((code) => {
    const vals = [1, 2, 3, 4].map((i) => {
      const v = numOrNull(row[`${final ? 'E_' : ''}${code} ${i}`])
      return v === null ? 0 : Math.trunc(v)
    })
    return { vals, total: vals.reduce((a, b) => a + b, 0) }
  })
  const v = weightedAnalysis(lines)
  return { name: v ? directionName(v) : null, total: lines.reduce((a, l) => a + l.total, 0) }
}

// 배당 표 4칸(리)국·리)해·통)국·통)해)의 재료 — 정배 방향(FW/FL, KW/KL)에 따라
// 승 또는 패 한 줄만 고른다.
export function oddsScopeCodes(row) {
  const dirOf = (wKey, lKey) => {
    const w = numOrNull(row[wKey])
    const l = numOrNull(row[lKey])
    return (w === null || l === null || w === l) ? null : (w < l ? 'W' : 'L')
  }
  const dom = dirOf('KW', 'KL')
  const forr = dirOf('FW', 'FL')
  return {
    리국: [dom && `K-${dom}`, 'K-PL', dom && `K-${dom === 'W' ? 'W-HT' : 'L-AT'}`].filter(Boolean),
    리해: [forr && `F-${forr}`, forr && `F-${forr === 'W' ? 'W-HT' : 'L-AT'}`].filter(Boolean),
    통국: [dom && `TK-${dom}`, 'TK-PL'].filter(Boolean),
    통해: [forr && `TF-${forr}`].filter(Boolean),
  }
}

const SINGLE_DIR_NAMES = new Set(['정무', '정역', '플핸무', '플핸승'])
const DIR_CAP_N = 40

// 픽 — 배당 표 4칸 중 통)해를 기본으로, 나머지 3칸과 전부 다르면(고립) 리)해로 뒤집는다.
export function resolveOddsPhasePick(row, final) {
  const codes = oddsScopeCodes(row)
  const nameOf = (key) => scopeCell(row, codes[key], final).name
  const names = { 리국: nameOf('리국'), 리해: nameOf('리해'), 통국: nameOf('통국'), 통해: nameOf('통해') }
  const base = names.통해
  if (!base || !DIR_SIDE[base]) return { pick: null, flipped: false }
  const others = [names.리국, names.리해, names.통국]
  const agree = others.filter((n) => n && DIR_SIDE[n] === DIR_SIDE[base]).length
  if (agree === 0 && names.리해 && SINGLE_DIR_NAMES.has(names.리해)) {
    return { pick: names.리해, flipped: true }   // 고립 → 리)해로 뒤집음(해외 우선 원칙 유지)
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

// [하한, 적중률%, 표본] — 표본 가중 일치 비율 구간별(6대리그 실측, 커버리지 99.9%).
export const ODDS_PHASE_WEIGHTED_GRADE = {
  초기: [
    { min: 0.90, rate: 84.55, n: 10854 },
    { min: 0.80, rate: 82.93, n: 4769 },
    { min: 0.65, rate: 82.11, n: 6338 },
    { min: 0.40, rate: 80.40, n: 7205 },
    { min: 0, rate: 79.49, n: 4778 },
  ],
  배변: [
    { min: 0.90, rate: 84.32, n: 10622 },
    { min: 0.80, rate: 83.06, n: 4686 },
    { min: 0.65, rate: 81.26, n: 6250 },
    { min: 0.40, rate: 79.40, n: 7120 },
    { min: 0, rate: 77.52, n: 4863 },
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
