import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import './HeadToHeadResult.css'

const RT_COLOR = { 핸승: '#1565C0', 핸무: '#64B5F6', 무: '#757575', 역: '#C62828' }

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
export default function HeadToHeadResult({ scope, home, away, cross = true, limit = 15 }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!home || !away) return
    let cancelled = false
    setData(null)
    setError('')
    api
      .get(
        `/api/head_to_head?scope=${scope}&home=${encodeURIComponent(home)}` +
          `&away=${encodeURIComponent(away)}&cross=${cross}&limit=${limit}`
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
  }, [scope, home, away, cross, limit])

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
      <table className="detail-table">
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
          </tr>
        </thead>
        <tbody>
          {data.matches.map((m, i) => (
            <tr key={i}>
              <td>{m.S}</td>
              <td>{m.R}</td>
              <td className="row-label">{m.HT}</td>
              <td>{m.HS ?? ''}</td>
              <td>{m.AS ?? ''}</td>
              <td className="row-label">{m.AT}</td>
              <td>
                <RtBadge label={m.RT_label} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.total > data.matches.length && (
        <p className="h2h-more">
          최근 {data.matches.length}경기만 표시 (총 {data.total}경기)
        </p>
      )}
    </>
  )
}
