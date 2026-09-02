// 조회 조건(시즌/라운드/배당 9종)을 URL 쿼리 문자열로 만드는 공용 함수.
// (예전엔 LeaguePage 와 TotalDbPage 에 거의 같은 복사본이 각각 있었다 —
//  차이는 TotalDbPage 만 league 를 함께 넘긴다는 점뿐이라, 앞부분을 base 로 받게 했다.)

export const ODDS_KEYS = ['kw', 'kd', 'kl', 'khw', 'khd', 'khl', 'fw', 'fd', 'fl']

// base: 항상 붙일 기본 파라미터 (예: { scope } 또는 { scope, league })
// query: 화면의 조회 조건. 비어 있으면 base 만 담긴다.
export function buildQueryString(base, query) {
  const params = new URLSearchParams(base)
  if (query) {
    if (query.season) params.set('season', query.season)
    if (query.round) params.set('round', query.round)
    if (query.team) params.set('team', query.team)
    if (query.team_side) params.set('team_side', query.team_side)
    if (query.team_fav) params.set('team_fav', query.team_fav)
    for (const key of ODDS_KEYS) {
      if (query[key] !== undefined && query[key] !== null) {
        params.set(key, String(query[key]))
      }
    }
  }
  return params.toString()
}
