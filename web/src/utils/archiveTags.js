// 아카이브 태그 표시 문구 — 상세보기 경기지표 뱃지·태그 팝업·아카이브 탭이 같이 쓴다.
// 태그 한 개(t)는 /api/archive/* 응답의 한 줄(kind, team_a, team_b, tag, memo, span,
// S/R/No/HT/AT = 근거 경기, active, created_dt, stats)이다.

export function archiveTargetText(t) {
  if (t.kind === 'odds') return `${t.team_a} ${Number(t.odds_value).toFixed(2)}`
  return t.kind === 'matchup' ? `${t.team_a}→${t.team_b}` : t.team_a
}

export function archiveSpanText(t) {
  return t.span === 'all' ? '전체 시즌' : `${t.S} 시즌만`
}

export function archiveSourceText(t) {
  return `${t.S} ${t.R ?? ''} ${t.HT} vs ${t.AT}`.replace(/\s+/g, ' ').trim()
}

// 태그 하나(t)를 받아 그 이후 성적을 한 줄로 — 팀/맞대결은 stats={n,w,d,l}(그 팀 기준
// 승/무/패), 배당은 stats={n,hanseung,hanmu,mu,yeok}(같은 배당값이 다시 나온 경기의
// 결과 분포)로 모양이 달라 kind로 갈라 읽는다.
export function archiveStatsText(t) {
  const stats = t?.stats
  if (!stats || !stats.n) return '아직 경기 없음'
  if (t.kind === 'odds') {
    return `${stats.n}경기 핸승${stats.hanseung} 핸무${stats.hanmu} 무${stats.mu} 역${stats.yeok}`
  }
  return `${stats.n}경기 ${stats.w}승 ${stats.d}무 ${stats.l}패`
}

const LETTER = { W: '승', D: '무', L: '패' }

export function archiveStatsLines(t) {
  const stats = t?.stats
  if (!stats || !stats.matches?.length) return []
  if (t.kind === 'odds') {
    return stats.matches.map((m) => `· ${m.S} ${m.R} [${m.L}] ${m.HT} vs ${m.AT} → ${m.RT_label}`)
  }
  return stats.matches.map((m) =>
    `· ${m.S} ${m.R} ${m.HT} ${m.HS}:${m.AS} ${m.AT} → ${LETTER[m.letter] ?? m.letter}${m.RT_label ? ` (${m.RT_label})` : ''}`)
}

export function archiveDateText(dt) {
  return String(dt || '').slice(0, 10)
}
