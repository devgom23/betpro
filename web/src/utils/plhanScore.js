// 상세보기 경기지표 '플핸 점수' 칩 글자·툴팁(2026-10-07) — 칩은 MatchDetailModal.jsx plhanChips, 근거 팝업은 PlhanScore.jsx.
// 컴포넌트 파일이 함수까지 내보내면 화면 즉시 반영(fast refresh)이 깨져 따로 둔다.

// 칩에 쓰는 '같은 점수 지난 경기 %' — 5점은 경기 수가 적어 4점 이상으로 묶은 값(서버 show).
export function plhanChipText(d) {
  if (!d?.ready) return null
  if (d.state !== 'ok') return '대기'
  const r = d.show?.rate
  return `${d.score}점${r !== null && r !== undefined ? ` · ${Math.round(r)}%` : ''}`
}

export function plhanChipTitle(d) {
  if (!d?.ready) return d?.reason || ''
  if (d.state !== 'ok') {
    return '플핸 점수 — 마감(배변) 배당이 아직 없어 계산 전입니다. 킥오프 가까이 최신배당을 불러오면 점수로 바뀝니다.\n누르면 기준 배당을 봅니다.'
  }
  const p = d.pattern
  const a = d.agree
  return `플핸 점수 ${d.score}점 (패턴 ${p.points} + 동의 ${a.count}) — 단통 플핸(무+역)\n`
    + `같은 점수 지난 경기 ${d.show?.rate ?? '—'}% (${d.show?.hit ?? '—'}/${d.show?.n ?? '—'})${d.score >= 5 ? ' — 5점은 경기 수가 적어 4점 이상으로 표시' : ''}\n`
    + '누르면 점수를 낸 근거를 봅니다.'
}
