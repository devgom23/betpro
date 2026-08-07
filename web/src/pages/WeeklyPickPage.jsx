import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import LeagueTable from '../components/LeagueTable/LeagueTable'
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

  return (
    <div className="wp-page">
      <h2 className="wp-title">📋 이번주 픽</h2>
      <p className="wp-desc">
        {period && <>{period} · </>}
        공식 데이터/내 데이터를 가리지 않고 별표(★) 표시한 경기를 모두 모아 보여줍니다.
      </p>

      {loading && <div className="wp-empty">불러오는 중...</div>}
      {error && <div className="wp-empty error-text">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="wp-empty">
          별표(★) 표시한 경기가 없습니다. 리그 표에서 ☆를 눌러 이번주에 볼 경기를 골라주세요.
        </div>
      )}
      {rows.length > 0 && (
        <LeagueTable columns={data.columns} rows={rows} scope="master" />
      )}

      <h2 className="wp-title wp-title-bet">🎲 이번주 벳</h2>
      <p className="wp-desc">
        위 표의 경기 중 두 경기를 골라 베팅 유형(정/역/무/핸승/핸무/플핸)을 담으면, 두 선택을 조합한
        가상 배당·수익을 계산해 보여줍니다. "저장"을 누르면 이 슬립은 그대로 남고 옆에 새 슬립이 하나 더
        생깁니다. "벳등록"을 누르면 조합표의 줄들이 베팅내역 탭에 기록됩니다. 실제 베팅이 아닌
        시뮬레이션입니다.
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
