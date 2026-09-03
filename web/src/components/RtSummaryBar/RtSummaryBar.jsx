import { RT_CHIP } from '../RtBadge/RtBadge'

// 여기서는 '취소'·'연기'를 빼고 이 4개만 보여준다 — RT_COLOR 에 그 둘이 더 있어도
// 아래는 RT_ORDER 로만 순회하므로 조회되지 않는다.
const RT_ORDER = ['핸승', '핸무', '무', '역']

// 조회 결과가 0건이라 백엔드가 summary를 안 내려줄 때 쓰는 빈 값 — 뱃지 자체가
// 사라지는 대신 0으로 채워서 항상 보이게 한다(2026-09-03).
const EMPTY_RT_SUMMARY = { 핸승: 0, 핸무: 0, 무: 0, 역: 0, 총: 0 }

function pct(summary, name) {
  return summary.총 > 0 ? ((summary[name] / summary.총) * 100).toFixed(1) : '0.0'
}

// 핸승/핸무/무/역 결과분포를 보여준다. (통합DB탭=카드형 / 리그탭 대시보드=한 줄 색상 배지)
// onSelect를 넘기면 배지가 클릭 가능해진다 — 조회 결과 표를 그 결과부터 정렬하는
// 용도(LeaguePage). onSelect가 없는 자리(리그 대시보드 등 전체 요약)는 예전처럼
// 그냥 보여주기만 한다.
export default function RtSummaryBar({ summary, inline = false, onSelect, selected }) {
  const s = summary || EMPTY_RT_SUMMARY

  if (inline) {
    return (
      <span className="rt-summary-inline">
        {RT_ORDER.map((name) => {
          const clickable = !!onSelect
          const active = clickable && selected === name
          return (
            <span
              className={`rt-badge-item${clickable ? ' rt-badge-item-clickable' : ''}${active ? ' rt-badge-item-active' : ''}`}
              key={name}
              style={RT_CHIP[name]}
              onClick={clickable ? () => onSelect(name) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(name)
                      }
                    }
                  : undefined
              }
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              title={clickable ? `표를 ${name}부터 정렬 (다시 클릭하면 해제)` : undefined}
            >
              {name} {(s[name] ?? 0).toLocaleString()}
              <span className="rt-badge-pct">({pct(s, name)}%)</span>
            </span>
          )
        })}
      </span>
    )
  }

  return (
    <div className="rt-metrics">
      {RT_ORDER.map((name) => (
        <div className="rt-metric" key={name}>
          <span className="rt-metric-name">{name}</span>
          <span className="rt-metric-value">{(s[name] ?? 0).toLocaleString()}</span>
          <span className="rt-metric-pct">{pct(s, name)}%</span>
        </div>
      ))}
    </div>
  )
}

// 내픽(MY_PICK)+RT를 대조해 적중/보험/미적을 판정한다(api/main.py _my_pick_verdict와
// 동일 규칙). 내픽을 아예 안 찍었거나 '대기'인 경기는 판정 대상이 아니라 summary.총에도
// 안 들어가므로 세 값을 더하면 항상 100%가 된다.
const PICK_ORDER = ['적중', '보험', '미적']
const PICK_CHIP = {
  적중: { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)' },
  보험: { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)' },
  미적: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
}
const EMPTY_PICK_SUMMARY = { 적중: 0, 보험: 0, 미적: 0, 총: 0 }

// PICK 결과(적중/보험/미적) 분포 배지. 플핸예측 컬럼의 배경색과 동일한 색상을 쓴다.
// 보험 = 핸승 여부(큰 분류)는 맞혔지만 괄호 안 세부결과(핸무/무/역)는 다르게 나온 경우.
export function PickSummaryBar({ summary }) {
  const s = summary || EMPTY_PICK_SUMMARY
  return (
    <span className="rt-summary-inline">
      {PICK_ORDER.map((name) => (
        <span className="rt-badge-item" key={name} style={PICK_CHIP[name]}>
          {name} {(s[name] ?? 0).toLocaleString()}
          <span className="rt-badge-pct">({pct(s, name)}%)</span>
        </span>
      ))}
    </span>
  )
}
