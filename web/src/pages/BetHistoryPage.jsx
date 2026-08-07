import { useCallback, useEffect, useState } from 'react'
import { api, apiFetch } from '../api/client'
import './BetHistoryPage.css'

const PICK_BADGE = {
  핸승: { background: '#1565C0', color: '#fff' },
  플핸: { background: '#7B1FA2', color: '#fff' },
  핸무: { background: '#64B5F6', color: '#0D1B2A' },
  무: { background: '#757575', color: '#fff' },
  역: { background: '#C62828', color: '#fff' },
  정: { background: '#00897B', color: '#fff' },
}
const PICK_BADGE_DEFAULT = { background: '#9E9E9E', color: '#fff' }

// 다리별 적중 · 조합 전체 결과 모두 같은 배색을 쓴다.
const HIT_BADGE = {
  적중: { background: '#FDD835', color: '#0D1B2A' },
  미적중: { background: '#C62828', color: '#fff' },
  대기: { background: '#757575', color: '#fff' },
  취소: { background: '#546E7A', color: '#fff' },
}
// 다리 셀은 좁아서 "미적중" 대신 스샷처럼 "미적"으로 줄여 쓴다.
const HIT_SHORT = { 적중: '적중', 미적중: '미적', 대기: '대기', 취소: '취소' }

const num = (v) => (v == null ? '-' : v.toLocaleString())
const odds = (v) => (v == null ? '-' : v.toFixed(2))
const pct = (v) => (v == null ? '-' : `${v}%`)
const signClass = (v) => (v == null ? '' : v > 0 ? 'bh-pos' : v < 0 ? 'bh-neg' : '')

function formatCreatedDt(v) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? `${m[1]}-${m[2]}-${m[3]}` : v || '-'
}

function formatRoundLabel(startIso, endIso) {
  const fmt = (iso) => {
    const [, mo, d] = iso.split('-')
    return `${Number(mo)}/${Number(d)}`
  }
  return `${fmt(startIso)}(금) ~ ${fmt(endIso)}(월)`
}

function Badge({ value, map, fallback }) {
  return <span className="bh-badge" style={map[value] || fallback}>{value}</span>
}

