import './StarButton.css'

// 중요 별표 — 이제 3단계다: 0=표시 없음(☆) / 1=보류·고민중(반개) / 2=중요(★).
// 예전엔 LeagueTable / MatchDetailModal에 글자 하나 안 다른 버튼 마크업이 각각
// 있었다(둘 다 ON/OFF만 있던 시절엔 그래도 됐지만, 3단계 순환·반개 렌더링까지
// 복사하면 한쪽만 고쳤을 때 표시가 달라지는 사고가 나기 쉽다 — pickOptions.js와
// 같은 이유로 한 곳에 모은다).

// 클릭할 때마다 0→1→2→0으로 순환한다.
export function nextStarLevel(level) {
  return ((Number(level) || 0) + 1) % 3
}

// 화면에 뜨는 값(IMPORTANT)이 과거 boolean(true/false)으로 온 적이 있어도 안전하게
// 0~2 정수로 맞춘다. true는 예전 '중요 표시 켜짐'과 같은 뜻이라 2(온별)로 본다.
export function starLevel(v) {
  if (v === true) return 2
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(2, Math.trunc(n)))
}

const TITLES = ['클릭하면 보류(고민중) 표시', '클릭하면 중요 표시로 변경', '클릭하면 표시 해제']

export default function StarButton({ level, onClick, className = '' }) {
  const lv = starLevel(level)
  const cls = ['star-btn', className, lv === 2 ? 'star-on' : '', lv === 1 ? 'star-half' : '']
    .filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} title={TITLES[lv]} onClick={onClick}>
      {lv === 1 ? (
        // 반개 별 — 빈 별 위에 채운 별을 왼쪽 절반만 잘라 겹친다(글꼴이 반개 글리프를
        // 안정적으로 지원하지 않아 이 방식을 쓴다).
        <span className="star-glyph" aria-hidden="true">
          <span className="star-glyph-back">☆</span>
          <span className="star-glyph-front">★</span>
        </span>
      ) : (
        lv === 2 ? '★' : '☆'
      )}
    </button>
  )
}
