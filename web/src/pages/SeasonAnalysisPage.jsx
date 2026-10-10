import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { RichMemoInput } from '../components/RichMemo/RichMemo'
import CupCollectButton from '../components/CupCollectButton/CupCollectButton'
import RoundMiss from '../components/RoundMiss/RoundMiss'
import { useAuth } from '../context/AuthContext'
import './SeasonAnalysisPage.css'

// 시즌분석 — 6대리그 라운드를 프로토 회차에 놓은 시즌 표 + 회차별 '주간 라운드 지표'
// (2026-09-24 사용자 지정: 엑셀 '통합 문서1' 표와 '주간라운드 지표' 이미지를 한 화면에).
// 계산은 전부 서버(api/season_view.py) — 라운드 배치·연기 판정·요일(현지 경기일) 규칙도 거기.
// 칸의 (정/플) = 핸승+핸무 / 무+역. 연기 경기가 있는 라운드는 주황 테두리.

const WD_ORDER = ['금', '토', '일', '월', '화', '수', '목']
const RT_TEXT = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }
const RT_CLS = ['blue', 'green', 'gray', 'red']

const md = (s) => {
  const [, m, d] = String(s).split('-')
  return `${Number(m)}/${Number(d)}`
}
const dd2 = (s) => String(s).split('-')[2]

function cellOf(data, col, lg) {
  const r = col.rounds[lg]
  if (r === undefined) return null
  const x = data.res[`${lg}|${r}`] || { c: [0, 0, 0, 0], n: 0, done: 0 }
  return { r, j: x.c[0] + x.c[1], p: x.c[2] + x.c[3], done: x.done, n: x.n }
}

function jpCls(j, p) {
  return j > p ? 'jung' : p > j ? 'pl' : 'even'
}

