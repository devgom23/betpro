import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import './HeadToHeadResult.css'

const RT_COLOR = { 핸승: '#1565C0', 핸무: '#64B5F6', 무: '#757575', 역: '#C62828' }

// 점수가 둘 다 있고 서로 다를 때만 이긴 쪽 점수를 강조한다(무승부·예정 경기는 강조 없음)
function scoreClass(hs, as_, side) {
  if (hs === null || hs === undefined || as_ === null || as_ === undefined) return undefined
  const winner = hs > as_ ? 'home' : as_ > hs ? 'away' : null
  return winner === side ? 'winner-score' : undefined
}

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

function RtBadge({ label }) {
  if (!label) return null
  const bg = RT_COLOR[label] || '#9E9E9E'
  const fg = label === '핸무' ? '#0D1B2A' : '#fff'
  return (
    <span className="rt-badge" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

// 두 팀의 상대전적(핸승/핸무/무/역 기준). 상세보기 팝업과 리그탭 필터의
// "상대전적 조회"가 공유하는 컴포넌트. 결과는 각 경기의 홈팀 기준으로 집계된다.
// code: 내 데이터(scope=user)에서는 필수 — 통합DB가 없어 그 리그 하나만 찾으므로,
// 어느 리그에서 조회하는 건지 알아야 한다. 공식 데이터는 6대리그를 합쳐서 찾으므로 안 써도 된다.
export default function HeadToHeadResult({ scope, code, home, away, cross = true, limit = 15 }) {
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

  return (
    <>
      <p className="h2h-caption">결과는 각 경기의 홈팀 기준입니다.</p>
      <table className="detail-table h2h-summary-table">
        <thead>
          <tr>
            <th className="col-hs">핸승</th>
            <th className="col-hm">핸무</th>
            <th className="col-mu">무</th>
            <th className="col-yk">역</th>
            <th>토탈</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{data.summary.핸승}</td>
            <td>{data.summary.핸무}</td>
            <td>{data.summary.무}</td>
            <td>{data.summary.역}</td>
            <td className="col-total">{data.summary.총}</td>
          </tr>
        </tbody>
      </table>

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
                <td className="row-label">{m.HT}</td>
                <td className={scoreClass(m.HS, m.AS, 'home')}>{m.HS ?? ''}</td>
                <td className={scoreClass(m.HS, m.AS, 'away')}>{m.AS ?? ''}</td>
                <td className="row-label">{m.AT}</td>
                <td>
                  <RtBadge label={m.RT_label} />
                </td>
                <td className="col-total">{homePoints(m, home)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {data.total > data.matches.length && (
        <p className="h2h-more">
          최근 {data.matches.length}경기만 표시 (총 {data.total}경기)
        </p>
      )}
      <p className="h2h-more">승점은 홈팀 기준으로 작성되었습니다.</p>
    </>
  )
}
