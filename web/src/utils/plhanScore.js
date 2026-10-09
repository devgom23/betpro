// 상세보기 경기지표 '플핸 확률' 칩(패턴분석-02, 2026-10-09) — 칩은 MatchDetailModal.jsx plhanChips, 근거 팝업은 PlhanScore.jsx.
// 컴포넌트 파일이 함수까지 내보내면 화면 즉시 반영(fast refresh)이 깨져 따로 둔다.
//
// 플핸 확률 = 서버(api/plhan_score.py)가 주는 '시장이 본 플핸 확률'·계수·등급표 + 화면이 판정한 근거(플축·플핸85).
//   logit P = 절편 + 기울기·logit(시장 확률) + [기존 점수 4점↑] + [플축] + [플핸85]   (마감판)
//   마감(Bet365 최신배당) 전에는 초기판: 12사 초기 + 국내 초기 + [플축]  — CLAUDE.md 4-1(있는 배당으로 결론을 낸다)
// 계수는 서버 stats.json의 unified에서 온다 — 여기 숫자를 적어 두지 않는다(재학습하면 같이 바뀐다).

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const logit = (p) => {
  const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4)
  return Math.log(q / (1 - q))
}

// 시장 확률 칸 — 서버 market의 어느 값을 쓰나
const MARKET_KEYS = { mkt: 'close', mkt_init: 'init', mkt_k: 'k' }

// 근거 이름(팝업 표의 줄 이름)
export const UNI_TERM_NAMES = {
  pt45: '기존 점수 4점 이상',
  axpl: '플축',
  axpl_init: '플축',
  p85: '플핸85',
  first: '첫맞대결',
}

// 등급 — 서버 unified.cuts(75 / 65 / 55%)와 같은 순서. tone은 칩 색(--chip-*).
export const UNI_GRADES = [
  { key: 'top', label: '75% 이상', tone: 'red', hl: true },
  { key: 'hi', label: '65~75%', tone: 'red' },
  { key: 'mid', label: '55~65%', tone: 'red-soft' },
  { key: 'low', label: '55% 미만', tone: 'gray', dim: true },
]

export function uniGradeOf(p, cuts) {
  const cs = cuts?.length === 3 ? cuts : [0.75, 0.65, 0.55]
  const i = cs.findIndex((c) => p >= c)
  return UNI_GRADES[i === -1 ? 3 : i]
}

/**
 * 이 경기의 플핸 확률.
 * @param d     /api/plhan_score 응답
 * @param flags { axpl, p85 } — true/false, 아직 판정 재료(표본·전적)를 못 받았으면 null
 * @returns null(낼 수 없음) | { phase: 'close'|'init', p, base, terms, grade, gradeStats, pending, market }
 *   base = 시장 확률만으로 낸 출발점, terms = 근거별 { key, name, on, delta(더한 몫) }
 */
export function plhanUnified(d, flags) {
  const u = d?.unified
  const m = d?.market
  if (!d?.ready || !u?.close || !u?.init || !m) return null
  const phase = d.state === 'ok' ? 'close' : 'init'
  const model = u[phase]
  const on = {
    pt45: phase === 'close' && (d.score ?? 0) >= 4,
    axpl: flags?.axpl ?? null,
    axpl_init: flags?.axpl ?? null,
    p85: flags?.p85 ?? null,
    first: flags?.first ?? null,
  }
  let z = model.intercept
  for (const t of model.terms) {
    const mk = MARKET_KEYS[t.key]
    if (!mk) continue
    if (m[mk] === null || m[mk] === undefined) return null
    z += t.coef * logit(m[mk])
  }
  const base = sigmoid(z)
  const terms = model.terms.filter((t) => !MARKET_KEYS[t.key]).map((t) => {
    const before = sigmoid(z)
    if (on[t.key]) z += t.coef
    return { key: t.key, name: UNI_TERM_NAMES[t.key] || t.key, on: on[t.key], coef: t.coef, delta: on[t.key] ? sigmoid(z) - before : 0 }
  })
  const p = sigmoid(z)
  const grade = uniGradeOf(p, u.cuts)
  return {
    phase, p, base, terms, grade,
    gradeStats: u[`${phase}_grades`]?.[grade.key] ?? null,
    pending: terms.some((t) => t.on === null),
    market: phase === 'close'
      ? { p: m.close, src: m.close_src }
      : { p: m.init, src: m.init_src, k: m.k },
  }
}

// 근거가 켜졌다면 지금 확률에서 얼마나 더해졌을까(팝업의 '켜지면 +x%p' 안내용).
export function uniIfOn(p, coef) {
  return sigmoid(logit(p) + coef) - p
}

export function plhanChipText(d, uni) {
  if (!d?.ready) return null
  if (!uni) return '—'
  return `${Math.round(uni.p * 100)}%`
}

export function plhanChipTitle(d, uni) {
  if (!d?.ready) return d?.reason || ''
  if (!uni) return '플핸 확률 — 서버 학습 파일에 확률 공식이 없습니다. 터미널에서 python api/plhan_score.py train 을 한 번 돌려 주세요.'
  const g = uni.gradeStats
  const on = uni.terms.filter((t) => t.on).map((t) => `${t.name} +${(t.delta * 100).toFixed(1)}%p`)
  return `플핸 확률 ${(uni.p * 100).toFixed(1)}% — 단통 플핸(무+역)이 나올 확률 (패턴분석-02)\n`
    + `${uni.phase === 'init' ? '마감(최신) 배당 전이라 초기 배당으로 낸 값입니다.\n' : ''}`
    + `시장이 본 플핸 ${(uni.market.p * 100).toFixed(1)}%(${uni.market.src}) → 출발점 ${(uni.base * 100).toFixed(1)}%`
    + `${on.length ? ` · ${on.join(' · ')}` : ' · 더할 근거 없음'}${uni.pending ? ' · 플축·전적 판정 중' : ''}\n`
    + (g ? `${uni.grade.label} 등급 지난 경기 실제 ${g.rate}% (${g.hit}/${g.n})\n` : '')
    + '누르면 계산 근거를 봅니다.'
}
