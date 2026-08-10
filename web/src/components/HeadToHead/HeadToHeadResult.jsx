import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { scoreClass } from '../../utils/format'
import RtBadge from '../RtBadge/RtBadge'
import './HeadToHeadResult.css'

// 승점은 '이 조회의 기준 홈팀'(home prop) 기준(승3/무1/패0) — 그 팀이 각 과거
// 경기에서 홈이었든 원정이었든 상관없이, 그 팀이 거둔 결과를 그대로 매긴다.
function homePoints(m, referenceTeam) {
  const hs = m.HS
  const as_ = m.AS
  if (hs === null || hs === undefined || as_ === null || as_ === undefined) return ''
  let mine, theirs
  if (m.HT === referenceTeam) {
    mine = hs
    theirs = as_
  } else if (m.AT === referenceTeam) {
    mine = as_
    theirs = hs
  } else {
    return ''
  }
  if (mine > theirs) return 3
  if (mine < theirs) return 0
  return 1
}

const WDL_COLOR = { W: '#1565C0', D: '#757575', L: '#C62828' }

// "결과" 컬럼 — 기준 팀(home) 관점의 실제 승/무/패(W/D/L)만 보여준다.
// 모양(.rt-badge)은 RtBadge 와 같은 것을 쓰고 색만 다르다 — 그 CSS는
// components/RtBadge/RtBadge.css 에 있고, 위에서 RtBadge 를 import 할 때 함께 딸려온다.
function WdlBadge({ letter }) {
  if (!letter) return null
  return (
    <span className="rt-badge" style={{ background: WDL_COLOR[letter], color: '#fff' }}>
      {letter}
    </span>
  )
}

const RT_ORDER = ['핸승', '핸무', '무', '역']
// 지표별 표본(SampleTable)과 같은 배색을 그대로 쓴다 — 핸승=파랑/핸무=하늘/무=회색/역=빨강.
const RT_COL_CLASS = { 핸승: 'col-hs', 핸무: 'col-hm', 무: 'col-mu', 역: 'col-yk' }

// 전체기준·홈기준 두 표가 내용(숫자 자릿수)과 무관하게 항상 같은 폭으로 나란히
// 맞춰지도록, 칸마다 실제 셀 내용 대신 이 colgroup 폭을 그대로 쓰게 고정한다
// (12칸이 전부 핸승/핸무/무/역 자리라 폭도 전부 같다 — SeasonStats.jsx와 같은 방식).
function WdlCols() {
  return (
    <colgroup>
      <col className="h2h-col-label" />
      {Array.from({ length: 12 }, (_, i) => (
        <col key={i} className="h2h-col-rt" />
      ))}
      <col className="h2h-col-total" />
    </colgroup>
  )
}

// 상대전적 W/D/L 요약 한 블록 — "전체기준"(그 팀이 홈이든 원정이든)과 "홈기준"(그 팀이
// 실제로 홈이었던 맞대결만)을 같은 모양으로 두 번 그려서 나란히 비교할 수 있게 한다.
function WdlGrid({ title, wdl }) {
  if (!wdl) return null
  const total = wdl.W.total + wdl.D.total + wdl.L.total
  return (
    <table className="detail-table h2h-wdl-grid">
      <WdlCols />
      <thead>
        <tr>
          <th className="row-label">{title}</th>
          <th colSpan={4} className="col-w">W-{wdl.W.total}</th>
          <th colSpan={4} className="col-d">D-{wdl.D.total}</th>
          <th colSpan={4} className="col-l">L-{wdl.L.total}</th>
          <th rowSpan={2}>토탈</th>
        </tr>
        <tr>
          <th className="row-label">결과</th>
          {['W', 'D', 'L'].flatMap((key) =>
            RT_ORDER.map((lab) => (
              <th key={`${key}-${lab}`} className={RT_COL_CLASS[lab]}>
                {lab}
              </th>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td />
          {['W', 'D', 'L'].flatMap((key) =>
            RT_ORDER.map((lab) => (
              <td key={`${key}-${lab}`} className={RT_COL_CLASS[lab]}>
                {(wdl[key]?.breakdown?.[lab] || 0) || '-'}
              </td>
            ))
          )}
          <td className="col-total">{total}</td>
        </tr>
      </tbody>
    </table>
  )
}

// 두 팀의 상대전적(핸승/핸무/무/역 기준). 상세보기 팝업과 리그탭 필터의
// "상대전적 조회"가 공유하는 컴포넌트. 결과는 각 경기의 홈팀 기준으로 집계된다.
// code: 내 데이터(scope=user)에서는 필수 — 통합DB가 없어 그 리그 하나만 찾으므로,
// 어느 리그에서 조회하는 건지 알아야 한다. 공식 데이터는 6대리그를 합쳐서 찾으므로 안 써도 된다.
export default function HeadToHeadResult({ scope, code, home, away, cross = true, limit = 200 }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!home || !away) return
    let cancelled = false
    setData(null)
    setError('')
    api
      .get(
        `/api/head_to_head?scope=${scope}&code=${encodeURIComponent(code || '')}` +
          `&home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}` +
          `&cross=${cross}&limit=${limit}`
      )
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [scope, code, home, away, cross, limit])

  if (!home || !away) return null
  if (error) return <p className="error-text">{error}</p>
  if (!data) return <p className="loading-text">불러오는 중...</p>
  if (!data.summary) {
    return (
      <p className="detail-empty">
        {home} vs {away} 맞대결 기록 없음
      </p>
    )
  }

  const wdl = data.wdl_summary
  const wdlHome = data.wdl_summary_home

  return (
    <>
      <p className="h2h-caption">
        {home} 기준 실제 승/무/패이며, 칸 안 숫자는 그때 핸디캡 결과(RT) 건수입니다.
        "홈기준"은 그 경기에서 {home}이 실제로 홈이었던 맞대결만 센 것입니다.
      </p>
      <WdlGrid title="전체기준" wdl={wdl} />
      <WdlGrid title="홈기준" wdl={wdlHome} />

      <div className="match-list-scroll">
        <table className="detail-table match-list">
          <thead>
            <tr>
              <th>시즌</th>
              <th>R</th>
              <th>HT</th>
              <th>HS</th>
              <th>AS</th>
              <th>AT</th>
              <th>결과</th>
              <th>유형</th>
              <th>승점</th>
            </tr>
          </thead>
          <tbody>
            {data.matches.map((m, i) => {
              const seasonStart = i > 0 && m.S !== data.matches[i - 1].S
              return (
                <tr key={i} className={seasonStart ? 'season-start' : undefined}>
                  <td>{m.S}</td>
                  <td>{m.R}</td>
                  <td className={`row-label ${m.HT === home ? 'h2h-home-cell' : ''}`}>{m.HT}</td>
                  <td className={scoreClass(m.HS, m.AS, 'home')}>{m.HS ?? ''}</td>
                  <td className={scoreClass(m.HS, m.AS, 'away')}>{m.AS ?? ''}</td>
                  <td className={`row-label ${m.AT === home ? 'h2h-home-cell' : ''}`}>{m.AT}</td>
                  <td>
                    <WdlBadge letter={{ 3: 'W', 1: 'D', 0: 'L' }[homePoints(m, home)]} />
                  </td>
                  <td>
                    <RtBadge label={m.RT_label} />
                  </td>
                  <td className="col-total">{homePoints(m, home)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {data.total > data.matches.length && (
        <p className="h2h-more">
          최근 {data.matches.length}경기만 표시 (총 {data.total}경기)
        </p>
      )}
      <p className="h2h-more">승점은 홈팀 기준으로 작성되었습니다.</p>
    </>
  )
}
