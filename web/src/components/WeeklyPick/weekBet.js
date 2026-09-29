// 이번주 픽 카드 보드·사다리 벳의 계산(2026-09-27 사용자 지정 — 목업 web/public/mockups/weekly_pick_mock.html).
//
// 카드에서 고른 칸 하나 = 선택(sel) 하나: { m, i }
//   m = 'k'      국내 승무패(KW/KD/KL)
//       'h'      국내 기본 핸디(KHW/KHD/KHL, 기준점 KH)
//       'x:<줄>' 추가 핸디(±2·±3.5, api/kr_extra_odds — 줄은 홈 기준 부호, 예 'x:-2')
//   i = 0 홈 승 / 1 무 / 2 원정 승(패)
// 한 경기에서 고른 칸이 1개면 '축', 2개 이상이면 '복수' — 가로(승+무)든 세로(국배 무 + 핸디 핸무)든.
// 사다리 = 경기 하나가 한 층, 각 층에서 하나씩 골라 내려가는 모든 경로가 조합 한 줄. 층 수 제한 없음
// (예전 이번주 벳의 '선택 1~4' 제한을 풀었다).
//
// 베팅내역 등록은 기존 /api/bet_slips 형식 그대로다 — 다리마다 pick_type(정·역·무·핸승·핸무·플핸,
// 2핸승·2핸무·2플핸·3.5핸승·3.5플핸)으로 바꿔 보낸다(api/bet_slips.py judge_leg·kr_extra_odds.judge가 판정).
import { bettingDayOf } from '../LeagueTable/columnGroups'
import { homeIsFavNow } from '../../utils/extraOdds'

export const LAB = ['승', '무', '패']

// 내픽이 정 계열이면 '정' 칸, 그 밖의 픽은 '플' 칸. 내픽이 없거나 '대기'면 null(미정 줄).
const JUNG_PICKS = new Set(['정무', '정역', '정', '핸승', '핸무', '핸승핸무'])
export function pickSide(pick) {
  if (!pick || pick === '대기') return null
  return JUNG_PICKS.has(pick) ? '정' : '플'
}

// 메인/사이드 — 의견(MY_HIT)으로 정한다(2026-09-27 사용자 지정: 함부르크:쾰른 의견 B-Si → 사이드 정).
//   의견에 'Si'가 들어가면(B-Si·축-Si) 사이드, 'Ma'가 들어가면(B-Ma)·축-정·축-플·축-고민은 메인.
//   그 밖의 의견·의견 없음은 별 단계로 — ★★ 메인 / ★ 사이드.
export function mainSideOf(row) {
  const hit = String(row?.MY_HIT || '')
  if (hit.includes('Si')) return 'S'
  if (hit.includes('Ma') || hit.startsWith('축-')) return 'M'   // 축-정·축-플·축-고민은 별과 상관없이 메인(축-Si는 위에서 사이드)
  return Number(row?.IMPORTANT) >= 2 ? 'M' : 'S'
}

export const matchKey = (r) => `${r.L}|${r.S}|${r.R}|${r.No}|${r.HT}|${r.AT}`

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const latest = (row, ek, k) => num(row?.[ek]) ?? num(row?.[k])

// 핸디 기준 정배가 홈인가 — 저장 결과(RT)가 이 기준(국내 핸디 부호)으로 매겨지므로 pick_type 변환도 이걸 따른다.
// 기준점이 0이거나 없으면 지금 승·패 배당으로 대신한다.
export function homeFavOf(row) {
  const kh = num(row?.KH)
  if (kh !== null && kh !== 0) return kh < 0
  return homeIsFavNow(row)
}

const lineText = (l) => `H ${l > 0 ? '+' : ''}${Number(l).toFixed(1)}`

