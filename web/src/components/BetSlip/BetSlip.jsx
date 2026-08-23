import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import './BetSlip.css'

export const PICK_TYPES = ['정', '역', '무', '핸승', '핸무', '플핸']

// 슬립 하나(경기 선택·벳금액·예산 설정)를 통째로 저장한다 — 탭을 벗어났다 돌아오거나
// 새로고침해도 "삭제"를 누르기 전까지는 화면에 그대로 남아있어야 한다.
const slipStorageKey = (id) => `betpro_week_bet_slip_${id}`

function loadSlipState(id) {
  try {
    const raw = localStorage.getItem(slipStorageKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 최소 벳 단위는 100원 — 자동 배분/재계산 결과도 항상 100원 단위로 맞춘다.
const roundStake = (v) => Math.round(v / 100) * 100

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
// 부동소수점 오차 때문에 6.05 같은 값이 toFixed(1)에서 6.0으로 내려가 버리는 걸
// 막으려고 아주 작은 값을 더해 반올림한다.
// 소수 1자리 반올림은 아래쪽 조합 배당(다리 배당끼리 곱한 값, combos의 odds)에만 쓴다 —
// 그 값이 당첨금·수익금 계산과 화면 표시가 어긋나지 않게 맞추는 기준이기 때문이다.
// 선택 1/2 목록에 나오는 다리 하나짜리 배당은 원본 그대로 소수 2자리로 보여준다.
const fmtOdds = (v) => (v == null ? '-' : (Math.round((v + Number.EPSILON) * 10) / 10).toFixed(1))
const fmtLegOdds = (v) => (v == null ? '-' : (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2))
const fmtNum = (v) => (v == null ? '-' : Math.round(v).toLocaleString())

// 한 경기 그룹(선택 1 / 선택 2): 경기를 고르고 유형을 담는다.
function SideBox({ index, rows, legs, onAdd, onRemove, onToggleCheck }) {
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
          <tr><th>홈</th><th>원정</th><th>{index}</th><th>배당</th><th>주력</th><th /></tr>
        </thead>
        <tbody>
          {legs.map((l) => (
            <tr key={legKey(l)}>
              <td>{l.row.HT}</td>
              <td>{l.row.AT}</td>
              <td>{l.pick}</td>
              <td>{fmtLegOdds(l.odds)}</td>
              <td>
                <input
                  type="checkbox"
                  checked={!!l.checked}
                  onChange={() => onToggleCheck(l)}
                  aria-label="주력 다리로 표시"
                />
              </td>
              <td>
                <button className="slip-remove" onClick={() => onRemove(l)} aria-label="빼기">✕</button>
              </td>
            </tr>
          ))}
          {legs.length === 0 && (
            <tr><td colSpan={6} className="slip-empty">아직 담은 경기가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// 선택 그룹 수 — 선택1~4까지 항상 4칸을 보여준다(비워 둔 칸은 조합에서 그냥 빠진다).
const SIDE_COUNT = 4

// 예전에 저장된 슬립은 선택 칸이 2개였을 수 있으니, 부족한 칸은 빈 배열로 채운다.
function normalizeSides(sides) {
  const base = Array.isArray(sides) ? sides : []
  return Array.from({ length: SIDE_COUNT }, (_, i) => base[i] ?? [])
}

export default function BetSlip({ id, rows, scope, onSave, onDelete, canDelete, onRegistered }) {
  const persisted = loadSlipState(id)
  const [sides, setSides] = useState(normalizeSides(persisted?.sides))
  // 조합별 뱃금액 — 조합 키로 들고 있어야 경기를 추가·삭제해도 입력값이 안 흐트러진다.
  const [stakes, setStakes] = useState(persisted?.stakes ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // ── 총벳금액입력 / 회차설정(예산 고정) ──
  // budget: "금액적용"을 누른 순간 고정되는 총 예산. 이후에는 이 값을 항상 정확히
  // 맞추는 걸 우선한다 — 조합별 수익률을 손대면 나머지 조합들의 벳금액이 자동으로
  // 재분배되어(비율 유지) 합계가 예산과 늘 같게 유지된다.
  const [budgetEnabled, setBudgetEnabled] = useState(persisted?.budgetEnabled ?? false)
  const [budgetInput, setBudgetInput] = useState(persisted?.budgetInput ?? null)
  const [budget, setBudget] = useState(persisted?.budget ?? null)

  // 경기 선택·벳금액·예산 — "벳등록"을 하더라도 지우지 않는 한 화면에 그대로 남아있어야
  // 하므로, 바뀔 때마다 이 슬립의 id로 localStorage에 저장한다.
  useEffect(() => {
    localStorage.setItem(
      slipStorageKey(id),
      JSON.stringify({ sides, stakes, budgetEnabled, budgetInput, budget })
    )
  }, [id, sides, stakes, budgetEnabled, budgetInput, budget])
  // 수익률 입력칸에서 타이핑 중인 값(blur/Enter 전까지는 재계산하지 않는다).
  const [roiDrafts, setRoiDrafts] = useState({})

  // 다리를 넣어 둔 선택 칸끼리만 곱한다 — 비워 둔 선택 칸은 조합에서 그냥 빠지므로
  // 선택1·2만 채우면 예전과 똑같이 2다리 조합, 선택1~4를 다 채우면 4다리 조합이 된다.
  const combos = useMemo(() => {
    const activeSides = sides.filter((legs) => legs.length > 0)
    if (activeSides.length === 0) return []
    let acc = [[]]
    for (const legs of activeSides) {
      const next = []
      for (const combo of acc) {
        for (const leg of legs) next.push([...combo, leg])
      }
      acc = next
    }
    return acc.map((legs) => {
      // 화면에 보이는 배당(소수 1자리)과 당첨금·수익금·수익률 계산이 서로 어긋나지
      // 않도록, 배당 자체를 소수 1자리로 반올림해서 쓴다(부동소수점 오차 보정 포함).
      const odds = legs.every((l) => l.odds != null)
        ? Math.round((legs.reduce((p, l) => p * l.odds, 1) + Number.EPSILON) * 10) / 10
        : null
      return { key: legs.map(legKey).join('::'), legs, odds }
    })
  }, [sides])

  // 수익금 = 그 조합이 터졌을 때 받는 당첨금 − 이 슬립에 넣은 뱃금액 전부.
  const stakeTotal = combos.reduce((sum, c) => sum + (toNum(stakes[c.key]) || 0), 0)
  // 지금 채워진 선택 칸 수만큼만 "1/2/3/4" 열을 보여준다(2칸만 채우면 예전처럼 2열).
  const legColCount = combos.reduce((max, c) => Math.max(max, c.legs.length), 0)

  function updateSide(i, next) {
    setSides((prev) => prev.map((s, idx) => (idx === i ? next : s)))
  }

  // "금액적용" — 예산을 배당의 역수 비중으로 나눠 담는다(적은 배당엔 많이, 큰 배당엔 적게)
  // 이러면 조합마다 실제 수익률은 배당에 따라 달라질 수 있지만, 합계는 항상 예산과 정확히
  // 같아진다. 이후 표에서 조합별 수익률을 손대며 원하는 대로 다시 조정하면 된다.
  function applyBudget() {
    setError('')
    if (!budgetInput || budgetInput <= 0) {
      setError('예산을 입력해주세요.')
      return
    }
    const usable = combos.filter((c) => c.odds)
    if (usable.length === 0) {
      setError('먼저 조합을 담아주세요.')
      return
    }
    const weights = usable.map((c) => 1 / c.odds)
    const weightSum = weights.reduce((a, b) => a + b, 0)
    const next = {}
    usable.forEach((c, i) => {
      next[c.key] = roundStake((budgetInput * weights[i]) / weightSum)
    })
    setStakes((prev) => ({ ...prev, ...next }))
    setBudget(budgetInput)
  }

  // 조합 하나의 수익률을 직접 입력하면, 그 조합의 뱃금액을 먼저 맞추고 남는 예산을
  // 나머지 조합들에게 "기존 비율 그대로" 다시 나눠준다 — 그래야 합계가 예산에서 안 벗어난다.
  function commitRoi(combo, text) {
    setRoiDrafts((prev) => {
      const next = { ...prev }
      delete next[combo.key]
      return next
    })
    if (!budget || !combo.odds) return
    const r = toNum(text)
    if (r === null) return
    const newStake = (budget * (1 + r / 100)) / combo.odds
    if (newStake < 0 || newStake > budget) {
      setError('이 수익률로는 예산을 초과합니다.')
      return
    }
    const remaining = budget - newStake
    const others = combos.filter((c) => c.key !== combo.key && c.odds)
    const oldOthersSum = others.reduce((sum, c) => sum + (toNum(stakes[c.key]) || 0), 0)
    const next = { [combo.key]: roundStake(newStake) }
    if (oldOthersSum > 0) {
      const scale = remaining / oldOthersSum
      others.forEach((c) => {
        next[c.key] = roundStake((toNum(stakes[c.key]) || 0) * scale)
      })
    } else if (others.length > 0) {
      const oWeights = others.map((c) => 1 / c.odds)
      const oWeightSum = oWeights.reduce((a, b) => a + b, 0)
      others.forEach((c, i) => {
        next[c.key] = roundStake((remaining * oWeights[i]) / oWeightSum)
      })
    }
    setStakes((prev) => ({ ...prev, ...next }))
    setError('')
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
          legs: c.legs.map((l) => ({
            code: l.row.L, S: l.row.S, R: l.row.R, No: l.row.No,
            HT: l.row.HT, AT: l.row.AT, DT: l.row.DT,
            pick_type: l.pick, odds: l.odds, scope: l.row.scope,
          })),
        })),
      })
      // 등록 후에도 경기·벳금액은 지우지 않는다 — 사용자가 "삭제"를 누르기 전까지는
      // 이번주 픽 화면에 그대로 남아있어야 한다.
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
        <button
          className="slip-btn"
          onClick={() => {
            localStorage.removeItem(slipStorageKey(id))
            onDelete()
          }}
          disabled={!canDelete}
        >
          ✕ 삭제
        </button>
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
          onToggleCheck={(leg) => updateSide(
            i,
            legs.map((l) => (legKey(l) === legKey(leg) ? { ...l, checked: !l.checked } : l))
          )}
        />
      ))}

      {combos.length > 0 && (
        <div className="slip-budget-row">
          <label className="slip-budget-check">
            <input
              type="checkbox"
              checked={budgetEnabled}
              onChange={(e) => {
                setBudgetEnabled(e.target.checked)
                if (!e.target.checked) setBudget(null)
              }}
            />
            총벳금액입력
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="slip-budget-input"
            placeholder="총 벳 금액"
            disabled={!budgetEnabled}
            value={budgetInput == null ? '' : budgetInput.toLocaleString()}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '')
              setBudgetInput(digits === '' ? null : Number(digits))
            }}
          />
          <button className="slip-btn" disabled={!budgetEnabled} onClick={applyBudget}>
            금액적용
          </button>
        </div>
      )}

      {combos.length > 0 && (
        <div className="slip-combo-wrap">
        <table className="slip-combo-table">
          <thead>
            <tr>
              {Array.from({ length: legColCount }, (_, i) => <th key={i}>{i + 1}</th>)}
              <th>뱃배당</th><th>뱃금액</th>
              <th>당첨금</th><th>수익금</th><th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => {
              const stake = toNum(stakes[c.key])
              const payout = stake && c.odds ? stake * c.odds : null
              const profit = payout != null ? payout - stakeTotal : null
              const roiValue = profit != null && stakeTotal ? (profit / stakeTotal * 100).toFixed(1) : null
              return (
                <tr key={c.key}>
                  {c.legs.map((l, i) => (
                    <td key={i} className={l.checked ? 'slip-pick-checked' : undefined}>{l.pick}</td>
                  ))}
                  <td className="slip-strong">{fmtOdds(c.odds)}</td>
                  <td>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={stakes[c.key] == null || stakes[c.key] === '' ? '' : Number(stakes[c.key]).toLocaleString()}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^0-9]/g, '')
                        setStakes((p) => ({ ...p, [c.key]: digits === '' ? '' : Number(digits) }))
                      }}
                      onBlur={() => {
                        // 100원 단위 미만은 입력해도 여기서 반올림해서 맞춘다.
                        setStakes((p) => {
                          const raw = toNum(p[c.key])
                          if (raw == null) return p
                          const rounded = roundStake(raw)
                          return rounded === raw ? p : { ...p, [c.key]: rounded }
                        })
                      }}
                    />
                  </td>
                  <td>{fmtNum(payout)}</td>
                  <td>{fmtNum(profit)}</td>
                  <td>
                    {budget ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="slip-roi-input"
                        value={roiDrafts[c.key] ?? roiValue ?? ''}
                        onChange={(e) => setRoiDrafts((p) => ({ ...p, [c.key]: e.target.value }))}
                        onBlur={(e) => commitRoi(c, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                      />
                    ) : (
                      roiValue != null ? `${roiValue}%` : '-'
                    )}
                  </td>
                </tr>
              )
            })}
            <tr className="slip-combo-total">
              <td colSpan={legColCount + 1}>뱃금액 합계</td>
              <td>{stakeTotal ? stakeTotal.toLocaleString() : '-'}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
