import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import '../UploadTemplateModal/UploadTemplateModal.css'

const ALL = 'ALL'

export default function DeleteMatchesModal({ leagues, defaultCode, scope, onClose, onDeleted }) {
  const [league, setLeague] = useState(defaultCode)
  const [filters, setFilters] = useState(null)
  const [season, setSeason] = useState(ALL)
  const [round, setRound] = useState(ALL)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 리그를 바꾸면 그 리그의 시즌/라운드 선택지를 다시 불러온다
  useEffect(() => {
    let cancelled = false
    setFilters(null)
    setSeason(ALL)
    setRound(ALL)
    api
      .get(`/api/leagues/${league}/filters?scope=${scope}`)
      .then((res) => {
        if (!cancelled) setFilters(res)
      })
      .catch(() => {
        if (!cancelled) setFilters({ seasons: [], rounds_by_season: {} })
      })
    return () => {
      cancelled = true
    }
  }, [league, scope])

  const seasonOptions = [ALL, ...(filters?.seasons ?? [])]
  const roundOptions =
    season === ALL
      ? [ALL, ...Object.values(filters?.rounds_by_season ?? {}).flat()]
      : [ALL, ...(filters?.rounds_by_season?.[season] ?? [])]
  const uniqueRoundOptions = [...new Set(roundOptions)]

  async function handleDelete() {
    if (!agree) {
      setError('동의 체크박스를 선택하세요.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api.post(`/api/leagues/${league}/delete_matches`, {
        scope,
        season,
        round,
        confirm: true,
      })
      setNotice(`${res.deleted.toLocaleString()}건 삭제 완료 (남은 경기 ${res.remaining.toLocaleString()}건)`)
      setAgree(false)
      onDeleted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="upload-template-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="upload-template-title">경기 Data 삭제 선택</h2>
        <p className="upload-template-caption">삭제 하시려는 리그, 시즌, 라운드를 선택하십시오</p>

        <div className="upload-template-fields">
          <label className="upload-template-field">
            <span>리그 선택</span>
            <select value={league} onChange={(e) => setLeague(e.target.value)}>
              {leagues.map((lg) => (
                <option key={lg.code} value={lg.code}>
                  {lg.label}
                </option>
              ))}
            </select>
          </label>
          <label className="upload-template-field">
            <span>시즌 선택</span>
            <select value={season} onChange={(e) => setSeason(e.target.value)}>
              {seasonOptions.map((s) => (
                <option key={s} value={s}>
                  {s === ALL ? '전체' : s}
                </option>
              ))}
            </select>
          </label>
          <label className="upload-template-field">
            <span>라운드 선택</span>
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              {uniqueRoundOptions.map((r) => (
                <option key={r} value={r}>
                  {r === ALL ? '전체' : r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="confirm-check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          Data를 삭제하시면 현재 등록된 모든 Data가 삭제가 됩니다. 동의하십니까?
        </label>

        {error && <p className="filter-warning">{error}</p>}
        {notice && <p className="recompute-notice">{notice}</p>}

        <div className="upload-template-actions">
          <button className="btn-danger" onClick={handleDelete} disabled={busy}>
            {busy ? '삭제 중...' : '🗑 선택 경기 삭제하기'}
          </button>
        </div>
      </div>
    </div>
  )
}
