import { useEffect, useMemo, useRef, useState } from 'react'
import './RoundShortcutBar.css'

// 스코어맨 화면 자체의 "1~38 라운드 바로가기" 버튼과 같은 발상 — 필터의 "시즌 및
// 라운드"에서 라운드를 고르는 것과 완전히 같은 동작(표를 그 라운드로 바로 조회)을
// 버튼 한 번으로 하게 해 준다. 드롭다운은 그대로 두고, 이건 빠른 길을 하나 더 두는
// 것뿐이다(2026-09-10 사용자 지정).
//
// 시즌당 라운드 수가 고정된 6대리그 — 20팀 리그는 38, 18팀 리그는 34. 이 값이 있는
// 리그는 실제로 그 라운드에 경기가 등록돼 있는지와 무관하게 항상 이 숫자만큼 버튼을
// 낸다(아직 일정이 안 올라온 늦은 라운드를 눌러도 빈 표가 뜨는 정도라 문제없다).
// 목록에 없는 리그(내 데이터의 K1/K2 등)는 그 시즌에 실제로 등록된 라운드 수를 써서
// 반으로 나눈다.
const FIXED_ROUND_COUNT = {
  EPL: 38, LALIGA: 38, SERIEA: 38,
  BUNDES: 34, EREDIVISIE: 34, LIGUE1: 34,
}

function roundNum(label) {
  const m = /\d+/.exec(String(label ?? ''))
  return m ? Number(m[0]) : 0
}

// 두 줄로 나눈다 — 홀수면 앞쪽(윗줄)이 한 개 더 많다(사용자 지정).
function splitRows(list) {
  const top = Math.ceil(list.length / 2)
  return [list.slice(0, top), list.slice(top)]
}

// 필터 아래 버튼 줄(.excel-bar)의 빈 공간(왼쪽)에 끼워 넣는다. 이 컴포넌트가
// LeaguePage.jsx에서 그 줄의 '첫 번째 자식'으로 들어가고, 기존 버튼들(.excel-bar-actions)
// 이 그다음에 오는 구조를 전제로 짰다 — 측정에 그 구조를 그대로 쓴다(아래 useEffect).
//
// 지켜야 하는 것 세 가지(사용자 지정):
//   ① 화면 왼쪽에 붙는다 — CSS의 margin-right:auto로, justify-content:flex-end인
//      .excel-bar 안에서도 이 요소만 왼쪽에 고정되고 나머지 버튼은 계속 오른쪽에 남는다.
//   ② 높이가 기존 버튼 줄(.btn-reset/.btn-search의 height:32px)을 넘지 않는다 — 2줄을
//      그 안에 넣어야 해서 버튼 한 줄을 아주 작게 만든다(RoundShortcutBar.css).
//   ③ 19개(또는 17개, 리그별 다름)가 한 줄에 다 못 들어가 줄바꿈이 일어나려는 순간부터
//      그룹 전체를 안 보여준다 — 고정 픽셀 기준이 아니라 실제로 넘치는지(필요한 너비 vs
//      남는 너비)를 매번 재서 판단한다(글자 크기 설정에 따라 버튼 폭이 달라져도 맞게
//      반응하도록).
//
// ③을 재려면 '이 요소가 없을 때 남는 공간'과 '이 내용이 실제로 필요로 하는 너비'를
// 이 요소 자신의 렌더링 여부와 상관없이 알아야 한다. 그래서 화면에 보이는 진짜 버튼
// 그룹과, 위치에 영향을 안 주는(position:absolute·position:fixed) 두 개의 '측정용'
// 요소를 따로 둔다 — 하나는 항상 떠 있는 기준점(.excel-bar 자신을 계속 관찰하기 위해),
// 하나는 화면 밖에 그려서 자연스러운 너비를 재는 그림자다.
export default function RoundShortcutBar({ code, query, filters, onJump }) {
  const anchorRef = useRef(null)
  const shadowRef = useRef(null)
  const [fits, setFits] = useState(false)

  const rounds = useMemo(() => {
    if (!query?.season || query.season === 'ALL') return []
    const fixed = FIXED_ROUND_COUNT[code]
    if (fixed) return Array.from({ length: fixed }, (_, i) => `${i + 1}R`)
    const list = (filters?.rounds_by_season?.[query.season] ?? []).filter(Boolean)
    return [...list].sort((a, b) => roundNum(a) - roundNum(b))
  }, [code, query?.season, filters])

  const [topRow, bottomRow] = useMemo(() => splitRows(rounds), [rounds])

  // RT(경기 결과)가 하나도 안 채워진 경기가 남아 있는 라운드 — 그 라운드 버튼은
  // 기본 색을 워닝(주의) 색으로 채운다(2026-09-10 사용자 지정). 취소(5)·연기(6)는
  // 이미 결과가 정리된 것이므로 "안 채워짐"이 아니다(백엔드 rounds_incomplete_by_season
  // 계산 기준, api/main.py의 league_filters 참고).
  const incompleteRounds = useMemo(() => {
    const list = filters?.rounds_incomplete_by_season?.[query?.season] ?? []
    return new Set(list)
  }, [filters, query?.season])

  useEffect(() => {
    if (!rounds.length) {
      setFits(false)
      return undefined
    }
    const measure = () => {
      const bar = anchorRef.current?.parentElement       // .excel-bar
      const shadow = shadowRef.current
      if (!bar || !shadow) return
      const actions = bar.querySelector('.excel-bar-actions')
      const needed = Math.max(
        shadow.children[0]?.scrollWidth || 0,
        shadow.children[1]?.scrollWidth || 0
      )
      // .excel-bar의 gap(8px, 6-1장 기본값) 하나만큼은 실제 버튼 그룹이 보일 때
      // 기존 버튼 묶음과의 사이에 추가로 들어가므로 남는 공간에서 미리 빼 둔다.
      const available = bar.clientWidth - (actions?.scrollWidth || 0) - 8
      setFits(available >= needed)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (anchorRef.current?.parentElement) ro.observe(anchorRef.current.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [rounds])

  if (!rounds.length) return null

  return (
    <>
      <span className="round-shortcut-anchor" ref={anchorRef} aria-hidden="true" />
      <span className="round-shortcut-shadow" ref={shadowRef} aria-hidden="true">
        <span className="round-shortcut-row">
          {topRow.map((r) => (
            <button key={r} type="button" className="round-shortcut-btn" tabIndex={-1}>
              {roundNum(r)}
            </button>
          ))}
        </span>
        <span className="round-shortcut-row">
          {bottomRow.map((r) => (
            <button key={r} type="button" className="round-shortcut-btn" tabIndex={-1}>
              {roundNum(r)}
            </button>
          ))}
        </span>
      </span>
      {fits && (
        <div className="round-shortcut-bar">
          {[topRow, bottomRow].map((row, i) => (
            <div className="round-shortcut-row" key={i}>
              {row.map((r) => {
                const active = query.round === r
                const warning = !active && incompleteRounds.has(r)
                return (
                  <button
                    key={r}
                    type="button"
                    className={`round-shortcut-btn${active ? ' is-active' : ''}${warning ? ' is-warning' : ''}`}
                    onClick={() => onJump(r)}
                    title={warning ? `${r}로 이동 — 아직 결과(RT) 미입력 경기 있음` : `${r}로 이동`}
                  >
                    {roundNum(r)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
