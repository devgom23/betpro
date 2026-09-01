import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { api } from '../api/client'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import { bettingDayOf, summarizeVerdicts } from '../components/LeagueTable/columnGroups'
import { PickSummaryBar } from '../components/RtSummaryBar/RtSummaryBar'
import {
  getWeekListFinalOddsTime, setWeekListFinalOddsTime, setManyRoundFinalOddsTime, formatFinalOddsTime,
} from '../utils/finalOddsTime'
import { isWeekSnapshotDone, markWeekSnapshotDone } from '../utils/weekSnapshotFlag'
import './WeekListPage.css'

// 회차 마지막날 판정용 — 서버(datetime.date.today())와 마찬가지로 이 PC의 현지 날짜를 쓴다
// (Date.toISOString()은 UTC라 자정 근처에서 하루가 밀릴 수 있어 쓰지 않는다).
function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function hasResult(v) {
  return v !== null && v !== undefined && String(v).trim() !== ''
}

// 날짜(DT)가 비어 아직 베팅일을 못 정하는 경기들을 모아 둘 자리. 맨 아래로 보낸다.
const NO_DAY = { key: '￿', label: '날짜 미정' }

// 리그 탭 순서대로 정렬하기 위한 코드→순번 표.
// 공식 데이터(6대리그)를 먼저, 그다음 내 데이터 리그를 탭에 보이는 순서 그대로 잇는다
// — 백엔드 /api/week_list 가 도는 순서(master → user)와도 같다.
function buildLeagueOrder(masterLeagues, userLeagues) {
  const order = new Map()
  ;[...masterLeagues, ...userLeagues].forEach((lg, i) => {
    if (lg?.code != null && !order.has(lg.code)) order.set(lg.code, i)
  })
  return order
}

