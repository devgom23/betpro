import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import LeagueTable, { selectKey } from '../components/LeagueTable/LeagueTable'
import BetSlip from '../components/BetSlip/BetSlip'
import './WeeklyPickPage.css'

function rangeLabel(rows) {
  const dts = rows.map((r) => String(r.DT || '')).filter(Boolean).sort()
  if (dts.length === 0) return null
  const clean = (s) => s.replace(/\s*\(.+\)$/, '').replace(/^(\d{2})-/, '20$1-')
  return `${clean(dts[0])} ~ ${clean(dts[dts.length - 1])}`
}

export default function WeeklyPickPage({ onGoBetHistory }) {
  const [data, setData] = useState({ columns: [], rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  // 선택 삭제용 체크 상태. 키→행 전체를 들고 있어야 삭제 API에 code/scope/S/R/No/HT/AT를 보낼 수 있다.
  const [selected, setSelected] = useState(new Map())
  // 슬립은 "저장"을 누를 때마다 옆에 하나씩 늘어난다.
  const [slipIds, setSlipIds] = useState([1])
  const [nextId, setNextId] = useState(2)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get('/api/weekly_picks'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const rows = data.rows || []
  const period = rangeLabel(rows)

  function toggleRow(row) {
    setSelected((prev) => {
      const key = selectKey(row)
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, row)
      return next
    })
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 경기를 이번주 픽에서 지웁니다(리그 데이터는 그대로입니다). 계속할까요?`)) return
    setClearing(true)
    setError('')
    try {
      const items = [...selected.values()].map((row) => ({
        code: row.L, scope: row.scope, S: row.S, R: row.R, No: row.No, HT: row.HT, AT: row.AT,
      }))
      await api.post('/api/weekly_picks/hide', { items })
      setSelected(new Map())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="wp-page">
      <div className="wp-title-row">
        <h2 className="wp-title">📋 이번주 픽</h2>
        {rows.length > 0 && (
          <button className="wp-clear-btn" onClick={handleDeleteSelected} disabled={clearing || selected.size === 0}>
            🗑 선택 삭제{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        )}
      </div>
      <p className="wp-desc">
        {period && <>{period} · </>}
        별표(★) 표시한 경기 모음 · 체크 후 "선택 삭제"하면 이 화면에서만 빠집니다(리그 데이터는 유지)
      </p>

      {loading && <div className="wp-empty">불러오는 중...</div>}
      {error && <div className="wp-empty error-text">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="wp-empty">
          별표(★) 표시한 경기가 없습니다. 리그 표에서 ☆를 눌러 이번주에 볼 경기를 골라주세요.
        </div>
      )}
      {rows.length > 0 && (
        <LeagueTable
          columns={data.columns}
          rows={rows}
          scope="master"
          selectable
          selectedKeys={new Set(selected.keys())}
          onToggleRow={toggleRow}
          hideIndicators
        />
      )}

      <h2 className="wp-title wp-title-bet">🎲 이번주 벳</h2>
      <p className="wp-desc">
        경기 2개를 골라 유형을 담으면 가상 배당·수익 계산 · "저장"으로 슬립 추가, "벳등록"으로 베팅내역에 기록(시뮬레이션)
      </p>

      <div className="wp-slips">
        {slipIds.map((id) => (
          <BetSlip
            key={id}
            rows={rows}
            scope="master"
            canDelete={slipIds.length > 1}
            onSave={() => {
              setSlipIds((prev) => [...prev, nextId])
              setNextId((n) => n + 1)
            }}
            onDelete={() => setSlipIds((prev) => prev.filter((s) => s !== id))}
            onRegistered={onGoBetHistory}
          />
        ))}
      </div>
    </div>
  )
}
