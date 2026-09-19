// 추가배당(±2·±3.5 핸디, 언더오버) 유형별 배당 계산 — BetSlip.jsx와 MatchDetailModal.jsx가
// 같은 로직을 쓴다(2026-09-20 — 상세보기 '배당' 제목 옆 뱃지를 추가하며 BetSlip.jsx에
// 있던 걸 공용 파일로 뺐다. CLAUDE.md pickOptions.js와 같은 이유 — 두 곳에 같은 배열이
// 따로 있으면 한쪽만 고칠 때 화면마다 결과가 달라지는데 티가 안 난다).
// 데이터 출처는 api/kr_extra_odds.py(와이즈토토에서 따로 쌓은 ±2·±3.5·언더오버 배당) —
// 리그 표(KW~KHL)에는 없고 국내배당(K1/KX/K2, 최신은 EK1/EKX/EK2)뿐이다.

export const EXTRA_PICK_TYPES = [
  '2핸승', '2핸무', '2플핸', '3.5핸승', '3.5플핸', '2.5언더', '2.5오버', '3.5언더', '3.5오버',
]
const EXTRA_HANDI_RE = /^(2|3\.5)(핸승|핸무|플핸)$/
const EXTRA_OU_RE = /^(2\.5|3\.5)(언더|오버)$/

// 배당 전용 숫자 변환 — 빈 배당(null)을 0으로 읽지 않는다.
const oddsNum = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 칸 하나(1/X/2)마다 최신배당(EK*)이 있으면 그것, 없으면 초기배당(K*).
const extraLatest = (x, ek, k) => {
  const v = oddsNum(x?.[ek])
  return v != null ? v : oddsNum(x?.[k])
}

// 지금 정배가 홈인지 — 최신배당 우선, 없으면 초기배당으로 승·패 배당 비교. 모르면 null.
// 서버 판정(api/main.py _build_score_index)과 같은 기준이다.
export function homeIsFavNow(row) {
  const kw = extraLatest(row, 'EKW', 'KW')
  const kl = extraLatest(row, 'EKL', 'KL')
  return kw == null || kl == null ? null : kw <= kl
}

// lines: 그 경기의 추가배당 줄 [{market:'H'|'U', line, K1,KX,K2, EK1,EKX,EK2}].
// H의 line은 와이즈토토 표기 그대로 홈 기준(-2.0 = 홈 정배 -2), 칸은 1=홈 승/X=무/2=홈 패.
// U의 칸은 1=언더/2=오버.
//
// 값만이 아니라 "어느 줄을 어떤 근거로 골랐는지"(line·favHome)까지 돌려준다 — 상세보기
// 뱃지 호버처럼 왜 이 배당인지 설명하려면 필요하다. 값만 필요하면 extraOddsForPick을 쓴다.
export function resolveExtraPick(row, pick, lines) {
  if (!lines?.length) return null
  const ou = EXTRA_OU_RE.exec(pick)
  if (ou) {
    const size = Number(ou[1])
    const x = lines.find((l) => l.market === 'U' && Math.abs(Number(l.line) - size) < 1e-6)
    if (!x) return null
    const odds = ou[2] === '언더' ? extraLatest(x, 'EK1', 'K1') : extraLatest(x, 'EK2', 'K2')
    if (odds == null) return null
    return { odds, line: x, market: 'U', kind: ou[2], size }
  }
  const h = EXTRA_HANDI_RE.exec(pick)
  if (!h) return null
  const size = Number(h[1])
  const cands = lines.filter((l) => l.market === 'H' && Math.abs(Math.abs(Number(l.line)) - size) < 1e-6)
  if (!cands.length) return null
  // 같은 크기의 -·+ 줄이 둘 다 남아 있으면(배당이 뒤집힌 경기) 지금 정배와 부호가 맞는 줄.
  // 서버 판정(kr_extra_odds.pick_handi_line)과 같은 규칙이다.
  const fav = homeIsFavNow(row)
  const x = (cands.length > 1 && fav != null && cands.find((l) => (Number(l.line) < 0) === fav)) || cands[0]
  const favHome = Number(x.line) < 0
  let odds
  if (h[2] === '핸무') {
    odds = extraLatest(x, 'EKX', 'KX')
  } else {
    const winFav = h[2] === '핸승'
    odds = winFav === favHome ? extraLatest(x, 'EK1', 'K1') : extraLatest(x, 'EK2', 'K2')
  }
  if (odds == null) return null
  return { odds, line: x, market: 'H', kind: h[2], size, favHome }
}

export function extraOddsForPick(row, pick, lines) {
  return resolveExtraPick(row, pick, lines)?.odds ?? null
}