// '2026-08-21' → '8/21'
function shortDate(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${Number(m[1])}/${Number(m[2])}` : ''
}

export default function WeekListPage() {
  const [data, setData] = useState({ columns: [], rows: [] })
  const [leagueOrder, setLeagueOrder] = useState(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 접기 상태·색상 참고표는 요일 구간이 여러 개라도 하나로 묶어 제어한다 —
  // 구간마다 따로 접히면 같은 화면에서 표 모양이 제각각이 되어 읽기 힘들다.
  // 일반정보는 기본으로 접어 둔다 — 시즌/날짜는 요일 구간 헤더로 이미 알 수 있어
  // 접힌 채로 리그명·라운드·시간만 보여도 충분하다(LeagueTable.jsx의 hasLeagueLabel
  // 처리 덕에 접혀도 리그명은 계속 보인다).
  const [collapsed, setCollapsed] = useState(() => new Set(['일반정보', '경기정보', '지표']))
  const [showRiskLegend, setShowRiskLegend] = useState(false)
  const [busyRefreshOdds, setBusyRefreshOdds] = useState(false)
  const [refreshOddsNotice, setRefreshOddsNotice] = useState('')
  // 이번주 리스트 버튼 자체를 마지막으로 눌렀던 시각 — 개별 라운드 버튼과는 별개 값이다
  // (utils/finalOddsTime.js 참고. 이 버튼을 누르면 그 안의 각 라운드 값도 같이 갱신되지만,
  //  반대로 라운드 버튼을 눌렀다고 이 값이 갱신되진 않는다).
  const [weekListTs, setWeekListTs] = useState(() => getWeekListFinalOddsTime())
  const [snapping, setSnapping] = useState(false)
  const [snapshotNotice, setSnapshotNotice] = useState('')
  // 스냅샷 캡처 범위 — 화면 전체(이 페이지 콘텐츠 전부)를 담는다.
  const pageRef = useRef(null)
  // 자동 스냅샷이 지금 진행 중인지 — data/rows가 다시 바뀌어 이펙트가 또 돌아도
  // 캡처가 끝나기 전엔 중복으로 또 찍지 않게 막는다.
  const autoSnapBusyRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, master, mine] = await Promise.all([
        api.get('/api/week_list'),
        api.get('/api/leagues?scope=master').catch(() => []),
        api.get('/api/leagues?scope=user').catch(() => []),
      ])
      const asList = (res) => (Array.isArray(res) ? res : res?.leagues || [])
      setData(list)
      setLeagueOrder(buildLeagueOrder(asList(master), asList(mine)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 이번주 리스트는 여러 리그·라운드가 한 표에 섞여 있어(요일별로만 나뉨), 리그 화면의
  // "최신배당 불러오기"(리그+시즌+라운드 하나만 대상)를 그대로 못 쓴다 — 지금 화면에
  // 실제로 보이는 (스코프,리그,시즌,라운드) 조합을 전부 뽑아 하나씩 순서대로 호출한다.
  async function runRefreshFinalOdds() {
    if (!rows.length) return
    const combos = new Map()
    for (const r of rows) {
      const key = `${r.scope}|${r.L}|${r.S}|${r.R}`
      if (!combos.has(key)) combos.set(key, { scope: r.scope, code: r.L, season: r.S, round: r.R })
    }
    setBusyRefreshOdds(true)
    setRefreshOddsNotice('')
    let ek = 0
    let ef = 0
    const fails = []
    const succeeded = []
    for (const combo of combos.values()) {
      const { scope, code, season, round } = combo
      try {
        const res = await api.post(`/api/leagues/${code}/refresh_final_odds`, { scope, season, round })
        ek += res.domestic_updated || 0
        ef += res.overseas_updated || 0
        if (res.domestic_error) fails.push(`${code} ${round} 국내: ${res.domestic_error}`)
        if (res.overseas_error) fails.push(`${code} ${round} 해외: ${res.overseas_error}`)
        succeeded.push(combo)
      } catch (err) {
        fails.push(`${code} ${round}: ${err.message}`)
      }
    }
    const parts = [`${combos.size}개 라운드 · 국내 ${ek}건 · 해외 ${ef}건 갱신`]
    if (fails.length) parts.push(...fails)
    setRefreshOddsNotice(parts.join(' · '))
    // 응답을 정상적으로 받은(catch에 안 걸린) 조합만 "불러왔다"로 친다 — 이 버튼 자체의
    // 시각과, 그 안에 포함된 각 라운드(리그 화면에서 보이는)의 시각을 같이 찍는다.
    if (succeeded.length) {
      const now = new Date().toISOString()
      setManyRoundFinalOddsTime(succeeded, now)
      setWeekListFinalOddsTime(now)
      setWeekListTs(now)
    }
    if (ek || ef) load()
    setBusyRefreshOdds(false)
  }

  // data.rows가 없을 때 매번 새 배열([])을 만들면 아래 useMemo가 렌더마다 다시 돌아
  // 캐시 의미가 없어진다 — 같은 참조를 유지하려고 useMemo로 감싼다.
  const rows = useMemo(() => data.rows || [], [data.rows])

  // 요일(베팅일)별로 묶고, 각 묶음 안은 리그 탭 순서 → 킥오프 시각 순으로 세운다.
  const daySections = useMemo(() => {
    const buckets = new Map()
    for (const row of rows) {
      const day = bettingDayOf(row) || NO_DAY
      if (!buckets.has(day.key)) buckets.set(day.key, { ...day, rows: [] })
      buckets.get(day.key).rows.push(row)
    }
    const rank = (row) => {
      const idx = leagueOrder.get(row.L)
      return idx === undefined ? Number.MAX_SAFE_INTEGER : idx
    }
    // 같은 리그 안에서의 순서는 킥오프 시각으로 가른다. 단 새벽 경기(6시 이전)는
    // 그 베팅일의 '가장 늦은' 경기이므로 2400을 더해 맨 뒤로 보낸다
    // — 백엔드 _betting_day_sort_key와 같은 규칙(안 그러면 0130 경기가 2300 앞에 온다).
    const tmOf = (row) => {
      const n = Number(row.TM)
      if (!Number.isFinite(n)) return 0
      return Math.floor(n / 100) < 6 ? n + 2400 : n
    }
    for (const sec of buckets.values()) {
      sec.rows.sort((a, b) => rank(a) - rank(b) || tmOf(a) - tmOf(b))
      sec.verdict = summarizeVerdicts(sec.rows)
    }
    return [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }, [rows, leagueOrder])

  // 지금 불러온 회차 전체(요일 구분 없이)의 적중/보험/미적 — 새로고침 버튼 옆 요약.
  const totalVerdict = useMemo(() => summarizeVerdicts(rows), [rows])

  // 화면 전체(요일 구간·표 포함)를 이미지로 저장한다. 어디서 다시 볼지는 아직 안 정했고,
  // 지금은 저장만 한다 — data/users/{계정}/snapshots/ 밑에 시각을 이름에 담아 쌓인다.
  // reason: 'manual'(버튼 직접 클릭) | 'results'(경기 결과 전부 입력됨) | 'last_day'(회차 마지막날).
  // 성공 여부를 돌려줘야 자동 트리거 쪽에서 "이 회차는 이미 찍었다" 표시를 성공했을 때만 남긴다.
  const captureAndSave = useCallback(async (reason) => {
    if (!pageRef.current) return false
    setSnapping(true)
    setSnapshotNotice('')
    try {
      const canvas = await html2canvas(pageRef.current, { backgroundColor: null, useCORS: true })
      const image = canvas.toDataURL('image/png')
      await api.post('/api/snapshots', { page: 'week_list', image })
      const label = reason === 'results' ? '자동 저장(경기 결과 전부 입력됨)'
        : reason === 'last_day' ? '자동 저장(회차 마지막날)'
        : '스냅샷'
      setSnapshotNotice(`${label}을 저장했습니다.`)
      return true
    } catch (err) {
      setSnapshotNotice(`스냅샷 저장 실패: ${err.message}`)
      return false
    } finally {
      setSnapping(false)
    }
  }, [])

  function handleSnapshot() {
    captureAndSave('manual')
  }

  // 자동 스냅샷 — 회차(시작~종료)당 한 번만, 아래 둘 중 먼저 맞는 조건에서 찍는다.
  //   1) 화면에 있는 경기 전부에 결과(RT)가 입력됨 — "이 회차는 다 끝났다"
  //   2) 오늘이 이 회차의 마지막날 — 결과 입력이 덜 됐어도(연기 등으로 영영 안 채워질 수도
  //      있으니) 회차가 넘어가기 전에 마지막 모습을 남겨 둔다
  // ⚠ 브라우저를 이 화면에서 열어봐야만 찍힌다(서버 혼자 알아서 찍지는 못한다 — 스크린샷이라
  //   화면이 실제로 그려져야 한다). 표시는 회차별로 브라우저(localStorage)에 남긴다.
  useEffect(() => {
    if (!data.start || !data.end || rows.length === 0) return
    if (autoSnapBusyRef.current || isWeekSnapshotDone(data.start, data.end)) return
    const allDecided = rows.every((r) => hasResult(r.RT))
    const isLastDay = localDateStr() >= data.end
    if (!allDecided && !isLastDay) return
    const reason = allDecided ? 'results' : 'last_day'
    autoSnapBusyRef.current = true
    captureAndSave(reason).then((ok) => {
      if (ok) markWeekSnapshotDone(data.start, data.end, reason)
      autoSnapBusyRef.current = false
    })
  }, [data.start, data.end, rows, captureAndSave])

  const period = data.start && data.end
    ? `${data.label ? `${data.label} ` : ''}${shortDate(data.start)} ~ ${shortDate(data.end)}`
    : ''

  return (
    <div className="wl-page" ref={pageRef}>
      <div className="wl-title-row">
        <h2 className="wl-title">🗓 이번주 리스트</h2>
        {period && <span className="wl-period">{period}</span>}
        {rows.length > 0 && (
          <span className="wl-summary">
            <strong>{daySections.length}</strong>일 · 경기 <strong>{rows.length}</strong>
          </span>
        )}
      </div>
      <p className="wl-desc">
        이번 회차(금~화 / 수~목)에 열리는 경기를 요일별로 나눠 전부 보여줍니다 ·
        각 요일 안은 리그 탭 순서 · 여기서 고친 내용은 해당 리그에도 그대로 반영됩니다
      </p>

      {loading && <div className="wl-empty">불러오는 중...</div>}
      {error && <div className="wl-empty error-text">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="wl-empty">이번 회차 기간에 등록된 경기가 없습니다.</div>
      )}

      {rows.length > 0 && (
        <div className="wl-refresh-row">
          <PickSummaryBar summary={totalVerdict} />
          <button
            className="batch-fold-btn"
            onClick={runRefreshFinalOdds}
            disabled={busyRefreshOdds}
            title="지금 보이는 이번주 리스트 전체(리그·라운드 조합별)의 국내·해외 최종배당(배변 후)만 다시 받습니다. 초기배당은 그대로 둡니다."
          >
            {busyRefreshOdds ? '불러오는 중…' : '최신배당 불러오기'}
          </button>
          <button
            className="batch-fold-btn"
            onClick={handleSnapshot}
            disabled={snapping}
            title="지금 이 화면(요일별 목록 전체)을 이미지로 저장합니다. 어디서 다시 볼지는 나중에 정합니다."
          >
            {snapping ? '저장 중…' : '📸 스냅샷 저장'}
          </button>
          {weekListTs && (
            <span className="final-odds-ts">최신배당({formatFinalOddsTime(weekListTs)})</span>
          )}
          {refreshOddsNotice && <p className="recompute-notice">{refreshOddsNotice}</p>}
          {snapshotNotice && <p className="recompute-notice">{snapshotNotice}</p>}
        </div>
      )}

      {daySections.map((sec) => (
        <section className="wl-day" key={sec.key}>
          <div className="wl-day-head">
            <span className={`wl-day-chip wl-day-${sec.weekday || 'none'}`}>{sec.label}</span>
            <span className="wl-day-count">{sec.rows.length}경기</span>
            <PickSummaryBar summary={sec.verdict} />
          </div>
          <LeagueTable
            columns={data.columns}
            rows={sec.rows}
            scope="master"
            hideIndicators
            fitContent
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            showRiskLegend={showRiskLegend}
            onShowRiskLegendChange={setShowRiskLegend}
          />
        </section>
      ))}
    </div>
  )
}
