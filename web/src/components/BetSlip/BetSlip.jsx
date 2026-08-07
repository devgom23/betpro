import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import './BetSlip.css'

export const PICK_TYPES = ['정', '역', '무', '핸승', '핸무', '플핸']

const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 유형별 국내배당을 골라준다. 정/역은 고정 컬럼이 아니라 승·패 배당 중 낮은 쪽이
// 정배(시장이 강하다고 본 쪽)라는 규칙을 따르고, 핸승/플핸도 같은 기준으로 갈린다.
export function oddsForPick(row, pick) {
  const kw = toNum(row?.KW)
  const kd = toNum(row?.KD)
  const kl = toNum(row?.KL)
  const khw = toNum(row?.KHW)
  const khd = toNum(row?.KHD)
  const khl = toNum(row?.KHL)
  if (pick === '무') return kd
  if (pick === '핸무') return khd
  if (kw == null || kl == null) return null
  const homeIsFav = kw <= kl
  if (pick === '정') return homeIsFav ? kw : kl
  if (pick === '역') return homeIsFav ? kl : kw
  if (pick === '핸승') return homeIsFav ? khw : khl
  if (pick === '플핸') return homeIsFav ? khl : khw
  return null
}

const matchKey = (r) => `${r.L}|${r.S}|${r.R}|${r.No}|${r.HT}|${r.AT}`
const legKey = (l) => `${matchKey(l.row)}|${l.pick}`
const fmtOdds = (v) => (v == null ? '-' : v.toFixed(2))
const fmtNum = (v) => (v == null ? '-' : Math.round(v).toLocaleString())

// 한 경기 그룹(선택 1 / 선택 2): 경기를 고르고 유형을 담는다.
function SideBox({ index, rows, legs, onAdd, onRemove }) {
  const [matchIdx, setMatchIdx] = useState('')
  const [pick, setPick] = useState(PICK_TYPES[0])

  function handleAdd() {
    const row = rows[Number(matchIdx)]
    if (!row) return
    onAdd({ row, pick, odds: oddsForPick(row, pick) })
  }

  return (
    <div className="slip-side">
      <h4>선택 {index}</h4>
      <div className="slip-side-controls">
        <select value={matchIdx} onChange={(e) => setMatchIdx(e.target.value)}>
          <option value="">경기 선택</option>
          {rows.map((r, i) => (
            <option key={matchKey(r)} value={i}>{r.HT} vs {r.AT}</option>
          ))}
        </select>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {PICK_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="slip-add" onClick={handleAdd}>＋ 추가</button>
      </div>

      <table className="slip-side-table">
        <thead>
          <tr><th>홈</th><th>원정</th><th>{index}</th><th>배당</th><th /></tr>
        </thead>
        <tbody>
          {legs.map((l) => (
            <tr key={legKey(l)}>
              <td>{l.row.HT}</td>
              <td>{l.row.AT}</td>
              <td>{l.pick}</td>
              <td>{fmtOdds(l.odds)}</td>
              <td>
                <button className="slip-remove" onClick={() => onRemove(l)} aria-label="빼기">✕</button>
              </td>
            </tr>
          ))}
          {legs.length === 0 && (
            <tr><td colSpan={5} className="slip-empty">아직 담은 경기가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function BetSlip({ rows, scope, onSave, onDelete, canDelete, onRegistered }) {
  const [sides, setSides] = useState([[], []])
  // 조합별 뱃금액 — 조합 키로 들고 있어야 경기를 추가·삭제해도 입력값이 안 흐트러진다.
  const [stakes, setStakes] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const combos = useMemo(() => {
    const [a, b] = sides
    const out = []
    for (const l1 of a) {
      for (const l2 of b) {
        const odds = l1.odds != null && l2.odds != null
          ? Math.round(l1.odds * l2.odds * 100) / 100
          : null
        out.push({ key: `${legKey(l1)}::${legKey(l2)}`, l1, l2, odds })
      }
    }
    return out
  }, [sides])

  // 수익금 = 그 조합이 터졌을 때 받는 당첨금 − 이 슬립에 넣은 뱃금액 전부.
  const stakeTotal = combos.reduce((sum, c) => sum + (toNum(stakes[c.key]) || 0), 0)

  function updateSide(i, next) {
    setSides((prev) => prev.map((s, idx) => (idx === i ? next : s)))
  }

  async function handleRegister() {
    setError('')
    const usable = combos.filter((c) => toNum(stakes[c.key]) && c.odds)
    if (usable.length === 0) {
      setError('뱃금액을 입력한 조합이 없습니다.')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/bet_slips', {
        scope,
        bets: usable.map((c) => ({
          odds: c.odds,
          stake: Math.round(toNum(stakes[c.key])),
          legs: [c.l1, c.l2].map((l) => ({
            code: l.row.L, S: l.row.S, R: l.row.R, No: l.row.No,
            HT: l.row.HT, AT: l.row.AT, DT: l.row.DT,
            pick_type: l.pick, odds: l.odds,
          })),
        })),
      })
      setStakes({})
      onRegistered?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bet-slip">
      <div className="slip-actions">
        <button className="slip-btn" onClick={handleRegister} disabled={busy || combos.length === 0}>
          📋 벳등록
        </button>
        <button className="slip-btn slip-btn-primary" onClick={onSave}>💾 저장</button>
        <button className="slip-btn" onClick={onDelete} disabled={!canDelete}>✕ 삭제</button>
      </div>

      {error && <p className="error-text slip-error">{error}</p>}

      {sides.map((legs, i) => (
        <SideBox
          key={i}
          index={i + 1}
          rows={rows}
          legs={legs}
          onAdd={(leg) => {
            if (legs.some((l) => legKey(l) === legKey(leg))) return
            updateSide(i, [...legs, leg])
          }}
          onRemove={(leg) => updateSide(i, legs.filter((l) => legKey(l) !== legKey(leg)))}
        />
      ))}

      {combos.length > 0 && (
        <table className="slip-combo-table">
          <thead>
            <tr>
              <th>1</th><th>2</th><th>뱃배당</th><th>뱃금액</th>
              <th>당첨금</th><th>수익금</th><th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => {
              const stake = toNum(stakes[c.key])
              const payout = stake && c.odds ? stake * c.odds : null
              const profit = payout != null ? payout - stakeTotal : null
              return (
                <tr key={c.key}>
                  <td>{c.l1.pick}</td>
                  <td>{c.l2.pick}</td>
                  <td className="slip-strong">{fmtOdds(c.odds)}</td>
                  <td>
                    <input
                      type="number"
                      value={stakes[c.key] ?? ''}
                      onChange={(e) => setStakes((p) => ({ ...p, [c.key]: e.target.value }))}
                    />
                  </td>
                  <td>{fmtNum(payout)}</td>
                  <td>{fmtNum(profit)}</td>
                  <td>{profit != null && stakeTotal ? `${(profit / stakeTotal * 100).toFixed(1)}%` : '-'}</td>
                </tr>
              )
            })}
            <tr className="slip-combo-total">
              <td colSpan={3}>뱃금액 합계</td>
              <td>{stakeTotal ? stakeTotal.toLocaleString() : '-'}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}
