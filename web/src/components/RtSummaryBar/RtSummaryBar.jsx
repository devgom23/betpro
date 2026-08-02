const RT_ORDER = ['핸승', '핸무', '무', '역']
const RT_COLOR = { 핸승: '#1565C0', 핸무: '#64B5F6', 무: '#757575', 역: '#C62828' }

// 핸승/핸무/무/역 결과분포를 보여준다. (통합DB탭=카드형 / 리그탭 대시보드=한 줄 색상 배지)
export default function RtSummaryBar({ summary, inline = false }) {
  if (!summary) return null

  if (inline) {
    return (
      <span className="rt-summary-inline">
        {RT_ORDER.map((name) => {
          const bg = RT_COLOR[name]
          const fg = name === '핸무' ? '#0D1B2A' : '#fff'
          return (
            <span className="rt-badge-item" key={name} style={{ background: bg, color: fg }}>
              {name} {summary[name].toLocaleString()}
              <span className="rt-badge-pct">
                ({((summary[name] / summary.총) * 100).toFixed(1)}%)
              </span>
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
          <span className="rt-metric-value">{summary[name].toLocaleString()}</span>
          <span className="rt-metric-pct">{((summary[name] / summary.총) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

const PICK_ORDER = ['적중', '보험', '미적', '관망']
const PICK_COLOR = { 적중: '#FDD835', 보험: '#00897B', 미적: '#C62828', 관망: '#757575' }

// PICK 결과(적중/보험/미적/관망) 분포 배지. 플핸예측 컬럼의 배경색과 동일한 색상을 쓴다.
// 보험 = 핸승 여부(큰 분류)는 맞혔지만 괄호 안 세부결과(핸무/무/역)는 다르게 나온 경우.
export function PickSummaryBar({ summary }) {
  if (!summary) return null
  return (
    <span className="rt-summary-inline">
      {PICK_ORDER.map((name) => {
        const bg = PICK_COLOR[name]
        const fg = name === '적중' ? '#0D1B2A' : '#fff'
        return (
          <span className="rt-badge-item" key={name} style={{ background: bg, color: fg }}>
            {name} {summary[name].toLocaleString()}
            <span className="rt-badge-pct">
              ({((summary[name] / summary.총) * 100).toFixed(1)}%)
            </span>
          </span>
        )
      })}
    </span>
  )
}
