import './RtBadge.css'

// 핸디캡 결과(RT) 색상 — 상대전적/상세보기/상대전적 탭이 모두 이 배색을 함께 쓴다.
export const RT_COLOR = {
  핸승: '#1565C0',
  핸무: '#64B5F6',
  무: '#757575',
  역: '#C62828',
  취소: '#546E7A',
}

// RT 라벨 배지. 값이 없으면 아무것도 그리지 않는다.
// (예전엔 HeadToHeadResult / MatchDetailModal / HeadToHeadPage 에 글자 하나 안 다른
//  복사본이 각각 있었고, .rt-badge CSS 도 3개 파일에 중복 정의돼 있었다.)
export default function RtBadge({ label }) {
  if (!label) return null
  const bg = RT_COLOR[label] || '#9E9E9E'
  const fg = label === '핸무' ? '#0D1B2A' : '#fff'
  return (
    <span className="rt-badge" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}
