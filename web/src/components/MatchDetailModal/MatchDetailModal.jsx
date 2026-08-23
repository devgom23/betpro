import { Fragment, useEffect, useRef, useState } from 'react'
import { api, saveBlob } from '../../api/client'
import HeadToHeadResult from '../HeadToHead/HeadToHeadResult'
import RtBadge from '../RtBadge/RtBadge'
import { isStarred, formatTime, formatDt, scoreClass } from '../../utils/format'
import { PICK_OPTIONS, P_OPTIONS, HIT_OPTIONS } from '../../utils/pickOptions'
import './MatchDetailModal.css'


function rtLabel(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  return { 1: '핸승', 2: '핸무', 3: '무', 4: '역', 5: '취소', 6: '연기' }[Math.trunc(n)] || ''
}

function numOrDash(v, digits = 2) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  return Number.isNaN(n) ? '-' : n.toFixed(digits)
}

// 팀이름 옆 (순위) — 그 라운드 직전까지의 순위(HP/AP). 시즌 초반 등 아직 순위가 없으면 생략.
function rankSuffix(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return Number.isNaN(n) ? '' : `(${Math.trunc(n)}위)`
}

// 팀이름 옆 (적중/전체) 배지 — "이번주 벳"에서 이 팀을 선택("+추가")한 횟수 기준.
// api/main.py team_bet_record 참고: 조합으로 곱해지기 전, 경기당 1건 + 그 경기에서
// 가장 먼저 담은 유형의 적중 여부만 센다(베팅내역의 개별 벳/조합 개수와는 다르다).
function TeamBetRecord({ name }) {
  const [rec, setRec] = useState(null)
  useEffect(() => {
    let cancelled = false
    setRec(null)
    if (!name) return undefined
    api
      .get(`/api/team_bet_record?name=${encodeURIComponent(name)}`)
      .then((res) => { if (!cancelled) setRec(res) })
      .catch(() => { if (!cancelled) setRec(null) })
    return () => { cancelled = true }
  }, [name])
  if (!rec) return null
  return <span className="team-bet-record"> ({rec.hit}/{rec.total})</span>
}

// 폼(PPG) 값 구간별 색상 — 3.00~2.00 녹색 / 1.99~1.00 노란색 / 0.99~0.00 갈색
function formStyle(v) {
  if (v === null || v === undefined || v === '' || v === '-') return undefined
  const n = Number(v)
  if (Number.isNaN(n)) return undefined
  if (n >= 2) return { background: '#2E7D32', color: '#fff', fontWeight: 700 }
  if (n >= 1) return { background: '#FBC02D', color: '#fff', fontWeight: 700 }
  return { background: '#8D6E63', color: '#fff', fontWeight: 700 }
}

const SAMPLE_INDICATORS = [
  ['K-W', '국) 승'], ['K-L', '국) 패'],
  // 27번 — 플핸측(언더독) 핸디배당이 같고 플핸측이 같은 편(홈/원정)인 과거 경기만.
  // 승·패 바로 아래에 둔다 — 셋 다 '이 경기 배당 하나'로 찾는 단일 조건 지표라
  // 두 배당을 동시에 맞추는 승+패·승+무+패보다 먼저 읽는 게 순서가 맞다.
  ['K-PL', '국) 플핸'],
  ['K-WL', '국) 승+패'], ['K-WDL', '국) 승+무+패'],
  ['K-W-HT', '국) 승=홈팀'], ['K-L-AT', '국) 패=원정팀'],
  ['TK-W', '국/통) 승'], ['TK-L', '국/통) 패'], ['TK-WL', '국/통) 승+패'], ['TK-WDL', '국/통) 승+무+패'],
  ['F-W', '해) 승'], ['F-L', '해) 패'], ['F-WL', '해) 승+패'], ['F-WDL', '해) 승+무+패'],
  ['F-W-HT', '해) 승=홈팀'], ['F-L-AT', '해) 패=원정팀'],
  ['TF-W', '해/통) 승'], ['TF-L', '해/통) 패'], ['TF-WL', '해/통) 승+패'], ['TF-WDL', '해/통) 승+무+패'],
]

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// 정배(시장이 강하다고 본 쪽)가 홈인지 — 국내배당(KW/KL) 우선, 없으면 해외배당(FW/FL).
// 핸승 위험도·종합픽 등 다른 계산과 같은 우선순위(api/pick_ai.py의 _home_is_fav 참고).
function homeIsFav(row) {
  for (const [wk, lk] of [['KW', 'KL'], ['FW', 'FL']]) {
    const w = numOrNull(row[wk])
    const l = numOrNull(row[lk])
    if (w !== null && l !== null && w !== l) return w < l
  }
  return null
}

// 똥배 표시 — 리그 표의 '똥배' 그룹(똥 / 분석 / 똥사)과 같은 값을 배당 제목 옆에 한 줄로.
// 등급 경계와 색은 columnGroups.js의 DDONG_RISK_CUTS와 맞춰 둔다(계산 근거는
// api/data_access.py의 _ddong_risk 주석에 6대리그 실측과 함께 있다).
const DDONG_GRADES = [
  [22, '안전', 'blue'],
  [30, '보통', 'gray'],
  [37, '주의', 'yellow'],
  [Infinity, '위험', 'red'],
]

