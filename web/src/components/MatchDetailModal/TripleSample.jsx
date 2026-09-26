import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import RtBadge from '../RtBadge/RtBadge'
import './TripleSample.css'

// 상세보기 '표본' 섹션 — 12개 배당사 섹션 바로 아래(2026-09-26 사용자 지정).
// 12사 평균 승·패 + 국배 승·패가 둘 다 비슷한 과거 경기를 결과(핸승·핸무·무·역)별 4칸으로 보여준다.
//   위   = 같은 리그 / 아래 = 통합(다른 리그만). 폭은 둘 다 ±0칸(완전 일치)에서 시작해 0건이면 1건 나올 때까지 1칸씩 넓히고, 제목에 쓴 폭(±N칸)을 적는다. 계산·기준은 서버 api/triple_sample.py.
// 카드 = 경기일 · 팀 이름(스코어) · 12사 평균 · 국배 · 국핸디.
//   이번 경기와 국배·국핸디가 '같은 값'이면 노랑 배경, 1~2칸 차이면 글자색만(배지처럼 안 보이게),
//   12사 평균이 같은 값이면 파랑 밑줄.
// 설명(어떻게 산출했나)은 제목 옆 ? 도움말에 있다 — 화면에는 부제를 두지 않는다.

const RT_LABEL = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }

// 국내 배당 호가 단위(한 칸) — 2026-09-26 과거 자료로 확인: 2.5 미만 0.01 · 2.5~5 0.05 · 5 이상 0.10
// (무는 늘 2.5 이상이라 0.05부터). 글자 강조는 같은 값이 아니면서 이 단위로 2칸 이내일 때.
const NEAR_TICKS = 2
function tickOf(v) {
  return v < 2.5 ? 0.01 : v < 5 ? 0.05 : 0.10
}
function ticksApart(v, ref) {
  if (v === null || v === undefined || ref === null || ref === undefined) return null
  return Math.round(Math.abs(v - ref) * 100) / Math.round(tickOf(Math.min(v, ref)) * 100)
}
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))
const khText = (v) => (v === null || v === undefined ? '' : `${v > 0 ? '+' : ''}${v}`)

// 아주 비슷한 값(밑줄) — 폭을 넓혀 찾은 표본은 값이 멀어지니 그중에서도 특히 가까운 값을 따로 표시한다.
// 쓴 폭 1~4칸이면 1칸 이내, 5칸 이상이면 2칸 이내(2026-09-26 사용자 지정). 완전 일치(0칸)는 비슷한 값이 없다.
// 칸 = 12사 평균은 0.01, 국배·국핸디는 국내 호가 단위.
function closeLimit(tol) {
  const k = Math.round(tol * 100)
  return k >= 5 ? 2 : k >= 1 ? 1 : 0
}
function isClose(v, base, tol, useTick) {
  const lim = closeLimit(tol)
  if (!lim) return false
  const t = useTick ? ticksApart(v, base) : Math.round(Math.abs(v - base) * 100)
  return t !== null && t <= lim
}

// 값 하나의 상태 — 같은 값(same) / 비슷한 값(near) / 그 밖(null).
//   비슷한 값 = 같은 값이 아니면서 ① 이 영역의 허용 폭 안(같은 리그 ±0.03 · 통합 ±0.02)이거나
//              ② (국배·국핸디만) 국내 호가 단위로 1~2칸 차이.
//   12사 평균은 계산으로 나오는 값이라 호가 단위가 없어 ①만 쓴다.
function stateOf(v, base, tol, useTick) {
  if (v === null || v === undefined || base === null || base === undefined) return null
  const d = Math.round(Math.abs(v - base) * 100)
  if (d === 0) return 'same'
  if (d <= Math.round(tol * 100)) return 'near'
  if (useTick) {
    const t = ticksApart(v, base)
    if (t !== null && t <= NEAR_TICKS) return 'near'
  }
  return null
}

// 국배·국핸디 한 칸 — 같은 값 노랑 배경 / 비슷한 값 글자색만
function OddsCell({ v, base, tol }) {
  if (v === null || v === undefined) return <>-</>
  const st = stateOf(v, base, tol, true)
  if (st === 'same') return <span className="ts-same">{f2(v)}</span>
  if (st === 'near') return <span className={`ts-near${isClose(v, base, tol, true) ? ' ts-close' : ''}`} title={`이번 경기 ${f2(base)}와 비슷한 값(${f2(Math.abs(v - base))} 차이)${isClose(v, base, tol, true) ? ' — 특히 가까움' : ''}`}>{f2(v)}</span>
  return <>{f2(v)}</>
}

