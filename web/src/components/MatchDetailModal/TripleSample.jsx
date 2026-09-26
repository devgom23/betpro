import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import RtBadge from '../RtBadge/RtBadge'
import './TripleSample.css'

// 상세보기 '표본' 섹션 — 12개 배당사 섹션 바로 아래(2026-09-26 사용자 지정).
// 12사 평균 승·패 + 국배 승·패가 둘 다 비슷한 과거 경기를 결과(핸승·핸무·무·역)별 4칸으로 보여준다.
//   위   = 같은 리그 ±3칸 / 아래 = 통합(다른 리그만) ±2칸. 계산·기준은 서버 api/triple_sample.py.
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
  if (st === 'near') return <span className="ts-near" title={`이번 경기 ${f2(base)}와 비슷한 값(${f2(Math.abs(v - base))} 차이)`}>{f2(v)}</span>
  return <>{f2(v)}</>
}

// 12사 평균 한 칸 — 같은 값 파랑 밑줄 / 비슷한 값 글자색만
function AvgCell({ v, base, tol }) {
  const st = stateOf(v, base, tol, false)
  if (st === 'same') return <span className="ts-a-same">{f2(v)}</span>
  if (st === 'near') return <span className="ts-near" title={`이번 경기 12사 평균 ${f2(base)}와 비슷한 값(${f2(Math.abs(v - base))} 차이)`}>{f2(v)}</span>
  return <>{f2(v)}</>
}

function Card({ c, game, tol }) {
  const sameH = c.kh !== null && game.kh !== null && c.kh === game.kh
  const hRef = [game.khw, game.khd, game.khl]
  const hVals = [c.khw, c.khd, c.khl]
  return (
    <div className="ts-card">
      <div className="ts-card-top">
        <b>{c.dt.slice(2)}</b>
        <span>{c.lg} · {c.S} · {/R$/.test(c.R) ? c.R : `${c.R}R`}</span>
      </div>
      <div className="ts-card-teams">
        <span>{c.ht}</span>
        <span className="ts-score">{c.hs ?? '-'} : {c.as_ ?? '-'}</span>
        <span>{c.at}</span>
      </div>
      <table className="ts-card-table">
        <tbody>
          <tr>
            <td>평균</td>
            {c.A.map((v, i) => <td key={i}><AvgCell v={v} base={game.A[i]} tol={tol} /></td>)}
          </tr>
          <tr>
            <td>국배</td>
            {c.K.map((v, i) => <td key={i}><OddsCell v={v} base={game.K[i]} tol={tol} /></td>)}
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

function Band({ title, sub, area, game, tol }) {
  return (
    <div className="ts-band">
      <div className="ts-band-head">
        <span>{title}</span>
        <small>{sub} · 표본 {area.n}건</small>
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
                {cards.length ? cards.map((c, i) => <Card key={i} c={c} game={game} tol={tol} />) : <div className="ts-empty">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// noteSlot — 제목 옆 의견 입력칸(상위에서 SampleNoteInput을 만들어 넘긴다: 다른 섹션 메모와 같은 저장 경로)
export default function TripleSampleSection({ code, scope, row, noteSlot }) {
  const [data, setData] = useState(undefined)   // undefined 불러오는 중 · null 실패
  const [help, setHelp] = useState(false)
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
          <Band title={`같은 리그 (${data.game.lg})`} sub={`±${Math.round(data.tol.same * 100)}칸`} area={data.same} game={data.game} tol={data.tol.same} />
          <Band title="통합 (다른 리그)" sub={`±${Math.round(data.tol.other * 100)}칸`} area={data.other} game={data.game} tol={data.tol.other} />
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
            <tr><td><b>같은 리그</b> (위)</td><td>이 경기와 같은 리그의 과거 경기</td><td>±3칸 (±0.03)</td></tr>
            <tr><td><b>통합</b> (아래)</td><td>6대리그 전체 중 <b>다른 리그</b> 경기 — 같은 리그 경기는 위에 이미 나오므로 뺍니다</td><td>±2칸 (±0.02)</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>칸</b> = 소수 둘째 자리 한 눈금(0.01)입니다. 예를 들어 12사 평균 승이 2.55이면 같은 리그는 2.52~2.58,
          통합은 2.53~2.57까지 봅니다. 승·패 네 값이 <b>모두</b> 폭 안이어야 표본이 됩니다.
          같은 리그는 폭을 더 넓게(±3칸), 통합은 더 좁게(±2칸) 잡아 <b>같은 리그를 우선</b>했습니다.
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
          표본 개수는 칸 제목 옆(예: <b>3건 중 12</b>)에 적힙니다.
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
