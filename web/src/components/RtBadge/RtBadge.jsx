import './RtBadge.css'

// 핸디캡 결과(RT) 색상 — 점(dot)처럼 배경 없이 단색으로만 쓰는 자리에서 쓴다
// (SeasonStats의 ③ 라운드 이력 카드 dot 등). 배지 자체는 아래 RT_CHIP(옅은 칩
// 스타일)을 쓴다.
export const RT_COLOR = {
  핸승: '#2f6fed',
  핸무: '#2e7d4f',
  무: '#757575',
  역: '#C62828',
  취소: '#546E7A',
  연기: '#B7791F',
}

// RT 배지(칩) 배경·글자색 — 스샷 실측 기준 옅은 배경 틴트 + 진한 글씨 스타일.
// index.css의 --chip-* 변수를 참조하므로 다크/라이트 테마에 따라 자동으로 바뀐다.
export const RT_CHIP = {
  핸승: { background: 'var(--chip-blue-bg)', color: 'var(--chip-blue-fg)' },
  핸무: { background: 'var(--chip-green-bg)', color: 'var(--chip-green-fg)' },
  무: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' },
  역: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
  취소: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' },
  // 연기는 '아직 결과가 나올 경기'라 취소(회색)와 눈으로 구분되게 노랑을 쓴다.
  연기: { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)' },
}

// RT 라벨 배지. 값이 없으면 아무것도 그리지 않는다.
// (예전엔 HeadToHeadResult / MatchDetailModal / HeadToHeadPage 에 글자 하나 안 다른
//  복사본이 각각 있었고, .rt-badge CSS 도 3개 파일에 중복 정의돼 있었다.)
// matched=true면 노란 테두리를 두른다 — "P"칸에서 내가 찍은 결과가 실제 RT와
// 맞았는지 한눈에 보려는 용도(집계·판정에는 안 쓰는 순수 확인용, 다른 곳에서는
// 안 씀).
export default function RtBadge({ label, matched = false }) {
  if (!label) return null
  const chip = RT_CHIP[label] || { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' }
  return (
    <span className={`rt-badge${matched ? ' rt-badge-matched' : ''}`} style={chip}>
      {label}
    </span>
  )
}
