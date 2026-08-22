import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import './KrCrawlModal.css'

const MANUAL = '__MANUAL__' // 셀렉트에서 '직접입력'을 고른 상태 — 옆 입력창의 텍스트가 치환값이 된다

// 와이즈토토에서 국내배당(초기배당)을 가져와 이미 있는 경기에 채워 넣는 창.
//   ① 연도 + 그 해의 회차번호, 이 리그의 시즌/라운드(매칭용), 리그명을 넣고 '가져오기'
//   ② 매칭된 경기만 미리보기 → 저장(매칭 안 된 경기는 새로 만들지 않고 목록으로만 표시)
// 예전 젠토토 때는 로그인한 크롬 창을 먼저 띄우는 '화면 열기' 단계가 있었는데,
// 와이즈토토는 로그인 없이 바로 받아오므로 그 단계를 없앴다.
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

  // 와이즈토토 화면을 새 탭으로 띄운다 — 회차에 어떤 경기가 들어 있는지 눈으로
  // 확인하려면 사이트를 봐야 한다. 로그인이 필요 없어 그냥 주소만 열면 된다.
  // 회차를 안 넣었으면 최신 회차 화면이 열린다(사이트가 알아서 보여준다).
  function openSite() {
    const q = new URLSearchParams({
      tab_type: 'proto', game_type: 'pt', game_category: 'pt1',
      game_year: year.trim(),
    })
    if (siteRound.trim()) q.set('game_round', siteRound.trim())
    window.open(`https://www.wisetoto.com/index.htm?${q.toString()}`, '_blank', 'noopener')
  }

  // 가져오기에 넘길 값은 두 종류다 — 와이즈토토에서 '어느 회차를 읽을지'(year/kr_round)와
  // 그걸 이 리그의 '어느 경기에 붙일지'(season/round). 둘을 헷갈리면 매칭이 통째로 빈다.
  const fetchBody = () => ({
    scope, code,
    season: matchSeason.trim(), round: matchRound.trim(),
    league_name: leagueName.trim() || null,
    year: year.trim(), kr_round: siteRound.trim(),
  })

  const handleFetch = () =>
    run('fetch', async () => {
      const res = await api.post('/api/crawl/kr/fetch', fetchBody())
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
      const res = await api.post('/api/crawl/kr/fetch', fetchBody())
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
          {label || code} · 와이즈토토의 초기배당을 읽어 이미 있는 경기의 국내배당 칸만 채웁니다
          (새 경기는 만들지 않습니다).
        </p>

        {/* ① 가져올 경기 — 이것만 넣으면 회차는 알아서 찾는다 */}
        <div className="kr-crawl-step">
          <span className="kr-crawl-step-no">1</span>
          <div className="kr-crawl-step-body">
            <label className="kr-crawl-label">
              <strong>가져올 경기</strong> — 이 리그 표에 저장된 시즌/라운드 표기를 그대로
              넣으세요(K리그는 '2026'처럼 연도만, 유럽리그는 '26-27'처럼 연도-연도)
            </label>
            <div className="kr-crawl-row">
              <input
                type="text" className="kr-crawl-small-input"
                value={matchSeason} onChange={(e) => setMatchSeason(e.target.value)}
                placeholder="시즌(예: 2026 또는 26-27)"
              />
              <input
                type="text" className="kr-crawl-small-input"
                value={matchRound} onChange={(e) => setMatchRound(e.target.value)}
                placeholder="라운드(예: 21R)"
              />
              <input
                type="text" className="kr-crawl-league-input"
                value={leagueName} onChange={(e) => setLeagueName(e.target.value)}
                placeholder="리그명(예: K리그1)"
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
            <p className="kr-crawl-hint">
              그 라운드 경기 날짜로 <strong>와이즈토토 회차를 자동으로 찾습니다</strong>
              (한 라운드가 두 회차에 걸쳐 있어도 같이 가져옵니다). 로그인은 필요 없습니다.
            </p>
          </div>
        </div>

        {/* ② 회차 직접 지정 — 자동으로 안 될 때만 */}
        <details className="kr-crawl-manual">
          <summary>회차를 직접 넣기 (날짜가 비어 있거나, 특정 회차만 다시 받을 때)</summary>
          <div className="kr-crawl-row">
            <input
              type="text" className="kr-crawl-year-input"
              value={year} onChange={(e) => setYear(e.target.value)}
              placeholder="연도(예: 2026)"
            />
            <input
              type="text" className="kr-crawl-small-input"
              value={siteRound} onChange={(e) => setSiteRound(e.target.value)}
              placeholder="회차(예: 99)"
            />
            <button className="btn-reset" onClick={openSite} disabled={!year.trim()}>
              🔗 화면 보기
            </button>
          </div>
          <p className="kr-crawl-hint">
            회차를 넣으면 자동 탐색 대신 그 회차만 읽습니다. 비워 두면 자동으로 찾습니다.
            리그명은 사이트 표기 그대로여야 합니다 —
            K리그1 · K리그2 · EPL · 라리가 · 세리에A · 분데스리 · 프리그1 · 에레디비.
          </p>
        </details>

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="recompute-notice">{notice}</p>}

        {/* ③ 결과 */}
        {result && (
          <div className="kr-crawl-result">
            <p className="kr-crawl-summary">
              그 회차에서 <strong>{result.count}</strong>경기 확인 ·{' '}
              <strong>{result.matched}</strong>경기 매칭
              {result.changed_cnt > 0 && (
                <>
                  {' · '}배당이 바뀐 <strong>{result.changed_cnt}</strong>경기는 초기배당으로 되돌림
                </>
              )}
            </p>

            {/* 젠토토 때는 초기배당을 따로 조회해야 해서 실패하면 '변경된 현재 배당'이
                조용히 섞여 들어갔다. 와이즈토토는 변경 이력이 그 줄 안에 툴팁으로 같이
                오므로 조회 자체가 없어 실패할 일이 없다 — 그래도 응답 형식은 그대로라
                혹시 값이 오면 경고가 뜨도록 남겨 둔다. */}
            {result.fail_cnt > 0 && (
              <p className="kr-crawl-warn">
                ⚠ 초기배당을 못 읽은 경기가 <strong>{result.fail_cnt}건</strong> 있습니다 —
                그 경기는 <strong>변경된 현재 배당</strong>이 들어갑니다. 아래 표의 비고를
                확인하고, 그대로 저장하지 마세요.
              </p>
            )}

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
