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

// 네 칸(핸승·핸무·무·역) 중 가장 작은 하나를 배제한 이름 — 표시용 표가 쓴다.
function smallestOut(v) {
  const [hs, hm, mu, yk] = v
  const cand = [['플핸무', hs], ['플핸승', hm], ['정역', mu], ['정무', yk]]
  return cand.reduce((best, c) => (c[1] < best[1] ? c : best))[0]
}

// 픽용 이름 — 핸승과 역만 비교해 작은 쪽을 배제한다. 그래서 정무(역 배제)와
// 플핸무(핸승 배제) 둘만 나온다(CLAUDE.md 5-1의 두 주력 픽과 정확히 같다).
//
// ⚠ 왜 네 칸을 다 보지 않는가 (2026-09-06 실측, 6대리그 36,010경기 × 초기·배변) —
// 네 칸의 '예측이 되는 정도'가 전혀 다르다. 통)해 예측%를 5구간으로 나눠 각 구간의
// 실제 발생률을 재보면, 최고구간과 최저구간의 격차가
//   핸승 +33.9~35.6%p(상관 0.27~0.29) · 역 +21.3~24.8%p(0.19~0.21)
//   무   +10.6~13.1%p(0.11)          · 핸무 +0.6~6.2%p(0.025~0.034)
// 핸무는 어떤 배당에서도 그냥 23~24%로 나온다 — 예측이 안 되는 값이다
// (api/pick_ai.py 상단 주석의 "핸무는 사실상 상수" 실측과 같은 결론).
//
// 그런데 '가장 작은 하나 배제'는 그 핸무가 최소로 뽑히면 근거 없이 플핸승을 골랐고
// (전체의 12~14%), 그 구간 당첨률이 시점마다 75~79%로 흔들렸다. 초기·배변 판정이
// 서로 반대로 갈리던 것도 전부 이 구간에서 나왔다 — 진짜 신호가 아니라 동전 던지기가
// 섞여 있던 것이다(정무·플핸무를 고른 83% 구간은 두 규칙이 같은 답을 낸다).
//
// 핸무·무를 배제 후보에서 빼면 그 구간이 사라진다. 최종 판정 실측:
//   초기 82.80%→82.67% (z=-0.82, 우연 범위)  ·  배변 82.45%→83.24% (z=+5.19)
//   적중률 초기 60.35%→60.34% · 배변 60.45%→61.20%
// 핸승과 역이 같은 드문 경우(0.4%)는 플핸무로 둔다 — 어느 쪽을 배제해도 같아서다.
export function pickName(v) {
  if (!v) return null
  const [hs, , , yk] = v
  return hs <= yk ? '플핸무' : '정무'
}

