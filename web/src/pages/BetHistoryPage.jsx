import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { LEAGUE_LABELS } from '../utils/format'
import './BetHistoryPage.css'

// 베팅내역(2026-09-27 개편 — 사용자가 준 프로토 '구매내역·당첨결과' 화면을 참고).
//   등록 묶음(이번주 픽에서 '벳 등록' 한 번) = 한 줄. 줄을 누르면 펼쳐진다.
//   펼치면 ① 경기 목록 — 개최일시·리그·경기·결과(스코어)·게임(승무패/핸디 H-1.0 …)과 승/무/패 버튼.
//                        고른 칸은 배당이 찍힌 파란 칸, 실제로 나온 칸에는 ✔ (프로토 '적중결과'와 같은 뜻)
//          ② 사다리 조합표 — 조합마다 배당·뱃금액·예상 당첨금·결과·적중금
//          ③ 합계표 — 선택경기수·조합수·총투표금액·예상적중금액·적중금·수익·적중결과
//   회차(체크 → 회차 설정)·선택 삭제는 예전 그대로다. 체크는 묶음 단위(그 묶음의 벳 전부).
// 칸 위치(pos/res)·스코어는 서버 _attach_leg_views가 판정(RT)과 같은 기준으로 붙여 준다.

const HIT_BADGE = {
  적중: { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)' },
  미적중: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
  적중안됨: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
  대기: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' },
  진행중: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' },
  취소: { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)' },
  연기: { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)' },
}
const num = (v) => (v == null ? '-' : Math.round(v).toLocaleString())
const odds = (v) => (v == null ? '-' : Number(v).toFixed(2))
const pct = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v}%`)
const signClass = (v) => (v == null ? '' : v > 0 ? 'bh-pos' : v < 0 ? 'bh-neg' : '')
const DAY = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' }

// 'YY-MM-DD (Sun)' + TM → '09.20 (일) 22:00'
function kickoff(dt, tm) {
  const m = /(\d{2})-(\d{2})-(\d{2})\s*\((\w{3})\)/.exec(dt || '')
  const n = Number(tm)
  const t = tm == null || tm === '' || !Number.isFinite(n) ? '' : String(Math.trunc(n)).padStart(4, '0')
  const time = t ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : ''
  return m ? { d: `${m[2]}.${m[3]} (${DAY[m[4]] || m[4]})`, t: time } : { d: dt || '-', t: time }
}

function rangeLabel(start, end) {
  if (!start) return ''
  if (!end) return `${start} ~ 진행 중`
  return `${start} ~ ${end.slice(5)}`
}

const lineText = (l) => `${l > 0 ? '+' : ''}${Number(l).toFixed(1)}`
function marketText(leg) {
  if (leg.market === 'U') return `언더오버 U/O ${leg.line}`
  if (leg.market === 'H') return leg.line == null ? '핸디캡' : `핸디캡 H ${lineText(leg.line)}`
  return '승무패'
}
const POS_LAB = { W: ['승', '무', '패'], H: ['승', '무', '패'], U: ['언더', '', '오버'] }
const legKey = (l) => `${l.code}|${l.S}|${l.R}|${l.No}|${l.HT}|${l.AT}`

// 묶음 전체 결과 — 조합 하나라도 적중이면 '적중', 결과가 다 나왔는데 없으면 '적중안됨'(프로토 표기), 아니면 '진행중'.
function batchResult(batch) {
  const rs = batch.slips.map((s) => s.result)
  const hits = rs.filter((r) => r === '적중').length
  if (hits) return { label: '적중', text: `적중 ${hits}/${rs.length}` }
  if (rs.every((r) => r === '미적중' || r === '취소')) return { label: '적중안됨', text: '적중안됨' }
  return { label: '진행중', text: '진행중' }
}

// 묶음 안의 경기 목록 — (경기, 시장·기준점)마다 한 줄. 여러 조합에 걸쳐 고른 칸을 합친다.
function batchGames(batch) {
  const out = new Map()
  for (const slip of batch.slips) {
    for (const leg of slip.legs) {
      const k = `${legKey(leg)}#${leg.market}#${leg.line}`
      if (!out.has(k)) out.set(k, { leg, picks: new Map(), hits: new Map() })
      const g = out.get(k)
      if (leg.pos != null) {
        g.picks.set(leg.pos, leg.odds)
        g.hits.set(leg.pos, leg.hit)
      }
    }
  }
  return [...out.values()]
}