// 카드에 그릴 줄 목록 — [{ m, label, line, init:[3], cur:[3] }]. 값이 없는 칸은 null.
export function cardMarkets(row, extraLines) {
  const out = []
  const trio = (keys) => keys.map(([ek, k]) => ({ init: num(row?.[k]), cur: latest(row, ek, k) }))
  const k = trio([['EKW', 'KW'], ['EKD', 'KD'], ['EKL', 'KL']])
  if (k.some((c) => c.cur !== null)) out.push({ m: 'k', label: '국배', line: null, cells: k })
  const h = trio([['EKHW', 'KHW'], ['EKHD', 'KHD'], ['EKHL', 'KHL']])
  const kh = num(row?.KH)
  if (h.some((c) => c.cur !== null)) out.push({ m: 'h', label: '핸디', line: kh, cells: h })
  const xs = (extraLines || [])
    .filter((x) => x.market === 'H' && [2, 3.5].includes(Math.abs(Number(x.line))))
    .sort((a, b) => Math.abs(Number(a.line)) - Math.abs(Number(b.line)) || Number(a.line) - Number(b.line))
  for (const x of xs) {
    const cells = [['EK1', 'K1'], ['EKX', 'KX'], ['EK2', 'K2']].map(([ek, kk]) => ({ init: num(x[kk]), cur: latest(x, ek, kk) }))
    if (Math.abs(Number(x.line)) === 3.5) cells[1] = { init: null, cur: null }   // ±3.5는 무가 없다
    if (cells.some((c) => c.cur !== null)) out.push({ m: `x:${Number(x.line)}`, label: '추가', line: Number(x.line), cells })
  }
  return out
}

export { lineText }

// 선택 하나 → { odds, lab(화면), pickType(베팅내역), mk(시장 이름) }. 배당이 없으면 null.
export function resolveSel(row, markets, sel) {
  const mk = markets.find((x) => x.m === sel.m)
  const odds = mk?.cells[sel.i]?.cur ?? null
  if (odds === null) return null
  if (sel.m === 'k') {
    const fav = homeFavOf(row)
    const pickType = sel.i === 1 ? '무' : fav === null ? null : ((sel.i === 0) === fav ? '정' : '역')
    return { odds, lab: LAB[sel.i], pickType, mk: '승무패' }
  }
  if (sel.m === 'h') {
    const fav = homeFavOf(row)
    const pickType = sel.i === 1 ? '핸무' : fav === null ? null : ((sel.i === 0) === fav ? '핸승' : '플핸')
    return { odds, lab: `핸${LAB[sel.i]}`, pickType, mk: `핸디 ${lineText(mk.line ?? 0)}` }
  }
  const line = mk.line
  const size = Math.abs(line)
  const favHome = line < 0
  const kind = sel.i === 1 ? '핸무' : ((sel.i === 0) === favHome ? '핸승' : '플핸')
  return { odds, lab: `핸${LAB[sel.i]} ${lineText(line).replace('H ', 'H')}`, pickType: `${size}${kind}`, mk: `핸디 ${lineText(line)}` }
}

// 결과가 나온 경기에서 그 칸이 맞았는가(카드 ✔ 표시용).
// 핸디 기준점(KH)은 기타경기에선 와이즈토토가 안 줘서 항상 비어 있다(api/misc_matches.py
// _to_row 주석과 같은 원인) — 그대로 두면 0으로 계산돼 핸디 줄이 국배와 똑같이(핸무·역을
// 못 갈라) 체크됐다(2026-09-29 사용자 제보 — "아르메니/몬테네그 2:3으로 몬테네그가 핸무로
// 이겼는데 핸디는 무쪽에 체크가 되어야 하는데 안 맞아"). KH가 없으면 homeFavOf와 같은
// 기준(국배 KW/KL 비교)으로 정배를 가려 '정배 -1'로 대신한다(misc_matches.py _rt_from_score와
// 같은 가정 — 기타경기는 ±1 핸디만 쓴다).
export function cellHit(row, m, line, i) {
  const hs = num(row?.HS)
  const as = num(row?.AS)
  if (hs === null || as === null) return false
  let d = hs - as
  if (m === 'h') {
    let kh = num(row?.KH)
    if (kh === null || kh === 0) {
      const fav = homeFavOf(row)
      kh = fav === true ? -1 : fav === false ? 1 : 0
    }
    d += kh
  } else if (m !== 'k') d += line
  const res = d > 0 ? 0 : d === 0 ? 1 : 2
  return res === i
}

// 선택(Map: matchKey → [{m,i}]) → 층(leg) 목록. 칸 1개=축(맨 위), 2개 이상=복수.
// 복수는 배당이 가장 낮은 칸이 메인, 나머지는 보험(자동 표시).
export function buildLegs(sel, rowByKey, extraByKey) {
  const legs = []
  for (const [key, arr] of sel.entries()) {
    const row = rowByKey.get(key)
    if (!row || !arr?.length) continue
    const markets = cardMarkets(row, extraByKey.get(key))
    const picks = arr.map((s) => ({ ...s, ...resolveSel(row, markets, s) })).filter((p) => p.odds != null)
    if (!picks.length) continue
    if (picks.length > 1) {
      const lo = Math.min(...picks.map((p) => p.odds))
      let mainSet = false
      picks.forEach((p) => {
        p.role = !mainSet && p.odds === lo ? 'main' : 'ins'
        if (p.role === 'main') mainSet = true
      })
    } else {
      picks[0].role = 'ax'
    }
    const mks = [...new Set(picks.map((p) => p.mk))].join(' + ')
    legs.push({ key, row, picks, axis: picks.length === 1, mks })
  }
  return legs.sort((a, b) => a.picks.length - b.picks.length)
}

