import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import MatchDetailModal from '../components/MatchDetailModal/MatchDetailModal'
import WeekCard from '../components/WeeklyPick/WeekCard'
import LadderTable, { MAX_ROWS } from '../components/WeeklyPick/LadderTable'
import {
  buildCombos, buildLegs, cardMarkets, comboCount, comboToBet, dayKey, dayLabel, mainSideOf, matchKey, pickSide, splitBudget,
} from '../components/WeeklyPick/weekBet'
import '../components/WeeklyPick/WeeklyPick.css'
import './WeeklyPickPage.css'

// 이번주 픽(2026-09-27 개편, 사용자 지정 — 목업 web/public/mockups/weekly_pick_mock.html).
//   위: 날짜 탭 + 카드 보드(메인/사이드 = 의견 B-Ma·B-Si·축-Si, 없으면 별 단계 × 정/플 = 내픽 계열). 카드의 배당을 눌러 벳에 담는다.
//   가운데: 이번주 벳 = 사다리(경기 하나가 한 층, 층마다 하나씩 고른 모든 조합이 한 줄). 층 수 제한 없음.
//   아래: 저장된 벳(프로토 구매내역처럼 한 줄씩, 접힘/펼침) → 벳 등록하면 베팅내역으로.
// 예전 화면(리그 표 목록 + 선택 1~4 벳 슬립, components/BetSlip)은 이 화면으로 바뀌었다.
// 지금 짜는 조합·저장된 벳은 이 브라우저(localStorage)에 남는다 — 새로고침해도 그대로.
const SEL_KEY = 'betpro_week_sel_v2'
const SAVED_KEY = 'betpro_week_saved_v2'

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
function saveJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 저장 불가 — 이번 화면에서만 유지 */ }
}

const BOXES = [['M', '정'], ['M', '플'], ['S', '정'], ['S', '플']]
const fmt = (v) => Math.round(v || 0).toLocaleString()
const nowText = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 사다리 표에 넘길 모양(cols/rows) — 지금 짜는 벳과 저장된 벳이 같은 모양을 쓴다.
function ladderView(legs, combos) {
  return {
    cols: legs.map((l) => ({ title: `${l.row.HT} vs ${l.row.AT}`, sub: l.mks, axis: l.axis })),
    rows: combos.map((c) => ({ key: c.key, odds: c.odds, cells: c.path.map(({ p }) => ({ lab: p.lab, odds: p.odds, role: p.role })) })),
  }
}

