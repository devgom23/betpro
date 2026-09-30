// 통합DB '배당 조회'(2026-09-27 사용자 지정 — 목업 web/public/mockups/totaldb_mock.html).
// ① 조회: 국배·국핸디·해배·해배 평균(12사 평균, 빈칸은 조건 제외) · 시점 · 폭(0~15칸) · 리그 · 시즌 · 뒤집기, 경기에서 불러오기, 최근 조회
// ② 결과: 찾은 경기 수·정/플 단통·정무/플핸무 당첨·결과 막대, 리그별·시즌별, 경기 목록(줄 누르면 상세보기)
// 계산은 서버 api/odds_lookup.py.
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import RtBadge from '../RtBadge/RtBadge'
import './OddsLookup.css'

const FIELDS = [
  ['국배', ['KW', 'KD', 'KL']],
  ['국핸디', ['KHW', 'KHD', 'KHL']],
  ['해배', ['FW', 'FD', 'FL']],
  // 해배 평균(2026-09-30 사용자 지정) — 스코어맨 12개 배당사 승·무·패 평균(6곳 이상). 12사 자료가 있는 경기만 걸린다.
  ['해배 평균', ['AW', 'AD', 'AL']],
]
const FIELD_HINT = { '해배 평균': '12개 배당사 평균(6곳 이상 자료가 있는 경기만)' }
const RT_LABEL = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }
const RECENT_KEY = 'betpro_odds_lookup_recent'
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))
const pctText = (v) => (v === null || v === undefined ? '-' : `${Number(v).toFixed(2)}%`)
const blankOdds = () => Object.fromEntries(FIELDS.flatMap(([, ks]) => ks).map((k) => [k, '']))

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

// 채운 칸을 전부 보여 준다 — 해배 평균만 넣은 조회도 '최근 조회'에 남고 서로 구분되게(국배만 보던 예전 방식은
// 해배 평균만 넣으면 빈 글자가 돼 저장이 안 됐다).
function oddsText(o) {
  const parts = FIELDS
    .filter(([, ks]) => ks.some((k) => o[k]))
    .map(([lab, ks]) => `${lab === '국배' ? '' : `${lab} `}${ks.map((k) => o[k] || '-').join('/')}`)
  return parts.join(' · ')
}
// 국배 승/무/패 — 화면 곳곳(불러오기 목록 등)에서 쓰던 짧은 표기
function kText(o) {
  return ['KW', 'KD', 'KL'].map((k) => o[k] || '-').join(' / ')
}

// 넣은 값과 같은 값 노랑 / 1~2칸 차이 글자색 — 표본 섹션과 같은 표시
function Cmp({ v, q }) {
  if (v === null || v === undefined) return <span className="ol-muted">-</span>
  const qn = Number(q)
  if (!q || !Number.isFinite(qn)) return <>{f2(v)}</>
  const d = Math.round(Math.abs(v - qn) * 100)
  if (d === 0) return <span className="ol-same">{f2(v)}</span>
  if (d <= 2) return <span className="ol-near">{f2(v)}</span>
  return <>{f2(v)}</>
}

function kickoff(dt, tm) {
  const m = /(\d{2})-(\d{2})-(\d{2})/.exec(dt || '')
  const n = Number(tm)
  const t = Number.isFinite(n) && tm !== null ? String(Math.trunc(n)).padStart(4, '0') : ''
  return `${m ? `${m[1]}.${m[2]}.${m[3]}` : dt || '-'}${t ? ` ${t.slice(0, 2)}:${t.slice(2)}` : ''}`
}

