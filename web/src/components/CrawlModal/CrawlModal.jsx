import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { formatDt } from '../../utils/format'
import './CrawlModal.css'

const MANUAL = '__MANUAL__' // 셀렉트에서 '직접입력'을 고른 상태 — 옆 입력창의 텍스트가 치환값이 된다

// '17'처럼 숫자만 넣어도 '17R'로 맞춰 준다. DB의 라운드 표기가 '38R' 형식이라
// 숫자만 저장되면 그 경기들만 다른 라운드로 떨어져 나간다(실제로 그런 데이터가 있었다).
function normalizeRound(v) {
  const s = String(v || '').trim().toUpperCase()
  return /^\d+$/.test(s) ? `${s}R` : s
}

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
  const [manualText, setManualText] = useState({}) // 크롤링팀명 -> 직접입력한 치환값
  const [round, setRound] = useState('')
  // 저장할 라운드. 가져온 화면에서 읽은 값으로 자동으로 채우되, 저장 직전에 눈으로
  // 확인하고 고칠 수 있게 입력칸으로 둔다 — 사이트 화면 구조가 또 바뀌어 라운드를
  // 잘못 읽어도 엉뚱한 라운드로 통째로 저장되는 사고를 여기서 막는다.
  const [saveRound, setSaveRound] = useState('')
  // 이 결과를 어느 방법으로 가져왔는지 — 팀명 치환 후 '다시 가져오기'가 같은 방법으로
  // 다시 돌아야 한다(자동으로 가져온 걸 크롬 창 경로로 다시 부르면 엉뚱한 게 온다).
  const [lastMode, setLastMode] = useState('browser')

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
      setLastMode('browser')
      setResult(res)
      setSaveRound(res.rounds?.length === 1 ? res.rounds[0] : '')
      setPicks({})
      setManualText({})
      return res
    })

  // 크롬 창 없이 스코어맨 일정 API로 "DB 최신 라운드 + 1"을 통째로 가져온다.
  // 응답에 rounds 배열이 없으므로(단일 라운드가 확정돼 있다) 아래 미리보기·저장이
  // 그대로 쓰도록 rounds 모양만 맞춰 준다.
  //
  // with_domestic: false — 여긴 '해배 가져오기' 팝업이라 해외배당만 받는다. 국내배당은
  // 국배 팝업의 역할이고, 여기서 같이 받아 버리면 어느 팝업이 무엇을 채우는지가 흐려진다
  // (서버는 국내배당도 채울 수 있게 돼 있으니, 나중에 국배 팝업에서 켜서 쓰면 된다).
  const handleAutoFetch = () =>
    run('auto', async () => {
      const res = await api.post('/api/crawl/next_round', {
        scope,
        code,
        with_domestic: false,
      })
      setLastMode('auto')
      setResult({ ...res, rounds: [res.round] })
      setSaveRound(res.round || '')
      setPicks({})
      setManualText({})
      return res
    })

  // 셀렉트에서 고른 치환을 저장하고, 곧바로 다시 가져와 반영한다.
  const handleApply = () =>
    run('alias', async () => {
      const mapping = {}
      for (const [raw, val] of Object.entries(picks)) {
        if (!val) continue
        if (val === MANUAL) {
          const typed = (manualText[raw] || '').trim()
          if (typed) mapping[raw] = typed
          continue
        }
        mapping[raw] = val
      }
      if (!Object.keys(mapping).length) {
        setError('치환할 팀명을 하나 이상 선택하거나 입력해 주세요.')
        return null
      }
      await api.post('/api/crawl/aliases', { scope, code, mapping })
      await loadConfig()
      if (lastMode === 'auto') {
        const res = await api.post('/api/crawl/next_round', {
          scope,
          code,
          with_domestic: false,
        })
        setResult({ ...res, rounds: [res.round] })
        setSaveRound(res.round || '')
      } else {
        const res = await api.post('/api/crawl/fetch', { scope, code })
        setResult(res)
        setSaveRound(res.rounds?.length === 1 ? res.rounds[0] : '')
      }
      setPicks({})
      setManualText({})
      setNotice('치환 규칙을 저장했습니다. 다음부터는 자동으로 적용됩니다.')
      return null
    })

  const handleSave = () =>
    run('save', async () => {
      const r = normalizeRound(saveRound)
      if (!r) {
        setError('저장할 라운드를 입력해 주세요.')
        return null
      }
      // 가져온 경기 전부를 이 라운드로 확정해서 보낸다.
      const res = await api.post('/api/crawl/save', {
        scope,
        code,
        rows: result.rows.map((row) => ({ ...row, R: r })),
        confirm: true,
      })
      setNotice(
        `${r} 저장 완료: 총 ${res.rows.toLocaleString()}건` +
          (res.duplicates_removed ? ` (중복 ${res.duplicates_removed}건 대체)` : '')
      )
      setResult(null)
      setSaveRound('')
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

        <h2 className="modal-title">🛰 해배 가져오기</h2>
        <p className="modal-meta">
          {label || code} · 스코어맨 화면에 떠 있는 경기와 배당을 그대로 가져옵니다.
        </p>

        {/* 자동 경로 — 시즌·라운드를 입력할 필요가 없다. 아래 1·2단계는 이게 안 될 때 쓰는 수동 경로. */}
        <div className="crawl-auto">
          <button className="btn-search crawl-auto-btn" onClick={handleAutoFetch} disabled={busy === 'auto'}>
            {busy === 'auto' ? '가져오는 중...' : '🔄 새 라운드 자동 가져오기'}
          </button>
          <span className="crawl-hint">
            저장된 마지막 라운드의 <strong>다음 라운드</strong>를 스스로 찾아 경기와 해외배당을
            가져옵니다. 크롬 창을 열 필요가 없습니다. (국내배당은 국배 가져오기에서)
          </span>
        </div>

        <p className="crawl-manual-divider">아래는 자동이 안 될 때 쓰는 수동 방법입니다</p>

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
              시즌 <strong>{result.season || '-'}</strong> ·{' '}
              {lastMode === 'auto' ? '자동으로 찾은 라운드' : '화면에서 읽은 라운드'}{' '}
              <strong>{result.rounds?.join(', ') || '-'}</strong> ·{' '}
              <strong>{result.count}</strong>경기
              {result.matched_handicap > 0 && ` · 핸디배당 ${result.matched_handicap}건`}
            </p>

            {lastMode === 'auto' && (
              <div className="crawl-auto-info">
                <p>
                  <span className="crawl-auto-label">직전 저장</span>
                  {result.latest_season} {result.latest_round}
                  <span className="crawl-arrow">→</span>
                  <strong>
                    {result.season} {result.round}
                  </strong>
                </p>
                <p>
                  <span className="crawl-auto-label">해외배당</span>
                  <strong>
                    {result.overseas_filled}/{result.count}
                  </strong>
                  {result.overseas_error && (
                    <span className="crawl-auto-warn"> — {result.overseas_error}</span>
                  )}
                </p>
                {result.already_saved > 0 && (
                  <p className="crawl-auto-warn">
                    ⚠ 이 라운드는 이미 {result.already_saved}경기가 저장돼 있습니다 — 저장하면
                    같은 경기는 새 값으로 대체됩니다.
                  </p>
                )}
              </div>
            )}

            {/* 저장될 라운드를 눈으로 확인하고 고칠 수 있게 — 잘못 읽었을 때 여기서 막는다 */}
            <div className="crawl-save-round">
              <label htmlFor="crawl-save-round-input">
                이 <strong>{result.count}</strong>경기를 저장할 라운드
              </label>
              <input
                id="crawl-save-round-input"
                type="text"
                className="crawl-round-input"
                value={saveRound}
                onChange={(e) => setSaveRound(e.target.value)}
                placeholder="예: 17R"
              />
              {!result.rounds?.length && (
                <span className="crawl-save-round-warn">
                  화면에서 라운드를 읽지 못했습니다 — 직접 입력해 주세요.
                </span>
              )}
            </div>

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
                        <option value={MANUAL}>직접입력</option>
                        {(result.teams || config?.teams || []).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      {picks[raw] === MANUAL && (
                        <input
                          type="text"
                          className="crawl-manual-input"
                          placeholder="치환할 팀명 입력"
                          value={manualText[raw] ?? ''}
                          onChange={(e) => setManualText((m) => ({ ...m, [raw]: e.target.value }))}
                        />
                      )}
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
                    {/* 위 입력칸에서 고친 라운드가 실제로 저장되는 값이므로 미리보기도 그걸 보여준다 */}
                    <td>{normalizeRound(saveRound) || r.R}</td>
                    <td>{formatDt(r.DT)}</td>
                    <td>{r.HT}</td>
                    <td>
                      {r.HS !== '' && r.AS !== '' ? `${r.HS} : ${r.AS}` : '-'}
                    </td>
                    <td>{r.AT}</td>
                    <td>{r.FW ?? '-'}</td>
                    <td>{r.FD ?? '-'}</td>
                    <td>{r.FL ?? '-'}</td>
                    {/* 자동 경로는 핸디기준(FH)을 받지 않는다 — 국내배당 기준 값이라 여기선 '-' */}
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
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={busy === 'save' || !saveRound.trim()}
              >
                {busy === 'save' ? '저장 중...' : `💾 ${result.count}경기 등록`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
