import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import { bettingDayOf, summarizeVerdicts } from '../components/LeagueTable/columnGroups'
import { PickSummaryBar } from '../components/RtSummaryBar/RtSummaryBar'
import { rankTop20, top20Key, TOP_N } from '../utils/weekTop20'
import './WeekListPage.css'
import './WeekTopPage.css'

// '2026-08-21' → '8/21'
function shortDate(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${Number(m[1])}/${Number(m[2])}` : ''
}

export default function WeekTopPage() {
  const [data, setData] = useState({ columns: [], rows: [] })
  // 지금까지 이번 회차 TOP20에 든 경기 키 — 끝난 경기를 명단에 남길지 가르는 기준(utils/weekTop20.js).
  const [members, setMembers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set(['일반정보', '경기정보', '지표', '똥배']))
  const [showRiskLegend, setShowRiskLegend] = useState(false)
  // 마지막으로 서버에 저장한 명단 — 같은 명단을 매번 다시 저장하지 않으려고.
  const savedRef = useRef('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.get('/api/week_list')
      let keys = []
      if (list.start && list.end) {
        const q = new URLSearchParams({ start: list.start, end: list.end })
        keys = (await api.get(`/api/week_top20/members?${q}`).catch(() => ({ keys: [] }))).keys || []
      }
      savedRef.current = keys.join('\n')
      setData(list)
      setMembers(new Set(keys))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const ranked = useMemo(
    () => (members ? rankTop20(data.rows || [], members) : { top: [], candidateCount: 0 }),
    [data.rows, members],
  )

  // 이번에 순위에 든 경기들을 명단으로 저장한다 — 이 명단에 있어야 경기가 끝난 뒤에도 남는다.
  // 20위 밖으로 밀린 경기는 명단에서 빠진다(끝난 경기라면 다시 들어오지 않는다).
  useEffect(() => {
    if (!members || !data.start || !data.end) return
    const keys = ranked.top.map((c) => c.key)
    const joined = keys.join('\n')
    if (joined === savedRef.current) return
    savedRef.current = joined
    api.post('/api/week_top20/members', { start: data.start, end: data.end, keys }).catch(() => {
      savedRef.current = ''
    })
  }, [ranked, members, data.start, data.end])

  const rows = useMemo(() => ranked.top.map((c) => c.row), [ranked])
  const infoByKey = useMemo(() => new Map(ranked.top.map((c) => [c.key, c])), [ranked])
  const verdictSummary = useMemo(() => summarizeVerdicts(rows), [rows])

  const rankOf = useCallback((row) => {
    const c = infoByKey.get(top20Key(row))
    if (!c) return null
    const { rank, played, score } = c
    const day = bettingDayOf(row)?.label ?? '날짜 미정'
    const title = [
      `${rank}위 · ${score.phase} 판정 ${score.pick}${score.strong ? ` · ${score.strong}` : ''}`,
      `실측 당첨률 ${score.rate.toFixed(2)}% (같은 칸·같은 픽 과거 ${score.n.toLocaleString()}경기)`,
      `가중 일치율 구간 평균 ${score.bandRate.toFixed(2)}%를 픽·강추로 나눈 실측값입니다`,
      played ? '경기 종료 — 순위에 든 채로 끝나 명단에 남아 있습니다' : `베팅일 ${day}`,
    ].join('\n')
    return {
      title,
      label: (
        <div className={`top20-rank${played ? ' top20-played' : ''}`}>
          <strong className="top20-no">{rank}</strong>
          <span className="top20-rate">{score.rate.toFixed(2)}%</span>
          <span className="top20-day">{day}</span>
        </div>
      ),
    }
  }, [infoByKey])

  const period = data.start && data.end
    ? `${data.label ? `${data.label} ` : ''}${shortDate(data.start)} ~ ${shortDate(data.end)}`
    : ''

  return (
    <div className="wl-page">
      <div className="wl-title-row">
        <h2 className="wl-title">🏆 이번주 TOP{TOP_N}</h2>
        {period && <span className="wl-period">{period}</span>}
        {members && (
          <span className="wl-summary">
            후보 <strong>{ranked.candidateCount}</strong> · 순위 <strong>{rows.length}</strong>
          </span>
        )}
      </div>
      <p className="wl-desc">
        이번주 리스트(공식 6대리그) 중 아직 안 치른 경기를 실측 당첨률(시스템 판정 칸을 정무·플핸무·강추로
        나눠 과거 6대리그로 잰 값) 순으로 1~{TOP_N}위까지 보여줍니다 · 같은 칸끼리는 킥오프 순 ·
        배변 배당이 있으면 배변 판정, 없으면 초기 판정으로 계산해 배변이 들어오면 순위가
        바뀝니다(최신배당은 이번주 리스트에서 불러오세요) · 한 번 순위에 든 경기는 끝나도 남고, 다른 경기에
        밀려 {TOP_N}위 밖으로 나가면 빠집니다 · K1/K2는 실측 %가 없어 제외
      </p>

      {loading && <div className="wl-empty">불러오는 중...</div>}
      {error && <div className="wl-empty error-text">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="wl-empty">순위를 매길 경기가 없습니다(안 치른 6대리그 경기 중 판정이 나온 경기가 없음).</div>
      )}

      {rows.length > 0 && (
        <>
          <div className="wl-refresh-row">
            <PickSummaryBar summary={verdictSummary} />
          </div>
          <LeagueTable
            columns={data.columns}
            rows={rows}
            scope="master"
            hideIndicators
            fitContent
            rankOf={rankOf}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            showRiskLegend={showRiskLegend}
            onShowRiskLegendChange={setShowRiskLegend}
          />
        </>
      )}
    </div>
  )
}