export default function BetHistoryPage({ scope }) {
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/api/bet_slips?scope=${scope}`)
      setRounds(res.rounds || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { load() }, [load])

  async function handleDeleteBatch(batchId) {
    if (!window.confirm('이 번에 등록한 벳 묶음을 통째로 삭제할까요?')) return
    await apiFetch(`/api/bet_batches/${batchId}`, { method: 'DELETE' })
    load()
  }

  if (loading) return <div className="bh-empty">불러오는 중...</div>
  if (error) return <div className="bh-empty error-text">{error}</div>

  return (
    <div className="bh-page">
      <h2 className="bh-title">📋 베팅내역</h2>
      <p className="bh-desc">
        "이번주 벳"에서 벳등록한 조합을 금요일~월요일 회차 단위로 모아 보여줍니다.
        결과를 입력하면 자동으로 적중/미적중을 판정하고, 한 번에 등록한 묶음별로 수익률까지 계산합니다.
      </p>

      {rounds.length === 0 && <div className="bh-empty">등록된 베팅내역이 없습니다.</div>}

      {rounds.map((rnd) => {
        // 경기 컬럼은 그 회차에서 다리가 가장 많은 벳에 맞춰 늘어난다(3폴·4폴도 그대로 들어감).
        const legCols = Array.from({ length: rnd.max_legs }, (_, i) => i)
        // 소계·합계 행의 라벨은 등록일시 ~ 배당까지를 하나로 합쳐 쓴다.
        const labelSpan = 1 + rnd.max_legs * 3 + 1

        return (
          <div key={`${rnd.round_start}~${rnd.round_end}`} className="bh-round">
            <h3>{formatRoundLabel(rnd.round_start, rnd.round_end)}</h3>
            <div className="bh-table-wrap">
              <table className="bh-table">
                <thead>
                  <tr>
                    <th>등록일시</th>
                    {legCols.map((i) => [
                      <th key={`m${i}`}>경기{i + 1}</th>,
                      <th key={`t${i}`}>유형{i + 1}</th>,
                      <th key={`h${i}`}>적중</th>,
                    ])}
                    <th>배당</th>
                    <th>뱃금액</th>
                    <th>당첨금</th>
                    <th>결과</th>
                    <th>적중금</th>
                    <th>수익금</th>
                    <th>수익률</th>
                    <th />
                  </tr>
                </thead>
                {rnd.batches.map((batch) => (
                  // 등록 묶음마다 tbody를 나눠 굵은 구분선으로 갈라 보여준다.
                  <tbody key={batch.batch_id} className="bh-batch">
                    {batch.slips.map((slip) => (
                      <tr key={slip.id}>
                        <td className="bh-nowrap">{formatCreatedDt(slip.created_dt)}</td>
                        {legCols.map((i) => {
                          const leg = slip.legs[i]
                          if (!leg) {
                            return [
                              <td key={`m${i}`} />, <td key={`t${i}`} />, <td key={`h${i}`} />,
                            ]
                          }
                          return [
                            <td key={`m${i}`} className="bh-nowrap">{leg.HT}vs{leg.AT}</td>,
                            <td key={`t${i}`}>
                              <Badge value={leg.pick_type} map={PICK_BADGE} fallback={PICK_BADGE_DEFAULT} />
                            </td>,
                            <td key={`h${i}`} title={leg.actual ? `실제 결과: ${leg.actual}` : '결과 입력 대기'}>
                              <Badge value={HIT_SHORT[leg.hit] || leg.hit} map={HIT_BADGE} fallback={HIT_BADGE['대기']} />
                            </td>,
                          ]
                        })}
                        <td className="bh-nowrap">{odds(slip.odds)}</td>
                        <td className="bh-nowrap">{num(slip.stake)}</td>
                        <td className="bh-nowrap">{num(slip.payout)}</td>
                        <td>
                          <Badge value={slip.result} map={HIT_BADGE} fallback={HIT_BADGE['대기']} />
                        </td>
                        <td className="bh-nowrap">{num(slip.hit_amount)}</td>
                        <td className="bh-muted">-</td>
                        <td className="bh-muted">-</td>
                        <td />
                      </tr>
                    ))}
                    <tr className="bh-subtotal">
                      <td colSpan={labelSpan} className="bh-subtotal-label">
                        └ 이 등록 묶음 소계
                      </td>
                      <td className="bh-nowrap">{num(batch.subtotal.stake)}</td>
                      <td />
                      <td />
                      <td className="bh-nowrap">{num(batch.subtotal.hit_amount)}</td>
                      <td className={`bh-nowrap ${signClass(batch.subtotal.profit)}`}>
                        {num(batch.subtotal.profit)}
                      </td>
                      <td className={`bh-nowrap ${signClass(batch.subtotal.roi)}`}>
                        {pct(batch.subtotal.roi)}
                      </td>
                      <td>
                        <button
                          className="bh-delete"
                          title="이 등록 묶음 삭제"
                          onClick={() => handleDeleteBatch(batch.batch_id)}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  </tbody>
                ))}
                <tfoot>
                  <tr className="bh-total">
                    <td colSpan={labelSpan} className="bh-total-label">[회차종료]</td>
                    <td className="bh-nowrap">{num(rnd.total.stake)}</td>
                    <td />
                    <td />
                    <td className="bh-nowrap">{num(rnd.total.hit_amount)}</td>
                    <td className={`bh-nowrap ${signClass(rnd.total.profit)}`}>{num(rnd.total.profit)}</td>
                    <td className={`bh-nowrap ${signClass(rnd.total.roi)}`}>{pct(rnd.total.roi)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
