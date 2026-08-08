// 여러 화면이 똑같이 쓰던 표시용 헬퍼들을 한 곳에 모은 것.
// (예전엔 LeagueTable / MatchDetailModal / MyPickModal / HeadToHeadResult 에
//  글자 하나 안 다른 복사본이 각각 들어 있었다.)

// 중요 별표 값 — 서버가 true / 1 / '1' 중 어떤 형태로 내려줘도 켜짐으로 본다.
export function isStarred(v) {
  return v === true || v === 1 || v === '1'
}

// TM은 'HHMM' 숫자(예: 1930)로 저장되어 있다 — "19:30"으로 보여준다.
export function formatTime(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  const s = String(Math.trunc(n)).padStart(4, '0')
  return `${s.slice(0, 2)}:${s.slice(2)}`
}

// 점수가 둘 다 있고 서로 다를 때만 이긴 쪽 점수를 강조한다(무승부·예정 경기는 강조 없음).
// side 는 'home' | 'away'.
//
// ⚠ 결과 입력 폼(ResultEditModal)에는 이것과 이름만 같고 규칙이 다른 함수가 따로 있다 —
//    거긴 입력값이 문자열이라 ''(빈칸) 처리와 Number() 변환이 필요해서 합치지 않았다.
export function scoreClass(hs, as_, side) {
  if (hs === null || hs === undefined || as_ === null || as_ === undefined) return undefined
  const winner = hs > as_ ? 'home' : as_ > hs ? 'away' : null
  return winner === side ? 'winner-score' : undefined
}