function SeasonTable({ data, sel, onSelect, seasons, season, onSeason, headerExtra }) {
  const { cols, leagues } = data
  const months = useMemo(() => {
    const out = []
    cols.forEach((c) => {
      const m = Number(String(c.from).split('-')[1])
      if (out.length && out[out.length - 1].m === m) out[out.length - 1].n += 1
      else out.push({ m, n: 1 })
    })
    return out
  }, [cols])
  const tot = cols.map(() => ({ j: 0, p: 0 }))
  let tj = 0
  let tp = 0
  const selCls = (i) => (i === sel ? ' sel' : '')

  const rows = leagues.map((L) => {
    let sj = 0
    let sp = 0
    const cells = cols.map((c, i) => {
      if (c.type === '휴식기') return <td key={i} className={`t-rest${selCls(i)}`}>·</td>
      const x = cellOf(data, c, L.code)
      if (!x) return <td key={i} className={selCls(i).trim() || undefined} />
      sj += x.j
      sp += x.p
      tot[i].j += x.j
      tot[i].p += x.p
      const mv = data.moved[`${L.code}|${x.r}`]
      const late = mv?.late || []
      const early = mv?.early || []
      const tip = `${L.label} ${x.r}R · 결과 ${x.done}/${x.n}경기`
        + (late.length ? `\n연기: ${late.map((g) => `${md(g.d)} ${g.ht}-${g.at}`).join(', ')}` : '')
        + (early.length ? `\n앞당김: ${early.map((g) => `${md(g.d)} ${g.ht}-${g.at}`).join(', ')}` : '')
      const cls = x.done === 0 ? 'future' : jpCls(x.j, x.p)
      return (
        <td key={i} className={`cell ${cls}${late.length ? ' moved-late' : ''}${selCls(i)}`} title={tip}>
          <b>{x.r}R</b>
          <span>{x.done === 0 ? '예정' : `${x.j}/${x.p}`}</span>
        </td>
      )
    })
    const pct = sj + sp ? (sj / (sj + sp)) * 100 : null
    return (
      <tr key={L.code}>
        <td className="lg">{L.label}</td>
        {/* 시즌 누계를 리그 칸 오른쪽으로(2026-09-29 사용자 지정) — 예전엔 표 맨 끝(오른쪽 끝)이었다. */}
        <td className="sum-col">
          {/* 2줄로(2026-09-29 사용자 지정 — "22/28 (44.0%) 이렇게 2줄로") */}
          <span className={pct === null ? 'gray' : pct > 50 ? 'blue' : pct < 50 ? 'red' : 'gray'}>
            {sj} / {sp}<br />{pct === null ? '' : `(${pct.toFixed(1)}%)`}
          </span>
        </td>
        {cells}
      </tr>
    )
  })
  const totalCells = cols.map((c, i) => {
    if (c.type === '휴식기') return <td key={i} className={`t-rest${selCls(i)}`}>휴식</td>
    const { j, p } = tot[i]
    tj += j
    tp += p
    if (!j && !p) return <td key={i} className={selCls(i).trim() || undefined}><span className="gray">-</span></td>
    return <td key={i} className={`cell ${jpCls(j, p)}${selCls(i)}`}><span>{j}/{p}</span></td>
  })
  const tpct = tj + tp ? (tj / (tj + tp)) * 100 : null

  return (
    <section className="sa-section">
      <h2>
        <select className="sa-season" value={season} onChange={(e) => onSeason(e.target.value)} title="지난 시즌도 볼 수 있습니다">
          {seasons.map((s) => <option key={s} value={s}>{s} 시즌</option>)}
        </select>
        전체 스케줄
        {/* 설명글 삭제, 그 자리(전체 스케줄 옆, 한 줄)에 범례를 대신(2026-09-29 사용자 지정 —
            "삭제하고... 이 내용이 삭제된 데에 표기되도록 해줘" · "한줄로 해줘야지" ·
            "전체스케줄 옆에 위치") — 예전엔 표 아래 별도 줄(.sa-legend)이었다. */}
        <span className="sa-legend">
          <span><i className="sw sw-jung" />정(핸승+핸무)이 더 많음</span>
          <span><i className="sw sw-pl" />플(무+역)이 더 많음</span>
          <span><i className="sw sw-even" />같음</span>
          <span className="mid">평일 = 수~목 주중 라운드</span>
          <span>빗금 = 휴식기(A매치)</span>
          <span>흐린 글씨 = 아직 경기 전</span>
          <span><i className="sw sw-moved" />연기 경기가 있는 라운드(마우스를 올리면 경기·날짜)</span>
          <span>예정 = 확정 시각 전(수~목 기간으로 표시)</span>
        </span>
        {headerExtra}
      </h2>
      <div className="sa-scroll">
        <table className="sa-season-table">
          <thead>
            <tr>
              <th className="lg" rowSpan={3}>리그</th>
              {/* 시즌 누계를 리그 칸 오른쪽으로(2026-09-29 사용자 지정) — 예전엔 표 맨 끝이었다. */}
              <th className="sum-col" rowSpan={3}>시즌 누계<small>정 / 플 (정%)</small></th>
              {months.map((m, i) => <th key={i} className="mon" colSpan={m.n}>{m.m}월</th>)}
            </tr>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className={`wk t-${c.type === '평일' ? 'mid' : c.type === '휴식기' ? 'rest' : 'wkend'}${selCls(i)}`}
                  onClick={() => c.type !== '휴식기' && onSelect(i)}>{c.label}</th>
              ))}
            </tr>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className={`wk wk-date t-${c.type === '평일' ? 'mid' : c.type === '휴식기' ? 'rest' : 'wkend'}${selCls(i)}`}
                  onClick={() => c.type !== '휴식기' && onSelect(i)}
                  title={c.est ? '아직 확정 시각이 안 올라온 라운드(경기가 전부 같은 시각으로 들어 있음) — 평일 회차 기준 기간(한국 시간 수~목)으로 표시합니다. [일정 최신화]로 확정 시각이 들어오면 실제 날짜로 바뀝니다.' : undefined}>
                  {dd2(c.from)}~{dd2(c.to)}{c.est && <small className="sa-est">예정</small>}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows}
            <tr className="total">
              <td className="lg">합계</td>
              <td className="sum-col">
                <span className={tpct === null ? 'gray' : tpct > 50 ? 'blue' : 'red'}>
                  {tj} / {tp}<br />{tpct === null ? '' : `(${tpct.toFixed(1)}%)`}
                </span>
              </td>
              {totalCells}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

// 한 줄로(2026-09-29 사용자 지정 — "이번 회차 메모를 주간라운드 지표 바로 위로 위치해줘 ·
// 한줄로 해줘") — 제목과 입력칸을 같은 줄에 두는 앱 전체 메모 칸 관례(RichMemoInput)를 그대로 쓴다.
function WeekMemo({ season, wk, value, onSaved }) {
  const [state, setState] = useState('')
  async function save(text) {
    if ((text || '') === (value || '')) return
    setState('저장 중…')
    try {
      await api.post('/api/season_notes', { season, wk, memo: text })
      onSaved(wk, text)
      setState('저장됨')
    } catch (e) {
      setState(`저장 실패 — ${e.message}`)
    }
  }
  return (
    <div className="sa-card">
      <h3>
        이번 회차 메모
        <RichMemoInput
          className="sa-memo"
          value={value || ''}
          placeholder="예) 휴식기 이전 금·토·일 전부 역배가 많이 나온 3일 연속 / 플핸데이"
          onCommit={save}
        />
        <span className="note">{state}</span>
      </h3>
    </div>
  )
}

