import { Fragment, useEffect, useRef, useState } from 'react'
import { api, saveBlob } from '../../api/client'
import HeadToHeadResult from '../HeadToHead/HeadToHeadResult'
import RtBadge from '../RtBadge/RtBadge'
import StarButton, { nextStarLevel, starLevel } from '../StarButton/StarButton'
import { formatTime, formatDt, scoreClass } from '../../utils/format'
import { PICK_OPTIONS, P_OPTIONS, HIT_OPTIONS, REASON_TAG_OPTIONS } from '../../utils/pickOptions'
import { oddsMoveGrade, oddsMoveTitle } from '../../utils/oddsMove'
import { h2hVerdict } from '../../utils/h2hVerdict'
import { drawTendency, drawRelation, systemGrade, AGREE_LABEL } from '../../utils/systemVerdict'
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
  ['TK-W', '국통) 승'], ['TK-L', '국통) 패'], ['TK-WL', '국통) 승+패'], ['TK-WDL', '국통) 승+무+패'],
  ['F-W', '해) 승'], ['F-L', '해) 패'], ['F-WL', '해) 승+패'], ['F-WDL', '해) 승+무+패'],
  ['F-W-HT', '해) 승=홈팀'], ['F-L-AT', '해) 패=원정팀'],
  ['TF-W', '해통) 승'], ['TF-L', '해통) 패'], ['TF-WL', '해통) 승+패'], ['TF-WDL', '해통) 승+무+패'],
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
        + ' 16,748경기 중 711건). 화면의 (정)/(역) 표시와 시스템 판정의 전적 관계는'
        + ' 국내배당을 우선으로 쓴다(homeIsFav) — 해외배당 기준 지표(해초·해배)를'
        + ' 볼 때는 정배가 반대일 수 있다는 걸 감안해야 한다.'}
    >
      국≠해
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

