import { useState } from 'react'
import { api, saveBlob } from '../../api/client'
import './UploadTemplateModal.css'

export default function UploadTemplateModal({ leagues, defaultCode, scope, onClose }) {
  const [league, setLeague] = useState(defaultCode)
  const [season, setSeason] = useState('')
  const [round, setRound] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleDownload() {
    if (round && !/^\d+$/.test(round)) {
      setError('라운드는 숫자만 입력하세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams({ scope, season, round })
      const { blob, filename } = await api.download(
        `/api/leagues/${league}/upload_template?${params.toString()}`
      )
      saveBlob(blob, filename)
      onClose()
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

        <h2 className="upload-template-title">경기 Data 업로드 엑셀 생성</h2>
        <p className="upload-template-caption">
          업로드 하실려는 리그와 시즌 라운드를 입력하신 후 엑셀 다운로드를 하세요.
        </p>

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
            <span>시즌 입력</span>
            <input
              type="text"
              placeholder="26-27"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
            />
          </label>
          <label className="upload-template-field">
            <span>라운드 입력</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="숫자만 입력"
              value={round}
              onChange={(e) => setRound(e.target.value)}
            />
          </label>
        </div>

        {error && <p className="filter-warning">{error}</p>}

        <div className="upload-template-actions">
          <button className="btn-primary" onClick={handleDownload} disabled={busy}>
            {busy ? '만드는 중...' : '⬇ 엑셀 다운로드'}
          </button>
        </div>
      </div>
    </div>
  )
}
