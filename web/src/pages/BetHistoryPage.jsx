import { Fragment, useCallback, useEffect, useState } from 'react'
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
const num = (v) => (v == null ? '-' : v.toLocaleString())
const odds = (v) => (v == null ? '-' : v.toFixed(2))
const pct = (v) => (v == null ? '-' : `${v}%`)
const signClass = (v) => (v == null ? '' : v > 0 ? 'bh-pos' : v < 0 ? 'bh-neg' : '')

// 벳 한 줄의 수익금·수익률 — 실제로 적중금이 찍힌 줄에만 보여준다(그 묶음에서
// 돈이 들어온 유일한 줄이라, "이 등록 묶음 소계"와 같은 기준 — 적중금 대비 묶음
// 전체 뱃금액 — 으로 계산한 값을 그대로 가져다 쓴다). 미적중·대기 줄은 공란.
function rowProfitRoi(slip, batch) {
  if (slip.result !== '적중') return { profit: null, roi: null }
  return { profit: batch.subtotal.profit, roi: batch.subtotal.roi }
}

function formatCreatedDt(v) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? `${m[1]}-${m[2]}-${m[3]}` : v || '-'
}

function Badge({ value, map, fallback }) {
  return <span className="bh-badge" style={map[value] || fallback}>{value}</span>
}

