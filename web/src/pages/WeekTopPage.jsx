import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import { summarizeVerdicts, summarizeSystemVerdicts } from '../components/LeagueTable/columnGroups'
import { PickSummaryBar } from '../components/RtSummaryBar/RtSummaryBar'
import { rankByKind, rankInfoOf, top20Key, TOP_N, KINDS } from '../utils/weekTop20'
import { buildRankBadge } from '../utils/weekRankBadge'
import './WeekListPage.css'
import './WeekTopPage.css'

// '2026-08-21' → '8/21'
function shortDate(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${Number(m[1])}/${Number(m[2])}` : ''
}

// 갈래(정무/플핸무) 하나 — 순위 계산 + '직전 순위' 저장을 독립적으로 관리한다.
// 화면에 지금 보이는 탭이 아니어도(예: 플핸무를 보는 동안 정무 쪽도) 데이터가 오면 같이
// 계산·저장한다 — 안 그러면 안 보고 있던 갈래의 등락 화살표 기준이 갱신되지 않는다.
//
// 2026-09-12: 순위는 결과(RT)와 무관하게 매번 순수하게 다시 매긴다(weekTop20.js 주석
// 참고). 서버 저장은 더 이상 "후보 자격"이 아니라 오직 '직전에 몇 위였나'를 기억해
// 등락 화살표(3(1▼) 형태, rankOf 참고)를 보여주는 용도다 — 저장 순서 자체가 그 갈래의
// 직전 순위이므로 배열 인덱스+1을 prevRank로 쓴다.
function useKindRanking(kind, rows, start, end) {
  const [prevRanks, setPrevRanks] = useState(null)
  const savedRef = useRef('')

  useEffect(() => {
    let alive = true
    setPrevRanks(null)
    if (!start || !end) {
      setPrevRanks(new Map())
      return undefined
    }
    const q = new URLSearchParams({ start, end, kind })
    api.get(`/api/week_top20/members?${q}`).catch(() => ({ keys: [] })).then((res) => {
      if (!alive) return
      const keys = res.keys || []
      savedRef.current = keys.join('\n')
      setPrevRanks(new Map(keys.map((k, i) => [k, i + 1])))
    })
    return () => { alive = false }
  }, [kind, start, end])

  const ranked = useMemo(
    () => (prevRanks ? rankByKind(rows, kind, prevRanks) : { top: [], candidateCount: 0 }),
    [rows, kind, prevRanks],
  )

  useEffect(() => {
    if (!prevRanks || !start || !end) return
    const keys = ranked.top.map((c) => c.key)
    const joined = keys.join('\n')
    if (joined === savedRef.current) return
    savedRef.current = joined
    api.post('/api/week_top20/members', { start, end, kind, keys }).catch(() => {
      savedRef.current = ''
    })
  }, [ranked, prevRanks, kind, start, end])

  return ranked
}

export default function WeekTopPage() {
  const [data, setData] = useState({ columns: [], rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(KINDS[0])
  const [collapsed, setCollapsed] = useState(() => new Set(['일반정보', '경기정보', '지표', '똥배']))
  const [showRiskLegend, setShowRiskLegend] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.get('/api/week_list')
      setData(list)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const listRows = data.rows || []
  // 갈래마다 독립된 순위·명단 — 둘 다 항상 계산해서, 지금 안 보고 있는 탭도 명단이 유지된다.
  const rankedJung = useKindRanking('정무', listRows, data.start, data.end)
  const rankedPlhan = useKindRanking('플핸무', listRows, data.start, data.end)
  const rankedByKind = { 정무: rankedJung, 플핸무: rankedPlhan }
  const ranked = rankedByKind[tab]

  const rows = useMemo(() => ranked.top.map((c) => c.row), [ranked])
  const infoByKey = useMemo(() => new Map(ranked.top.map((c) => [c.key, c])), [ranked])
  const verdictSummary = useMemo(() => summarizeVerdicts(rows), [rows])
  // 시스템 판정 기준 적중/보험/미적 — 2026-09-12 추가, 리그 화면·이번주 리스트와 같은 계산.
  const systemVerdictSummary = useMemo(() => summarizeSystemVerdicts(rows), [rows])

  const rankOf = useCallback((row) => {
    const c = infoByKey.get(top20Key(row))
    if (!c) return null
    return buildRankBadge(rankInfoOf(c, tab, row))
  }, [infoByKey, tab])

  const period = data.start && data.end
    ? `${data.label ? `${data.label} ` : ''}${shortDate(data.start)} ~ ${shortDate(data.end)}`
    : ''
  const ready = rankedJung.top !== undefined && rankedPlhan.top !== undefined

  return (
    <div className="wl-page">
      <div className="wl-title-row">
        <h2 className="wl-title">🏆 이번주 TOP30</h2>
        {period && <span className="wl-period">{period}</span>}
      </div>
      <p className="wl-desc">
        이번주 리스트(공식 6대리그) 전체를 <b>경기 결과와 무관하게</b> 실측 당첨률(시스템 판정 칸을
        정무·플핸무·강추로 나눠 과거 6대리그로 잰 값) 순으로 매번 새로 매깁니다 ·
        <b> 정무와 플핸무를 한 줄로 같이 세우면 정무가 전부 차지해서</b> 정무 TOP{TOP_N} /
        플핸무 TOP{TOP_N}을 따로 매깁니다 · 같은 %끼리는 킥오프 순 · 배변 배당이 있으면 배변 판정,
        없으면 초기 판정으로 계산해 배변이 들어오면 순위가 바뀝니다(최신배당은 이번주 리스트에서
        불러오세요) · 경기가 끝나도 판정은 배당(배변) 기준 그대로라 계속 순위 경쟁에 남습니다 ·
        순위 숫자 옆 <b>(1▼)</b>·<b>(5▲)</b>는 직전에 본 순위 대비 오르내림입니다 ·
        K1/K2는 실측 %가 없어 제외
      </p>

      <div className="top20-tabs">
        {KINDS.map((k) => {
          const r = rankedByKind[k]
          return (
            <button
              key={k}
              className={`top20-tab${tab === k ? ' active' : ''}`}
              onClick={() => setTab(k)}
            >
              {k} TOP{TOP_N}
              {r.top.length > 0 && <span className="top20-tab-count">{r.top.length}</span>}
            </button>
          )
        })}
      </div>

      {loading && <div className="wl-empty">불러오는 중...</div>}
      {error && <div className="wl-empty error-text">{error}</div>}
      {!loading && !error && ready && rows.length === 0 && (
        <div className="wl-empty">{tab} 판정으로 순위를 매길 경기가 없습니다.</div>
      )}

      {rows.length > 0 && (
        <>
          <div className="wl-refresh-row">
            <span className="wl-summary">
              {tab} 후보 <strong>{ranked.candidateCount}</strong> · 순위 <strong>{rows.length}</strong>
            </span>
            <span className="league-summary-pick-group">
              <span className="league-summary-pick-label">판정</span>
              <PickSummaryBar summary={systemVerdictSummary} />
            </span>
            <span className="league-summary-divider" aria-hidden="true" />
            <PickSummaryBar summary={verdictSummary} />
          </div>
          <LeagueTable
            key={tab}
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