export default function WeeklyPickPage({ onGoBetHistory }) {
  const [data, setData] = useState({ rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [dateSel, setDateSel] = useState('ALL')
  const [detailRow, setDetailRow] = useState(null)
  const [extraOdds, setExtraOdds] = useState(new Map())
  // 선택: matchKey → [{m,i}] (Map은 JSON이 안 돼 [키, 값] 배열로 저장)
  const [sel, setSel] = useState(() => new Map(loadJson(SEL_KEY, { sel: [] }).sel))
  const [stakes, setStakes] = useState(() => loadJson(SEL_KEY, {}).stakes || {})
  const [budget, setBudget] = useState(() => loadJson(SEL_KEY, {}).budget ?? 100000)
  const [editing, setEditing] = useState(() => loadJson(SEL_KEY, {}).editing ?? null)
  const [saved, setSaved] = useState(() => loadJson(SAVED_KEY, []))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { saveJson(SEL_KEY, { sel: [...sel.entries()], stakes, budget, editing }) }, [sel, stakes, budget, editing])
  useEffect(() => { saveJson(SAVED_KEY, saved) }, [saved])
  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(t)
  }, [notice])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get('/api/weekly_picks'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // 추가배당(±2·±3.5 핸디) — 카드의 '추가' 줄. 경기 키(matchKey)로 나눠 둔다.
  useEffect(() => {
    const list = data.rows || []
    if (!list.length) {
      setExtraOdds(new Map())
      return undefined
    }
    let alive = true
    api.post('/api/kr_extra_odds/lookup', {
      items: list.map((r) => ({ scope: r.scope, code: r.L, S: r.S, R: r.R, HT: r.HT, AT: r.AT })),
    })
      .then((res) => { if (alive) setExtraOdds(new Map(list.map((r, i) => [matchKey(r), res.items?.[i] ?? []]))) })
      .catch(() => { if (alive) setExtraOdds(new Map()) })
    return () => { alive = false }
  }, [data.rows])

  const rows = useMemo(() => data.rows || [], [data.rows])
  const rowByKey = useMemo(() => new Map(rows.map((r) => [matchKey(r), r])), [rows])
  const marketsByKey = useMemo(() => new Map(rows.map((r) => [matchKey(r), cardMarkets(r, extraOdds.get(matchKey(r)))])), [rows, extraOdds])

  // dayKey/dayLabel은 '베팅일' 기준(새벽 6시 이전은 전날 그룹)이라 DT뿐 아니라 TM도 있어야
  // 정확히 계산된다 — row 전체를 넘긴다(2026-09-27 사용자 지정, LeagueTable의 bettingDayOf와 같은 규칙).
  const days = useMemo(() => [...new Set(rows.map((r) => dayKey(r)))].sort(), [rows])
  const dayText = useMemo(() => new Map(rows.map((r) => [dayKey(r), dayLabel(r)])), [rows])
  const shown = rows.filter((r) => dateSel === 'ALL' || dayKey(r) === dateSel)
  const boxOf = (r) => {
    const side = pickSide(r.MY_PICK)
    return side ? `${mainSideOf(r)}${side}` : null
  }

  const legs = useMemo(() => buildLegs(sel, rowByKey, extraOdds), [sel, rowByKey, extraOdds])
  const nCombo = comboCount(legs)
  const combos = useMemo(() => (nCombo <= MAX_ROWS ? buildCombos(legs) : []), [legs, nCombo])
  const stakeSum = combos.reduce((a, c) => a + (Number(stakes[c.key]) || 0), 0)
  const wins = combos.filter((c) => Number(stakes[c.key]) > 0).map((c) => Math.floor(c.odds * stakes[c.key]))
  const winText = wins.length ? (Math.min(...wins) === Math.max(...wins) ? `${fmt(wins[0])} 원` : `${fmt(Math.min(...wins))} ~ ${fmt(Math.max(...wins))} 원`) : '-'
  const nAxis = legs.filter((l) => l.axis).length

  function toggle(key, m, i) {
    setSel((prev) => {
      const next = new Map(prev)
      const arr = [...(next.get(key) || [])]
      const at = arr.findIndex((s) => s.m === m && s.i === i)
      if (at >= 0) arr.splice(at, 1)
      else arr.push({ m, i })
      if (arr.length) next.set(key, arr)
      else next.delete(key)
      return next
    })
  }

  function clearSlip() {
    setSel(new Map())
    setStakes({})
    setEditing(null)
  }

  async function hideRow(row) {
    if (!window.confirm(`${row.HT} vs ${row.AT} 경기를 이번주 픽에서 숨깁니다(별표·리그 데이터는 그대로). 계속할까요?`)) return
    try {
      await api.post('/api/weekly_picks/hide', {
        items: [{ code: row.L, scope: row.scope, S: row.S, R: row.R, No: row.No, HT: row.HT, AT: row.AT }],
      })
      setSel((prev) => {
        const next = new Map(prev)
        next.delete(matchKey(row))
        return next
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  // 전체 삭제 — 지금 날짜 탭에 보이는 경기를 이번주 픽에서 한 번에 숨긴다(예전 '전체선택 + 선택 삭제'와 같은 동작).
  // 별표·리그 데이터는 그대로이고, 그 경기들을 담아 둔 선택도 같이 뺀다.
  async function hideAll() {
    if (!shown.length) return
    const what = dateSel === 'ALL' ? '전체' : dayText.get(dateSel)
    if (!window.confirm(`${what} ${shown.length}경기를 이번주 픽에서 모두 지웁니다(별표·리그 데이터는 그대로입니다). 계속할까요?`)) return
    try {
      await api.post('/api/weekly_picks/hide', {
        items: shown.map((row) => ({ code: row.L, scope: row.scope, S: row.S, R: row.R, No: row.No, HT: row.HT, AT: row.AT })),
      })
      setSel((prev) => {
        const next = new Map(prev)
        shown.forEach((row) => next.delete(matchKey(row)))
        return next
      })
      setDateSel('ALL')
      await load()
      setNotice(`${shown.length}경기를 이번주 픽에서 지웠습니다`)
    } catch (err) {
      setError(err.message)
    }
  }

  // 저장 — 지금 조합(선택·뱃금액)을 저장된 벳 한 줄로. 조합은 그대로 남는다(사용자 지정).
  // 화면에 보이는 사다리(층·조합·배당)를 그대로 떠 둔다 — 나중에 배당이 바뀌어도 저장한 그때 값으로 등록된다.
  function snapshot() {
    const view = ladderView(legs, combos)
    const bets = combos.filter((c) => Number(stakes[c.key]) > 0).map((c) => comboToBet(c, Number(stakes[c.key])))
    const bad = combos.some((c) => c.path.some(({ p }) => !p.pickType))
    return {
      view, bets, bad, stakes: { ...stakes }, budget, sel: [...sel.entries()],
      nLegs: legs.length, nAxis, nCombo: combos.length, stakeSum, winText,
      summary: legs.map((l) => `${l.axis ? '[축]' : '[복수]'} ${l.row.HT} ${l.picks.map((p) => p.lab).join('+')}`).join(' · '),
    }
  }

  async function saveSlip() {
    if (!legs.length) return
    const snap = snapshot()
    if (snap.bad) {
      setError('정배를 가릴 수 없는 경기(승·패 배당 동률 등)가 있어 픽 종류를 정하지 못했습니다 — 그 경기의 선택을 빼 주세요.')
      return
    }
    setError('')
    if (editing) {
      const v = saved.find((x) => x.id === editing)
      if (v?.status === 'reg') {
        if (!snap.bets.length) { setError('뱃금액을 입력한 조합이 없습니다.'); return }
        setBusy(true)
        try {
          const res = await api.post('/api/bet_slips/replace_batch', { scope: 'master', batch_id: v.batchId, bets: snap.bets })
          setSaved((prev) => prev.map((x) => (x.id === editing ? { ...x, ...snap, batchId: res.batch_id, ts: nowText(), open: true } : x)))
          setNotice('수정했습니다 — 베팅내역에도 반영했습니다')
          setEditing(null)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
        return
      }
      setSaved((prev) => prev.map((x) => (x.id === editing ? { ...x, ...snap, ts: nowText(), open: true } : x)))
      setNotice('수정 내용을 저장했습니다')
      setEditing(null)
      return
    }
    const id = Math.max(0, ...saved.map((x) => x.id)) + 1
    setSaved((prev) => [{ id, name: `이번주 벳 #${id}`, ts: nowText(), status: 'saved', open: true, ...snap }, ...prev])
    setNotice('벳을 저장했습니다 — 조합은 그대로 남아 있습니다')
  }

  async function register(v) {
    if (!v.bets.length) { setError('뱃금액을 입력한 조합이 없습니다 — 수정해서 뱃금액을 넣어 주세요.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/api/bet_slips', { scope: 'master', bets: v.bets })
      setSaved((prev) => prev.map((x) => (x.id === v.id ? { ...x, status: 'reg', batchId: res.batch_id, open: false } : x)))
      setNotice('베팅내역에 등록했습니다')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(v) {
    setSel(new Map(v.sel))
    setStakes({ ...v.stakes })
    setBudget(v.budget)
    setEditing(v.id)
    setDateSel('ALL')
    setNotice(`${v.name} 내역을 카드와 이번주 벳에 불러왔습니다`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function removeSaved(v) {
    if (!window.confirm(`${v.name}을(를) 저장된 벳에서 지웁니다. 계속할까요?`)) return
    setSaved((prev) => prev.filter((x) => x.id !== v.id))
    if (editing === v.id) setEditing(null)
  }

  const view = ladderView(legs, combos)
  const editName = editing ? saved.find((x) => x.id === editing)?.name : null
  const noPick = shown.filter((r) => !boxOf(r))

  return (
    <div className="wp-page">
      <div className="wp-title-row">
        <h2 className="wp-title">📋 이번주 픽</h2>
        <button className="wp-guide-btn" onClick={() => setShowGuide(true)}>⚠ 배팅전필독</button>
        {shown.length > 0 && (
          <button className="wp-clear-btn" onClick={hideAll} title="지금 날짜 탭에 보이는 경기를 이번주 픽에서 모두 지웁니다(별표·리그 데이터는 그대로)">
            🗑 {dateSel === 'ALL' ? '전체 삭제' : `${dayText.get(dateSel)} 삭제`} ({shown.length})
          </button>
        )}
      </div>
      <p className="wp-desc">
        별표 경기 {rows.length}개 · 메인/사이드는 의견(B-Ma·B-Si·축-Si, 없으면 ★★ 메인 / ★ 사이드), 정·플은 내픽으로 나눕니다 · 카드의 배당을 눌러 이번주 벳에 담습니다
        (한 경기에서 1칸 = <b>축</b>, 2칸 이상 = <b>복수</b> — 가로·세로 모두 가능)
      </p>

      {loading && <div className="wp-empty">불러오는 중...</div>}
      {error && <div className="wp-empty error-text">{error}</div>}
      {!loading && rows.length === 0 && (
        <div className="wp-empty">별표(★) 표시한 경기가 없습니다. 리그 표에서 ☆를 눌러 이번주에 볼 경기를 골라주세요.</div>
      )}

      {rows.length > 0 && (
        <>
          <div className="wk-dtabs">
            {['ALL', ...days].map((d) => {
              const n = rows.filter((r) => d === 'ALL' || dayKey(r) === d).length
              const k = rows.filter((r) => (d === 'ALL' || dayKey(r) === d) && sel.has(matchKey(r))).length
              return (
                <button key={d} type="button" className={d === dateSel ? 'is-on' : undefined} onClick={() => setDateSel(d)}>
                  {d === 'ALL' ? '전체' : dayText.get(d)}<small>{n}경기{k ? ` · 담김 ${k}` : ''}</small>
                </button>
              )
            })}
          </div>

          <div className="wk-board">
            <div className="wk-grp is-main">메인 <small>B-Ma · 축-정·플·고민 · ★★</small></div>
            <div className="wk-grp">사이드 <small>B-Si · 축-Si · ★</small></div>
            {BOXES.map(([ms, side], bi) => (
              <div key={`h${bi}`} className={`wk-sub ${side === '정' ? 'is-jung' : 'is-pl'}${bi === 1 ? ' is-edge' : ''}`}>
                {side}<small>{shown.filter((r) => boxOf(r) === ms + side).length}경기</small>
              </div>
            ))}
            {BOXES.map(([ms, side], bi) => {
              const list = shown.filter((r) => boxOf(r) === ms + side)
              return (
                <div key={`c${bi}`} className={`wk-col${bi === 1 ? ' is-edge' : ''}`}>
                  {list.length ? list.map((r) => (
                    <WeekCard
                      key={matchKey(r)}
                      row={r}
                      markets={marketsByKey.get(matchKey(r)) || []}
                      picked={sel.get(matchKey(r))}
                      dayText={dayText.get(dayKey(r))}
                      onToggle={(m, i) => toggle(matchKey(r), m, i)}
                      onOpen={() => setDetailRow(r)}
                      onHide={() => hideRow(r)}
                    />
                  )) : <div className="wk-empty">별표 경기 없음</div>}
                </div>
              )
            })}
          </div>
          {noPick.length > 0 && (
            <div className="wk-nopick">
              <div className="wk-nopick-h">내픽 미정 {noPick.length}경기 — 상세보기에서 내픽을 고르면 칸으로 들어갑니다</div>
              <div className="wk-nopick-list">
                {noPick.map((r) => (
                  <WeekCard
                    key={matchKey(r)}
                    row={r}
                    markets={marketsByKey.get(matchKey(r)) || []}
                    picked={sel.get(matchKey(r))}
                    dayText={dayText.get(dayKey(r))}
                    onToggle={(m, i) => toggle(matchKey(r), m, i)}
                    onOpen={() => setDetailRow(r)}
                    onHide={() => hideRow(r)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <h2 className="wp-title wp-title-bet">
        🎲 이번주 벳 <span className="wp-title-warn">똥배는 3번 생각하고 가자</span>
      </h2>
      <div className="wk-slip">
        <div className="wk-slip-bar">
          <b className={editing ? 'wk-editing' : undefined}>{editing ? `조합 — ${editName} 수정 중` : '조합'}</b>
          {editing && <button type="button" className="wk-btn" onClick={clearSlip}>수정 취소</button>}
          <span><span className="wk-k">선택 경기</span><b>{legs.length}경기</b>{legs.length > 0 && <small> (축 {nAxis} · 복수 {legs.length - nAxis})</small>}</span>
          <span><span className="wk-k">조합</span><b>{nCombo.toLocaleString()}</b></span>
          <span>
            <span className="wk-k">총벳금액</span>
            <input
              type="text"
              inputMode="numeric"
              className="wk-budget"
              value={budget ? Number(budget).toLocaleString() : ''}
              onChange={(e) => setBudget(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
            /> 원
            <button type="button" className="wk-btn" disabled={!combos.length || !budget} onClick={() => setStakes((p) => ({ ...p, ...splitBudget(combos, budget) }))}>금액적용</button>
          </span>
          <span><span className="wk-k">뱃금액 합계</span><b className="wk-sum">{fmt(stakeSum)}</b> 원</span>
          <span><span className="wk-k">당첨금</span><b>{winText}</b></span>
          <span className="wk-grow" />
          <button type="button" className="wk-btn" onClick={clearSlip} disabled={!sel.size}>전체 비우기</button>
          <button type="button" className="wk-btn is-pri" onClick={saveSlip} disabled={!legs.length || busy}>{editing ? '수정 저장' : '벳 저장'}</button>
        </div>
        {legs.length ? (
          <LadderTable cols={view.cols} rows={nCombo > MAX_ROWS ? new Array(nCombo) : view.rows} stakes={stakes} editable onStake={(k, v) => setStakes((p) => ({ ...p, [k]: v }))} />
        ) : (
          <div className="wk-empty">카드의 승/무/패 배당을 눌러 담으세요 — 한 경기에서 1칸만 고르면 <b>축</b>, 2칸 이상이면 <b>복수</b>(메인+보험)입니다.</div>
        )}
        <div className="wk-slip-note">
          경기 하나가 사다리의 한 층입니다 — 층마다 하나씩 골라 내려가는 모든 조합이 한 줄씩 나옵니다(층 수 제한 없음).
          뱃배당은 프로토처럼 소수 1자리로 올림합니다. 복수는 배당이 가장 낮은 칸이 메인, 나머지가 보험입니다.
        </div>
      </div>

      <h2 className="wp-title wp-title-bet">💾 저장된 벳</h2>
      {saved.length === 0 ? (
        <div className="wk-empty wk-dashed">아직 저장한 벳이 없습니다 — 위에서 조합을 짜고 <b>벳 저장</b>을 누르세요</div>
      ) : saved.map((v) => (
        <div className="wk-sv" key={v.id}>
          <button type="button" className="wk-sv-row" onClick={() => setSaved((p) => p.map((x) => (x.id === v.id ? { ...x, open: !x.open } : x)))}>
            <span className="wk-sv-name">{v.name}<small>축 {v.nAxis} · 복수 {v.nLegs - v.nAxis} · {v.nCombo}조합</small></span>
            <span>{v.ts}</span>
            <span className="wk-num">{v.nLegs}경기</span>
            <span className="wk-num">{fmt(v.stakeSum)} 원</span>
            <span className="wk-num">{v.winText}</span>
            <span><span className={`wk-st ${v.status === 'reg' ? 'is-reg' : ''}`}>{v.status === 'reg' ? '베팅내역 등록됨' : '저장됨'}</span></span>
            <span className="wk-sv-tg">{v.open ? '−' : '+'}</span>
          </button>
          {v.open && (
            <div className="wk-sv-body">
              <div className="wk-sv-sum">{v.summary}</div>
              <LadderTable cols={v.view.cols} rows={v.view.rows} stakes={v.stakes} />
              <div className="wk-sv-act">
                {v.status === 'reg' && <span className="wk-st is-reg">베팅내역에 등록되었습니다</span>}
                {v.status === 'reg' && onGoBetHistory && <button type="button" className="wk-btn" onClick={onGoBetHistory}>베팅내역 보기</button>}
                {/* 2026-09-27 사용자 제보 — "저장된 벳 삭제 기능이 없네 수정만 있고". 등록된
                    벳도 삭제가 빠져 있었다 — removeSaved는 서버의 베팅내역(bet_slips)을 안 건드리고
                    이 화면의 '저장된 벳' 목록(로컬)에서만 지운다(자체 확인창에도 그렇게 써 있다),
                    그래서 등록 여부와 상관없이 항상 보여줘도 안전하다. */}
                <button type="button" className="wk-btn" onClick={() => removeSaved(v)}>삭제</button>
                <button type="button" className="wk-btn" onClick={() => startEdit(v)}>수정</button>
                {v.status !== 'reg' && <button type="button" className="wk-btn is-pri" disabled={busy} onClick={() => register(v)}>벳 등록 → 베팅내역</button>}
              </div>
            </div>
          )}
        </div>
      ))}

      {notice && <div className="wk-toast">{notice}</div>}
      {detailRow && (
        <MatchDetailModal
          code={detailRow.L}
          scope={detailRow.scope}
          row={detailRow}
          onClose={() => { setDetailRow(null); load() }}
          onPickSaved={() => {}}
        />
      )}
      {showGuide && <BettingGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  )
}

// 배팅전필독 — 강추·초강추가 "적중을 보장"하는 게 아니라 "핸승(정배 2골차 이상)은
// 안 나온다"만 보장한다는 것, 그리고 그 나머지(무·역·핸무) 중 핸무만 걸리면 적중이
// 아니라 보험이라는 걸 실측으로 보여준다. 2026-09-08 우디네세/라치오(핸무로 보험)를
// 계기로 6대리그 36,033경기 전수 실측 — 근거는 web/src/utils/verdictCalc.js의
// 강추 등급 실측(STRONG_TIER_TITLE 주석)과 같은 데이터, 여기서는 배팅 관점으로 재구성.
function BettingGuideModal({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop help-legend-back" onClick={onClose}>
      <div className="modal-card help-legend-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">⚠ 배팅 전 필독 — 강추가 떠도 무조건 맞는 게 아닙니다</h2>

        <p className="help-legend-note">
          강추·초강추(플핸무)는 <b>&quot;핸승(정배가 2골차 이상 이기는 것)은 안 나온다&quot;</b>에
          거는 판정입니다. 나머지 세 결과(핸무·무·역) 중 무엇이 나올지는 갈라주지 않습니다.
          이 중 <b>핸무</b>가 걸리면 판정표에서 <b>&apos;보험&apos;</b>(원금 근처 환급)이지{' '}
          <b>&apos;적중&apos;</b>(수익)이 아닙니다 — 강추가 뜬 경기도 5경기 중 1경기 꼴로 이렇게
          끝납니다. 아래는 그 근거입니다.
        </p>

        <p className="help-legend-title">① 핸무는 배당을 봐도 미리 못 피합니다</p>
        <p className="help-legend-note">
          핸승은 정배가 강할수록 확 줄어듭니다. 그런데 <b>핸무는 어떤 배당에서도 20~26%
          사이에서 거의 안 움직입니다</b> — 배당이 이미 아는 정보가 아니라는 뜻이라, 핸무만
          따로 피하는 신호를 이 앱에서도 만들 수가 없습니다(그래서 픽 이름을 정할 때부터
          핸무·무는 배제 후보에서 뺍니다).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr>
              <th>배변 국내 정배배당</th><th>경기수</th><th>핸승</th><th>핸무</th>
              <th>무</th><th>역</th><th>적중</th><th>당첨</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>~1.35</td><td>6,191</td><td>52.46%</td><td>23.81%</td><td>15.36%</td><td>8.37%</td><td>23.73%</td><td>47.54%</td></tr>
            <tr><td>1.35~1.60</td><td>6,585</td><td>34.55%</td><td>25.80%</td><td>23.51%</td><td>16.14%</td><td>39.65%</td><td>65.45%</td></tr>
            <tr><td>1.60~1.90</td><td>8,102</td><td>26.20%</td><td>24.55%</td><td>26.64%</td><td>22.61%</td><td>49.25%</td><td>73.80%</td></tr>
            <tr><td>1.90~2.10</td><td>5,170</td><td>21.26%</td><td>22.28%</td><td>29.19%</td><td>27.27%</td><td>56.46%</td><td>78.74%</td></tr>
            <tr><td>2.10~2.25</td><td>3,655</td><td>18.60%</td><td>21.15%</td><td>29.25%</td><td>31.00%</td><td>60.25%</td><td>81.40%</td></tr>
            <tr><td>2.25~2.45</td><td>2,871</td><td>15.99%</td><td>21.42%</td><td>30.72%</td><td>31.87%</td><td>62.59%</td><td>84.01%</td></tr>
            <tr><td>2.45~2.65</td><td>231</td><td>10.39%</td><td>20.78%</td><td>37.66%</td><td>31.17%</td><td>68.83%</td><td>89.61%</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          핸승은 52.46% → 10.39%로 42%p나 움직이는데, <b>핸무는 20.78~25.80%, 5%p 안에서만
          흔들립니다</b>(6대리그 36,033경기 전수).
        </p>

        <p className="help-legend-title">② 강추·초강추가 떠도 5경기 중 1경기는 보험입니다</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr>
              <th>등급</th><th>경기수</th><th>미적(핸승)</th><th>보험(핸무)</th>
              <th>무</th><th>역</th><th>적중</th><th>당첨</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>초강추·국≠해</td><td>843</td><td>14.59%</td><td>18.98%</td><td>30.37%</td><td>36.06%</td><td>66.43%</td><td>85.41%</td></tr>
            <tr><td>초강추·통합</td><td>781</td><td>14.21%</td><td>22.02%</td><td>31.24%</td><td>32.52%</td><td>63.76%</td><td>85.79%</td></tr>
            <tr><td>강추·해배</td><td>1,097</td><td>15.04%</td><td>19.05%</td><td>31.45%</td><td>34.46%</td><td>65.91%</td><td>84.96%</td></tr>
            <tr><td>강추·반전</td><td>264</td><td>12.88%</td><td>18.18%</td><td>32.20%</td><td>36.74%</td><td>68.94%</td><td>87.12%</td></tr>
            <tr><td><b>4등급 합</b></td><td><b>2,985</b></td><td><b>14.51%</b></td><td><b>19.73%</b></td><td><b>31.16%</b></td><td><b>34.61%</b></td><td><b>65.76%</b></td><td><b>85.49%</b></td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          가장 등급이 높은 초강추·국≠해도 <b>보험 확률이 18.98%</b>입니다. &quot;당첨&quot;(적중+보험)
          은 85%대로 높지만, 조합 수익을 결정하는 건 그중에서도 &quot;적중&quot;(65~69%)입니다.
        </p>

        <p className="help-legend-title">③ 조합을 짤 때 실제로 남는 확률</p>
        <p className="help-legend-note">
          강추 4등급 전체 평균(적중 65.76% · 당첨 85.49%)을 그대로 두 경기·세 경기로 곱하면
          이렇게 줄어듭니다(경기끼리 서로 무관하다고 가정한 계산입니다):
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>조합</th><th>전부 적중(수익)</th><th>전부 당첨(적중+보험)</th><th>보험 1경기 이상 포함</th></tr>
          </thead>
          <tbody>
            <tr><td>1경기</td><td>65.76%</td><td>85.49%</td><td>—</td></tr>
            <tr><td>2경기 조합</td><td>43.25%</td><td>73.09%</td><td>26.91%</td></tr>
            <tr><td>3경기 조합</td><td>28.46%</td><td>62.48%</td><td>37.52%</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          강추끼리 묶은 2경기 조합이라도 <b>&quot;둘 다 적중&quot;은 절반이 안 됩니다(43.25%)</b>.
          어제처럼 한쪽이 보험(핸무)으로 끝나는 조합은 흔한 결과입니다.
        </p>

        <p className="help-legend-title">④ &quot;이 팀은 원래 핸무가 잘 나온다&quot;는 대부분 우연입니다</p>
        <p className="help-legend-note">
          ※ <b>상관계수(r)</b> — 두 값이 같이 움직이는 정도를 재는 숫자. 0이면 서로 아무 관계
          없음, 1에 가까울수록 강하게 같이 움직입니다. 0.02 정도면 사실상 무관계로 봅니다.
        </p>
        <p className="help-legend-note">
          상대전적에서 &apos;직전까지 핸무가 자주 나온 조합&apos;(40%+, 6대리그 1,393건)의
          다음 경기 핸무 비율은 <b>23.62%</b> — 전체 평균 <b>23.56%</b>와 사실상 같습니다
          (상관계수 r=+0.0165, 홈·원정 배치를 맞춰 다시 봐도 r=+0.0151). 특정 두 팀이
          &apos;핸무 잘 나오는 궁합&apos;처럼 보이는 건 조합 수가 수천 개라 우연히 하나쯤
          나오는 것이지, 다음 경기를 미리 알려주는 신호가 아닙니다.
        </p>

        <p className="help-legend-title">정리</p>
        <p className="help-legend-note">
          강추·초강추는 <b>&quot;핸승은 아니다&quot;</b>까지만 말해줍니다. 그 뒤 무·역·핸무 중
          무엇이 나올지, 그리고 핸무(보험)로 끝날지 무·역(적중)으로 끝날지는 이 시스템이
          가르지 못하는 영역입니다 — 조합을 짤 때 이 사실을 감안해서 베팅 비중을
          정하시기 바랍니다.
        </p>
      </div>
    </div>
  )
}