// 조합 배당은 프로토 방식대로 소수 1자리 '전체올림'(예 2.916 → 3.0) — 예전 BetSlip.jsx와 같은 규칙.
const ceilOdds = (v) => Math.ceil(v * 10 - Number.EPSILON) / 10

export function buildCombos(legs) {
  if (!legs.length) return []
  let acc = [[]]
  for (const leg of legs) {
    const next = []
    for (const c of acc) for (const p of leg.picks) next.push([...c, { leg, p }])
    acc = next
  }
  return acc.map((path) => ({
    key: path.map(({ leg, p }) => `${leg.key}#${p.m}#${p.i}`).join('::'),
    path,
    odds: ceilOdds(path.reduce((a, { p }) => a * p.odds, 1)),
  }))
}

export const comboCount = (legs) => legs.reduce((a, l) => a * l.picks.length, legs.length ? 1 : 0)

export const roundStake = (v) => Math.round(v / 100) * 100

// 총벳금액을 배당 역수 비중으로 나눈다(예전 이번주 벳 '금액적용'과 같은 방식) —
// 100원 단위로 반올림하며 생긴 차액은 뱃금액이 가장 큰 줄에 얹어 합계를 총벳금액과 정확히 맞춘다.
export function splitBudget(combos, budget) {
  if (!combos.length || !budget) return {}
  const w = combos.map((c) => 1 / c.odds)
  const ws = w.reduce((a, b) => a + b, 0)
  const out = {}
  combos.forEach((c, i) => { out[c.key] = roundStake((budget * w[i]) / ws) })
  const diff = budget - Object.values(out).reduce((a, b) => a + b, 0)
  if (diff) {
    const big = combos.reduce((m, c) => (out[c.key] > out[m.key] ? c : m), combos[0])
    out[big.key] += diff
  }
  return out
}

// 날짜 탭 — DT '26-09-27 (Sun)' → '09-27(일)'. 그룹은 달력 날짜가 아니라 '베팅일' 기준
// (2026-09-27 사용자 지정 — "베팅 기준으로 하면... 전체 규칙 보면 금/토/일 나누는 규칙 보고
// 그대로 적용해줘야돼" — 새벽 6시 이전 경기는 전날 그룹, LeagueTable의 bettingDayOf와 완전히
// 같은 규칙). 기타경기(api/misc_matches.py)는 DT가 '26-09-27 (Sun)'이 아니라 와이즈토토
// 원본 그대로 'YYYY-MM-DD HH:MM:SS'라 요일 약어가 없는데, bettingDayOf가 그 형식도 직접
// 계산해 준다 — 두 리그 종류가 항상 같은 규칙으로 갈리게 여기서 새로 만들지 않고 그 함수를 그대로 쓴다.
const DAY = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' }

// row 전체(DT+TM)를 받는다 — 6시 이전 판정에 TM이 꼭 있어야 해서 dt 문자열 하나만으론
// 정확히 계산할 수 없다(호출부는 WeeklyPickPage.jsx, dayKey(r)/dayLabel(r) 그대로 row를 넘긴다).
function parseDayDT(row) {
  const bd = bettingDayOf(row)
  if (bd) {
    const [, mo, d] = bd.key.split('-')
    return { key: bd.key, label: `${mo}-${d}(${DAY[bd.weekday] || bd.weekday})` }
  }
  const s = String(row?.DT || '')
  return { key: s.slice(0, 8), label: s.slice(0, 8) }
}
export const dayLabel = (row) => parseDayDT(row).label
export const dayKey = (row) => parseDayDT(row).key

// 베팅내역 등록 형식(/api/bet_slips의 bets 한 줄)
export function comboToBet(c, stake) {
  return {
    odds: c.odds,
    stake: Math.round(stake),
    legs: c.path.map(({ leg, p }) => ({
      code: leg.row.L, S: leg.row.S, R: leg.row.R, No: leg.row.No,
      HT: leg.row.HT, AT: leg.row.AT, DT: leg.row.DT,
      pick_type: p.pickType, odds: p.odds, scope: leg.row.scope,
    })),
  }
}
