// 내 예측 저장 요청 — 표(LeagueTable)와 상세보기가 같이 쓴다. 이번에 바꾼 칸만 보내고
// fields로 그 칸 이름을 알려서, 서버가 나머지 칸(다른 메뉴에서 쓴 메모 등)을 화면이 들고
// 있던 옛 값으로 덮어쓰지 않게 한다(api/my_picks.py upsert_my_pick 참고, 2026-09-13).
const SERVER_FIELD = {
  important: 'starred', pick: 'pick', p: 'p', hit: 'hit', memo: 'memo',
  memoPre: 'memo_pre', reasonTag: 'reason_tag', oddsPick: 'odds_pick', oddsBet: 'odds_bet',
}

export function pickPatchBody(scope, row, patch) {
  const body = { scope, S: row.S, R: row.R, No: row.No, HT: row.HT, AT: row.AT, fields: [] }
  for (const [k, v] of Object.entries(patch)) {
    const f = SERVER_FIELD[k]
    if (!f) continue
    body[f] = k === 'important' ? Number(v) || 0 : v || null
    body.fields.push(f)
  }
  return body
}
