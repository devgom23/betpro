// 아카이브 태그 표시 문구 — 상세보기 경기지표 뱃지·태그 팝업·아카이브 탭이 같이 쓴다.
// 태그 한 개(t)는 /api/archive/* 응답의 한 줄(kind, team_a, team_b, tag, memo, span,
// S/R/No/HT/AT = 근거 경기, active, created_dt, stats)이다.

export function archiveTargetText(t) {
  return t.kind === 'matchup' ? `${t.team_a}→${t.team_b}` : t.team_a
}

export function archiveSpanText(t) {
  return t.span === 'all' ? '전체 시즌' : `${t.S} 시즌만`
}

export function archiveSourceText(t) {
  return `${t.S} ${t.R ?? ''} ${t.HT} vs ${t.AT}`.replace(/\s+/g, ' ').trim()
}

// stats = { n, w, d, l, matches } — 팀 태그는 그 팀 기준, 맞대결은 주어 팀 기준 승/무/패.
export function archiveStatsText(stats) {
  if (!stats || !stats.n) return '아직 경기 없음'
  return `${stats.n}경기 ${stats.w}승 ${stats.d}무 ${stats.l}패`
}

const LETTER = { W: '승', D: '무', L: '패' }

export function archiveStatsLines(stats) {
  if (!stats || !stats.matches?.length) return []
  return stats.matches.map((m) =>
    `· ${m.S} ${m.R} ${m.HT} ${m.HS}:${m.AS} ${m.AT} → ${LETTER[m.letter] ?? m.letter}${m.RT_label ? ` (${m.RT_label})` : ''}`)
}

export function archiveDateText(dt) {
  return String(dt || '').slice(0, 10)
}
