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

// 그 경기에서 정배(배당이 낮은 쪽)가 홈이었나 원정이었나 — 'H' / 'A' / null.
// 국내배당(KW/KL)을 먼저 보고, 없는 옛 경기는 해외배당(FW/FL)으로 대신한다.
// 배당이 같거나(무배당) 둘 다 없으면 정배를 못 정하므로 null(표시 안 함).
function favSide(m) {
  const pick = (w, l) => {
    const a = Number(w)
    const b = Number(l)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return null
    return a < b ? 'H' : 'A'
  }
  return pick(m.KW, m.KL) || pick(m.FW, m.FL)
}

// 팀명 옆 (정)/(역) 표식.
//
// 이게 왜 필요한가 — 상대전적의 RT(핸승/핸무/무/역)는 항상 '그 경기 자체의 정배'
// 기준이다. 그런데 과거 맞대결에서 정배였던 팀이 지금 경기에서도 정배라는 보장이
// 없다(6대리그 실측: 과거 맞대결의 27.6%가 지금과 정배가 다르다). 그래서 정배가
// 누구였는지 모르고 RT만 읽으면 "역이 몇 번"을 지금 경기 관점으로 잘못 세게 된다.
// 승/무/패(W/D/L)는 스코어에서 바로 나오므로 이 문제가 없다 — RT를 읽을 때만 본다.
//
// 색은 앱 전체 축을 그대로 따른다(정배 쪽=파랑 / 역배 쪽=빨강 — 핸디기준점·RT와 같은 축).
function FavMark({ side, me }) {
  if (!side) return null
  const isFav = side === me
  return (
    <span className={`h2h-fav h2h-fav-${isFav ? 'j' : 'y'}`}>({isFav ? '정' : '역'})</span>
  )
}

// ── 기간 좁혀 보기 (최근 N시즌) ──
// 기준 시즌은 목록 맨 위 = 지금 보고 있는 경기의 시즌이다(백엔드가 S 내림차순으로
// 정렬해 주고, 지금 경기 자신도 맞대결 목록에 들어 있다).
// '최근 3년'은 기준 시즌을 포함해 3개 시즌 — 26-27 기준이면 24-25까지다.
function seasonStart(s) {
  const n = Number(String(s ?? '').slice(0, 2))
  return Number.isFinite(n) ? n : null
}

function withinPeriod(matches, years) {
  if (!years || !matches.length) return matches
  const ref = seasonStart(matches[0].S)
  if (ref === null) return matches
  const cut = ref - (years - 1)
  return matches.filter((m) => {
    const y = seasonStart(m.S)
    return y !== null && y >= cut
  })
}

// 정/역 좁혀 보기 — 그 경기의 HT(그 경기 자체의 홈팀)가 정배였는지 역배였는지로
// 거른다(팀명 옆 (정)/(역) 표식과 같은 값, favSide 재사용). 체크된 것들의 합집합
// 이다 — 정만 체크하면 정만, 역만 체크하면 역만, 둘 다 체크하면 둘 다(=정배를
// 못 정한 동배 경기만 빠짐). 둘 다 안 켜면 필터 없음.
function filterFav(matches, favJ, favY) {
  if (!favJ && !favY) return matches
  return matches.filter((m) => {
    const f = favSide(m)
    return (favJ && f === 'H') || (favY && f === 'A')
  })
}

