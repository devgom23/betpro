import { useEffect, useState } from 'react'
import './FilterForm.css'

const SEASON_ALL = 'ALL'
const ROUND_ALL = 'ALL'

const ODDS_FIELDS = [
  { group: '국내 배당', fields: [['kw', 'KW', '홈 배당'], ['kd', 'KD', '무 배당'], ['kl', 'KL', '원정 배당']] },
  { group: '국내 플핸 배당', fields: [['khw', 'KHW', '홈 배당'], ['khd', 'KHD', '무 배당'], ['khl', 'KHL', '원정 배당']] },
  { group: '해외 배당', fields: [['fw', 'FW', '홈 배당'], ['fd', 'FD', '무 배당'], ['fl', 'FL', '원정 배당']] },
]

const BLANK_ODDS = { kw: '', kd: '', kl: '', khw: '', khd: '', khl: '', fw: '', fd: '', fl: '' }

function makeDefaultDraft(latest) {
  return {
    season: latest?.season ?? SEASON_ALL,
    round: latest?.round ?? ROUND_ALL,
    ...BLANK_ODDS,
  }
}

export default function FilterForm({ filters, defaultQuery, onSearch, teams = [], onH2HSearch }) {
  const [draft, setDraft] = useState(() => makeDefaultDraft(filters?.latest))
  const [warning, setWarning] = useState('')

  const [h2hHome, setH2hHome] = useState('')
  const [h2hAway, setH2hAway] = useState('')
  const [h2hCross, setH2hCross] = useState(false)

  // 리그를 바꾸는 등 필터 선택지 자체가 바뀌면 폼도 그 리그의 기본값으로 리셋
  useEffect(() => {
    setDraft(makeDefaultDraft(filters?.latest))
    setWarning('')
  }, [filters])

  // 팀 목록이 바뀌면(시즌 변경 등) 더는 목록에 없는 선택은 지운다.
  // 자동으로 팀을 채우지 않고 "홈팀 선택/원정팀 선택" 플레이스홀더 상태로 둔다.
  useEffect(() => {
    setH2hHome((prev) => (teams.includes(prev) ? prev : ''))
    setH2hAway((prev) => (teams.includes(prev) ? prev : ''))
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
    onSearch(q)
  }

  function handleReset() {
    const next = makeDefaultDraft(filters?.latest)
    setDraft(next)
    setWarning('')
    onSearch(buildQuery(next).q)
  }

  function handleH2HSearch() {
    if (!h2hHome || !h2hAway || h2hHome === h2hAway || !onH2HSearch) return
    onH2HSearch({ home: h2hHome, away: h2hAway, cross: h2hCross })
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
          <span className="filter-label">상대 전적 조회</span>
          <div className="filter-row h2h-row">
            <select value={h2hHome} onChange={(e) => setH2hHome(e.target.value)}>
              <option value="" disabled>
                홈팀 선택
              </option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="h2h-vs">vs</span>
            <select value={h2hAway} onChange={(e) => setH2hAway(e.target.value)}>
              <option value="" disabled>
                원정팀 선택
              </option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="h2h-cross">
              <input
                type="checkbox"
                checked={h2hCross}
                onChange={(e) => setH2hCross(e.target.checked)}
              />
              홈원 교차보기
            </label>
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
        {teams.length > 0 && (
          <button
            type="button"
            className="btn-search btn-h2h"
            disabled={!h2hHome || !h2hAway || h2hHome === h2hAway}
            onClick={handleH2HSearch}
            title="상대전적을 조회하면 현재 조회된 결과 대신 상대전적을 보여줍니다."
          >
            🆚 상대전적 조회
          </button>
        )}
      </div>

      {warning && <p className="filter-warning">{warning}</p>}
    </form>
  )
}

export { SEASON_ALL, ROUND_ALL }
