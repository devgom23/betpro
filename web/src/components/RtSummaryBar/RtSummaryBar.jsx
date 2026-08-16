import { RT_CHIP } from '../RtBadge/RtBadge'

// 여기서는 '취소'를 빼고 이 4개만 보여준다 — RT_COLOR 에 '취소'가 더 있어도
// 아래는 RT_ORDER 로만 순회하므로 조회되지 않는다.
const RT_ORDER = ['핸승', '핸무', '무', '역']

// 핸승/핸무/무/역 결과분포를 보여준다. (통합DB탭=카드형 / 리그탭 대시보드=한 줄 색상 배지)
export default function RtSummaryBar({ summary, inline = false }) {
  if (!summary) return null

  if (inline) {
    return (
      <span className="rt-summary-inline">
        {RT_ORDER.map((name) => (
          <span className="rt-badge-item" key={name} style={RT_CHIP[name]}>
            {name} {summary[name].toLocaleString()}
            <span className="rt-badge-pct">
              ({((summary[name] / summary.총) * 100).toFixed(1)}%)
            </span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <div className="rt-metrics">
      {RT_ORDER.map((name) => (
        <div className="rt-metric" key={name}>
          <span className="rt-metric-name">{name}</span>
          <span className="rt-metric-value">{summary[name].toLocaleString()}</span>
          <span className="rt-metric-pct">{((summary[name] / summary.총) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

// 관망(PICK이 '—')은 표에서 PICK 컬럼 자체가 없어져 어느 경기가 해당하는지 추적할
// 수 없어 뺐다 — 적중/보험/미적만 보여준다(퍼센트 분모(summary.총)엔 관망 몫도 그대로
// 들어있어 세 값을 더해도 100%가 안 될 수 있는데, 이건 정상이다).
const PICK_ORDER = ['적중', '보험', '미적']
const PICK_CHIP = {
  적중: { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)' },
  보험: { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)' },
  미적: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
}

// PICK 결과(적중/보험/미적) 분포 배지. 플핸예측 컬럼의 배경색과 동일한 색상을 쓴다.
// 보험 = 핸승 여부(큰 분류)는 맞혔지만 괄호 안 세부결과(핸무/무/역)는 다르게 나온 경우.
export function PickSummaryBar({ summary }) {
  if (!summary) return null
  return (
    <span className="rt-summary-inline">
      {PICK_ORDER.map((name) => (
        <span className="rt-badge-item" key={name} style={PICK_CHIP[name]}>
          {name} {summary[name].toLocaleString()}
          <span className="rt-badge-pct">
            ({((summary[name] / summary.총) * 100).toFixed(1)}%)
          </span>
        </span>
      ))}
    </span>
  )
}
