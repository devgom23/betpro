import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import './ResultEditModal.css'

const ALL = 'ALL'
const RT_OPTIONS = ['', '핸승', '핸무', '무', '역']
const HANDICAP_OPTIONS = ['', '-1', '+1']

function numOrDash(v) {
  return v === null || v === undefined || v === '' ? '-' : v
}

// 배당은 항상 소수 둘째 자리까지(3 → 3.00) — 참고용 국내/해외 승무패 칸에 쓴다
function oddsOrDash(v) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  return Number.isNaN(n) ? '-' : n.toFixed(2)
}

// 점수가 둘 다 있고 서로 다를 때만 이긴 쪽 점수를 강조한다(무승부·예정 경기는 강조 없음)
function scoreClass(hs, as_, side) {
  if (hs === null || hs === undefined || as_ === null || as_ === undefined) return undefined
  const winner = hs > as_ ? 'home' : as_ > hs ? 'away' : null
  return winner === side ? 'winner-score' : undefined
}

// 경기결과(RT)·국내핸디(KH)·해외핸디(FH)를 화면에서 직접 입력한다.
// 크롤링이 못 채우는 세 값만 갱신하고, 26개 지표·플핸예측은 전혀 건드리지 않는다.
export default function ResultEditModal({ code, scope, label, onClose, onSaved }) {
  const [filters, setFilters] = useState(null)
  const [season, setSeason] = useState(ALL)
  const [round, setRound] = useState(ALL)
  const [onlyBlank, setOnlyBlank] = useState(true)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .get(`/api/leagues/${code}/filters?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setFilters(res)
        setSeason(res.latest?.season ?? ALL)
        setRound(res.latest?.round ?? ALL)
      })
      .catch(() => {
        if (!cancelled) setFilters({ seasons: [], rounds_by_season: {} })
      })
    return () => {
      cancelled = true
    }
  }, [code, scope])

  function loadRows({ keepNotice = false } = {}) {
    setLoading(true)
    setError('')
    if (!keepNotice) setNotice('')
    const params = new URLSearchParams({
      scope,
      season: season === ALL ? 'ALL' : season,
      round: round === ALL ? 'ALL' : round,
      only_blank: onlyBlank ? 'true' : 'false',
    })
    api
      .get(`/api/leagues/${code}/edit_rows?${params.toString()}`)
      .then((res) => {
        setRows(
          (res.rows || []).map((r) => ({
            ...r,
            _RT: r.RT_label || '',
            _KH: r.KH === null || r.KH === undefined ? '' : String(r.KH > 0 ? '+1' : '-1'),
            _FH: r.FH === null || r.FH === undefined ? '' : String(r.FH > 0 ? '+1' : '-1'),
          }))
        )
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (filters) loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, season, round, onlyBlank])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const seasonOptions = [ALL, ...(filters?.seasons ?? [])]
  const roundOptions =
    season === ALL
      ? [ALL, ...new Set(Object.values(filters?.rounds_by_season ?? {}).flat())]
      : [ALL, ...(filters?.rounds_by_season?.[season] ?? [])]

  function updateRow(i, field, value) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  async function handleSave() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const payload = rows.map((r) => ({
        S: r.S,
        R: r.R,
        No: r.No,
        HT: r.HT,
        AT: r.AT,
        RT: r._RT || null,
        KH: r._KH === '' ? null : parseFloat(r._KH),
        FH: r._FH === '' ? null : parseFloat(r._FH),
      }))
      const res = await api.post(`/api/leagues/${code}/edit_rows`, { scope, rows: payload })
      setNotice(`저장 완료: ${res.updated}건`)
      onSaved?.()
      loadRows({ keepNotice: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card edit-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">📝 결과·핸디 입력</h2>
        <p className="modal-meta">
          {label || code} · 경기결과(RT)·국내핸디(KH)·해외핸디(FH)만 갱신합니다. 26개 지표·
          플핸예측은 바뀌지 않습니다.
        </p>

        <div className="edit-filter-row">
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasonOptions.map((s) => (
              <option key={s} value={s}>
                {s === ALL ? '시즌 전체' : s}
              </option>
            ))}
          </select>
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            {roundOptions.map((r) => (
              <option key={r} value={r}>
                {r === ALL ? '라운드 전체' : r}
              </option>
            ))}
          </select>
          <label className="edit-blank-toggle">
            <input
              type="checkbox"
              checked={onlyBlank}
              onChange={(e) => setOnlyBlank(e.target.checked)}
            />
            비어 있는 경기만 보기
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="recompute-notice">{notice}</p>}

        {loading ? (
          <p className="loading-text">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="edit-empty">해당 조건에 맞는 경기가 없습니다.</p>
        ) : (
          <>
            <table className="detail-table edit-table">
              <thead>
                <tr>
                  <th>R</th>
                  <th>No</th>
                  <th>홈</th>
                  <th>스코어</th>
                  <th>원정</th>
                  <th>국내(승/무/패)</th>
                  <th>해외(승/무/패)</th>
                  <th>RT</th>
                  <th>KH</th>
                  <th>FH</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.S}-${r.R}-${r.No}`}>
                    <td>{r.R}</td>
                    <td>{r.No}</td>
                    <td>{r.HT}</td>
                    <td>
                      <span className={scoreClass(r.HS, r.AS, 'home')}>{numOrDash(r.HS)}</span>
                      {' : '}
                      <span className={scoreClass(r.HS, r.AS, 'away')}>{numOrDash(r.AS)}</span>
                    </td>
                    <td>{r.AT}</td>
                    <td>
                      {oddsOrDash(r.KW)} / {oddsOrDash(r.KD)} / {oddsOrDash(r.KL)}
                    </td>
                    <td>
                      {oddsOrDash(r.FW)} / {oddsOrDash(r.FD)} / {oddsOrDash(r.FL)}
                    </td>
                    <td>
                      <select value={r._RT} onChange={(e) => updateRow(i, '_RT', e.target.value)}>
                        {RT_OPTIONS.map((o) => (
                          <option key={o || 'blank'} value={o}>
                            {o || '미정'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={r._KH} onChange={(e) => updateRow(i, '_KH', e.target.value)}>
                        {HANDICAP_OPTIONS.map((o) => (
                          <option key={o || 'blank'} value={o}>
                            {o || '미정'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={r._FH} onChange={(e) => updateRow(i, '_FH', e.target.value)}>
                        {HANDICAP_OPTIONS.map((o) => (
                          <option key={o || 'blank'} value={o}>
                            {o || '미정'}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="edit-actions">
              <span className="edit-count">{rows.length}경기</span>
              <button className="btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? '저장 중...' : '💾 저장'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
