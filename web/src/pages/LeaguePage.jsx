import { useEffect, useState } from 'react'
import { api } from '../api/client'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import FilterForm from '../components/FilterForm/FilterForm'

const ODDS_KEYS = ['kw', 'kd', 'kl', 'khw', 'khd', 'khl', 'fw', 'fd', 'fl']

function buildQueryString(scope, query) {
  const params = new URLSearchParams({ scope })
  if (query) {
    if (query.season) params.set('season', query.season)
    if (query.round) params.set('round', query.round)
    for (const key of ODDS_KEYS) {
      if (query[key] !== undefined && query[key] !== null) {
        params.set(key, String(query[key]))
      }
    }
  }
  return params.toString()
}

function describeQuery(query) {
  if (!query) return ''
  const parts = []
  if (query.season && query.season !== 'ALL') parts.push(`S=${query.season}`)
  if (query.round && query.round !== 'ALL') parts.push(`R=${query.round}`)
  for (const key of ODDS_KEYS) {
    if (query[key] !== undefined && query[key] !== null) {
      parts.push(`${key.toUpperCase()}=${query[key]}`)
    }
  }
  return parts.join(' · ') || '전체'
}

export default function LeaguePage({ code, scope }) {
  const [filters, setFilters] = useState(null)
  const [query, setQuery] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // 리그/스코프가 바뀌면 시즌·라운드 선택지부터 다시 불러온다
  useEffect(() => {
    let cancelled = false
    setFilters(null)
    setQuery(null)
    api
      .get(`/api/leagues/${code}/filters?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setFilters(res)
        setQuery({ season: res.latest?.season ?? 'ALL', round: res.latest?.round ?? 'ALL' })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope])

  // 조회 조건(query)이 확정되면 실제 표 데이터를 불러온다 (조건 입력 중엔 재조회 안 함)
  useEffect(() => {
    if (!query) return
    let cancelled = false
    setError('')
    api
      .get(`/api/leagues/${code}?${buildQueryString(scope, query)}`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, query])

  if (error) return <p className="error-text">{error}</p>
  if (!filters || !data) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <FilterForm filters={filters} onSearch={setQuery} />
      <div className="league-summary">
        <span>🔍 조회 조건: {describeQuery(query)}</span>
        <span>
          <strong>{data.total.toLocaleString()}</strong>경기
        </span>
      </div>
      <LeagueTable columns={data.columns} rows={data.rows} scope={scope} />
    </div>
  )
}