function DdongNote({ row }) {
  const ddong = String(row.DDONG || '').trim()
  if (!ddong) return null
  const risk = numOrNull(row.DDONG_RISK)
  const [, label, tone] = DDONG_GRADES.find(([cut]) => risk !== null && risk < cut) || []
  // 리그 화면 상단 요약 바(등록된 시즌 18 · 경기수 5,229 …)와 같은 표기 —
  // 값은 <strong>으로 밝게, 사이는 가운뎃점으로, 등급은 RtSummaryBar처럼 칩으로.
  return (
    <span className="detail-section-note detail-ddong">
      <strong>{ddong}</strong>
      {risk !== null && (
        <>
          {' · '}
          <span
            className="detail-ddong-grade"
            style={{ background: `var(--chip-${tone}-bg)`, color: `var(--chip-${tone}-fg)` }}
          >
            {label} {Math.round(risk)}%
          </span>
        </>
      )}
      {String(row.DDONGSA || '').trim() && (
        <>
          {' · '}
          <strong className="detail-ddong-sa">똥사</strong>
        </>
      )}
    </span>
  )
}

// 홈팀/점수/원정팀을 승(홈)·무·패(원정) 컬럼과 같은 자리에 맞춰 배당표 맨 위에 얹는다.
// 경기 결과가 아직 없어도(예정 경기) 팀명은 항상 보이고, 점수만 '-'로 비워둔다.
// 팀 이름 옆엔 오늘 그 팀이 정배(정)인지 역배(역)인지 표시한다.
function OddsTable({ row }) {
  const rows = [
    ['국내 배당', 'KW', 'KD', 'KL'],
    ['국내 핸디', 'KHW', 'KHD', 'KHL'],
    ['해외 배당', 'FW', 'FD', 'FL'],
    ['해외 핸디', 'FHW', 'FHD', 'FHL'],
  ]
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const hasScore = row.HS !== null && row.HS !== undefined && row.AS !== null && row.AS !== undefined
  const homeFav = homeIsFav(row)
  const roleSuffix = (isHome) => {
    if (homeFav === null) return null
    const isFav = isHome ? homeFav : !homeFav
    return <span className={isFav ? 'odds-role-fav' : 'odds-role-dog'}> {isFav ? '(정)' : '(역)'}</span>
  }
  // 정배 쪽 컬럼(승=홈팀 칸 / 패=원정팀 칸) 전체에 아주 연한 파란 배경을 준다 —
  // 홈이 정배면 '승' 컬럼(KW/FW/FHW), 원정이 정배면 '패' 컬럼(KL/FL/FHL).
  const favColClass = (col) => {
    if (homeFav === null) return undefined
    const favCol = homeFav ? 'w' : 'l'
    return col === favCol ? 'odds-fav-col' : undefined
  }
  // 국내 핸디(KHW/KHL)만은 KW/KL로 정한 정배 컬럼을 그대로 따르지 않는다 — 핸디 라인이
  // 후하게 잡히면 언더독 쪽 핸디 배당이 오히려 더 낮게(=더 유력하게) 나오는 경우가 있어,
  // 정배 쪽을 그대로 칠하면 실제 핸디 배당의 유불리와 어긋난다. 이 줄만 KHW·KHL 값을
  // 직접 비교해 배당이 더 작은(=더 유력한) 쪽을 표시한다.
  const khw = numOrNull(row.KHW)
  const khl = numOrNull(row.KHL)
  const khFavCol = khw !== null && khl !== null && khw !== khl ? (khw < khl ? 'w' : 'l') : null
  const khColClass = (col) => (khFavCol && col === khFavCol ? 'odds-fav-col' : undefined)
  return (
    <table className="detail-table odds-table">
      <thead>
        <tr className="odds-teams-row">
          <th className="row-label" />
          <th className="odds-team-name">
            {ht}
            {roleSuffix(true)}
          </th>
          <th className="odds-score-cell">
            {hasScore ? (
              <>
                <span className={scoreClass(row.HS, row.AS, 'home')}>{Math.trunc(row.HS)}</span>
                {' : '}
                <span className={scoreClass(row.HS, row.AS, 'away')}>{Math.trunc(row.AS)}</span>
              </>
            ) : (
              '-'
            )}
          </th>
          <th className="odds-team-name">
            {at}
            {roleSuffix(false)}
          </th>
        </tr>
        <tr>
          <th>구분</th>
          <th className={favColClass('w')}>승</th>
          <th>무</th>
          <th className={favColClass('l')}>패</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, w, d, l]) => {
          const colClass = label === '국내 핸디' ? khColClass : favColClass
          return (
            <tr key={label}>
              <td className="row-label">{label}</td>
              <td className={colClass('w')}>{numOrDash(row[w])}</td>
              <td>{numOrDash(row[d])}</td>
              <td className={colClass('l')}>{numOrDash(row[l])}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// 색 경계는 리그 표(web/.../columnGroups.js cellStyle)와 똑같이 맞춘다.
// 규칙 한 문장: "초록이면 플핸에 유리". 정승만 낮을수록 초록이고 나머지는 높을수록 초록.
const R_DEEP = { background: '#1B5E20', color: '#fff', fontWeight: 700 }
const R_GOOD = { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
const R_MID = { background: '#FBC02D', color: '#0D1B2A' }
const R_WARN = { background: '#EF6C00', color: '#fff', fontWeight: 700 }
const R_BAD = { background: '#C62828', color: '#fff', fontWeight: 700 }

function riskCellStyle(kind, n) {
  if (n === null || Number.isNaN(n)) return { color: '#9E9E9E' }
  if (kind === 'win') {          // 정승 — 정배가 셀수록 플핸에 불리
    if (n < 40) return R_GOOD
    if (n < 55) return R_MID
    if (n < 70) return R_WARN
    return R_BAD
  }
  if (kind === 'nh') {           // 플핸무 — 실측 평균 68~70%, 5~95% 범위 44~85%
    if (n >= 85) return R_DEEP
    if (n >= 75) return R_GOOD
    if (n >= 65) return R_MID
    if (n >= 55) return R_WARN
    return R_BAD
  }
  // 플 — 분포가 플핸무와 다르다(실측 평균 44~46%, 5~95% 범위 20~62%)
  if (n >= 55) return R_DEEP
  if (n >= 48) return R_GOOD
  if (n >= 41) return R_MID
  if (n >= 34) return R_WARN
  return R_BAD
}

function RiskCard({ row }) {
  const toN = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  // 리그 표(columnGroups.js RISK_GROUPS)와 같은 8칸을 같은 순서로 보여준다.
  // 값은 전부 백엔드가 "그 일이 일어날 확률(%)"로 내려주므로 뒤집지 않는다.
  // 핸무는 '플핸무 − 플'로 나오므로 칸을 따로 두지 않는다.
  const groups = [
    ['정승 %', 'win', [
      ['국)정', toN(row.WIN_RISK)],
      ['해)정', toN(row.WIN_RISK_F)],
    ]],
    ['플핸무 %', 'nh', [
      ['국)플', toN(row.NH_KO)],
      ['국)지', toN(row.NH_KI)],
      ['해)지', toN(row.NH_FI)],
    ]],
    ['플 %', 'pl', [
      ['국)플', toN(row.PL_KO)],
      ['국)지', toN(row.PL_KI)],
      ['해)지', toN(row.PL_FI)],
    ]],
  ]
  return (
    <table className="detail-table risk-table">
      <thead>
        <tr>
          {groups.map(([title, , cols], gi) => (
            <th
              key={title}
              colSpan={cols.length}
              className={`risk-group${gi < groups.length - 1 ? ' risk-edge' : ''}`}
            >
              {title}
            </th>
          ))}
        </tr>
        <tr>
          {groups.flatMap(([title, , cols], gi) =>
            cols.map(([label], ci) => (
              <th
                key={`${title}-${label}`}
                className={ci === cols.length - 1 && gi < groups.length - 1 ? 'risk-edge' : ''}
              >
                {label}
              </th>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        <tr>
          {groups.flatMap(([title, kind, cols], gi) =>
            cols.map(([label, n], ci) => (
              <td
                key={`${title}-${label}`}
                className={ci === cols.length - 1 && gi < groups.length - 1 ? 'risk-edge' : ''}
                style={riskCellStyle(kind, n)}
              >
                {n === null ? '-' : `${n.toFixed(0)}%`}
              </td>
            ))
          )}
        </tr>
      </tbody>
    </table>
  )
}

function formOrDash(v) {
  return v === null || v === undefined || v === '' ? '-' : String(v)
}

// 백엔드(standings.py)가 그 경기 '직전까지'의 시즌 성적으로 계산해 붙여준 값들.
// 홈/원정 각각 전체폼·최근5폼과, 홈팀은 홈경기만·원정팀은 원정경기만의 폼을 나란히 본다.
function FormTable({ row }) {
  return (
    <table className="detail-table form-table">
      <thead>
        <tr>
          <th colSpan={3}>홈</th>
          <th colSpan={3}>원정</th>
        </tr>
        <tr>
          <th>전체폼</th>
          <th>최근5폼</th>
          <th>홈경기</th>
          <th>원정경기</th>
          <th>최근5폼</th>
          <th>전체폼</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={formStyle(row.HTF)}>{formOrDash(row.HTF)}</td>
          <td style={formStyle(row.HRF)}>{formOrDash(row.HRF)}</td>
          <td style={formStyle(row.HF)}>{formOrDash(row.HF)}</td>
          <td style={formStyle(row.AF)}>{formOrDash(row.AF)}</td>
          <td style={formStyle(row.ARF)}>{formOrDash(row.ARF)}</td>
          <td style={formStyle(row.ATF)}>{formOrDash(row.ATF)}</td>
        </tr>
      </tbody>
    </table>
  )
}

// 최근 10경기 승패. 홈팀은 왼쪽이 과거→오른쪽이 최신, 원정팀은 왼쪽이 최신→오른쪽이 과거라
// 두 팀의 '가장 최근 경기'가 가운데에서 마주보게 된다 (백엔드가 이미 그 순서로 만들어 보낸다).
// 10경기 미만(시즌 초반 등)이면 각자 자기 쪽 바깥쪽 끝부터 채워 구분선 쪽으로 자라난다 —
// 홈팀은 왼쪽 끝부터(그대로, offset 없음), 원정팀은 오른쪽 끝부터(alignEnd로 offset을 줘서
// 뒤에서부터 채움) 채우므로, 경기가 쌓일수록 최신 경기가 구분선에 가까워진다.
// HR10/AR10 문자열과 HR10H/AR10H(같은 자리수의 'H'/'A')를 나란히 훑어 칸 10개를 만들고,
// 그 경기가 홈경기였던 칸만 배경을 칠해 눈에 띄게 한다.
function recentCells(results, venues, alignEnd = false) {
  const offset = alignEnd ? Math.max(0, 10 - results.length) : 0
  return Array.from({ length: 10 }, (_, i) => {
    const idx = i - offset
    return {
      ch: idx >= 0 ? results[idx] || '' : '',
      isHome: idx >= 0 ? venues[idx] === 'H' : false,
    }
  })
}

// 그 팀이 이 경기 '직전까지' 그 리그에서 세운 최고 연속 기록 4종.
// 위 최근10경기 칸이 홈=왼쪽 / 원정=오른쪽으로 갈라져 있으므로 그 방향을 그대로 잇는다.
// 표기는 CLAUDE.md 6-2 규칙(가운뎃점 나열, 값은 밝게, 간격은 flex gap).
const STREAK_ITEMS = [
  ['win', '연승'],
  ['unbeaten', '무패'],
  ['winless', '무승'],
  ['lose', '연패'],
]

function StreakLine({ data, align }) {
  if (!data || !data.played) return null
  return (
    <span className={`streak-line streak-${align}`}>
      {STREAK_ITEMS.map(([key, label]) => (
        <span key={key} className="streak-item">
          {label} <strong>{data[key]}</strong>
        </span>
      ))}
    </span>
  )
}

function RecentTable({ row, streaks }) {
  // 시즌 첫 라운드면 아직 치른 경기가 없어 양쪽 다 비어 있다 — 폼 지표와 같이 '-'로 둔다.
  const homeCells = recentCells(String(row.HR10 || ''), String(row.HR10H || ''))
  const awayCells = recentCells(String(row.AR10 || ''), String(row.AR10H || ''), true)
  const hasStreak = streaks && (streaks.home?.played || streaks.away?.played)
  return (
    <>
      <table className="detail-table recent-table">
        <thead>
          <tr>
            <th colSpan={10}>홈팀최근 →</th>
            <th colSpan={10}>← 원정팀 최근</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {homeCells.map((c, i) => (
              <td key={`h${i}`} className={`recent-cell recent-${c.ch} ${c.isHome ? 'recent-cell-home' : ''}`}>
                {c.ch || '-'}
              </td>
            ))}
            {awayCells.map((c, i) => (
              <td key={`a${i}`} className={`recent-cell recent-${c.ch} ${c.isHome ? 'recent-cell-home' : ''}`}>
                {c.ch || '-'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {hasStreak && (
        <div className="streak-row">
          <StreakLine data={streaks.home} align="left" />
          <StreakLine data={streaks.away} align="right" />
        </div>
      )}
    </>
  )
}

// 한 행의 4칸(핸승/핸무/무/역) 중 최댓값 칸엔 cell-max, 그다음으로 큰(서로 다른 값) 칸엔
// 톤다운된 cell-second를 준다. 전부 0이면 강조 안 하고, 2등이 0이어도 강조하지 않는다.
function maxCellClass(vals, i) {
  const max = Math.max(...vals)
  if (max <= 0) return ''
  if (vals[i] === max) return 'cell-max'
  const second = Math.max(...vals.filter((v) => v < max))
  return second > 0 && vals[i] === second ? 'cell-second' : ''
}

// TK-*/TF-* ("국/통", "해/통")는 그 리그를 통합DB(6대리그 등 여러 리그 합산)와
// 섞은 지표다. 내 데이터는 리그 하나만 있어 통합 대상이 없으므로 항상 국내/해외
// 지표와 값이 완전히 같아진다 — 의미 없는 중복이라 내 데이터에서는 아예 뺀다.
// 지표별 표본에서 '판단에 쓰는 9줄'을 테두리로 짚어준다.
// 통합(TF-*/TK-*)은 6대리그를 합쳐 표본은 크지만 그만큼 리그 특성이 뭉개져서 뺐고,
// 리그 안에서만 센 지표만 남긴다. 한 경기에서 실제로 강조되는 건 아래 9줄이다.
//
//   방향에 따라 갈리는 4줄   해)승·패   해)정배팀   국)승·패   국)정배팀
//   방향과 무관한 4줄        해)승+패   해)승+무+패   국)승+패   국)승+무+패
//   역할 기준 1줄            국)플핸
//
// [방향에 따라 갈리는 줄] 배당이 낮은 쪽이 정배다. 국내는 KW/KL, 해외는 FW/FL로 각각
// 따로 판정한다 — 둘이 서로 다른 팀을 정배로 보는 경기가 실측 4.25%(16,748경기 중
// 711건) 있는데, 그 엇갈림 자체가 "국내와 해외 시장이 갈렸다"는 볼 만한 신호라
// 하나로 합치지 않는다. 승=홈팀은 "홈팀이 정배일 때 승"만 모은 지표라 홈팀이 정배가
// 아니면 이 경기와 무관하고, 패=원정팀도 마찬가지다 — 그래서 기준팀(홈/원정) 자체가
// 정배인지로 따로 판정한다.
//
// [방향과 무관한 줄] 승+패·승+무+패는 승·패 배당을 동시에 맞추는 조건이라 정배가
// 어느 쪽이든 표본이 그대로다. 그래서 조건 없이 항상 넣는다.
//
// [국)플핸] 나머지가 "홈 칸이냐 원정 칸이냐"(자리 기준)인 것과 달리 이것만 "정배냐
// 언더독이냐"(역할 기준)로 찾는다 — 언더독 쪽 핸디배당이 같고 언더독이 같은 편인 경기.
// 자리 기준이 아니라서 정배 방향과 무관하게 항상 대상이다.
function favSampleCodes(row) {
  const out = new Set(['F-WL', 'F-WDL', 'K-WL', 'K-WDL', 'K-PL'])
  const pick = (winKey, loseKey, winCode, loseCode, homeWinCode, awayLoseCode) => {
    const w = numOrNull(row[winKey])
    const l = numOrNull(row[loseKey])
    if (w === null || l === null || w === l) return   // 배당이 없거나 같으면 정배가 없다
    out.add(w < l ? winCode : loseCode)
    if (w < l) out.add(homeWinCode)
    else out.add(awayLoseCode)
  }
  pick('KW', 'KL', 'K-W', 'K-L', 'K-W-HT', 'K-L-AT')
  pick('FW', 'FL', 'F-W', 'F-L', 'F-W-HT', 'F-L-AT')
  return out
}

// 표본이 이만큼이면 그 줄을 '절반쯤' 믿는다. 아래 SAMPLE_SHRINK 주석 참고.
const SAMPLE_SHRINK = 10

// 국내·해외 블록 끝에 붙는 '분석' 줄. 가중평균이라 건수가 없어 %만 보여준다.
function AnalysisRow({ label, vals }) {
  return (
    <tr className="sample-analysis-row">
      <td className="row-label">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={maxCellClass(vals, i)}>
          {v.toFixed(1)}%
        </td>
      ))}
      <td className="col-total">—</td>
    </tr>
  )
}

// 접힌 표의 국내·해외 블록 끝에 붙는 '분석' 줄을 만든다.
//
// 무게 = 단계 가중치 × 표본 신뢰도
//   단계 가중치   위에서 아래로 1,2,3,4,5 — 아래로 갈수록 조건이 좁아(이 경기와 더 닮아)
//                 무겁게 본다.
//   표본 신뢰도   n / (n + 10) — 조건이 좁아질수록 표본도 같이 줄기 때문에 단계 가중치만
//                 쓰면 1건짜리가 9건짜리보다 3~4배 무거워진다. 실제로 그렇게 계산해 보면
//                 41건이 '무 39%'라고 말하는데 1건짜리 '역 100%' 두 줄에 밀려 결론이
//                 '역'으로 뒤집혔다(시타르트 vs 알크마르 실측). 표본이 쌓이면 이 값이
//                 1에 가까워져 단계 가중치가 원래대로 작동한다.
//
// 표본이 0인 줄은 무게가 0이라 자동으로 빠진다.
function weightedAnalysis(lines) {
  const acc = [0, 0, 0, 0]
  let wSum = 0
  lines.forEach((l, i) => {
    if (l.total <= 0) return
    const w = (i + 1) * (l.total / (l.total + SAMPLE_SHRINK))
    wSum += w
    for (let k = 0; k < 4; k += 1) acc[k] += (l.vals[k] / l.total) * 100 * w
  })
  if (wSum <= 0) return null
  return acc.map((v) => v / wSum)
}

// expanded=false(기본)면 판단에 쓰는 9줄만 보여준다. 그때는 보이는 게 전부 대상이라
// 테두리 강조를 걸지 않는다 — 다 강조하면 강조가 아니게 되기 때문. 펼쳐서 27줄을
// 다 보여줄 때만 그 9줄에 테두리를 둘러 어느 것이 대상인지 구분해 준다.
function SampleTable({ row, scope, expanded }) {
  const favCodes = favSampleCodes(row)
  const indicators = scope === 'user'
    ? SAMPLE_INDICATORS.filter(([code]) => !code.startsWith('TK-') && !code.startsWith('TF-'))
    : SAMPLE_INDICATORS
  const allLines = indicators.map(([code, label]) => {
    const vals = [1, 2, 3, 4].map((i) => {
      const v = row[`${code} ${i}`]
      const n = Number(v)
      return Number.isNaN(n) ? 0 : Math.trunc(n)
    })
    const total = vals.reduce((a, b) => a + b, 0)
    return { code, label, vals, total }
  })
  const lines = expanded ? allLines : allLines.filter((l) => favCodes.has(l.code))

  // 토탈은 '지금 화면에 보이는 줄'의 합이다 — 접었을 때 안 보이는 줄까지 더하면
  // 눈에 보이는 숫자와 합이 안 맞아 읽는 사람이 검산할 수 없다.
  const grandVals = [0, 1, 2, 3].map((i) => lines.reduce((sum, l) => sum + l.vals[i], 0))
  const grandTotal = grandVals.reduce((a, b) => a + b, 0)

  // 접었을 때만 국내/해외 블록 끝에 '분석' 줄을 붙인다. 펼치면 통합지표까지 섞여
  // 들어와 '리그 지표만 본다'는 전제가 깨지므로 그때는 계산하지 않는다.
  const isForeignCode = (c) => /^(F|TF)-/.test(c)
  const domAnalysis = expanded ? null : weightedAnalysis(lines.filter((l) => !isForeignCode(l.code)))
  const forAnalysis = expanded ? null : weightedAnalysis(lines.filter((l) => isForeignCode(l.code)))
  // 토탈 = 국내 분석과 해외 분석의 평균(한쪽만 있으면 그쪽만).
  const bothAnalysis = [domAnalysis, forAnalysis].filter(Boolean)
  const totalAnalysis = bothAnalysis.length
    ? [0, 1, 2, 3].map((i) => bothAnalysis.reduce((s, a) => s + a[i], 0) / bothAnalysis.length)
    : null

  return (
    <table className="detail-table sample-table">
      <thead>
        <tr>
          <th>지표</th>
          <th className="col-hs">핸승</th>
          <th className="col-hm">핸무</th>
          <th className="col-mu">무</th>
          <th className="col-yk">역</th>
          <th>토탈</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, li) => {
          const isForeign = isForeignCode(l.code)
          const prev = li > 0 ? lines[li - 1] : null
          const groupStart = prev && isForeign && !isForeignCode(prev.code)
          // 펼쳤을 때만 대상 9줄에 테두리를 두른다(위 컴포넌트 주석 참고).
          const cls = [
            groupStart && 'sample-group-start',
            expanded && favCodes.has(l.code) && 'sample-fav-row',
          ].filter(Boolean).join(' ')
          return (
            <Fragment key={l.code}>
              {/* 국내 블록이 끝나는 자리(= 해외 첫 줄 직전)에 국내 분석을 끼운다 */}
              {groupStart && domAnalysis && (
                <AnalysisRow label="국) 분석" vals={domAnalysis} />
              )}
              <tr className={cls || undefined}>
                <td className="row-label">{l.label}</td>
                {/* 위=비율, 아래=건수. 개수만으로는 지표마다 표본 크기가 달라
                    (해통 972건 vs 국통 136건) 어디로 쏠렸는지 비교가 안 된다. */}
                {l.vals.map((v, i) => (
                  <td key={i} className={maxCellClass(l.vals, i)}>
                    {l.total > 0 ? `${Math.round((v / l.total) * 100)}%` : '-'}
                    <span className="sample-n">{v}</span>
                  </td>
                ))}
                <td className="col-total">{l.total}</td>
              </tr>
            </Fragment>
          )
        })}
        {/* 해외 분석은 마지막 줄 뒤라 위 반복문 밖에서 붙인다 */}
        {forAnalysis && <AnalysisRow label="해) 분석" vals={forAnalysis} />}
        {totalAnalysis ? (
          <tr className="sample-grand-total">
            <td className="row-label">토탈</td>
            {totalAnalysis.map((v, i) => (
              <td key={i} className={maxCellClass(totalAnalysis, i)}>
                {v.toFixed(1)}%
              </td>
            ))}
            <td className="col-total">{grandTotal}</td>
          </tr>
        ) : (
          <tr className="sample-grand-total">
            <td className="row-label">토탈</td>
            {grandVals.map((v, i) => (
              <td key={i} className={maxCellClass(grandVals, i)}>
                {grandTotal > 0 ? `${Math.round((v / grandTotal) * 100)}%` : '-'}
                <span className="sample-n">{v}</span>
              </td>
            ))}
            <td className="col-total">{grandTotal}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// 내픽 선택 + 한줄 메모 — 별표(중요)는 제목 옆 버튼으로 따로 처리한다.
// onSavePick(patch)가 실제 저장을 담당하고, 여기선 즉시(낙관적) 반영만 한다.
function MyPickBar({ row, onSavePick }) {
  const [pick, setPick] = useState(row.MY_PICK || '')
  const [p, setP] = useState(row.MY_P || '')
  const [hit, setHit] = useState(row.MY_HIT || '')
  const [memo, setMemo] = useState(row.MEMO || '')
  const [savedMemo, setSavedMemo] = useState(row.MEMO || '')

  function handlePickChange(e) {
    const next = e.target.value
    setPick(next)
    onSavePick({ pick: next || null })
  }

  function handlePChange(e) {
    const next = e.target.value
    setP(next)
    onSavePick({ p: next || null })
  }

  function handleHitChange(e) {
    const next = e.target.value
    setHit(next)
    onSavePick({ hit: next || null })
  }

  function saveMemoIfChanged() {
    if (memo === savedMemo) return
    setSavedMemo(memo)
    onSavePick({ memo: memo || null })
  }

  return (
    <div className="mypick-bar">
      <label className="mypick-bar-field">
        내픽
        <select value={pick} onChange={handlePickChange}>
          <option value="">선택 안함</option>
          {PICK_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field">
        P
        <select value={p} onChange={handlePChange}>
          <option value="">선택 안함</option>
          {P_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field">
        의견
        <select value={hit} onChange={handleHitChange}>
          <option value="">선택 안함</option>
          {HIT_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field mypick-bar-memo">
        <input
          type="text"
          value={memo}
          placeholder="경기에 대한 메모를 입력해주세요"
          onChange={(e) => setMemo(e.target.value)}
          onBlur={saveMemoIfChanged}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
    </div>
  )
}

// 시즌전적처럼 '홈/원정 × 핸승/핸무/무/역' 숫자가 나열식 문장으로 나오면 자릿수가
// 안 맞아 읽기 힘들다 — 표로 그려서 라벨(홈/원정) 폭을 맞추고 숫자 칸에 구분선을 준다.
function SeasonRowsTable({ rows }) {
  return (
    <table className="detail-table pick-season-table">
      <thead>
        <tr>
          <th className="row-label" />
          <th>핸승</th>
          <th>핸무</th>
          <th>무</th>
          <th>역</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.side}>
            <td className="row-label">
              {r.side}
              {r.role ? `(${r.role})` : ''}
            </td>
            {['핸승', '핸무', '무', '역'].map((k) => (
              <td key={k}>{r.counts ? r.counts[k] : '-'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// /api/pick_ai 응답에서 신호 하나를 꺼낸다. 종합분석 카드를 화면에서 뺀 뒤로는
// 시즌전적(season)과 상대전적(h2h) 둘만 쓴다 — 나머지 신호는 계산만 되고 안 그린다.
function findSignal(data, key) {
  if (!data || !data.available || !Array.isArray(data.signals)) return null
  return data.signals.find((s) => s.key === key) || null
}

// 확률 지표 밴드. 예전에는 이 위에 '종합 분석' 카드 4장(플핸무 확률·해외지표·국내지표·
// 상대전적)이 같이 있었는데 화면에서 뺐다 — 계산은 그대로 남아 있고(api/pick_ai.py,
// /api/pick_ai), 시즌전적과 상대전적 문장만 아래 표 쪽으로 옮겨 붙였다.
function PickBand({ row }) {
  return (
    <section className="pick-band">
      <div className="pick-band-risk">
        <h3>
          확률 지표{' '}
          <span className="detail-section-note">
            앞글자 = 시장(국/해) · 뒷글자 = 재료(정 승무패배당 · 플 핸디배당 · 지 26지표)
          </span>
        </h3>
        <RiskCard row={row} />
      </div>
    </section>
  )
}

export default function MatchDetailModal({ code, row, scope, onClose, onSavePick }) {
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const rt = rtLabel(row.RT)
  const homeFav = homeIsFav(row)
  const titleRoleSuffix = (isHome) => {
    if (homeFav === null) return null
    const isFav = isHome ? homeFav : !homeFav
    return <span className={isFav ? 'odds-role-fav' : 'odds-role-dog'}> {isFav ? '(정)' : '(역)'}</span>
  }
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 종합분석(4개 신호)과 상대전적을 팝업 하나당 한 번만 계산해서 두 카드가 같이
  // 쓴다(예전엔 상대전적 카드가 /api/head_to_head를 따로 불러 같은 두 팀·같은 계산을
  // 서버에서 한 번 더 했다 — 그래서 팝업을 처음 열 때 유독 느렸다).
  // row는 LeagueTable이 매 렌더마다 새로 만들어 넘기는 객체다(스프레드로 내픽을 얹어서
  // 준다). row 자체를 의존성에 걸면 표가 다시 그려질 때마다 재계산을 요청하게 되어,
  // 경기를 가리키는 값들만 문자열로 묶어 그것이 바뀔 때만 호출한다.
  const rowRef = useRef(row)
  rowRef.current = row
  const matchKey = [row.S, row.R, row.No, row.HT, row.AT].join('|')
  // 지표별 표본은 기본이 '접힘' — 판단에 쓰는 9줄만 보여주고, 펼치면 27줄 전체가 나온다.
  const [sampleExpanded, setSampleExpanded] = useState(false)
  const [pickData, setPickData] = useState(null)
  const [pickError, setPickError] = useState('')
  // 종합분석 카드를 화면에서 뺀 뒤로 이 응답에서 실제로 쓰는 건 이 둘과 streaks뿐이다.
  const seasonSig = findSignal(pickData, 'season')
  const h2hSig = findSignal(pickData, 'h2h')

  useEffect(() => {
    let alive = true
    setPickData(null)
    setPickError('')
    api
      .post('/api/pick_ai', { scope, code, row: rowRef.current })
      .then((res) => alive && setPickData(res))
      .catch((err) => alive && setPickError(err.message))
    return () => {
      alive = false
    }
  }, [code, scope, matchKey])

  // 지표별 표본은 그 경기 데이터양대로 자연스러운 높이 그대로 두고, 상대전적(히스토리가
  // 많을수록 길어짐) 쪽의 아래 테두리를 지표별 표본의 아래 테두리와 맞춘다.
  // 단순히 "지표별 표본 자기 높이"를 상대전적 max-height로 그대로 쓰면 안 된다 — 왼쪽
  // 칸은 위에 '배당' 하나만 있고 오른쪽 칸은 '폼 지표'+'최근10경기' 둘이 있어서, 상대전적이
  // 시작하는 y좌표 자체가 지표별 표본보다 더 아래다. 그래서 두 카드의 높이가 같아도
  // 아래 끝은 안 맞는다 — 대신 "지표별 표본의 화면상 아래쪽 y좌표 − 상대전적이 시작하는
  // y좌표"를 상대전적의 max-height로 써야 두 카드의 아래 끝이 실제로 일직선이 된다.
  // 위쪽에 있는 카드들(배당/폼 지표/최근10경기) 높이가 바뀌어도 다시 재야 해서, 개별
  // 요소가 아니라 전체 modal-columns 크기 변화를 관찰한다.
  const sampleSectionRef = useRef(null)
  const h2hSectionRef = useRef(null)
  const columnsRef = useRef(null)
  const [h2hMaxHeight, setH2hMaxHeight] = useState(null)

  useEffect(() => {
    const sampleEl = sampleSectionRef.current
    const h2hEl = h2hSectionRef.current
    const columnsEl = columnsRef.current
    if (!sampleEl || !h2hEl || !columnsEl) return
    const update = () => {
      const sampleBottom = sampleEl.getBoundingClientRect().bottom
      const h2hTop = h2hEl.getBoundingClientRect().top
      setH2hMaxHeight(Math.max(0, sampleBottom - h2hTop))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(columnsEl)
    return () => ro.disconnect()
  }, [])

  async function handleDownload() {
    setDownloading(true)
    setDownloadError('')
    try {
      const params = new URLSearchParams({
        scope,
        season: String(row.S ?? ''),
        round: String(row.R ?? ''),
        no: String(row.No ?? ''),
      })
      const { blob, filename } = await api.download(
        `/api/leagues/${code}/match_excel?${params.toString()}`
      )
      saveBlob(blob, filename)
    } catch (err) {
      setDownloadError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">
          <span>
            {ht}
            {rankSuffix(row.HP)}
            {titleRoleSuffix(true)}
            <TeamBetRecord name={ht} /> vs {at}
            {rankSuffix(row.AP)}
            {titleRoleSuffix(false)}
            <TeamBetRecord name={at} />
          </span>
          <button
            className={`star-btn ${isStarred(row.IMPORTANT) ? 'star-on' : ''}`}
            title={isStarred(row.IMPORTANT) ? '중요 표시 해제' : '중요 표시'}
            onClick={() => onSavePick({ important: !isStarred(row.IMPORTANT) })}
          >
            {isStarred(row.IMPORTANT) ? '★' : '☆'}
          </button>
        </h2>
        <p className="modal-meta">
          {row.S} · {row.R}
          {row.DT ? ` · ${formatDt(row.DT)}` : ''}
          {formatTime(row.TM) ? ` ${formatTime(row.TM)}` : ''}
          &nbsp;&nbsp;
          {rt ? <RtBadge label={rt} /> : <span className="modal-scheduled">예정 경기</span>}
        </p>
        <MyPickBar row={row} onSavePick={onSavePick} />

        <PickBand row={row} />

        <div className="modal-columns" ref={columnsRef}>
          <div className="modal-col">
            <section className="detail-section">
              <h3>
                배당 <DdongNote row={row} />
              </h3>
              <OddsTable row={row} />
            </section>
            <section className="detail-section" ref={sampleSectionRef}>
              <h3>
                <button
                  className="sample-fold-btn"
                  onClick={() => setSampleExpanded((v) => !v)}
                  title={sampleExpanded ? '판단에 쓰는 지표만 보기' : '전체 지표 보기'}
                  aria-expanded={sampleExpanded}
                >
                  {sampleExpanded ? '▾' : '▸'}
                </button>
                지표별 표본{' '}
                <span className="detail-section-note">
                  {sampleExpanded ? '전체' : '판단에 쓰는 지표만'}
                </span>
              </h3>
              <SampleTable row={row} scope={scope} expanded={sampleExpanded} />
            </section>
          </div>
          <div className="modal-col">
            {/* 시즌전적 + 폼 지표를 한 줄에 나란히 — 둘 다 '이 팀이 요즘 어떤가'를
                보는 값이라 붙여 두면 눈이 한 번에 읽는다(시즌전적이 왼쪽). */}
            <div className="detail-pair">
              <section className="detail-section">
                {/* note 원문은 한 문장이 길어(‘오늘과 같은 정배/역배 구도였던 …’) 제목 줄이
                    두 줄로 흘러 옆 폼 지표를 밀어낸다 — 짧게 줄이고 원문은 title로 남긴다. */}
                <h3>
                  시즌전적{' '}
                  {seasonSig && seasonSig.note && (
                    <span className="detail-section-note" title={seasonSig.note}>
                      같은 정배 구도였던 이번 시즌 경기
                    </span>
                  )}
                </h3>
                {seasonSig && seasonSig.rows ? (
                  <SeasonRowsTable rows={seasonSig.rows} />
                ) : (
                  <p className="pick-loading">
                    {pickError || (!pickData ? '계산 중...' : (seasonSig ? seasonSig.value_text : '—'))}
                  </p>
                )}
              </section>
              <section className="detail-section">
                <h3>폼 지표</h3>
                <FormTable row={row} />
              </section>
            </div>
            <section className="detail-section">
              <h3>
                최근10경기 전적{' '}
                <span className="detail-section-note">
                  <span className="recent-home-swatch" /> 홈경기 · 경기 직전까지 그 리그에서 세운 최다 기록
                </span>
              </h3>
              <RecentTable row={row} streaks={pickData ? pickData.streaks : null} />
            </section>
            <section
              className="detail-section detail-section-grow"
              ref={h2hSectionRef}
              style={h2hMaxHeight ? { maxHeight: `${h2hMaxHeight}px` } : undefined}
            >
              <h3>
                상대전적{' '}
                {/* 예전 종합분석 '상대전적' 카드에 있던 문장(맞대결 평균 총득점).
                    확률 계산에는 안 들어가는 참고값이라 제목 옆에 붙여만 둔다. */}
                {h2hSig && h2hSig.value_text && (
                  <span className="detail-section-note">{h2hSig.value_text}</span>
                )}{' '}
                <span className="detail-section-note">승점은 홈팀 기준으로 작성되었습니다.</span>
              </h3>
              <HeadToHeadResult
                scope={scope} code={code} home={ht} away={at} cross
                preset={pickData ? pickData.h2h : null}
                presetLoading={!pickData && !pickError}
                presetError={pickError}
              />
            </section>
          </div>
        </div>

        <div className="modal-footer">
          {downloadError && <p className="error-text">{downloadError}</p>}
          <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
            {downloading ? '다운로드 중...' : '엑셀 다운로드'}
          </button>
        </div>
      </div>
    </div>
  )
}