function WeekPanel({ data, col, season, note, onNoteSaved }) {
  const gl = []
  data.leagues.forEach((L) => {
    const r = col.rounds[L.code]
    if (r === undefined) return
    ;(data.games[`${L.code}|${r}`] || []).forEach((g) => gl.push({ ...g, lg: L.code, r }))
  })
  const done = gl.filter((g) => g.rt)
  const j = done.filter((g) => g.rt <= 2).length
  const p = done.length - j
  const days = WD_ORDER.filter((w) => gl.some((g) => g.wd === w))
  const lgCount = (w, lg) => gl.filter((g) => g.wd === w && g.lg === lg).length

  const dd = gl.filter((g) => g.favOdds !== null && g.favOdds <= data.ddongMax).sort((a, b) => a.favOdds - b.favOdds)
  dd.forEach((g, i) => { g.rank = i + 1 })
  const ddDays = WD_ORDER.filter((w) => dd.some((g) => g.wd === w))
  const labelOf = Object.fromEntries(data.leagues.map((L) => [L.code, L.label]))

  const moved = []
  data.leagues.forEach((L) => {
    const r = col.rounds[L.code]
    const mv = r === undefined ? null : data.moved[`${L.code}|${r}`]
    if (!mv) return
    mv.late.forEach((g) => moved.push({ kind: '연기', lg: L.label, r, ...g }))
    mv.early.forEach((g) => moved.push({ kind: '앞당김', lg: L.label, r, ...g }))
  })

  return (
    <section className="sa-section">
      {/* 주간 라운드 지표 바로 위로(2026-09-29 사용자 지정 — "이번 회차 메모를 주간라운드
          지표 바로 위로 위치해줘") — 예전엔 이 섹션 맨 아래에 있었다. */}
      <WeekMemo key={`${season}:${col.key}`} season={season} wk={col.key} value={note} onSaved={onNoteSaved} />
      {/* 정/플 요약 칩을 제목 줄에(2026-09-29 사용자 지정 — "정25 플32 플핸회차 이거 한줄로") —
          예전엔 h2 아래 별도 줄(.sa-kpi)이었다. */}
      <h2>
        주간 라운드 지표 — {col.label}
        <span className="note">{md(col.from)} ~ {md(col.to)} · {gl.length}경기 (결과 {done.length})</span>
        {done.length ? (
          <>
            <span className="chip blue">정 {j}</span>
            <span className="chip red">플 {p}</span>
            <span className={`chip ${j > p ? 'blue' : p > j ? 'red' : 'gray'}`}>{j > p ? '정배 회차' : p > j ? '플핸 회차' : '반반'}</span>
          </>
        ) : <span className="chip gray">아직 경기 전 — 일정만 표시</span>}
      </h2>

      <div className="sa-grid2">
        <div className="sa-card">
          <h3>요일 × 리그 경기 수 <span className="note">요일은 현지 경기일</span></h3>
          <table className="sa-table sa-fixed">
            <thead><tr><th>요일</th>{data.leagues.map((L) => <th key={L.code}>{L.label}</th>)}<th>합계</th></tr></thead>
            <tbody>
              {days.map((w) => {
                const cnt = data.leagues.map((L) => lgCount(w, L.code))
                return (
                  <tr key={w}>
                    <td className={w === '토' ? 'blue' : w === '일' ? 'red' : ''}>{w}요일</td>
                    {cnt.map((n, i) => <td key={i}>{n || ''}</td>)}
                    <td><b>{cnt.reduce((a, b) => a + b, 0)}</b></td>
                  </tr>
                )
              })}
              <tr className="total">
                <td>합계</td>
                {data.leagues.map((L) => <td key={L.code}><b>{gl.filter((g) => g.lg === L.code).length || ''}</b></td>)}
                <td><b>{gl.length}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="sa-card">
          <h3>요일 × 결과 <span className="note">플이 더 많은 날 = 플핸데이</span></h3>
          <table className="sa-table">
            <thead>
              <tr><th>요일</th><th className="blue">핸승</th><th className="green">핸무</th><th className="gray">무</th><th className="red">역</th><th>합계</th><th>그날</th></tr>
            </thead>
            <tbody>
              {days.map((w) => {
                const c4 = [1, 2, 3, 4].map((v) => done.filter((g) => g.wd === w && g.rt === v).length)
                const dj = c4[0] + c4[1]
                const dp = c4[2] + c4[3]
                return (
                  <tr key={w}>
                    <td>{w}요일</td>
                    {c4.map((v, i) => <td key={i} className={RT_CLS[i]}>{v || ''}</td>)}
                    <td><b>{dj + dp || ''}</b></td>
                    <td>
                      {dj + dp === 0 ? '' : (
                        <span className={`chip ${dp > dj ? 'red' : dj > dp ? 'blue' : 'gray'}`}>
                          {dp > dj ? '플핸데이' : dj > dp ? '정배데이' : '반반'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="total">
                <td>합계</td>
                {[1, 2, 3, 4].map((v, i) => <td key={v} className={RT_CLS[i]}><b>{done.filter((g) => g.rt === v).length}</b></td>)}
                <td><b>{done.length}</b></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="sa-card">
        <h3>똥배 — 요일 × 리그 <span className="note">정배배당 {data.ddongMax} 이하 · 1똥이 가장 낮은 배당 · 테두리 파랑 = 정(핸승·핸무) / 빨강 = 플(무·역)</span></h3>
        {dd.length === 0 ? <p className="note">이 회차에는 똥배 경기가 없습니다</p> : (
          <div className="sa-scroll">
            {/* 리그 칸 폭을 전부 같게(2026-09-24 사용자 지정) — table-layout: fixed + 같은 폭 colgroup */}
            <table className="sa-table sa-ddong">
              <colgroup>
                <col className="c-day" />
                {data.leagues.map((L) => <col key={L.code} className="c-lg" />)}
                <col className="c-sum" />
              </colgroup>
              <thead><tr><th>요일</th>{data.leagues.map((L) => <th key={L.code}>{L.label}</th>)}<th>그날 정 / 플</th></tr></thead>
              <tbody>
                {ddDays.map((w) => {
                  const dayG = dd.filter((g) => g.wd === w)
                  return (
                    <tr key={w}>
                      <td className={w === '토' ? 'blue' : w === '일' ? 'red' : ''}>{w}요일</td>
                      {data.leagues.map((L) => (
                        <td key={L.code} className="dd-cell">
                          {dayG.filter((g) => g.lg === L.code).map((g) => {
                            // 상대팀·점수 추가(2026-09-29 사용자 지정 — "1.27 맨시티 선덜랜드
                            // 점수 핸승 이렇게 변경"). 점수는 정배 기준으로(정배팀:상대팀) 맞춘다.
                            const isFavHome = g.ht === g.fav
                            const opp = isFavHome ? g.at : g.ht
                            const favScore = isFavHome ? g.hs : g.as
                            const oppScore = isFavHome ? g.as : g.hs
                            return (
                              <span key={`${g.ht}-${g.at}`} className={`dd ${g.rt ? (g.rt <= 2 ? 'j' : 'p') : ''}`} title={`${labelOf[g.lg]} ${g.r}R ${g.ht} vs ${g.at}`}>
                                {g.favOdds.toFixed(2)} <b>{g.fav}</b> {opp}
                                {g.hs != null && ` ${favScore}:${oppScore}`}
                                <small className={g.rt ? RT_CLS[g.rt - 1] : 'gray'}>{g.rt ? RT_TEXT[g.rt] : '예정'}</small>
                              </span>
                            )
                          })}
                        </td>
                      ))}
                      <td>
                        <span className="blue">{dayG.filter((g) => g.rt && g.rt <= 2).length}</span>
                        {' / '}
                        <span className="red">{dayG.filter((g) => g.rt && g.rt >= 3).length}</span>
                      </td>
                    </tr>
                  )
                })}
                <tr className="total">
                  <td>합계</td>
                  {data.leagues.map((L) => <td key={L.code}>{dd.filter((g) => g.lg === L.code).length || ''}</td>)}
                  <td>
                    <b className="blue">{dd.filter((g) => g.rt && g.rt <= 2).length}</b>
                    {' / '}
                    <b className="red">{dd.filter((g) => g.rt && g.rt >= 3).length}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {moved.length > 0 && (
        <div className="sa-card">
          <h3>이 회차 라운드 중 다른 주에 치른 경기 <span className="note">결과는 그 라운드 칸(정/플)에 합쳐 셉니다</span></h3>
          <ul className="sa-moved">
            {moved.map((m, i) => (
              <li key={i}>
                <span className={`chip ${m.kind === '연기' ? 'orange' : 'gray'}`}>{m.kind}</span>
                {' '}{m.lg} {m.r}R {m.ht} vs {m.at} → <b>{md(m.d)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// 오늘이 속한 회차 열(2026-10-09 사용자 지정 — "시즌분석은 현재주가 디폴트") — 서버 season_view._week와 같은 규칙:
// 수·목 = 평일 열(그 주 수요일 키) / 금·토·일 = 주말 열(그 주 금요일 키) / 월·화 = 지난 금요일의 주말 열.
// 그 열이 없으면(평일 경기가 없는 주 등) 같은 주 주말 열로, 그래도 없으면 null(옛 기본값 — 결과 있는 마지막 회차).
function currentColIndex(cols) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const shift = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
  const wd = (now.getDay() + 6) % 7                     // 월=0 … 일=6 (서버 weekday와 같다)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const [key, type] = wd === 2 || wd === 3 ? [fmt(shift(today, 2 - wd)), '평일']
    : wd >= 4 ? [fmt(shift(today, 4 - wd)), '주말'] : [fmt(shift(today, -(wd + 3))), '주말']
  let i = cols.findIndex((c) => c.key === key && c.type === type)
  if (i < 0 && type === '평일') {
    const fri = fmt(shift(today, 4 - wd))
    i = cols.findIndex((c) => c.key === fri && c.type === '주말')
  }
  return i >= 0 ? i : null
}

export default function SeasonAnalysisPage() {
  const { user } = useAuth()
  const [season, setSeason] = useState('')
  const [resp, setResp] = useState(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState(null)
  // '일정 최신화'가 끝나면 표를 다시 불러오되, 보던 회차 선택은 그대로 둔다(keepSel — 다음 한 번의 불러오기에서 선택을 안 건드림).
  const [refresh, setRefresh] = useState(0)
  const keepSel = useRef(false)
  const onCollected = useCallback(() => { keepSel.current = true; setRefresh((n) => n + 1) }, [])

  useEffect(() => {
    let alive = true
    setError('')
    api.get(`/api/season_view${season ? `?season=${encodeURIComponent(season)}` : ''}`)
      .then((r) => {
        if (!alive) return
        setResp(r)
        if (!season && r.season) setSeason(r.season)
        // 기본 선택 — 오늘이 속한 현재 주(이 시즌에 그 주가 있을 때), 없으면 결과가 있는 마지막 회차(그것도 없으면 첫 회차)
        const d = r.data
        if (keepSel.current) { keepSel.current = false; return }
        if (!d?.cols?.length) { setSel(null); return }
        const cur = currentColIndex(d.cols)
        if (cur !== null) { setSel(cur); return }
        let last = null
        d.cols.forEach((c, i) => {
          if (c.type === '휴식기') return
          if (d.leagues.some((L) => { const x = cellOf(d, c, L.code); return x && x.done })) last = i
        })
        setSel(last ?? d.cols.findIndex((c) => c.type !== '휴식기'))
      })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [season, refresh])

  const data = resp?.data
  const onNoteSaved = (wk, memo) => {
    setResp((r) => ({ ...r, notes: { ...(r?.notes || {}), [wk]: memo } }))
  }

  if (error) return <div className="sa-page"><p className="sa-error">불러오지 못했습니다 — {error}</p></div>
  if (!data) return <div className="sa-page"><p className="note">불러오는 중…</p></div>
  if (!data.cols.length) return <div className="sa-page"><p className="note">이 시즌에는 경기가 없습니다</p></div>

  return (
    <div className="sa-page">
      <SeasonTable
        data={data}
        sel={sel}
        onSelect={setSel}
        seasons={resp.seasons}
        season={resp.season}
        onSeason={(s) => { keepSel.current = false; setResp(null); setSeason(s) }}
        headerExtra={user?.role === 'admin' ? <CupCollectButton label="일정 최신화" onDone={onCollected} /> : null}
      />
      {sel !== null && data.cols[sel] && (
        <WeekPanel
          data={data}
          col={data.cols[sel]}
          season={resp.season}
          note={resp.notes?.[data.cols[sel].key]}
          onNoteSaved={onNoteSaved}
        />
      )}
      {/* 라운드별 판정 빗나감(2026-10-10 사용자 지정) — 위 회차 표에서 고른 회차의 라운드가 기본 선택 */}
      <RoundMiss season={resp.season} selCol={sel !== null ? data.cols[sel] : null} leagues={data.leagues} />
    </div>
  )
}
