import { useEffect, useState } from 'react'
import './FilterForm.css'

const SEASON_ALL = 'ALL'
const ROUND_ALL = 'ALL'

const ODDS_FIELDS = [
  { group: '국내', fields: [['kw', 'KW', '홈 배당'], ['kd', 'KD', '무 배당'], ['kl', 'KL', '원정 배당']] },
  { group: '국내 플핸', fields: [['khw', 'KHW', '홈 배당'], ['khd', 'KHD', '무 배당'], ['khl', 'KHL', '원정 배당']] },
  { group: '해외', fields: [['fw', 'FW', '홈 배당'], ['fd', 'FD', '무 배당'], ['fl', 'FL', '원정 배당']] },
]

const BLANK_ODDS = { kw: '', kd: '', kl: '', khw: '', khd: '', khl: '', fw: '', fd: '', fl: '' }
const ODDS_KEYS = ODDS_FIELDS.flatMap(({ fields }) => fields.map(([key]) => key))

const TEAM_SIDE_OPTIONS = [
  ['all', '전체보기'],
  ['home', '홈보기'],
  ['away', '원정보기'],
]

// 정배/역배는 해외배당(FW/FL) 기준 — HeadToHeadResult의 상대전적 표와 같은 기준.
// 동배(FW===FL)는 정배·역배 둘 다 아니므로 '전체'에는 잡히지만 정배/역배 필터에는 안 걸린다.
const TEAM_FAV_OPTIONS = [
  ['all', '전체'],
  ['fav', '정배보기'],
  ['dog', '역배보기'],
]

function makeDefaultDraft(latest) {
  return {
    season: latest?.season ?? SEASON_ALL,
    round: latest?.round ?? ROUND_ALL,
    team: '',
    teamSide: 'all',
    teamFav: 'all',
    ...BLANK_ODDS,
  }
}

export default function FilterForm({ filters, leagueKey, onSearch, teams = [] }) {
  const [draft, setDraft] = useState(() => makeDefaultDraft(filters?.latest))
  const [warning, setWarning] = useState('')

  // 리그(또는 스코프)가 실제로 바뀔 때만 폼을 그 리그의 기본값으로 리셋한다.
  // [filters]에 걸면 저장·크롤링 후 새로고침으로 filters 객체가 새로 만들어질 때마다
  // (같은 리그인데도) 선택해 둔 시즌/라운드가 최신값으로 되돌아가 버린다 — 초기화
  // 버튼을 눌렀을 때만 리셋되길 원하므로 leagueKey(리그가 진짜 바뀔 때만 값이 바뀜)로 건다.
  useEffect(() => {
    setDraft(makeDefaultDraft(filters?.latest))
    setWarning('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueKey])

  // 팀 목록이 바뀌면(시즌 변경 등) 더는 목록에 없는 선택은 지운다.
  useEffect(() => {
    setDraft((prev) => (teams.includes(prev.team) ? prev : { ...prev, team: '' }))
  }, [teams])

  const seasonOptions = [SEASON_ALL, ...(filters?.seasons ?? [])]
  const roundOptions =
    draft.season === SEASON_ALL
      ? [ROUND_ALL, ...Object.values(filters?.rounds_by_season ?? {}).flat()]
      : [ROUND_ALL, ...(filters?.rounds_by_season?.[draft.season] ?? [])]
  const uniqueRoundOptions = [...new Set(roundOptions)]

  function updateField(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function buildQuery(source) {
    const q = { season: source.season, round: source.round }
    if (source.team) {
      q.team = source.team
      if (source.teamSide && source.teamSide !== 'all') q.team_side = source.teamSide
      if (source.teamFav && source.teamFav !== 'all') q.team_fav = source.teamFav
    }
    const badFields = []
    for (const { fields } of ODDS_FIELDS) {
      for (const [key, apiKey] of fields) {
        const raw = String(source[key] ?? '').trim()
        if (!raw) continue
        const num = Number(raw)
        if (Number.isNaN(num)) {
          badFields.push(apiKey)
          continue
        }
        q[key] = num
      }
    }
    return { q, badFields }
  }

  function handleSubmit(e) {
    e.preventDefault()
    const { q, badFields } = buildQuery(draft)
    if (badFields.length) {
      setWarning(`배당값이 숫자가 아닙니다: ${badFields.join(', ')} (해당 조건은 제외하고 조회합니다)`)
    } else {
      setWarning('')
    }
    // 배당값으로 조회할 땐 특정 시즌/라운드에 갇히지 않고 전체 기간에서 찾는 게
    // 자연스러우므로, 배당 조건이 하나라도 있으면 시즌·라운드를 전체로 바꿔서 조회한다.
    const hasOdds = ODDS_KEYS.some((k) => q[k] !== undefined)
    if (hasOdds) {
      q.season = SEASON_ALL
      q.round = ROUND_ALL
      setDraft((prev) => ({ ...prev, season: SEASON_ALL, round: ROUND_ALL }))
    }
    onSearch(q)
  }

  function handleReset() {
    const next = makeDefaultDraft(filters?.latest)
    setDraft(next)
    setWarning('')
    onSearch(buildQuery(next).q)
  }

  return (
    <form className="filter-form" onSubmit={handleSubmit}>
      <div className="filter-block">
        <span className="filter-label">시즌 및 라운드</span>
        <div className="filter-row">
          <select value={draft.season} onChange={(e) => updateField('season', e.target.value)}>
            {seasonOptions.map((s) => (
              <option key={s} value={s}>
                {s === SEASON_ALL ? '시즌전체' : s}
              </option>
            ))}
          </select>
          <select value={draft.round} onChange={(e) => updateField('round', e.target.value)}>
            {uniqueRoundOptions.map((r) => (
              <option key={r} value={r}>
                {r === ROUND_ALL ? '라운드 전체' : r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ODDS_FIELDS.map(({ group, fields }) => (
        <div className="filter-block" key={group}>
          <span className="filter-label">{group}</span>
          <div className="filter-row">
            {fields.map(([key, , placeholder]) => (
              <input
                key={key}
                type="text"
                inputMode="decimal"
                placeholder={placeholder}
                value={draft[key]}
                onChange={(e) => updateField(key, e.target.value)}
              />
            ))}
          </div>
        </div>
      ))}

      {teams.length > 0 && (
        <div className="filter-block">
          <span className="filter-label">팀 조회</span>
          <div className="filter-row">
            <select value={draft.team} onChange={(e) => updateField('team', e.target.value)}>
              <option value="">전체 팀</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={draft.teamSide} onChange={(e) => updateField('teamSide', e.target.value)}>
              {TEAM_SIDE_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <select value={draft.teamFav} onChange={(e) => updateField('teamFav', e.target.value)}>
              {TEAM_FAV_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="filter-actions">
        <button type="button" className="btn-reset" onClick={handleReset} title="조건 초기화">
          ↺
        </button>
        <button type="submit" className="btn-search">
          🔍 조회
        </button>
      </div>

      {warning && <p className="filter-warning">{warning}</p>}
    </form>
  )
}

export { SEASON_ALL, ROUND_ALL }
