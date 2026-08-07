import { useState } from 'react'
import { api } from '../../api/client'
import { useBetCart } from '../../context/BetCartContext'
import './BetCartTray.css'

const PICK_TYPE_OPTIONS = ['핸승', '플핸', '핸무', '무', '역']

// 리그 표에서 🎟️로 담은 경기들을 모아 조합베팅(파를레이)으로 한 번에 등록하는 하단 트레이.
// 카트가 비어있으면 렌더링하지 않는다.
export default function BetCartTray({ scope, onRegistered }) {
  const { legs, removeLeg, setLegPickType, clear } = useBetCart()
  const [odds, setOdds] = useState('')
  const [stake, setStake] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (legs.length === 0) return null

  const allPicked = legs.every((l) => l.pick_type)

  async function handleRegister() {
    setError('')
    if (!allPicked) {
      setError('모든 경기에 베팅 유형을 선택해주세요.')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/bet_slips', {
        scope,
        memo: memo || null,
        bets: [{
          odds: odds === '' ? null : Number(odds),
          stake: stake === '' ? null : Number(stake),
          legs: legs.map((l) => ({
            code: l.code, S: l.S, R: l.R, No: l.No, HT: l.HT, AT: l.AT, DT: l.DT,
            pick_type: l.pick_type,
          })),
        }],
      })
      clear()
      setOdds('')
      setStake('')
      setMemo('')
      onRegistered?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bet-cart-tray">
      <div className="bet-cart-tray-legs">
        {legs.map((l) => (
          <div key={`${l.code}-${l.S}-${l.R}-${l.No}-${l.HT}-${l.AT}`} className="bet-cart-leg">
            <span className="bet-cart-leg-match">{l.HT} vs {l.AT}</span>
            <select
              value={l.pick_type}
              onChange={(e) => setLegPickType(l, e.target.value)}
            >
              <option value="">유형 선택</option>
              {PICK_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
              <option value="기타">기타(자동판정 제외)</option>
            </select>
            <button className="bet-cart-leg-remove" onClick={() => removeLeg(l)} aria-label="빼기">✕</button>
          </div>
        ))}
      </div>

      <div className="bet-cart-tray-actions">
        <input
          type="number"
          placeholder="배당"
          value={odds}
          onChange={(e) => setOdds(e.target.value)}
        />
        <input
          type="number"
          placeholder="뱃금액"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
        />
        <input
          type="text"
          placeholder="메모(선택)"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        {error && <span className="bet-cart-error">{error}</span>}
        <button className="btn-reset" onClick={clear} disabled={busy}>비우기</button>
        <button className="btn-primary" onClick={handleRegister} disabled={busy}>
          {busy ? '등록 중...' : '🎫 벳 등록'}
        </button>
      </div>
    </div>
  )
}