// 12사 평균 한 칸 — 같은 값 파랑 밑줄 / 비슷한 값 글자색만
function AvgCell({ v, base, tol }) {
  const st = stateOf(v, base, tol, false)
  if (st === 'same') return <span className="ts-a-same">{f2(v)}</span>
  if (st === 'near') return <span className={`ts-near${isClose(v, base, tol, false) ? ' ts-close' : ''}`} title={`이번 경기 12사 평균 ${f2(base)}와 비슷한 값(${f2(Math.abs(v - base))} 차이)${isClose(v, base, tol, false) ? ' — 특히 가까움' : ''}`}>{f2(v)}</span>
  return <>{f2(v)}</>
}

// 무 값이 이번 경기와 많이 다른 표본 표시(2026-09-26 사용자 지정) — 0.20 이상 주황 / 0.30 이상 빨강(글자색만, 차이값 기준).
// 12사 평균 무·국배 무에만 건다. 무 차이가 결과 일치율과 관계 있다는 실측은 없어서(103,001장, 차이별 일치율 26% 안팎) 신뢰도 점수가 아니라
// '이 표본은 무가 많이 다르다'는 눈 표시다.
const DRAW_WARN = 20
const DRAW_BAD = 30
function drawGap(v, base) {
  if (v === null || v === undefined || base === null || base === undefined) return null
  const d = Math.round(Math.abs(v - base) * 100)
  return d >= DRAW_BAD ? 'bad' : d >= DRAW_WARN ? 'warn' : null
}
function DrawMark({ v, base, children }) {
  const g = drawGap(v, base)
  if (!g) return children
  return (
    <span className={g === 'bad' ? 'ts-draw-bad' : 'ts-draw-warn'} title={`이번 경기 무 ${f2(base)}와 ${f2(Math.abs(v - base))} 차이 — ${g === 'bad' ? '0.30 이상(빨강)' : '0.20 이상(주황)'}`}>
      {children}
    </span>
  )
}

// 카드 하나의 고유키 — 신뢰 체크를 기억할 때 쓴다(같은 경기는 기본/넓힘 탭이 달라도 같은 카드).
const cardKey = (c) => `${c.lg}|${c.S}|${c.R}|${c.ht}|${c.at}`