export default function OddsLookup() {
  const [odds, setOdds] = useState(blankOdds)
  const [kh, setKh] = useState('')
  const [phase, setPhase] = useState('init')
  const [tick, setTick] = useState(2)
  const [seasons, setSeasons] = useState(0)
  const [flip, setFlip] = useState(false)
  const [allLeagues, setAllLeagues] = useState([])
  const [picked, setPicked] = useState(null)   // null = 전체(기본)
  const [search, setSearch] = useState('')
  const [games, setGames] = useState([])
  const [sort, setSort] = useState('near')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState(loadRecent)
  const [detail, setDetail] = useState(null)

  useEffect(() => { api.get('/api/odds_lookup/leagues').then(setAllLeagues).catch(() => setAllLeagues([])) }, [])
  useEffect(() => {
    const t = search.trim()
    if (!t) { setGames([]); return undefined }
    let alive = true
    const h = setTimeout(() => {
      api.get(`/api/odds_lookup/games?q=${encodeURIComponent(t)}`).then((g) => { if (alive) setGames(g) }).catch(() => {})
    }, 300)
    return () => { alive = false; clearTimeout(h) }
  }, [search])

  async function run(nextSort = sort, o = odds, k = kh) {
    setBusy(true)
    setError('')
    try {
      const body = { odds: { ...o, KH: k }, phase, tick, seasons, flip, sort: nextSort, leagues: picked ? [...picked] : [] }
      const r = await api.post('/api/odds_lookup', body)
      if (!r.ready) { setError(r.reason); setRes(null); return }
      setRes({ ...r, q: o, cond: { phase, tick, seasons, flip, n: picked ? picked.size : allLeagues.length } })
      const key = oddsText(o)
      if (key) {
        const next = [{ o, kh: k }, ...recent.filter((x) => oddsText(x.o) !== key)].slice(0, 6)
        setRecent(next)
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* 저장 불가 */ }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function fillFrom(g) {
    const src = phase === 'final' ? g.final : g.init
    const o = blankOdds()
    Object.keys(o).forEach((k) => { if (src[k] !== null && src[k] !== undefined) o[k] = String(Number(src[k]).toFixed(2)) })
    setOdds(o)
    setKh(g.init.KH === null || g.init.KH === undefined ? '' : String(g.init.KH))
  }

  function toggleLeague(code) {
    if (code === 'ALL') { setPicked(null); return }
    setPicked((prev) => {
      const next = new Set(prev || [])
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next.size && next.size < allLeagues.length ? next : null
    })
  }

  const q = res?.q || {}
  const minRt = res && res.n ? [1, 2, 3, 4].reduce((m, k) => (res.cnt[k - 1] < res.cnt[m - 1] ? k : m), 1) : null
  const minName = minRt ? { 1: '핸승 → 배제하면 플핸무', 2: '핸무', 3: '무', 4: '역 → 배제하면 정무' }[minRt] : ''

  return (
    <div className="ol">
      {/* ① 조회 */}
      <section className="ol-box">
        <div className="ol-box-h"><span className="ol-tag">①</span><h3>조회 — 알고 싶은 배당을 넣으세요</h3><small>6대리그가 아닌 경기도 배당만 있으면 됩니다</small></div>
        <div className="ol-grid">
          <div className="ol-card">
            <h4>배당 입력 <small>빈칸은 조건에서 빠집니다</small></h4>
            <div className="ol-ph"><span>승(홈)</span><span>무</span><span>패(원정)</span></div>
            {FIELDS.map(([lab, ks]) => (
              <div className="ol-row" key={lab}>
                <label title={FIELD_HINT[lab]}>
                  {lab}
                  {lab === '국핸디' && (
                    <input className="ol-kh" value={kh} placeholder="H" title="핸디 기준점(홈 기준, 예 -1)" onChange={(e) => setKh(e.target.value.replace(/[^0-9.+-]/g, ''))} />
                  )}
                </label>
                {ks.map((k) => (
                  <span key={k} className="ol-od-wrap">
                    <input className="ol-od" inputMode="decimal" placeholder="-" value={odds[k]}
                      onChange={(e) => setOdds((p) => ({ ...p, [k]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') run() }} />
                    {odds[k] && (
                      <button type="button" className="ol-od-x" title="이 칸만 비우기" onClick={() => setOdds((p) => ({ ...p, [k]: '' }))}>✕</button>
                    )}
                  </span>
                ))}
              </div>
            ))}
            <div className="ol-opts">
              <span className="ol-k">배당 시점</span>
              <span className="ol-seg">
                <button type="button" className={phase === 'init' ? 'is-on' : ''} onClick={() => setPhase('init')}>초기</button>
                <button type="button" className={phase === 'final' ? 'is-on' : ''} onClick={() => setPhase('final')}>최신(배변)</button>
              </span>
              <span className="ol-k">비슷함 폭</span>
              <select value={tick} onChange={(e) => setTick(Number(e.target.value))}>
                {Array.from({ length: 16 }, (_, t) => t).map((t) => <option key={t} value={t}>{t === 0 ? '완전 일치(±0칸)' : `±${t}칸`}</option>)}
              </select>
            </div>
          </div>

          <div className="ol-card">
            <h4>어디서 찾을까</h4>
            <div className="ol-chips">
              <button type="button" className={`ol-chip${picked === null ? ' is-on' : ''}`} onClick={() => toggleLeague('ALL')}>전체</button>
              {allLeagues.map((lg) => (
                <button type="button" key={lg.code} className={`ol-chip${picked?.has(lg.code) ? ' is-on' : ''}`} onClick={() => toggleLeague(lg.code)}>{lg.label}</button>
              ))}
            </div>
            <div className="ol-opts">
              <span className="ol-k">시즌</span>
              <select value={seasons} onChange={(e) => setSeasons(Number(e.target.value))}>
                <option value={0}>전체</option><option value={3}>최근 3시즌</option><option value={5}>최근 5시즌</option>
              </select>
              <span className="ol-k">정배 방향</span>
              <span className="ol-seg">
                <button type="button" className={!flip ? 'is-on' : ''} onClick={() => setFlip(false)}>같은 쪽만</button>
                <button type="button" className={flip ? 'is-on' : ''} onClick={() => setFlip(true)}>뒤집어서도</button>
              </span>
            </div>
            <p className="ol-hint">&apos;전체&apos;가 기본입니다. 리그를 누르면 그 리그만 고르고, 다시 누르면 뺍니다. &apos;뒤집어서도&apos; = 승·패(핸디는 기준점 부호까지)를 바꿔 반대쪽이 정배인 경기까지 같이 찾기.</p>
          </div>

          <div className="ol-card">
            <h4>경기에서 불러오기</h4>
            <input className="ol-search" placeholder="팀 이름 검색 (예: 강원, 인천)" value={search} onChange={(e) => setSearch(e.target.value)} />
            {games.length > 0 && (
              <div className="ol-games">
                {games.map((g, i) => (
                  <button type="button" key={i} onClick={() => fillFrom(g)}>
                    <span>{g.HT} vs {g.AT} <small>{g.lg} {g.R} · {String(g.DT).slice(3, 8)}</small></span>
                    <small>{['KW', 'KD', 'KL'].map((k) => f2((phase === 'final' ? g.final : g.init)[k])).join('/')}{(phase === 'final' ? g.final : g.init).AW != null && <> · 평균 {['AW', 'AD', 'AL'].map((k) => f2((phase === 'final' ? g.final : g.init)[k])).join('/')}</>}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="ol-hint">누르면 그 경기의 {phase === 'final' ? '최신' : '초기'} 배당이 왼쪽 칸에 채워집니다.</p>
          </div>
        </div>
        <div className="ol-actions">
          <button type="button" className="ol-btn is-pri" disabled={busy} onClick={() => run()}>{busy ? '조회 중...' : '조회'}</button>
          <button type="button" className="ol-btn" onClick={() => { setOdds(blankOdds()); setKh(''); setRes(null); setError('') }}>초기화</button>
          {recent.length > 0 && <span className="ol-recent"><small>최근 조회</small>{recent.map((x, i) => (
            <button type="button" key={i} onClick={() => { const o = { ...blankOdds(), ...x.o }; setOdds(o); setKh(x.kh || ''); run(sort, o, x.kh || '') }}>{oddsText(x.o)}</button>
          ))}</span>}
        </div>
        {error && <p className="ol-error">{error}</p>}
      </section>

      {/* ② 결과 */}
      {res && (
        <section className="ol-box">
          <div className="ol-box-h">
            <span className="ol-tag">②</span><h3>결과 — 이 배당의 과거 경기</h3>
            <small>
              {q.KW || q.KD || q.KL ? `국배 ${kText(q)}` : ''}{q.KHW || q.KHD || q.KHL ? ` · 국핸디 ${['KHW', 'KHD', 'KHL'].map((k) => q[k] || '-').join('/')}` : ''}
              {q.FW || q.FD || q.FL ? `${q.KW || q.KD || q.KL || q.KHW || q.KHD || q.KHL ? ' · ' : ''}해배 ${['FW', 'FD', 'FL'].map((k) => q[k] || '-').join('/')}` : ''}
              {q.AW || q.AD || q.AL ? `${q.KW || q.KD || q.KL || q.KHW || q.KHD || q.KHL || q.FW || q.FD || q.FL ? ' · ' : ''}해배 평균 ${['AW', 'AD', 'AL'].map((k) => q[k] || '-').join('/')}` : ''}
              {' · '}{res.cond.tick === 0 ? '완전 일치' : `±${res.cond.tick}칸`} · {res.cond.phase === 'final' ? '최신' : '초기'} · {res.cond.n}개 리그{res.cond.flip ? ' · 뒤집기 포함' : ''}
            </small>
          </div>
          {res.n === 0 ? (
            <div className="ol-empty">이 조건에 맞는 과거 경기가 없습니다 — 비슷함 폭을 넓히거나 무·핸디 칸을 비워 보세요.</div>
          ) : (
            <>
              <div className="ol-sum">
                <div>
                  <div className="ol-kpi">
                    <div><small>찾은 경기</small><b>{res.n.toLocaleString()}</b></div>
                    <div><small>정 (핸승+핸무) 단통</small><b>{pctText(res.jung)}</b></div>
                    <div><small>플 (무+역) 단통</small><b>{pctText(res.pl)}</b></div>
                    <div><small>정무 당첨</small><b>{pctText(res.jungmu)}</b></div>
                    <div><small>플핸무 당첨</small><b>{pctText(res.plmu)}</b></div>
                  </div>
                  <div className="ol-bar">
                    {[1, 2, 3, 4].map((k) => res.cnt[k - 1] > 0 && (
                      <span key={k} className={`ol-b${k}`} style={{ flex: res.cnt[k - 1] }} title={`${RT_LABEL[k]} ${res.cnt[k - 1]}경기`}>
                        {RT_LABEL[k]} {pctText(res.pct[k - 1])}
                      </span>
                    ))}
                  </div>
                  <p className="ol-hint">가장 적게 난 결과 = <b>{RT_LABEL[minRt]} {pctText(res.pct[minRt - 1])}</b>{minName.includes('→') ? ` (${minName.split('→ ')[1]})` : ''}</p>
                </div>
                <table className="ol-t">
                  <thead><tr><th>리그</th><th>경기</th><th>핸승</th><th>핸무</th><th>무</th><th>역</th><th>정 단통</th></tr></thead>
                  <tbody>
                    {res.by_league.map((g) => (
                      <tr key={g.key}><td className="ol-l">{g.key}</td><td>{g.n}</td>{g.cnt.map((c, i) => <td key={i}>{c}</td>)}<td>{pctText(g.jung)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  <table className="ol-t">
                    <thead><tr><th>시즌</th><th>경기</th><th>정 단통</th></tr></thead>
                    <tbody>
                      {res.by_season.map((g) => <tr key={g.key}><td>{g.key}</td><td>{g.n}</td><td>{pctText(g.jung)}</td></tr>)}
                      {res.base && <tr><td>같은 배당대 평소</td><td>{res.base.n.toLocaleString()}</td><td>{pctText(res.base.jung)}</td></tr>}
                    </tbody>
                  </table>
                  {res.base && <p className="ol-hint">&apos;같은 배당대 평소&apos; = 정배배당 {f2(res.base.lo)}~{f2(res.base.hi)}인 경기 전체(선택 리그·시즌)의 정 단통 — 비교용</p>}
                </div>
              </div>

              <div className="ol-tabs">
                {[['near', '가까운 순'], ['recent', '최신 순'], ['result', '결과별']].map(([k, lab]) => (
                  <button type="button" key={k} className={sort === k ? 'is-on' : ''} onClick={() => { setSort(k); run(k) }}>{lab}</button>
                ))}
                <small>{res.shown < res.n ? `${res.n.toLocaleString()}경기 중 ${res.shown}경기` : `${res.n}경기`} · 줄을 누르면 상세보기</small>
              </div>
              <div className="ol-list-wrap">
                <table className="ol-t ol-list">
                  <thead><tr><th>날짜</th><th>리그</th><th>경기</th><th>스코어</th><th>국배 승/무/패</th><th>국핸디</th><th>해배 승/무/패</th><th>해배 평균 승/무/패</th><th>결과</th></tr></thead>
                  <tbody>
                    {res.rows.map((r, i) => (
                      <tr key={i} onClick={() => setDetail(r)}>
                        <td>{kickoff(r.DT, r.TM)}</td>
                        <td>{r.lg} <small className="ol-muted">{r.S} {r.R}</small></td>
                        <td className="ol-l"><b>{r.HT}</b> <span className="ol-muted">vs</span> <b>{r.AT}</b></td>
                        <td>
                          <span className={r.HS > r.AS ? 'ol-win' : undefined}>{r.HS ?? '-'}</span> : <span className={r.AS > r.HS ? 'ol-win' : undefined}>{r.AS ?? '-'}</span>
                        </td>
                        <td>{r.K.map((v, j) => <span key={j}>{j > 0 && ' / '}<Cmp v={v} q={q[['KW', 'KD', 'KL'][j]]} /></span>)}</td>
                        <td>{r.KH !== null && <small className="ol-muted">H{r.KH > 0 ? '+' : ''}{r.KH} </small>}{r.KHx.map((v, j) => <span key={j}>{j > 0 && ' / '}<Cmp v={v} q={q[['KHW', 'KHD', 'KHL'][j]]} /></span>)}</td>
                        <td>{r.F.map((v, j) => <span key={j}>{j > 0 && ' / '}<Cmp v={v} q={q[['FW', 'FD', 'FL'][j]]} /></span>)}</td>
                        <td>{r.A.map((v, j) => <span key={j}>{j > 0 && ' / '}<Cmp v={v} q={q[['AW', 'AD', 'AL'][j]]} /></span>)}</td>
                        <td><RtBadge label={RT_LABEL[r.RT]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ol-hint"><span className="ol-same">같은 값</span> 노랑 · <span className="ol-near">1~2칸 차이</span> 글자색 — 표본 섹션과 같은 표시</p>
            </>
          )}
        </section>
      )}

      {detail && (
        <MatchDetailModal code={detail.code} scope={detail.scope} row={detail} onClose={() => setDetail(null)} onPickSaved={() => {}} />
      )}
    </div>
  )
}
