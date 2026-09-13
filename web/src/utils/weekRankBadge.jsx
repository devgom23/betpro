// 이번주 TOP30 순위 배지 — 목록(WeekTopPage)과 상세보기 배당표(구분 위 칸)가
// 같은 모양을 쓴다. weekTop20.rankInfoOf가 만든 데이터(rank/delta/prevRank/
// played/score/day/title)를 받아 실제 <span> 트리로 바꾼다. rankOnly=순위+등락만
// (상세보기용, 2026-09-13 사용자 지정), label=순위+%+날짜까지(목록용).
export function buildRankBadge(info) {
  const { rank, delta, prevRank, played, score, day, title } = info
  const deltaNode = delta !== null && delta !== 0 && (
    <span className={`top20-delta ${delta > 0 ? 'top20-delta-down' : 'top20-delta-up'}`}>
      ({prevRank}{delta > 0 ? '▼' : '▲'})
    </span>
  )
  return {
    title,
    // 상세보기 칸은 숫자만 있으면 허전하다고 '위'를 붙였다(2026-09-13 사용자 지정
    // — "숫자만 쓰지 말고 1위 위자 붙여줘"). 목록(label)은 칸이 좁고 옆에 %·날짜가
    // 같이 있어 그대로 숫자만 둔다.
    rankOnly: (
      <span className={`top20-rank${played ? ' top20-played' : ''}`}>
        <strong className="top20-no">
          {rank}위
          {deltaNode}
        </strong>
      </span>
    ),
    label: (
      <div className={`top20-rank${played ? ' top20-played' : ''}`}>
        <strong className="top20-no">
          {rank}
          {deltaNode}
        </strong>
        <span className="top20-rate">{score.rate.toFixed(2)}%</span>
        <span className="top20-day">{day}</span>
      </div>
    ),
  }
}