// 사다리 열(층) — 같은 자리의 다리가 전부 같은 경기면 그 경기 이름을 열 제목으로 쓴다.
function ladderCols(batch) {
  const n = Math.max(0, ...batch.slips.map((s) => s.legs.length))
  return Array.from({ length: n }, (_, i) => {
    const ks = new Set(batch.slips.map((s) => s.legs[i] && legKey(s.legs[i])).filter(Boolean))
    const first = batch.slips.find((s) => s.legs[i])?.legs[i]
    return { same: ks.size === 1, title: ks.size === 1 && first ? `${first.HT} vs ${first.AT}` : `경기 ${i + 1}` }
  })
}

function cellText(leg) {
  const lab = POS_LAB[leg.market]?.[leg.pos]
  const mk = leg.market === 'H' && leg.line != null ? `H${lineText(leg.line)} ` : leg.market === 'U' ? `U/O${leg.line} ` : ''
  return lab ? `${mk}${lab}` : leg.pick_type
}

function LegHit({ hit }) {
  if (hit === '적중') return <span className="bh-leg-hit bh-leg-hit-ok">✔</span>
  if (hit === '미적중') return <span className="bh-leg-hit bh-leg-hit-no">✕</span>
  if (hit === '연기' || hit === '취소') return <span className="bh-leg-hit bh-leg-hit-void" title={`적중특례 — 경기 ${hit}로 배당 1.00 정산`}>{hit}</span>
  return null
}

