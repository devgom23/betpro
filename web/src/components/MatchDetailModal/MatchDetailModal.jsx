import { useEffect, useRef, useState } from 'react'
import { api, saveBlob } from '../../api/client'
import HeadToHeadResult from '../HeadToHead/HeadToHeadResult'
import RtBadge from '../RtBadge/RtBadge'
import { isStarred, formatTime, scoreClass } from '../../utils/format'
import './MatchDetailModal.css'

const PICK_OPTIONS = ['대기', '축플', '축정', '플핸', '플핸무', '정', '정무', '핸승', '핸무', '무', '역', '무핸무']
const HIT_OPTIONS = ['패스', '패스고민', '벳고민', '축', '메인벳', 'S벳']

function rtLabel(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  return { 1: '핸승', 2: '핸무', 3: '무', 4: '역', 5: '취소' }[Math.trunc(n)] || ''
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
  ['K-W', '국) 승'], ['K-L', '국) 패'], ['K-WL', '국) 승+패'], ['K-WDL', '국) 승+무+패'],
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
    if (homeFav === null) return ''
    const isFav = isHome ? homeFav : !homeFav
    return isFav ? ' (정)' : ' (역)'
  }
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
          <th>승</th>
          <th>무</th>
          <th>패</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, w, d, l]) => (
          <tr key={label}>
            <td className="row-label">{label}</td>
            <td>{numOrDash(row[w])}</td>
            <td>{numOrDash(row[d])}</td>
            <td>{numOrDash(row[l])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// 핸승값/배AI 경계(15/25/35/45%) — web/.../columnGroups.js cellStyle과 동일.
// 국정값/해정값만 분포가 달라 따로 경계(40/55/70%)를 쓴다 — 그쪽 주석 참고.
function riskCellStyle(kind, n) {
  if (n === null || Number.isNaN(n)) return { color: '#9E9E9E' }
  if (kind === 'win') {
    if (n < 40) return { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
    if (n < 55) return { background: '#FBC02D', color: '#0D1B2A' }
    if (n < 70) return { background: '#EF6C00', color: '#fff', fontWeight: 700 }
    return { background: '#C62828', color: '#fff', fontWeight: 700 }
  }
  if (n < 15) return { background: '#1B5E20', color: '#fff', fontWeight: 700 }
  if (n < 25) return { background: '#66BB6A', color: '#0D1B2A', fontWeight: 700 }
  if (n < 35) return { background: '#FBC02D', color: '#0D1B2A' }
  if (n < 45) return { background: '#EF6C00', color: '#fff', fontWeight: 700 }
  return { background: '#C62828', color: '#fff', fontWeight: 700 }
}

function RiskCard({ row }) {
  const toN = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const items = [
    ['핸승값', toN(row.RISK), 'std'],
    ['국정값', toN(row.WIN_RISK), 'win'],
    ['해정값', toN(row.WIN_RISK_F), 'win'],
    ['배당·AI', toN(row.AI_PICK), 'std'],
    ['K값', toN(row.K_VALUE), 'std'],
    ['F값', toN(row.F_VALUE), 'std'],
    ['KF·AI', toN(row.KF_AI), 'std'],
  ]
  return (
    <table className="detail-table">
      <thead>
        <tr>
          {items.map(([label]) => (
            <th key={label}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {items.map(([label, n, kind]) => (
            <td key={label} style={riskCellStyle(kind, n)}>
              {n === null ? '-' : label === '배당·AI' || label === 'KF·AI' ? `플${(100 - n).toFixed(0)}%` : `${n.toFixed(0)}%`}
            </td>
          ))}
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

function RecentTable({ row }) {
  // 시즌 첫 라운드면 아직 치른 경기가 없어 양쪽 다 비어 있다 — 폼 지표와 같이 '-'로 둔다.
  const homeCells = recentCells(String(row.HR10 || ''), String(row.HR10H || ''))
  const awayCells = recentCells(String(row.AR10 || ''), String(row.AR10H || ''), true)
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
      <p className="h2h-caption">
        <span className="recent-home-swatch" /> 색칠된 칸 = 그 팀 기준 홈경기
      </p>
    </>
  )
}

// 한 행의 4칸(핸승/핸무/무/역) 중 최댓값 칸에 표시할 클래스. 전부 0이면 강조 안 함.
function maxCellClass(vals, i) {
  const max = Math.max(...vals)
  return max > 0 && vals[i] === max ? 'cell-max' : ''
}

// TK-*/TF-* ("국/통", "해/통")는 그 리그를 통합DB(6대리그 등 여러 리그 합산)와
// 섞은 지표다. 내 데이터는 리그 하나만 있어 통합 대상이 없으므로 항상 국내/해외
// 지표와 값이 완전히 같아진다 — 의미 없는 중복이라 내 데이터에서는 아예 뺀다.
function SampleTable({ row, scope }) {
  const indicators = scope === 'user'
    ? SAMPLE_INDICATORS.filter(([code]) => !code.startsWith('TK-') && !code.startsWith('TF-'))
    : SAMPLE_INDICATORS
  const lines = indicators.map(([code, label]) => {
    const vals = [1, 2, 3, 4].map((i) => {
      const v = row[`${code} ${i}`]
      const n = Number(v)
      return Number.isNaN(n) ? 0 : Math.trunc(n)
    })
    const total = vals.reduce((a, b) => a + b, 0)
    return { code, label, vals, total }
  })

  const grandVals = [0, 1, 2, 3].map((i) => lines.reduce((sum, l) => sum + l.vals[i], 0))
  const grandTotal = grandVals.reduce((a, b) => a + b, 0)

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
          const isForeign = /^(F|TF)-/.test(l.code)
          const groupStart = li > 0 && isForeign && !/^(F|TF)-/.test(lines[li - 1].code)
          return (
            <tr key={l.code} className={groupStart ? 'sample-group-start' : undefined}>
              <td className="row-label">{l.label}</td>
              {l.vals.map((v, i) => (
                <td key={i} className={maxCellClass(l.vals, i)}>
                  {v}
                </td>
              ))}
              <td className="col-total">{l.total}</td>
            </tr>
          )
        })}
        <tr className="sample-grand-total">
          <td className="row-label">토탈</td>
          {grandVals.map((v, i) => (
            <td key={i} className={maxCellClass(grandVals, i)}>
              {v}
              {/* 네 결과가 전체 표본에서 각각 몇 %인지 — 어느 쪽으로 쏠렸는지 한눈에 보이게 */}
              {grandTotal > 0 && (
                <span className="grand-pct">({((v / grandTotal) * 100).toFixed(1)}%)</span>
              )}
            </td>
          ))}
          <td className="col-total">{grandTotal}</td>
        </tr>
      </tbody>
    </table>
  )
}

// 내픽 선택 + 한줄 메모 — 별표(중요)는 제목 옆 버튼으로 따로 처리한다.
// onSavePick(patch)가 실제 저장을 담당하고, 여기선 즉시(낙관적) 반영만 한다.
function MyPickBar({ row, onSavePick }) {
  const [pick, setPick] = useState(row.MY_PICK || '')
  const [hit, setHit] = useState(row.MY_HIT || '')
  const [memo, setMemo] = useState(row.MEMO || '')
  const [savedMemo, setSavedMemo] = useState(row.MEMO || '')

  function handlePickChange(e) {
    const next = e.target.value
    setPick(next)
    onSavePick({ pick: next || null })
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
        벳
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

// 종합픽 — 배당(기준선) 위에 지표·상대전적 보정을 얹어 플핸 확률 하나로 정리한 값.
// 계산 근거와 각 신호를 왜 쓰거나 안 쓰는지는 api/pick_ai.py 상단 주석에 실측과 함께 있다.
// 팝업을 열 때마다 백엔드에서 그 자리에서 계산한다(저장하지 않는 표시 전용 값).
// 신호 카드의 뱃지 문구는 백엔드가 내려주는 state/dir/value_text만으로 화면에서 판단한다
// (계산 로직은 그대로, 표시 방식만 바꾼 것 — pick_ai.py는 건드리지 않는다).
function sigBadge(s) {
  if (s.state === 'ok') {
    if (s.dir > 0) return { text: '핸승 쪽', tone: 'up' }
    if (s.dir < 0) return { text: '플핸 쪽', tone: 'down' }
    return { text: '기준선과 유사', tone: 'flat' }
  }
  if (s.state === 'none') return { text: '표본 부족', tone: 'none' }
  // state === 'info' (참고용·계산 미반영 신호)
  if (s.value_text.includes('판정 불가')) return { text: '데이터 없음', tone: 'none' }
  if (s.value_text.includes('표본 부족') || s.value_text.includes('표본 없음')) {
    return { text: '표본 부족', tone: 'none' }
  }
  return { text: '참고용', tone: 'none' }
}

function sigFootText(s) {
  return s.state === 'ok' && s.adjust !== 0 ? `${s.adjust > 0 ? '+' : ''}${s.adjust.toFixed(1)}%p` : '—'
}

function sigFootClass(s) {
  if (s.state !== 'ok') return ''
  if (s.adjust > 0) return 'pick-sig-foot-up'
  if (s.adjust < 0) return 'pick-sig-foot-down'
  return ''
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

function PickCards({ data }) {
  const { base, final, signals, warnings, consensus, consensus_text } = data
  return (
    <>
      <div className="pick-cards">
        <div className={`pick-verdict-card pick-grade-${final.grade_key}`}>
          <div className="pick-verdict-top">
            <span className="pick-verdict-label">플핸 성공 확률</span>
            <span className="pick-verdict-badge">{final.grade}</span>
          </div>
          <div className="pick-verdict-value">{final.pl.toFixed(0)}%</div>
          <div className="pick-bar">
            <div className="pick-bar-fill" style={{ width: `${Math.min(100, Math.max(0, final.pl))}%` }} />
            <div className="pick-bar-marker" style={{ left: `${Math.min(100, Math.max(0, base.pl))}%` }} />
          </div>
          <div className="pick-bar-scale">
            <span>0%</span>
            <span>기준선 {base.pl.toFixed(0)}%</span>
            <span>100%</span>
          </div>
          <div className="pick-verdict-base">
            <span className="pick-verdict-base-label">기준선 (배당)</span>
            배AI {base.ai_pick.toFixed(0)}% → 플핸 {base.pl.toFixed(0)}%
          </div>
        </div>
        {signals.map((s) => {
          const badge = sigBadge(s)
          return (
            <div key={s.key} className={`pick-sig-card pick-sig-card-${badge.tone}`}>
              <div className="pick-sig-top">
                <span className="pick-sig-label">{s.label}</span>
                <span className={`pick-sig-badge pick-sig-badge-${badge.tone}`}>{badge.text}</span>
              </div>
              {s.rows ? <SeasonRowsTable rows={s.rows} /> : <p className="pick-sig-desc">{s.value_text}</p>}
              {s.warn && <p className="pick-sig-warn">주의 · {s.warn}</p>}
              <div className="pick-sig-foot">
                <span className="pick-sig-foot-label">기준선 편차</span>
                <span className={`pick-sig-foot-val ${sigFootClass(s)}`}>{sigFootText(s)}</span>
              </div>
            </div>
          )
        })}
      </div>
      {(consensus_text || warnings.length > 0) && (
        <div className="pick-notes">
          {consensus_text && (
            <p
              className={`pick-consensus pick-consensus-${
                consensus === '불일치' ? 'off' : consensus === '핸승' || consensus === '플핸' ? 'on' : 'none'
              }`}
            >
              {consensus_text}
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className="pick-warn">
              주의 | {w}
            </p>
          ))}
        </div>
      )}
    </>
  )
}

function PickBand({ code, row, scope }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // row는 LeagueTable이 매 렌더마다 새로 만들어 넘기는 객체다(스프레드로 내픽을 얹어서
  // 준다). 그래서 row 자체를 의존성에 걸면 표가 다시 그려질 때마다 계산을 새로 요청해
  // 화면이 멈춘다 — 경기를 가리키는 값들만 문자열로 묶어 그것이 바뀔 때만 호출한다.
  const rowRef = useRef(row)
  rowRef.current = row
  const matchKey = [row.S, row.R, row.No, row.HT, row.AT].join('|')

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    api
      .post('/api/pick_ai', { scope, code, row: rowRef.current })
      .then((res) => alive && setData(res))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [code, scope, matchKey])

  return (
    <section className="pick-band">
      <div className="pick-band-head">
        <h3>종합픽</h3>
        <span className="pick-band-sub">4개 신호 · 배당 기준선 대비</span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!error && !data && <p className="pick-loading">계산 중...</p>}
      {!error && data && !data.available && <p className="pick-loading">{data.reason}</p>}
      {!error && data && data.available && <PickCards data={data} />}
    </section>
  )
}

export default function MatchDetailModal({ code, row, scope, onClose, onSavePick }) {
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const rt = rtLabel(row.RT)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
            {rankSuffix(row.HP)} vs {at}
            {rankSuffix(row.AP)}
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
          {row.DT ? ` · ${row.DT}` : ''}
          {formatTime(row.TM) ? ` ${formatTime(row.TM)}` : ''}
          &nbsp;&nbsp;
          {rt ? <RtBadge label={rt} /> : <span className="modal-scheduled">예정 경기</span>}
        </p>
        <MyPickBar row={row} onSavePick={onSavePick} />

        <PickBand code={code} row={row} scope={scope} />

        <div className="modal-columns">
          <div className="modal-col">
            <section className="detail-section">
              <h3>배당</h3>
              <OddsTable row={row} />
            </section>
            <section className="detail-section">
              <h3>핸승 위험도</h3>
              <RiskCard row={row} />
            </section>
            <section className="detail-section">
              <h3>지표별 표본</h3>
              <SampleTable row={row} scope={scope} />
            </section>
          </div>
          <div className="modal-col">
            <section className="detail-section">
              <h3>폼 지표</h3>
              <FormTable row={row} />
            </section>
            <section className="detail-section">
              <h3>최근10경기 전적</h3>
              <RecentTable row={row} />
            </section>
            <section className="detail-section detail-section-grow">
              <h3>상대전적</h3>
              <HeadToHeadResult scope={scope} code={code} home={ht} away={at} cross />
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
