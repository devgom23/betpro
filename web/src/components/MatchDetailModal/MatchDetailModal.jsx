import { Fragment, useEffect, useRef, useState } from 'react'
import { api, saveBlob } from '../../api/client'
import HeadToHeadResult from '../HeadToHead/HeadToHeadResult'
import RtBadge from '../RtBadge/RtBadge'
import StarButton, { nextStarLevel, starLevel } from '../StarButton/StarButton'
import { formatTime, formatDt, scoreClass } from '../../utils/format'
import { computeAutoVerdict, pickVerdictStyle } from '../LeagueTable/columnGroups'
import { PICK_OPTIONS, P_OPTIONS, HIT_OPTIONS, REASON_TAG_OPTIONS } from '../../utils/pickOptions'
import { oddsMoveGrade, oddsMoveTitle } from '../../utils/oddsMove'
import { h2hVerdict } from '../../utils/h2hVerdict'
import {
  drawTendency, drawRelation, VERDICT_TONE,
} from '../../utils/systemVerdict'
import {
  DIR_SIDE, SCOPE_CODES, scopeCell, oddsScopeCodes, directionName, weightedAnalysis,
  ODDS_PHASE_WEIGHTED_GRADE, PHASE_CELL_RATE, phaseVerdict, strongPickTier, STRONG_TIER_TITLE,
  CLOSE_ODDS_CUT_K, CLOSE_ODDS_CUT_F, favFlip,
  marketSetMoved, RISK_FIELD_MARKET, DIRECTION_SCOPE_MARKET, ODDS_SCOPE_MARKET,
} from '../../utils/verdictCalc'
import { teamStake, seasonEndWarn, SEASON_END_TITLE } from '../../utils/seasonStake'
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

