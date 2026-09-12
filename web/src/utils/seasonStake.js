// 시즌 막판 뱃지 — 팀마다 '무엇이 걸려 있나'(우승·챔스·유로파·강등)와, 경기마다
// '시즌 마지막 2라운드 · 정무 주의'. 순위표·확정/탈락 판정은 백엔드 api/standings.py
// (STAKE_LINES 주석)가 HREM/AREM·HSTK/ASTK·HSTKT/ASTKT·HSTKS/ASTKS로 붙여 주고,
// 여기서는 화면에 무엇을 어떻게 띄울지만 정한다(리그 표·상세보기가 같이 쓴다).
//
// 2026-09-11 실측(6대리그 완료 시즌 32,095경기):
//   · 순위 경쟁 여부 자체는 같은 배당끼리 비교하면 결과 차이가 없다(남은 경기 수까지
//     고정하면 어느 묶음도 z<1.9) — 배당에 이미 들어 있는 정보라 팀 뱃지는 '참고용'이다.
//   · 시즌 마지막 2라운드(두 팀 모두 남은 경기 ≤2)는 같은 정배 확률에서 역 +3.67%p(z=3.91)
//     · 무 −2.70%p(z=−2.63), 리그 5/6, 시즌 전반·후반 모두 +(해외 배변 있는 1,703경기).
//     정무(역 배제) 당첨이 그만큼 낮아지고 플핸무(핸승 배제)는 영향이 없다 → 정무에만 주의.
// 사용자 지정(2026-09-12): 우선 표시만 한다 — 판정 %·별점·TOP20 순위에는 반영하지 않는다.

export const STAKE_WINDOW = 10        // api/standings.py STAKE_WINDOW와 같은 값
export const SEASON_END_ROUNDS = 2    // '마지막 2라운드' — 실측 구간 그대로

const num = (v) => {
  const n = Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n
}

// 표 칸이 좁아 두세 글자로 줄인다(전체 문구는 title). ✔ = 확정.
const SHORT = {
  우승경쟁: '우승', 챔스경쟁: '챔스', 유로파경쟁: '유로파', 강등경쟁: '강등',
  우승확정: '우승✔', 챔스확정: '챔스✔', 유로파확정: '유로파✔', 강등확정: '강등✔',
  '걸린 것 없음': '무관',
}
// 아직 걸린 팀만 색을 준다 — 확정·걸린 것 없음은 회색(정리된 상태).
const FIGHT_TONE = { 우승경쟁: 'yellow', 챔스경쟁: 'blue', 유로파경쟁: 'teal', 강등경쟁: 'red' }

const STAKE_NOTE = '참고용 — 순위 경쟁 여부는 배당에 이미 반영돼 있어, 같은 배당끼리 비교하면'
  + ' 결과 차이가 없었습니다(6대리그 32,095경기, 남은 경기 수까지 고정 시 z<1.9).'

// side: 'H'(홈) | 'A'(원정). 남은 경기가 STAKE_WINDOW를 넘거나 뱃지가 없으면 null.
export function teamStake(row, side) {
  const rem = num(row?.[`${side}REM`])
  const label = row?.[`${side}STK`]
  if (!label || rem === null || rem > STAKE_WINDOW) return null
  const text = row[`${side}STKT`] || ''
  const states = row[`${side}STKS`] || ''
  const tone = FIGHT_TONE[label] || 'gray'
  const title = `${label}${text ? ` · ${text}` : ''} (이 경기 포함 남은 ${rem}경기)\n`
    + `${states}\n\n${STAKE_NOTE}`
  return { label, short: SHORT[label] ?? label, tone, text, rem, title }
}

// 두 팀 모두 남은 경기(이 경기 포함)가 2 이하 — 실측한 구간과 같은 정의.
export function seasonEndWarn(row) {
  const h = num(row?.HREM)
  const a = num(row?.AREM)
  return h !== null && a !== null && Math.max(h, a) <= SEASON_END_ROUNDS
}

export const SEASON_END_TITLE = '시즌 마지막 2라운드 — 정무 주의\n'
  + '같은 배당(정배 승리확률)끼리 비교하면 시즌 마지막 2라운드는 역이 +3.67%p 더 나오고'
  + ' 무가 −2.70%p 덜 나옵니다(6대리그 1,703경기, z=3.91, 리그 5/6).\n'
  + '정무("역은 안 나온다") 당첨이 약 3.7%p 낮아집니다. 플핸무는 영향이 없습니다.\n'
  + '※ 표시만 합니다 — 판정 %·별점에는 반영하지 않았습니다.'