export default function BetHistoryPage({ scope }) {
  const [data, setData] = useState({ max_legs: 0, sections: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 회차 설정 전(group_id가 없는) 벳만 체크할 수 있다.
  const [selected, setSelected] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/api/bet_slips?scope=${scope}`)
      setData({ max_legs: res.max_legs || 0, sections: res.sections || [] })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [scope])

  function toggleSlip(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDeleteBatch(batchId) {
    if (!window.confirm('이 번에 등록한 벳 묶음을 통째로 삭제할까요?')) return
    await apiFetch(`/api/bet_batches/${batchId}`, { method: 'DELETE' })
    load()
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 벳을 삭제할까요?`)) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/bet_slips/delete_selected', { scope, slip_ids: [...selected] })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleLockSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 벳을 하나의 회차로 확정합니다. 확정되면 더 이상 선택 삭제·재설정을 할 수 없어요. 계속할까요?`)) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/bet_slips/lock', { scope, slip_ids: [...selected] })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="bh-empty">불러오는 중...</div>
  if (error) return <div className="bh-empty error-text">{error}</div>

  const { max_legs: maxLegs, sections } = data
  const legCols = Array.from({ length: maxLegs }, (_, i) => i)
  // 경기 이름은 각 등록 묶음 위에 한 번(띠 형태)만 보여주고, 표 본문은 유형 배지만
  // 나열한다 — "이번주 벳"에서 조합을 만들 때 쓰는 화면과 같은 구조. 같은 묶음
  // 안에서는 항상 같은 경기 조합에 유형만 바꿔가며 등록하므로, 첫 슬립의 다리
  // 목록을 그 묶음의 경기 목록으로 그대로 써도 된다.
  const matchStripSpan = 3 + maxLegs + 1 + 7   // 체크박스+#+등록일시 + 유형N + 배당 + (뱃금액~삭제 7칸)
  // 소계·회차총계 라벨은 체크박스~배당 칸까지를 하나로 합쳐 쓴다.
  const labelSpan = 4 + maxLegs

  return (
    <div className="bh-page">
      <div className="bh-title-row">
        <h2 className="bh-title">📋 베팅내역</h2>
        <button className="bh-action-btn" onClick={handleDeleteSelected} disabled={busy || selected.size === 0}>
          🗑 선택 삭제{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
        <button className="bh-action-btn bh-action-primary" onClick={handleLockSelected} disabled={busy || selected.size === 0}>
          🔒 회차 설정{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>
      <p className="bh-desc">
        체크박스로 벳을 고른 뒤 "회차 설정"을 누르면 그 벳들만 묶여 회차총계가 계산됩니다. 확정 전에는 "선택 삭제"로 지울 수 있고, 확정되면 체크박스가 비활성화됩니다.
      </p>

      {sections.length === 0 && <div className="bh-empty">등록된 베팅내역이 없습니다.</div>}

      {sections.length > 0 && (
        <div className="bh-table-wrap">
          <table className="bh-table">
            <thead>
              <tr>
                <th className="bh-check-col" />
                <th className="bh-no-col" />
                <th>등록일시</th>
                {legCols.map((i) => <th key={`t${i}`}>유형{i + 1}</th>)}
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
            {(() => {
              // 번호는 실제 DB id가 아니라 화면에 보이는 순서대로 1부터 다시 매긴다 —
              // 지운 벳은 완전히 삭제되니(복구용으로 남겨두지 않음) 번호에 흔적이 없다.
              let rowNum = 0
              return sections.map((sec, si) => {
              const locked = sec.group_id != null
              return (
                <Fragment key={sec.group_id ?? `pending-${si}`}>
                  {sec.batches.map((batch) => (
                    // 등록 묶음마다 tr을 굵은 선으로 갈라 보여준다.
                    <tbody key={batch.batch_id} className="bh-batch">
                      {/* 같은 묶음은 항상 같은 경기 조합에 유형만 바꿔가며 등록한 것이라,
                          첫 슬립의 다리 목록을 그 묶음의 경기 목록으로 그대로 쓴다. */}
                      <tr className="bh-match-strip">
                        <td colSpan={matchStripSpan}>
                          <div className="bh-match-chips">
                            {(batch.slips[0]?.legs || []).map((leg, i) => (
                              <span key={i} className="bh-match-chip">
                                <b>{i + 1}</b> {leg.HT} vs {leg.AT}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                      {batch.slips.map((slip) => (
                        <tr key={slip.id} className={locked ? 'bh-row-locked' : undefined}>
                          <td className="bh-check-col">
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={selected.has(slip.id)}
                              onChange={() => toggleSlip(slip.id)}
                            />
                          </td>
                          <td className="bh-no-col bh-muted">{++rowNum}</td>
                          <td className="bh-nowrap">{formatCreatedDt(slip.created_dt)}</td>
                          {legCols.map((i) => {
                            const leg = slip.legs[i]
                            return (
                              <td key={`t${i}`}>
                                {leg && (
                                  <>
                                    <Badge value={leg.pick_type} map={PICK_BADGE} fallback={PICK_BADGE_DEFAULT} />
                                    {leg.hit === '적중' && <span className="bh-leg-hit bh-leg-hit-ok"> 적중</span>}
                                    {leg.hit === '미적중' && <span className="bh-leg-hit bh-leg-hit-no"> 미적</span>}
                                  </>
                                )}
                              </td>
                            )
                          })}
                          <td className="bh-nowrap">{odds(slip.odds)}</td>
                          <td className="bh-nowrap">{num(slip.stake)}</td>
                          <td className="bh-nowrap">{num(slip.payout)}</td>
                          <td>
                            <Badge value={slip.result} map={HIT_BADGE} fallback={HIT_BADGE['대기']} />
                          </td>
                          <td className="bh-nowrap">{num(slip.hit_amount)}</td>
                          {(() => {
                            const { profit, roi } = rowProfitRoi(slip, batch)
                            return (
                              <>
                                <td className={`bh-nowrap ${signClass(profit)}`}>{num(profit)}</td>
                                <td className={`bh-nowrap ${signClass(roi)}`}>{pct(roi)}</td>
                              </>
                            )
                          })()}
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
                          {!locked && (
                            <button
                              className="bh-delete"
                              title="이 등록 묶음 삭제"
                              onClick={() => handleDeleteBatch(batch.batch_id)}
                            >
                              🗑️
                            </button>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  ))}
                  {locked && (
                    <tbody className="bh-total-body">
                      <tr className="bh-total">
                        <td colSpan={labelSpan} className="bh-total-label">
                          회차총계 ({sec.round_start}~{sec.round_end})
                        </td>
                        <td className="bh-nowrap">{num(sec.total.stake)}</td>
                        <td />
                        <td />
                        <td className="bh-nowrap">{num(sec.total.hit_amount)}</td>
                        <td className={`bh-nowrap ${signClass(sec.total.profit)}`}>{num(sec.total.profit)}</td>
                        <td className={`bh-nowrap ${signClass(sec.total.roi)}`}>{pct(sec.total.roi)}</td>
                        <td />
                      </tr>
                    </tbody>
                  )}
                </Fragment>
              )
            })
            })()}
          </table>
        </div>
      )}
    </div>
  )
}
