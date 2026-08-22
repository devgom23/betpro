import { useState } from 'react'
import { api } from '../../api/client'
import { isStarred, formatTime, formatDt } from '../../utils/format'
// .modal-backdrop / .modal-card / .modal-close / .modal-title / .modal-meta 를 그대로 재사용한다.
import './MyPickModal.css'

const PICK_OPTIONS = ['대기', '축플', '축정', '플핸', '플핸무', '정', '정무', '핸승', '핸무', '무', '역', '무핸무']
const HIT_OPTIONS = ['Pass', 'P-고민', 'P-분산', 'P-상대', 'P-어렵', 'B-고민', 'B-Ma', 'B-Si', '축', '축-Si']

// 실제로 벳팅한 픽을 기록하는 팝업. 경기 정보는 참고용으로만 보여주고, 내픽 값만 수정한다
// (RT·핸디 등 분석 컬럼과 달리 이 값은 화면에서 직접 입력하는 순수 개인 기록).
export default function MyPickModal({ code, scope, row, onClose, onSaved }) {
  const [pick, setPick] = useState(row.MY_PICK || '')
  const [hit, setHit] = useState(row.MY_HIT || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/leagues/${code}/my_picks`, {
        scope,
        S: row.S,
        R: row.R,
        No: row.No,
        HT: row.HT,
        AT: row.AT,
        starred: isStarred(row.IMPORTANT),
        pick: pick || null,
        hit: hit || null,
        memo: row.MEMO || null,
      })
      onSaved({ pick: pick || '', hit: hit || '' })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mypick-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">🎯 내 픽 입력</h2>
        <p className="modal-meta">이 경기에서 실제로 벳팅한 내용을 기록합니다.</p>

        <div className="mypick-info">
          <div>
            <span className="mypick-label">경기일</span>
            {formatDt(row.DT)} {formatTime(row.TM)}
          </div>
          <div>
            <span className="mypick-label">홈</span>
            {row.HT}
          </div>
          <div>
            <span className="mypick-label">원정</span>
            {row.AT}
          </div>
          <div>
            <span className="mypick-label">플핸예측</span>
            {row.PH_PICK || '-'}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <label className="mypick-select-row">
          내픽
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">선택 안함</option>
            {PICK_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label className="mypick-select-row">
          의견
          <select value={hit} onChange={(e) => setHit(e.target.value)}>
            <option value="">선택 안함</option>
            {HIT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <div className="mypick-actions">
          <button className="btn-reset" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? '저장 중...' : '💾 저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