// ⚠ 순서가 계산에 영향을 준다 — weightedAnalysis는 '이 배열에서 살아남은 순서'로
// 가중치를 매긴다(뒤에 있을수록 더 큼). 단, 판단 7줄(favSampleCodes)에 없는 지표는
// 그 계산에서 항상 걸러지므로 자리를 옮겨도 남는 줄의 상대 순서·가중치는 그대로다
// — filter는 걸러지는 원소와 무관하게 남는 원소의 순서를 지킨다. 지금 걸러지는 건
// 국통)·해통) 승+패/승+무+패(TK-WL 등, 2026-09-05 기본 화면에 보여주려고 끼워 둔 넷)와
// 승=홈팀·패=원정팀(2026-09-06 판단에서 뺐다 — favSampleCodes 주석 참고)이다.
const SAMPLE_INDICATORS = [
  ['K-W', '국) 승'], ['K-L', '국) 패'],
  ['K-W-HT', '국) 승=홈팀'], ['K-L-AT', '국) 패=원정팀'],
  // 27번 — 플핸측(언더독) 핸디배당이 같고 플핸측이 같은 편(홈/원정)인 과거 경기만.
  // 승·패 바로 아래에 둔다 — 셋 다 '이 경기 배당 하나'로 찾는 단일 조건 지표라
  // 두 배당을 동시에 맞추는 승+패·승+무+패보다 먼저 읽는 게 순서가 맞다.
  ['K-PL', '국) 플핸'],
  ['K-WL', '국) 승+패'], ['TK-WL', '국통) 승+패'],
  ['K-WDL', '국) 승+무+패'], ['TK-WDL', '국통) 승+무+패'],
  ['TK-W', '국통) 승'], ['TK-L', '국통) 패'],
  ['F-W', '해) 승'], ['F-L', '해) 패'],
  ['F-W-HT', '해) 승=홈팀'], ['F-L-AT', '해) 패=원정팀'],
  ['F-WL', '해) 승+패'], ['TF-WL', '해통) 승+패'],
  ['F-WDL', '해) 승+무+패'], ['TF-WDL', '해통) 승+무+패'],
  ['TF-W', '해통) 승'], ['TF-L', '해통) 패'],
]
// 지표별 표본 기본 화면(접힘)에서 판단 7줄과 함께 항상 보여주는 4줄 — 판정 계산에는
// 안 쓴다(판단 7줄에 못 들어감). '국)분석/해)분석' 줄은 이 4줄과 무관하게 계산해야
// 화면 숫자가 실제 방향성·판정과 어긋나지 않는다(SampleTable의 calcLines 참고).
const SAMPLE_DEFAULT_EXTRA = new Set(['TK-WL', 'TK-WDL', 'TF-WL', 'TF-WDL'])
// 이 8줄이 '방향성 (검토용)' 표(DirectionScopeTable의 SCOPE_CODES)가 그대로 쓰는
// 재료다 — 판정(7줄)이 쓰는 지표와는 다른 계산이라, 이름을 보라색으로 구분해
// 어느 지표가 어느 표에 쓰이는지 한눈에 갈리게 한다(2026-09-05).
const SAMPLE_SCOPE_CODES = new Set(['K-WL', 'K-WDL', 'TK-WL', 'TK-WDL', 'F-WL', 'F-WDL', 'TF-WL', 'TF-WDL'])

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// 지표별 표본의 배변 줄 — '배변(EK*/EF*) 컬럼이 있다'와 '실제로 배당이 움직였다'는
// 다르다(국내는 크롤러가 자주 돌아 안 움직여도 EKW=KW로 늘 채워진다 — kr_crawler.py
// "배변이 없었으면 초기배당과 같다" 주석 참고). 코드가 어느 시장(국내 K-/TK- vs
// 해외 F-/TF-) 기준인지 보고, 그 시장의 정배 가격(홈이 정배면 W, 원정이 정배면 L)이
// 초기·배변 사이에 실제로 달라졌을 때만 '움직였다'로 본다(2026-09-12 사용자 지정 —
// 안 움직였으면 배변 줄은 '-'로, 초기 줄과 표본이 달라 보여도 값을 안 보여준다).
function sampleOddsMoved(row, code) {
  let initKey
  let finKey
  // 국)플핸(K-PL)·국통)플핸(TK-PL)은 "자리 기준"(K-W/K-L처럼 홈=승/원정=패)이 아니라
  // "역할 기준"(언더독 쪽 핸디배당)이다 — 이 지표가 실제로 찾는 값은 KW/KL(승무패
  // 배당)이 아니라 KHW/KHL(핸디 배당)이라, 움직임도 그 시장으로 봐야 한다. KW/KL로
  // 보면 승무패는 안 움직였는데 핸디만 움직인 경기(예: 라치오 vs AC밀란 23-24 27R
  // — KW/KL은 그대로인데 KHW 1.58→1.61·KHL 4.20→4.10)에서 실제로 있는 배변 표본을
  // 통째로 숨기는 사고가 났다(2026-09-12 발견). 방향(언더독이 홈인지)은 engine.py
  // K-PL 계산과 똑같이 KW>KL(홈이 더 높으면 홈이 언더독)로 정한다.
  if (code === 'K-PL' || code === 'TK-PL') {
    const kw = numOrNull(row.KW)
    const kl = numOrNull(row.KL)
    if (kw === null || kl === null || kw === kl) return true
    ;[initKey, finKey] = kw > kl ? ['KHW', 'EKHW'] : ['KHL', 'EKHL']
  } else if (code.startsWith('K-') || code.startsWith('TK-')) {
    const w = numOrNull(row.KW)
    const l = numOrNull(row.KL)
    if (w === null || l === null || w === l) return true   // 정배를 못 가리면 안전하게 보여준다
    ;[initKey, finKey] = w < l ? ['KW', 'EKW'] : ['KL', 'EKL']
  } else if (code.startsWith('F-') || code.startsWith('TF-')) {
    const w = numOrNull(row.FW)
    const l = numOrNull(row.FL)
    if (w === null || l === null || w === l) return true
    ;[initKey, finKey] = w < l ? ['FW', 'EFW'] : ['FL', 'EFL']
  } else {
    return true
  }
  const a = numOrNull(row[initKey])
  const b = numOrNull(row[finKey])
  if (a === null || b === null) return true   // 값 자체가 없는 경우는 hasE 쪽에서 이미 걸러진다
  return a !== b
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

// homeIsFav와 달리 국내·해외를 하나로 합치지 않고 시장별로 따로 본다 — 두 시장이
// 서로 다른 팀을 정배로 보는 경기가 있는지 알아내는 용도(oddsSplitChips 참고).
function marketFavHome(w, l) {
  const a = numOrNull(w)
  const b = numOrNull(l)
  return a !== null && b !== null && a !== b ? a < b : null
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

// 경기지표 뱃지 한 칸 — '라벨 + 값' 한 덩어리.
// 라벨을 값에 붙여 두는 이유: 이 줄에는 성격이 다른 뱃지가 여러 개 늘어설 예정이라,
// 뱃지마다 자기가 무엇을 말하는지 스스로 설명해야 한다(제목 하나로는 못 가른다).
// tone을 주면 --chip-* 토큰으로 배경까지 칠한다(등급처럼 값 자체가 경고인 경우).
function MatchChip({ label, tone, title, children }) {
  const style = tone
    ? { background: `var(--chip-${tone}-bg)`, color: `var(--chip-${tone}-fg)` }
    : undefined
  return (
    <span className={`match-chip${tone ? ' match-chip-tone' : ''}`} style={style} title={title}>
      <span className="match-chip-label">{label}</span>
      <strong>{children}</strong>
    </span>
  )
}

// 똥배 뱃지 — 리그 표의 '똥배' 그룹(똥 / 분석 / 똥사)과 같은 값.
// 등급 경계와 색은 columnGroups.js의 DDONG_RISK_CUTS와 맞춰 둔다(계산 근거는
// api/data_access.py의 _ddong_risk 주석에 6대리그 실측과 함께 있다).
// 2026-08-30 '배당' 카드 제목 옆에 있던 것을 경기지표 줄로 옮겼다 — 배당에서 파생된
// 값이긴 하지만 성격은 '이 경기가 어떤 경기인가'라서 경기지표 쪽이 맞다.
// 뱃지는 컴포넌트가 아니라 '원소 배열을 돌려주는 함수'로 만든다 — 지표마다 해당이
// 없으면 아예 안 나오는데, 컴포넌트로 두면 "이 줄에 뱃지가 하나라도 있나"를 밖에서
// 알 방법이 없다(원소를 직접 호출해 보는 건 훅이 들어가는 순간 깨진다).
function ddongChips(row) {
  const ddong = String(row.DDONG || '').trim()
  if (!ddong) return []
  const risk = numOrNull(row.DDONG_RISK)
  const [, label, tone] = DDONG_GRADES.find(([cut]) => risk !== null && risk < cut) || []
  // 똥사는 여기 두지 않는다 — '결과가 뒤집혔다'는 결과 정보라, 팝업 맨 위 RT 배지
  // 옆(DdongsaBadge)에 붙는 게 맞다. 경기지표는 결과가 아니라 경기의 성격만 담는다.
  return [
    <MatchChip
      key="ddong"
      label="똥배"
      tone={risk !== null ? tone : undefined}
      title={`국내배당 1.49 이하 — 그 라운드에서 ${ddong.replace('똥', '')}번째로 강한 정배.`
        + (risk !== null ? ` 무/역으로 뒤집힐 확률 ${Math.round(risk)}%(${label}).` : '')}
    >
      {ddong}
      {risk !== null && ` · ${label} ${Math.round(risk)}%`}
    </MatchChip>,
  ]
}

// 국내·해외 정배 엇갈림 뱃지 — 두 시장이 같은 경기를 다른 팀이 정배라고 본다.
// homeIsFav 하나로 화면 곳곳(제목의 (정)/(역), 시스템 판정 화살표 등)이 국내배당을
// 우선으로 쓰는데, 그러면 해외배당이 실제로는 반대를 가리키고 있다는 걸 화면
// 어디서도 알 수 없었다(2026-09-02, 선덜랜드 vs 풀럼 사례로 이 뱃지가 필요해짐).
// '국≠해' — ≠는 두 시장이 다르다는 뜻 그대로.
function oddsSplitChips(row) {
  const dom = marketFavHome(row.KW, row.KL)
  const forr = marketFavHome(row.FW, row.FL)
  if (dom === null || forr === null || dom === forr) return []
  return [
    <MatchChip
      key="split"
      label="정배"
      tone="yellow"
      title={`국내배당은 ${dom ? '홈' : '원정'}팀을, 해외배당은 ${forr ? '홈' : '원정'}팀을`
        + ' 정배로 본다 — 두 시장이 이 경기를 다르게 본다는 뜻(6대리그 실측 4.25%,'
        + ' 16,748경기 중 711건). 화면의 (정)/(역) 표시와 판정의 전적 관계는'
        + ' 국내배당을 우선으로 쓴다(homeIsFav) — 해외배당 기준 지표(해초·해배)를'
        + ' 볼 때는 정배가 반대일 수 있다는 걸 감안해야 한다.'}
    >
      국≠해
    </MatchChip>,
  ]
}

// 해배동배 뱃지 — 해외 초기배당의 승(FW)과 패(FL)가 정확히 같은 경기.
// 이 경우 정배 방향 자체를 못 정해 시스템 판정이 아예 안 뜬다(리그표 판정 칸의 흐린 －).
// 화면에 "왜 판정이 없나"를 설명해 주는 게 이 뱃지의 역할이다
// (2026-09-08, 리즈 vs 뉴캐슬 2.55=2.55 · 로리앙 vs 툴루즈 2.63=2.63으로 발견).
//
// ⚠ 색(tone)을 안 준다 — 신호가 아니기 때문. 2026-09-08 실측(6대리그 36,033경기):
//   동률 283건(0.79%)의 당첨률은 81.27%로 전체 평균 69.81%보다 한참 높아 보이지만,
//   동률 값이 전부 2.40~3.10(평균 2.62)이라 애초에 접전 배당대만 모인 것이다.
//   같은 접전 배당대(2.3~2.9)의 비동률 경기와 맞대면 81.21% vs 82.91%로 오히려 낮고
//   차이도 우연 범위다(z=-0.75). '동률이라 좋다'가 아니라 '접전이라 좋았던' 것.
//   배변 배당으로 방향을 정해 억지로 판정을 내 봐도 256건 당첨 80.86%로,
//   그냥 전부 플핸무를 건 81.27%보다 못하고 별점까지 거꾸로 돈다(★3 78.82% < ★2 85.53%).
//   그래서 판정은 지금처럼 비워 두는 게 맞고, 이 뱃지는 사실 표시로만 쓴다.
function foreignTieChips(row) {
  const fw = numOrNull(row.FW)
  const fl = numOrNull(row.FL)
  if (fw === null || fl === null || fw !== fl) return []
  return [
    <MatchChip
      key="ftie"
      label="해배동배"
      title={'해외 초기배당의 승·패가 정확히 같습니다(FW=FL) — 어느 팀이 정배인지'
        + ' 시장이 정하지 않았다는 뜻이라, 시스템 판정이 뜨지 않고 비어 있습니다(－).'
        + '\n6대리그 36,033경기 실측 283건(0.79%) — 당첨률 81.27%로 전체 평균(69.81%)'
        + '보다 높지만, 동률 값이 전부 2.40~3.10(평균 2.62)이라 접전 배당대만 모인 것입니다.'
        + ' 같은 접전 배당대(2.3~2.9)의 비동률 경기와 비교하면 81.21% vs 82.91%로 오히려'
        + ' 살짝 낮고 차이는 우연 범위입니다(z=-0.75) — 동률 자체는 신호가 아닙니다.'
        + '\n배변 배당으로 방향을 정해 판정을 내 봐도 당첨 80.86%로 그냥 플핸무를 건'
        + ' 81.27%보다 못해서, 판정은 비워 두는 쪽이 맞습니다.'
        + ' 이 경기는 "접전 배당대의 평범한 경기"로 보시면 됩니다(그 구간 평균 당첨 82.85%).'}
    >
      {fw.toFixed(2)}
    </MatchChip>,
  ]
}

// 시즌 막판 뱃지 — 경기마다 '시즌 마지막 2라운드 · 정무 주의', 팀마다 '무엇이 걸려 있나'
// (남은 경기 10 이하). 규칙·실측 근거는 utils/seasonStake.js, 계산은 api/standings.py.
// 팀 뱃지는 참고용(배당에 이미 반영된 정보), 막판 주의만 실측으로 결과가 갈린 신호다.
function seasonStakeChips(row) {
  const chips = []
  if (seasonEndWarn(row)) {
    chips.push(
      <MatchChip key="season-end" label="시즌막판" tone="yellow" title={SEASON_END_TITLE}>
        정무 주의
      </MatchChip>,
    )
  }
  for (const [side, team] of [['H', row.HT], ['A', row.AT]]) {
    const s = teamStake(row, side)
    if (!s) continue
    chips.push(
      <MatchChip key={`stake-${side}`} label={`${team})`} tone={s.tone} title={s.title}>
        {s.label}{s.text ? ` · ${s.text}` : ''}
      </MatchChip>,
    )
  }
  return chips
}

// 정역반전 뱃지 — 초기엔 A팀이 정배였는데 배변에서 B팀이 정배가 된 경기.
// 배당이 좁아지기만 한 것과 다른 사건이라 따로 표시한다(계산은 verdictCalc.favFlip).
//
// ⚠ 국내가 뒤집혔으면 '베팅 방식'이 바뀐다 — '정'과 '역'이 가리키는 팀이 서로 자리를
//   바꾸므로, 프로토(국내 시장)에서 같은 팀에 거는 행위가 플핸이 아니라 정무가 된다.
//   그래서 국내가 포함된 반전은 노란색으로 눈에 띄게 하고, 해외만 뒤집힌 경우는
//   실제로 거는 시장이 아니라 색 없이 정보로만 둔다(사용자 지정).
//
// 실측(6대리그 28,638건): 하나라도 반전이면 당첨 86.36% vs 반전 없음 68.66%
// (z=15.76, 리그 6/6). 배변 해외 정배배당 2.0~2.5 구간으로 고정해도 +6.71%p(z=4.42).
function favFlipChips(row) {
  const { dom, forr } = favFlip(row)
  if (!dom && !forr) return []
  const where = dom && forr ? '국·해' : (dom ? '국' : '해')
  const domNote = '\n⚠ 국내배당이 뒤집혔습니다 — 프로토에서는 플핸이 아니라 정무로 걸어야'
    + ' 같은 베팅이 됩니다(정·역이 가리키는 팀이 바뀌었습니다).'
  return [
    <MatchChip
      key="fav-flip"
      label={`${where})`}
      tone={dom ? 'yellow' : undefined}
      title={'초기에는 한쪽이 정배였는데 배변(최신 배당)에서 반대편이 정배가 됐습니다'
        + ` — ${dom && forr ? '국내·해외 두 시장 모두' : (dom ? '국내배당만' : '해외배당만')} 뒤집혔습니다.\n`
        + '6대리그 실측: 정역반전이 있으면 당첨률 86.36%(반전 없음 68.66%, z=15.76,'
        + ' 리그 6/6). 배당 구간을 고정해도 살아남는 신호입니다.'
        + (dom ? domNote : '\n해외만 뒤집힌 경우는 실제로 거는 시장이 아니라 플핸 그대로 가면 됩니다.')}
    >
      정역반전
    </MatchChip>,
  ]
}

// ── 기대점수 뱃지 (2026-09-07 실측, 6대리그 29,938경기) ──
// '기대점수 차이' = 정배팀 기대점수 − 언더독팀 기대점수(정배는 해외배당 FW/FL 기준).
// 배당대 × 기대점수 차이 격자로 RT 4종을 재보니, **정배가 셀 때만** 신호가 나온다.
// 접전 배당(2.30+)에서는 어느 조합도 유의하지 않아 뱃지를 띄우지 않는다.
// 아래는 그 격자에서 z≥2로 살아남은 칸만 옮긴 것 — [배당 하한, 배당 상한, 차이 하한,
//  차이 상한, 라벨, 색, 툴팁에 넣을 실측 문구]. 시즌전적 정의 팝업의 표와 같은 값이다.
const XG_RULES = [
  [0, 1.35, 2.2, 99, '기대 정배압도', 'blue',
    '초강정배 배당(~1.35)에 기대점수 차이 2.2 이상 — 핸승 61.22%(이 배당대 평균 55.98%, +9.1%p),'
    + ' 역 5.72%(−2.8%p). 정무 94.28%로 이 배당대에서 가장 높다(n=1,573).'],
  [0, 1.35, 1.4, 2.2, '기대 접전', 'red',
    '초강정배 배당(~1.35)인데 기대점수 차이가 1.4~2.2뿐 — 핸승 51.83%로 이 배당대 평균(55.98%)보다'
    + ' 4.5%p 낮고, 플핸무가 48.17%(+6.7%p)로 올라간다(n=1,393).'],
  [1.35, 1.60, 2.2, 99, '기대 정배압도', 'blue',
    '강정배 배당(1.35~1.60)에 기대점수 차이 2.2 이상 — 핸승 44.34%(평균 39.46%, +5.3%p),'
    + ' 정무 89.62%(n=424).'],
  [1.35, 1.60, 0.3, 0.8, '기대 접전', 'red',
    '강정배 배당(1.35~1.60)인데 기대점수 차이가 0.3~0.8뿐 — 역이 15.44%로 평균(13.19%)보다'
    + ' 2.7%p 높다. 정무가 84.56%로 내려간다(n=777).'],
  [1.60, 1.90, 1.4, 2.2, '기대 정배우위', 'blue',
    '중정배 배당(1.60~1.90)에 기대점수 차이 1.4~2.2 — 핸승 35.14%로 평균(30.71%)보다 5.1%p 높다.'
    + ' 플핸무는 64.86%로 내려간다(n=777).'],
  [1.90, 2.30, 0.8, 1.4, '기대 정배우위', 'blue',
    '약정배 배당(1.90~2.30)에 기대점수 차이 0.8~1.4 — 핸승 25.31%로 평균(23.05%)보다 2.7%p 높다.'
    + ' 폭이 작아 참고용이다(n=1,529).'],
]

// 기대점수는 백엔드(api/pick_ai.py)가 시즌전적과 같이 계산해 내려준다 — 전체 기준 값
// (괄호 앞쪽)을 쓴다. 장소 기준은 표본이 절반이라 실측에서 신호가 더 약했다.
function xgChips(row, xg) {
  if (!xg || xg.home === null || xg.home === undefined
      || xg.away === null || xg.away === undefined) return []
  const fw = numOrNull(row.FW)
  const fl = numOrNull(row.FL)
  if (fw === null || fl === null || fw === fl) return []
  const favOdds = Math.min(fw, fl)
  const homeIsFav = fw < fl
  const margin = (homeIsFav ? xg.home : xg.away) - (homeIsFav ? xg.away : xg.home)
  const hit = XG_RULES.find(([o1, o2, m1, m2]) => favOdds >= o1 && favOdds < o2
    && margin >= m1 && margin < m2)
  if (!hit) return []
  const [, , , , label, tone, note] = hit
  return [
    <MatchChip
      key="xg"
      label={`차 ${margin >= 0 ? '+' : ''}${margin.toFixed(2)}`}
      tone={tone}
      title={`기대점수 차이 = 정배(${(homeIsFav ? xg.home : xg.away).toFixed(2)}) −`
        + ` 언더독(${(homeIsFav ? xg.away : xg.home).toFixed(2)}) = ${margin.toFixed(2)}\n`
        + `${note}\n※ 접전 배당(2.30 이상)에서는 기대점수가 결과를 예고하지 못해 뱃지를 띄우지 않는다.`}
    >
      {label}
    </MatchChip>,
  ]
}

// 팝업 맨 위 RT 배지 옆 '똥사' — 똥배(강한 정배)였는데 결과가 무/역으로 뒤집힌 경기.
// RT와 같은 '결과' 정보라 RT 배지 바로 옆에 둔다. 모양은 RtBadge와 같은 것을 쓴다.
function DdongsaBadge({ row }) {
  if (!String(row.DDONGSA || '').trim()) return null
  return (
    <span
      className="rt-badge"
      style={{ background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' }}
      title="똥배(국내배당 1.49 이하의 강한 정배)였는데 결과가 무/역으로 뒤집혔다"
    >
      똥사
    </span>
  )
}

// 팝업 맨 위 결과 배지 자리 — 아직 결과가 없는(예정) 경기에서 그 자리를 채운다.
// 예전엔 '예정 경기'라는 글자를 넣었는데(2026-09-12 사용자 지정으로 삭제), 그 경기가
// 똥배(강한 정배)면 순번(똥1·똥2…)을 대신 보여준다 — 모양·등급 기준은 경기지표 줄의
// ddongChips와 같다. 똥배가 아니면 빈 자리(아무 것도 안 보여줌)로 둔다.
function DdongBadge({ row }) {
  const ddong = String(row.DDONG || '').trim()
  if (!ddong) return null
  const risk = numOrNull(row.DDONG_RISK)
  const [, label, tone] = DDONG_GRADES.find(([cut]) => risk !== null && risk < cut) || []
  return (
    <span
      className="rt-badge"
      style={tone ? { background: `var(--chip-${tone}-bg)`, color: `var(--chip-${tone}-fg)` } : undefined}
      title={`국내배당 1.49 이하 — 그 라운드에서 ${ddong.replace('똥', '')}번째로 강한 정배.`
        + (risk !== null ? ` 무/역으로 뒤집힐 확률 ${Math.round(risk)}%(${label}).` : '')}
    >
      {ddong}
    </span>
  )
}

// 팝업 맨 위 RT 배지 옆 '벳' — 내가 베팅내역(bet_slips)에 실제로 등록한 경기라는 표시.
// 별표(IMPORTANT)·내픽(MY_PICK)과 별개다(리그 표의 MY_BET 칸과 같은 값·같은 색).
function MyBetBadge({ row }) {
  if (!row.MY_BET) return null
  return (
    <span
      className="rt-badge"
      style={{ background: 'var(--chip-green-bg)', color: 'var(--chip-green-fg)' }}
      title="베팅내역에 실제로 등록된 경기입니다"
    >
      P
    </span>
  )
}

// 팝업 맨 위 결과 배지 옆 — 내픽(MY_PICK)이 이 경기에서 적중/보험/미적 중 뭐였나.
// LeagueTable의 판정(PICK_VERDICT) 칸과 같은 규칙(columnGroups.computeAutoVerdict)을
// 그대로 쓴다. 벳(MY_BET) 배지가 있으면 그 옆에, 없으면(픽만 하고 벳은 안 넣은 경기)
// RT 배지 옆에 바로 붙는다 — 어디에 붙이는지는 호출하는 쪽(제목줄의 detail-title-badges)이 정한다.
function PickVerdictBadge({ row }) {
  const verdict = computeAutoVerdict(row.MY_PICK, row.RT)
  if (!verdict) return null
  return (
    <span className="rt-badge" style={pickVerdictStyle(verdict)}>
      {verdict}
    </span>
  )
}

// ── 상대전적 판정 뱃지 (2026-09-02 실측) ──
// 홈우세 / 홈만우세 / 전적보합 / 원정만우세 / 원정우세 — 판정 규칙과 실측 근거는
// utils/h2hVerdict.js 주석에 전부 적어 뒀다. 여기선 그 결과를 칩으로 그리기만 한다.
// verdict는 /api/pick_ai가 이미 내려주는 h2h(wdl_summary·wdl_summary_home)로
// 만든다 — 상대전적 카드가 쓰는 것과 같은 값이라 API를 더 부르지 않는다.
// 아직 안 왔으면(로딩 중) 칸을 비워 두지 않고 '계산 중'으로 자리를 잡아 둔다 —
// 뱃지가 뒤늦게 끼어들면서 아래 내용이 밀리는 걸 막는다.
//
// 2026-09-02(3) — '같은방향/다른방향' 라벨을 붙였다. ⚠ 이건 실측 신호가 아니라
// 순수 사실 표시다 — 픽 방향(정/플)별로 갈라 재보니 값이 없었다(6대리그 재검증,
// z<1.5). 판단은 사용자가 직접 한다는 요청으로, 등급(★)에는 안 넣고 라벨만 단다.
//
// 매핑 기준 — "정"이 홈인지 원정인지는 해외배당(FW/FL)으로 정한다. 종합 판정
// 자체가 '해배·초기' 칸(해외 지표 기준)이라, 관계도 같은 기준이어야 서로 안 어긋난다.
// 2026-09-02(4) — 처음엔 homeIsFav(국내배당 우선, 팝업 제목의 (정)/(역)과 같은
// 기준)를 썼는데, 그러면 국내·해외가 갈리는 경기(약 4%)에서 판정 자체의 기준(해외)과
// 관계 판정 기준(국내)이 서로 달라져 모순이 생긴다 — 실측 예시(26-27 2R 선덜랜드
// vs 풀럼): 국내는 선덜랜드=정, 해외는 풀럼=정, 전적은 원정만우세(풀럼이 강함).
// 종합 판정(정역)은 해외 기준이라 이 '정'도 풀럼이어야 맞다 — 그러면 전적(풀럼 지지)과
// 판정(풀럼 지지)이 '같은방향'이 되는 게 맞다(homeIsFav 기준일 땐 '다른방향'으로
// 잘못 나왔었다). 국내≠해외로 갈리는 경기는 '정배 국≠해' 뱃지가 따로 알려준다.
const H2H_HOME_SIDE = { 홈우세: 'home', 홈만우세: 'home', 원정우세: 'away', 원정만우세: 'away' }

function h2hRelation(verdictLabel, row, pick) {
  const side = H2H_HOME_SIDE[verdictLabel]
  if (!side || !pick || !DIR_SIDE[pick]) return null
  const homeFav = marketFavHome(row.FW, row.FL)
  if (homeFav === null) return null
  const histFavorsMarketFav = (side === 'home') === homeFav
  const pickWantsFav = DIR_SIDE[pick] === '정'
  return histFavorsMarketFav === pickWantsFav ? '같은방향' : '다른방향'
}

function h2hChips(verdict, loading, row, pick) {
  if (loading) {
    return [<MatchChip key="h2h" label="전적">…</MatchChip>]
  }
  // 첫 맞대결 — 두 팀이 이 경기 전까지 우리 DB 안에서 한 번도 만난 적이 없다
  // (h2hVerdict는 맞대결 기록이 0건일 때만 null을 낸다). 전적 뱃지가 나올 수 없는
  // 자리에 대신 넣는다 — 아무것도 안 뜨면 '계산을 못 한 건지, 기록이 없는 건지'를
  // 화면에서 구분할 수 없다.
  // ⚠ 판단 재료가 아니라 사실 표시다. 강추 경기 842건 안에서 첫 맞대결 62건의
  // 당첨률이 91.94%(강추 평균 85.39%)로 높게 나오긴 했지만 z=1.52로 확정할 수 없는
  // 표본이라 색을 입히지 않는다 — 동배당 뱃지와 같은 취급(2026-09-07 실측).
  if (!verdict) {
    return [
      <MatchChip
        key="h2h-first"
        label="전적"
        title={'이 경기 전까지 두 팀의 맞대결 기록이 없습니다(첫 맞대결).\n'
          + '승격·강등이나 리그가 다른 팀끼리 처음 만나는 경우입니다.\n'
          + '※ 판단 재료는 아닙니다 — 강추 경기 안에서 첫 맞대결(62건)의 당첨률이'
          + ' 91.94%로 강추 평균(85.39%)보다 높게 나왔지만, 표본이 작아(z=1.52)'
          + ' 확정할 수 없어 색을 입히지 않았습니다.'}
      >
        첫맞대결
      </MatchChip>,
    ]
  }
  const rel = h2hRelation(verdict.label, row, pick)
  return [
    <MatchChip
      key="h2h"
      label="전적"
      tone={verdict.tone}
      title={verdict.title + (rel ? `\n지금 판정(${pick})과는 '${rel}'(사실 표시 — 값이 검증되지 않았다).` : '')}
    >
      {verdict.label}
      {rel && (
        <span className={`draw-rel draw-rel-${rel === '같은방향' ? 'ok' : 'bad'}`}>
          {' '}· {rel}
        </span>
      )}
    </MatchChip>,
  ]
}

// 경기지표 — 이 경기가 전반적으로 어떤 경기인지 한 줄로. 확률 지표 표 바로 아래에 둔다.
// 해당되는 게 하나도 없으면 줄을 없애지 않고 '해당 없음'을 적는다 — 뱃지가 있고 없고에
// 따라 아래 내용이 위아래로 튀면 매번 눈으로 다시 찾아야 한다.
// 2026-09-02 '승+패' 조합 방향성 뱃지는 화면에서 영구 삭제했다(계산은
// api/combo_dir.py에 그대로 남아 있고 row의 SPK_*/SPF_*/SPEK_*/SPEF_* 필드도
// 계속 내려오지만, 여기서는 더 이상 쓰지 않는다).
// ── 무 뱃지 (2026-09-02 실측) ──
// 국내 무배당이 낮으면 무가 시장 예상보다 더 나오고, 높으면 덜 나온다.
// 기준선과 근거는 utils/systemVerdict.js 주석에 전부 있다.
// 2026-09-02(2) — 시스템 판정 쪽 '무배당' 줄을 없애고, 그게 하던 일(지금 픽과
// 같은 방향인지)을 이 뱃지 하나로 합쳤다. 같은 값을 두 군데서 다르게 말하지 않는다.
const DRAW_REL_LABEL = { 같은편: '같은방향', 상충: '다른방향', 무관: '무관' }

function drawChips(row, pick) {
  const t = drawTendency(row)
  if (!t) return []
  const kd = numOrNull(row.KD)
  const fd = numOrNull(row.FD)
  const heavy = t === '무고려'
  const rel = pick ? drawRelation(t, pick) : null
  const relLabel = rel ? DRAW_REL_LABEL[rel] : null
  return [
    <MatchChip
      key="draw"
      label="무"
      tone="gray"
      title={`무배당 국배 ${kd ? kd.toFixed(2) : '-'}`
        + `${fd ? ` · 해배 ${fd.toFixed(2)}` : ''}.\n`
        + (heavy
          ? '두 시장 모두 무를 유력하게 봤다 — 이 구간 실제 무 30.5%(시장예상 28.6%).'
            + ' 무를 적중으로 먹는 플핸무가 82.1%로 유리하고, 무가 죽는 정역은 불리하다.'
          : '국내 무배당이 높다 — 이 구간 실제 무 17.2%(시장예상 18.7%).'
            + ' 무가 죽는 정무·정역이 유리하고(정무 89.3%), 무를 먹는 플핸무는 52.0%로 불리하다.')
        + '\n※ 핸무는 무배당과 무관해서(24% 고정) 플핸승은 이 뱃지의 영향을 받지 않는다.'
        + (relLabel ? `\n지금 판정(${pick})과는 '${relLabel}'.` : '')}
    >
      {heavy ? '고려' : '제외'}
      {relLabel && (
        <span className={`draw-rel draw-rel-${
          rel === '같은편' ? 'ok' : rel === '상충' ? 'bad' : 'none'}`}
        >
          {' '}· {relLabel}
        </span>
      )}
    </MatchChip>,
  ]
}

// 동배당 뱃지 — 같은 회차(금~월)에 다른 경기가 똑같은 국내 정배배당으로 떴다는 알림.
// 짝을 찾는 일은 LeagueTable이 한다(그쪽만 그 회차의 경기 목록을 들고 있다).
// ⚠ 판단 재료가 아니라 그냥 알림이다. "같은 배당이 두 번 뜨면 하나는 깨진다"는
// 속설은 6대리그 36,212경기 전수조사에서 사실이 아니었다(2026-09-04). 그래서 색을
// 입히지 않는다. 호버에는 경기 정보만 보여준다 — 실측 설명은 memory에 남겨 뒀다.
function sameOddsChips(sameOdds) {
  if (!sameOdds) return []
  const { odds, others } = sameOdds
  const list = others
    .map((o) => `· ${[formatDt(o.dt), formatTime(o.tm)].filter(Boolean).join(' ')} `
      + `${o.league}${o.round ? ` ${o.round}` : ''} `
      + `${o.home}${o.homeFav ? '(정)' : ''} vs ${o.away}${o.homeFav ? '' : '(정)'}`)
    .join('\n')
  return [
    <MatchChip
      key="same-odds"
      label="동배당"
      title={`같은 회차에 국내 정배배당이 ${odds}로 똑같은 경기가 ${others.length}개 더 있습니다.\n${list}`}
    >
      {odds}
    </MatchChip>,
  ]
}

// ── 플핸85 뱃지 (2026-09-09 실측) ────────────────────────────────────────────
// 6대리그 36,034경기에서 조건 34개를 1~4개씩 전수 조합(5만 가지 이상)해 **순수
// 플핸(무+역)** 발생률이 가장 높았던 조합. 네 조건이 동시에 맞을 때만 뜬다.
//
//   ① 해외 정배배당(배변 우선) 2.40 이상 — 해외 시장이 접전으로 본다
//   ② 해외 무배당(배변 우선) 3.20 미만 — 무가 유력하다고 본다
//   ③ 해외 정역반전 — 초기와 배변에서 정배 팀이 뒤바뀌었다
//   ④ 전적 같은방향 — 상대전적 우세팀이 언더독 쪽이다
//
// 실측: n=60 · 플핸 85.00%(무 28 · 역 23 · 핸무 7 · 핸승 2) · 플핸무 96.67%
//   기간 분할 검증(학습 ~20-21시즌 / 검증 21-22시즌~): 87.18%(39) → 80.95%(21)
//   플핸 단독 회수율 1.165(평균 배당 1.43, 배당 있는 27건) — 지금까지 찾은 조합 중
//   유일하게 본전을 확실히 넘는다. 시장이 이 조합을 과소평가한다는 뜻.
//   리그 재현성 4/6(EPL 100% · 리그1 88% · 라리가 83% · 세리에 79%,
//   분데스·에레디는 각 1건이라 사실상 미검증).
//
// ⚠ 남은 위험 — 조합을 5만 개 이상 뒤져서 찾은 것이라 다중비교 함정이 있다. 기간
//   분할을 통과한 게 강력한 방어지만 완벽하진 않다. 검증기간에 6.23%p 떨어졌으니
//   참값은 80% 언저리로 보는 게 안전하다. 6대리그 통틀어 연 3~4경기뿐이다.
//
// ⚠ 실패 9경기를 사전에 걸러낼 방법은 없었다(2026-09-09 대조 분석) — 배당·전적
//   지표로는 성공 51경기와 구분되지 않았다(해외 정배배당 2.65 vs 2.61, 무배당
//   3.06 vs 3.03). 유일하게 뚜렷한 차이는 총득점 3.11골 vs 2.00골이었는데 그건
//   경기가 끝나야 아는 값이다. 즉 "9번 중 1번은 어쩔 수 없이 진다"가 정답이다.
const PLHAN85_MIN_FAV = 2.40
const PLHAN85_MAX_DRAW = 3.20

function plhan85Chips(row, verdict) {
  if (!verdict) return []
  const side = H2H_HOME_SIDE[verdict.label]
  if (!side) return []
  const favHome = marketFavHome(row.FW, row.FL)
  if (favHome === null) return []
  // ④ 전적 우세팀이 언더독 쪽인가(해외 초기배당 기준 — h2hRelation과 같은 기준)
  if ((side === 'home') === favHome) return []
  const pick2 = (a, b) => numOrNull(row[a]) ?? numOrNull(row[b])
  const fw = pick2('EFW', 'FW')
  const fl = pick2('EFL', 'FL')
  const fd = pick2('EFD', 'FD')
  if (fw === null || fl === null || fd === null) return []
  if (Math.min(fw, fl) < PLHAN85_MIN_FAV) return []        // ①
  if (fd >= PLHAN85_MAX_DRAW) return []                    // ②
  if (!favFlip(row).forr) return []                        // ③
  return [
    <MatchChip
      key="plhan85"
      label="플핸"
      tone="green"
      title={'★ 6대리그 36,034경기 전수 탐색에서 순수 플핸(무+역) 발생률이 가장 높았던'
        + ' 조합입니다. 네 조건이 동시에 맞았습니다:'
        + `\n  ① 해외 정배배당 ${PLHAN85_MIN_FAV} 이상(현재 ${Math.min(fw, fl).toFixed(2)})`
        + `\n  ② 해외 무배당 ${PLHAN85_MAX_DRAW} 미만(현재 ${fd.toFixed(2)})`
        + '\n  ③ 해외 정역반전(초기와 배변의 정배 팀이 다름)'
        + `\n  ④ 전적 같은방향(상대전적 우세팀이 언더독 쪽 — ${verdict.label})`
        + '\n\n실측 n=60 · 플핸 85.00% · 플핸무 96.67%(무 28 · 역 23 · 핸무 7 · 핸승 2)'
        + '\n플핸 단독 회수율 1.165 — 지금까지 찾은 조합 중 유일하게 본전을 넘습니다.'
        + '\n\n⚠ 6대리그 통틀어 연 3~4경기뿐이고, 기간 분할 검증에서 87.18%→80.95%로'
        + ' 떨어졌습니다. 참값은 80% 언저리로 보세요. 분데스·에레디는 표본이 각 1건이라'
        + ' 사실상 검증되지 않았습니다.'
        + '\n⚠ 실패한 9경기는 배당·전적으로 미리 걸러낼 수 없었습니다(총득점이 3.11골로'
        + ' 높았지만 그건 끝나야 아는 값) — 9번 중 1번은 어쩔 수 없이 집니다.'}
    >
      85%
    </MatchChip>,
  ]
}

function MatchIndicators({ row, h2hVerdict: verdict, h2hLoading, pick, sameOdds, xg }) {
  // 똥배 → 국/해 엇갈림 → 전적 → 무 → 동배당을 세로로 쌓는다.
  // (배당차 뱃지는 2026-09-02에 옆 칸 표로 뺐다가 2026-09-05에 아예 삭제했다 —
  //  정배배당을 다시 적은 값이라 확률 지표와 중복이었다. DirectionScopeTable 주석 참고.)
  // 플핸85는 맨 앞에 둔다 — 다른 뱃지가 '이 경기가 어떤 경기인가'를 말하는 데 비해
  // 이것만 "그래서 어떻게 하라"에 가장 가까운 결론이라 눈에 먼저 들어와야 한다.
  // 시즌막판(정무 주의)도 '어떻게 하라'에 가까워 플핸85 바로 뒤에 둔다.
  const chips = [...plhan85Chips(row, verdict), ...seasonStakeChips(row),
    ...ddongChips(row), ...oddsSplitChips(row), ...foreignTieChips(row),
    ...favFlipChips(row),
    ...xgChips(row, xg),
    ...h2hChips(verdict, h2hLoading, row, pick), ...drawChips(row, pick),
    ...sameOddsChips(sameOdds)]
  return (
    <span className="match-chip-row">
      {chips.length ? chips : <span className="match-chip-empty">해당 없음</span>}
    </span>
  )
}

// 홈팀/점수/원정팀을 승(홈)·무·패(원정) 컬럼과 같은 자리에 맞춰 배당표 맨 위에 얹는다.
// 경기 결과가 아직 없어도(예정 경기) 팀명은 항상 보이고, 점수만 '-'로 비워둔다.
// 팀 이름 옆엔 그 라운드 직전 순위를 숫자만 붙이고, 정배(정)/역배(역)는 아랫줄로 내린다.
//   서울(1)
//   (정)
// 팝업 제목 줄은 한 줄에 "서울(1위)(정)"로 그대로 둔다 — 거기는 가로 폭이 넉넉하다.
function OddsTable({ row }) {
  // 5번째 자리(final)는 그 배당의 배변(최종배당) 칸 이름 — 해외 핸디는 스코어맨이
  // 무(D) 값을 안 주고 최종배당 자체를 안 모으므로 배변 행이 없다.
  const rows = [
    ['국내 배당', 'KW', 'KD', 'KL', ['EKW', 'EKD', 'EKL']],
    ['국내 핸디', 'KHW', 'KHD', 'KHL', ['EKHW', 'EKHD', 'EKHL']],
    ['해외 배당', 'FW', 'FD', 'FL', ['EFW', 'EFD', 'EFL']],
    ['해외 핸디', 'FHW', 'FHD', 'FHL', null],
  ]
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const hasScore = row.HS !== null && row.HS !== undefined && row.AS !== null && row.AS !== undefined
  const homeFav = homeIsFav(row)
  // 해외 배당이 크게 움직인 경기인가 — '해외 배당' 표 제목 옆 (강)/(약) 표시.
  // 2026-09-07에 리그 표 '지표 > 배변' 칸은 '판정'으로 바뀌어 이 값을 더 이상
  // 안 보여준다(그쪽엔 시스템 판정이 대신 들어간다) — 이 배지만 남았다.
  const moveGrade = oddsMoveGrade(row)
  const moveTitle = oddsMoveTitle(row)
  // 순위 — 배당표는 칸이 좁아 '위'를 떼고 숫자만 쓴다(팝업 제목 줄은 (3위) 그대로).
  const rankNum = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const n = Number(v)
    return Number.isNaN(n) ? '' : `(${Math.trunc(n)})`
  }
  // (정)/(역)은 팀명·순위 아래 줄로 내린다. 줄바꿈을 이 함수 안에 같이 넣어 둬야
  // 배당이 없어 정/역을 못 가리는 경기(homeFav === null)에서 빈 줄만 남지 않는다.
  const roleSuffix = (isHome) => {
    if (homeFav === null) return null
    const isFav = isHome ? homeFav : !homeFav
    return (
      <>
        <br />
        <span className={isFav ? 'odds-role-fav' : 'odds-role-dog'}>{isFav ? '(정)' : '(역)'}</span>
      </>
    )
  }
  // 정배 쪽 컬럼(승=홈팀 칸 / 패=원정팀 칸) 전체에 아주 연한 파란 배경을 준다 —
  // 홈이 정배면 '승' 컬럼(KW/FW/FHW), 원정이 정배면 '패' 컬럼(KL/FL/FHL).
  // 줄마다(국내/해외) 자기 자신의 배당으로 정배를 판단한다 — 예전엔 이 표 전체가
  // homeFav(국내 우선) 하나만 써서, 국내·해외 정배 방향이 갈리는 경기(예: 26-27 2R
  // 선덜랜드-풀럼 — 국배는 선덜랜드 KW 2.25<KL 2.80로 정배, 해배는 FW 2.75>FL 2.38로
  // 오히려 풀럼이 정배)에서 '해외 배당'·'해외 핸디' 줄까지 국내 기준으로 강조돼
  // 실제로는 정배인 쪽이 역배 칸에 색칠되는 사고가 있었다. 그 줄이 국내 소속이면
  // KW/KL로, 해외 소속이면 FW/FL로 — 항상 그 줄 자신이 속한 시장의 배당을 본다.
  // final=true면 그 시장의 배변(최종) 배당(EKW/EKL·EFW/EFL)으로 정배를 다시 정한다.
  // ⚠ 2026-09-09 실측 버그 수정 — 예전엔 이 함수가 항상 초기(KW/KL·FW/FL)만 봐서,
  // 정역반전(초기엔 A팀 정배 → 배변엔 B팀 정배로 뒤집힘) 경기의 '배변' 줄에서도
  // 여전히 초기 기준으로 언더독 칸을 칠했다. 그래서 K1 포항 vs 김천(26-09-09, 초기
  // KW 2.28<KL 2.85로 포항 정배 → 배변 EKW 2.65>EKL 2.46으로 김천 정배 뒤집힘)처럼
  // 정역반전이 난 경기는 배변 줄에서 EKHL(5.40, 이제는 정배 쪽 커버 배당)이 언더독
  // (플핸) 칸으로 잘못 칠해지고, 실제 언더독 배당인 EKHW(1.46)가 안 칠해졌다.
  // 값 자체(EKHW=1.46)는 최신배당 불러오기가 정확히 받아 DB에 그대로 있었다 —
  // 틀린 건 "어느 칸이 언더독 칸인가"를 표시하는 강조색뿐이었다.
  const marketFav = (label, final = false) => {
    const domestic = label.startsWith('국내')
    const [wk, lk] = final
      ? (domestic ? ['EKW', 'EKL'] : ['EFW', 'EFL'])
      : (domestic ? ['KW', 'KL'] : ['FW', 'FL'])
    const w = numOrNull(row[wk])
    const l = numOrNull(row[lk])
    if (w === null || l === null || w === l) return null
    return w < l
  }
  const favColClass = (col, label, final = false) => {
    const fav = marketFav(label, final)
    if (fav === null) return undefined
    const favCol = fav ? 'w' : 'l'
    return col === favCol ? 'odds-fav-col' : undefined
  }
  // 핸디 배당(국내 핸디·해외 핸디) 줄은 정배 쪽이 아니라 핸디를 받은 언더독 쪽을
  // 강조한다 — 핸디를 낀 시장에서 보는 값은 "언더독이 그 핸디를 커버하는가"이므로
  // 늘 언더독 칸이 관심 대상이다. 핸디 적용 후 두 배당 중 어느 쪽이 숫자가 더
  // 작은지는(정배가 여전히 근소 유리한 경우도 흔함) 이 강조와 무관하다 — 예전엔
  // "핸디 적용 후 더 작은 값" 쪽을 칠했는데, 그러면 핸디를 크게 줘도 정배가 계속
  // 강조되는 경우가 있어 실제로 보고 싶은 언더독 쪽과 어긋났다. 언더독도 그 핸디가
  // 속한 시장(국내 핸디→KW/KL, 해외 핸디→FW/FL) 기준으로 정한다 — 위 favColClass와
  // 같은 이유.
  const dogColClass = (col, label, final = false) => {
    const fav = marketFav(label, final)
    if (fav === null) return undefined
    const dogCol = fav ? 'l' : 'w'
    return col === dogCol ? 'odds-fav-col' : undefined
  }
  // 초기 → 최종 배당이 움직인 방향 — 리그 표(columnGroups.js oddsMoveDir)와 같은
  // 규칙: 배당이 오르면 빨강 ↑, 내리면(=돈이 몰린 쪽) 파랑 ↓.
  const oddsDir = (initVal, finVal) => {
    const a = numOrNull(initVal)
    const b = numOrNull(finVal)
    if (a === null || b === null || a === b) return 0
    return b > a ? 1 : -1
  }
  return (
    <table className="detail-table odds-table">
      <thead>
        <tr className="odds-teams-row">
          <th className="row-label" />
          <th className="odds-team-name">
            {ht}
            {rankNum(row.HP)}
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
            {rankNum(row.AP)}
            {roleSuffix(false)}
          </th>
        </tr>
        <tr>
          <th>구분</th>
          {/* 이 헤더는 4줄(국내/해외 배당·핸디) 전체가 공유하는 열 이름이라 줄마다 다른
              시장을 가리킬 수 없다 — 국내 배당을 기준 삼는다(팝업 제목의 (정)/(역)과
              같은 기준). 실제 강조는 아래 각 줄에서 그 줄 자신의 시장으로 다시 정해진다. */}
          <th className={favColClass('w', '국내 배당')}>승</th>
          <th>무</th>
          <th className={favColClass('l', '국내 배당')}>패</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, w, d, l, final]) => {
          const isHandi = label === '국내 핸디' || label === '해외 핸디'
          const colClass = (col, isFinal = false) =>
            (isHandi ? dogColClass(col, label, isFinal) : favColClass(col, label, isFinal))
          return (
            <Fragment key={label}>
              <tr className={label === '해외 배당' ? 'odds-group-start' : undefined}>
                <td className="row-label">{label}</td>
                <td className={colClass('w')}>{numOrDash(row[w])}</td>
                <td>{numOrDash(row[d])}</td>
                <td className={colClass('l')}>{numOrDash(row[l])}</td>
              </tr>
              {final && (
                <tr className="odds-final-row">
                  <td className="row-label">
                    배변
                    {/* 배변 신뢰등급은 해외 배당 줄에만 붙인다 — 국내(와이즈토토)는 배당이
                        움직여도 최신값이 더 정확하다는 증거가 없었다(utils/oddsMove.js 참고). */}
                    {label === '해외 배당' && moveGrade && (
                      <span
                        className={`odds-move-grade ${moveGrade === '강' ? 'strong' : 'weak'}`}
                        title={moveTitle}
                      >
                        ({moveGrade})
                      </span>
                    )}
                  </td>
                  {[w, d, l].map((initKey, ci) => {
                    const initVal = numOrNull(row[initKey])
                    const finVal = numOrNull(row[final[ci]])
                    const dir = oddsDir(row[initKey], row[final[ci]])
                    // 초기와 배변이 같은 값이면(실제로 안 움직였으면) 굳이 같은 숫자를 또
                    // 보여주지 않고 '-'로 비운다(2026-09-12 사용자 지정 — SampleTable의
                    // sampleOddsMoved와 같은 취지).
                    const unmoved = initVal !== null && finVal !== null && initVal === finVal
                    // 배변 줄은 배변(최종) 배당 기준으로 다시 정배를 판단한다(marketFav 주석 참고) —
                    // 정역반전 경기에서 초기 기준을 그대로 쓰면 엉뚱한 칸이 언더독(플핸)으로 칠해진다.
                    const cls = ci === 0 ? colClass('w', true) : ci === 2 ? colClass('l', true) : undefined
                    return (
                      <td key={final[ci]} className={cls}>
                        {unmoved ? '-' : numOrDash(row[final[ci]])}
                        {dir !== 0 && (
                          <span className={`odds-arrow ${dir > 0 ? 'up' : 'down'}`}>
                            {dir > 0 ? '↑' : '↓'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )}
            </Fragment>
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
  // 네 번째 자리(hasFinal)는 이 칸이 배변 줄에서 두 줄로 갈리는지 여부다. 여덟 칸
  // 모두 최종배당 기준 값이 있다 — 정)·플(KO)은 배당에서 곧바로, 국)지·해)지는
  // '최신배당 불러오기'가 최종배당으로 다시 센 27개 지표에서 나온다.
  const groups = [
    ['정승 %', 'win', [
      ['국)정', 'WIN_RISK', toN(row.WIN_RISK), toN(row.E_WIN_RISK), true],
      ['해)정', 'WIN_RISK_F', toN(row.WIN_RISK_F), toN(row.E_WIN_RISK_F), true],
    ]],
    ['플핸무 %', 'nh', [
      ['국)플', 'NH_KO', toN(row.NH_KO), toN(row.E_NH_KO), true],
      ['국)지', 'NH_KI', toN(row.NH_KI), toN(row.E_NH_KI), true],
      ['해)지', 'NH_FI', toN(row.NH_FI), toN(row.E_NH_FI), true],
    ]],
    ['플 %', 'pl', [
      ['국)플', 'PL_KO', toN(row.PL_KO), toN(row.E_PL_KO), true],
      ['국)지', 'PL_KI', toN(row.PL_KI), toN(row.E_PL_KI), true],
      ['해)지', 'PL_FI', toN(row.PL_FI), toN(row.E_PL_FI), true],
    ]],
  ]
  return (
    <table className="detail-table risk-table">
      <thead>
        <tr>
          <th className="row-label" />
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
          <th className="row-label" />
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
          <td className="row-label" />
          {groups.flatMap(([title, kind, cols], gi) =>
            cols.map(([label, , n, , hasFinal], ci) => (
              <td
                key={`${title}-${label}`}
                rowSpan={hasFinal ? 1 : 2}
                className={ci === cols.length - 1 && gi < groups.length - 1 ? 'risk-edge' : ''}
                style={riskCellStyle(kind, n)}
              >
                {n === null ? '-' : n.toFixed(0)}
              </td>
            ))
          )}
        </tr>
        <tr className="risk-final-row">
          <td className="row-label">배변</td>
          {groups.flatMap(([title, kind, cols], gi) =>
            cols
              .map((col, ci) => ({ col, ci }))
              .filter(({ col }) => col[4])
              .map(({ col: [label, fieldKey, n, en], ci }) => {
                // 이 칸이 실제로 나오는 시장(RISK_FIELD_MARKET)이 초기→배변 사이에
                // 안 움직였으면, E_ 컬럼에 값이 있어도 '-'로 비운다 — OddsTable·
                // SampleTable과 같은 원칙(2026-09-12, 본머스 vs 브렌트포드 사용자
                // 제보 — 국내 승무패가 그대로인데 국)정이 실제 값을 보여주고 있었다).
                const moved = marketSetMoved(row, RISK_FIELD_MARKET[fieldKey])
                const shown = moved ? en : null
                // 오르든 내리든(정배 확률이 오른 게 플핸 쪽엔 나쁠 수도 있어) 배당
                // 화살표처럼 빨강/파랑으로 방향에 뜻을 담지 않는다 — 그냥 값이
                // 움직였다는 표시로만, 배경색과 잘 보이도록 흰색으로 둔다.
                const dir = n !== null && shown !== null && shown !== n ? (shown > n ? 'up' : 'down') : null
                return (
                  <td
                    key={`${title}-${label}-e`}
                    className={ci === cols.length - 1 && gi < groups.length - 1 ? 'risk-edge' : ''}
                    style={riskCellStyle(kind, shown)}
                  >
                    {shown === null ? '-' : shown.toFixed(0)}
                    {dir && <span className="risk-arrow">{dir === 'up' ? '▲' : '▼'}</span>}
                  </td>
                )
              })
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
          <th>전체</th>
          <th>최근5</th>
          <th>홈</th>
          <th>원정</th>
          <th>최근5</th>
          <th>전체</th>
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

// 칸 하나에 마우스를 올렸을 때 보여줄 그 경기 정보.
//   26-08-24(수) 20:30
//   리버플 1 - 0 노팅엄 (역)
// 서버가 준 목록(recent10)은 화면 칸과 같은 순서라 자리만 맞춰 꺼내 쓴다. 다만 칸은
// 항상 10개인데 경기가 그보다 적을 수 있어(시즌 초반), 원정팀 쪽은 뒤에서부터 채우는
// recentCells의 offset을 똑같이 적용해 자리를 맞춘다.
// 팀명 옆에 적을 배당 — 해외배당(FW/FL)만 쓴다. HeadToHeadResult.jsx의 teamOdds와
// 같은 이유다: 국내·해외가 갈릴 때 해외 쪽이 더 자주 맞아(6대리그 실측 +1.8%p)
// 상대전적 표가 이미 해외로 통일했다 — 여기도 같은 기준을 따라야 두 화면이
// 같은 경기에 다른 배당을 보여주는 일이 없다.
function recentTeamOdds(game, isHome) {
  const n = Number(isHome ? game.FW : game.FL)
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null
}

// 그 경기의 정배(배당이 낮은 쪽)가 홈이었나 원정이었나 — HeadToHeadResult.jsx의
// favSide와 같은 규칙. 동배(FW===FL)거나 배당이 없으면 null(색 없이 표시).
function recentFavSide(game) {
  const a = Number(game.FW)
  const b = Number(game.FL)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return null
  return a < b ? 'home' : 'away'
}

// 칸에 마우스를 올렸을 때 뜨는 말풍선.
//   26-08-24 (일) 00:30 / D (무)
//   뉴캐슬(1.85) 2 - 2 리버풀(4.20)
// 브라우저 기본 툴팁(title)으로는 밑줄·색을 못 넣어서 직접 그린다. team(그 칸의 주인)
// 이름에 밑줄을 긋고, 이긴 쪽 점수는 앱의 기존 규칙과 같은 빨강(.winner-score)으로.
// (역)/(무) 같은 RT 표시는 첫 줄 WDL 글자 옆에 붙인다 — 스코어 줄은 팀명(배당)만 본다.
function RecentTip({ game, team, rect }) {
  if (!game || !rect) return null
  const g = (v) => (v === null || v === undefined ? '-' : Math.trunc(v))
  const hs = g(game.HS)
  const as_ = g(game.AS)
  const win = hs === '-' || as_ === '-' ? null : hs > as_ ? 'home' : as_ > hs ? 'away' : null
  const rt = rtLabel(game.RT)
  const fav = recentFavSide(game)
  const name = (t, isHome) => {
    const odds = recentTeamOdds(game, isHome)
    const favCls = fav ? (fav === (isHome ? 'home' : 'away') ? ' recent-tip-odds-fav' : ' recent-tip-odds-dog') : ''
    return (
      <>
        {t === team ? <u>{t}</u> : t}
        {odds && <span className={`recent-tip-odds${favCls}`}>({odds})</span>}
      </>
    )
  }
  return (
    <div
      className="recent-tip"
      style={{ left: Math.round(rect.left + rect.width / 2), top: Math.round(rect.top - 8) }}
    >
      <div className="recent-tip-when">
        {[formatDt(game.DT), formatTime(game.TM)].filter(Boolean).join(' ')}
        <span className="recent-tip-sep">/</span>
        <b className={`recent-tip-wdl recent-${game.letter}`}>{game.letter}</b>
        {rt && <span className="recent-tip-rt"> ({rt})</span>}
      </div>
      <div className="recent-tip-score">
        {name(game.HT, true)}{' '}
        <b className={win === 'home' ? 'winner-score' : undefined}>{hs}</b>
        {' - '}
        <b className={win === 'away' ? 'winner-score' : undefined}>{as_}</b>
        {' '}{name(game.AT, false)}
      </div>
    </div>
  )
}

function RecentTable({ row, streaks, recent10 }) {
  // 시즌 첫 라운드면 아직 치른 경기가 없어 양쪽 다 비어 있다 — 폼 지표와 같이 '-'로 둔다.
  const homeCells = recentCells(String(row.HR10 || ''), String(row.HR10H || ''))
  const awayCells = recentCells(String(row.AR10 || ''), String(row.AR10H || ''), true)
  const homeGames = recent10?.home || []
  const awayGames = recent10?.away || []
  const awayOffset = Math.max(0, 10 - awayGames.length)
  const hasStreak = streaks && (streaks.home?.played || streaks.away?.played)
  // 지금 마우스가 올라가 있는 칸 하나 — 떼면 null이 되어 말풍선이 사라진다.
  const [tip, setTip] = useState(null)
  const homeTeam = String(row.HT || '').trim()
  const awayTeam = String(row.AT || '').trim()
  const cellProps = (game, team) => (game
    ? {
      className: ' recent-cell-tip',
      onMouseEnter: (e) => setTip({ game, team, rect: e.currentTarget.getBoundingClientRect() }),
      onMouseLeave: () => setTip(null),
    }
    : { className: '' })
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
            {homeCells.map((c, i) => {
              const p = cellProps(c.ch ? homeGames[i] : null, homeTeam)
              return (
                <td
                  key={`h${i}`}
                  className={`recent-cell recent-${c.ch} ${c.isHome ? 'recent-cell-home' : ''}${p.className}`}
                  onMouseEnter={p.onMouseEnter}
                  onMouseLeave={p.onMouseLeave}
                >
                  {c.ch || '-'}
                </td>
              )
            })}
            {awayCells.map((c, i) => {
              const p = cellProps(c.ch ? awayGames[i - awayOffset] : null, awayTeam)
              return (
                <td
                  key={`a${i}`}
                  className={`recent-cell recent-${c.ch} ${c.isHome ? 'recent-cell-home' : ''}${p.className}`}
                  onMouseEnter={p.onMouseEnter}
                  onMouseLeave={p.onMouseLeave}
                >
                  {c.ch || '-'}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
      {hasStreak && (
        <div className="streak-row">
          <StreakLine data={streaks.home} align="left" />
          <StreakLine data={streaks.away} align="right" />
        </div>
      )}
      {tip && <RecentTip {...tip} />}
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

// 국)분석·해)분석·토탈의 배변 줄 전용 — 1등만 강조하고 2등은 안 준다(초기배당
// 줄은 1등+2등을 다 주는 것과 다르게, 배변은 "지금 가장 유력한 결과" 하나만 짚는다).
function maxOnlyClass(vals, i) {
  const max = Math.max(...vals)
  return max > 0 && vals[i] === max ? 'cell-max' : ''
}

// TK-*/TF-* ("국/통", "해/통")는 그 리그를 통합DB(6대리그 등 여러 리그 합산)와
// 섞은 지표다. 내 데이터는 리그 하나만 있어 통합 대상이 없으므로 항상 국내/해외
// 지표와 값이 완전히 같아진다 — 의미 없는 중복이라 내 데이터에서는 아예 뺀다.
// 통합(TF-*/TK-*)은 6대리그를 합쳐 표본은 크지만 그만큼 리그 특성이 뭉개져서 뺐고,
// 리그 안에서만 센 지표만 남긴다. 지표별 표본 기본 화면에 나오는 게 아래 7줄이다.
//
//   방향에 따라 갈리는 2줄   해)승·패   국)승·패
//   방향과 무관한 4줄        해)승+패   해)승+무+패   국)승+패   국)승+무+패
//   역할 기준 1줄            국)플핸
//
// [방향에 따라 갈리는 줄] 배당이 낮은 쪽이 정배다. 국내는 KW/KL, 해외는 FW/FL로 각각
// 따로 판정한다 — 둘이 서로 다른 팀을 정배로 보는 경기가 실측 4.25%(16,748경기 중
// 711건) 있는데, 그 엇갈림 자체가 "국내와 해외 시장이 갈렸다"는 볼 만한 신호라
// 하나로 합치지 않는다.
//
// [방향과 무관한 줄] 승+패·승+무+패는 승·패 배당을 동시에 맞추는 조건이라 정배가
// 어느 쪽이든 표본이 그대로다. 그래서 조건 없이 항상 넣는다.
//
// [국)플핸] 나머지가 "홈 칸이냐 원정 칸이냐"(자리 기준)인 것과 달리 이것만 "정배냐
// 언더독이냐"(역할 기준)로 찾는다 — 언더독 쪽 핸디배당이 같고 언더독이 같은 편인 경기.
// 자리 기준이 아니라서 정배 방향과 무관하게 항상 대상이다.
//
// ⚠ 2026-09-06 '승=홈팀·패=원정팀'을 여기서 뺐다(9줄 → 7줄). 조건이 가장 빡세 표본이
// 늘 제일 적은 줄이라, 배당 4칸에서는 그 줄 하나가 결과를 뒤집을 만큼 비중이 과했다
// (utils/verdictCalc.js의 oddsScopeCodes 주석에 실측 전부). 여기 '국)분석·해)분석'
// 줄에서는 재료가 4~5줄이라 원래도 영향이 작아, 빼도 정확도가 그대로였다 —
// 국)분석 초기 79.68%→79.67%(z=-0.11)·배변 78.67%→78.73%(z=0.50),
// 해)분석 초기 80.38%→80.44%(z=0.53)·배변 78.93%→79.09%(z=1.20).
// 손해가 없어서, 배당 4칸과 재료를 같게 맞추는 쪽(같은 지표를 같은 이유로 뺀다)을 골랐다.
function favSampleCodes(row) {
  const out = new Set(['F-WL', 'F-WDL', 'K-WL', 'K-WDL', 'K-PL'])
  const pick = (winKey, loseKey, winCode, loseCode) => {
    const w = numOrNull(row[winKey])
    const l = numOrNull(row[loseKey])
    if (w === null || l === null || w === l) return   // 배당이 없거나 같으면 정배가 없다
    out.add(w < l ? winCode : loseCode)
  }
  pick('KW', 'KL', 'K-W', 'K-L')
  pick('FW', 'FL', 'F-W', 'F-L')
  return out
}

// 국내·해외 블록 끝에 붙는 '분석' 줄. 가중평균이라 건수가 없어 %만 보여준다.
// vals가 null이면(그 블록에 표본이 하나도 없음 — 예: 내 데이터에서 국내배당이
// 없는 리그) 줄 자체를 숨기지 않고 빈칸(-)으로 채워서, 있으나 없으나 표 모양이
// 항상 같게 한다.
function AnalysisRow({ label, vals }) {
  return (
    <tr className="sample-analysis-row">
      <td className="row-label">{label}</td>
      {(vals || [null, null, null, null]).map((v, i) => (
        <td key={i} className={vals ? maxCellClass(vals, i) : undefined}>
          {v === null ? '-' : `${v.toFixed(1)}%`}
        </td>
      ))}
      <td className="col-total">—</td>
    </tr>
  )
}

// 지표 줄·분석 줄·토탈 줄 밑에 붙는 배변(최종배당) 줄. '최신배당 불러오기'가 최종배당
// 기준으로 표본을 다시 세어 둔 값을 그대로 보여준다(api/final_indicators.py).
// 화살표는 붙이지 않는다 — 표본 개수는 늘고 주는 것 자체에 좋고 나쁨이 없어서다.
// 아직 재계산이 안 돈 경기는 vals가 null이라 빈칸(-)으로 그려, 있으나 없으나 표
// 모양이 항상 같게 한다.
//   kind='count' : 지표 줄과 같은 "XX% (건수)" + 토탈 건수
//   kind='pct'   : 분석·토탈 줄과 같은 "XX.X%" (가중평균이라 건수가 없다)
// top1Only: 국)분석·해)분석·토탈 줄의 배변에서 쓴다 — 그 세 줄은 1등만 강조하고
// 2등은 안 준다(바로 위 원본 줄은 1등+2등을 다 주는 것과 다르게 규칙이 다르다).
function SampleFinalRow({ vals, total = 0, kind = 'count', top1Only = false }) {
  const cells = vals || [null, null, null, null]
  const text = (v) => {
    if (v === null) return '-'
    if (kind === 'pct') return `${v.toFixed(1)}%`
    return total > 0 ? `${Math.round((v / total) * 100)}% (${v})` : '-'
  }
  // 토탈 칸은 바로 윗줄과 같은 규칙 — 가중평균인 분석 줄은 건수가 없어 '—',
  // 토탈 줄은 건수를 보여준다(그래서 kind='pct'라도 total을 주면 숫자로 찍힌다).
  const totalText = kind === 'pct' ? (total || '—') : (vals ? total : '-')
  return (
    <tr className="sample-final-row">
      <td className="row-label">배변</td>
      {cells.map((v, i) => (
        <td key={i} className={vals ? (top1Only ? maxOnlyClass(cells, i) : maxCellClass(cells, i)) : undefined}>
          {text(v)}
        </td>
      ))}
      <td className="col-total">{totalText}</td>
    </tr>
  )
}

// ── 방향성 요약 (확률 지표 제목 옆 한 줄) ──
// 지표별 표본의 '국) 분석 / 해) 분석' 줄과 정확히 같은 4칸(핸승/핸무/무/역 %)에서,
// 사용자가 실제로 거는 "3개 중 1개 배제" 형태의 이름 하나를 뽑는다(CLAUDE.md 5-1).
//
// 6종 = 두 3way 시장에서 각각 하나를 배제한 나머지
//   승무패 {정승(핸승+핸무), 무, 역} : 역배제=정무 / 무배제=정역 / 정승배제=플
//   핸디   {핸승, 핸무, 플핸(무+역)} : 핸승배제=플핸무 / 핸무배제=플핸승 / 플핸배제=정
//
// 규칙이 두 단계인 이유 — '가장 작은 하나를 배제'만 쓰면 정·플은 배제 대상이 둘이라
// 단일보다 작아지기가 거의 불가능해 사실상 안 나온다(실측 1,136경기: 플 0.4% / 정 0.0%).
// 그래서 한쪽 쌍이 압도적일 때만 정·플을 먼저 집는 단계를 앞에 뒀다.
// 기준선 80%는 실측으로 골랐다 — 70%면 정이 26.3%로 정무보다 흔해지고, 90%면 플이
// 1.9%로 거의 안 나온다. 80%에서 정 14.1% / 플 5.4%로 "가끔 나오는 신호"가 된다.
// (directionName·weightedAnalysis는 utils/verdictCalc.js로 옮겨 리그표 '판정' 칸과
// 같이 쓴다 — 이 파일 맨 위 import 참고.)

// 방향성 이름은 실제로 두 조각의 합성어다 — '정'(핸승+핸무를 묶어 부르는 이름)
// '플'(무+역을 묶어 부르는 이름) + 나머지 하나(무/역/핸무/핸승 그대로).
//   정무 = 정(핸승,핸무) + 무   |   정역 = 정(핸승,핸무) + 역
//   플핸무 = 플(무,역) + 핸무    |   플핸승 = 플(무,역) + 핸승
//   정 = 정(핸승,핸무) 단독      |   플 = 플(무,역) 단독
// 그래서 "정무인데 실제 결과가 핸승이면 '정' 조각만 켜고 '무'는 그대로 둬야" 맞다 —
// 결과가 무일 때만 '무' 조각이 켜진다. 통짜로 같이 켜면(예전 방식) 결과가 핸승일 때
// 안 나온 '무'까지 같이 켜져서 틀린 정보가 된다.
const JEONG = ['핸승', '핸무']
const PL = ['무', '역']
const DIR_PARTS = {
  정무: [['정', JEONG], ['무', ['무']]],
  정역: [['정', JEONG], ['역', ['역']]],
  플핸무: [['플', PL], ['핸무', ['핸무']]],
  플핸승: [['플', PL], ['핸승', ['핸승']]],
  정: [['정', JEONG]],
  플: [['플', PL]],
}

// ── 이 방향성이 과거에 얼마나 맞았나 (2026-08-29 실측) ──
// 6대리그 32,466경기(결과가 있고 배변 지표까지 있는 경기 전부) 기준.
// 적중 = 그 이름이 '빼라'고 한 결과가 실제로 안 나옴(정무면 역만 안 나오면 적중) —
// CLAUDE.md 5-1의 "3개 중 1개 배제" 관점 그대로다.
//
// ⚠ 같음/다름은 '이름'이 아니라 '방향'으로 가른다(DIR_SIDE).
//   정무·정역·정 = 정 방향(핸승+핸무 쪽이 유력), 플핸무·플핸승·플 = 플 방향(무+역 쪽).
//   정무와 정역은 둘 다 정배 쪽을 보되 보험을 무로 가냐 역으로 가냐만 다르므로
//   "같은 방향"이 맞다. 이름 문자열로 가르면 이걸 '다름'으로 잘못 세게 된다.
//
// ⚠ 정배배당대까지 나눠서 잰다. 전체 평균과 견주면 값이 부풀려지기 때문이다 —
//   예를 들어 '플핸무'는 정배가 약한 경기에서 잘 뜨는데(1.8~2.2 구간에 50.2%가 몰림,
//   전체는 32.6%) 그런 경기는 원래 핸승이 덜 나온다(정배 1.5 미만이면 핸승 46.4%,
//   2.2 이상이면 16.1%). 그래서 전체 평균 대비로는 +7.3%p처럼 보이지만 같은 배당대끼리
//   견주면 +1.5%p뿐이다. 나머지는 지표가 아니라 배당이 이미 말해 주던 몫이다.
//
// ⚠ 국)과 해)는 각각 자기 값으로 따로 잰다(2026-08-30). 두 가지를 고쳤다.
//   ① 방향이 같아도 방향성 이름은 다를 수 있다(국)정역 · 해)정무처럼 — 방향이 같은
//      경기의 52%가 그렇다). 배제 대상이 서로 다른 별개의 베팅인데 예전엔 국내 것
//      하나만 보여주고 해외 쪽을 감췄다.
//   ② 해) 쪽 배당대를 해외배당(FW/FL, 배변은 EFW/EFL)으로 바꿨다. 예전엔 국내
//      배당대를 갖다 썼는데, 국내와 해외는 40%의 경기에서 서로 다른 구간에 들어간다.
//      그래서 방향성이 같아도 배당대가 다르면 두 값이 갈린다.
//
// 키: DIR_HIT[기준][방향일치][국해][방향성][배당대]
// 값: [적중률%, 표본수, 같은 배당대의 나머지 경기 적중률%, z, 리그일치]
//     한 칸당 표본 150건 미만이면 아예 넣지 않는다(못 믿을 값을 띄우지 않는다).
//
// ⚠ 리그일치(마지막 값 1/0) — 6리그를 합쳐서 재기 때문에 붙인 안전장치다.
//   통합은 표본이 6배지만(리그별로 하면 144칸 중 25~46칸밖에 안 남는다) 리그 특성을
//   뭉갤 위험이 있다. 그래서 칸마다 리그별로 부호를 다시 세어, 어긋나는 리그가 1개
//   이하일 때만 1로 둔다. 0인 칸은 z가 아무리 커도 색을 주지 않는다 —
//   "통합했기 때문에 생긴 신호"를 걸러내는 장치다(실측: 54칸 중 4칸이 여기서 빠졌다).
//   효과의 방향 자체는 리그를 거의 안 가린다(색 50칸 중 35칸이 6리그 만장일치).
//
// ⚠ 실측에서 드러난 것 — 초기와 배변이 정반대로 움직인다.
//   초기는 대부분 이득이 0 근처다(= 배당이 이미 말한 것을 되풀이할 뿐).
//   배변은 색이 붙는 54칸 중 38칸이 빨강이고, 특히 해외 쪽(diffFor)은 -10 ~ -30%p다.
//   원인은 api/final_indicators.py가 표본 풀은 과거 경기의 '초기배당' 기준으로 두고
//   이 경기만 '최종배당'으로 찾아 들어가기 때문이다(배당이 안 움직인 경기는 초기와
//   값이 완전히 같고, 움직인 경기에서만 뒤집힌다 — 국 20.7%→36.3%, 해 19.9%→36.9%).
const DIR_HIT = {
  init: {
    same: {
      dom: {
        정무: { '~1.5': [89, 3481, 89, -0.6, 0], '1.5~1.8': [80, 1635, 80, 0.0, 0], '1.8~2.2': [74, 650, 73, 0.6, 0] },
        정역: { '~1.5': [83, 1249, 82, 0.8, 0], '1.5~1.8': [74, 882, 74, 0.1, 0], '1.8~2.2': [70, 498, 71, -0.8, 0] },
        플핸무: { '1.5~1.8': [71, 516, 71, -0.0, 0], '1.8~2.2': [81, 2233, 78, 3.0, 1], '2.2+': [84, 1446, 84, 0.1, 0] },
        플핸승: { '~1.5': [79, 206, 75, 1.0, 1], '1.5~1.8': [76, 845, 75, 0.7, 0], '1.8~2.2': [79, 1878, 77, 2.0, 0], '2.2+': [78, 744, 79, -0.7, 0] },
        정: { '~1.5': [76, 2645, 69, 6.9, 1], '1.5~1.8': [56, 297, 54, 0.8, 0] },
        플: { '1.8~2.2': [59, 602, 56, 1.5, 0], '2.2+': [64, 533, 62, 0.8, 0] },
      },
      for: {
        정무: { '~1.5': [90, 2746, 91, -1.3, 1], '1.5~1.8': [83, 2305, 83, 0.2, 0], '1.8~2.2': [78, 1366, 76, 1.9, 1], '2.2+': [71, 290, 70, 0.3, 1] },
        정역: { '~1.5': [83, 601, 84, -0.7, 0], '1.5~1.8': [77, 910, 76, 0.5, 0], '1.8~2.2': [73, 656, 72, 0.2, 0], '2.2+': [70, 294, 70, -0.2, 0] },
        플핸무: { '1.5~1.8': [71, 173, 66, 1.4, 0], '1.8~2.2': [78, 1482, 75, 2.4, 0], '2.2+': [83, 3268, 81, 2.4, 1] },
        플핸승: { '1.5~1.8': [76, 435, 74, 0.9, 0], '1.8~2.2': [77, 1582, 76, 1.0, 0], '2.2+': [79, 1788, 78, 0.9, 0] },
        정: { '~1.5': [80, 2219, 72, 6.8, 1], '1.5~1.8': [62, 224, 59, 0.7, 0] },
        플: { '2.2+': [60, 329, 60, 0.1, 0] },
      },
    },
    diff: {
      dom: {
        정무: { '~1.5': [85, 534, 89, -3.0, 1], '1.5~1.8': [79, 1033, 80, -0.2, 0], '1.8~2.2': [76, 1219, 73, 2.3, 1], '2.2+': [63, 324, 69, -2.2, 1] },
        정역: { '~1.5': [78, 232, 82, -1.5, 0], '1.5~1.8': [71, 592, 75, -1.8, 0], '1.8~2.2': [73, 1000, 71, 1.1, 1], '2.2+': [62, 306, 70, -2.7, 0] },
        플핸무: { '~1.5': [62, 154, 53, 2.2, 1], '1.5~1.8': [73, 623, 71, 1.0, 0], '1.8~2.2': [78, 1077, 78, -0.2, 0], '2.2+': [82, 311, 84, -1.0, 0] },
        플핸승: { '~1.5': [74, 924, 76, -0.9, 1], '1.5~1.8': [75, 1047, 75, -0.0, 0], '1.8~2.2': [78, 944, 77, 0.6, 0], '2.2+': [73, 204, 79, -2.0, 1] },
        정: { '~1.5': [70, 288, 71, -0.4, 0], '1.5~1.8': [59, 179, 54, 1.4, 0], '1.8~2.2': [42, 153, 44, -0.6, 0] },
        플: { '1.8~2.2': [59, 237, 56, 0.9, 0] },
      },
      for: {
        정무: { '~1.5': [87, 357, 91, -2.4, 1], '1.5~1.8': [82, 901, 83, -0.5, 0], '1.8~2.2': [77, 1441, 76, 1.3, 0], '2.2+': [71, 703, 70, 0.9, 0] },
        정역: { '1.5~1.8': [76, 394, 76, -0.2, 0], '1.8~2.2': [73, 777, 72, 0.2, 0], '2.2+': [73, 755, 70, 1.9, 0] },
        플핸무: { '1.5~1.8': [70, 328, 66, 1.6, 0], '1.8~2.2': [75, 1123, 75, -0.1, 0], '2.2+': [82, 1160, 82, -0.2, 0] },
        플핸승: { '~1.5': [78, 409, 76, 0.8, 0], '1.5~1.8': [75, 907, 74, 0.6, 0], '1.8~2.2': [75, 1177, 77, -0.9, 0], '2.2+': [81, 619, 78, 1.6, 0] },
        정: { '~1.5': [79, 193, 75, 1.3, 1] },
      },
    },
  },
  final: {
    same: {
      dom: {
        정무: { '~1.5': [88, 3425, 90, -2.8, 1], '1.5~1.8': [80, 1573, 79, 0.4, 0], '1.8~2.2': [74, 601, 73, 0.6, 0] },
        정역: { '~1.5': [79, 1274, 82, -3.0, 1], '1.5~1.8': [72, 944, 75, -1.8, 0], '1.8~2.2': [70, 493, 71, -0.9, 0] },
        플핸무: { '1.5~1.8': [70, 517, 71, -0.4, 0], '1.8~2.2': [79, 2221, 78, 0.8, 0], '2.2+': [83, 1392, 84, -0.7, 1] },
        플핸승: { '~1.5': [69, 243, 76, -2.3, 1], '1.5~1.8': [76, 846, 75, 0.4, 0], '1.8~2.2': [79, 1938, 77, 2.2, 1], '2.2+': [81, 736, 78, 1.9, 0] },
        정: { '~1.5': [76, 2639, 69, 6.4, 1], '1.5~1.8': [54, 302, 54, 0.2, 0] },
        플: { '1.8~2.2': [55, 632, 56, -0.5, 0], '2.2+': [63, 603, 63, 0.1, 0] },
      },
      for: {
        정무: { '~1.5': [89, 2451, 92, -4.0, 1], '1.5~1.8': [82, 2364, 84, -2.7, 1], '1.8~2.2': [78, 1217, 76, 1.1, 0], '2.2+': [67, 226, 68, -0.4, 0] },
        정역: { '~1.5': [79, 576, 84, -3.2, 1], '1.5~1.8': [73, 892, 77, -2.0, 0], '1.8~2.2': [76, 674, 72, 2.4, 1], '2.2+': [68, 265, 70, -0.7, 0] },
        플핸무: { '1.5~1.8': [61, 220, 67, -1.7, 1], '1.8~2.2': [75, 1309, 75, 0.1, 0], '2.2+': [82, 3196, 83, -1.2, 1] },
        플핸승: { '1.5~1.8': [70, 483, 74, -1.9, 0], '1.8~2.2': [76, 1533, 76, -0.4, 1], '2.2+': [79, 1812, 79, -0.2, 0] },
        정: { '~1.5': [79, 2514, 73, 5.9, 1], '1.5~1.8': [59, 304, 59, -0.2, 0] },
        플: { '2.2+': [60, 575, 62, -0.8, 0] },
      },
    },
    diff: {
      dom: {
        정무: { '~1.5': [87, 543, 89, -1.5, 0], '1.5~1.8': [79, 910, 79, -0.3, 0], '1.8~2.2': [71, 1084, 73, -1.2, 0], '2.2+': [65, 311, 69, -1.2, 1] },
        정역: { '~1.5': [86, 221, 82, 1.7, 1], '1.5~1.8': [70, 634, 75, -2.9, 1], '1.8~2.2': [69, 929, 72, -1.5, 1], '2.2+': [68, 375, 69, -0.6, 0] },
        플핸무: { '~1.5': [56, 188, 54, 0.6, 0], '1.5~1.8': [68, 699, 72, -1.8, 1], '1.8~2.2': [76, 1070, 79, -1.9, 0], '2.2+': [88, 298, 84, 2.1, 1] },
        플핸승: { '~1.5': [73, 1038, 76, -2.1, 0], '1.5~1.8': [75, 1055, 75, -0.2, 0], '1.8~2.2': [76, 861, 77, -0.6, 0], '2.2+': [75, 151, 79, -0.9, 1] },
        정: { '~1.5': [71, 292, 71, -0.1, 0], '1.5~1.8': [54, 177, 54, 0.2, 1], '1.8~2.2': [46, 153, 44, 0.4, 0] },
        플: { '1.8~2.2': [59, 297, 56, 1.0, 0] },
      },
      for: {
        정무: { '~1.5': [89, 410, 91, -1.5, 0], '1.5~1.8': [84, 1024, 83, 0.9, 0], '1.8~2.2': [76, 1497, 77, -1.0, 0], '2.2+': [69, 601, 68, 0.1, 0] },
        정역: { '1.5~1.8': [77, 404, 76, 0.6, 0], '1.8~2.2': [72, 823, 72, 0.2, 0], '2.2+': [69, 693, 70, -0.7, 0] },
        플핸무: { '1.5~1.8': [64, 358, 67, -1.1, 1], '1.8~2.2': [73, 930, 75, -1.6, 1], '2.2+': [83, 1143, 83, 0.6, 0] },
        플핸승: { '~1.5': [77, 448, 76, 0.8, 0], '1.5~1.8': [72, 821, 74, -1.1, 1], '1.8~2.2': [75, 1008, 76, -1.2, 0], '2.2+': [79, 688, 79, -0.0, 0] },
        정: { '~1.5': [79, 275, 75, 1.3, 0] },
        플: { '2.2+': [61, 173, 61, -0.0, 0] },
      },
    },
  },
}

// DIR_SIDE(이름 -> 방향, 첫 조각이 곧 방향)는 utils/verdictCalc.js에서 가져온다
// (파일 맨 위 import) — 리그표 '판정' 칸과 같은 값을 써야 한다.

// ⚠ 2026-08-29에 '초기 -> 배변으로 방향이 뒤집히면 경고(⚠)'를 넣었다가 하루 만에
//   뺐다(2026-08-30). 그때는 뒤집힌 경기에서 배변 쪽을 따르면 51%, 초기 쪽을 따르면
//   83.5%로 30%p 넘게 갈렸는데, 그건 신호가 아니라 배변 지표가 망가져 있어서 생긴
//   현상이었다. final_indicators.py의 표본 풀을 배변배당 기준으로 고치자 그 차이가
//   6대리그 국 2.6%p / 해 1.6%p로 줄어 표식을 붙일 근거가 사라졌다
//   (K1 국만 13.4%p로 남았지만 리그마다 1.3~13.4%p로 들쭉날쭉해 못 믿는다).
//   같은 걸 다시 넣으려면 먼저 재측정할 것.

// 정배배당 구간 — oddsMove.js·CLAUDE.md가 쓰는 1.8 경계를 포함해 넷으로 나눈다.
const DIR_BANDS = [[1.5, '~1.5'], [1.8, '1.5~1.8'], [2.2, '1.8~2.2'], [Infinity, '2.2+']]

/** 정배배당(=승·패 중 싼 쪽)이 어느 구간인가. 배당이 없으면 null. */
function dirBand(w, l) {
  const a = numOrNull(w)
  const b = numOrNull(l)
  if (a === null || b === null || a <= 0 || b <= 0) return null
  const fav = Math.min(a, b)
  return (DIR_BANDS.find(([hi]) => fav < hi) || [])[1] || null
}

/** 색을 줄 만큼 확실한가 — 고정 %p가 아니라 두 비율 검정(z)으로 정한다.
 *  표본 200짜리에서 +3%p는 우연이지만 3,000짜리에서 +3%p는 우연이 아니다. */
const DIR_Z_CUT = 2

const DIR_SIDE_LABEL = { dom: '국내', for: '해외' }

/** agree: 'same'(국·해 방향 일치) | 'diff'(갈림) — side: 'dom'(국내) | 'for'(해외) */
function DirRate({ phase, agree, side, name, band }) {
  const e = name && band ? DIR_HIT[phase]?.[agree]?.[side]?.[name]?.[band] : null
  if (!e) {
    return (
      <span
        className="dir-rate dir-rate-none"
        title={band
          ? '이 조합은 표본이 적어(150건 미만) 믿을 값을 내지 못합니다'
          : '배당이 없어 어느 배당대인지 알 수 없습니다'}
      >
        —
      </span>
    )
  }
  const [pct, n, rest, z, leagueOk] = e
  const gap = pct - rest
  const strong = Math.abs(z) >= DIR_Z_CUT && leagueOk
  const cls = !strong ? '' : z > 0 ? ' dir-rate-good' : ' dir-rate-bad'
  const verdict = Math.abs(z) < DIR_Z_CUT
    ? `이 정도 차이는 우연 범위입니다 (z=${z}) — 색을 주지 않습니다`
    : leagueOk
      ? `우연으로 보기 어렵습니다 (z=${z})`
      : `리그마다 방향이 갈려 통합값만으로는 못 믿습니다 (z=${z}) — 색을 주지 않습니다`
  const tip = `${DIR_SIDE_LABEL[side]} 지표가 '${name}'이고 국·해 방향이 `
    + `${agree === 'same' ? '같을' : '갈렸을'} 때 — ${DIR_SIDE_LABEL[side]} 정배배당 ${band}`
    + `\n과거 ${n.toLocaleString()}경기 중 ${pct}%에서 배제가 맞았습니다.`
    + `\n같은 배당대의 나머지 경기는 ${rest}% (${gap >= 0 ? '+' : ''}${gap}%p)`
    + `\n${verdict}`
  return <span className={`dir-rate${cls}`} title={tip}>{pct}%</span>
}

// 괄호 안 — 핸승/핸무/무/역 중 값이 가장 큰 것 하나. 방향성과는 별개 정보다
// (방향성은 '무엇을 뺄까', 이건 '무엇이 제일 유력한가').
const DIR_TOP_LABELS = ['핸승', '핸무', '무', '역']
function topOutcome(v) {
  if (!v) return null
  let bi = 0
  for (let i = 1; i < 4; i += 1) if (v[i] > v[bi]) bi = i
  return DIR_TOP_LABELS[bi]
}

// row에서 '국) 분석 / 해) 분석'과 같은 4칸을 만든다. SampleTable이 화면에 그리는 값과
// 어긋나지 않도록, 거기서 쓰는 것과 완전히 같은 재료(판단 7줄 · 같은 순서 · 같은 가중치)를 쓴다.
//   final=false → 초기배당 기준(vals),  final=true → 배변(최종배당) 기준(E_ 컬럼)
function analysisPair(row, scope, final) {
  const favCodes = favSampleCodes(row)
  const indicators = scope === 'user'
    ? SAMPLE_INDICATORS.filter(([code]) => !code.startsWith('TK-') && !code.startsWith('TF-'))
    : SAMPLE_INDICATORS
  const cnt = (v) => {
    const n = Number(v)
    return Number.isNaN(n) ? 0 : Math.trunc(n)
  }
  const lines = []
  for (const [code, label] of indicators) {
    if (!favCodes.has(code)) continue        // 화면 기본값과 같은 '판단에 쓰는 7줄'만
    let vals
    if (final) {
      const raw = [1, 2, 3, 4].map((i) => row[`E_${code} ${i}`])
      if (!raw.some((v) => v !== null && v !== undefined && v !== '')) continue
      vals = raw.map(cnt)
    } else {
      vals = [1, 2, 3, 4].map((i) => cnt(row[`${code} ${i}`]))
    }
    lines.push({ code, label, vals, total: vals.reduce((a, b) => a + b, 0) })
  }
  const isForeign = (c) => /^(F|TF)-/.test(c)
  return {
    dom: weightedAnalysis(lines.filter((l) => !isForeign(l.code))),
    forr: weightedAnalysis(lines.filter((l) => isForeign(l.code))),
  }
}

// "국) 정무(무) / 해) 플핸무(역)" 한 덩어리. 값이 없으면 null.
// actual: 이미 결과가 나온 경기면 rtLabel(row.RT)('핸승'/'핸무'/'무'/'역'), 아니면 null.
// 괄호 안(최다 1개)이 실제 결과와 같으면 그 글자만 노란색으로 — "적중" 표시와
// 같은 색(--chip-yellow-fg, PICK_VERDICT '적중' 배지와 동일 계열)이다.
// 국·해 사이 구분자가 곧 "두 지표가 같은 방향을 가리켰는가"를 말해 준다.
// 이름이 아니라 방향(정/플)으로 가른다 — 정무와 정역은 둘 다 정배 쪽을 보고
// 보험만 다른 것이라 '같음'이다(DIR_SIDE 주석 참고).
//   같으면  국)정무(역) = 해)정역(무) → 84%      ← 한 덩어리라 끝에 하나만
//   다르면  국)정무(역) 77% ≠ 해)플핸무(무) 77%   ← 서로 다른 베팅이라 각각 붙인다
// 갈렸을 때 한쪽만 보여주면(예전 방식) 나머지 절반이 숨고, '국내 우선'이라는 규칙도
// 화면만 봐선 알 수 없어 오해를 낳는다.
function DirectionPart({ pair, actual, phase, band }) {
  if (!pair || (!pair.dom && !pair.forr)) return <span className="dir-none">—</span>
  const domName = pair.dom ? directionName(pair.dom) : null
  const forName = pair.forr ? directionName(pair.forr) : null
  // 한쪽 값이 아예 없으면 '같다/다르다'를 말할 수 없다 — 그때만 중립 구분자(/)를 쓴다.
  const bothKnown = domName !== null && forName !== null
  const same = bothKnown && DIR_SIDE[domName] === DIR_SIDE[forName]
  const agree = same ? 'same' : 'diff'
  const one = (label, v, name, side) => (
    <span className="dir-one" key={label}>
      <span className="dir-market">{label})</span>
      {v ? (
        <>
          <b className="dir-name">
            {(DIR_PARTS[name] || [[name, []]]).map(([piece, covers]) => (
              <span
                key={piece}
                className={actual && covers.includes(actual) ? 'dir-name-hit' : undefined}
              >
                {piece}
              </span>
            ))}
          </b>
          <span className={`dir-top${actual && topOutcome(v) === actual ? ' dir-top-hit' : ''}`}>
            ({topOutcome(v)})
          </span>
          {bothKnown && band && (
            <DirRate phase={phase} agree={agree} side={side} name={name} band={band[side]} />
          )}
        </>
      ) : (
        <span className="dir-none">—</span>
      )}
    </span>
  )
  // 국·해는 서로 다른 베팅이라(방향이 같아도 방향성 이름이 다를 수 있고, 배당대도
  // 40%가 갈린다) 퍼센트를 양쪽에 각각 붙인다. =/≠는 방향이 같은지만 말해 준다.
  return (
    <>
      {one('국', pair.dom, domName, 'dom')}
      <span className={`dir-sep${bothKnown && !same ? ' dir-sep-diff' : ''}`}>
        {bothKnown ? (same ? '=' : '≠') : '/'}
      </span>
      {one('해', pair.forr, forName, 'for')}
    </>
  )
}

// 확률 지표 제목 옆 방향성 요약 줄 — 초기 | 배변.
//
// ⚠ 적중률(DIR_HIT)은 공식 데이터(6대리그)로만 쟀다. 내 데이터(K리그 등)는 표본에
//   들어 있지 않고, 통합지표(TK-/TF-)를 빼고 계산해서 지표 구성 자체가 다르다.
//   그래서 내 데이터에서는 숫자를 아예 안 띄운다(band=null) — 못 믿을 값을 띄우느니
//   비워 두는 게 낫다. K리그로 따로 재면 그때 켠다.
function DirectionSummary({ row, scope }) {
  const init = analysisPair(row, scope, false)
  const fin = analysisPair(row, scope, true)
  const hasFinal = fin && (fin.dom || fin.forr)
  // 취소·연기는 '결과'가 아니라 핸승/핸무/무/역 중 하나일 때만 적중 비교 대상이다.
  const rtText = rtLabel(row.RT)
  const actual = ['핸승', '핸무', '무', '역'].includes(rtText) ? rtText : null
  // 배당대는 '그 줄이 실제로 쓴 배당'으로 잡는다 — 초기 줄은 초기배당, 배변 줄은
  // 최종배당. 국)은 국내배당, 해)는 해외배당으로 각각 따로 본다(40%가 서로 다른
  // 구간에 들어간다).
  const isMaster = scope !== 'user'
  const bandInit = isMaster
    ? { dom: dirBand(row.KW, row.KL), for: dirBand(row.FW, row.FL) }
    : null
  const bandFinal = isMaster
    ? {
      dom: dirBand(row.EKW, row.EKL) ?? dirBand(row.KW, row.KL),
      for: dirBand(row.EFW, row.EFL) ?? dirBand(row.FW, row.FL),
    }
    : null
  return (
    <span className="detail-section-note dir-summary">
      <span className="dir-block">
        <span className="dir-when">초기</span>
        <DirectionPart pair={init} actual={actual} phase="init" band={bandInit} />
      </span>
      <span className="dir-bar">|</span>
      <span className="dir-block">
        <span className="dir-when dir-when-final">배변</span>
        {hasFinal
          ? <DirectionPart pair={fin} actual={actual} phase="final" band={bandFinal} />
          : <span className="dir-none">—</span>}
      </span>
    </span>
  )
}

// expanded=false(기본)면 판단에 쓰는 7줄만 보여준다.
// (2026-09-06: 펼쳤을 때 그 줄들에 테두리를 두르던 강조는 없앴다 — sample-fav-row.)
function SampleTable({ row, scope, expanded }) {
  const favCodes = favSampleCodes(row)
  const indicators = scope === 'user'
    ? SAMPLE_INDICATORS.filter(([code]) => !code.startsWith('TK-') && !code.startsWith('TF-'))
    : SAMPLE_INDICATORS
  const cnt = (v) => {
    const n = Number(v)
    return Number.isNaN(n) ? 0 : Math.trunc(n)
  }
  const allLines = indicators.map(([code, label]) => {
    const vals = [1, 2, 3, 4].map((i) => cnt(row[`${code} ${i}`]))
    // 최종배당 기준으로 다시 센 표본. 아직 '최신배당 불러오기'가 안 돈 경기는
    // E_ 컬럼 자체가 없어(undefined) eVals를 null로 두고 빈칸으로 그린다.
    const eRaw = [1, 2, 3, 4].map((i) => row[`E_${code} ${i}`])
    const hasE = eRaw.some((v) => v !== null && v !== undefined && v !== '') && sampleOddsMoved(row, code)
    const eVals = hasE ? eRaw.map(cnt) : null
    return {
      code, label, vals,
      total: vals.reduce((a, b) => a + b, 0),
      eVals,
      eTotal: eVals ? eVals.reduce((a, b) => a + b, 0) : 0,
    }
  })
  // 화면에 그릴 줄 — 접었을 때는 판단 7줄 + 국통)·해통) 승+패/승+무+패 4줄(2026-09-05
  // 추가, SAMPLE_DEFAULT_EXTRA)까지 보여준다. '국)분석/해)분석' 줄은 이 4줄과 무관하게
  // calcLines(판단 7줄만)로 따로 계산한다 — 안 그러면 이 표의 %가 analysisPair()가
  // 만드는 실제 방향성 4칸·판정과 어긋나 보인다(같은 경기인데 표는 A%, 판정은 B%).
  const lines = expanded
    ? allLines
    : allLines.filter((l) => favCodes.has(l.code) || SAMPLE_DEFAULT_EXTRA.has(l.code))
  const calcLines = allLines.filter((l) => favCodes.has(l.code))

  // 토탈은 '지금 화면에 보이는 줄'의 합이다 — 접었을 때 안 보이는 줄까지 더하면
  // 눈에 보이는 숫자와 합이 안 맞아 읽는 사람이 검산할 수 없다.
  const grandVals = [0, 1, 2, 3].map((i) => lines.reduce((sum, l) => sum + l.vals[i], 0))
  const grandTotal = grandVals.reduce((a, b) => a + b, 0)

  // 배변(최종배당) 쪽 합계 — 한 줄이라도 재계산돼 있을 때만 낸다.
  const anyFinal = lines.some((l) => l.eVals)
  const eGrandVals = anyFinal
    ? [0, 1, 2, 3].map((i) => lines.reduce((sum, l) => sum + (l.eVals ? l.eVals[i] : 0), 0))
    : null
  const eGrandTotal = eGrandVals ? eGrandVals.reduce((a, b) => a + b, 0) : 0

  // 접었을 때만 국내/해외 블록 끝에 '분석' 줄을 붙인다. 펼치면 통합지표까지 섞여
  // 들어와 '리그 지표만 본다'는 전제가 깨지므로 그때는 계산하지 않는다(그때는 null).
  // 접혔는데 표본 자체가 없어 null이 나온 경우는 AnalysisRow가 빈칸으로 그려준다.
  // ⚠ 반드시 calcLines(판단 7줄)로만 계산한다 — lines(화면 표시용)를 쓰면 안 된다.
  const isForeignCode = (c) => /^(F|TF)-/.test(c)
  const domAnalysis = expanded ? null : weightedAnalysis(calcLines.filter((l) => !isForeignCode(l.code)))
  const forAnalysis = expanded ? null : weightedAnalysis(calcLines.filter((l) => isForeignCode(l.code)))
  // 토탈 = 국내 분석과 해외 분석의 평균(한쪽만 있으면 그쪽만).
  const bothAnalysis = [domAnalysis, forAnalysis].filter(Boolean)
  const totalAnalysis = bothAnalysis.length
    ? [0, 1, 2, 3].map((i) => bothAnalysis.reduce((s, a) => s + a[i], 0) / bothAnalysis.length)
    : null

  // 분석 줄의 배변도 같은 가중평균을 최종배당 표본으로, 역시 calcLines 기준으로 돈다.
  const anyFinalCalc = calcLines.some((l) => l.eVals)
  const eCalcLines = calcLines.map((l) => ({ ...l, vals: l.eVals || [0, 0, 0, 0], total: l.eTotal }))
  const eDomAnalysis = expanded || !anyFinalCalc
    ? null : weightedAnalysis(eCalcLines.filter((l) => !isForeignCode(l.code)))
  const eForAnalysis = expanded || !anyFinalCalc
    ? null : weightedAnalysis(eCalcLines.filter((l) => isForeignCode(l.code)))
  const eBoth = [eDomAnalysis, eForAnalysis].filter(Boolean)
  const eTotalAnalysis = eBoth.length
    ? [0, 1, 2, 3].map((i) => eBoth.reduce((s, a) => s + a[i], 0) / eBoth.length)
    : null

  return (
    <table className="detail-table sample-table">
      <thead>
        <tr>
          <th className="row-label">지표</th>
          <th className="col-hs">핸승</th>
          <th className="col-hm">핸무</th>
          <th className="col-mu">무</th>
          <th className="col-yk">역</th>
          <th className="col-total">토탈</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, li) => {
          const isForeign = isForeignCode(l.code)
          const prev = li > 0 ? lines[li - 1] : null
          const groupStart = prev && isForeign && !isForeignCode(prev.code)
          const cls = [
            groupStart && 'sample-group-start',
          ].filter(Boolean).join(' ')
          return (
            <Fragment key={l.code}>
              {/* 국내 블록이 끝나는 자리(= 해외 첫 줄 직전)에 국내 분석을 끼운다.
                  표본이 없어도(domAnalysis===null) AnalysisRow가 빈칸으로 그린다. */}
              {groupStart && !expanded && (
                <>
                  <AnalysisRow label="국) 분석" vals={domAnalysis} />
                  <SampleFinalRow vals={eDomAnalysis} kind="pct" top1Only />
                </>
              )}
              <tr className={cls || undefined}>
                <td className={`row-label${SAMPLE_SCOPE_CODES.has(l.code) ? ' sample-scope-label' : ''}`}>
                  {l.label}
                </td>
                {/* "비율 (건수)" 한 줄로 — 예: 45% (12) */}
                {l.vals.map((v, i) => (
                  <td key={i} className={maxCellClass(l.vals, i)}>
                    {l.total > 0 ? `${Math.round((v / l.total) * 100)}% (${v})` : '-'}
                  </td>
                ))}
                <td className="col-total">{l.total}</td>
              </tr>
              <SampleFinalRow vals={l.eVals} total={l.eTotal} />
            </Fragment>
          )
        })}
        {/* 해외 분석은 마지막 줄 뒤라 위 반복문 밖에서 붙인다 */}
        {!expanded && (
          <>
            <AnalysisRow label="해) 분석" vals={forAnalysis} />
            <SampleFinalRow vals={eForAnalysis} kind="pct" top1Only />
          </>
        )}
        {totalAnalysis ? (
          <tr className="sample-grand-total">
            <td className="row-label">토탈</td>
            {totalAnalysis.map((v, i) => (
              <td key={i} className={maxCellClass(totalAnalysis, i)}>{v.toFixed(1)}%</td>
            ))}
            <td className="col-total">{grandTotal}</td>
          </tr>
        ) : (
          <tr className="sample-grand-total">
            <td className="row-label">토탈</td>
            {grandVals.map((v, i) => (
              <td key={i} className={maxCellClass(grandVals, i)}>
                {grandTotal > 0 ? `${Math.round((v / grandTotal) * 100)}% (${v})` : '-'}
              </td>
            ))}
            <td className="col-total">{grandTotal}</td>
          </tr>
        )}
        {totalAnalysis
          ? <SampleFinalRow vals={eTotalAnalysis} total={eGrandTotal} kind="pct" top1Only />
          : <SampleFinalRow vals={eGrandVals} total={eGrandTotal} top1Only />}
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
  const [reasonTag, setReasonTag] = useState(row.REASON_TAG || '')
  // 배당픽 — 내픽(pick)과 선택지는 같지만(PICK_OPTIONS) 완전히 별개로 남기는 참고용
  // 태그. 상세픽(p)처럼 어떤 집계·판정에도 안 쓰인다(2026-09-12 추가, 사용자 지정).
  const [oddsPick, setOddsPick] = useState(row.MY_ODDS_PICK || '')
  // memoPre = 경기 전에 적는 메모, memo = 결과가 나온 뒤 적는 회고 메모 — 시점이
  // 다른 별개의 글이라 따로 관리한다(결과반성 칸 앞/뒤에 하나씩 둔다).
  const [memoPre, setMemoPre] = useState(row.MEMO_PRE || '')
  const [savedMemoPre, setSavedMemoPre] = useState(row.MEMO_PRE || '')
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

  function handleReasonTagChange(e) {
    const next = e.target.value
    setReasonTag(next)
    onSavePick({ reasonTag: next || null })
  }

  function handleOddsPickChange(e) {
    const next = e.target.value
    setOddsPick(next)
    onSavePick({ oddsPick: next || null })
  }

  function saveMemoPreIfChanged() {
    if (memoPre === savedMemoPre) return
    setSavedMemoPre(memoPre)
    onSavePick({ memoPre: memoPre || null })
  }

  function saveMemoIfChanged() {
    if (memo === savedMemo) return
    setSavedMemo(memo)
    onSavePick({ memo: memo || null })
  }

  return (
    <div className="mypick-bar">
      <label className="mypick-bar-field">
        <select value={pick} onChange={handlePickChange}>
          <option value="">내픽</option>
          {PICK_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field">
        <select value={p} onChange={handlePChange}>
          <option value="">상세픽</option>
          {P_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field">
        <select value={hit} onChange={handleHitChange}>
          <option value="">의견</option>
          {HIT_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field">
        <select value={oddsPick} onChange={handleOddsPickChange}>
          <option value="">배당픽</option>
          {PICK_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field mypick-bar-memo" title="경기가 열리기 전에 적어 두는 메모">
        <input
          type="text"
          value={memoPre}
          placeholder="경기 전 생각을 입력해주세요"
          onChange={(e) => setMemoPre(e.target.value)}
          onBlur={saveMemoPreIfChanged}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
      <label className="mypick-bar-field" title="이 픽을 왜 이렇게 봤는지 — 결과반성용, 판정에는 안 쓰인다">
        <select value={reasonTag} onChange={handleReasonTagChange}>
          <option value="">결과반성</option>
          {REASON_TAG_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mypick-bar-field mypick-bar-memo" title="결과가 나온 뒤 적는 회고 메모">
        <input
          type="text"
          value={memo}
          placeholder="결과 이후 생각을 입력해주세요"
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

// 승/무/패 칸 색 — 상대전적(HeadToHeadResult.jsx)의 col-w/col-d/col-l과 같은 축
// (승=파랑/무=회색/패=빨강)을 이 표에도 그대로 맞춘다. '합'은 그 결과들의 합계일
// 뿐이라 색을 넣지 않는다.
const SEASON_COL_CLASS = { 승: 'col-w', 무: 'col-d', 패: 'col-l', 합: '' }

// 시즌전적처럼 '홈/원정 × 승/무/패/합' 숫자가 나열식 문장으로 나오면 자릿수가
// 안 맞아 읽기 힘들다 — 표로 그려서 라벨(홈/원정) 폭을 맞추고 숫자 칸에 구분선을 준다.
// 승/무/패 칸 값은 "5(2)" 꼴 — 5는 그 팀이 이번 시즌 홈+원정 합쳐 거둔 횟수, (2)는 그중
// 오늘과 같은 장소(이 줄이 홈이면 홈경기, 원정이면 원정경기)에서 나온 횟수(pick_ai.py
// _season_row 참고). '합' 칸만 괄호 뜻이 다르다 — "2(4)"는 2경기를 치렀고 그 경기들의
// 승점 합이 4점(장소 구분 없음)이라는 뜻. 자세한 정의는 SeasonRecordLegend 팝업으로.
function SeasonRowsTable({ rows }) {
  return (
    <table className="detail-table pick-season-table">
      <thead>
        <tr>
          <th className="row-label" />
          <th className="col-w">승</th>
          <th className="col-d">무</th>
          <th className="col-l">패</th>
          <th>합</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.side}>
            {/* 줄 이름 옆 괄호 = 기대점수(전체 기준 / 오늘 장소 기준).
                이 경기에서 몇 골 넣을 것 같은가 — api/pick_ai.py _expected_goals.
                칸을 따로 두지 않고 라벨에 붙인다(사용자 지정). */}
            <td
              className="row-label"
              title="괄호는 기대점수 — 공격력 × 수비력으로 낸 기대 득점(전체 기준 / 오늘 장소 기준)"
            >
              {/* 줄 이름은 '홈'/'원' 한 글자로 — 두 줄의 라벨 길이가 같아야
                  괄호 안 기대점수가 세로로 맞는다(사용자 지정). */}
              {r.side}
              {r.xg && (r.xg[0] !== null && r.xg[0] !== undefined) && (
                <span className="pick-season-xg">
                  {/* 앞쪽(전체 기준)을 밝게·굵게 — 실측에서 판정에 쓸 값은 이쪽이다
                      (장소 기준은 표본이 절반이라 오히려 신호가 약했다). */}
                  (<b className="pick-season-xg-main">{r.xg[0].toFixed(2)}</b>/
                  {r.xg[1] !== null && r.xg[1] !== undefined ? r.xg[1].toFixed(2) : '-'})
                </span>
              )}
            </td>
            {['승', '무', '패', '합'].map((k) => {
              const pair = r.counts ? r.counts[k] : null
              return (
                <td key={k} className={SEASON_COL_CLASS[k]}>
                  {pair ? (
                    <>
                      {pair[0]}
                      <span className="pick-season-venue">({pair[1]})</span>
                    </>
                  ) : '-'}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── 기대점수 차이 × 배당대 격자 실측 (2026-09-07, 6대리그 29,938경기) ──
// 시즌전적 정의 팝업이 그대로 그린다. 뱃지 규칙(XG_RULES)과 같은 측정에서 나온 값이라,
// 실측을 다시 하면 둘을 같이 고쳐야 한다. 핸승 비율 + (그 배당대 평균 대비 %p), ★는 z≥2.
// [배당대, 그 배당대 평균, 차이~0.3, 0.3~0.8, 0.8~1.4, 1.4~2.2, 2.2+]
const XG_GRID_HIT = [
  ['초강정배 ~1.35', '55.98%', '', '54.84%', '52.15%', '51.83% −4.5★', '61.22% +9.1★'],
  ['강정배 1.35~1.60', '39.46%', '35.27% −4.5', '37.45%', '38.73%', '40.78%', '44.34% +5.3★'],
  ['중정배 1.60~1.90', '30.71%', '29.38%', '29.12%', '31.01%', '35.14% +5.1★', '34.19%'],
  ['약정배 1.90~2.30', '23.05%', '23.28%', '22.18%', '25.31% +2.7★', '21.21%', ''],
  ['접전 2.30+', '17.31%', '17.70%', '16.56%', '16.19%', '', ''],
]
// 같은 배당대인데 기대점수가 갈리면 결과가 얼마나 달라지는지 — 위 격자의 요약.
// [경우, 경기수, 핸승, 핸무, 무, 역, 정무, 플핸무]
const XG_CONFLICT = [
  ['강정배 배당(<1.6) + 기대점수 대등(<0.8)', '1,241', '39.24%', '26.03%', '19.90%', '14.83%', '85.17%', '60.76%'],
  ['강정배 배당(<1.6) + 기대점수 압도(2.2+)', '1,997', '57.64%', '22.33%', '13.32%', '6.71%', '93.29%', '42.36%'],
  ['접전 배당(2.3+) + 기대점수 압도(1.4+)', '125', '17.60%', '24.80%', '26.40%', '31.20%', '68.80%', '82.40%'],
  ['접전 배당(2.3+) + 기대점수 대등(<0.8)', '5,779', '17.39%', '21.42%', '30.23%', '30.96%', '69.04%', '82.61%'],
]

// 시즌전적 정의 팝업 — 다른 참고표(DirectionScopeLegend 등)와 같은 help-legend 꼴.
// 2026-09-06 개편: '오늘과 같은 정배/역배 구도' 필터를 없애고, 스코어만 보는 단순
// 승/무/패(+합계)로 바꿨다 — 예전 버전(핸디캡 결과를 정배/역배 조건으로 거르던 것)이
// '홈'/'원정' 줄 이름과 실제로 세는 범위가 어긋나 보여 헷갈린다는 지적이 있었다.
// api/pick_ai.py _season_record의 실제 동작을 그대로 옮겨 적었다.
function SeasonRecordLegend({ onClose }) {
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
        <h2 className="modal-title">📋 시즌전적 — 정확히 무엇을 세는 표인가</h2>

        <p className="help-legend-title">
          ① 배당·핸디캡은 안 봅니다 — 스코어만 보고 가르는 &apos;승/무/패&apos;입니다
        </p>
        <p className="help-legend-note">
          핸승·핸무 같은 핸디캡 결과가 아니라, 그 경기 스코어(HS·AS)만 비교해서 이겼는지·
          비겼는지·졌는지를 봅니다. &apos;합&apos;은 그 줄에 잡힌 경기 수(승+무+패)이고, 괄호
          안에는 그 경기들의 <b>승점</b>(승 3점 · 무 1점 · 패 0점, 축구 표준 방식)을 적습니다.
          지금 이 경기 <b>바로 직전까지의 경기 정보만 포함합니다</b> — 이 경기 자신과 이후에
          벌어진 경기 결과는 섞지 않습니다.
        </p>

        <p className="help-legend-title">
          ② &apos;홈&apos;·&apos;원정&apos; 줄은 오늘 경기의 홈팀/원정팀을 가리킬 뿐,
          과거 경기를 홈경기로 거르지 않습니다
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>표의 줄</th><th>누구</th><th>실제로 모으는 과거 경기</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><b>홈</b></td><td>오늘 경기의 홈팀</td>
              <td>그 팀이 이번 시즌 뛴 <b>홈+원정 경기 전부</b></td>
            </tr>
            <tr>
              <td><b>원정</b></td><td>오늘 경기의 원정팀</td>
              <td>그 팀이 이번 시즌 뛴 <b>홈+원정 경기 전부</b></td>
            </tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          &apos;홈&apos; 줄이라고 그 팀이 <b>홈에서 뛴 경기만</b> 모으는 게 아닙니다 — 원정 경기까지
          전부 봅니다. 표의 &apos;홈&apos;·&apos;원정&apos;은 오늘 이 경기에서 누가 홈이고 누가 원정인지
          가리키는 이름표일 뿐, 과거 경기의 장소와는 무관합니다.
        </p>

        <p className="help-legend-title">③ 칸에 적힌 &quot;5(2)&quot;는 무슨 뜻인가</p>
        <p className="help-legend-note">
          <b>5</b> = 그 팀이 이번 시즌 홈+원정 합쳐서 그 결과(승/무/패)를 거둔 총 횟수.{' '}
          <b>(2)</b> = 그 5번 중 <b>오늘과 같은 장소</b>에서 나온 횟수 — &apos;홈&apos; 줄이면 그
          팀이 홈경기에서 거둔 것만, &apos;원정&apos; 줄이면 원정경기에서 거둔 것만 다시 셉니다.
          예 — 오늘 뉴캐슬(홈)의 승 칸이 <b>5(2)</b>라면: 뉴캐슬은 이번 시즌 홈+원정 합쳐 5승을
          했고, 그중 2승이 홈경기에서 나온 승리라는 뜻입니다.
        </p>
        <p className="help-legend-note">
          &apos;합&apos; 칸만 괄호의 뜻이 다릅니다 — 괄호 안이 &apos;같은 장소 횟수&apos;가 아니라{' '}
          <b>승점</b>(승3·무1·패0, 장소 구분 없이 이번 시즌 전체)입니다. 예를 들어 &apos;합&apos;
          칸이 <b>2(4)</b>라면: 이번 시즌 홈+원정 합쳐 2경기를 치렀고, 그 2경기에서 딴 승점이
          4점(1승1무)이라는 뜻입니다.
        </p>

        <p className="help-legend-title">④ 줄 이름 옆 괄호 — 기대점수</p>
        <p className="help-legend-note">
          <b>홈(1.40/1.52)</b>처럼 줄 이름에 붙는 괄호가 <b>기대점수</b>입니다 —
          &quot;이 경기에서 이 팀이 몇 골 넣을 것 같은가&quot;입니다. 축구 통계의
          기대골(xG)은 원래 슈팅 하나하나의 위치로 구하는데 우리 DB엔 슈팅 데이터가 없어서,
          역시 표준으로 쓰이는 <b>공격력 × 수비력</b> 방식(포아송)으로 냅니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead><tr><th></th><th>계산</th></tr></thead>
          <tbody>
            <tr><td>홈팀 공격력</td><td>홈팀 평균 득점 ÷ 리그 기준선</td></tr>
            <tr><td>원정팀 수비력</td><td>원정팀 평균 <b>실점</b> ÷ 리그 기준선 (수비가 나쁠수록 커짐)</td></tr>
            <tr><td><b>홈팀 기대점수</b></td><td><b>공격력 × 수비력 × 리그 평균 홈득점</b></td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          양 팀이 딱 평균이면 공격력·수비력이 둘 다 1.0이라 기대점수가 리그 평균 그대로
          나옵니다(EPL이면 홈 1.56 / 원정 1.24 — 실측 리그 평균과 일치). 괄호 규칙은
          승/무/패와 같습니다: <b>앞이 전체 기준</b>(홈·원정 안 가린 전 경기),
          <b> 뒤가 오늘 장소 기준</b>(홈팀은 홈경기만·원정팀은 원정경기만).
          <b> 판정에 쓰는 값은 앞쪽</b>입니다 — 장소 기준은 표본이 절반이라 실측에서
          신호가 더 약했습니다. 3경기 미만이면 계산하지 않고 &apos;-&apos;로 둡니다.
        </p>

        <p className="help-legend-title">
          ⑤ 기대점수 차이 — 어떤 배당대에서 무엇을 말해주나 (실측)
        </p>
        <p className="help-legend-note">
          <b>기대점수 차이 = 정배팀 기대점수 − 언더독팀 기대점수</b>(정배는 해외배당 FW·FL
          중 낮은 쪽). 이 값이 클수록 정배가 강하다는 뜻인데, <b>그건 배당이 이미 아는
          정보</b>라 그대로 쓰면 안 됩니다. 그래서 <b>배당대를 고정한 뒤</b> 기대점수 차이로
          갈라 재봤습니다(6대리그 29,938경기). 아래는 핸승 비율이고, 괄호는 그 배당대
          평균 대비 차이입니다(★는 z≥2 — 우연으로 보기 어렵다는 뜻).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>배당대(해외 정배배당)</th><th>평균</th>
              <th>차이 ~0.3</th><th>0.3~0.8</th><th>0.8~1.4</th><th>1.4~2.2</th><th>2.2+</th></tr>
          </thead>
          <tbody>
            {XG_GRID_HIT.map(([band, avg, ...cells]) => (
              <tr key={band}>
                <td>{band}</td><td>{avg}</td>
                {cells.map((c, i) => (
                  <td key={i} className={c && c.endsWith('★') ? 'help-legend-warn' : undefined}>
                    {c || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>정배가 셀 때만 작동합니다.</b> 초강정배 배당(~1.35)에서는 기대점수 차이에 따라
          핸승이 <b>51.83% ↔ 61.22%</b>로 10%p 가까이 갈립니다. 반대로 <b>접전 배당(2.30 이상)에서는
          어느 조합도 유의하지 않습니다</b> — 그래서 경기지표 뱃지도 접전 경기에는 안 뜹니다.
        </p>
        <p className="help-legend-note">
          같은 &apos;강정배 배당&apos;이라도 기대점수가 갈리면 결과가 완전히 달라집니다:
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>경우</th><th>경기수</th><th>핸승</th><th>핸무</th><th>무</th><th>역</th>
              <th>정무</th><th>플핸무</th></tr>
          </thead>
          <tbody>
            {XG_CONFLICT.map(([lab, n, ...v]) => (
              <tr key={lab}>
                <td>{lab}</td><td>{n}</td>
                {v.map((x, i) => <td key={i}>{i >= 4 ? <b>{x}</b> : x}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-title">
          ⑥ 경기지표에 뱃지가 뜨는 6가지 조합
        </p>
        <p className="help-legend-note">
          위 격자에서 <b>z≥2로 살아남은 칸만</b> 뱃지로 만들었습니다. 지금 보는 경기가 아래
          조합 중 하나에 들어가면 경기지표 줄에 뜨고, 마우스를 올리면 그 칸의 실측값이
          그대로 나옵니다. <b>접전 배당(2.30 이상)은 어느 조합도 유의하지 않아 뱃지가
          아예 없습니다.</b>
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>해외 정배배당</th><th>기대점수 차이</th><th>뱃지</th><th>실측</th></tr>
          </thead>
          <tbody>
            {XG_RULES.map(([o1, o2, m1, m2, label, tone, note]) => (
              <tr key={`${o1}-${m1}`}>
                <td>{o1 === 0 ? `~${o2.toFixed(2)}` : `${o1.toFixed(2)}~${o2.toFixed(2)}`}</td>
                <td>{m2 >= 99 ? `${m1} 이상` : `${m1}~${m2}`}</td>
                <td>
                  <span
                    className="match-chip match-chip-tone"
                    style={{
                      background: `var(--chip-${tone}-bg)`,
                      color: `var(--chip-${tone}-fg)`,
                    }}
                  >
                    <strong>{label}</strong>
                  </span>
                </td>
                {/* 툴팁에 쓰는 문구에서 앞부분(조건 설명)을 빼고 실측 수치만 보여준다 */}
                <td>{note.split('— ')[1] || note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          색은 방향을 뜻합니다 — <b>파랑</b>은 정배 쪽(핸승·정무)이 유리해진다는 뜻,
          <b> 빨강</b>은 배당이 강정배로 매겨졌는데 기대점수는 그만큼이 아니라서
          <b> 플핸무·역</b> 쪽이 살아난다는 뜻입니다.
        </p>

        <p className="help-legend-title">⑦ 확률 계산에는 반영되지 않습니다</p>
        <p className="help-legend-note">
          참고용 표입니다 — &apos;종합픽&apos; 확률 계산에는 넣지 않고 화면에만 보여줍니다.
          시즌 초반엔 표본이 금방 말라(경기 수 자체가 적어) 믿고 보기 어렵습니다.
        </p>
      </div>
    </div>
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
// ── 방향성 검토표 (2026-09-05) ───────────────────────────────────────────
// 승+패·승+무+패 **두 줄만**으로 리그/통합 × 국/해 × 초기/배변 8칸을 만든다.
// 지금 화면이 쓰는 방향성 4칸(analysisPair — 정배 방향에 따라 고른 7줄 가중평균)과
// 재료가 다르다. 어느 쪽이 나은지 눈으로 대조하는 표라, 판정에는 아무 영향도
// 주지 않는다(읽기만 한다).
//
// 2026-09-05 배당차 표를 걷어내고 그 자리(가운데 칸)를 물려받았다. 배당차를 뺀 근거:
//   배당대(정배배당)를 0.1 단위로만 맞춰도 배당차의 예측력은 +0.01%p(z=0.01)로
//   사라진다 — 같은 조건에서 확률 지표는 +2.31%p(z=2.00)로 살아남는다. 즉 배당차는
//   정배배당을 다시 적은 값이었다(해)지 플핸무%와 r=-0.959). 확률 지표를 이미 본
//   뒤에 배당차가 더 주는 정보는 -0.98%p(z=-0.53)로 0이다.
//
// 실측 근거(6대리그 35,977경기, 2026-09-05):
//   통합 해초(TF-WL) 단독 80.53% > 지금 9줄 해초 78.83% (z=6.89, 6/6 리그)
//   리그 지표는 표본이 안 모인다 — 국내는 표본 4건 이하가 81~94%,
//   해외도 표본 15건 넘는 경기가 절반뿐. 표본이 얇으면 '정'·'플' 단독이
//   남발되고(4건 이하에서 51.7%) 적중률이 66.9%로 떨어진다.
// SCOPE_CODES·scopeCell도 utils/verdictCalc.js에서 가져온다(파일 맨 위 import).

// 표본이 얼마나 되면 믿을 만한가 — 실측 적중률 곡선 그대로.
// 15건+ 79~81% / 5~14건 71~76% / 1~4건 61~67%
const SCOPE_TONES = [[15, 'ok', '믿을 만'], [5, 'mid', '참고만'], [1, 'thin', '못 믿음']]

// 방향성 이름 → 정배 쪽(j) / 플핸 쪽(p). 표본이 넉넉한 칸에만 이 색을 입힌다.
const SCOPE_SIDE = { 정무: 'j', 정역: 'j', 정: 'j', 플핸무: 'p', 플핸승: 'p', 플: 'p' }

// ── 방향성 색 기준 참고표 (표 이름 칸을 누르면 뜬다) ──
// 화면에서 표본 숫자를 뺀 대신 색 하나가 두 가지를 말하므로, 그 규칙을 어딘가에는
// 적어 둬야 한다. 확률 칸 색상 참고표(LeagueTable의 RiskLegendModal)와 같은 꼴.
//
// 아래 숫자는 전부 실측이다(6대리그 35,977경기, 2026-09-05).
const TONE_RULE = [
  ['15건 이상', '색칠 (초록/파랑)', '믿을 만하다', 'ok'],
  ['5 ~ 14건', '색 없음 (기본색)', '참고만 한다', 'mid'],
  ['1 ~ 4건', '흐린 회색', '못 믿는다', 'thin'],
  ['0건', '—', '표본이 없다', 'none'],
]
// 표본이 얇을수록 '덜 맞는' 게 아니라 '무리한 답(3개 중 2개를 빼라는 정·플 단독)'이
// 남발된다 — 15건은 그게 잦아드는 자리다.
const TONE_WHY = [
  ['1 ~ 4건', '60~67%', '51.7%'],
  ['5 ~ 14건', '71~76%', '33.3%'],
  ['15 ~ 39건', '76~80%', '9.6%'],
  ['40건 이상', '79~82%', '~1%'],
]
// 칸마다 색이 붙는 빈도가 크게 다르다 — 리)국이 늘 비어 보이는 게 고장이 아니라는 설명.
const TONE_FREQ = [
  ['리)국', '3.5%', '1.6%', '2건'],
  ['리)해', '62.4%', '51.9%', '21건'],
  ['통)국', '47.9%', '42.6%', '14건'],
  ['통)해', '90.9%', '89.4%', '112건'],
]
// 네 칸이 각각 어디서 표본을 세는지 — SCOPE_CODES와 짝이 맞아야 한다.
const SCOPE_WHAT = [
  ['리)국', '이 리그 안에서만', '국내배당', 'K-WL · K-WDL'],
  ['리)해', '이 리그 안에서만', '해외배당', 'F-WL · F-WDL'],
  ['통)국', '6대리그 전체', '국내배당', 'TK-WL · TK-WDL'],
  ['통)해', '6대리그 전체', '해외배당', 'TF-WL · TF-WDL'],
]
// ── 8칸이 얼마나 같은 곳을 보느냐에 따른 당첨률 (2026-09-05 실측) ──
// 6대리그 19,795경기 = 8칸이 전부 이름을 낸 경기(전체의 60.8%. 리)국이 표본 부족으로
// 비는 일이 많아 나머지는 8칸을 다 못 채운다).
// 만장일치는 그 외보다 +3.74%p이고 6대리그 전부 같은 방향으로 재현됐다(+2.11~+5.25%p).
const AGREE_RATE = [
  ['8/8 (만장일치)', '3,054', '15.4%', '82.58%'],
  ['7/8', '4,055', '20.5%', '80.32%'],
  ['6/8', '5,075', '25.6%', '78.68%'],
  ['5/8', '4,921', '24.9%', '78.40%'],
  ['4/8 (반반)', '2,690', '13.6%', '77.70%'],
]
// 같은 만장일치여도 이름에 따라 10%p 넘게 갈린다 — 값어치는 '정무'에 몰려 있다.
//
// ⚠ 정정(2026-09-05 재측정) — 한때 "만장일치+정무는 판정보다 +2.99%p(z=4.76)"라고
//   적었는데 틀렸다. 그때는 두 값을 서로 다른 표본에서 따로 재서 붙여 비교했다.
//   같은 경기 위에서 짝비교하면 +0.28%p(z=0.43)에 그치고, 걸리는 경기의 83%는 판정도
//   이미 정무를 고르고 있어 결론이 안 바뀐다. 전체 시스템에 규칙으로 넣으면
//   79.859% → 79.872%(+0.014%p, 바뀌는 경기 0.29%)로 사실상 0이다.
//   그래서 이 표는 픽을 바꾸는 근거가 아니라 '읽을거리'로만 둔다.
//   쓸 만한 건 신뢰도 쪽뿐이다 — 판정 등급을 고정해도 만장일치는 +1.78%p(z=2.74, 6/6).
const UNANIM_NAME = [
  ['정무', 'j', '1,054', '88.14%'],
  ['정역', 'j', '123', '82.11%'],
  ['플핸무', 'p', '1,165', '80.34%'],
  ['플핸승', 'p', '712', '78.09%'],
]

function DirectionScopeLegend({ onClose }) {
  // ⚠ 상세보기 팝업도 ESC를 듣고 있다(document, 버블 단계). 여기서 캡처 단계로 먼저
  //   받아 전파를 끊지 않으면 ESC 한 번에 상세보기까지 같이 닫힌다.
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
        <h2 className="modal-title">🎨 방향성 — 무엇으로 만들고, 색은 무슨 뜻인가</h2>

        <p className="help-legend-title">
          이 표가 쓰는 재료 — <b>승+패</b> · <b>승+무+패</b> 두 줄만, 칸마다 세는 범위가 다릅니다
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>칸</th><th>어디서 세나</th><th>어느 배당</th><th>지표 코드</th></tr>
          </thead>
          <tbody>
            {SCOPE_WHAT.map(([k, where, mkt, code]) => (
              <tr key={k}>
                <td><b>{k}</b></td><td>{where}</td><td>{mkt}</td>
                <td className="help-legend-code">{code}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-title">8칸이 같은 방향을 보는 개수별 당첨률</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>같은 방향</th><th>경기 수</th><th>비율</th><th>당첨률</th></tr>
          </thead>
          <tbody>
            {AGREE_RATE.map(([k, n, pct, rate]) => (
              <tr key={k}>
                <td><b>{k}</b></td><td>{n}</td><td>{pct}</td><td><b>{rate}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">8칸 만장일치일 때, 그 이름별 당첨률</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>이름</th><th>경기 수</th><th>당첨률</th></tr>
          </thead>
          <tbody>
            {UNANIM_NAME.map(([name, side, n, rate]) => (
              <tr key={name}>
                <td><b className={`dscope-side-${side}-ink`}>{name}</b></td>
                <td>{n}</td><td><b>{rate}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">① 색이 붙느냐 — 과거 표본이 15건을 넘는가</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>과거 표본</th><th>화면</th><th>뜻</th></tr>
          </thead>
          <tbody>
            {TONE_RULE.map(([n, view, mean, cls]) => (
              <tr key={n}>
                <td>{n}</td>
                <td className={`dscope-${cls}`}>
                  {cls === 'ok'
                    ? (
                      <>
                        <b className="dscope-side-p-ink">플핸무</b>
                        {' / '}
                        <b className="dscope-side-j-ink">정무</b>
                      </>
                    )
                    : <b>{view}</b>}
                </td>
                <td>{mean}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">② 무슨 색이냐 — 그 이름이 어느 편인가</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>색</th><th>방향성 이름</th><th>무슨 주장인가</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><b className="dscope-side-p-ink">초록</b></td>
              <td><b className="dscope-side-p-ink">플핸무</b></td>
              <td><b>핸승은 안 나온다</b> (적중 무·역 / 보험 핸무)</td>
            </tr>
            <tr>
              <td><b className="dscope-side-j-ink">파랑</b></td>
              <td><b className="dscope-side-j-ink">정무</b></td>
              <td><b>역은 안 나온다</b> (적중 핸승·핸무 / 보험 무)</td>
            </tr>
          </tbody>
        </table>

        <p className="help-legend-title">왜 하필 15건인가 — 표본별 실측</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>과거 표본</th><th>적중률</th><th>&apos;정&apos;·&apos;플&apos; 단독이 나오는 비율</th></tr>
          </thead>
          <tbody>
            {TONE_WHY.map(([n, rate, solo]) => (
              <tr key={n}><td>{n}</td><td>{rate}</td><td>{solo}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          표본이 얇으면 <b>덜 맞는 게 아니라 무리한 답이 나옵니다</b> — 3개 중 2개를
          빼라는 &apos;정&apos;·&apos;플&apos; 단독이 1~4건에서는 절반이 넘습니다. 15건이 그게 잦아드는 자리입니다.
        </p>

        <p className="help-legend-title">칸마다 색이 붙는 빈도가 다릅니다</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>칸</th><th>초기에 색 붙음</th><th>배변에 색 붙음</th><th>표본 중앙값</th></tr>
          </thead>
          <tbody>
            {TONE_FREQ.map(([k, a, b, med]) => (
              <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td><td>{med}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>리)국이 거의 항상 무색인 건 고장이 아닙니다.</b> 국내배당은 같은 조합이
          반복되지 않아 표본이 안 쌓입니다(표본 중앙값 2건). 반대로 통)해는 열에 아홉이 색입니다.
        </p>
      </div>
    </div>
  )
}

function DirectionScopeTable({ row }) {
  const [showLegend, setShowLegend] = useState(false)
  const cell = (sc, mkt, final, edge) => {
    const rawScope = scopeCell(row, SCOPE_CODES[sc][mkt], final)
    // 배변 줄인데 이 칸이 나오는 시장(국내 승무패 또는 해외 승무패)이 초기→배변
    // 사이에 실제로 안 움직였으면, scopeCell 내부적으로는 초기 표본을 그대로 쓴 값이
    // 나오더라도(marketMoved 폴백) 화면에는 '움직인 배변'인 것처럼 보여주지 않는다
    // (2026-09-12, 본머스 vs 브렌트포드 사용자 제보 — OddsTable·SampleTable과 같은 원칙).
    const moved = !final || marketSetMoved(row, DIRECTION_SCOPE_MARKET[sc][mkt])
    const { name, total } = moved ? rawScope : { name: null, total: 0 }
    const [, tone, toneLabel] = SCOPE_TONES.find(([cut]) => total >= cut) || [0, 'none', '표본 없음']
    // 표본 수는 화면에서 빼고(2026-09-05) 색 하나로 두 가지를 말한다 —
    // 색이 붙어 있으면 '표본이 넉넉하다(15건+)', 색 종류가 방향(플핸/정배)이다.
    // 그래서 색이 없는 칸은 그 자체로 "믿고 쓰긴 이르다"는 뜻이 된다.
    const side = tone === 'ok' ? SCOPE_SIDE[name] : null
    return (
      <td
        className={`dscope-${tone}${side ? ` dscope-side-${side}` : ''}${edge ? ' dscope-edge' : ''}`}
        title={`${sc} · ${mkt === '국' ? '국내' : '해외'}배당 · ${final ? '배변' : '초기'}\n`
          + `승+패(${SCOPE_CODES[sc][mkt][0]})와 승+무+패(${SCOPE_CODES[sc][mkt][1]}) 두 줄만 가중평균.\n`
          + (moved
            ? `과거 표본 ${total.toLocaleString()}건 — ${toneLabel}`
              + `${side ? ' (그래서 색을 넣었습니다)' : ' (표본이 얇아 색을 넣지 않았습니다)'}.\n`
            : '이 시장(국내/해외 승무패)이 초기와 배변 사이에 안 움직였습니다.\n')
          + '※ 검토용 표입니다. 판정에는 쓰이지 않습니다.'}
      >
        {name ? <b className="sys-name">{name}</b> : <span className="dir-none">—</span>}
      </td>
    )
  }
  // 표 이름은 왼쪽 위 칸에 넣는다 — 옆의 '시스템 판정' 표와 같은 꼴(2026-09-05,
  // 배당차 표를 걷어내고 그 자리를 물려받으면서 맞췄다). 리그/통합 묶음 제목을 따로
  // 두지 않고 칸 이름에 '리)'·'통)'을 붙여 한 줄로 접었다.
  const table = (
    <table className="detail-table sys-table dscope-table">
      <thead>
        <tr>
          <th className="row-label">
            {/* 색 기준을 어딘가에는 적어 둬야 해서 이름 칸 자체를 버튼으로 쓴다 —
                표가 좁아 물음표 아이콘 하나 더 넣을 자리가 없다. */}
            <button
              type="button"
              className="help-btn"
              onClick={() => setShowLegend(true)}
              title="색 기준 보기 — 색이 붙는 조건(표본 15건+)과 초록/파랑의 뜻"
            >
              방향성 <span className="help-mark">?</span>
            </button>
          </th>
          <th>리)국</th>
          <th className="dscope-edge">리)해</th>
          <th>통)국</th>
          <th>통)해</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="row-label">초기</td>
          {cell('리그', '국', false)}{cell('리그', '해', false, true)}
          {cell('통합', '국', false)}{cell('통합', '해', false)}
        </tr>
        <tr>
          <td className="row-label">배변</td>
          {cell('리그', '국', true)}{cell('리그', '해', true, true)}
          {cell('통합', '국', true)}{cell('통합', '해', true)}
        </tr>
      </tbody>
    </table>
  )
  return (
    <>
      {table}
      {showLegend && <DirectionScopeLegend onClose={() => setShowLegend(false)} />}
    </>
  )
}

// ── 배당(판정 자매표, 2026-09-06) ────────────────────────────────────────
// 판정이 쓰는 7줄 중 방향성(DirectionScopeTable)이 이미 쓰는 승+패·승+무+패
// (K-WL/K-WDL/F-WL/F-WDL) 4줄을 빼면 남는 나머지 3줄을 같은 꼴(리)국·리)해·
// 통)국·통)해 × 초기·배변)로 보여준다. 판정 자체(최종 픽·별점)는 그대로 두고,
// 이 표는 그 재료 중 방향성에 없는 몫만 따로 뜯어보는 참고표다(판정에는 안 쓴다).
//
//   리)국 = 국)승 또는 국)패(정배 방향대로 하나) + 국)플핸(K-PL, 항상)
//   리)해 = 해)승 또는 해)패(정배 방향대로 하나)만
//   통)국 = 국통)승 또는 국통)패 + 국통)플핸(TK-PL)
//   통)해 = 해통)승 또는 해통)패만
//
// ⚠ 2026-09-06 '승=홈팀·패=원정팀'을 재료에서 뺐다(실측 근거는 verdictCalc.js의
//   oddsScopeCodes 주석). 그래서 리)국·통)국은 '승·패 + 플핸', 리)해·통)해는
//   '승·패'만으로 모양이 같아졌다 — 리그 안에서만 세느냐 6대리그를 합쳐 세느냐의
//   차이만 남는다. 통)국의 플핸은 2026-09-06에 28번 지표(TK-PL)로 새로 만들어
//   6대리그 과거 19,393경기를 백필했다(K-PL과 계산식이 같고 표본 풀만 통합).
//
// oddsScopeCodes 함수 자체는 utils/verdictCalc.js로 옮겼다(파일 맨 위 import) —
// 리그표 '판정' 칸의 픽 계산도 같은 4칸 재료를 써야 해서다.

// ── 배당 표 참고표 (2026-09-06 실측, 6대리그 35,985경기) ──
// 방향성 참고표(DirectionScopeLegend)와 같은 구성 — 재료 → 4칸 일치도별 당첨률 →
// 만장일치 이름별 당첨률 → 색 기준(15건) → 왜 15건인가 → 칸별 색 빈도.
const ODDS_WHAT = [
  ['리)국', '이 리그 안에서만', '국내배당', '국)승 또는 패 + 국)플핸'],
  ['리)해', '이 리그 안에서만', '해외배당', '해)승 또는 패만'],
  ['통)국', '6대리그 전체', '국내배당', '국통)승 또는 패 + 국통)플핸'],
  ['통)해', '6대리그 전체', '해외배당', '해통)승 또는 패만'],
]
// 아래 네 표는 2026-09-06 다시 잰 값이다 — 재료에서 홈/원정 줄을 빼고, 이름 규칙을
// '핸승 vs 역'으로 바꾼 뒤 기준이 달라졌기 때문(verdictCalc.js pickName 주석).
// 4칸(리국·리해·통국·통해, 초기 기준)이 같은 편(정/플)을 보는 개수별 당첨률.
const ODDS_AGREE_RATE = [
  ['4/4 (만장일치)', '21,836', '67.3%', '84.68%'],
  ['3/4', '6,563', '20.2%', '79.75%'],
  ['2/4 (반반)', '3,331', '10.3%', '76.76%'],
]
// 만장일치일 때 이름별 당첨률 — 정무가 더 높다(방향성 때와 같은 패턴).
// 이름 규칙을 바꾼 뒤로 이 표에는 정무·플핸무 둘만 나온다.
const ODDS_UNANIM_NAME = [
  ['정무', 'j', '13,617', '86.60%'],
  ['플핸무', 'p', '8,219', '81.51%'],
]
// 표본별 당첨률 — 15건을 넘으면 82%대로 안정되는 건 방향성과 같다.
const ODDS_TONE_WHY = [
  ['1 ~ 4건', '1,102', '79.67%'],
  ['5 ~ 14건', '9,798', '80.16%'],
  ['15 ~ 39건', '47,814', '81.70%'],
  ['40건 이상', '214,661', '82.41%'],
]
// 칸마다 색 붙는 빈도 — 방향성의 리)국(3.5%)과 달리 여기 리)국도 89%가 색이다.
// 승 하나만 맞아도 과거 경기가 잡혀서 표본이 훨씬 잘 쌓인다(중앙값 31건).
const ODDS_TONE_FREQ = [
  ['리)국', '89.1%', '87.5%', '31건'],
  ['리)해', '96.6%', '95.1%', '82건'],
  ['통)국', '99.8%', '99.9%', '177건'],
  ['통)해', '99.8%', '99.7%', '494건'],
]

function OddsScopeLegend({ onClose }) {
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
        <h2 className="modal-title">💰 배당 — 무엇으로 만들고, 색은 무슨 뜻인가</h2>

        <p className="help-legend-title">
          이 표가 쓰는 재료 — 판정(7줄) 중 방향성이 이미 쓰는 승+패·승+무+패 4줄을
          빼면 남는 나머지, 칸마다 세는 범위가 다릅니다
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>칸</th><th>어디서 세나</th><th>어느 배당</th><th>쓰는 지표</th></tr>
          </thead>
          <tbody>
            {ODDS_WHAT.map(([k, where, mkt, code]) => (
              <tr key={k}>
                <td><b>{k}</b></td><td>{where}</td><td>{mkt}</td>
                <td className="help-legend-code">{code}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-title">4칸이 같은 방향을 보는 개수별 당첨률</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>같은 방향</th><th>경기 수</th><th>비율</th><th>당첨률</th></tr>
          </thead>
          <tbody>
            {ODDS_AGREE_RATE.map(([k, n, pct, rate]) => (
              <tr key={k}>
                <td><b>{k}</b></td><td>{n}</td><td>{pct}</td><td><b>{rate}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">4칸 만장일치일 때, 그 이름별 당첨률</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>이름</th><th>경기 수</th><th>당첨률</th></tr>
          </thead>
          <tbody>
            {ODDS_UNANIM_NAME.map(([name, side, n, rate]) => (
              <tr key={name}>
                <td><b className={`dscope-side-${side}-ink`}>{name}</b></td>
                <td>{n}</td><td><b>{rate}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">① 색이 붙느냐 — 과거 표본이 15건을 넘는가</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>과거 표본</th><th>화면</th><th>뜻</th></tr>
          </thead>
          <tbody>
            {TONE_RULE.map(([n, view, mean, cls]) => (
              <tr key={n}>
                <td>{n}</td>
                <td className={`dscope-${cls}`}>
                  {cls === 'ok'
                    ? (
                      <>
                        <b className="dscope-side-p-ink">플핸무</b>
                        {' / '}
                        <b className="dscope-side-j-ink">정무</b>
                      </>
                    )
                    : <b>{view}</b>}
                </td>
                <td>{mean}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">② 무슨 색이냐 — 그 이름이 어느 편인가</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>색</th><th>방향성 이름</th><th>무슨 주장인가</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><b className="dscope-side-p-ink">초록</b></td>
              <td><b className="dscope-side-p-ink">플핸무</b></td>
              <td><b>핸승은 안 나온다</b> (적중 무·역 / 보험 핸무)</td>
            </tr>
            <tr>
              <td><b className="dscope-side-j-ink">파랑</b></td>
              <td><b className="dscope-side-j-ink">정무</b></td>
              <td><b>역은 안 나온다</b> (적중 핸승·핸무 / 보험 무)</td>
            </tr>
          </tbody>
        </table>

        <p className="help-legend-title">왜 하필 15건인가 — 표본별 실측</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>과거 표본</th><th>칸 수</th><th>그 칸 이름의 당첨률</th></tr>
          </thead>
          <tbody>
            {ODDS_TONE_WHY.map(([n, cnt, rate]) => (
              <tr key={n}><td>{n}</td><td>{cnt}</td><td><b>{rate}</b></td></tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          표본이 늘수록 당첨률이 79.7% → 82.4%로 꾸준히 오릅니다. 15건 언저리에서
          81%대에 올라서고, 40건을 넘으면 82%대로 자리 잡습니다 — 그래서 15건을
          색을 넣는 경계로 씁니다.
        </p>

        <p className="help-legend-title">칸마다 색이 붙는 빈도가 다릅니다</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>칸</th><th>초기에 색 붙음</th><th>배변에 색 붙음</th><th>표본 중앙값</th></tr>
          </thead>
          <tbody>
            {ODDS_TONE_FREQ.map(([k, a, b, med]) => (
              <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td><td>{med}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          방향성의 리)국(3.5%)과 달리 여기 리)국은 89%가 색입니다 — 승 하나만
          맞아도 과거 경기가 잡히는 지표라 표본이 훨씬 잘 쌓이기 때문입니다.
        </p>
      </div>
    </div>
  )
}

// ⚠ 이 표만 name(표시용 이름)이 아니라 pick(픽용 이름)을 그린다 — 여기가 곧 판정의
// 재료라서, 표에 뜬 이름과 최종 픽이 다르면 사장님이 화면으로 검산을 못 한다.
// (2026-09-06: 픽 규칙을 '핸승 vs 역'으로 바꾸면서 표도 같이 맞췄다. 그래서 이 표에는
//  정무·플핸무 둘만 나온다. 네 이름을 다 보고 싶으면 옆의 '방향성' 표를 쓴다 —
//  그쪽은 신뢰도(별점)의 재료라 계산 방식이 다르고, 그래서 이름 규칙도 그대로 뒀다.)
function OddsScopeTable({ row }) {
  const [showLegend, setShowLegend] = useState(false)
  const codes = oddsScopeCodes(row)
  const cell = (key, final, edge) => {
    const list = codes[key]
    const rawScope = scopeCell(row, list, final)
    // 배변 줄인데 이 칸이 쓰는 시장(리)국·통)국은 국내 승무패+핸디, 리)해·통)해는
    // 해외 승무패)이 초기→배변 사이에 실제로 안 움직였으면 '-'로 비운다 — 안 움직인
    // 시장은 scopeCell 내부에서 초기 표본을 그대로 쓰고 있어(marketMoved 폴백),
    // 그 값을 배변인 것처럼 보여주면 안 된다(2026-09-12, 본머스 vs 브렌트포드 제보).
    const moved = !final || marketSetMoved(row, ODDS_SCOPE_MARKET[key])
    const { pick, total } = moved ? rawScope : { pick: null, total: 0 }
    const [, tone, toneLabel] = SCOPE_TONES.find(([cut]) => total >= cut) || [0, 'none', '표본 없음']
    const side = tone === 'ok' ? SCOPE_SIDE[pick] : null
    return (
      <td
        className={`dscope-${tone}${side ? ` dscope-side-${side}` : ''}${edge ? ' dscope-edge' : ''}`}
        title={`${key} · ${final ? '배변' : '초기'}\n`
          + `쓰는 지표: ${list.length ? list.join(' · ') : '(배당 없음)'}\n`
          + (moved
            ? `과거 표본 ${total.toLocaleString()}건 — ${toneLabel}`
              + `${side ? ' (그래서 색을 넣었습니다)' : ' (표본이 얇아 색을 넣지 않았습니다)'}.\n`
            : '이 시장이 초기와 배변 사이에 안 움직였습니다.\n')
          + '※ 핸승과 역 중 작은 쪽을 배제한 이름입니다(판정과 같은 기준).'}
      >
        {pick ? <b className="sys-name">{pick}</b> : <span className="dir-none">—</span>}
      </td>
    )
  }
  const table = (
    <table className="detail-table sys-table dscope-table">
      <thead>
        <tr>
          <th className="row-label">
            <button
              type="button"
              className="help-btn"
              onClick={() => setShowLegend(true)}
              title="색 기준 보기 — 색이 붙는 조건(표본 15건+)과 초록/파랑의 뜻"
            >
              배당 <span className="help-mark">?</span>
            </button>
          </th>
          <th>리)국</th>
          <th className="dscope-edge">리)해</th>
          <th>통)국</th>
          <th>통)해</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="row-label">초기</td>
          {cell('리국', false)}{cell('리해', false, true)}
          {cell('통국', false)}{cell('통해', false)}
        </tr>
        <tr>
          <td className="row-label">배변</td>
          {cell('리국', true)}{cell('리해', true, true)}
          {cell('통국', true)}{cell('통해', true)}
        </tr>
      </tbody>
    </table>
  )
  return (
    <>
      {table}
      {showLegend && <OddsScopeLegend onClose={() => setShowLegend(false)} />}
    </>
  )
}

// ── 시스템 판정(새) — 2026-09-06 ────────────────────────────────────────
// 지금 판정(9줄, 리그만, 해초 기준)은 배당 표 대표값(통합·해외) 하나보다도 못하다는
// 게 실측으로 나왔다(z=8.24, 6/6 리그) — 그래서 픽은 배당 표의
// 4칸(리)국·리)해·통)국·통)해)에서, 신뢰도는 방향성 8칸 일치도에서 따로 가져온다.
// (방향성+배당을 그냥 합쳐서 하나로 쓰면 오히려 손해라는 것도 실측으로 확인했다 —
// 방향성을 조금이라도 섞으면 배당 100%일 때보다 무조건 낮아진다. 2026-09-06 최초
// 설계 때 잰 수치라 그 뒤 픽 규칙이 두 번 더 바뀌면서 낡았다 — 정확한 숫자보다
// 결론이 중요해 여기서는 뺐다. 지금 배당 100% 성적은 ODDS_PHASE_WEIGHTED_GRADE의
// 전체 평균(NewSystemVerdictLegend 하단 '전체 평균 당첨률' 참고)을 본다.)
//
// CLAUDE.md 4-1(판정은 그 시점 배당 전부로 다시 만든다)에 맞춰 초기·배변을 완전히
// 따로 계산한다(시점을 섞지 않는다) — 섞은 버전과 비교해도 초기는 거의 같고
// (82.27% vs 82.29%) 배변은 시점을 분리하는 쪽이 약간 낮지만(81.55% vs 82.02%,
// −0.59%p, z=−2.99) 그래도 지금 판정보다는 확실히 낫다(+1.40%p, z=5.27, 6/6 리그).
//
// 픽: 그 시점의 배당 4칸([리국,리해,통국,통해]) 중 통)해를 기본으로, 나머지 3칸과
//   전부 다르면(고립) 리)해로 뒤집는다 — resolveSystemPick과 같은 모양, 재료만 교체.
// 신뢰도: 방향성 8칸(리그/통합 × 국/해 × 초기/배변, 시점을 안 가린다) 중 이 픽과
//   같은 편(정/플)인 비율 — 다만 칸마다 1표로 똑같이 세지 않고, 그 칸의 표본 수만큼
//   가중치를 준다(2026-09-06(2)). 표본 2건짜리 칸과 200건짜리 칸을 똑같이 취급하면
//   안 된다는 지적으로 다시 쟀더니, 가중을 주는 쪽이 신호도 더 세고 무엇보다
//   '8칸이 전부 채워져야만 신뢰도를 낸다'는 조건이 없어져 커버리지가 59.3~59.7%에서
//   99.9%로 뛰었다(6대리그 실측). 한 칸이 표본을 몰아서 혼자 결과를 좌우하지
//   못하게 칸당 표본은 상한을 둔다 — 상한값 자체도 5~100/상한없음을 스윕해서
//   골랐다(2026-09-06(3)): 상한 없음(점이연 상관 0.040~0.060)보다 상한을 두는 쪽이
//   대체로 낫고, 처음 썼던 15는 그중 최적이 아니었다 — 40 근방이 초기·배변 둘 다
//   최고점(0.047/0.064)이라 40으로 잡는다.
//
// resolveOddsPhasePick·oddsPhaseWeightedRatio·ODDS_PHASE_WEIGHTED_GRADE·phaseVerdict는
// utils/verdictCalc.js로 옮겼다(파일 맨 위 import) — 2026-09-07, 리그표에 '판정' 칸을
// 추가하면서 모달과 표가 같은 계산을 쓰게 만들었다.

// "방향성에 색이 없는데 별 3개"가 잘못이 아님을 보여주는 실측표 (2026-09-06,
// 6대리그 36,010경기 × 초기·배변). 사용자가 파더보른 vs 프라이부르 경기에서
// 물어본 것 — 색이 붙는 칸이 하나도 없는데 별 3개라 과대평가로 보였다.
// 재보니 반대였다: 방향성 표본이 얇을수록 오히려 잘 맞는다(드문 배당 = 한쪽이
// 압도적인 경기라 결과가 예측하기 쉽다).
const CONF_BY_COLOR = [
  ['0개 (전부 15건 미만)', '763 / 758', '84.14%', '86.54%'],
  ['3개', '6,696 / 6,679', '82.32%', '82.72%'],
  ['6개', '6,227 / 6,227', '81.66%', '82.11%'],
  ['8개 (전부 색)', '305 / 305', '77.70%', '80.33%'],
]
// ── 강추 4등급 실측 (2026-09-07, 6대리그 36,029경기 / 뼈대 7,344건) ──
// 계산은 utils/verdictCalc.js의 strongPickTier가 한다. 여기 표는 그 함수 주석에 적힌
// 실측값을 화면에 그대로 보여주는 것뿐이라, 실측을 다시 하면 양쪽을 같이 고쳐야 한다.
// [등급, 조건, 경기수, 뼈대 중, 전체 중, 적중, 당첨, 등급인가]
const STRONG_TIER_STATS = [
  ['강추 · 반전', '위 셋에 안 걸린 정역반전 경기', '264', '3.6%', '0.7%', '68.94%', '87.12%', true],
  ['초강추 · 통합', '국=해 + 국배 2.25↑ + 해배 2.5↑', '780', '10.6%', '2.2%', '63.72%', '85.77%', true],
  ['초강추 · 국≠해', '국내·해외 정배가 서로 다른 팀', '842', '11.5%', '2.3%', '66.51%', '85.39%', true],
  ['강추 · 해배', '국=해 + 해배 2.5↑만', '1,097', '14.9%', '3.0%', '65.91%', '84.96%', true],
  ['(등급 없음)', '위 어디에도 안 걸림', '4,361', '59.4%', '12.1%', '56.36%', '79.06%', false],
  ['4등급 합계', '', '2,983', '40.6%', '8.3%', '65.77%', '85.48%', true],
]
// 정역반전(favFlip) 실측 — 이미 등급이 붙은 칸에는 정보가 없고, 등급 없던 칸에서만 크게 듣는다.
// [칸, 반전 있음 n, 당첨, 반전 없음 n, 당첨, 차이, z]
// 반전 유형별(뼈대 7,344건 안에서) — 어느 시장이 뒤집혔나로 갈라 본 것.
// [유형, 경기수, 적중, 당첨, 표본이 작아 판단 보류인가]
const STRONG_FLIP_KIND = [
  ['해외만 반전', '1,218', '67.16%', '86.78%', false],
  ['국내만 반전', '52', '63.46%', '84.62%', true],
  ['국·해 둘 다 반전', '38', '60.53%', '81.58%', true],
]
const STRONG_FLIP_STATS = [
  ['초강추 · 통합', '270', '87.41%', '510', '84.90%', '+2.51%p', '0.95'],
  ['초강추 · 국≠해', '539', '85.16%', '303', '85.81%', '−0.65%p', '−0.26'],
  ['강추 · 해배', '235', '88.09%', '862', '84.11%', '+3.98%p', '1.51'],
  ['등급 없던 칸', '264', '87.12%', '4,361', '79.06%', '+8.06%p', '3.15'],
]
// 각 칸이 진짜 신호인지 — '강추가 안 뜨는 경기'(79.14%, n=4,022)를 기준선으로 검정.
// [케이스, 경기수, 당첨, 기준선 대비, z, 리그 재현성, 채택했나]
const STRONG_TIER_CHECK = [
  ['초강추 · 통합', '780', '85.77%', '+6.70%p', '4.32', '6/6', true],
  ['초강추 · 국≠해', '842', '85.39%', '+6.33%p', '4.21', '6/6', true],
  ['강추 · 해배', '1,097', '84.96%', '+5.89%p', '4.38', '6/6', true],
  ['강추 · 반전', '264', '87.12%', '+8.06%p', '3.15', '5/6', true],
  ['국배만(반전도 없음)', '486', '80.45%', '+1.56%p', '0.80', '4/6', false],
]
// 접전 기준을 초기가 아니라 '배변' 배당으로 정한 근거 — 경계를 넘나든 경기만 따로
// 재보니 배당이 움직인 방향 자체가 신호였다(모집단: 뼈대 + 국=해 6,502건).
// [배당 움직임, 국내 n, 국내 당첨, 해외 n, 해외 당첨, 강추 뜨나, 나쁜 칸인가]
const STRONG_ODDS_MOVE = [
  ['초기·배변 둘 다 접전', '1,201', '84.26%', '776', '85.57%', '뜸', false],
  ['배변에서 접전으로 들어옴', '182', '83.52%', '1,101', '85.10%', '뜸', false],
  ['배변에서 접전을 벗어남', '110', '76.36%', '666', '81.98%', '안 뜸', true],
  ['초기·배변 둘 다 아님', '4,278', '80.25%', '3,959', '79.11%', '안 뜸', false],
]
// 국내와 해외 컷이 다른 이유 — 커버리지(대상 비율)를 맞춰 세우면 해외가 항상 위다.
// [대상 비율, 국내컷, 국내 당첨, 해외컷, 해외 당첨]
const STRONG_CUT_BASIS = [
  ['10%', '2.33', '84.66%', '2.60', '86.14%'],
  ['15%', '2.30', '84.88%', '2.55', '85.96%'],
  ['20%', '2.27', '84.27%', '2.50', '85.30%'],
  ['30%', '2.21', '83.31%', '2.45', '84.66%'],
  ['40%', '2.17', '83.18%', '2.40', '83.85%'],
]
// 정배배당이 커질수록(접전에 가까울수록) 당첨률이 계단처럼 오른다 — 국내는 2.2 근처가 계단.
const STRONG_ODDS_BAND = [
  ['2.0 ~ 2.1', '2,611', '79.55%'],
  ['2.1 ~ 2.2', '2,523', '81.17%'],
  ['2.2 ~ 2.3', '2,385', '83.35%'],
  ['2.3 ~ 2.4', '1,559', '83.58%'],
  ['2.4 이상', '376', '86.97%'],
]

// 별 3개(가중 일치율 90% 이상) 안에서 총 표본량별 — 표본이 아주 많은 0.9%만
// 약속을 못 지킨다(-7%p). 전체 영향이 0.06%p라 아직 손대지 않았다.
const CONF_BY_DEN = [
  ['80 미만', '3.8%', '87.92%', '+2.17%p', false],
  ['80 ~ 159', '17.9%', '85.90%', '+0.15%p', false],
  ['160 ~ 239', '12.0%', '85.36%', '−0.39%p', false],
  ['240 이상', '0.9%', '78.64%', '−7.11%p', true],
]
// 표본이 0건이라 값 자체가 없는 칸은 계산에서 아예 뺀다(분모·분자 둘 다 안 들어감) —
// 8칸 중 몇 칸이 비어 있어도 나머지만으로 비율을 낸다. 그게 맞는지, 별 3개(가중
// 일치율 90% 이상) 안에서 '값이 있던 칸 수'별로 실제 당첨률을 갈라 봤다.
const CONF_BY_CELLS = [
  ['1~4칸', '1,861 / 1,810', '85.65%', '85.30%', '−0.10%p / −0.62%p'],
  ['5~6칸', '2,019 / 2,007', '85.83%', '86.10%', '+0.08%p / +0.18%p'],
  ['7~8칸 (거의 다 참)', '8,476 / 8,339', '85.75%', '86.02%', '±0.00%p / +0.10%p'],
]

function NewSystemVerdictLegend({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const bucketLabels = ['90% 이상', '80% 이상', '65% 이상', '40% 이상', '40% 미만']
  return (
    <div className="modal-backdrop help-legend-back" onClick={onClose}>
      <div className="modal-card help-legend-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">🏁 시스템 판정 — 무엇으로 정하고, 확률은 어떻게 되나</h2>

        <p className="help-legend-title">이 판정이 쓰는 재료 세 가지</p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>재료</th><th>어디에 쓰나</th><th>왜</th></tr></thead>
          <tbody>
            <tr>
              <td><b>배당</b>(4칸)</td><td>픽 자체(정무·플핸무 같은 이름)</td>
              <td>초기 4칸·배변 4칸을 그 시점 것만 따로 종합해 판단</td>
            </tr>
            <tr>
              <td><b>방향성</b>(8칸, 표본 가중)</td><td>신뢰도(별점) — 픽 이름에는 영향 없음</td>
              <td>픽에 섞으면 오히려 손해, 신뢰도로만·표본 가중해서 쓰면 이득</td>
            </tr>
            <tr>
              <td>전적(상대전적)</td><td>어디에도 안 씀 — 참고 배지만</td>
              <td>방향(정/플)별로 갈라 재도 값이 없음(z&lt;1.5) — 판단은 직접 하시라고 남겨둠</td>
            </tr>
          </tbody>
        </table>

        <p className="help-legend-title">픽 — 배당 표 4칸 중에서, 그 시점 것만 씁니다</p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>상황</th><th>픽으로 쓰는 칸</th><th>근거</th></tr></thead>
          <tbody>
            <tr>
              <td>보통</td><td><b>통)해</b>(통합·해외)</td>
              <td>배당 표 4칸 중 실측 당첨률이 가장 높은 칸</td>
            </tr>
            <tr>
              <td>나머지 <b>3칸이 전부</b> 반대편일 때</td><td><b>그 반대편으로 뒤집음</b></td>
              <td>뒤집을 이름은 리)해 → 통)국 → 리)국 순으로 찾음(해외·통합 우선)</td>
            </tr>
            <tr>
              <td>한 칸이라도 통)해 편일 때</td><td><b>통)해 그대로</b></td>
              <td>2칸만 반대일 때 뒤집으면 오히려 손해(초기 z=−3.70 · 배변 z=−3.46)</td>
            </tr>
          </tbody>
        </table>
        <p className="help-legend-title">
          픽 이름은 <b>핸승과 역만 비교</b>해서 정합니다 — 정무 아니면 플핸무
        </p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>비교</th><th>배제하는 것</th><th>픽</th></tr></thead>
          <tbody>
            <tr><td>핸승 &gt; 역</td><td>역</td><td><b>정무</b> (적중 핸승·핸무 / 보험 무)</td></tr>
            <tr><td>역 ≥ 핸승</td><td>핸승</td><td><b>플핸무</b> (적중 무·역 / 보험 핸무)</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>왜 네 칸을 다 보지 않는가</b> — 네 칸의 &apos;예측이 되는 정도&apos;가 전혀 다릅니다.
          통)해가 낸 예측%를 5구간으로 나눠 각 구간의 실제 발생률을 재면, 최고구간과
          최저구간의 격차가 <b>핸승 +33.9~35.6%p · 역 +21.3~24.8%p · 무 +10.6~13.1%p</b>인데{' '}
          <b>핸무만 +0.6~6.2%p</b>입니다. 핸무는 어떤 배당에서도 그냥 23~24%로 나오는,
          예측이 안 되는 값입니다.
        </p>
        <p className="help-legend-note">
          그런데 예전 방식(네 칸 중 가장 작은 하나 배제)은 그 핸무가 최소로 뽑히면 근거 없이
          <b> 플핸승</b>을 골랐고(전체의 12~14%), 그 구간 당첨률이 시점마다 75~79%로
          흔들렸습니다. 초기와 배변 판정이 서로 반대로 갈리던 것도 전부 이 구간에서 나왔습니다
          — 신호가 아니라 동전 던지기가 섞여 있던 겁니다(정무·플핸무를 고른 83% 구간은
          두 방식이 애초에 같은 답을 냅니다). 핸무·무를 배제 후보에서 빼면 그 구간이
          사라집니다: 최종 판정 <b>초기 82.80%→82.67%(z=−0.82, 우연 범위) ·
          배변 82.45%→83.24%(z=+5.19)</b>, 적중률은 배변이 60.45%→61.20%로 올랐습니다.
        </p>
        <p className="help-legend-note">
          <b>배당·방향성 표에는 네 이름이 그대로 나옵니다.</b> 그 표들은 &quot;칸마다 무엇이
          안 나올 것 같은가&quot;를 뜯어보는 검토용이라 정보를 줄이지 않았습니다 — 표의
          &apos;정&apos;·&apos;플&apos;은 한쪽 쌍이 80% 넘게 압도적이라는 표시입니다. 그래서
          표의 이름과 최종 픽이 다를 수 있습니다.
        </p>
        <p className="help-legend-note">
          <b>&apos;승=홈팀 · 패=원정팀&apos;은 재료에서 뺐습니다(2026-09-06).</b> 조건이 가장
          빡세 표본이 늘 제일 적은 줄인데(리)해 중앙값 6건 · 리)국 1건), 배열 맨 뒤라
          위치 가중치를 제일 크게 받아 비중이 과했습니다 — 리)해에서는 표본 6건짜리가
          평균 <b>40.5%</b>를 먹었고, 3경기 중 1경기(34.4%)는 표본이 제일 적은 줄이
          비중이 제일 큰 줄이었습니다. 그래서 몇 건짜리 표본의 0 하나가 이름을 뒤집는
          일이 있었습니다. 빼고 재보니 리)해 당첨률이 초기 80.18%→81.33%(z=5.87),
          배변 80.16%→81.84%(z=9.03)로 올랐고, 최종 판정도 배변 쪽이 나아졌습니다
          (초기는 −0.02%p로 그대로).
        </p>
        <p className="help-legend-note">
          초기·배변을 완전히 따로 계산합니다(그 시점 배당만 씁니다) — 시점을 섞은
          것과 대조해 보니 배변은 오히려 −0.59%p였습니다. 시점을 안 섞는 쪽이
          "그 시점에 등록된 배당 전부로 다시 만든다"는 원칙에도 맞습니다.
        </p>

        <p className="help-legend-title">신뢰도 — 방향성 8칸을 표본 크기로 가중한 일치 비율</p>
        <p className="help-legend-note">
          방향성(승+패·승+무+패)을 픽 자체에 섞으면 손해였지만(배당 100%가 최고),
          &apos;맞을지 아닐지&apos;를 가리는 신뢰도로만 쓰면 도움이 됩니다. 8칸을 그냥
          1표씩 똑같이 세지 않고, 그 칸의 표본 수만큼 가중치를 줍니다(표본 2건짜리와
          200건짜리를 같은 무게로 취급하지 않는다는 뜻) — 다만 한 칸이 표본을 몰아서
          혼자 결과를 좌우하지 못하게 칸당 표본은 상한을 둡니다. 이 상한값(40)도
          감으로 정하지 않고 5~100(및 상한 없음)까지 스윕해서 실제 예측력(점이연
          상관계수)이 가장 좋은 지점을 찾았습니다 — 상한 없음(0.040/0.060)보다는
          상한을 두는 쪽이 낫고, 처음 썼던 15(0.045/0.060)보다 40(0.047/0.064) 근방이
          더 좋았습니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead><tr><th></th><th>내용</th></tr></thead>
          <tbody>
            <tr>
              <td>계산식</td>
              <td>가중 일치 비율 = (같은 편 칸들의 표본수 합) ÷ (표본 있는 칸들의 표본수 합)
                — 칸당 표본은 40에서 자릅니다.</td>
            </tr>
            <tr>
              <td>예시</td>
              <td>리)국초기(정무·3건)·통)해배변(정무·8건)은 픽과 같은 편, 리)해초기(플핸무·
                90건→40으로 자름)만 다른 편이면 → (3+8) ÷ (3+8+40) = 11/51 ≈ <b>22%</b>.
                칸 개수만 세면 2/3(67%)이지만, 표본 큰 칸의 반대 의견 하나 때문에 22%까지
                떨어집니다 — 이게 표본 가중이 하는 일입니다.</td>
            </tr>
          </tbody>
        </table>
        <table className="detail-table help-legend-table">
          <thead><tr><th>가중 일치율</th><th>초기 판정 당첨률</th><th>배변 판정 당첨률</th></tr></thead>
          <tbody>
            {bucketLabels.map((lbl, i) => (
              <tr key={lbl}>
                <td><b>{lbl}</b></td>
                <td>{ODDS_PHASE_WEIGHTED_GRADE.초기[i].rate.toFixed(2)}% ({ODDS_PHASE_WEIGHTED_GRADE.초기[i].n.toLocaleString()})</td>
                <td>{ODDS_PHASE_WEIGHTED_GRADE.배변[i].rate.toFixed(2)}% ({ODDS_PHASE_WEIGHTED_GRADE.배변[i].n.toLocaleString()})</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          예전에는(칸마다 동일 취급 + 8칸이 전부 채워져야만) 이 신뢰도를 낼 수 있는
          경기가 59% 남짓이었습니다. 표본 가중으로 바꾸면서 몇 칸이 비어도 있는 칸만으로
          계산할 수 있게 되어, 적용 대상이 <b>99.9%</b>로 늘었습니다. 위 표에서도
          90% 이상 구간과 40% 미만 구간 사이에 5~7%p 차이가 뚜렷합니다.
        </p>

        <p className="help-legend-title">화면에 표시하는 당첨률 — 구간 × 픽 × 강추</p>
        <p className="help-legend-note">
          위 구간 평균은 정무와 플핸무를 섞은 값이라, 같은 구간이라도 픽에 따라 실제 당첨률이
          크게 다릅니다(85.92% 구간: 정무 89.00% · 플핸무 강추없음 78.88%). 그래서 판정 옆에 보여
          주는 %와 별은 구간을 픽(정무·플핸무)과 강추로 한 번 더 나눠 잰 값입니다(6대리그 실측,
          2026-09-10). 과거 시즌으로 만든 표를 이후 시즌에 대 보면 화면 %와 실제의 차이가
          2.10%p → 0.82%p로 줄었습니다. 강추 판정은 그대로 구간 평균 별(★3)을 기준으로 합니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>판정</th><th>구간 평균</th><th>픽</th><th>실측 당첨률(표본)</th></tr></thead>
          <tbody>
            {['배변', '초기'].flatMap((ph) => Object.entries(PHASE_CELL_RATE[ph])
              .sort((a, b) => b[1][0] - a[1][0])
              .map(([k, [rate, n]]) => {
                const [band, pick, strong] = k.split('|')
                return (
                  <tr key={`${ph}-${k}`}>
                    <td>{ph}</td>
                    <td>{band}%</td>
                    <td>{pick}{strong ? '·강추' : ''}</td>
                    <td><b>{rate.toFixed(2)}%</b> ({n.toLocaleString()})</td>
                  </tr>
                )
              }))}
          </tbody>
        </table>

        <p className="help-legend-title">별점 기준</p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>별</th><th>당첨률</th></tr></thead>
          <tbody>
            <tr><td><b>★★★</b></td><td>83% 이상</td></tr>
            <tr><td><b>★★</b></td><td>78% 이상</td></tr>
            <tr><td><b>★</b></td><td>78% 미만</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          방향성 8칸에 표본 있는 칸이 하나도 없으면(극히 드묾, 0.1%) 별점 없이 픽만
          보여줍니다 — 못 잰 조합에 실측값을 억지로 붙이지 않습니다.
        </p>

        <p className="help-legend-title">
          &quot;방향성에 색이 하나도 없는데 별 3개&quot; — 잘못된 게 아닙니다 ⚠
        </p>
        <p className="help-legend-note">
          <b>색과 별은 서로 다른 것을 잽니다.</b> 방향성 표의 색은 &quot;그 칸 이름을
          <b> 그대로 픽으로 쓰면</b> 얼마나 맞나&quot;(15건 미만이면 61~76%라 색을 뺍니다)이고,
          별점은 &quot;8칸이 <b>최종 픽과 같은 편인지</b>&quot;의 비율입니다. 색이 없다는 건
          &quot;그 칸 하나만 믿고 걸지 말라&quot;는 뜻이지 판정을 믿지 말라는 뜻이 아닙니다.
        </p>
        <p className="help-legend-note">
          실측하면 오히려 <b>표본이 얇은 경기가 더 잘 맞습니다.</b> 방향성 표본이 적다는 건
          그 배당 조합이 드물다는 뜻이고, 드문 배당은 대개 한쪽이 압도적인 경기라
          결과가 예측하기 쉽기 때문입니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>색이 붙은 칸 수</th><th>경기 수</th><th>초기 당첨률</th><th>배변 당첨률</th></tr>
          </thead>
          <tbody>
            {CONF_BY_COLOR.map(([c, n, a, b]) => (
              <tr key={c}>
                <td><b>{c}</b></td><td>{n}</td><td><b>{a}</b></td><td><b>{b}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          색이 하나도 없는 경기(전체의 2.1%)에서 별 3개가 나온 506건의 실제 당첨률은
          <b> 초기 86.61% · 배변 88.10%</b>로, 등급표가 약속한 85.7~85.9%보다 오히려
          높았습니다.
        </p>
        <p className="help-legend-note">
          <b>다만 반대쪽에는 실제로 부풀려지는 구간이 있습니다.</b> 별 3개 안에서 총
          표본량으로 갈라 보면 표본이 아주 많은 쪽이 약속을 못 지킵니다 — 전체의 0.9%뿐이라
          아직 손대지 않았습니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>총 표본량</th><th>전체 대비</th><th>실제 당첨률</th><th>약속 대비</th></tr>
          </thead>
          <tbody>
            {CONF_BY_DEN.map(([k, pct, rate, gap, warn]) => (
              <tr key={k}>
                <td>{k}</td><td>{pct}</td><td><b>{rate}</b></td>
                <td className={warn ? 'help-legend-warn' : undefined}><b>{gap}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="help-legend-title">
          표본이 0건이라 값 자체가 없는 칸은 계산에서 뺍니다 — 반영이 안 되는 게 맞습니다
        </p>
        <p className="help-legend-note">
          8칸 중 몇 칸이 비어 있으면(예: 파더보른 vs 프라이부르는 5칸만 값이 있었습니다)
          그 칸은 분모·분자 어디에도 안 들어가고, <b>남은 칸만으로</b> 비율을 냅니다. 칸이
          적을수록 우연히 100% 일치가 나오기는 쉽습니다 — 값 있는 칸이 2개면 별 3개가 될
          확률이 63~64%, 8개 다 있으면 31~32%로 딱 절반입니다. 그런데도 실제 당첨률은
          갈리지 않습니다:
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>값 있던 칸 수</th><th>경기 수</th><th>초기 당첨률</th><th>배변 당첨률</th>
              <th>약속 대비</th></tr>
          </thead>
          <tbody>
            {CONF_BY_CELLS.map(([k, n, a, b, gap]) => (
              <tr key={k}>
                <td>{k}</td><td>{n}</td><td><b>{a}</b></td><td><b>{b}</b></td><td>{gap}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          칸이 2~4개뿐이어도(전체의 5%) 오차가 −0.1~−0.62%p로 8칸 다 있을 때(±0.00~+0.10%p)와
          거의 같습니다. 칸이 적으면 별 3개가 되기 쉬운 것과, 그 배당 조합 자체가 드물어서
          결과가 예측하기 쉬운 것이 서로 상쇄되기 때문입니다 — &apos;색이 붙은 칸 수&apos; 표와
          같은 이유입니다.
        </p>

        <p className="help-legend-title">전체 평균 당첨률</p>
        <table className="detail-table help-legend-table">
          <thead><tr><th></th><th>당첨률</th></tr></thead>
          <tbody>
            <tr><td><b>초기 판정</b></td><td><b>82.67%</b></td></tr>
            <tr><td><b>배변 판정</b></td><td><b>83.24%</b></td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          위 신뢰도 표(일치도별 당첨률)를 전부 합쳐 평균 낸 값입니다.
        </p>

        <p className="help-legend-title">
          ⭐ 초강추 · 강추 — 판정 중에서도 특히 좋은 경기를 골라내는 표시
        </p>
        <p className="help-legend-note">
          위 판정이 나온 경기 전부가 같은 값을 갖는 건 아닙니다. 그중에서도 실측 당첨률이
          확실히 높은 네 갈래를 따로 표시합니다. <b>네 갈래 모두 뼈대는 같습니다 —
          배변 판정이 &apos;플핸무&apos;이고 별이 3개일 것</b>(6대리그 36,029경기 중
          7,344건 · 당첨 81.67%). 거기에 <b>배당이 어떤 모양이냐</b>로 등급이 갈립니다.
        </p>
        <p className="help-legend-note">
          <b>&apos;접전&apos;이란</b> 정배배당(승·패 중 낮은 쪽)이 커서 시장이 두 팀을
          비슷하게 본다는 뜻입니다. 기준은 <b>국내 {CLOSE_ODDS_CUT_K} 이상 · 해외{' '}
          {CLOSE_ODDS_CUT_F} 이상</b>이고, 둘 다 <b>배변(최신) 배당</b>으로 봅니다.
          <b> 국≠해</b>는 국내배당이 보는 정배와 해외배당이 보는 정배가 서로 다른 팀인
          경기입니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>등급</th><th>조건</th><th>경기수</th><th>뼈대 중</th><th>전체 중</th>
              <th>적중</th><th>당첨</th></tr>
          </thead>
          <tbody>
            {STRONG_TIER_STATS.map(([tier, cond, n, inBase, inAll, hit, win, on]) => (
              <tr key={tier}>
                <td>{on ? <b>{tier}</b> : tier}</td><td>{cond}</td><td>{n}</td>
                <td>{inBase}</td><td>{inAll}</td><td>{hit}</td>
                <td>{on ? <b>{win}</b> : win}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>당첨</b>은 플핸무(핸무+무+역) — &quot;핸승만 안 나오면 되는&quot; 확률이고,
          <b> 적중</b>은 무·역만 나오는 확률입니다. <b>뼈대 중</b>은 위 7,344건 대비,
          <b> 전체 중</b>은 36,029경기 대비 비율입니다. 등급이 붙는 넷을 합치면
          <b> 2,983건(뼈대의 40.6% · 전체의 8.3%)</b>이고 당첨률은 <b>85.48%</b>입니다 —
          전체 평균 69.80%보다 15%p 이상 높습니다.
        </p>

        <p className="help-legend-title">
          &apos;정역반전&apos; — 초기와 배변에서 정배가 서로 바뀐 경기
        </p>
        <p className="help-legend-note">
          배당이 좁아지기만 한 것과는 다른 사건입니다. <b>초기엔 A팀이 정배였는데 배변에서
          B팀이 정배가 된 것</b>, 즉 시장의 견해가 반대편으로 넘어간 경기입니다. 전체의
          6.2%로 흔하진 않지만 꾸준히 나옵니다 — 6대리그 28,638건 기준 <b>반전이 있으면
          당첨률 86.36%(반전 없음 68.66%, z=15.76, 리그 6/6)</b>이고, 배당 구간을 고정해도
          살아남습니다(배변 해외 정배배당 2.0~2.5 구간에서 85.70% vs 78.99%, z=4.42).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>칸</th><th>반전 있음</th><th>당첨</th><th>반전 없음</th><th>당첨</th>
              <th>차이</th><th>z</th></tr>
          </thead>
          <tbody>
            {STRONG_FLIP_STATS.map(([cell, an, aw, bn, bw, gap, z]) => (
              <tr key={cell}>
                <td>{cell}</td><td>{an}</td><td><b>{aw}</b></td><td>{bn}</td><td>{bw}</td>
                <td>{gap}</td><td><b>{z}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>이미 등급이 붙은 칸에는 정보가 거의 없고(z 전부 1.5 미만), 등급이 없던 칸에서만
          크게 듣습니다</b>(+8.06%p, z=3.15). 서로 겹치지 않는 정보라 등급을 하나 더 뒀습니다
          — 그래서 <b>강추·반전</b>은 다른 셋에 안 걸린 경기에만 붙습니다.
        </p>
        <p className="help-legend-note">
          어느 시장이 뒤집혔는지로 갈라 보면 이렇습니다(뼈대 7,344건 안에서).
        </p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>유형</th><th>경기수</th><th>적중</th><th>당첨</th></tr></thead>
          <tbody>
            {STRONG_FLIP_KIND.map(([kind, n, hit, win, thin]) => (
              <tr key={kind}>
                <td>{thin ? kind : <b>{kind}</b>}</td>
                <td className={thin ? 'help-legend-warn' : undefined}>{n}</td>
                <td>{hit}</td><td>{thin ? win : <b>{win}</b>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>반전은 대부분 해외에서 일어납니다</b>(1,218건 = 96%). 국내가 섞인 두 유형은
          52건·38건뿐이라 아직 판단을 보류합니다 — 국내배당이 뒤집히는 것 자체가 드문
          사건이라 시즌이 더 쌓여야 합니다. 지금 등급(강추·반전)은 세 유형을 구분하지 않고
          똑같이 붙입니다.
        </p>
        <p className="help-legend-note">
          ⚠ <b>국내배당이 뒤집힌 경기는 베팅 방식이 바뀝니다.</b> &apos;정&apos;과
          &apos;역&apos;이 가리키는 팀이 서로 자리를 바꾸기 때문에, 프로토(국내 시장)에서
          같은 팀에 거는 행위가 플핸이 아니라 <b>정무</b>가 됩니다. 해외만 뒤집힌 경우는
          실제로 거는 시장이 아니라 플핸 그대로 가면 됩니다. 경기지표 줄의 뱃지가
          <b> 국) · 해) · 국·해)</b>로 어느 쪽이 뒤집혔는지 알려주고, 국내가 포함되면
          노란색으로 표시합니다.
        </p>

        <p className="help-legend-title">
          &apos;국배만 접전&apos;은 일부러 뺐습니다 — 검증을 통과하지 못했습니다 ⚠
        </p>
        <p className="help-legend-note">
          강추가 안 뜨는 경기(당첨 79.14%, n=4,022)를 기준선으로 놓고 각 칸을 검정했습니다.
          <b> z값은 &quot;우연일 가능성&quot;을 재는 숫자로 2를 넘어야 우연으로 보기
          어렵다</b>는 뜻이고, 리그 재현성은 6개 리그 중 몇 곳에서 같은 방향이 나왔는지입니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>케이스</th><th>경기수</th><th>당첨</th><th>기준선 대비</th><th>z</th>
              <th>리그</th><th>채택</th></tr>
          </thead>
          <tbody>
            {STRONG_TIER_CHECK.map(([tier, n, win, gap, z, lg, on]) => (
              <tr key={tier}>
                <td>{on ? <b>{tier}</b> : tier}</td><td>{n}</td><td><b>{win}</b></td>
                <td>{gap}</td>
                <td className={on ? undefined : 'help-legend-warn'}><b>{z}</b></td>
                <td className={on ? undefined : 'help-legend-warn'}>{lg}</td>
                <td>{on ? '○' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          국내배당만 접전인 경기는 뼈대 평균(81.67%)보다 <b>+0.42%p</b>뿐이고 z=1.67,
          리그 4/6(라리가 −0.6p · 세리에 −1.7p)입니다. 등급으로 넣으면 전체 당첨률이
          85.31% → 84.74%로 <b>내려갑니다.</b> 국내배당 단독으로는 접전을 제대로
          잡아내지 못합니다.
        </p>

        <p className="help-legend-title">
          국내 {CLOSE_ODDS_CUT_K} · 해외 {CLOSE_ODDS_CUT_F} — 컷이 다른 이유
        </p>
        <p className="help-legend-note">
          해외는 마진이 낮아 같은 경기라도 배당값이 큽니다. 그래서 같은 숫자로 비교하면
          안 되고, <b>대상 비율(커버리지)을 맞춰서</b> 세워야 합니다. 그렇게 재면
          <b> 해외가 모든 구간에서 1~1.5%p 높습니다</b> — 이 앱에 이미 확립된
          &quot;국배·해배가 갈리면 해배를 따른다(+1.8%p)&quot;와 같은 방향입니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>대상 비율</th><th>국내 컷</th><th>국내 당첨</th>
              <th>해외 컷</th><th>해외 당첨</th></tr>
          </thead>
          <tbody>
            {STRONG_CUT_BASIS.map(([cov, kc, kw, fc, fw]) => (
              <tr key={cov}>
                <td><b>{cov}</b></td><td>{kc}</td><td>{kw}</td>
                <td>{fc}</td><td><b>{fw}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          국내 기준으로도 정배배당이 커질수록 당첨률이 계단처럼 오릅니다 —
          {STRONG_ODDS_BAND.map(([band, , win], i) => (
            <span key={band}>{i > 0 ? ' / ' : ' '}{band} <b>{win}</b></span>
          ))}
          . 2.2 근처가 계단이라 {CLOSE_ODDS_CUT_K}로 잡았습니다(2.2·2.25·2.3은
          통계적으로 구분되지 않아 경기 수를 가장 많이 남기는 지점을 골랐습니다).
        </p>

        <p className="help-legend-title">
          접전은 <b>배변(최신) 배당</b>으로 봅니다 — 배당이 움직인 방향 자체가 신호입니다
        </p>
        <p className="help-legend-note">
          초기 배당으로 보느냐 배변 배당으로 보느냐에 따라 판정이 갈리는 경기가 있습니다.
          그 경기들만 따로 재봤더니 방향이 뚜렷했습니다(모집단: 뼈대 중 국=해 6,502건).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>배당 움직임</th><th>국내 경기수</th><th>국내 당첨</th>
              <th>해외 경기수</th><th>해외 당첨</th><th>강추</th></tr>
          </thead>
          <tbody>
            {STRONG_ODDS_MOVE.map(([move, kn, kw, fn, fw, shown, bad]) => (
              <tr key={move}>
                <td>{move}</td><td>{kn}</td>
                <td className={bad ? 'help-legend-warn' : undefined}><b>{kw}</b></td>
                <td>{fn}</td>
                <td className={bad ? 'help-legend-warn' : undefined}><b>{fw}</b></td>
                <td>{shown}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-legend-note">
          핵심은 셋째 줄입니다 — <b>접전이었다가 배변에서 빠져나간 경기의 당첨률이
          국내 76.36% · 해외 81.98%</b>로, 애초에 접전이 아니었던 경기(80.25% · 79.11%)와
          비슷하거나 오히려 낮습니다(국내는 둘 다 통과한 84.26% 대비 z=−2.14). 반대로
          배변에서 접전으로 들어온 경기는 83.52% · 85.10%로 올라옵니다. 그래서 초기가
          아니라 <b>배변 배당을 기준</b>으로 삼습니다. 배변 배당이 아직 없는 경기는 초기
          배당으로 대신 봅니다.
        </p>

        <p className="help-legend-title">화면에서 어떻게 보이나</p>
        <table className="detail-table help-legend-table">
          <thead><tr><th>어디</th><th>표시</th></tr></thead>
          <tbody>
            <tr>
              <td>이 줄(시스템 판정)</td>
              <td>배변 판정 옆에 <b>초강추·통합</b> / <b>초강추·국≠해</b> /{' '}
                <b>강추·해배</b> / <b>강추·반전</b> 보라색 배지 — 넷 다 같은 색이고
                글자로만 구분합니다</td>
            </tr>
            <tr>
              <td>리그표 &apos;판정&apos; 칸</td>
              <td>배변 줄에 <b>이중 밑줄</b> — 네 등급 모두 똑같이 그어집니다</td>
            </tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          초기 판정에는 붙지 않습니다 — 네 등급 모두 배변 판정을 기준으로 잰 값이라서입니다.
          국≠해면 다른 조건과 무관하게 <b>초강추·국≠해</b>가 먼저이고,
          <b>강추·반전</b>은 앞의 셋에 안 걸렸을 때만 붙습니다.
        </p>
      </div>
    </div>
  )
}

function NewSystemVerdict({ row, init, fin }) {
  const [showLegend, setShowLegend] = useState(false)
  // 확률 지표(DirectionPart)와 같은 규칙 — 픽 이름을 조각으로 쪼개서, 실제 결과를
  // '덮는' 조각 하나만 노란 글씨(.dir-name-hit)로 켠다. 정무 → [정, 무]로 쪼개지고
  // 실제 결과가 핸승·핸무면 '정'만, 무면 '무'만 켜진다(DIR_PARTS 주석 참고) — 배경을
  // 칠하는 게 아니라 글자색만 바꾸고, 픽 전체가 아니라 그 한 글자만 바뀐다.
  const rtText = rtLabel(row.RT)
  const actual = ['핸승', '핸무', '무', '역'].includes(rtText) ? rtText : null

  // 초강추(국≠해)·강추(접전) — 배변 판정에만 붙는다(strongPickTier 주석 참고).
  // init(초기)에는 안 켠다. 배지 색(보라)은 두 단계가 똑같다(사용자 지정).
  const strong = strongPickTier(row, fin)

  const part = (v, isStrong) => {
    if (!v.pick) {
      return (
        <span className="newv-part">
          <span className="newv-label">{v.label}</span>
          <span className="dir-none">—</span>
        </span>
      )
    }
    return (
      <span
        className="newv-part"
        title={`${v.label} 판정: ${v.pick}`
          + `${v.flipped ? ' (통)해가 나머지 3칸과 전부 반대라 그쪽으로 뒤집음)' : ''}\n`
          + (v.ratio !== null
            ? `방향성 8칸 표본 가중 일치율 ${Math.round(v.ratio * 100)}%(이 구간 평균 ${v.bandRate.toFixed(2)}%)`
              + ` — 그중 ${v.pick}${v.strong ? '·강추' : ''} 경기만 보면 과거 ${v.n?.toLocaleString()}경기 중 ${v.rate.toFixed(2)}%.`
            : '방향성 8칸에 표본 있는 칸이 하나도 없어 신뢰도를 못 매겼습니다.')}
      >
        <span className="newv-label">{v.label}</span>
        {/* 색은 sys-pick-j/p(빨강/파랑, 옛 판정 축)이 아니라 방향성·배당 표와 같은
            dscope-side-*-ink(초록/파랑)를 쓴다 — 이 줄이 그 두 표와 한 묶음이라서다. */}
        <b className={`sys-pick dscope-side-${DIR_SIDE[v.pick] === '정' ? 'j' : 'p'}-ink`}>
          {(DIR_PARTS[v.pick] || [[v.pick, []]]).map(([piece, covers]) => (
            <span key={piece} className={actual && covers.includes(actual) ? 'dir-name-hit' : undefined}>
              {piece}
            </span>
          ))}
        </b>
        {v.stars !== null && (
          <>
            <span className="sys-stars">{'★'.repeat(v.stars)}{'☆'.repeat(3 - v.stars)}</span>
            <span className="sys-rate">{v.rate.toFixed(2)}%</span>
            {isStrong && (
              <span className="newv-strong" title={STRONG_TIER_TITLE[isStrong]}>
                {isStrong}
              </span>
            )}
          </>
        )}
      </span>
    )
  }

  if (!init.pick && !fin.pick) return null
  return (
    <div className="pick-band-newverdict">
      <button
        type="button"
        className="help-btn"
        onClick={() => setShowLegend(true)}
        title="시스템 판정(새) 기준 보기 — 픽은 배당, 신뢰도는 방향성에서 옵니다"
      >
        시스템 판정 <span className="help-mark">?</span>
      </button>
      {part(init, false)}
      <span className="newv-arrow">→</span>
      {part(fin, strong)}
      {fin.verdict && (
        <span
          className="match-chip match-chip-tone sys-verdict"
          style={{
            background: `var(--chip-${VERDICT_TONE[fin.verdict]}-bg)`,
            color: `var(--chip-${VERDICT_TONE[fin.verdict]}-fg)`,
            fontWeight: 700,
          }}
        >
          {fin.verdict}
        </span>
      )}
      {showLegend && <NewSystemVerdictLegend onClose={() => setShowLegend(false)} />}
    </div>
  )
}

function PickBand({ row, scope, h2hVerdict: verdict, h2hLoading, sameOdds, xg }) {
  // '경기지표'의 무·전적 뱃지와 '시스템 판정' 줄 모두 같은 pick을 봐야 앞뒤가
  // 맞는다 — 여기서 새 판정(배당표 4칸 기반, phaseVerdict)을 한 번만 계산해
  // 내려준다. 옛 판정(9줄, resolveSystemPick)은 2026-09-06에 화면에서 걷어내며
  // 같이 걷어냈다. 배지는 배변 판정을 우선하고, 배변이 아직 없으면 초기 판정을 쓴다.
  const init = phaseVerdict(row, false, '초기')
  const fin = phaseVerdict(row, true, '배변')
  const pick = fin.pick ?? init.pick

  return (
    <section className="pick-band">
      <div className="pick-band-risk">
        <div className="pick-band-risk-cols">
          <div className="pick-band-risk-col">
            <h3 className="pick-band-risk-col-title">배당</h3>
            <OddsTable row={row} />
          </div>
          <div className="pick-band-risk-col">
            <h3 className="pick-band-risk-col-title">
              확률 지표
              <DirectionSummary row={row} scope={scope} />
            </h3>
            <RiskCard row={row} />
            {/* 경기지표·방향성·시스템 판정은 왼쪽('배당') 칸과는 무관하게
                이 칸(확률 지표) 표 바로 밑에만 붙인다 — 왼쪽 칸 아래로는 안 내려간다.
                예전엔 이 셋을 세로로 쌓아서 줄이 길었는데, 이 칸 폭 안에서 가로
                3단(뱃지·표·표)으로 접어 줄 수를 줄인다. */}
            <div className="pick-band-bottom-cols">
              <div className="pick-band-match">
                <h3>경기지표</h3>
                <MatchIndicators
                  row={row}
                  h2hVerdict={verdict}
                  h2hLoading={h2hLoading}
                  pick={pick}
                  sameOdds={sameOdds}
                  xg={xg}
                />
              </div>
              {/* 방향성·배당 두 표를 한 덩어리로 묶고, 그 아래에 구분선 + 시스템
                  판정(새) 줄을 붙인다(2026-09-06, 사용자가 고른 '안 2') — 경기지표
                  칸까지는 안 내려가고 이 두 표의 폭만큼만 걸친다. */}
              <div className="pick-band-dscope-sys-wrap">
                <div className="pick-band-dscope-sys-row">
                  <div className="pick-band-dscope">
                    <DirectionScopeTable row={row} />
                  </div>
                  <div className="pick-band-sys">
                    {/* 2026-09-06 — 여기 있던 '판정' 표(국배/해배 이름 2칸)를 '배당' 표로
                        바꿨다. 판정이 쓰는 7줄 중 방향성이 이미 보여주는 승+패·승+무+패를
                        뺀 나머지를 방향성과 같은 꼴로 본다. 예전 결과 판정 줄(9줄, 리그만
                        계산)은 구분선 아래 '시스템 판정' 줄로 완전히 교체하고 지웠다
                        (실측: 82.46% vs 79.79%, NewSystemVerdictLegend 참고). */}
                    <OddsScopeTable row={row} />
                  </div>
                </div>
                <NewSystemVerdict row={row} init={init} fin={fin} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function MatchDetailModal({ code, row, scope, sameOdds, onClose, onSavePick }) {
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const rt = rtLabel(row.RT)
  const hasScore = row.HS !== null && row.HS !== undefined && row.AS !== null && row.AS !== undefined
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
  // 지표별 표본은 기본이 '접힘' — 판단에 쓰는 7줄만 보여주고, 펼치면 전체 지표가 나온다.
  const [sampleExpanded, setSampleExpanded] = useState(false)
  const [showSeasonLegend, setShowSeasonLegend] = useState(false)
  const [pickData, setPickData] = useState(null)
  const [pickError, setPickError] = useState('')
  // 종합분석 카드를 화면에서 뺀 뒤로 이 응답에서 실제로 쓰는 건 이 둘과 streaks뿐이다.
  const seasonSig = findSignal(pickData, 'season')
  // 기대점수(전체 기준) — 시즌전적 표가 쓰는 값 그대로를 경기지표 뱃지(xgChips)에도 넘긴다.
  // rows[0]=홈 · rows[1]=원정, xg[0]=전체 기준 · xg[1]=오늘 장소 기준(뱃지는 [0]만 쓴다).
  const seasonXg = seasonSig && seasonSig.rows
    ? { home: seasonSig.rows[0]?.xg?.[0], away: seasonSig.rows[1]?.xg?.[0] }
    : null
  const h2hSig = findSignal(pickData, 'h2h')
  // 경기지표의 '전적' 뱃지(홈우세/홈만우세/전적보합/원정만우세/원정우세).
  // 상대전적 카드가 쓰는 것과 같은 h2h를 그대로 재사용한다 — API를 더 부르지 않는다.
  const h2hMark = pickData && pickData.h2h
    ? h2hVerdict(pickData.h2h.wdl_summary, pickData.h2h.wdl_summary_home)
    : null

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
  // 상대전적 목록 필터 — 켜면 지금 보는 경기의 홈팀(ht)이 실제로 홈이었던
  // 맞대결만 남긴다. 위 요약표의 '홈기준' 줄과 같은 기준(homePoints의 referenceTeam=home).
  const [h2hHomeOnly, setH2hHomeOnly] = useState(false)
  // 상대전적을 최근 N시즌만 보기 (0 = 전체). 고르면 아래 경기 목록뿐 아니라
  // 위 요약표(전체기준/홈기준)까지 그 기간만으로 다시 집계된다.
  const [h2hYears, setH2hYears] = useState(0)
  // 정/역 좁혀 보기 — 그 경기의 HT(그 경기 자체의 홈팀)가 정배였는지 역배였는지로
  // 거른다. 둘 다 켜면 정+역(동배만 빠짐), 둘 다 끄면 필터 없음. 켜면 기간처럼
  // 위 요약표까지 그 조건만으로 다시 집계된다.
  const [h2hFavJ, setH2hFavJ] = useState(false)
  const [h2hFavY, setH2hFavY] = useState(false)

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
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header-actions">
          <button
            className="detail-download-btn"
            onClick={handleDownload}
            disabled={downloading}
            title="지금 화면 그대로 엑셀로 받기"
          >
            {downloading ? '다운로드 중...' : '⬇ 엑셀 다운로드'}
          </button>
          <button className="modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {downloadError && <p className="detail-download-error">{downloadError}</p>}

        {/* 2026-09-12: 날짜/별표/팀/결과 배지를 한 줄로 합쳤다(예전엔 제목줄+메타줄 2줄).
            결과가 있는 경기는 팀 사이 'vs' 대신 스코어를 넣고 이긴 쪽만 빨강(winner-score,
            앱 전체 관례 — .detail-title-teams .winner-score 참고). 예정 경기는 지금처럼 'vs',
            결과 배지 자리는 '예정 경기' 글자 대신 똥배면 그 순번(DdongBadge)만 보여준다. */}
        <h2 className="modal-title detail-modal-title detail-title-line">
          <span className="detail-title-date">
            {row.S} · {row.R}
            {row.DT ? ` · ${formatDt(row.DT)}` : ''}
            {formatTime(row.TM) ? ` ${formatTime(row.TM)}` : ''}
          </span>
          <StarButton
            level={starLevel(row.IMPORTANT)}
            onClick={() => onSavePick({ important: nextStarLevel(starLevel(row.IMPORTANT)) })}
          />
          <span className="detail-title-teams">
            {ht}
            {rankSuffix(row.HP)}
            {titleRoleSuffix(true)}
            <TeamBetRecord name={ht} />
            {hasScore ? (
              <span className="detail-title-score">
                {' '}
                <b className={scoreClass(row.HS, row.AS, 'home')}>{Math.trunc(row.HS)}</b>
                {' : '}
                <b className={scoreClass(row.HS, row.AS, 'away')}>{Math.trunc(row.AS)}</b>
                {' '}
              </span>
            ) : (
              ' vs '
            )}
            {at}
            {rankSuffix(row.AP)}
            {titleRoleSuffix(false)}
            <TeamBetRecord name={at} />
          </span>
          <span className="detail-title-badges">
            {rt ? <RtBadge label={rt} /> : <DdongBadge row={row} />}
            {!row.MY_BET && <PickVerdictBadge row={row} />}
            <DdongsaBadge row={row} />
            <MyBetBadge row={row} />
            {row.MY_BET && <PickVerdictBadge row={row} />}
          </span>
        </h2>
        <MyPickBar row={row} onSavePick={onSavePick} />

        <PickBand
          row={row}
          scope={scope}
          sameOdds={sameOdds}
          h2hVerdict={h2hMark}
          h2hLoading={!pickData && !pickError}
          xg={seasonXg}
        />

        <div className="modal-columns" ref={columnsRef}>
          <div className="modal-col">
            {/* 배당 표는 2026-09-04부터 위쪽 PickBand 왼쪽 칸('승+패 지표' 자리)으로
                옮겼다 — 여기 두면 같은 표가 화면에 두 번 나온다. */}
            <section className="detail-section detail-section-pinned" ref={sampleSectionRef}>
              <h3>
                <button
                  className="sample-fold-btn"
                  onClick={() => setSampleExpanded((v) => !v)}
                  title={sampleExpanded ? '판단에 쓰는 지표만 보기' : '전체 지표 보기'}
                  aria-expanded={sampleExpanded}
                >
                  {sampleExpanded ? '▾' : '▸'}
                </button>
                지표별 표본
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
                  <button
                    type="button"
                    className="help-btn"
                    onClick={() => setShowSeasonLegend(true)}
                    title="시즌전적이 정확히 무엇을 세는 표인지 보기"
                  >
                    시즌전적 <span className="help-mark">?</span>
                  </button>
                  {seasonSig && seasonSig.note && (
                    <span className="detail-section-note" title={seasonSig.note}>
                      숫자(괄호=같은 장소)
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
                최근10경기 전적
                <span className="detail-section-note">
                  <span className="recent-home-swatch" /> 홈경기 · 경기 직전까지 그 리그에서 세운 최다 기록
                </span>
              </h3>
              <RecentTable
                row={row}
                streaks={pickData ? pickData.streaks : null}
                recent10={pickData ? pickData.recent10 : null}
              />
            </section>
            <section
              className="detail-section detail-section-grow"
              ref={h2hSectionRef}
              style={h2hMaxHeight ? { maxHeight: `${h2hMaxHeight}px` } : undefined}
            >
              <h3 className="detail-h2h-title">
                <span className="detail-h2h-title-left">
                  {/* 배당·승점 기준 안내는 화면에 계속 띄워 두지 않고 제목에 마우스를
                      올렸을 때만 보이는 툴팁으로 둔다 — 국내 우선이었던 예전 기준과
                      헷갈리지 않게 근거는 남기되(HeadToHeadResult.jsx의 favSide 위
                      주석 참고), 상시 노출까진 필요 없다는 판단(2026-09-03). */}
                  <span
                    className="detail-h2h-title-text"
                    title="※ 승점은 홈팀 기준 · 배당은 해외배당 기준입니다."
                  >
                    상대전적
                  </span>
                  <select
                    className={`detail-h2h-period${h2hYears ? ' is-on' : ''}`}
                    value={h2hYears}
                    onChange={(e) => setH2hYears(Number(e.target.value))}
                    title="최근 N시즌만 집계 (요약표까지 같이 바뀝니다)"
                  >
                    <option value={0}>전체년도</option>
                    <option value={3}>최근 3년</option>
                    <option value={5}>최근 5년</option>
                  </select>
                  <label className="detail-h2h-home-toggle">
                    <input
                      type="checkbox"
                      checked={h2hHomeOnly}
                      onChange={(e) => setH2hHomeOnly(e.target.checked)}
                    />
                    홈보기
                  </label>
                  <label className="detail-h2h-home-toggle detail-h2h-fav-toggle-j">
                    <input
                      type="checkbox"
                      checked={h2hFavJ}
                      onChange={(e) => setH2hFavJ(e.target.checked)}
                    />
                    정
                  </label>
                  <label className="detail-h2h-home-toggle detail-h2h-fav-toggle-y">
                    <input
                      type="checkbox"
                      checked={h2hFavY}
                      onChange={(e) => setH2hFavY(e.target.checked)}
                    />
                    역
                  </label>
                  {/* 예전 종합분석 '상대전적' 카드에 있던 문장(맞대결 평균 총득점).
                      확률 계산에는 안 들어가는 참고값이라 제목 옆에 붙여만 두되, 눈에 띄게 강조한다. */}
                  {h2hSig && h2hSig.value_text && (
                    <span className="detail-section-note detail-h2h-avg">{h2hSig.value_text}</span>
                  )}
                </span>
              </h3>
              <HeadToHeadResult
                scope={scope} code={code} home={ht} away={at} cross
                preset={pickData ? pickData.h2h : null}
                presetLoading={!pickData && !pickError}
                presetError={pickError}
                homeOnly={h2hHomeOnly}
                years={h2hYears}
                favJ={h2hFavJ}
                favY={h2hFavY}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
    {showSeasonLegend && <SeasonRecordLegend onClose={() => setShowSeasonLegend(false)} />}
    </>
  )
}
