import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import LeagueTable, { selectKey } from '../components/LeagueTable/LeagueTable'
import BetSlip from '../components/BetSlip/BetSlip'
import './WeeklyPickPage.css'

const SLIP_IDS_KEY = 'betpro_week_bet_slip_ids'

// 슬립 카드 자체(몇 개가 떠 있는지)도 새로고침·탭 이동에도 남아있어야 한다 —
// 안의 경기·벳금액은 BetSlip이 자기 id로 따로 저장한다.
function loadSlipIdsState() {
  try {
    const raw = localStorage.getItem(SLIP_IDS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.slipIds) && parsed.slipIds.length > 0 && typeof parsed.nextId === 'number') {
      return parsed
    }
  } catch {
    // 무시하고 기본값으로
  }
  return null
}

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
  // 슬립은 "저장"을 누를 때마다 옆에 하나씩 늘어난다. 탭을 벗어났다 돌아오거나
  // 새로고침해도 "삭제"를 누르기 전까지는 그대로 남아있어야 해서 localStorage에 저장한다.
  const persisted = loadSlipIdsState()
  const [slipIds, setSlipIds] = useState(persisted?.slipIds ?? [1])
  const [nextId, setNextId] = useState(persisted?.nextId ?? 2)

  useEffect(() => {
    localStorage.setItem(SLIP_IDS_KEY, JSON.stringify({ slipIds, nextId }))
  }, [slipIds, nextId])

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

      <h2 className="wp-title wp-title-bet">
        🎲 이번주 벳 <span className="wp-title-warn">똥배는 3번 생각하고 가자</span>
      </h2>

      <div className="wp-slips">
        {slipIds.map((id) => (
          <BetSlip
            key={id}
            id={id}
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
