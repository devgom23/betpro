import { useEffect, useState } from 'react'
import { api } from '../api/client'
import LeagueTable from '../components/LeagueTable/LeagueTable'

const RT_ORDER = ['핸승', '핸무', '무', '역']

export default function TotalDbPage({ scope }) {
  const [dashboard, setDashboard] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [league, setLeague] = useState('ALL')
  const [season, setSeason] = useState('ALL')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busyPending, setBusyPending] = useState(false)
  const [busyAll, setBusyAll] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [showAllExpander, setShowAllExpander] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    api.get('/api/leagues').then(setLeagues).catch(() => setLeagues([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .get(`/api/dashboard?scope=${scope}`)
      .then((res) => {
        if (!cancelled) setDashboard(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [scope])

  useEffect(() => {
    let cancelled = false
    setError('')
    api
      .get(`/api/total?scope=${scope}&league=${league}&season=${season}`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [scope, league, season])

  function refreshAll() {
    setLeague('ALL')
    setSeason('ALL')
    api.get(`/api/dashboard?scope=${scope}`).then(setDashboard).catch(() => {})
    api
      .get(`/api/total?scope=${scope}&league=ALL&season=ALL`)
      .then(setData)
      .catch(() => {})
  }

  async function runRecomputePending() {
    setBusyPending(true)
    setNotice('')
    try {
      const res = await api.post('/api/recompute/pending', { scope })
      const lines = Object.entries(res.summary)
        .filter(([, n]) => n > 0)
        .map(([lg, n]) => `${leagues.find((l) => l.code === lg)?.label ?? lg} ${n}건`)
      setNotice(lines.length ? `재분석 완료 → ${lines.join(' · ')}` : '재분석 대상(예정 경기)이 없습니다.')
      refreshAll()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyPending(false)
    }
  }

  async function runRecomputeAll() {
    if (!confirmAll) {
      setNotice('확인 체크박스를 선택한 뒤 눌러주세요.')
      return
    }
    setBusyAll(true)
    setNotice('')
    try {
      const res = await api.post('/api/recompute/all', { scope, confirm: true })
      const lines = Object.entries(res.summary)
        .filter(([, n]) => n > 0)
        .map(([lg, n]) => `${leagues.find((l) => l.code === lg)?.label ?? lg} ${n}건`)
      setNotice(lines.length ? `전체 재계산 완료 → ${lines.join(' · ')}` : '재계산할 데이터가 없습니다.')
      refreshAll()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyAll(false)
    }
  }

  if (error) return <p className="error-text">{error}</p>
  if (!dashboard) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <h2 className="section-title">📈 통합DB (6대 리그 합산)</h2>

      <table className="dashboard-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>리그</th>
            <th>경기수</th>
            <th>시즌</th>
            <th>결과보유</th>
            <th>예정</th>
            <th>국내배당</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.rows.map((row) => (
            <tr key={row.코드}>
              <td>{row.리그}</td>
              <td>{row.경기수.toLocaleString()}</td>
              <td>{row.시즌}</td>
              <td>{row.결과보유.toLocaleString()}</td>
              <td>{row.예정.toLocaleString()}</td>
              <td>{row.국내배당.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {dashboard.can_write && (
        <div className="recompute-box">
          <h3>🔄 통합 및 예측 분석</h3>
          <p className="recompute-caption">
            결과(RT)가 없는 예정 경기만 골라, 지금까지 올린 모든 리그를 합친 최신 통합 데이터
            기준으로 26개 지표와 예측을 다시 계산합니다. 이미 끝난 경기는 건드리지 않습니다.
          </p>
          <button className="btn-primary" disabled={busyPending} onClick={runRecomputePending}>
            {busyPending ? '재분석 중...' : '🔄 통합 및 예측 분석 실행'}
          </button>

          <div className="expander">
            <button className="expander-toggle" onClick={() => setShowAllExpander((v) => !v)}>
              {showAllExpander ? '▾' : '▸'} 🔧 전체 재계산 (과거 경기 포함 · 초기 세팅용)
            </button>
            {showAllExpander && (
              <div className="expander-body">
                <p className="recompute-caption">
                  리그를 하나씩 올릴 때 먼저 올린 리그의 과거 경기 통합지표는 그 시점까지 올라온
                  리그만 반영된 채로 남습니다. 6개 리그를 처음 다 올렸거나 데이터를 대대적으로
                  정정한 직후 딱 한 번 눌러 전체를 최신 기준으로 맞추세요. 경기 수가 많으면 수 분
                  이상 걸릴 수 있습니다.
                </p>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={confirmAll}
                    onChange={(e) => setConfirmAll(e.target.checked)}
                  />
                  과거 경기를 포함해 전체를 다시 계산합니다 (시간이 걸릴 수 있음)
                </label>
                <button className="btn-danger" disabled={busyAll} onClick={runRecomputeAll}>
                  {busyAll ? '재계산 중...' : '🔧 전체 재계산 실행'}
                </button>
              </div>
            )}
          </div>

          {notice && <p className="recompute-notice">{notice}</p>}
        </div>
      )}

      {!data || data.grand_total === 0 ? (
        <p className="loading-text">통합할 데이터가 없습니다.</p>
      ) : (
        <>
          <div className="total-filters">
            <select value={league} onChange={(e) => setLeague(e.target.value)}>
              <option value="ALL">전체</option>
              {leagues.map((lg) => (
                <option key={lg.code} value={lg.code}>
                  {lg.label}
                </option>
              ))}
            </select>
            <select value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="ALL">전체</option>
              {data.seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="total-count">
              {data.total.toLocaleString()} / {data.grand_total.toLocaleString()} 경기
            </span>
          </div>

          {data.rt_summary && (
            <div className="rt-metrics">
              {RT_ORDER.map((name) => (
                <div className="rt-metric" key={name}>
                  <span className="rt-metric-name">{name}</span>
                  <span className="rt-metric-value">{data.rt_summary[name].toLocaleString()}</span>
                  <span className="rt-metric-pct">
                    {((data.rt_summary[name] / data.rt_summary.총) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          <LeagueTable columns={data.columns} rows={data.rows} scope={scope} />
        </>
      )}
    </div>
  )
}