// 기간을 좁히면 위 요약표(전체기준/홈기준)도 그 기간만으로 다시 세야 한다.
// 백엔드 _wdl_breakdown(api/main.py)과 같은 규칙을 그대로 옮긴 것이다 — 기준 팀이
// 그 경기에서 홈이었든 원정이었든 실제 스코어로 W/D/L을 판정하고, 그 안에서 RT를 쪼갠다.
// 스코어가 없는 경기(예정·취소)는 백엔드와 똑같이 뺀다.
//
// 기간을 안 좁혔을 때는 이걸 쓰지 않고 백엔드 값을 그대로 쓴다 — 경기 목록은 limit으로
// 잘릴 수 있어서(총 N경기 중 최근 200경기만), 잘린 목록으로 다시 세면 백엔드 값보다
// 작게 나온다. 3·5년 창은 limit보다 훨씬 짧아 잘릴 일이 없다.
function wdlBreakdown(matches, referenceTeam, homeOnly) {
  const out = {
    W: { total: 0, breakdown: {} },
    D: { total: 0, breakdown: {} },
    L: { total: 0, breakdown: {} },
  }
  matches.forEach((m) => {
    const hs = m.HS
    const as_ = m.AS
    if (hs === null || hs === undefined || as_ === null || as_ === undefined) return
    const rowHt = String(m.HT ?? '').trim()
    if (homeOnly && rowHt !== referenceTeam) return
    const mine = rowHt === referenceTeam ? hs : as_
    const theirs = rowHt === referenceTeam ? as_ : hs
    const letter = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'
    const lab = m.RT_label || '기타'
    out[letter].breakdown[lab] = (out[letter].breakdown[lab] || 0) + 1
    out[letter].total += 1
  })
  return out
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
// preset을 넘기면(undefined가 아니면) 이 컴포넌트는 자체 fetch를 하지 않고 그 값만
// 그려준다 — 상세보기 팝업은 종합분석(/api/pick_ai)이 상대전적을 이미 같은 조건
// (두 팀·cross=true)으로 계산해 내려주므로, 여기서 /api/head_to_head를 한 번 더
// 부르면 같은 계산을 두 번 하는 셈이라 팝업이 느려진다. preset이 아직 준비 전이면
// null을, 로딩 중이면 presetLoading=true를 같이 넘긴다(리그탭 "상대전적 조회"처럼
// preset 없이 쓰는 곳은 예전처럼 그대로 자체 fetch한다).
export default function HeadToHeadResult({
  scope, code, home, away, cross = true, limit = 200,
  preset, presetLoading = false, presetError = '',
  homeOnly = false, years = 0, favJ = false, favY = false,
}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const usePreset = preset !== undefined

  useEffect(() => {
    if (usePreset) return undefined
    if (!home || !away) return undefined
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
  }, [usePreset, scope, code, home, away, cross, limit])

  if (!home || !away) return null

  const effData = usePreset ? preset : data
  const effError = usePreset ? presetError : error
  const effLoading = usePreset ? presetLoading : !data

  if (effError) return <p className="error-text">{effError}</p>
  if (effLoading) return <p className="loading-text">불러오는 중...</p>
  if (!effData || !effData.summary) {
    return (
      <p className="detail-empty">
        {home} vs {away} 맞대결 기록 없음
      </p>
    )
  }

  // 기간(최근 N시즌) → 정/역 순서로 좁힌다 — 요약표와 경기 목록이 같은 대상을 봐야 한다.
  const periodMatches = withinPeriod(effData.matches, years)
  const favMatches = filterFav(periodMatches, favJ, favY)
  const favActive = favJ || favY
  // 기간을 좁혔거나 정/역을 걸렀을 때만 요약표를 다시 센다(둘 다 안 걸렀으면 백엔드
  // 값 그대로 — 아래 wdlBreakdown 주석 참고).
  const recomputed = years > 0 || favActive
  const wdl = recomputed ? wdlBreakdown(favMatches, home, false) : effData.wdl_summary
  const wdlHome = recomputed ? wdlBreakdown(favMatches, home, true) : effData.wdl_summary_home
  // '홈보기' — 위 요약표 '홈기준' 줄과 같은 기준(home팀이 실제로 홈이었던 경기만).
  const shownMatches = homeOnly ? favMatches.filter((m) => m.HT === home) : favMatches
  // 지금 걸려 있는 조건을 한 줄로 — 기간·정/역 어느 것이든 걸리면 요약표까지 그
  // 조건만으로 바뀌므로, 무엇을 보고 있는지 반드시 밝혀야 전체 전적과 안 헷갈린다.
  const filterLabel = [
    years > 0 && periodMatches.length < effData.matches.length
      && `최근 ${years}년(${periodMatches[periodMatches.length - 1]?.S}~${periodMatches[0]?.S})`,
    favJ && !favY && '홈팀 정배 경기만',
    favY && !favJ && '홈팀 역배 경기만',
    favJ && favY && '홈팀 정배·역배 경기만(동배 제외)',
  ].filter(Boolean).join(' · ')
  const narrowed = filterLabel.length > 0

  return (
    <>
      <WdlGrid wdl={wdl} wdlHome={wdlHome} />

      {shownMatches.length === 0 ? (
        <p className="detail-empty">
          {narrowed && `${filterLabel} · `}
          {homeOnly ? `${home}의 홈경기 맞대결 기록 없음` : '맞대결 기록 없음'}
        </p>
      ) : (
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
              {shownMatches.map((m, i) => {
                const seasonStart = i > 0 && m.S !== shownMatches[i - 1].S
                const fav = favSide(m)
                return (
                  <tr key={i} className={seasonStart ? 'season-start' : undefined}>
                    <td>{m.S}</td>
                    <td>{m.R}</td>
                    <td className={`row-label ${m.HT === home ? 'h2h-home-cell' : ''}`}>
                      {m.HT}
                      <FavMark side={fav} me="H" />
                    </td>
                    <td className={scoreClass(m.HS, m.AS, 'home')}>{m.HS ?? ''}</td>
                    <td className={scoreClass(m.HS, m.AS, 'away')}>{m.AS ?? ''}</td>
                    <td className={`row-label ${m.AT === home ? 'h2h-home-cell' : ''}`}>
                      {m.AT}
                      <FavMark side={fav} me="A" />
                    </td>
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
      )}
      {/* 기간·정/역을 걸리면 위 요약표까지 그 조건 값으로 바뀌므로, 지금 무엇을
          보고 있는지 숫자 옆에 반드시 적어 둔다 — 안 적으면 전체 전적과 구분이 안 된다. */}
      {narrowed && (
        <p className="h2h-more">
          {filterLabel} {favMatches.length}경기 기준 · 요약표도 이 조건만 집계
          {' '}(전체 {effData.total}경기)
        </p>
      )}
      {homeOnly && shownMatches.length > 0 && (
        <p className="h2h-more">홈경기 {shownMatches.length}건만 표시</p>
      )}
      {!homeOnly && !narrowed && effData.total > effData.matches.length && (
        <p className="h2h-more">
          최근 {effData.matches.length}경기만 표시 (총 {effData.total}경기)
        </p>
      )}
    </>
  )
}
