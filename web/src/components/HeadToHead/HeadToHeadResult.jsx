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

// RtBadge(RT_CHIP)와 같은 옅은 배경 틴트 + 진한 글씨 스타일 — 승=파랑/무=회색/패=빨강,
// 상대전적 요약 표의 col-w/col-d/col-l과 같은 축이라 --chip-* 토큰을 그대로 쓴다.
const WDL_CHIP = {
  W: { background: 'var(--chip-blue-bg)', color: 'var(--chip-blue-fg)' },
  D: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' },
  L: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
}

// "결과" 컬럼 — 기준 팀(home) 관점의 실제 승/무/패(W/D/L)만 보여준다.
// 모양(.rt-badge)은 RtBadge 와 같은 것을 쓰고 색만 다르다 — 그 CSS는
// components/RtBadge/RtBadge.css 에 있고, 위에서 RtBadge 를 import 할 때 함께 딸려온다.
function WdlBadge({ letter }) {
  if (!letter) return null
  return (
    <span className="rt-badge" style={WDL_CHIP[letter]}>
      {letter}
    </span>
  )
}

const RT_ORDER = ['핸승', '핸무', '무', '역']
// 상대전적 표는 핸승/핸무/무/역 개별 색이 아니라, 그 칸이 속한 승/무/패(W/D/L) 그룹
// 색으로 통일한다 — 글자는 핸승/핸무/무/역 그대로 두고, 배경만 그룹당 하나의 색으로
// 묶어서 어디까지가 W(승)·D(무)·L(패) 구간인지 색으로도 바로 보이게 한다.
const GROUP_COL_CLASS = { W: 'col-w', D: 'col-d', L: 'col-l' }

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
      {['w', 'd', 'l'].map((k) => (
        <col key={k} className="h2h-col-total" />
      ))}
    </colgroup>
  )
}

function WdlRow({ title, wdl }) {
  if (!wdl) return null
  return (
    <tr>
      <td className="row-label">{title}</td>
      {['W', 'D', 'L'].flatMap((key) =>
        RT_ORDER.map((lab) => (
          <td key={`${key}-${lab}`} className={GROUP_COL_CLASS[key]}>
            {(wdl[key]?.breakdown?.[lab] || 0) || '-'}
          </td>
        ))
      )}
      <td className="col-total col-w">{wdl.W.total}</td>
      <td className="col-total col-d">{wdl.D.total}</td>
      <td className="col-total col-l">{wdl.L.total}</td>
    </tr>
  )
}

// 상대전적 W/D/L 요약 — "전체기준"(그 팀이 홈이든 원정이든)과 "홈기준"(그 팀이 실제로
// 홈이었던 맞대결만)을 같은 표 안에 두 줄로 이어 붙여, 헤더 하나로 바로 비교할 수 있게 한다.
// 헤더는 한 줄로 압축한다 — W/D/L 접두어 없이 핸승/핸무/무/역만 반복해서 보여주고(그룹
// 구분은 세로선으로), 맨 뒤 토탈은 승/무/패 세 칸으로 나눠 W/D/L 각각의 합계를 바로 본다.
function WdlGrid({ wdl, wdlHome }) {
  if (!wdl) return null
  return (
    <table className="detail-table h2h-wdl-grid">
      <WdlCols />
      <thead>
        <tr>
          <th className="row-label">기준</th>
          {['W', 'D', 'L'].flatMap((key) =>
            RT_ORDER.map((lab) => (
              <th key={`${key}-${lab}`} className={GROUP_COL_CLASS[key]}>
                {lab}
              </th>
            ))
          )}
          <th className="col-w">승</th>
          <th className="col-d">무</th>
          <th className="col-l">패</th>
        </tr>
      </thead>
      <tbody>
        <WdlRow title="전체기준" wdl={wdl} />
        <WdlRow title="홈기준" wdl={wdlHome} />
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
      <WdlGrid wdl={wdl} wdlHome={wdlHome} />

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
    </>
  )
}
