import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import './KrCrawlModal.css'

const MANUAL = '__MANUAL__' // 셀렉트에서 '직접입력'을 고른 상태 — 옆 입력창의 텍스트가 치환값이 된다

// 젠토토에서 국내배당(초기배당)을 가져와 이미 있는 경기에 채워 넣는 창.
//   ① 연도 + 젠토토 회차번호로 화면을 연다(로그인 필요 — 최초 1회만 직접 로그인)
//   ② 이 리그의 시즌/라운드(매칭용)와 리그명을 확인하고 '가져오기'
//   ③ 매칭된 경기만 미리보기 → 저장(매칭 안 된 경기는 새로 만들지 않고 목록으로만 표시)
export default function KrCrawlModal({ code, scope, label, onClose, onSaved }) {
  const [config, setConfig] = useState(null)
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [siteRound, setSiteRound] = useState('')
  const [matchSeason, setMatchSeason] = useState('')
  const [matchRound, setMatchRound] = useState('')
  const [leagueName, setLeagueName] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState(null)
  const [picks, setPicks] = useState({})
  const [manualText, setManualText] = useState({}) // 크롤링팀명 -> 직접입력한 치환값

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get(`/api/crawl/kr/config?scope=${scope}&code=${encodeURIComponent(code)}`)
      setConfig(res)
      setLeagueName((prev) => prev || res.default_league_name || '')
      // 시즌/라운드는 자동 채움 없이 빈 값으로 둔다 — 최신값이 미리 채워져 있으면
      // 실제로 가져오려는 회차와 다를 때 안 바꾸고 그냥 눌러버리는 실수가 생긴다.
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
      const res = await api.post('/api/crawl/kr/open', { scope, code, year: year.trim(), round: siteRound.trim() })
      setNotice('크롬 창이 열렸습니다. 로그인 화면이 뜨면 그 창에서 먼저 로그인해 주세요.')
      return res
    })

  const handleFetch = () =>
    run('fetch', async () => {
      const res = await api.post('/api/crawl/kr/fetch', {
        scope, code,
        season: matchSeason.trim(), round: matchRound.trim(),
        league_name: leagueName.trim() || null,
      })
      setResult(res)
      setPicks({})
      setManualText({})
      return res
    })

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
      await api.post('/api/crawl/kr/aliases', { scope, code, mapping })
      await loadConfig()
      const res = await api.post('/api/crawl/kr/fetch', {
        scope, code,
        season: matchSeason.trim(), round: matchRound.trim(),
        league_name: leagueName.trim() || null,
      })
      setResult(res)
      setPicks({})
      setManualText({})
      setNotice('치환 규칙을 저장했습니다. 다음부터는 자동으로 적용됩니다.')
      return res
    })

  const handleSave = () =>
    run('save', async () => {
      const res = await api.post('/api/crawl/save', {
        scope, code, rows: result.rows, confirm: true,
      })
      setNotice(
        `저장 완료: 국내배당 ${result.matched}경기 반영` +
          (res.duplicates_removed ? ` (중복 ${res.duplicates_removed}건 대체)` : '')
      )
      setResult(null)
      onSaved?.()
      return res
    })

  const unknown = result?.unknown_teams ?? []
  const unmatched = result?.unmatched ?? []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card kr-crawl-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">🇰🇷 국내배당 가져오기</h2>
        <p className="modal-meta">
          {label || code} · 젠토토 화면의 초기배당을 읽어 이미 있는 경기의 국내배당 칸만 채웁니다
          (새 경기는 만들지 않습니다).
        </p>

        {/* ① 화면 열기 */}
        <div className="kr-crawl-step">
          <span className="kr-crawl-step-no">1</span>
          <div className="kr-crawl-step-body">
            <label className="kr-crawl-label">연도 + 젠토토 회차번호(예: 260036)로 화면을 엽니다</label>
            <div className="kr-crawl-row">
              <input
                type="text" className="kr-crawl-year-input"
                value={year} onChange={(e) => setYear(e.target.value)}
                placeholder="연도(예: 2026)"
              />
              <input
                type="text"
                value={siteRound} onChange={(e) => setSiteRound(e.target.value)}
                placeholder="젠토토 회차번호(예: 260036)"
              />
              <button className="btn-primary" onClick={handleOpen}
                     disabled={busy === 'open' || !year.trim() || !siteRound.trim()}>
                {busy === 'open' ? '여는 중...' : '화면 열기'}
              </button>
            </div>
            <p className="kr-crawl-hint">
              최초 1회는 그 창에서 직접 로그인해야 할 수 있습니다 — 이후엔 로그인이 유지됩니다.
            </p>
          </div>
        </div>

        {/* ② 가져오기 */}
        <div className="kr-crawl-step">
          <span className="kr-crawl-step-no">2</span>
          <div className="kr-crawl-step-body">
            <label className="kr-crawl-label">
              이 리그의 <strong>시즌/라운드</strong>(매칭용 — 최신값이 자동 입력됩니다. 다른
              라운드를 가져올 땐 이 리그 표에 저장된 표기 그대로 바꿔주세요: K리그는 '2026'
              처럼 연도만, 유럽리그는 '20-21'처럼 연도-연도)와 젠토토 리그명을 확인하세요
            </label>
            <div className="kr-crawl-row">
              <input
                type="text" className="kr-crawl-small-input"
                value={matchSeason} onChange={(e) => setMatchSeason(e.target.value)}
                placeholder="시즌(예: 2026 또는 20-21)"
              />
              <input
                type="text" className="kr-crawl-small-input"
                value={matchRound} onChange={(e) => setMatchRound(e.target.value)}
                placeholder="라운드(예: 21R)"
              />
              <input
                type="text" className="kr-crawl-league-input"
                value={leagueName} onChange={(e) => setLeagueName(e.target.value)}
                placeholder="젠토토 리그명(예: K리그1)"
              />
              <button className="btn-search" onClick={handleFetch}
                     disabled={busy === 'fetch' || !matchSeason.trim() || !matchRound.trim()}>
                {busy === 'fetch' ? '가져오는 중...' : '⬇ 가져오기'}
              </button>
              {config?.aliases && Object.keys(config.aliases).length > 0 && (
                <span className="kr-crawl-hint">
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
          <div className="kr-crawl-result">
            <p className="kr-crawl-summary">
              화면에서 <strong>{result.count}</strong>경기 확인 ·{' '}
              <strong>{result.matched}</strong>경기 매칭
              {result.fail_cnt > 0 && ` · 초기배당 조회실패 ${result.fail_cnt}건(현재배당으로 대체)`}
            </p>

            {unknown.length > 0 && (
              <div className="kr-crawl-unknown">
                <p className="kr-crawl-unknown-title">
                  ⚠ 아래 팀명이 이 리그에 등록된 이름과 다릅니다. 오타라면 맞는 팀을 골라 주세요
                  (그냥 두어도 나머지 매칭된 경기는 저장할 수 있습니다).
                </p>
                <ul className="kr-crawl-map-list">
                  {unknown.map((raw) => (
                    <li key={raw}>
                      <span className="kr-crawl-raw">{raw}</span>
                      <span className="kr-crawl-arrow">→</span>
                      <select
                        value={picks[raw] ?? ''}
                        onChange={(e) => setPicks((p) => ({ ...p, [raw]: e.target.value }))}
                      >
                        <option value="">팀 선택...</option>
                        <option value={MANUAL}>직접입력</option>
                        {(result.teams || config?.teams || []).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      {picks[raw] === MANUAL && (
                        <input
                          type="text"
                          className="kr-crawl-manual-input"
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

            {result.matched > 0 && (
              <table className="detail-table kr-crawl-preview">
                <thead>
                  <tr>
                    <th>홈</th><th>원정</th><th>KW</th><th>KD</th><th>KL</th>
                    <th>핸디</th><th>KHW</th><th>KHD</th><th>KHL</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 12).map((r, i) => (
                    <tr key={i}>
                      <td>{r.HT}</td><td>{r.AT}</td>
                      <td>{r.KW ?? '-'}</td><td>{r.KD ?? '-'}</td><td>{r.KL ?? '-'}</td>
                      <td>{r.KH === -1 || r.KH === -1.0 ? '-1' : r.KH === 1 || r.KH === 1.0 ? '+1' : '-'}</td>
                      <td>{r.KHW ?? '-'}</td><td>{r.KHD ?? '-'}</td><td>{r.KHL ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.rows.length > 12 && (
              <p className="kr-crawl-hint">앞 12경기만 표시 (총 {result.rows.length}경기 매칭)</p>
            )}

            {unmatched.length > 0 && (
              <div className="kr-crawl-unmatched">
                <p className="kr-crawl-hint">
                  이 리그의 {matchSeason} {matchRound}에서 매칭 안 된 경기 {unmatched.length}건(새로
                  만들지 않고 건너뜁니다):
                </p>
                <ul className="kr-crawl-unmatched-list">
                  {unmatched.map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              </div>
            )}

            <div className="kr-crawl-actions">
              <button className="btn-reset" onClick={() => setResult(null)}>
                취소
              </button>
              <button className="btn-primary" onClick={handleSave}
                     disabled={busy === 'save' || result.matched === 0}>
                {busy === 'save' ? '저장 중...' : `💾 ${result.matched}경기 반영`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
