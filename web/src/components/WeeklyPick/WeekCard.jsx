// 이번주 픽 경기 카드 — 날짜·리그·팀, 내픽·상세픽·의견·메모, 국배·국내 핸디(±2·±3.5 추가 핸디 포함)
// 최신 배당 버튼. 버튼을 누르면 이번주 벳(사다리)에 담기고, 한 경기에서 여러 칸(가로·세로)을 고를 수 있다.
import { stripMemo } from '../../utils/richMemo'
import { LAB, cellHit, homeFavOf, lineText, pickSide } from './weekBet'

const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))
const P_CLS = { 핸승: 'is-blue', 핸무: 'is-green', 무: 'is-gray', 역: 'is-red' }
// 내 예측(경기별 세팅값에서 고른 확신·맞겠지·애매해·틀릴듯) — 색은 그 표의 글자색과 같다(2026-10-10 사용자 지정)
const PRED_CLS = { 확신: 'is-yellow', 맞겠지: 'is-green', 애매해: 'is-gray', 틀릴듯: 'is-red' }

function timeText(tm) {
  const s = String(tm ?? '').replace(/\D/g, '').padStart(4, '0')
  return s === '0000' && !tm ? '' : `${s.slice(0, 2)}:${s.slice(2, 4)}`
}

export default function WeekCard({ row, markets, picked, onToggle, onOpen, onHide, dayText }) {
  const side = pickSide(row.MY_PICK)
  const hasScore = row.HS !== null && row.HS !== undefined && row.AS !== null && row.AS !== undefined
  const fav = homeFavOf(row)
  const memo = stripMemo(row.MEMO_PRE || '') || stripMemo(row.MEMO || '')
  // 의견에 '고민'이 들어 있으면 별 1개로 보인다(2026-09-27 사용자 지정 — 아직 확정 전이라는 표시). 칸도 사이드(weekBet.mainSideOf).
  const star = String(row.MY_HIT || '').includes('고민') || Number(row.IMPORTANT) < 2 ? '★' : '★★'
  const isOn = (m, i) => picked?.some((s) => s.m === m && s.i === i)
  return (
    <div className={`wk-card${picked?.length ? ' has-pick' : ''}`}>
      <div className="wk-top">
        <span className="wk-star">{star}</span>
        <b>{dayText} {timeText(row.TM)}</b>
        <span className="wk-lg">{row.L_LABEL || row.L} {row.R}</span>
        <button type="button" className="wk-x" onClick={onHide} title="이번주 픽에서 숨기기(별표·리그 데이터는 그대로)">✕</button>
      </div>
      <button type="button" className="wk-teams" onClick={onOpen} title="상세보기 열기">
        <span>{row.HT}</span>
        {hasScore ? (
          <span className="wk-score">
            <b className={row.HS > row.AS ? 'wk-win' : undefined}>{Math.trunc(row.HS)}</b> : <b className={row.AS > row.HS ? 'wk-win' : undefined}>{Math.trunc(row.AS)}</b>
          </span>
        ) : <span className="wk-vs">vs</span>}
        <span>{row.AT}</span>
      </button>
      <div className="wk-picks">
        <span className="wk-lb">내픽</span>
        <span className={`wk-chip ${side === '정' ? 'is-blue' : side === '플' ? 'is-red' : 'is-gray'}`}>{row.MY_PICK || '미정'}</span>
        {row.MY_P && (<><span className="wk-lb">상세픽</span><span className={`wk-chip ${P_CLS[row.MY_P] || 'is-gray'}`}>{row.MY_P}</span></>)}
        {row.MY_HIT && (<><span className="wk-lb">의견</span><span className={`wk-chip ${row.MY_HIT === 'Pass' ? 'is-gray' : 'is-yellow'}`}>{row.MY_HIT}</span></>)}
        {row.MY_PRED && (<><span className="wk-lb">예측</span><span className={`wk-chip ${PRED_CLS[row.MY_PRED] || 'is-gray'}`} title="경기별 세팅값에서 고른 내 예측(이 판정이 맞을지)">{row.MY_PRED}</span></>)}
      </div>
      {memo && <div className="wk-memo" title={memo}>{memo}</div>}
      {markets.map((mk) => (
        <div className="wk-mk" key={mk.m}>
          <span className="wk-mk-lab">{mk.label}{mk.line !== null && <i>{lineText(mk.line)}</i>}</span>
          {mk.cells.map((c, i) => {
            if (c.cur === null) return <span key={i} className="wk-od is-empty">-</span>
            const on = isOn(mk.m, i)
            const hit = hasScore && cellHit(row, mk.m, mk.line, i)
            const favCls = mk.m === 'k' && fav !== null && i !== 1 ? ((i === 0) === fav ? ' is-fav' : ' is-dog') : ''
            const mv = c.init !== null && c.cur > c.init ? 'up' : c.init !== null && c.cur < c.init ? 'dn' : null
            return (
              <button
                key={i}
                type="button"
                className={`wk-od${favCls}${on ? ' is-on' : ''}${hit ? ' is-hit' : ''}`}
                onClick={() => onToggle(mk.m, i)}
                title={c.init !== null && c.init !== c.cur ? `초기 ${f2(c.init)} → 최신 ${f2(c.cur)}` : undefined}
              >
                <small>{LAB[i]}</small>
                <b>{f2(c.cur)}</b>
                {mv && <span className={`wk-mv ${mv}`}>{mv === 'up' ? '▲' : '▼'}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