function BatchBody({ batch }) {
  const games = batchGames(batch)
  const cols = ladderCols(batch)
  const res = batchResult(batch)
  const payouts = batch.slips.map((s) => s.payout).filter((v) => v != null)
  const lo = payouts.length ? Math.min(...payouts) : null
  const hi = payouts.length ? Math.max(...payouts) : null
  const matchCount = new Set(batch.slips.flatMap((s) => s.legs.map(legKey))).size
  return (
    <div className="bh-body">
      {/* ① 경기 목록 — 프로토 당첨결과 화면처럼 */}
      <table className="bh-games">
        <thead>
          <tr><th>개최일시</th><th>리그</th><th>대상경기 (홈 vs 원정)</th><th>결과</th><th>게임</th><th colSpan={3}>선택 · 적중결과</th></tr>
        </thead>
        <tbody>
          {games.map(({ leg, picks, hits }) => {
            const ko = kickoff(leg.dt, leg.tm)
            const labs = POS_LAB[leg.market] || POS_LAB.W
            const hasScore = leg.hs != null && leg.as_ != null
            return (
              <tr key={`${legKey(leg)}#${leg.market}#${leg.line}`}>
                <td className="bh-ko">{ko.d}<small>{ko.t}</small></td>
                <td className="bh-muted">{LEAGUE_LABELS[leg.code] || leg.code}</td>
                <td className="bh-match"><b>{leg.HT}</b> <span className="bh-muted">vs</span> <b>{leg.AT}</b></td>
                <td>
                  {hasScore ? (
                    <span className="bh-score">
                      <b className={leg.hs > leg.as_ ? 'bh-win' : undefined}>{leg.hs}</b>:<b className={leg.as_ > leg.hs ? 'bh-win' : undefined}>{leg.as_}</b>
                    </span>
                  ) : <span className="bh-muted">대기</span>}
                </td>
                <td className="bh-market">{marketText(leg)}</td>
                {[0, 1, 2].map((p) => {
                  if (!labs[p]) return <td key={p} className="bh-pickcell" />
                  const picked = picks.has(p)
                  const hit = picked && hits.get(p) === '적중'
                  const actual = leg.res === p
                  return (
                    <td key={p} className="bh-pickcell">
                      <span className={`bh-pk${picked ? ' is-picked' : ''}${hit ? ' is-hit' : ''}${actual ? ' is-actual' : ''}`}
                        title={actual ? '실제 결과' : undefined}>
                        <small>{labs[p]}</small>
                        <b>{picked ? odds(picks.get(p)) : '-'}</b>
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ② 사다리 조합표 */}
      <div className="bh-ladder-wrap">
        <table className="bh-ladder">
          <thead>
            <tr>
              <th>#</th>
              {cols.map((c, i) => <th key={i} className="bh-lcol">{c.title}</th>)}
              <th>배당</th><th>뱃금액</th><th>예상 당첨금</th><th>결과</th><th>적중금</th>
            </tr>
          </thead>
          <tbody>
            {batch.slips.map((slip, n) => (
              <tr key={slip.id} className={slip.result === '적중' ? 'bh-row-hit' : undefined}>
                <td className="bh-muted">{n + 1}</td>
                {cols.map((c, i) => {
                  const leg = slip.legs[i]
                  return (
                    <td key={i} title={leg ? `${leg.HT} vs ${leg.AT} · ${leg.pick_type} ${odds(leg.odds)}` : undefined}>
                      {leg && (
                        <>
                          {!c.same && <span className="bh-muted">{leg.HT} </span>}
                          {cellText(leg)} <span className="bh-muted">{odds(leg.odds)}</span> <LegHit hit={leg.hit} />
                        </>
                      )}
                    </td>
                  )
                })}
                <td className="bh-strong" title={slip.odds_registered != null ? `적중특례 경기를 1.00으로 바꿔 다시 곱한 배당 (등록 배당 ${odds(slip.odds_registered)})` : undefined}>
                  {odds(slip.odds)}{slip.odds_registered != null && <span className="bh-odds-registered">{odds(slip.odds_registered)}</span>}
                </td>
                <td>{num(slip.stake)}</td>
                <td>{num(slip.payout)}</td>
                <td><span className="bh-badge" style={HIT_BADGE[slip.result] || HIT_BADGE['대기']}>{slip.result}</span></td>
                <td>{num(slip.hit_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ③ 합계표 — 프로토 하단 요약과 같은 순서 */}
      <table className="bh-sum">
        <thead>
          <tr><th>선택경기수</th><th>조합수</th><th>총투표금액</th><th>예상적중금액</th><th>적중금</th><th>수익</th><th>적중결과</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{matchCount}경기</td>
            <td>{batch.slips.length}조합</td>
            <td className="bh-strong">{num(batch.subtotal.stake)} 원</td>
            <td>{lo == null ? '-' : lo === hi ? `${num(lo)} 원` : `${num(lo)} ~ ${num(hi)} 원`}</td>
            <td>{num(batch.subtotal.hit_amount)} 원</td>
            <td className={signClass(batch.subtotal.profit)}>{num(batch.subtotal.profit)} <small>{pct(batch.subtotal.roi)}</small></td>
            <td><span className="bh-badge" style={HIT_BADGE[res.label]}>{res.text}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SummaryBar({ summary }) {
  if (!summary) return null
  return (
    <div className="bh-summary-bar">
      <div className="bh-summary-item"><span className="bh-summary-label">총 투자</span><b>{num(summary.stake)}</b></div>
      <div className="bh-summary-item"><span className="bh-summary-label">총 회수</span><b>{num(summary.hit_amount)}</b></div>
      <div className="bh-summary-item"><span className="bh-summary-label">수익</span><b className={signClass(summary.profit)}>{num(summary.profit)}</b></div>
      <div className="bh-summary-item"><span className="bh-summary-label">수익률</span><b className={signClass(summary.roi)}>{pct(summary.roi)}</b></div>
      <div className="bh-summary-item">
        <span className="bh-summary-label">적중</span>
        <b>
          {summary.hit_count}/{summary.total_count}{' '}
          <small>{summary.total_count ? `${Math.round((summary.hit_count / summary.total_count) * 1000) / 10}%` : '-'}</small>
        </b>
      </div>
    </div>
  )
}

export default function BetHistoryPage({ scope }) {
  const [data, setData] = useState({ sections: [], summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 체크는 벳(slip) id로 들고 있고, 화면에서는 묶음 단위로 켜고 끈다.
  const [selected, setSelected] = useState(new Set())
  const [openRounds, setOpenRounds] = useState(new Set())   // 펼친 확정 회차
  const [openBatches, setOpenBatches] = useState(new Set()) // 펼친 등록 묶음

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/api/bet_slips?scope=${scope}`)
      setData({ sections: res.sections || [], summary: res.summary || null })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [scope])

  const toggleSet = (setter, key) => setter((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  function toggleIds(ids, on) {
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 벳 ${selected.size}개를 삭제할까요?`)) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/bet_slips/delete_selected', { scope, slip_ids: [...selected] })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleLockSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 벳 ${selected.size}개를 하나의 회차로 확정합니다. 확정되면 더 이상 선택 삭제·재설정을 할 수 없어요. 계속할까요?`)) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/bet_slips/lock', { scope, slip_ids: [...selected] })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="bh-empty">불러오는 중...</div>

  const { sections, summary } = data
  let roundIdx = 0

  return (
    <div className="bh-page">
      <div className="bh-title-row">
        <h2 className="bh-title">📋 베팅내역</h2>
        {sections.length > 0 && <SummaryBar summary={summary} />}
      </div>
      <p className="bh-desc">
        이번주 픽에서 등록한 벳이 한 줄씩 쌓입니다. 줄을 누르면 경기·조합·합계가 펼쳐집니다.
        체크한 뒤 "회차 설정"을 누르면 그 벳들이 묶여 회차총계가 계산되고, 확정 전에는 "선택 삭제"로 지울 수 있습니다.
      </p>
      {error && <div className="bh-empty error-text">{error}</div>}
      {sections.length === 0 && <div className="bh-empty">등록된 베팅내역이 없습니다.</div>}

      {sections.map((sec, si) => {
        const locked = sec.group_id != null
        if (locked) roundIdx += 1
        const isOpen = !locked || openRounds.has(sec.group_id)
        const secIds = locked ? [] : sec.batches.flatMap((b) => b.slips.map((s) => s.id))
        const allSel = secIds.length > 0 && secIds.every((id) => selected.has(id))
        // 최신 등록이 위로 오게 묶음 순서를 뒤집어 보여준다(프로토 구매내역처럼).
        const batches = [...sec.batches].reverse()
        return (
          <section key={sec.group_id ?? `pending-${si}`} className={`bh-sec${locked ? ' is-locked' : ''}`}>
            <div className="bh-sec-head">
              {locked && (
                <button type="button" className="bh-fold-btn" onClick={() => toggleSet(setOpenRounds, sec.group_id)} title={isOpen ? '접기' : '펼치기'}>
                  {isOpen ? '▾' : '▸'}
                </button>
              )}
              <b className="bh-sec-name">{locked ? `${roundIdx}회차` : '미확정'}</b>
              <span className="bh-muted">{rangeLabel(sec.round_start, sec.round_end)}</span>
              {locked && <span className="bh-locked-badge">확정 · 잠김</span>}
              <span className="bh-muted">{sec.batches.length}묶음 · {sec.batches.reduce((n, b) => n + b.slips.length, 0)}조합</span>
              <span className="bh-grow" />
              {!locked && (
                <>
                  <button className="bh-action-btn" onClick={() => toggleIds(secIds, !allSel)} disabled={busy || !secIds.length}>{allSel ? '☐ 전체해제' : '☑ 전체선택'}</button>
                  <button className="bh-action-btn" onClick={handleDeleteSelected} disabled={busy || !selected.size}>🗑 선택 삭제{selected.size ? ` (${selected.size})` : ''}</button>
                  <button className="bh-action-btn bh-action-primary" onClick={handleLockSelected} disabled={busy || !selected.size}>🔒 회차 설정{selected.size ? ` (${selected.size})` : ''}</button>
                </>
              )}
              <span className="bh-sec-stats">
                투자 {num(sec.total.stake)} · 회수 {num(sec.total.hit_amount)} ·{' '}
                <b className={signClass(sec.total.profit)}>{num(sec.total.profit)} {pct(sec.total.roi)}</b>
              </span>
            </div>

            {isOpen && batches.map((batch) => {
              const ids = batch.slips.map((s) => s.id)
              const checked = ids.every((id) => selected.has(id))
              const open = openBatches.has(batch.batch_id)
              const res = batchResult(batch)
              const matchCount = new Set(batch.slips.flatMap((s) => s.legs.map(legKey))).size
              const first = batch.slips[0]?.legs?.[0]
              return (
                <Fragment key={batch.batch_id}>
                  <div className={`bh-batch-row${res.label === '적중' ? ' is-hit' : ''}${checked && !locked ? ' is-sel' : ''}`}>
                    <input type="checkbox" disabled={locked} checked={!locked && checked} onChange={() => toggleIds(ids, !checked)} aria-label="이 묶음 선택" />
                    <button type="button" className="bh-batch-main" onClick={() => toggleSet(setOpenBatches, batch.batch_id)}>
                      <span className="bh-batch-name">
                        이번주 벳 <small>{first ? `${first.HT} vs ${first.AT}${matchCount > 1 ? ` 외 ${matchCount - 1}경기` : ''}` : ''}</small>
                      </span>
                      <span className="bh-muted">{String(batch.created_dt || '').slice(2, 16).replace(/-/g, '.')}</span>
                      <span className="bh-muted bh-mono">{String(batch.batch_id).toUpperCase().replace(/(.{4})(?=.)/g, '$1-')}</span>
                      <span className="bh-right">{matchCount}경기 · {batch.slips.length}조합</span>
                      <span className="bh-right bh-strong">{num(batch.subtotal.stake)}</span>
                      <span className="bh-right">{num(batch.subtotal.hit_amount)}</span>
                      <span className="bh-right"><span className={signClass(batch.subtotal.profit)}>{num(batch.subtotal.profit)}</span></span>
                      <span><span className="bh-badge" style={HIT_BADGE[res.label]}>{res.text}</span></span>
                      <span className="bh-plus">{open ? '−' : '+'}</span>
                    </button>
                  </div>
                  {open && <BatchBody batch={batch} />}
                </Fragment>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
