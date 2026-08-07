import { useCallback, useEffect, useState } from 'react'
import { api, apiFetch } from '../api/client'
import './BetHistoryPage.css'

const PICK_BADGE = {
  핸승: { background: '#1565C0', color: '#fff' },
  플핸: { background: '#7B1FA2', color: '#fff' },
  핸무: { background: '#64B5F6', color: '#0D1B2A' },
  무: { background: '#757575', color: '#fff' },
  역: { background: '#C62828', color: '#fff' },
}
const PICK_BADGE_DEFAULT = { background: '#9E9E9E', color: '#fff' }

const RESULT_BADGE = {
  적중: { background: '#FDD835', color: '#0D1B2A' },
  미적중: { background: '#C62828', color: '#fff' },
  대기: { background: '#757575', color: '#fff' },
  취소: { background: '#546E7A', color: '#fff' },
}

const HIT_ICON = { 적중: '✅', 미적중: '❌', 대기: '⏳', 취소: '🚫' }

function profitOf(slip) {
  if (slip.odds == null || slip.stake == null) return null
  if (slip.result === '적중') return Math.round(slip.stake * (slip.odds - 1))
  if (slip.result === '미적중') return -slip.stake
  return null // 대기/취소는 아직 확정 금액 없음
}

function formatCreatedDt(v) {
  if (!v) return '-'
  // 'YYYY-MM-DD HH:MM:SS' (UTC, sqlite datetime('now')) -> 'MM.DD HH:MM'
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(v)
  if (!m) return v
  return `${m[2]}.${m[3]} ${m[4]}:${m[5]}`
}

function formatRoundLabel(startIso, endIso) {
  const fmt = (iso) => {
    const [, mo, d] = iso.split('-')
    return `${Number(mo)}/${Number(d)}`
  }
  return `${fmt(startIso)}(금) ~ ${fmt(endIso)}(월)`
}

export default function BetHistoryPage({ scope }) {
  const [slips, setSlips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/api/bet_slips?scope=${scope}`)
      setSlips(res.slips || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete(id) {
    if (!window.confirm('이 베팅 기록을 삭제할까요?')) return
    await apiFetch(`/api/bet_slips/${id}`, { method: 'DELETE' })
    load()
  }

  if (loading) return <div className="bet-history-empty">불러오는 중...</div>
  if (error) return <div className="bet-history-empty error-text">{error}</div>

  // round_start~round_end 기준으로 섹션 묶기 (list_slips가 이미 최신순 정렬해서 내려줌)
  const rounds = []
  for (const slip of slips) {
    const key = `${slip.round_start}~${slip.round_end}`
    let section = rounds.find((r) => r.key === key)
    if (!section) {
      section = { key, round_start: slip.round_start, round_end: slip.round_end, slips: [] }
      rounds.push(section)
    }
    section.slips.push(slip)
  }

  return (
    <div className="bet-history-page">
      <h2 className="bet-history-title">📋 베팅내역</h2>
      <p className="bet-history-desc">
        "이번주 픽"에서 🎟️로 벳등록한 내역을 금요일~월요일 회차 단위로 모아 보여줍니다.
        결과가 나오면 자동으로 적중(O)/미적중(X)을 판정하고 수익률까지 계산합니다.
      </p>

      {rounds.length === 0 && <div className="bet-history-empty">등록된 베팅내역이 없습니다.</div>}

      {rounds.map((section) => (
        <div key={section.key} className="bet-history-round">
          <h3>{formatRoundLabel(section.round_start, section.round_end)}</h3>
          <div className="bet-history-table-wrap">
            <table className="bet-history-table">
              <thead>
                <tr>
                  <th>등록일시</th>
                  <th>베팅 내역</th>
                  <th>배당</th>
                  <th>뱃금액</th>
                  <th>결과</th>
                  <th>예상수익</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {section.slips.map((slip) => (
                  <tr key={slip.id}>
                    <td className="bet-history-nowrap">{formatCreatedDt(slip.created_dt)}</td>
                    <td>
                      <div className="bet-history-legs">
                        {slip.legs.map((leg, i) => (
                          <span key={i} className="bet-history-leg">
                            <span className="bet-history-leg-match">{leg.HT} vs {leg.AT}</span>
                            <span className="bet-history-leg-pick" style={PICK_BADGE[leg.pick_type] || PICK_BADGE_DEFAULT}>
                              {leg.pick_type}
                            </span>
                            <span className="bet-history-leg-hit" title={leg.actual ? `실제: ${leg.actual}` : '경기 결과 대기'}>
                              {HIT_ICON[leg.hit] || '⏳'}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="bet-history-nowrap">{slip.odds ?? '-'}</td>
                    <td className="bet-history-nowrap">{slip.stake != null ? slip.stake.toLocaleString() : '-'}</td>
                    <td className="bet-history-nowrap">
                      <span className="bet-history-result" style={RESULT_BADGE[slip.result] || RESULT_BADGE['대기']}>
                        {slip.result}
                      </span>
                    </td>
                    <td className={`bet-history-nowrap ${profitOf(slip) > 0 ? 'bet-history-profit-pos' : profitOf(slip) < 0 ? 'bet-history-profit-neg' : ''}`}>
                      {profitOf(slip) != null ? profitOf(slip).toLocaleString() : '-'}
                    </td>
                    <td>
                      <button className="bet-history-delete" onClick={() => handleDelete(slip.id)} title="삭제">🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
