import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import './CrawlModal.css'

const KEEP = '__KEEP__' // 셀렉트에서 '그대로 사용'을 고른 상태

// 스코어맨에서 경기·배당을 가져오는 창.
//   ① 리그별 주소를 한 번 등록해 두면 다음부터 바로 열린다
//   ② 열린 크롬 창에서 시즌·라운드를 직접 고른 뒤 '가져오기'
//   ③ DB에 없는 팀명이 있으면 셀렉트로 치환 → 저장해두면 다음부터 자동 적용
export default function CrawlModal({ code, scope, label, onClose, onSaved }) {
  const [config, setConfig] = useState(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState(null)
  const [picks, setPicks] = useState({}) // 크롤링팀명 -> 고른 등록팀명
  const [round, setRound] = useState('')

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get(`/api/crawl/config?scope=${scope}&code=${encodeURIComponent(code)}`)
      setConfig(res)
      setUrl(res.url || res.default_url || '')
    } catch (err) {
      setError(err.message)
    }
  }, [scope, code])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

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
    setNotice('')
    try {
      return await fn()
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const handleOpen = () =>
    run('open', async () => {
      const res = await api.post('/api/crawl/open', { scope, code, url: url.trim() })
      setNotice('크롬 창이 열렸습니다. 그 화면에서 시즌·라운드를 고른 뒤 [가져오기]를 누르세요.')
      return res
    })

  // 시즌은 크롬 화면에서 고르고, 라운드는 여기서 바로 옮길 수 있다.
  const handleRound = () =>
    run('round', async () => {
      const res = await api.post('/api/crawl/round', { scope, code, round: round.trim() })
      setNotice(`${res.round} 로 이동했습니다.`)
      return res
    })

  const handleFetch = () =>
    run('fetch', async () => {
      const res = await api.post('/api/crawl/fetch', { scope, code })
      setResult(res)
      setPicks({})
      return res
    })

  // 셀렉트에서 고른 치환을 저장하고, 곧바로 다시 가져와 반영한다.
  const handleApply = () =>
    run('alias', async () => {
      const mapping = {}
      for (const [raw, val] of Object.entries(picks)) {
        if (val && val !== KEEP) mapping[raw] = val
      }
      if (!Object.keys(mapping).length) {
        setError('치환할 팀명을 하나 이상 선택해 주세요.')
        return null
      }
      await api.post('/api/crawl/aliases', { scope, code, mapping })
      await loadConfig()
      const res = await api.post('/api/crawl/fetch', { scope, code })
      setResult(res)
      setPicks({})
      setNotice('치환 규칙을 저장했습니다. 다음부터는 자동으로 적용됩니다.')
      return res
    })

  const handleSave = () =>
    run('save', async () => {
      const res = await api.post('/api/crawl/save', {
        scope,
        code,
        rows: result.rows,
        confirm: true,
      })
      setNotice(
        `저장 완료: 총 ${res.rows.toLocaleString()}건` +
          (res.duplicates_removed ? ` (중복 ${res.duplicates_removed}건 대체)` : '')
      )
      setResult(null)
      onSaved?.()
      return res
    })

  const unknown = result?.unknown_teams ?? []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card crawl-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">🛰 Data 가져오기</h2>
        <p className="modal-meta">
          {label || code} · 스코어맨 화면에 떠 있는 경기와 배당을 그대로 가져옵니다.
        </p>

        {/* ① 주소 */}
        <div className="crawl-step">
          <span className="crawl-step-no">1</span>
          <div className="crawl-step-body">
            <label className="crawl-label">스코어맨 리그 주소 (한 번만 등록하면 계속 사용됩니다)</label>
            <div className="crawl-row">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://football.scoreman123.com/league/36"
              />
              <button className="btn-primary" onClick={handleOpen} disabled={busy === 'open' || !url.trim()}>
                {busy === 'open' ? '여는 중...' : '화면 열기'}
              </button>
            </div>
            {config?.known_ids && (
              <p className="crawl-hint">
                참고 리그번호 —{' '}
                {Object.entries(config.known_ids)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* ② 가져오기 */}
        <div className="crawl-step">
          <span className="crawl-step-no">2</span>
          <div className="crawl-step-body">
            <label className="crawl-label">
              열린 크롬 창에서 <strong>시즌</strong>을 고르고, 라운드는 여기서 옮겨도 됩니다.
            </label>
            <div className="crawl-row">
              <input
                type="text"
                className="crawl-round-input"
                value={round}
                onChange={(e) => setRound(e.target.value)}
                placeholder="라운드 (예: 17)"
              />
              <button className="btn-reset" onClick={handleRound} disabled={busy === 'round' || !round.trim()}>
                {busy === 'round' ? '이동 중...' : '라운드 이동'}
              </button>
              <button className="btn-search" onClick={handleFetch} disabled={busy === 'fetch'}>
                {busy === 'fetch' ? '가져오는 중...' : '⬇ 가져오기'}
              </button>
              {config?.aliases && Object.keys(config.aliases).length > 0 && (
                <span className="crawl-hint">
                  저장된 팀명 치환 {Object.keys(config.aliases).length}건 자동 적용
                </span>
              )}
            </div>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="recompute-notice">{notice}</p>}

        {/* ③ 결과 */}
        {result && (
          <div className="crawl-result">
            <p className="crawl-summary">
              시즌 <strong>{result.season || '-'}</strong> · 라운드{' '}
              <strong>{result.rounds?.join(', ') || '-'}</strong> ·{' '}
              <strong>{result.count}</strong>경기
              {result.matched_handicap > 0 && ` · 핸디배당 ${result.matched_handicap}건`}
            </p>

            {unknown.length > 0 && (
              <div className="crawl-unknown">
                <p className="crawl-unknown-title">
                  ⚠ 아래 팀명이 이 리그에 등록된 이름과 다릅니다. 맞는 팀을 골라 주세요.
                </p>
                <ul className="crawl-map-list">
                  {unknown.map((raw) => (
                    <li key={raw}>
                      <span className="crawl-raw">{raw}</span>
                      <span className="crawl-arrow">→</span>
                      <select
                        value={picks[raw] ?? ''}
                        onChange={(e) => setPicks((p) => ({ ...p, [raw]: e.target.value }))}
                      >
                        <option value="">팀 선택...</option>
                        <option value={KEEP}>그대로 사용</option>
                        {(result.teams || config?.teams || []).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
                <button className="btn-primary" onClick={handleApply} disabled={busy === 'alias'}>
                  {busy === 'alias' ? '적용 중...' : '치환 적용 후 다시 가져오기'}
                </button>
              </div>
            )}

            <table className="detail-table crawl-preview">
              <thead>
                <tr>
                  <th>R</th>
                  <th>일자</th>
                  <th>홈</th>
                  <th>스코어</th>
                  <th>원정</th>
                  <th>승</th>
                  <th>무</th>
                  <th>패</th>
                  <th>핸디기준</th>
                  <th>핸디승</th>
                  <th>핸디패</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 12).map((r, i) => (
                  <tr key={i}>
                    <td>{r.R}</td>
                    <td>{r.DT}</td>
                    <td>{r.HT}</td>
                    <td>
                      {r.HS !== '' && r.AS !== '' ? `${r.HS} : ${r.AS}` : '-'}
                    </td>
                    <td>{r.AT}</td>
                    <td>{r.FW}</td>
                    <td>{r.FD}</td>
                    <td>{r.FL}</td>
                    <td>{r['_핸디기준'] || '-'}</td>
                    <td>{r.FHW || '-'}</td>
                    <td>{r.FHL || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length > 12 && (
              <p className="crawl-hint">앞 12경기만 표시 (총 {result.rows.length}경기)</p>
            )}

            <p className="crawl-hint">
              경기결과(RT)와 핸디(FH)는 비워서 등록됩니다 — 국내배당 기준 값이라 이 화면에서는
              정할 수 없습니다.
            </p>

            <div className="crawl-actions">
              <button className="btn-reset" onClick={() => setResult(null)}>
                취소
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={busy === 'save'}>
                {busy === 'save' ? '저장 중...' : `💾 ${result.count}경기 등록`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
