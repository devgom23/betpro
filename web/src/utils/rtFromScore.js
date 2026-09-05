// 스코어 + 핸디 부호(-1/+1)로 RT(핸승/핸무/무/역)를 판정한다. 이 앱의 핸디는 항상
// ±1(한 골)이라 규칙이 단순하다 — 실제 스코어가 같으면 무조건 '무'(핸디와 무관하게
// 실제 무승부), 다르면 정배 쪽이 이겼는지부터 보고 이겼으면 골차가 1이면 '핸무'(정확히
// 핸디만큼만 이김=푸시), 2 이상이면 '핸승', 정배가 아닌 쪽이 이겼으면(언더독이 실제로
// 이긴 경우) '역'. handicapSign은 '-1'(홈 정배)/'+1'(원정 정배) 문자열 — 없으면 못 정한다.
// ResultEditModal(결과·핸디 입력 팝업)과 WeekListPage(이번주 리스트 결과불러오기)가
// 이 함수 하나를 같이 쓴다 — 두 군데 따로 두면 한쪽만 고쳤을 때 판정이 갈릴 수 있다.
export function rtFromScore(hs, as_, handicapSign) {
  if (hs === '' || as_ === '' || hs === null || as_ === null || !handicapSign) return null
  const h = Number(hs)
  const a = Number(as_)
  if (Number.isNaN(h) || Number.isNaN(a)) return null
  if (h === a) return '무'
  const favoredIsHome = handicapSign === '-1'
  const winnerIsHome = h > a
  if (winnerIsHome === favoredIsHome) {
    return Math.abs(h - a) > 1 ? '핸승' : '핸무'
  }
  return '역'
}

// 저장된 핸디 값(-1/+1 숫자)을 rtFromScore가 쓰는 부호 문자열로 바꾼다.
export function handicapSign(v) {
  if (v === null || v === undefined || v === '') return null
  return Number(v) > 0 ? '+1' : '-1'
}
