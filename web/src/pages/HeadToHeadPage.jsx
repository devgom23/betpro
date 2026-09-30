import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import RtBadge from '../components/RtBadge/RtBadge'
import { formatDt } from '../utils/format'

// 실제 스코어(HS/AS) 기준 승/무/패 집계 ("양날개" — 팀이 홈/원정 어느 쪽이었든 합산).
// betpro_ui.py 상대전적 탭의 원본 로직과 동일한 규칙.
function tallyWinsDraws(matches, teamA, teamB) {
  let winA = 0
  let winB = 0
  let draw = 0
  for (const m of matches) {
    const hs = Number(m.HS)
    const as = Number(m.AS)
    if (Number.isNaN(hs) || Number.isNaN(as)) continue
    let winner = null
    if (hs > as) winner = m.HT
    else if (hs < as) winner = m.AT
    else {
      draw += 1
      continue
    }
    if (winner === teamA) winA += 1
    else if (winner === teamB) winB += 1
  }
  return { winA, winB, draw }
}

export default function HeadToHeadPage({ scope }) {
  const [teams, setTeams] = useState([])
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)   // 팀 목록 응답을 받았는지(빈 목록과 '아직 로딩 중'을 구분)

  useEffect(() => {
    let cancelled = false
    api
      .get(`/api/teams?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setLoaded(true)
        setTeams(res.teams)
        setTeamA(res.teams[0] ?? '')
        setTeamB(res.teams[1] ?? res.teams[0] ?? '')
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [scope])

  useEffect(() => {
    if (!teamA || !teamB || teamA === teamB) {
      setData(null)
      return
    }
    let cancelled = false
    api
      .get(
        `/api/head_to_head?scope=${scope}&home=${encodeURIComponent(teamA)}&away=${encodeURIComponent(teamB)}&limit=9999`
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
  }, [scope, teamA, teamB])

  const tally = useMemo(() => {
    if (!data || !data.matches) return null
    return tallyWinsDraws(data.matches, teamA, teamB)
  }, [data, teamA, teamB])

  if (error) return <p className="error-text">{error}</p>
  if (!teams.length) {
    // 상대전적은 6대리그 합본 기준이라, 6대리그 표가 없는 내 데이터에서는 팀이 비어 있다(2026-09-30
    // 오른쪽 탭을 내 데이터에서도 보이게 하면서 추가 — 안내 없이 '불러오는 중'만 계속 뜨던 문제).
    return loaded
      ? <p className="loading-text">이 데이터에는 상대전적을 볼 경기가 없습니다 — 상대전적은 공식 6대리그 데이터 기준입니다.</p>
      : <p className="loading-text">불러오는 중...</p>
  }

  return (
    <div>
      <h2 className="section-title">🆚 상대전적</h2>

      <div className="h2h-team-select">
        <select value={teamA} onChange={(e) => setTeamA(e.target.value)}>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span>vs</span>
        <select value={teamB} onChange={(e) => setTeamB(e.target.value)}>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {teamA === teamB && <p className="loading-text">서로 다른 두 팀을 선택하세요.</p>}

      {teamA !== teamB && data && (!data.summary ? (
        <p className="loading-text">
          {teamA} vs {teamB} 맞대결 기록이 없습니다.
        </p>
      ) : (
        <>
          <div className="h2h-metrics">
            <div className="h2h-metric win-a">
              <span className="h2h-metric-name">🔵 {teamA} 승</span>
              <span className="h2h-metric-value">{tally?.winA ?? 0}</span>
            </div>
            <div className="h2h-metric draw">
              <span className="h2h-metric-name">⚪ 무</span>
              <span className="h2h-metric-value">{tally?.draw ?? 0}</span>
            </div>
            <div className="h2h-metric win-b">
              <span className="h2h-metric-name">🔴 {teamB} 승</span>
              <span className="h2h-metric-value">{tally?.winB ?? 0}</span>
            </div>
          </div>
          <p className="h2h-total">총 {data.total.toLocaleString()} 경기</p>

          <div className="league-table-scroll">
            <table className="league-table">
              <thead>
                <tr>
                  <th>시즌</th>
                  <th>R</th>
                  <th>일자</th>
                  <th>홈팀</th>
                  <th>홈득점</th>
                  <th>원정득점</th>
                  <th>원정팀</th>
                  <th>결과</th>
                  <th>FW</th>
                  <th>FD</th>
                  <th>FL</th>
                </tr>
              </thead>
              <tbody>
                {data.matches.map((m, i) => (
                  <tr key={i}>
                    <td>{m.S}</td>
                    <td>{m.R}</td>
                    <td>{formatDt(m.DT)}</td>
                    <td>{m.HT}</td>
                    <td>{m.HS ?? ''}</td>
                    <td>{m.AS ?? ''}</td>
                    <td>{m.AT}</td>
                    <td>
                      <RtBadge label={m.RT_label} />
                    </td>
                    <td>{m.FW ?? ''}</td>
                    <td>{m.FD ?? ''}</td>
                    <td>{m.FL ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </div>
  )
}