// 표시용 이름 — 방향성·배당 표에 그리는 값. 한쪽 쌍이 80%+면 '정'·'플'로 뭉뚱그리고,
// 아니면 네 칸 중 가장 작은 하나를 배제한다. 픽과 달리 네 이름이 다 나온다 —
// 이 표는 "무엇이 안 나올 것 같은가"를 칸별로 뜯어보는 검토용이라 정보를 줄이지 않는다.
export function directionName(v) {
  if (!v) return null
  const [hs, hm, mu, yk] = v
  if (hs + hm >= DIR_PAIR_CUT) return '정'
  if (mu + yk >= DIR_PAIR_CUT) return '플'
  return smallestOut(v)
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

// 국내·해외 정배가 다른 경기인지 — MatchDetailModal.jsx의 '국≠해' 뱃지와 같은 기준
// (KW/KL·FW/FL, 시점과 무관한 값). '강추' 표시(리그표 이중밑줄·시스템 판정 뱃지)가
// 이 값과 '배변 판정 플핸무 + 별3개'가 겹칠 때만 뜬다 — 2026-09-06 실측: 국≠해
// 하나만으로도 플핸 확률이 64.24%(전체 46.03%)로 뛰고, 여기에 배변 판정 플핸무+★3까지
// 겹치면 66.51%까지 오른다(같은 조건인데 국=해인 경기의 플핸무+★3는 59.05%뿐이라
// 두 신호가 겹치는 게 아니라 서로 다른 정보를 더해준다 — z=3.55).
function marketFavHome(w, l) {
  const a = numOrNull(w)
  const b = numOrNull(l)
  return a !== null && b !== null && a !== b ? a < b : null
}

export function oddsFavSplit(row) {
  const dom = marketFavHome(row.KW, row.KL)
  const forr = marketFavHome(row.FW, row.FL)
  return dom !== null && forr !== null && dom !== forr
}

// 정배 뒤집힘(정역반전) — 초기에는 A팀이 정배였는데 배변에서 B팀이 정배가 된 경기.
// 배당이 좁아지기만 한 것과는 다른 사건이다: 시장의 견해가 반대편으로 넘어간 것.
// (2026-09-07, 사용자가 프로시노네 vs 베네치아에서 발견 — 국내·해외 둘 다 초기엔
//  원정이 정배였다가 배변에서 홈이 정배가 됐고, 결과는 역(플핸 적중)이었다.)
//
// 실측(6대리그, 국내·해외 배변배당이 둘 다 있는 28,638건):
//   하나라도 반전  n=1,782(6.2%)  적중 65.26% 당첨 86.36%
//   반전 없음      n=26,856       적중 44.92% 당첨 68.66%   (z=15.76, 리그 6/6)
// 배당 구간을 고정해도 살아남는다 — 배변 해외 정배배당 2.0~2.5 구간에서
// 반전 85.70% vs 없음 78.99%(+6.71%p, z=4.42). 접전(2.5+)에서는 +2.21%p로 약해진다.
// 즉 '접전이 아닌데도 접전처럼 봐야 하는 경기'를 찾아내는 신호다.
//
// ⚠ 국내 반전은 베팅 방식까지 바꾼다 — '정'과 '역'이 가리키는 팀이 바뀌기 때문에,
//   프로토(국내 시장)에서는 같은 팀에 거는 행위가 플핸이 아니라 정무가 된다.
//   해외만 반전이면 실제로 거는 시장이 아니라 플핸 그대로 가면 된다(사용자 지정).
export function favFlip(row) {
  const flipped = (wKey, lKey, ewKey, elKey) => {
    const init = marketFavHome(row[wKey], row[lKey])
    const fin = marketFavHome(row[ewKey], row[elKey])
    return init !== null && fin !== null && init !== fin
  }
  return {
    dom: flipped('KW', 'KL', 'EKW', 'EKL'),
    forr: flipped('FW', 'FL', 'EFW', 'EFL'),
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
// 2026-09-06 세 번 다시 쟀다 — ① 픽을 구체적 이름으로 바꾸면서, ② 배당 4칸 재료에서
// 승=홈팀·패=원정팀 줄을 빼면서, ③ 픽 규칙을 '핸승 vs 역'으로 바꾸면서(pickName 주석).
// 픽이 바뀌면 '픽과 같은 편' 비율도 바뀌므로 옛 표를 그대로 쓰면 안 된다.
// 전체 평균 당첨률 초기 82.67% · 배변 83.24% (적중률 초기 60.34% · 배변 61.20%).
export const ODDS_PHASE_WEIGHTED_GRADE = {
  초기: [
    { min: 0.90, rate: 85.75, n: 12356 },
    { min: 0.80, rate: 83.78, n: 5037 },
    { min: 0.65, rate: 82.08, n: 6463 },
    { min: 0.40, rate: 79.38, n: 7254 },
    { min: 0, rate: 79.20, n: 4567 },
  ],
  배변: [
    { min: 0.90, rate: 85.92, n: 12156 },
    { min: 0.80, rate: 84.38, n: 4892 },
    { min: 0.65, rate: 82.76, n: 6269 },
    { min: 0.40, rate: 80.81, n: 7182 },
    { min: 0, rate: 79.73, n: 5076 },
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

// 화면에 보여 주는 당첨률 — 위 가중 일치율 구간(ODDS_PHASE_WEIGHTED_GRADE)을 다시 픽(정무·
// 플핸무)과 강추로 쪼갠 실측값. 구간 평균은 정무·플핸무를 섞은 값이라 같은 85.92% 구간 안에서도
// 정무 89.00% ~ 플핸무·강추없음 78.88%로 벌어졌다(2026-09-10, 6대리그 배변 35,600·초기 35,702경기).
// 시즌 분할 검증(학습 ~20-21 → 검증 21-22~, 배변): 화면 %와 실제의 평균 차이 2.10→0.82%p,
// ★3−★2 실제 격차 3.87%p(z=5.30)→6.26%p(z=8.54), 6/6 리그 같은 방향(초기도 같은 모양).
// 키 = '구간 평균 %|픽|강추'. [실측 당첨률%, 표본]. 고정값 — 경기가 쌓이면 시즌마다 다시 잰다
// (화면 판정 코드를 6대리그 전 경기에 그대로 돌려 칸별로 세는 방식).
export const PHASE_CELL_RATE = {
  배변: {
    '85.92|정무': [89.00, 7090],
    '84.38|정무': [86.62, 2624],
    '84.38|플핸무|강추': [85.92, 824],
    '85.92|플핸무|강추': [85.33, 2161],
    '82.76|정무': [84.09, 3281],
    '80.81|정무': [81.61, 4128],
    '82.76|플핸무': [81.27, 2990],
    '79.73|정무': [79.73, 3724],
    '80.81|플핸무': [79.73, 3058],
    '79.73|플핸무': [79.69, 1359],
    '84.38|플핸무': [79.45, 1445],
    '85.92|플핸무': [78.88, 2916],
  },
  초기: {
    '85.75|정무': [89.07, 7130],
    '83.78|정무': [86.29, 2648],
    '82.08|정무': [83.64, 3337],
    '85.75|플핸무': [81.21, 5238],
    '83.78|플핸무': [81.00, 2390],
    '79.38|정무': [80.65, 4015],
    '82.08|플핸무': [80.40, 3128],
    '79.20|플핸무': [79.69, 1275],
    '79.20|정무': [79.02, 3298],
    '79.38|플핸무': [77.80, 3243],
  },
}

// 초기/배변 판정 하나 — pick(정무·플핸무) + 화면용 rate/n/stars(구간×픽×강추 실측) +
// verdict(적중/보험/미적, 결과가 있을 때만).
// bandRate/bandStars는 구간 평균 기준이다 — 강추 판정(strongPickTier)은 이것으로 한다.
// 강추는 '배변 플핸무 + 구간 평균 ★3'을 뼈대로 실측한 등급이라, 새 별로 판정하면
// 강추 칸만 ★3으로 남아 스스로를 정의하는 순환이 된다(강추 2,985경기는 그대로 유지).
export function phaseVerdict(row, final, label) {
  const { pick, flipped } = resolveOddsPhasePick(row, final)
  if (!pick) return { label, pick: null }
  const ratio = oddsPhaseWeightedRatio(row, pick)
  const band = ratio !== null ? weightedGradeOf(label, ratio) : null
  const bandRate = band ? band.rate : null
  const bandStars = bandRate !== null ? starsOfNew(bandRate) : null
  const strong = final && bandRate !== null ? strongPickTier(row, { pick, bandStars }) : null
  const cell = bandRate !== null
    ? PHASE_CELL_RATE[label]?.[`${bandRate.toFixed(2)}|${pick}${strong ? '|강추' : ''}`]
    : null
  const rate = cell ? cell[0] : bandRate
  const n = cell ? cell[1] : (band ? band.n : null)
  const stars = rate !== null ? starsOfNew(rate) : null
  const verdict = sysPickVerdict(pick, row.RT)
  return { label, pick, flipped, ratio, rate, n, stars, bandRate, bandStars, strong, verdict }
}

// '접전' 기준선 — 정배배당(배변 기준, 낮은 쪽)이 이 값 이상이면 접전으로 본다.
// 국내와 해외의 컷이 다른 이유: 해외는 마진이 낮아 같은 경기라도 배당값이 크다.
// 커버리지(대상 비율)를 맞춰 비교하면 해외 2.5 ≈ 국내 2.27 자리다.
//
// 2026-09-07 실측(6대리그 36,029경기) — 정배배당이 커질수록 당첨률이 계단처럼 오른다:
//   국내 2.0~2.1 79.55% / 2.1~2.2 81.17% / 2.2~2.3 83.35% / 2.3~2.4 83.58%
// 국내는 2.2·2.25·2.3 어디를 잘라도 통계적으로 구분되지 않아(z −1.1~−1.5) 경기 수를
// 가장 많이 남기는 2.25로 정했다(사용자 지정).
//
// 같은 커버리지에서 국내 vs 해외를 맞대면 해외가 모든 구간에서 1~1.5%p 높다
// (10% 84.66 vs 86.14 / 20% 84.27 vs 85.30 / 30% 83.31 vs 84.66) — 이 앱에 이미
// 확립된 '해배가 국배보다 낫다'(+1.8%p)와 같은 방향이다. 그래서 해외 단독 조건은
// 등급으로 쓰고(강추·해배), 국내 단독 조건은 쓰지 않는다(아래 strongPickTier 주석).
export const CLOSE_ODDS_CUT_K = 2.25   // 국내 정배배당
export const CLOSE_ODDS_CUT_F = 2.5    // 해외 정배배당

// 강추 3등급 — 뼈대(배변 판정 플핸무 + ★3, n=7,344 · 당첨 81.67%)는 같고,
// 배당이 어떤 모양이냐로 갈린다. 2026-09-07 실측(6대리그 36,029경기).
//
//   초강추·국≠해     국≠해                       n=842   적중 66.51% 당첨 85.39%
//   초강추·통합      국=해 + 국배 2.25↑ + 해배 2.5↑  n=780   적중 63.72% 당첨 85.77%
//   강추·해배        국=해 + 해배 2.5↑만            n=1,097 적중 65.91% 당첨 84.96%
//   강추·반전        위 셋에 안 걸린 정역반전 경기     n=264   적중 68.94% 당첨 87.12%
//   (넷 합계 n=2,983 · 뼈대의 40.6% · 전체 경기의 8.3% · 당첨 85.49%)
//
// '강추·반전'을 맨 마지막에 두는 이유 — 반전(favFlip)은 이미 등급이 붙은 칸에는
// 추가 정보가 거의 없고(초강추·국≠해 −0.65%p · 통합 +2.51%p · 해배 +3.98%p, z 전부
// 1.5 미만), 등급이 없던 칸에서만 크게 작동한다(+8.06%p, z=3.15, 리그 5/6 —
// 에레디비지만 −5.45p). 서로 겹치지 않는 정보라 등급을 하나 더 두는 게 맞다.
// 넣어도 전체 당첨률이 85.33% → 85.49%로 오히려 오른다(손해 없이 대상만 늘어난다).
//
// ⚠ '국배만'(국=해 + 국배 2.25↑ + 해배 미달)은 일부러 뺐다 — n=603, 당첨 82.09%로
//   뼈대 평균보다 +0.42%p뿐이고, 강추가 안 뜨는 경기(79.14%) 대비 z=1.67에 리그
//   재현성 4/6(라리가 −0.6p · 세리에 −1.7p)이라 신호로 볼 수 없다. 넣으면 전체
//   당첨률이 85.31% → 84.74%로 내려간다. 국내배당 단독으로는 접전을 못 잡아낸다.
//
// 강추가 안 뜨는 경기(79.14%, n=4,022) 대비 검정:
//   국≠해 +6.25%p z=4.14 (리그 6/6) · 통합 +6.63%p z=4.25 (6/6)
//   해배     +5.82%p z=4.30 (6/6)      · 국배만 +2.95%p z=1.67 (4/6) ← 탈락
//
// ★ 접전은 '배변(최신) 배당'으로 판정한다 — 초기 배당이 아니다.
//   경계를 넘나든 경기만 따로 재면 배당이 움직인 방향 자체가 신호다(뼈대+국=해 6,502건):
//     국내(컷 2.25) 둘 다 통과 84.26% / 배변만 통과 83.52% / 배변에서 이탈 76.36% / 둘 다 미달 80.25%
//     해외(컷 2.50) 둘 다 통과 85.57% / 배변만 통과 85.10% / 배변에서 이탈 81.98% / 둘 다 미달 79.11%
//   접전에서 빠져나간 경기는 애초에 접전이 아니던 경기보다도 낮다(국내 z=−2.14).
//   배변 배당이 아직 없는 경기(16.1%)는 초기 배당으로 대신 본다.
//   CLAUDE.md 4-1(배당이 갱신되면 그 배당으로 다시 판정한다)과도 맞는다.
//
// 화면 표시는 셋을 구분해 보여주되(나중에 어느 길이 잘 맞았는지 따로 집계하려고),
// 리그표 '판정' 칸 이중밑줄과 배지 색(보라)은 셋 다 똑같이 쓴다(사용자 지정).
// 배변 판정에만 쓴다 — 호출하는 쪽에서 배변 phaseVerdict만 넘긴다.
// 별은 구간 평균 별(bandStars)로 본다 — 화면 별(stars)은 칸별 실측이라 여기 쓰면 순환이 된다.
export function strongPickTier(row, verdict) {
  if (!verdict.pick || verdict.pick !== '플핸무' || verdict.bandStars !== 3) return null
  // 배변(E*) 우선, 없으면 초기로 대신한다.
  const pick2 = (a, b) => [numOrNull(row[a]) ?? numOrNull(row[b])]
  const [kw] = pick2('EKW', 'KW')
  const [kl] = pick2('EKL', 'KL')
  const [fw] = pick2('EFW', 'FW')
  const [fl] = pick2('EFL', 'FL')
  const kClose = kw !== null && kl !== null && Math.min(kw, kl) >= CLOSE_ODDS_CUT_K
  const fClose = fw !== null && fl !== null && Math.min(fw, fl) >= CLOSE_ODDS_CUT_F
  if (oddsFavSplit(row)) return '초강추·국≠해'
  if (kClose && fClose) return '초강추·통합'
  if (fClose) return '강추·해배'
  const flip = favFlip(row)
  if (flip.dom || flip.forr) return '강추·반전'
  return null   // 국배만 충족(반전도 없음)은 등급을 주지 않는다(위 ⚠ 주석)
}

// 등급별 근거 문구 — 리그표 title과 상세보기 배지 tooltip이 같이 쓴다.
export const STRONG_TIER_TITLE = {
  '초강추·국≠해': '초강추 · 국≠해 — 국내·해외 정배가 서로 다른 팀인 경기의'
    + ' 배변 플핸무 별3개. 6대리그 실측 당첨률 85.39%(적중 66.51%, n=842).',
  '초강추·통합': `초강추 · 통합 — 국내·해외 정배가 같으면서 양쪽 배당이 모두 접전인 경기`
    + `(배변 국내 정배배당 ${CLOSE_ODDS_CUT_K}↑ · 해외 ${CLOSE_ODDS_CUT_F}↑)의 배변 플핸무 별3개.`
    + ' 6대리그 실측 당첨률 85.77%(적중 63.72%, n=780).',
  '강추·해배': `강추 · 해배 — 해외 배당만 접전인 경기(배변 해외 정배배당 ${CLOSE_ODDS_CUT_F}↑).`
    + ' 6대리그 실측 당첨률 84.96%(적중 65.91%, n=1,097).'
    + ' 국내만 접전인 경우는 실측에서 신호가 없어(z=1.67, 리그 4/6) 등급을 주지 않습니다.',
  '강추·반전': '강추 · 반전 — 접전 조건에는 안 걸렸지만 정배가 뒤집힌 경기(초기엔 A팀이'
    + ' 정배였는데 배변에서 B팀이 정배가 됨). 6대리그 실측 당첨률 87.12%(적중 68.94%,'
    + ' n=264) — 네 등급 중 가장 높습니다.'
    + '\n⚠ 국내배당이 뒤집힌 경기라면 프로토에서는 플핸이 아니라 정무로 걸어야 같은'
    + ' 베팅이 됩니다(정·역이 가리키는 팀이 바뀌기 때문). 경기지표 줄의 정역반전'
    + ' 뱃지에서 어느 시장이 뒤집혔는지 확인하세요.',
}