// ── 배당차 뱃지 (2026-08-30 실측) ──
// 배당차 = |승배당 − 패배당| = 역배 − 정배. 괄호 안은 그 구간의 '플핸무 적중률'
// (= 핸승만 안 나오면 적중). 6대리그 결과 있는 경기 전부로 쟀다.
//
// ⚠ 이 숫자는 확률 지표가 모르는 새 정보가 아니다. 배당차는 정배배당과 거의 같은
//    값이라(상관 −0.79~−0.85, 정배배당이 배당차의 71%를 설명한다) 여기 적힌 차이는
//    사실상 정배배당이 만든 것이다. 실제로 정배배당을 0.05 단위로 고정하고 다시 재면
//    플핸무 쪽 차이는 사라진다(핸승 z가 −0.48 ~ −3.70으로 부호까지 뒤섞인다).
//    그래서 이건 "배당표 보고 머릿속으로 빼야 알던 걸 미리 계산해 둔 참조값"이다.
//    똥배 뱃지도 같은 성격이다(그것도 배당에서 나온 값).
//
// 초기·배변을 둘 다 띄우는 이유: 91%는 같은 구간에 들어가지만 9%는 갈린다.
// 국·해를 둘 다 띄우는 이유: 같은 구간에 들어가는 게 54.2%뿐이다(절반은 갈린다).
const GAP_CUTS = [0.5, 1.0, 1.5, 2.5, 4.0, 7.0]
// 구간마다 [플핸무%, 플핸무 적중건, 정무%, 정무 적중건, 전체건]
// 7구간: ~0.5 / 0.5~1 / 1~1.5 / 1.5~2.5 / 2.5~4 / 4~7 / 7+
const GAP_HIT = {
  국초: [[83.4, 4304, 68.1, 3515, 5162], [80.0, 3929, 71.3, 3503, 4913],
    [76.2, 3205, 74.5, 3135, 4207], [72.6, 4191, 78.7, 4538, 5769],
    [66.5, 3407, 82.7, 4236, 5121], [57.2, 2633, 89.1, 4097, 4600],
    [39.7, 1170, 94.0, 2772, 2948]],
  해초: [[83.1, 3735, 68.1, 3062, 4495], [81.4, 3751, 70.2, 3235, 4608],
    [77.6, 3462, 74.0, 3301, 4462], [74.2, 4823, 76.6, 4976, 6499],
    [68.2, 4155, 81.7, 4976, 6090], [60.1, 3210, 86.9, 4639, 5340],
    [43.8, 1943, 93.1, 4130, 4438]],
  국배: [[83.4, 4101, 67.8, 3334, 4915], [80.2, 3850, 71.4, 3427, 4799],
    [76.6, 3256, 74.1, 3148, 4248], [72.7, 4279, 78.5, 4621, 5883],
    [67.0, 3500, 82.6, 4315, 5227], [57.1, 2698, 88.8, 4200, 4728],
    [39.6, 1156, 94.2, 2753, 2922]],
  해배: [[84.9, 3441, 65.4, 2649, 4051], [81.7, 3561, 68.7, 2997, 4361],
    [78.9, 3282, 73.7, 3066, 4159], [74.7, 4909, 77.0, 5061, 6570],
    [68.5, 4253, 81.4, 5051, 6205], [61.8, 3411, 86.5, 4770, 5516],
    [43.8, 2223, 93.2, 4725, 5071]],
}
// 배당차가 크면 플핸무%는 볼 이유가 없는 숫자가 된다(7.0+ 구간은 39.7%). 그 구간에서
// 실제로 걸 만한 건 정무(94.0%)다. 그래서 구간마다 '둘 중 높은 쪽'을 보여준다.
// 뒤집히는 자리는 배당차 1.5 — 네 출처(국초·해초·국배·해배)가 전부 같은 자리에서 뒤집힌다.
//
// 어느 쪽을 보여주는지는 '플'/'정' 글자를 뱃지로 붙여 표시한다. 국배는 1.5 이하라 플,
// 해배는 1.5 초과라 정 — 이렇게 서로 다른 걸 가리킬 때가 있어서, 글자 없이 %만 두면
// 무엇의 확률인지 알 수 없다.
const GAP_FLIP = 3         // 이 구간부터 정무를 보여준다(1.5~2.5부터)
const GAP_BASE = 69.8      // 배당차를 안 가린 전체 평균(플핸무·정무 둘 다 이 값)
const GAP_BAND_LABEL = ['~0.5', '0.5~1', '1~1.5', '1.5~2.5', '2.5~4', '4~7', '7+']
// 라벨 → [승배당 칸, 패배당 칸, 비었을 때 대신 볼 칸]
const GAP_SRC = [
  ['국초', 'KW', 'KL', null],
  ['해초', 'FW', 'FL', null],
  ['국배', 'EKW', 'EKL', ['KW', 'KL']],
  ['해배', 'EFW', 'EFL', ['FW', 'FL']],
]

function gapOf(row, wKey, lKey, fb) {
  const pick = (a, b) => {
    const w = numOrNull(row[a])
    const l = numOrNull(row[b])
    return w !== null && l !== null && w > 1 && l > 1 ? Math.abs(w - l) : null
  }
  const v = pick(wKey, lKey)
  return v !== null ? v : (fb ? pick(fb[0], fb[1]) : null)
}

function gapBandIndex(gap) {
  let i = 0
  while (i < GAP_CUTS.length && gap >= GAP_CUTS[i]) i += 1
  return i
}

// 0.5 → "0.5", 0.15 → "0.15", 1.2100000001 → "1.21"
function gapText(v) {
  return String(Number(v.toFixed(2)))
}