function Card({ c, game, tol, trusted, onTrust, teams }) {
  const sameH = c.kh !== null && game.kh !== null && c.kh === game.kh
  const hRef = [game.khw, game.khd, game.khl]
  const hVals = [c.khw, c.khd, c.khl]
  return (
    <div className={`ts-card${c.prev ? ' ts-prev' : ''}${trusted ? ' ts-trust' : ''}`} title={c.prev ? '더 좁은 폭(앞 탭)의 표본에도 있던 경기' : undefined}>
      <div className="ts-card-top">
        <b className={Number(c.dt.slice(0, 4)) >= 2020 ? 'ts-date-new' : undefined} title={Number(c.dt.slice(0, 4)) >= 2020 ? '2020년 이후 경기' : undefined}>{c.dt.slice(2)}</b>
        <label className="ts-trust-lab" title="이 표본을 신뢰하면 체크">
          <input type="checkbox" checked={!!trusted} onChange={() => onTrust(cardKey(c))} />
          신뢰
        </label>
        <span>{c.lg} · {c.S} · {/R$/.test(c.R) ? c.R : `${c.R}R`}</span>
      </div>
      <div className="ts-card-teams">
        <span className={teams.has(String(c.ht).trim()) ? 'ts-team-hit' : undefined} title={teams.has(String(c.ht).trim()) ? '이번 경기에 나오는 팀' : undefined}>{c.ht}</span>
        <span className="ts-score">
          <b className={c.hs > c.as_ ? 'ts-win' : undefined}>{c.hs ?? '-'}</b> : <b className={c.as_ > c.hs ? 'ts-win' : undefined}>{c.as_ ?? '-'}</b>
        </span>
        <span className={teams.has(String(c.at).trim()) ? 'ts-team-hit' : undefined} title={teams.has(String(c.at).trim()) ? '이번 경기에 나오는 팀' : undefined}>{c.at}</span>
      </div>
      <table className="ts-card-table">
        <tbody>
          <tr>
            <td>평균</td>
            {c.A.map((v, i) => <td key={i}>{i === 1 ? <DrawMark v={v} base={game.A[i]}><AvgCell v={v} base={game.A[i]} tol={tol} /></DrawMark> : <AvgCell v={v} base={game.A[i]} tol={tol} />}</td>)}
          </tr>
          <tr>
            <td>국배</td>
            {c.K.map((v, i) => <td key={i}>{i === 1 ? <DrawMark v={v} base={game.K[i]}><OddsCell v={v} base={game.K[i]} tol={tol} /></DrawMark> : <OddsCell v={v} base={game.K[i]} tol={tol} />}</td>)}
          </tr>
          <tr title={c.khw === null ? '핸디 배당이 없는 경기입니다(20-21 시즌 이전 경기는 없는 경우가 많습니다)' : undefined}>
            <td>핸디 {khText(c.kh)}</td>
            {hVals.map((v, i) => <td key={i}><OddsCell v={v} base={sameH ? hRef[i] : null} tol={tol} /></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// 결과별 건수 — (핸승/핸무/무/역) 순서
const cntText = (a) => `(${a.cnt.join('/')})`
// 이 탭 표본 중 내가 '신뢰'로 체크한 카드 수 — 체크한 게 있을 때만 (신뢰ㆍN건)을 붙인다.
const trustText = (a, trusted) => {
  const n = Object.values(a.cards).reduce((sum, list) => sum + list.filter((c) => trusted.has(cardKey(c))).length, 0)
  return n ? ` (신뢰ㆍ${n}건)` : ''
}

function Band({ title, area: base, game, tol: baseTol, trusted, onTrust, noteSlot, teams }) {
  // 표본 탭(2026-09-26) — 쓴 폭 표본과, 표본이 실제로 늘어나는 더 넓은 폭 표본을 탭으로 나란히 둔다.
  const [wide, setWide] = useState(false)
  const nx = base.next
  const on = wide && !!nx
  const area = on ? nx.area : base
  const tol = on ? nx.tol : baseTol
  const kb = Math.round(baseTol * 100)
  return (
    <div className="ts-band">
      <div className="ts-band-head">
        <span>{title}</span>
        {nx ? (
          <span className="ts-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={!on} className={`ts-tab${on ? '' : ' is-on'}`} onClick={() => setWide(false)}>
              ±{kb}칸 · 표본 {base.n}건 {cntText(base)}{trustText(base, trusted)}
            </button>
            <button type="button" role="tab" aria-selected={on} className={`ts-tab${on ? ' is-on' : ''}`} onClick={() => setWide(true)}
              title="표본이 더 늘어나는 폭까지 넓힌 표본">
              ±{Math.round(nx.tol * 100)}칸 · 표본 {nx.area.n}건 {cntText(nx.area)}{trustText(nx.area, trusted)}
            </button>
          </span>
        ) : (
          <small>±{kb}칸 · 표본 {base.n}건 {cntText(base)}{trustText(base, trusted)}</small>
        )}
        {noteSlot}
      </div>
      <div className="ts-cols">
        {[1, 2, 3, 4].map((k) => {
          const cards = area.cards[String(k)] || []
          return (
            <div className="ts-col" key={k}>
              <div className="ts-col-head">
                <RtBadge label={RT_LABEL[k]} />
                <span>{area.cnt[k - 1]}건{area.cnt[k - 1] > cards.length ? ` 중 ${cards.length}` : ''}</span>
              </div>
              <div className="ts-cards">
                {cards.length ? cards.map((c, i) => <Card key={i} c={c} game={game} tol={tol} trusted={trusted.has(cardKey(c))} onTrust={onTrust} teams={teams} />) : <div className="ts-empty">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// noteSlot — 제목 옆 의견 입력칸(상위에서 SampleNoteInput을 만들어 넘긴다: 다른 섹션 메모와 같은 저장 경로)
export default function TripleSampleSection({ code, scope, row, noteSlot, sameNoteSlot, otherNoteSlot }) {
  const [data, setData] = useState(undefined)   // undefined 불러오는 중 · null 실패
  const [help, setHelp] = useState(false)
  // 신뢰 체크 — 이 경기에서 내가 믿는 표본 카드들. 브라우저(localStorage)에 경기별로 기억한다(다른 기기·브라우저와는 공유 안 됨).
  const trustKey = `ts-trust:${code}|${scope}|${row.S}|${row.R}|${row.HT}|${row.AT}`
  const [trusted, setTrusted] = useState(() => new Set())
  // 이번 경기의 두 팀 — 표본 카드에 같은 팀이 나오면 팀명을 하이라이트한다(홈·원정 위치는 상관없이).
  const teams = new Set([String(row.HT || '').trim(), String(row.AT || '').trim()])
  useEffect(() => {
    try {
      setTrusted(new Set(JSON.parse(localStorage.getItem(trustKey) || '[]')))
    } catch { setTrusted(new Set()) }
  }, [trustKey])
  const toggleTrust = (ck) => {
    setTrusted((prev) => {
      const next = new Set(prev)
      if (next.has(ck)) next.delete(ck)
      else next.add(ck)
      try {
        if (next.size) localStorage.setItem(trustKey, JSON.stringify([...next]))
        else localStorage.removeItem(trustKey)
      } catch { /* 저장 불가 환경 — 이번 화면에서만 유지 */ }
      return next
    })
  }
  const key = `${code}|${scope}|${row.S}|${row.R}|${row.HT}|${row.AT}`
  useEffect(() => {
    let alive = true
    setData(undefined)
    const params = new URLSearchParams({ code, scope, S: String(row.S ?? ''), R: String(row.R ?? ''), HT: String(row.HT ?? ''), AT: String(row.AT ?? '') })
    api.get(`/api/triple_sample?${params.toString()}`)
      .then((res) => alive && setData(res))
      .catch(() => alive && setData(null))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (scope !== 'master') return null          // 12사 배당은 공식 6대리그에만 있다
  return (
    <section className="detail-section">
      <h3>
        <button type="button" className="help-btn" onClick={() => setHelp(true)} title="표본을 어떻게 산출했는지 보기">
          표본 <span className="help-mark">?</span>
        </button>
        {noteSlot}
      </h3>
      {data === undefined && <div className="ts-msg">불러오는 중…</div>}
      {data === null && <div className="ts-msg">표본을 불러오지 못했습니다</div>}
      {data && !data.ready && <div className="ts-msg">{data.reason || '표본을 만들 수 없습니다'}</div>}
      {data && data.ready && (
        <>
          <div className="ts-ref">
            <b>이번 경기</b>
            <span>12사 평균 <span className="ts-nums">{data.game.A.map((v, i) => <span key={i} className={i === 1 ? '' : 'ts-a-same'}>{f2(v)}</span>)}</span></span>
            <span>국배 <span className="ts-nums">{data.game.K.map((v, i) => <span key={i} className="ts-same">{f2(v)}</span>)}</span></span>
            <span>국핸디 ({khText(data.game.kh) || '-'}) <span className="ts-nums">{[data.game.khw, data.game.khd, data.game.khl].map((v, i) => <span key={i} className="ts-same">{f2(v)}</span>)}</span></span>
          </div>
          <Band title={`같은 리그 (${data.game.lg})`} area={data.same} game={data.game} tol={data.tol.same} trusted={trusted} onTrust={toggleTrust} noteSlot={sameNoteSlot} teams={teams} />
          <Band title="통합 (다른 리그)" area={data.other} game={data.game} tol={data.tol.other} trusted={trusted} onTrust={toggleTrust} noteSlot={otherNoteSlot} teams={teams} />
        </>
      )}
      {help && <TripleSampleLegend onClose={() => setHelp(false)} />}
    </section>
  )
}

// 표본 도움말 — 산출 방법·읽는 법. 새 용어(칸·호가 단위)는 쓰기 전에 뜻을 풀었다.
function TripleSampleLegend({ onClose }) {
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
        <h2 className="modal-title">🧩 표본 — 어떻게 산출했나</h2>

        <p className="help-legend-title">① 무엇을 보여주나</p>
        <p className="help-legend-note">
          이 경기와 <b>배당 모양이 비슷했던 과거 경기</b>를 찾아 결과(핸승·핸무·무·역)별로 나눠 보여줍니다.
          기준은 <b>12개 배당사 평균의 승·패</b>와 <b>국내 배당(국배)의 승·패</b> 두 가지이고, <b>넷이 모두</b> 폭 안에
          들어와야 합니다(승과 패 둘 다). <b>무는 조건이 아니라 참고</b>로 카드에만 보여줍니다.
        </p>

        <p className="help-legend-title">② 같은 리그 · 통합은 어떻게 나누나</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>영역</th><th>어디서 찾나</th><th>허용 폭</th></tr>
          </thead>
          <tbody>
            <tr><td><b>같은 리그</b> (위)</td><td>이 경기와 같은 리그의 과거 경기</td><td>±0칸부터, 0건이면 1칸씩 넓힘</td></tr>
            <tr><td><b>통합</b> (아래)</td><td>6대리그 전체 중 <b>다른 리그</b> 경기 — 같은 리그 경기는 위에 이미 나오므로 뺍니다</td><td>±0칸부터, 0건이면 1칸씩 넓힘</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>칸</b> = 소수 둘째 자리 한 눈금(0.01)입니다. 예를 들어 12사 평균 승이 2.55이고 폭이 ±2칸이면 2.53~2.57까지 봅니다. 승·패 네 값이 <b>모두</b> 폭 안이어야 표본이 됩니다.
          폭은 같은 리그·통합 모두 <b>완전 일치(±0칸)</b>에서 시작하고, 표본이 0건이면 <b>1건이 나올 때까지 1칸씩 넓혀</b>(최대 ±15칸) 찾습니다. 제목에 실제로 쓴 폭을 <b>±5칸</b>처럼 적으니, 숫자가 작을수록 배당이 더 비슷한 표본입니다. 폭을 넓혀 표본이 1건뿐이면 근거가 약해서, 표본이 늘어나는 더 넓은 폭을 <b>탭</b>으로 나란히 두었습니다(탭을 누르면 그 표본으로 바뀝니다). 넓은 폭 탭에는 좁은 폭 표본도 함께 들어 있어서, 그 경기들은 카드에 <b>파란 테두리</b>를 둘러 구분합니다(나머지가 새로 더해진 경기). 끝까지 없으면 비어 있습니다.
        </p>

        <p className="help-legend-title">③ 12사 평균 · 국배는 어떤 값인가</p>
        <p className="help-legend-note">
          <b>12사 평균</b> = 스코어맨 12개 배당사의 <b>초기 배당</b> 평균(6곳 이상이 낸 경기만)을 소수 둘째 자리로
          반올림한 값으로, 위 12개 배당사 표의 &quot;12사 평균 초기&quot; 칸과 같습니다. <b>국배</b> = 국내 초기 배당입니다.
          국배는 12사 평균보다 보통 5~8% 낮게 매겨지고 경기마다 ±5% 안팎 흔들립니다(국내 마진과 자체 호가).
        </p>

        <p className="help-legend-title">④ 시점과 정렬</p>
        <p className="help-legend-note">
          이 경기 날짜 <b>이전</b>에 끝난 경기만 씁니다(같은 날 경기는 서로 세지 않습니다). 카드는 결과별 칸 안에서
          승·패 차이(12사+국배)가 작은 순 → 무 차이가 작은 순 → 최근 순이고, 칸마다 최대 12장까지 보입니다.
          표본 개수는 칸 제목 옆(예: <b>3건 중 12</b>)에 적힙니다. 제목 줄의 <b>표본 9건 (3/1/6/4)</b>에서 괄호 안 숫자는 <b>핸승/핸무/무/역</b> 순서의 결과별 건수입니다.
        </p>

        <p className="help-legend-title">⑤ 카드 읽는 법</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>표시</th><th>뜻</th></tr>
          </thead>
          <tbody>
            <tr><td><span className="ts-same">2.50</span></td><td>이번 경기와 <b>같은 값</b> (국배·국핸디, 노랑 배경)</td></tr>
            <tr><td><span className="ts-a-same">2.55</span></td><td>12사 평균이 이번 경기와 <b>같은 값</b> (파랑 밑줄)</td></tr>
            <tr><td><span className="ts-near">2.26</span></td><td><b>비슷한 값</b> (12사 평균·국배·국핸디 공통, 글자색만) — 같은 값은 아니면서 <b>그 영역의 허용 폭 안</b>(같은 리그 ±0.03, 통합 ±0.02)입니다. 국배·국핸디는 여기에 더해 <b>국내 호가 단위로 1~2칸 차이</b>인 값도 포함합니다(호가 단위: 2.5 미만 0.01 · 2.5~5 0.05 · 5 이상 0.10, 무는 0.05). 12사 평균 승·패는 검색 조건 자체가 폭 안이라 같은 값이 아니면 대부분 이 색이 됩니다 — 차이를 보려면 무 칸과 국배를 함께 보세요</td></tr>
            <tr><td><span className="ts-near ts-close">1.81</span></td><td><b>아주 가까운 값</b> (비슷한 값 중에서 밑줄) — 표본을 찾느라 폭이 <b>1~4칸</b>이면 이번 경기와 <b>1칸 이내</b>, <b>5칸 이상</b>이면 <b>2칸 이내</b>인 값입니다. 예: 이번 경기 12사 평균 패가 1.80이고 폭 5칸으로 찾은 표본이 1.81이면 1칸 차이라 거의 같은 값이니 밑줄을 긋습니다. 칸은 12사 평균이 0.01, 국배·국핸디는 국내 호가 단위입니다. 밑줄은 두 탭 모두, 같은 리그·통합 모두에 똑같이 적용됩니다.</td></tr>
            <tr><td><b className="ts-date-new">24-09-14</b></td><td>카드 날짜가 <b>2020년 이후</b> 경기면 날짜 색이 다릅니다(최근 경기 구분용).</td></tr>
            <tr><td><span className="ts-team-hit">첼시</span></td><td>카드의 팀이 <b>이번 경기에 나오는 팀</b>과 같으면 팀명 글자색이 노랑으로 바뀌고 굵어집니다(홈·원정 자리는 상관없음).</td></tr>
            <tr><td>☑ 신뢰</td><td>카드 날짜 옆 체크박스 — <b>이 표본은 믿는다</b>고 표시하면 <b>신뢰</b> 글자가 초록 굵은 글씨로 바뀌고, 위쪽 탭 제목의 표본 건수 옆에 <b>(신뢰ㆍ1건)</b>처럼 체크한 카드 수가 붙습니다(체크한 게 없으면 안 붙습니다). 경기별로 이 브라우저에 기억됩니다(다른 기기와는 공유되지 않습니다).</td></tr>
            <tr><td><span className="ts-draw-warn">3.61</span> / <span className="ts-draw-bad">3.48</span></td><td><b>무 값이 많이 다른 표본</b> (12사 평균 무·국배 무의 글자색) — 이번 경기 무와의 차이가 <b>0.20 이상이면 주황, 0.30 이상이면 빨강</b>입니다. 예: 이번 경기 무가 3.82이면 3.61(0.21 차이)은 주황, 3.48(0.34 차이)은 빨강. 승·패가 폭 안에 들어와도 무가 이만큼 다르면 배당 모양이 다른 경기라는 눈 표시입니다. 무 차이가 클수록 결과가 덜 맞는다는 실측은 없어서(카드 103,001장, 차이별 결과 일치율 26% 안팎으로 비슷) 점수가 아니라 참고 표시입니다.</td></tr>
            <tr><td>핸디 +1</td><td>국내 핸디 배당(홈팀 기준선 ±1). 기준선이 같을 때만 같은 값·차이를 표시합니다. 핸디 배당은 20-21 시즌부터 거의 전 경기에 있고 그 이전은 없는 경우가 많아 <b>-</b>로 보입니다</td></tr>
          </tbody>
        </table>

        <p className="help-legend-title">⑥ 주의 — 참고용입니다</p>
        <p className="help-legend-note">
          과거 26,483경기로 재 보니 표본이 나오는 경기는 <b>같은 리그 18.8% · 다른 리그 22.5%</b>(둘 중 하나라도 33.7%)였고,
          표본이 가리키는 다수 방향(정/플)이 실제와 같았던 비율은 <b>51~53%로 우연 수준</b>이었습니다.
          그래서 이 표본은 결과를 예측하는 근거가 아니라 <b>비슷한 배당의 과거 경기를 눈으로 보는 용도</b>입니다.
          표본이 없으면 칸이 <b>—</b>로 비어 있습니다.
        </p>
      </div>
    </div>
  )
}
