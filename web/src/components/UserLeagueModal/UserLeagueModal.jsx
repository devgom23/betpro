import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import './UserLeagueModal.css'

// '내 데이터'의 리그 만들기 / 이름변경 / 삭제를 한 곳에서 처리한다.
// 리그 이름만 입력받고 내부 코드는 백엔드가 자동으로 붙인다(이름을 바꿔도 데이터는 그대로).
export default function UserLeagueModal({ leagues, onClose, onChanged }) {
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState('')          // '' | 'create' | 코드
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)  // 이름변경 중인 리그 코드
  const [editLabel, setEditLabel] = useState('')
  const [confirming, setConfirming] = useState(null) // 삭제 확인 중인 리그 코드

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(kind, fn) {
    setBusy(kind)
    setError('')
    try {
      await fn()
      await onChanged()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy('')
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    const ok = await run('create', () => api.post('/api/user_leagues', { label }))
    if (ok) setNewLabel('')
  }

  async function handleRename(code) {
    const label = editLabel.trim()
    if (!label) return
    const ok = await run(code, () => api.post(`/api/user_leagues/${code}/rename`, { label }))
    if (ok) setEditing(null)
  }

  async function handleDelete(code) {
    const ok = await run(code, () =>
      api.post(`/api/user_leagues/${code}/delete`, { confirm: true })
    )
    if (ok) setConfirming(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card ul-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">🗂 리그 관리</h2>
        <p className="modal-meta">
          내 데이터에서 쓸 리그를 직접 만듭니다. 만든 리그마다 탭이 하나 생기고, 그 탭에서 경기
          데이터를 올리면 그 리그 자료만으로 플핸 예측이 계산됩니다.
        </p>

        <form className="ul-create" onSubmit={handleCreate}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="새 리그 이름 (예: K리그1)"
            maxLength={30}
          />
          <button className="btn-primary" type="submit" disabled={busy === 'create' || !newLabel.trim()}>
            {busy === 'create' ? '만드는 중...' : '＋ 리그 생성'}
          </button>
        </form>

        {error && <p className="error-text">{error}</p>}

        {leagues.length === 0 ? (
          <p className="ul-empty">아직 만든 리그가 없습니다. 위에서 리그를 먼저 만들어 주세요.</p>
        ) : (
          <ul className="ul-list">
            {leagues.map((lg) => (
              <li key={lg.code}>
                {editing === lg.code ? (
                  <>
                    <input
                      className="ul-edit-input"
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      maxLength={30}
                      autoFocus
                    />
                    <button
                      className="btn-primary btn-mini"
                      onClick={() => handleRename(lg.code)}
                      disabled={busy === lg.code || !editLabel.trim()}
                    >
                      저장
                    </button>
                    <button className="btn-reset btn-mini" onClick={() => setEditing(null)}>
                      취소
                    </button>
                  </>
                ) : confirming === lg.code ? (
                  <>
                    <span className="ul-warn">
                      '{lg.label}'의 경기 데이터까지 모두 삭제됩니다. 되돌릴 수 없습니다.
                    </span>
                    <button
                      className="btn-danger btn-mini"
                      onClick={() => handleDelete(lg.code)}
                      disabled={busy === lg.code}
                    >
                      {busy === lg.code ? '삭제 중...' : '삭제'}
                    </button>
                    <button className="btn-reset btn-mini" onClick={() => setConfirming(null)}>
                      취소
                    </button>
                  </>
                ) : (
                  <>
                    <span className="ul-name">{lg.label}</span>
                    <button
                      className="btn-reset btn-mini"
                      onClick={() => {
                        setEditing(lg.code)
                        setEditLabel(lg.label)
                        setConfirming(null)
                        setError('')
                      }}
                    >
                      이름변경
                    </button>
                    <button
                      className="btn-reset btn-mini"
                      onClick={() => {
                        setConfirming(lg.code)
                        setEditing(null)
                        setError('')
                      }}
                    >
                      삭제
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
