// 배변(배당변경) 신뢰 등급 — "이 경기는 초기배당 줄 대신 최신배당 줄을 봐야 하는가".
//
// 리그 표의 '지표 > 배변' 칸과 상세보기 배당표의 '배변' 행 라벨이 같이 쓴다.
// 선택지를 한 곳에만 두는 pickOptions.js와 같은 이유로 여기 하나만 고친다.
//
// ── 왜 해외 배당만 보는가 ────────────────────────────────────────────────
// 국내(와이즈토토)와 해외(스코어맨/Bet365)는 배당이 움직이는 '이유'가 다르다.
//   국내: 마진(수수료)이 1.1584 → 1.1584로 그대로다(경기의 99.9%가 ±0.005 이내).
//         승에서 깎은 만큼 패에 붙이는 재분배일 뿐이다(승↔패 변동 상관 -0.731).
//         = 새 정보가 아니라 국내 투표 쏠림에 대한 대응이다.
//   해외: 마진이 1.0698 → 1.0588로 줄면서 크게 움직인다(이동폭 표준편차 4.99%p,
//         국내는 1.34%p). = 라인업·부상이 확정되며 진짜 확률에 가까워지는 것이다.
// 실측(2026-08-28, 8개 리그 39,474경기)에서도 국내 배당은 어느 칸에서도 최신배당이
// 더 낫다는 증거가 없었고(전부 z=0~1.1), 국내 핸디는 오히려 초기가 약간 나았다.
// 그래서 등급은 해외 배당(FW/FL → EFW/EFL)에서만 매긴다.
//
// ── 기준선을 이렇게 정한 근거 ────────────────────────────────────────────
// '3way에서 확률이 가장 낮은 하나를 배제한다'(CLAUDE.md 5-1)는 사용자 방식으로,
// 초기배당으로 고른 배제와 최신배당으로 고른 배제를 같은 경기에서 나란히 세었다.
// 정배배당은 min(FW, FL) 기준(CLAUDE.md 5장 fav 정의).
//
//   정배 초기배당    변동률     경기수   초기적중  최신적중   이득    판정
//   ~1.5           어떤 값이든  7,244    90.97%   90.96%   -0.01   의미 없음
//   1.5~1.8        14%+          969    78.43%   78.02%   -0.41   오히려 나쁨
//   1.8+           0~8%        13,259    75.6%    76.0%    +0.4    우연 범위
//   1.8+           8~14%        6,057    73.98%   75.00%   +1.02   약함 (z=2.1)
//   1.8+           14%+         5,145    70.92%   73.99%   +3.07   확실 (z=4.5)
//
// 방향(↑/↓)은 보지 않는다 — 정배배당이 내려간 경우(+4.06p, z=3.9)와 올라간
// 경우(+2.63p, z=2.7) 둘 다 이득이라 '크기'만 보면 된다.
// 극단값(변동률 50% 초과, 0.33%)을 빼도 결과가 그대로였다(+3.26p).
// 8개 리그 전부에서 같은 방향으로 재현됐다(이득 +1.39 ~ +9.98p).

/** 정배로 인정하는 최소 초기배당. 이보다 싼 '확실한 강팀'은 배변을 봐도 소용없다. */
const FAV_MIN = 1.8
/** 변동률(%) 문턱 — 강/약. */
const CUT_STRONG = 14
const CUT_WEAK = 8

/** 리그 표에서 이 등급을 담는 가상 컬럼 이름(백엔드가 내려주는 값이 아니다). */
export const ODDS_GRADE_KEY = 'ODDS_GRADE'

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 해외 배당의 배변 정보. 판정할 수 없으면 null.
 * @returns {{grade:'강'|'약'|'', movePct:number, fav0:number, fav1:number,
 *            favIsHome:boolean, dir:1|-1|0} | null}
 */
export function oddsMoveInfo(row) {
  if (!row) return null
  const fw = num(row.FW)
  const fl = num(row.FL)
  const efw = num(row.EFW)
  const efl = num(row.EFL)
  if (fw === null || fl === null || efw === null || efl === null) return null
  if (fw <= 0 || fl <= 0 || efw <= 0 || efl <= 0) return null

  // 정배 = 배당이 싼 쪽(CLAUDE.md 5장). 같은 팀의 초기·마감 배당을 짝지어 본다 —
  // 마감에서 정배가 뒤집혔더라도 '처음에 정배였던 팀'이 얼마나 움직였는지를 재야
  // 초기→마감의 이동폭이 된다.
  const favIsHome = fw <= fl
  const fav0 = favIsHome ? fw : fl
  const fav1 = favIsHome ? efw : efl
  const movePct = (fav1 / fav0 - 1) * 100
  const abs = Math.abs(movePct)

  let grade = ''
  if (fav0 >= FAV_MIN) {
    if (abs >= CUT_STRONG) grade = '강'
    else if (abs >= CUT_WEAK) grade = '약'
  }
  return {
    grade,
    movePct,
    fav0,
    fav1,
    favIsHome,
    dir: fav1 > fav0 ? 1 : fav1 < fav0 ? -1 : 0,
  }
}

/** 등급 문자열만 — '강' | '약' | ''(표시 안 함). */
export function oddsMoveGrade(row) {
  const info = oddsMoveInfo(row)
  return info ? info.grade : ''
}

/** 마우스를 올렸을 때 보여줄 설명. 등급이 없으면 빈 문자열. */
export function oddsMoveTitle(row) {
  const info = oddsMoveInfo(row)
  if (!info || !info.grade) return ''
  const team = info.favIsHome ? (row.HT ?? '홈') : (row.AT ?? '원정')
  const gain = info.grade === '강' ? '3.1' : '1.0'
  return (
    `정배(${team}) 해외배당 ${info.fav0.toFixed(2)} → ${info.fav1.toFixed(2)}` +
    ` (${info.movePct >= 0 ? '+' : ''}${info.movePct.toFixed(1)}%)\n` +
    `이 조건에서는 최신배당 줄이 초기배당 줄보다 ${gain}%p 더 정확했습니다.`
  )
}
