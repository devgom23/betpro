// 별표(중요 0/1/2)를 바꾸면 같은 화면의 다른 부품(리그 표 ↔ 경기별 세팅값)이 바로 따라가게 알리는 작은 방송 도구
// (2026-10-10 사용자 지정 — 경기별 세팅값 머리글 별표와 아래 리스트 별표 연동). 저장은 각자 하고, 이건 화면 갱신만 맡는다.
export const STAR_EVENT = 'betpro:star'

// who = 보낸 쪽 이름 — 받는 쪽이 자기가 보낸 것은 무시할 때 쓴다
export function emitStar(row, level, who) {
  window.dispatchEvent(new CustomEvent(STAR_EVENT, { detail: { S: row.S, R: row.R, No: row.No, HT: row.HT, AT: row.AT, level, who } }))
}