function gapParts(row) {
  return GAP_SRC.map(([label, w, l, fb]) => {
    const gap = gapOf(row, w, l, fb)
    if (gap === null) return null
    const idx = gapBandIndex(gap)
    const [phRate, phHit, jmRate, jmHit, tot] = GAP_HIT[label][idx]
    // 배당차 1.5를 경계로 보여줄 값을 바꾼다 — 그 구간에서 실제로 걸 만한 쪽.
    const isJm = idx >= GAP_FLIP
    const pick = isJm ? '정' : '플'
    const rate = isJm ? jmRate : phRate
    const hit = isJm ? jmHit : phHit
    // 색은 '% 그 자체'로 정한다 — 화면에 보이는 숫자와 색이 어긋나지 않게
    // (80%인데 흰색, 79%인데 초록 같은 일이 없게).
    // 노랑은 이 앱에서 '적중'을 뜻하는 색이라 쓰지 않는다.
    const tone = rate >= 80 ? 'best' : rate >= 75 ? 'mid' : 'plain'
    return { label, gap, rate, hit, tot, idx, tone, pick, isJm }
  })
}

// 배당차 — 2026-09-02부터 경기지표 옆 칸에 표로 뺐다(예전엔 칩 하나에 4줄을 욱여넣어
// 줄이 길어지고 옆 칸엔 빈 공간이 남았다). '시스템 판정' 표와 같은 꼴(초기/배변 ×
// 국배/해배)로 맞춘다 — GAP_SRC가 이미 [국초,해초,국배,해배] 순서라 그대로 2x2로 접는다.
function GapTable({ row }) {
  const [gukcho, haecho, gukbae, haebae] = gapParts(row)
  if (![gukcho, haecho, gukbae, haebae].some(Boolean)) return <p className="pick-loading">해당 없음</p>
  const cell = (p) => (p ? (
    <span
      title={`${p.label} 배당차 ${gapText(p.gap)} → ${GAP_BAND_LABEL[p.idx]} 구간.`
        + ` 6대리그 ${p.tot.toLocaleString()}경기 중`
        + ` ${p.isJm ? '정무' : '플핸무'} 적중 ${p.hit.toLocaleString()}건 (${p.rate}%).`
        + ` 이 구간에서는 ${p.isJm ? '플핸무보다 정무가' : '정무보다 플핸무가'} 높아`
        + ` ${p.isJm ? '정무' : '플핸무'}를 보여줍니다(경계는 배당차 1.5).`
        + ` 배당차를 안 가린 전체 평균은 둘 다 ${GAP_BASE}%.`
        + ' ※ 배당차는 정배배당과 거의 같은 값이라, 확률 지표가 이미 반영한 정보입니다.'}
    >
      <b>{gapText(p.gap)}</b>
      <span className={`gap-pick gap-pick-${p.isJm ? 'j' : 'p'}`}>{p.pick}</span>
      <span className={`gap-rate gap-rate-${p.tone}`}>{Math.round(p.rate)}%</span>
    </span>
  ) : <span className="dir-none">—</span>)
  return (
    <table className="detail-table sys-table gap-table">
      <thead>
        <tr>
          <th className="row-label" />
          <th>국배</th>
          <th>해배</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="row-label">초기</td>
          <td>{cell(gukcho)}</td>
          <td>{cell(haecho)}</td>
        </tr>
        <tr>
          <td className="row-label">배변</td>
          <td>{cell(gukbae)}</td>
          <td>{cell(haebae)}</td>
        </tr>
      </tbody>
    </table>
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
// 매핑 기준 — "정"이 홈인지 원정인지는 반드시 homeIsFav(팝업 제목의 (정)/(역)과
// 같은 기준, 국내배당 우선)로 정한다. 시스템 판정 칸 자체의 방향(해외 지표 기준)을
// 쓰면 국내·해외가 갈리는 경기(약 4%)에서 제목과 반대로 나온다 — 실측 예시(26-27 2R
// 선덜랜드 vs 풀럼)로 확인: 제목은 선덜랜드=정인데 해외 지표만 보면 풀럼=정으로
// 나와 헷갈렸다. homeIsFav 기준으로 맞추면 "정역(선덜랜드 편) + 원정만우세(풀럼이
// 강함) → 다른방향"이 나온다.
const H2H_HOME_SIDE = { 홈우세: 'home', 홈만우세: 'home', 원정우세: 'away', 원정만우세: 'away' }

function h2hRelation(verdictLabel, row, pick) {
  const side = H2H_HOME_SIDE[verdictLabel]
  if (!side || !pick || !DIR_SIDE[pick]) return null
  const homeFav = homeIsFav(row)
  if (homeFav === null) return null
  const histFavorsMarketFav = (side === 'home') === homeFav
  const pickWantsFav = DIR_SIDE[pick] === '정'
  return histFavorsMarketFav === pickWantsFav ? '같은방향' : '다른방향'
}

function h2hChips(verdict, loading, row, pick) {
  if (loading) {
    return [<MatchChip key="h2h" label="전적">…</MatchChip>]
  }
  if (!verdict) return []
  const rel = h2hRelation(verdict.label, row, pick)
  return [
    <MatchChip
      key="h2h"
      label="전적"
      tone={verdict.tone}
      title={verdict.title + (rel ? `\n지금 시스템 판정(${pick})과는 '${rel}'(사실 표시 — 값이 검증되지 않았다).` : '')}
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
        + (relLabel ? `\n지금 시스템 판정(${pick})과는 '${relLabel}'.` : '')}
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

function MatchIndicators({ row, h2hVerdict: verdict, h2hLoading, pick }) {
  // 배당차는 2026-09-02부터 옆 칸에 표로 따로 뺐다(GapTable) — 여기 줄은
  // 똥배 → 국/해 엇갈림 → 전적 → 무만 세로로 쌓는다.
  const chips = [...ddongChips(row), ...oddsSplitChips(row),
    ...h2hChips(verdict, h2hLoading, row, pick), ...drawChips(row, pick)]
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
  // 해외 배당이 크게 움직인 경기인가 — 리그 표 '지표 > 배변' 칸과 같은 값을 쓴다.
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
  const marketFav = (label) => {
    const [wk, lk] = label.startsWith('국내') ? ['KW', 'KL'] : ['FW', 'FL']
    const w = numOrNull(row[wk])
    const l = numOrNull(row[lk])
    if (w === null || l === null || w === l) return null
    return w < l
  }
  const favColClass = (col, label) => {
    const fav = marketFav(label)
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
  const dogColClass = (col, label) => {
    const fav = marketFav(label)
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
          const colClass = (col) => (isHandi ? dogColClass(col, label) : favColClass(col, label))
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
                    const dir = oddsDir(row[initKey], row[final[ci]])
                    const cls = ci === 0 ? colClass('w') : ci === 2 ? colClass('l') : undefined
                    return (
                      <td key={final[ci]} className={cls}>
                        {numOrDash(row[final[ci]])}
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
      ['국)정', toN(row.WIN_RISK), toN(row.E_WIN_RISK), true],
      ['해)정', toN(row.WIN_RISK_F), toN(row.E_WIN_RISK_F), true],
    ]],
    ['플핸무 %', 'nh', [
      ['국)플', toN(row.NH_KO), toN(row.E_NH_KO), true],
      ['국)지', toN(row.NH_KI), toN(row.E_NH_KI), true],
      ['해)지', toN(row.NH_FI), toN(row.E_NH_FI), true],
    ]],
    ['플 %', 'pl', [
      ['국)플', toN(row.PL_KO), toN(row.E_PL_KO), true],
      ['국)지', toN(row.PL_KI), toN(row.E_PL_KI), true],
      ['해)지', toN(row.PL_FI), toN(row.E_PL_FI), true],
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
            cols.map(([label, n, , hasFinal], ci) => (
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
              .filter(({ col }) => col[3])
              .map(({ col: [label, n, en], ci }) => {
                // 오르든 내리든(정배 확률이 오른 게 플핸 쪽엔 나쁠 수도 있어) 배당
                // 화살표처럼 빨강/파랑으로 방향에 뜻을 담지 않는다 — 그냥 값이
                // 움직였다는 표시로만, 배경색과 잘 보이도록 흰색으로 둔다.
                const dir = n !== null && en !== null && en !== n ? (en > n ? 'up' : 'down') : null
                return (
                  <td
                    key={`${title}-${label}-e`}
                    className={ci === cols.length - 1 && gi < groups.length - 1 ? 'risk-edge' : ''}
                    style={riskCellStyle(kind, en)}
                  >
                    {en === null ? '-' : en.toFixed(0)}
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

// 칸 하나에 마우스를 올렸을 때 보여줄 그 경기 정보.
//   26-08-24(수) 20:30
//   리버플 1 - 0 노팅엄 (역)
// 서버가 준 목록(recent10)은 화면 칸과 같은 순서라 자리만 맞춰 꺼내 쓴다. 다만 칸은
// 항상 10개인데 경기가 그보다 적을 수 있어(시즌 초반), 원정팀 쪽은 뒤에서부터 채우는
// recentCells의 offset을 똑같이 적용해 자리를 맞춘다.
// 칸에 마우스를 올렸을 때 뜨는 말풍선.
//   26-08-24 (일) 00:30 / D
//   뉴캐슬 2 - 2 리버풀 (무)
// 브라우저 기본 툴팁(title)으로는 밑줄·색을 못 넣어서 직접 그린다. team(그 칸의 주인)
// 이름에 밑줄을 긋고, 이긴 쪽 점수는 앱의 기존 규칙과 같은 빨강(.winner-score)으로.
function RecentTip({ game, team, rect }) {
  if (!game || !rect) return null
  const g = (v) => (v === null || v === undefined ? '-' : Math.trunc(v))
  const hs = g(game.HS)
  const as_ = g(game.AS)
  const win = hs === '-' || as_ === '-' ? null : hs > as_ ? 'home' : as_ > hs ? 'away' : null
  const rt = rtLabel(game.RT)
  const name = (t) => (t === team ? <u>{t}</u> : t)
  return (
    <div
      className="recent-tip"
      style={{ left: Math.round(rect.left + rect.width / 2), top: Math.round(rect.top - 8) }}
    >
      <div className="recent-tip-when">
        {[formatDt(game.DT), formatTime(game.TM)].filter(Boolean).join(' ')}
        <span className="recent-tip-sep">/</span>
        <b className={`recent-tip-wdl recent-${game.letter}`}>{game.letter}</b>
      </div>
      <div className="recent-tip-score">
        {name(game.HT)}{' '}
        <b className={win === 'home' ? 'winner-score' : undefined}>{hs}</b>
        {' - '}
        <b className={win === 'away' ? 'winner-score' : undefined}>{as_}</b>
        {' '}{name(game.AT)}
        {rt && <span className="recent-tip-rt"> ({rt})</span>}
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
const DIR_PAIR_CUT = 80

function directionName(v) {
  if (!v) return null
  const [hs, hm, mu, yk] = v
  if (hs + hm >= DIR_PAIR_CUT) return '정'
  if (mu + yk >= DIR_PAIR_CUT) return '플'
  const cand = [['플핸무', hs], ['플핸승', hm], ['정역', mu], ['정무', yk]]
  return cand.reduce((best, c) => (c[1] < best[1] ? c : best))[0]
}

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

/** 이름 -> 방향. 첫 조각(DIR_PARTS의 '정'/'플')이 곧 방향이다. */
const DIR_SIDE = { 정무: '정', 정역: '정', 정: '정', 플핸무: '플', 플핸승: '플', 플: '플' }

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
// 어긋나지 않도록, 거기서 쓰는 것과 완전히 같은 재료(판단 9줄 · 같은 순서 · 같은 가중치)를 쓴다.
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
    if (!favCodes.has(code)) continue        // 화면 기본값과 같은 '판단에 쓰는 9줄'만
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

// '확률 지표' 밴드 왼쪽 칸 — 지표별 표본(아래 SampleTable)의 승+패 4줄(국)승+패·
// 국통)승+패·해)승+패·해통)승+패)만 그대로 뽑아 보여준다. 승·패 각각의 방향(정배가
// 홈인지 원정인지)과 달리 승+패는 방향 무관 지표라 이 경기와 늘 관련이 있다(favSampleCodes
// 주석 참고) — 그래서 여기서는 대상 거르기 없이 네 줄을 고정으로 보여준다.
// scope==='user'일 때 TK-/TF-를 빼는 것도 SampleTable과 같은 이유(내 데이터는 리그
// 하나뿐이라 통합 지표가 국내·해외 지표와 완전히 같아져 의미 없는 중복이 된다).
const WL_CODES = ['K-WL', 'TK-WL', 'F-WL', 'TF-WL']

function WlIndicatorTable({ row, scope }) {
  const codes = scope === 'user' ? WL_CODES.filter((c) => !c.startsWith('T')) : WL_CODES
  const cnt = (v) => {
    const n = Number(v)
    return Number.isNaN(n) ? 0 : Math.trunc(n)
  }
  const lines = codes.map((code) => {
    const label = SAMPLE_INDICATORS.find(([c]) => c === code)[1]
    const vals = [1, 2, 3, 4].map((i) => cnt(row[`${code} ${i}`]))
    const eRaw = [1, 2, 3, 4].map((i) => row[`E_${code} ${i}`])
    const hasE = eRaw.some((v) => v !== null && v !== undefined && v !== '')
    const eVals = hasE ? eRaw.map(cnt) : null
    return {
      code, label, vals,
      total: vals.reduce((a, b) => a + b, 0),
      eVals,
      eTotal: eVals ? eVals.reduce((a, b) => a + b, 0) : 0,
    }
  })
  const isForeignCode = (c) => /^(F|TF)-/.test(c)
  return (
    <table className="detail-table sample-table wl-indicator-table">
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
          const prev = li > 0 ? lines[li - 1] : null
          const groupStart = prev && isForeignCode(l.code) && !isForeignCode(prev.code)
          return (
            <Fragment key={l.code}>
              <tr className={groupStart ? 'sample-group-start' : undefined}>
                <td className="row-label">{l.label}</td>
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
      </tbody>
    </table>
  )
}

// expanded=false(기본)면 판단에 쓰는 9줄만 보여준다. 그때는 보이는 게 전부 대상이라
// 테두리 강조를 걸지 않는다 — 다 강조하면 강조가 아니게 되기 때문. 펼쳐서 27줄을
// 다 보여줄 때만 그 9줄에 테두리를 둘러 어느 것이 대상인지 구분해 준다.
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
    const hasE = eRaw.some((v) => v !== null && v !== undefined && v !== '')
    const eVals = hasE ? eRaw.map(cnt) : null
    return {
      code, label, vals,
      total: vals.reduce((a, b) => a + b, 0),
      eVals,
      eTotal: eVals ? eVals.reduce((a, b) => a + b, 0) : 0,
    }
  })
  const lines = expanded ? allLines : allLines.filter((l) => favCodes.has(l.code))

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
  // 분석 줄의 배변은 같은 가중평균을 최종배당 표본으로 한 번 더 돌린다.
  const eLines = lines.map((l) => ({ ...l, vals: l.eVals || [0, 0, 0, 0], total: l.eTotal }))

  // 접었을 때만 국내/해외 블록 끝에 '분석' 줄을 붙인다. 펼치면 통합지표까지 섞여
  // 들어와 '리그 지표만 본다'는 전제가 깨지므로 그때는 계산하지 않는다(그때는 null).
  // 접혔는데 표본 자체가 없어 null이 나온 경우는 AnalysisRow가 빈칸으로 그려준다.
  const isForeignCode = (c) => /^(F|TF)-/.test(c)
  const domAnalysis = expanded ? null : weightedAnalysis(lines.filter((l) => !isForeignCode(l.code)))
  const forAnalysis = expanded ? null : weightedAnalysis(lines.filter((l) => isForeignCode(l.code)))
  // 토탈 = 국내 분석과 해외 분석의 평균(한쪽만 있으면 그쪽만).
  const bothAnalysis = [domAnalysis, forAnalysis].filter(Boolean)
  const totalAnalysis = bothAnalysis.length
    ? [0, 1, 2, 3].map((i) => bothAnalysis.reduce((s, a) => s + a[i], 0) / bothAnalysis.length)
    : null

  const eDomAnalysis = expanded || !anyFinal
    ? null : weightedAnalysis(eLines.filter((l) => !isForeignCode(l.code)))
  const eForAnalysis = expanded || !anyFinal
    ? null : weightedAnalysis(eLines.filter((l) => isForeignCode(l.code)))
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
          // 펼쳤을 때만 대상 9줄에 테두리를 두른다(위 컴포넌트 주석 참고).
          const cls = [
            groupStart && 'sample-group-start',
            expanded && favCodes.has(l.code) && 'sample-fav-row',
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
                <td className="row-label">{l.label}</td>
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
          <option value="">P</option>
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
// ── 시스템 판정 ──
// 지표 방향성 4칸(국초·국배·해초·해배)과 무배당 보정을 합쳐 결론 하나와 신뢰도를 낸다.
// 종합 판정은 '해배·초기' 칸을 그대로 쓴다 — 실측에서 그 조합이 가장 정확했다
// (해배가 국배보다 +1.8%p, 초기가 배변보다 +1.2~1.4%p). 근거는 utils/systemVerdict.js.
// K1/K2(내 데이터)는 6대리그로만 잰 값이라 % 와 별을 띄우지 않는다 — 방향과 일치도만.
// names·pick은 PickBand가 한 번만 계산해서 내려준다 — 경기지표의 '무' 뱃지도 같은
// pick이 필요해서(같은방향/다른방향 표시), 여기서 또 계산하면 두 곳이 따로 놀 수 있다.
function SystemVerdict({ row, scope, names, pick }) {
  const tendency = drawTendency(row)
  const grade = systemGrade(names, pick, tendency, scope !== 'user')
  const cell = (v) => (v ? <b className="sys-name">{v}</b> : <span className="dir-none">—</span>)

  return (
    <div className="sys-band">
      <h3 className="pick-band-risk-col-title">
        시스템 판정
        {pick && (
          <span className="sys-head">
            <b className={`sys-pick sys-pick-${DIR_SIDE[pick] === '정' ? 'j' : 'p'}`}>{pick}</b>
            {grade && grade.stars !== null && (
              <>
                <span
                  className="sys-stars"
                  title={`${AGREE_LABEL[grade.agree]} · 무배당 ${grade.rel}`
                    + '(경기지표의 \'무\' 뱃지 참고)'}
                >
                  {'★'.repeat(grade.stars)}{'☆'.repeat(3 - grade.stars)}
                </span>
                <span className="sys-rate">{Math.round(grade.rate)}%</span>
              </>
            )}
            {grade && grade.stars === null && (
              <span className="detail-section-note">
                {scope === 'user' ? '내 데이터는 적중률을 재지 않았습니다' : AGREE_LABEL[grade.agree]}
              </span>
            )}
          </span>
        )}
      </h3>
      <table className="detail-table sys-table">
        <thead>
          <tr>
            <th className="row-label" />
            <th>국배</th>
            <th>해배</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="row-label">초기</td>
            <td>{cell(names[0])}</td>
            <td className="sys-pick-cell">{cell(names[2])}</td>
          </tr>
          <tr>
            <td className="row-label">배변</td>
            <td>{cell(names[1])}</td>
            <td>{cell(names[3])}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function PickBand({ row, scope, h2hVerdict: verdict, h2hLoading }) {
  // '경기지표'의 무 뱃지(같은방향/다른방향)와 '시스템 판정' 둘 다 이 pick이
  // 필요해서 여기서 한 번만 계산해 내려준다.
  const init = analysisPair(row, scope, false)
  const fin = analysisPair(row, scope, true)
  const names = [
    init.dom ? directionName(init.dom) : null,     // 국초
    fin.dom ? directionName(fin.dom) : null,       // 국배
    init.forr ? directionName(init.forr) : null,   // 해초
    fin.forr ? directionName(fin.forr) : null,     // 해배
  ]
  const pick = names[2]                            // 종합 = 해배·초기

  return (
    <section className="pick-band">
      <div className="pick-band-risk">
        <div className="pick-band-risk-cols">
          <div className="pick-band-risk-col">
            <h3 className="pick-band-risk-col-title">승+패 지표</h3>
            <WlIndicatorTable row={row} scope={scope} />
          </div>
          <div className="pick-band-risk-col">
            <h3 className="pick-band-risk-col-title">
              확률 지표
              <DirectionSummary row={row} scope={scope} />
            </h3>
            <RiskCard row={row} />
            {/* 경기지표·배당차·시스템 판정은 왼쪽('승+패 지표') 칸과는 무관하게
                이 칸(확률 지표) 표 바로 밑에만 붙인다 — 왼쪽 칸 아래로는 안 내려간다.
                예전엔 이 셋을 세로로 쌓아서 줄이 길어졌는데, 이 칸 폭 안에서
                가로 3단(뱃지·표·표)으로 접어 줄 수를 줄인다. */}
            <div className="pick-band-bottom-cols">
              <div className="pick-band-match">
                <h3>경기지표</h3>
                <MatchIndicators row={row} h2hVerdict={verdict} h2hLoading={h2hLoading} pick={pick} />
              </div>
              <div className="pick-band-gap">
                <h3>배당차</h3>
                <GapTable row={row} />
              </div>
              <SystemVerdict row={row} scope={scope} names={names} pick={pick} />
            </div>
          </div>
        </div>
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

        <h2 className="modal-title detail-modal-title">
          <span>
            {ht}
            {rankSuffix(row.HP)}
            {titleRoleSuffix(true)}
            <TeamBetRecord name={ht} /> vs {at}
            {rankSuffix(row.AP)}
            {titleRoleSuffix(false)}
            <TeamBetRecord name={at} />
          </span>
          <StarButton
            level={starLevel(row.IMPORTANT)}
            onClick={() => onSavePick({ important: nextStarLevel(starLevel(row.IMPORTANT)) })}
          />
        </h2>
        <p className="modal-meta">
          {row.S} · {row.R}
          {row.DT ? ` · ${formatDt(row.DT)}` : ''}
          {formatTime(row.TM) ? ` ${formatTime(row.TM)}` : ''}
          &nbsp;&nbsp;
          {rt ? <RtBadge label={rt} /> : <span className="modal-scheduled">예정 경기</span>}
          <DdongsaBadge row={row} />
        </p>
        <MyPickBar row={row} onSavePick={onSavePick} />

        <PickBand
          row={row}
          scope={scope}
          h2hVerdict={h2hMark}
          h2hLoading={!pickData && !pickError}
        />

        <div className="modal-columns" ref={columnsRef}>
          <div className="modal-col">
            <section className="detail-section detail-section-pinned">
              {/* 똥배는 2026-08-30 '경기지표' 줄(팝업 위쪽)로 옮겼다 — 여기에도 두면
                  같은 값이 화면에 두 번 나온다. */}
              <h3>배당</h3>
              <OddsTable row={row} />
            </section>
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
                  시즌전적
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
                  상대전적
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
                {/* 배당 기준을 적어 둔다 — 화면만 봐선 국내인지 해외인지 알 수 없고,
                    예전엔 국내 우선이었어서 값이 달라진 이유를 나중에 못 찾는다.
                    해외로 통일한 근거는 HeadToHeadResult.jsx의 favSide 위 주석 참고. */}
                <span className="detail-section-note detail-h2h-footnote">
                  ※ 승점은 홈팀 기준 · 배당은 해외배당 기준입니다.
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
  )
}
