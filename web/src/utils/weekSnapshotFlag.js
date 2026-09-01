// "이번주 리스트" 자동 스냅샷이 이 회차(시작~종료)에서 이미 찍혔는지 표시.
// finalOddsTime.js와 같은 이유로 지금은 브라우저(localStorage) 저장 — 여러 사람이
// 같이 쓰는 서버 제품이 되면 이 get/set 구현만 백엔드 호출로 바꾸면 된다.
const PREFIX = 'betpro_week_snapshot_auto'

function key(start, end) {
  return `${PREFIX}::${start}::${end}`
}

/** 이 회차(start~end)에서 자동 스냅샷을 이미 저장했는가. */
export function isWeekSnapshotDone(start, end) {
  try {
    return localStorage.getItem(key(start, end)) != null
  } catch {
    return false
  }
}

/** reason: 'results'(경기 결과 전부 입력됨) | 'last_day'(회차 마지막날). */
export function markWeekSnapshotDone(start, end, reason) {
  try {
    localStorage.setItem(key(start, end), reason)
  } catch {
    // 저장 실패(프라이빗 모드 등)해도 화면 동작 자체는 막지 않는다.
  }
}
