import { cloneElement, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildColumnGroups, formatCell, cellStyle, myHitStyle, myPickStyle, formStyle, bettingDayStyle,
  computeAutoVerdict, pickVerdictStyle, groupKey, splitIndicatorBatches, riskColClass, columnWidth,
  collapsedWidth, splitsOnFinal, oddsMoveDir, riskMoveDir, toFinalRow, rtToText,
} from './columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import RtBadge from '../RtBadge/RtBadge'
import StarButton, { nextStarLevel, starLevel } from '../StarButton/StarButton'
import { api } from '../../api/client'
import { useFontSize } from '../../context/FontSizeContext'
import './LeagueTable.css'

const VISIBLE_ROWS = 20
// 화면 위아래로 미리 그려둘 여유 행수. 스크롤할 때 빈 칸이 스치는 걸 막아준다.
const OVERSCAN = 10
// 아직 실제 행 높이를 재기 전에 쓸 근사값(px)
const DEFAULT_ROW_H = { small: 28, large: 31 }
// 폼(PPG) 칸 — 칸 전체가 아니라 값만 뱃지로 강조한다.
const FORM_COLS = new Set(['HTF', 'HF', 'AF', 'ATF'])

// 그룹 경계 구분선 클래스 — 국내배당/해외배당 사이는 두 "배당" 블록이 헷갈리기 쉬워
// 다른 경계보다 더 두껍게 강조한다(divider-strong, LeagueTable.css 참고).
function dividerClass(g, isLastGroup) {
  if (isLastGroup) return ''
  return g.label1 === '국내배당' ? ' group-divider divider-strong' : ' group-divider'
}


// 일반정보를 접어도 라운드(R)·시간(TM)은 각각 칸을 유지해서 둘 다 보여준다 — 다른
// 그룹은 접으면 칸 하나(···)로 뭉치지만, 조회 조건에 없는 라운드는 접힌 채로도
// 알아볼 수 있어야 한다. 이번주 리스트처럼 여러 리그를 한 표에 모아 보여줄 때는
// (row.L_LABEL이 붙어 올 때) 리그명 칸도 하나 더 유지한다 — 안 그러면 접힌 채로는
// 어느 리그 경기인지 구분이 안 된다.
function collapsedSpan(g, hasLeagueLabel) {
  if (g.label1 === '일반정보') return hasLeagueLabel ? 3 : 2
  // 경기정보를 접어도 순위·팀명·스코어·결과(HP/HT/HS/RT/AS/AT/AP)는 계속 보여준다 —
  // 접힌 채로도 어느 팀이 몇 위이고 결과가 어땠는지는 바로 알 수 있어야 한다.
  if (g.label1 === '경기정보') return 7
  return 1
}

// 경기정보 그룹의 col 목록에서 이 7개만, 이 순서대로 뽑는다.
const MATCH_INFO_COLLAPSED_KEYS = ['HP', 'HT', 'HS', 'RT', 'AS', 'AT', 'AP']
function matchInfoCollapsedCols(g) {
  return MATCH_INFO_COLLAPSED_KEYS.map((k) => g.cols.find((c) => c.key === k)).filter(Boolean)
}

function matchKey(row) {
  return `${row.S}|${row.R}|${row.No}|${row.HT}|${row.AT}`
}

// 선택 삭제(체크박스)용 행 식별 키. 이번주 픽처럼 여러 리그를 한 표에 모아 보여줄 때
// 쓰라고 L(리그 코드)·scope까지 포함한다 — 일반 리그 탭에서는 항상 같은 값이라 무해하다.
export function selectKey(row) {
  return `${row.L ?? ''}|${row.scope ?? ''}|${row.S}|${row.R}|${row.No}|${row.HT}|${row.AT}`
}

export default function LeagueTable({
  code, columns, rows, scope, highlightCols = [],
  selectable = false, selectedKeys, onToggleRow, hideIndicators = false,
  // 접기 상태·참고 팝업을 표 바깥(예: 조회 조건 줄)에서 같이 제어하고 싶을 때 쓴다.
  // 안 주면 이 컴포넌트가 내부 상태로 그대로 관리한다(기존 동작과 동일).
  collapsed: collapsedProp, onCollapsedChange,
  showRiskLegend: showRiskLegendProp, onShowRiskLegendChange,
  // true면 이 컴포넌트 자체의 해외지표/국내지표 접기·참고 버튼 줄을 그리지 않는다
  // (호출한 쪽이 같은 상태를 받아 자기 화면에 대신 그릴 때 쓴다).
  hideToolbar = false,
  // true면 높이 제한(20행)과 가상 스크롤을 끄고 받은 행을 전부 그린다.
  // 이번주 리스트처럼 표를 요일별로 잘게 쪼개 여러 개 세로로 늘어놓는 화면용 —
  // 표마다 안쪽 스크롤이 또 생기면 페이지 스크롤과 겹쳐 아주 쓰기 불편해진다.
  // 행이 수백~수천인 리그 표에서는 절대 켜지 말 것(가상 스크롤이 성능의 핵심).
  fitContent = false,
}) {
  // 이번주 픽처럼 여러 리그·스코프를 한 표에 모아 보여줄 때는 행마다 실제 소속
  // 리그(L)·스코프(scope)가 다를 수 있다 — LeagueTable에 준 code/scope prop은
  // 그런 표에서는 안 맞을 수 있으니, 행 자신에 값이 있으면 그걸 우선한다.
  // 주의: 일반 리그 표에도 원래부터 'L' 컬럼이 있는데(리그 약어 표시용, 코드가 아님)
  // 그건 코드로 쓰면 안 된다 — row.scope는 이번주 픽 집계에서만 붙는 값이라, 그게
  // 있을 때만("이 행은 여러 리그를 모은 표에서 왔다") row.L을 코드로 신뢰한다.
  const rowCode = (row) => (row?.scope ? row.L : null) || row?.Source_League || code
  const rowScope = (row) => row?.scope || scope
  const groups = useMemo(() => buildColumnGroups(columns || [], { hideIndicators }), [columns, hideIndicators])
  const [detailRow, setDetailRow] = useState(null)
  // 별표/내픽/메모 클릭 즉시 반영용 오버레이. 새로 조회하면(rows가 바뀌면) 서버가 다시
  // 내려준 최신값으로 자연히 대체되므로 초기화한다.
  // ref로도 같은 값을 들고 있는 이유: React state 갱신은 비동기라 "별표 클릭 직후 곧바로
  // 픽 선택"처럼 리렌더가 끼기 전에 연달아 저장하면 이전 변경을 못 보고 덮어쓸 수 있다.
  // ref는 즉시(동기) 최신값을 읽고 쓸 수 있어 이 경쟁 상태를 막아준다.
  const pickOverridesRef = useRef({})
  const [pickOverrides, setPickOverrides] = useState({})
  const [collapsedState, setCollapsedState] = useState(() => new Set(['일반정보', '경기정보', '지표']))
  const collapsed = collapsedProp ?? collapsedState
  const setCollapsed = onCollapsedChange ?? setCollapsedState
  const [showRiskLegendState, setShowRiskLegendState] = useState(false)
  const showRiskLegend = showRiskLegendProp ?? showRiskLegendState
  const setShowRiskLegend = onShowRiskLegendChange ?? setShowRiskLegendState
  const { fontSize } = useFontSize() // 'small' | 'large' — 상단바 토글로 전역 제어, 표 데이터 셀에만 적용
  const scrollRef = useRef(null)

  // ── 가상 스크롤 ──
  // 조회 결과가 500~2000행인데 전부 DOM에 그리면 셀이 수십만 개가 되어 화면이 수 초간
  // 멈춘다(실측: 500행 4초, 2000행 25초 이상). 실제로 보이는 구간만 그리고, 위아래는
  // 높이만 차지하는 빈 행으로 채워 스크롤 막대 길이와 위치를 그대로 유지한다.
  const [rowH, setRowH] = useState(0) // 0 = 아직 측정 전
  const [scrollTop, setScrollTop] = useState(0)

  const totalRows = rows ? rows.length : 0

  // ── 배변(배당변경) 두 줄 보기 ──
  // 경기마다 항상 두 줄(위=초기배당 · 아래=최종배당)로 그린다.
  // 최종배당을 아직 못 받아온 경기도 아랫줄을 빈칸으로 남긴다 — 줄 수가 조회 조건에
  // 따라 들쭉날쭉하면 같은 화면인데 표 모양이 계속 바뀌어 눈이 피로하고, "빈칸이다"
  // 자체가 "이 경기는 최종배당을 아직 안 받았다"는 정보이기도 하다.
  const splitRows = true
  // 가상 스크롤은 '경기 한 건'을 단위로 센다 — 두 줄로 그리면 한 건의 높이도 두 배다.
  const oneRowH = rowH || DEFAULT_ROW_H[fontSize] || DEFAULT_ROW_H.small
  const effRowH = oneRowH * (splitRows ? 2 : 1)
  const startIndex = fitContent ? 0 : Math.max(0, Math.floor(scrollTop / effRowH) - OVERSCAN)
  const endIndex = fitContent
    ? totalRows
    : Math.min(totalRows, startIndex + VISIBLE_ROWS + OVERSCAN * 2)
  const windowRows = rows ? rows.slice(startIndex, endIndex) : []
  const padTop = startIndex * effRowH
  const padBottom = Math.max(0, (totalRows - endIndex) * effRowH)

  // 이번주 리스트처럼 여러 리그를 한 표에 모아 보여줄 때만 L_LABEL이 붙어 온다
  // (LeagueTable.jsx 상단 rowCode/rowScope 주석 참고) — 그때만 일반정보를 접어도
  // 리그명 칸을 유지한다.
  const hasLeagueLabel = rows ? rows.some((r) => r.L_LABEL != null) : false

  // 접힌 그룹까지 반영한 실제 열 개수 (위아래 빈 행의 colSpan 용)
  const leafCount =
    (selectable ? 1 : 0) + 1 +
    groups.reduce((n, g) => n + (collapsed.has(groupKey(g)) ? collapsedSpan(g, hasLeagueLabel) : g.cols.length), 0)

  // 그려야 할 구간이 실제로 바뀔 때만 상태를 갱신한다.
  // (스크롤 이벤트마다 다시 그리면 오히려 버벅이므로, 시작 행이 달라질 때만 갱신)
  function handleScroll(e) {
    const nextTop = e.currentTarget.scrollTop
    setScrollTop((prev) => {
      const prevStart = Math.max(0, Math.floor(prev / effRowH) - OVERSCAN)
      const nextStart = Math.max(0, Math.floor(nextTop / effRowH) - OVERSCAN)
      return prevStart === nextStart ? prev : nextTop
    })
  }

  // 조회 결과가 바뀌면 맨 위부터 다시 본다
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    setScrollTop(0)
    pickOverridesRef.current = {}
    setPickOverrides({})
  }, [rows])

  function effectivePick(row) {
    const o = pickOverrides[matchKey(row)]
    return {
      important: o?.important ?? starLevel(row.IMPORTANT),
      pick: o?.pick !== undefined ? o.pick : row.MY_PICK || '',
      p: o?.p !== undefined ? o.p : row.MY_P || '',
      hit: o?.hit !== undefined ? o.hit : row.MY_HIT || '',
      memo: o?.memo !== undefined ? o.memo : row.MEMO || '',
      memoPre: o?.memoPre !== undefined ? o.memoPre : row.MEMO_PRE || '',
      reasonTag: o?.reasonTag !== undefined ? o.reasonTag : row.REASON_TAG || '',
    }
  }

  // 별표/내픽/P태그/적중여부/메모(경기전·결과반성)/결과반성태그 공용 저장 — patch에
  // 준 필드만 바꾸고 나머지는 현재 값을 유지한 채 전체 상태를 다시 올린다(서버는
  // 매번 값을 다 받아 upsert).
  async function savePick(row, patch) {
    const key = matchKey(row)
    const prevValue = pickOverridesRef.current[key] ?? {
      important: starLevel(row.IMPORTANT),
      pick: row.MY_PICK || '',
      p: row.MY_P || '',
      hit: row.MY_HIT || '',
      memo: row.MEMO || '',
      memoPre: row.MEMO_PRE || '',
      reasonTag: row.REASON_TAG || '',
    }
    const next = { ...prevValue, ...patch }
    pickOverridesRef.current = { ...pickOverridesRef.current, [key]: next }
    setPickOverrides(pickOverridesRef.current)
    try {
      await api.post(`/api/leagues/${rowCode(row)}/my_picks`, {
        scope: rowScope(row),
        S: row.S,
        R: row.R,
        No: row.No,
        HT: row.HT,
        AT: row.AT,
        starred: next.important,
        pick: next.pick || null,
        p: next.p || null,
        hit: next.hit || null,
        memo: next.memo || null,
        memo_pre: next.memoPre || null,
        reason_tag: next.reasonTag || null,
      })
    } catch {
      // 저장 실패 시 원래 상태로 되돌린다
      pickOverridesRef.current = { ...pickOverridesRef.current, [key]: prevValue }
      setPickOverrides(pickOverridesRef.current)
    }
  }

  // 화면에는 항상 딱 20행만 보이게 높이를 고정하고, 그 이상은 표 내부 스크롤로 본다.
  // 헤더 2줄 + 실제 데이터 행 높이(글씨 크기에 따라 달라짐)를 직접 측정해서 계산한다.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const thead = el.querySelector('thead')
    const headerRow1 = el.querySelector('thead tr:first-child')
    const firstRow = el.querySelector('tbody tr[data-row]')
    if (!thead || !firstRow) return
    const h = firstRow.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - rowH) > 0.5) setRowH(h)
    if (fitContent) {
      // 높이 제한을 아예 풀어 행을 전부 보여준다(표 안쪽 세로 스크롤 없음).
      el.style.maxHeight = 'none'
    } else if (h > 0) {
      // box-sizing: border-box(전역 리셋)라 max-height가 테두리까지 포함해서 계산된다.
      // 테두리 두께를 안 더해주면 딱 20행(10경기)일 때 내용물이 테두리만큼(1~2px) 더 커서
      // 스크롤바가 미세하게 생겼다 — 테두리 두께를 더해 실제 내용 높이와 맞춘다.
      const borderV = el.getBoundingClientRect().height - el.clientHeight
      el.style.maxHeight = `${thead.getBoundingClientRect().height + h * VISIBLE_ROWS + borderV}px`
    }
    // 헤더 1번째 줄(그룹명) 높이를 재서 2번째 줄(L/S/R 등)이 스크롤 중 붙는 위치로 쓴다.
    // CSS에 숫자를 고정해두면 실제 높이와 어긋나 돋보기·체크박스 칸(rowSpan)의 아래
    // 경계선과 2번째 줄의 경계선이 다른 높이에 생겨 계단처럼 보인다.
    if (headerRow1) {
      const row1H = headerRow1.getBoundingClientRect().height
      if (row1H > 0) el.style.setProperty('--header-row1-h', `${row1H}px`)
    }
  }, [rows, fontSize, rowH, collapsed, fitContent])

  function toggleGroup(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const { batch1Groups, batch2Groups } = splitIndicatorBatches(groups)

  function toggleBatch(batchGroups) {
    const keys = batchGroups.map(groupKey)
    const allCollapsed = keys.length > 0 && keys.every((k) => collapsed.has(k))
    setCollapsed((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => (allCollapsed ? next.delete(k) : next.add(k)))
      return next
    })
  }

  if (!rows || rows.length === 0) {
    return <p className="table-empty">표시할 경기가 없습니다.</p>
  }

  return (
    <div>
      {!hideToolbar && (batch1Groups.length > 0 || batch2Groups.length > 0) && (
        <div className="batch-fold-bar">
          {batch1Groups.length > 0 && (
            <button className="batch-fold-btn" onClick={() => toggleBatch(batch1Groups)}>
              해외지표 {batch1Groups.every((g) => collapsed.has(groupKey(g))) ? '펼치기' : '접기'}
            </button>
          )}
          {batch2Groups.length > 0 && (
            <button className="batch-fold-btn" onClick={() => toggleBatch(batch2Groups)}>
              국내지표 {batch2Groups.every((g) => collapsed.has(groupKey(g))) ? '펼치기' : '접기'}
            </button>
          )}
          <button className="batch-fold-btn" onClick={() => setShowRiskLegend(true)} title="색상별 구간 참고표">
            플핸무 확률 참고
          </button>
        </div>
      )}
      <div className="league-table-scroll" ref={scrollRef} onScroll={handleScroll}>
        <table className={`league-table ${fontSize === 'large' ? 'font-large' : ''}`}>
          <thead>
            <tr>
              {selectable && <th className="select-col sticky-col" rowSpan={2}></th>}
              {groups.flatMap((g, gi) => {
                const key = groupKey(g)
                const isCollapsed = collapsed.has(key)
                const isLastGroup = gi === groups.length - 1
                const dividerCls = dividerClass(g, isLastGroup)
                let th
                if (isCollapsed) {
                  th = (
                    <th key={gi} colSpan={collapsedSpan(g, hasLeagueLabel)} className={`group-header group-collapsed${dividerCls}`}>
                      <button
                        className="fold-btn fold-btn-collapsed"
                        onClick={() => toggleGroup(key)}
                        title={`펼치기: ${g.label1}`}
                      >
                        ▸
                      </button>
                    </th>
                  )
                } else {
                  th = (
                    <th key={gi} colSpan={g.cols.length} className={`group-header${dividerCls}`}>
                      <div className="group-header-row">
                        <div className="group-text">
                          <div className="group-title">{g.label1}</div>
                          <div className="group-subtitle">{g.label2}</div>
                        </div>
                        <button
                          className="fold-btn fold-btn-expanded"
                          onClick={() => toggleGroup(key)}
                          title="접기"
                        >
                          ◂
                        </button>
                      </div>
                    </th>
                  )
                }
                return [th]
              })}
            </tr>
            <tr>
              {groups.flatMap((g, gi) => {
                const key = groupKey(g)
                const isLastGroup = gi === groups.length - 1
                if (collapsed.has(key)) {
                  if (g.label1 === '일반정보') {
                    return [
                      ...(hasLeagueLabel
                        ? [
                            <th key={`${gi}-l`} className="sub-header collapsed-cell" style={{ width: collapsedWidth('리그') }}>
                              리그
                            </th>,
                          ]
                        : []),
                      <th key={`${gi}-r`} className="sub-header collapsed-cell" style={{ width: collapsedWidth('R') }}>
                        R
                      </th>,
                      <th
                        key={`${gi}-tm`}
                        className={`sub-header collapsed-cell${dividerClass(g, isLastGroup)}`}
                        style={{ width: collapsedWidth('TM') }}
                      >
                        TM
                      </th>,
                    ]
                  }
                  if (g.label1 === '경기정보') {
                    const matchCols = matchInfoCollapsedCols(g)
                    return matchCols.map((c, ci) => (
                      <th
                        key={`${gi}-${c.key}`}
                        className={`sub-header collapsed-cell${
                          ci === matchCols.length - 1 ? dividerClass(g, isLastGroup) : ''
                        }`}
                        style={{ width: columnWidth(g, c) }}
                      >
                        {c.sub}
                      </th>
                    ))
                  }
                  // '지표'는 원래 칸이 하나뿐이라 접어도 숨겨지는 게 없다 — '···'
                  // 대신 컬럼명을 그대로 두어 접힌 채로도 무슨 칸인지 알 수 있게 한다.
                  if (g.label1 === '지표') {
                    return [
                      <th
                        key={`${gi}-c`}
                        className={`sub-header collapsed-cell${dividerClass(g, isLastGroup)}`}
                        style={{ width: columnWidth(g, g.cols[0]) }}
                      >
                        {g.cols[0].sub}
                      </th>,
                    ]
                  }
                  return [
                    <th
                      key={`${gi}-c`}
                      className={`sub-header collapsed-cell${dividerClass(g, isLastGroup)}`}
                      style={{ width: collapsedWidth(null) }}
                    >
                      ···
                    </th>,
                  ]
                }
                return g.cols.map((c, ci) => {
                  const isLastCol = !isLastGroup && ci === g.cols.length - 1
                  const width = columnWidth(g, c)
                  return (
                    <th
                      key={`${gi}-${ci}`}
                      className={`sub-header ${highlightCols.includes(c.key) ? 'col-highlight' : ''}${
                        isLastCol ? dividerClass(g, isLastGroup) : ''
                      }${riskColClass(g, c)}`}
                      style={width ? { width } : undefined}
                    >
                      {c.sub}
                    </th>
                  )
                })
              })}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td className="spacer-cell" colSpan={leafCount} style={{ height: padTop }} />
              </tr>
            )}
            {windowRows.map((row, i) => {
              const ri = startIndex + i
              const pickState = effectivePick(row)
              // 전체 조회처럼 여러 라운드가 한 표에 섞여 있을 때 라운드가 바뀌는
              // 지점을 굵은 선으로 구분한다(직전 행과 시즌·라운드가 다르면 경계).
              // 이번주 픽처럼 여러 리그가 섞일 때는 리그가 바뀌어도 시즌·라운드
              // 문자열(예: 26-27·1R)이 같을 수 있어 L도 같이 비교한다.
              const prevRow = ri > 0 ? rows[ri - 1] : null
              const isRoundStart = prevRow && (prevRow.S !== row.S || prevRow.R !== row.R || prevRow.L !== row.L)
              const rowClass = [
                pickState.important === 2 ? 'row-starred' : '',
                pickState.important === 1 ? 'row-star-half' : '',
                isRoundStart ? 'round-start' : '',
              ].filter(Boolean).join(' ')

              // 아랫줄에 쓸 행 — 갈라지는 칸만 최종배당 값으로 바꿔 끼운 사본.
              const finalRow = splitRows ? toFinalRow(row) : null

              // 한 경기치 셀을 만든다. isFinal=false면 윗줄(초기배당), true면 아랫줄(최종배당).
              //   · 값이 갈리는 칸(FINAL_FIELD)   → 두 줄 모두 그린다
              //   · 값이 하나뿐인 칸(경기정보 등) → 윗줄에서 rowSpan=2로 합치고 아랫줄은 안 그린다
              // 셀을 만드는 코드는 그대로 두고, 만들어진 셀에 컬럼 이름을 붙여 fit()이
              // 한 자리에서 판단한다 — 그래야 기존 서식·색상 규칙이 흔들리지 않는다.
              const baseRow = row      // 배변 여부는 항상 원본(초기+최종이 다 있는) 행으로 본다
              const renderCells = (srcRow, isFinal) => {
                const fit = (cell, colKey) => {
                  const splits = splitRows && splitsOnFinal(colKey)
                  // 배변이 일어난 배당 칸은 두 줄 모두 옅은 배경으로 표시해, 위아래를
                  // 눈으로 짚어 가며 비교하지 않아도 "여기가 움직였다"가 바로 보이게 한다.
                  // 아랫줄(최종)에는 방향 화살표까지 붙인다 — 와이즈토토·Bet365와 같은
                  // 규칙으로 배당이 오르면 빨강 ↑, 내리면 파랑 ↓. 내려간 쪽이 돈이 몰린 쪽이다.
                  // 확률 지표(정승%·플핸무%·플%)는 오르내림에 좋다/나쁘다가 없어서
                  // 색 구분 없이 흰색 ▲▼로 표시한다(riskMoveDir — 상세보기 팝업
                  // MatchDetailModal.jsx RiskCard와 같은 규칙).
                  const dir = splits ? oddsMoveDir(baseRow, colKey) : 0
                  const riskDir = splits ? riskMoveDir(baseRow, colKey) : 0
                  const mark = (c, withArrow) => {
                    if (!dir && !riskDir) return c
                    const cls = [c.props.className, 'odds-moved'].filter(Boolean).join(' ')
                    if (!withArrow) return cloneElement(c, { className: cls })
                    const arrowNode = dir
                      ? <span key="arw" className={`odds-arrow ${dir > 0 ? 'up' : 'down'}`}>{dir > 0 ? '↑' : '↓'}</span>
                      : <span key="arw" className="risk-arrow">{riskDir > 0 ? '▲' : '▼'}</span>
                    return cloneElement(c, { className: cls }, c.props.children, arrowNode)
                  }
                  if (isFinal) return splits ? mark(cell, true) : null
                  if (!splitRows) return cell
                  if (splits) return mark(cell, false)
                  return cloneElement(cell, { rowSpan: 2 })
                }
                const row = srcRow      // 아래 기존 코드가 row를 그대로 읽는다
                return [
                  ...(selectable
                    ? [fit(
                        <td key="sel" className="select-col sticky-col">
                          <input
                            type="checkbox"
                            checked={selectedKeys?.has(selectKey(row)) ?? false}
                            onChange={() => onToggleRow?.(row)}
                          />
                        </td>, '__merge')]
                    : []),
                  ...groups.flatMap((g, gi) => {
                    const key = groupKey(g)
                    const isLastGroup = gi === groups.length - 1
                    // cells와 짝을 이루는 컬럼 이름 — fit()이 이 이름으로 합칠지 나눌지 정한다.
                    // '__merge'는 "배당과 무관해서 위아래를 항상 합치는 칸"이라는 뜻.
                    let cells
                    let cellKeys
                    if (collapsed.has(key)) {
                      // 일반정보를 접어도 금/토/일 베팅일 색상 + 라운드/시간은 계속 보여야
                      // 한다 — 접힌 채로도 몇 라운드 몇 시 경기인지 바로 알 수 있게.
                      const isGenInfo = g.label1 === '일반정보'
                      // 경기정보를 접어도 팀명·순위(HP/HT/AT/AP)는 계속 보여준다.
                      const isMatchInfo = g.label1 === '경기정보'
                      // 똥배를 접어도 똥1/똥2 순번은 계속 보여야 한다 — 그게 이 그룹의
                      // 핵심 정보라 접혀서 안 보이면 의미가 없다.
                      const isDdong = g.label1 === '똥배'
                      const style = isGenInfo ? bettingDayStyle(row) : null
                      if (isMatchInfo) {
                        const matchCols = matchInfoCollapsedCols(g)
                        cells = matchCols.map((c, ci) => {
                          const value = row[c.key]
                          const isLastCol = ci === matchCols.length - 1
                          const className = `collapsed-cell${isLastCol ? dividerClass(g, isLastGroup) : ''}`
                          const text = formatCell(g, c, value, row)
                          // RT는 펼쳤을 때처럼 칸 전체가 아니라 알약 배지로 보여준다(cell-badge).
                          // 예전 돋보기 버튼을 없앤 대신, 이 칸(값이 없는 예정 경기의 빈칸
                          // 포함)을 누르면 상세보기가 열린다.
                          if (c.key === 'RT') {
                            const badgeStyle = cellStyle(g, c, value, row)
                            // 결과반성 = 메모 글이나 결과반성 태그 드롭박스, 둘 중 하나만
                            // 골라도 '썼다'로 본다 — 태그만 고르고 글은 안 쓴 경우도 흔하다.
                            const hasMemo = !!(pickState.memo?.trim() || pickState.reasonTag)
                            return (
                              <td
                                key={`${gi}-${c.key}`}
                                className={`${className} rt-detail-cell`}
                                title={hasMemo ? '상세 경기 정보 (결과반성 작성됨)' : '상세 경기 정보'}
                                onClick={() => setDetailRow(row)}
                              >
                                {badgeStyle ? (
                                  <span className={`cell-badge${hasMemo ? ' cell-badge-memo' : ''}`} style={badgeStyle}>
                                    {text}
                                  </span>
                                ) : (
                                  text
                                )}
                              </td>
                            )
                          }
                          return (
                            <td key={`${gi}-${c.key}`} className={className} style={cellStyle(g, c, value, row) || undefined}>
                              {text}
                            </td>
                          )
                        })
                        cellKeys = matchCols.map(() => '__merge')
                      } else if (isGenInfo) {
                        cells = [
                          ...(hasLeagueLabel
                            ? [
                                <td key={`${gi}-l`} className="collapsed-cell">
                                  {row.L_LABEL ?? row.L ?? ''}
                                </td>,
                              ]
                            : []),
                          <td key={`${gi}-r`} className="collapsed-cell">
                            {row.R ?? ''}
                          </td>,
                          <td
                            key={`${gi}-tm`}
                            className={`collapsed-cell${dividerClass(g, isLastGroup)}`}
                            style={style || undefined}
                          >
                            {formatCell(g, { sub: 'TM' }, row.TM)}
                          </td>,
                        ]
                        cellKeys = hasLeagueLabel
                          ? ['__merge', '__merge', '__merge']
                          : ['__merge', '__merge']
                      } else if (g.label1 === '지표') {
                        // 지표는 칸이 하나뿐이라 접어도 펼친 것과 똑같이 그린다 —
                        // 값(강/약)과 칩 색까지 그대로 살린다.
                        const c0 = g.cols[0]
                        cells = [
                          <td
                            key={`${gi}-c`}
                            className={`collapsed-cell${dividerClass(g, isLastGroup)}`}
                            style={cellStyle(g, c0, row[c0.key], row) || undefined}
                          >
                            {formatCell(g, c0, row[c0.key], row)}
                          </td>,
                        ]
                        cellKeys = ['__merge']
                      } else {
                        cells = [
                          <td key={`${gi}-c`} className={`collapsed-cell${dividerClass(g, isLastGroup)}`}>
                            {isDdong ? row.DDONG || '·' : '·'}
                          </td>,
                        ]
                        // 접힌 똥배 칸은 똥배 순번을 보여주므로 최종배당 기준으로 달라진다.
                        cellKeys = [isDdong ? 'DDONG' : '__merge']
                      }
                    } else if (g.kind === 'mypick') {
                      cellKeys = g.cols.map(() => '__merge')   // 내 예측은 경기당 하나뿐
                      cells = g.cols.map((c, ci) => {
                        const isLastCol = !isLastGroup && ci === g.cols.length - 1
                        const className = isLastCol ? 'group-divider' : undefined
                        if (c.key === 'IMPORTANT') {
                          return (
                            <td key={`${gi}-${ci}`} className={className}>
                              <StarButton
                                level={pickState.important}
                                onClick={() => savePick(row, { important: nextStarLevel(pickState.important) })}
                              />
                            </td>
                          )
                        }
                        if (c.key === 'PICK_VERDICT') {
                          const verdict = computeAutoVerdict(pickState.pick, row.RT)
                          const badgeStyle = pickVerdictStyle(verdict)
                          return (
                            <td key={`${gi}-${ci}`} className={className}>
                              {verdict ? (
                                <span className="cell-badge" style={badgeStyle}>
                                  {verdict}
                                </span>
                              ) : (
                                <span className="mypick-blank">－</span>
                              )}
                            </td>
                          )
                        }
                        if (c.key === 'MY_P') {
                          return (
                            <td key={`${gi}-${ci}`} className={className}>
                              <button className="mypick-btn" onClick={() => setDetailRow(row)}>
                                {pickState.p ? (
                                  <RtBadge label={pickState.p} matched={pickState.p === rtToText(row.RT)} />
                                ) : (
                                  <span className="mypick-blank">－</span>
                                )}
                              </button>
                            </td>
                          )
                        }
                        if (c.key === 'MY_HIT') {
                          return (
                            <td key={`${gi}-${ci}`} className={className}>
                              <button
                                className="mypick-btn"
                                style={myHitStyle(pickState.hit) || undefined}
                                onClick={() => setDetailRow(row)}
                              >
                                {pickState.hit || <span className="mypick-blank">－</span>}
                              </button>
                            </td>
                          )
                        }
                        // MY_PICK — 뱃지가 아니라 칸 전체 배경으로 정배/플핸 쪽을 구분한다.
                        return (
                          <td
                            key={`${gi}-${ci}`}
                            className={className}
                            style={myPickStyle(pickState.pick) || undefined}
                          >
                            <button className="mypick-btn" onClick={() => setDetailRow(row)}>
                              {pickState.pick || <span className="mypick-blank">－</span>}
                            </button>
                          </td>
                        )
                      })
                    } else {
                      cellKeys = g.cols.map((c) => c.key)
                      cells = g.cols.map((c, ci) => {
                      // L(리그) 칸은 내부 매칭용 코드(ul_2 등)가 아니라 사용자가 지은 리그명을 보여준다
                      // (이번주 픽처럼 여러 스코프 리그를 한 표에 모아 보여줄 때만 L_LABEL이 붙어 온다).
                      const value = c.key === 'L' && row.L_LABEL != null ? row.L_LABEL : row[c.key]
                      const isHighlighted = highlightCols.includes(c.key)
                      const isLastCol = !isLastGroup && ci === g.cols.length - 1
                      // 별표(중요) 행의 금색 배경은 배당 칸까지 덮으면 배당 적중·배변 화살표
                      // 배경(oddsHitSide 등)이 묻혀 안 보인다 — 국내배당/해외배당 칸만 빼둔다.
                      const isOddsGroup = g.label1 === '국내배당' || g.label1 === '해외배당'
                      const classNames = [
                        isHighlighted ? 'cell-highlight' : '',
                        isLastCol ? dividerClass(g, isLastGroup).trim() : '',
                        riskColClass(g, c).trim(),
                        isOddsGroup ? 'odds-group-cell' : '',
                      ].filter(Boolean).join(' ')
                      const text = formatCell(g, c, value, row)
                      // 폼(PPG) 칸 — 상세보기 팝업의 폼 지표와 같은 스타일로, 뱃지가 아니라
                      // 칸 전체를 배경색으로 칠한다.
                      if (g.label1 === '경기정보' && FORM_COLS.has(c.key)) {
                        return (
                          <td key={`${gi}-${ci}`} className={classNames || undefined} style={formStyle(value) || undefined}>
                            {text}
                          </td>
                        )
                      }
                      // RT(핸승/핸무/무/역) 칸도 칸 전체가 아니라 값만 알약 모양 뱃지로 보여준다.
                      // 예전 돋보기 버튼을 없앤 대신, 이 칸(값이 없는 예정 경기의 빈칸
                      // 포함)을 누르면 상세보기가 열린다.
                      if (g.label1 === '경기정보' && c.key === 'RT') {
                        const badgeStyle = cellStyle(g, c, value, row)
                        // 결과반성 = 메모 글이나 결과반성 태그 드롭박스, 둘 중 하나만
                        // 골라도 '썼다'로 본다 — 태그만 고르고 글은 안 쓴 경우도 흔하다.
                        const hasMemo = !!(pickState.memo?.trim() || pickState.reasonTag)
                        return (
                          <td
                            key={`${gi}-${ci}`}
                            className={`${classNames || ''} rt-detail-cell`.trim()}
                            title={hasMemo ? '상세 경기 정보 (결과반성 작성됨)' : '상세 경기 정보'}
                            onClick={() => setDetailRow(row)}
                          >
                            {badgeStyle ? (
                              <span className={`cell-badge${hasMemo ? ' cell-badge-memo' : ''}`} style={badgeStyle}>
                                {text}
                              </span>
                            ) : (
                              text
                            )}
                          </td>
                        )
                      }
                      const style = cellStyle(g, c, value, row)
                      return (
                        <td
                          key={`${gi}-${ci}`}
                          className={classNames || undefined}
                          style={style || undefined}
                        >
                          {text}
                        </td>
                      )
                      })
                    }
                    // 아랫줄에서 빠지는 칸은 null이 되므로 걸러낸다.
                    return cells.map((cell, ci) => fit(cell, cellKeys[ci])).filter(Boolean)
                  }),
                ]
              }

              return (
                <Fragment key={ri}>
                  <tr data-row="" className={rowClass || undefined}>
                    {renderCells(row, false)}
                  </tr>
                  {splitRows && (
                    <tr
                      data-row-final=""
                      className={['row-final', rowClass].filter(Boolean).join(' ')}
                    >
                      {renderCells(finalRow, true)}
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td className="spacer-cell" colSpan={leafCount} style={{ height: padBottom }} />
              </tr>
            )}
          </tbody>
        </table>

        {detailRow && (
          <MatchDetailModal
            code={rowCode(detailRow)}
            row={{
              ...detailRow,
              IMPORTANT: effectivePick(detailRow).important,
              MY_PICK: effectivePick(detailRow).pick,
              MY_P: effectivePick(detailRow).p,
              MY_HIT: effectivePick(detailRow).hit,
              MEMO: effectivePick(detailRow).memo,
              MEMO_PRE: effectivePick(detailRow).memoPre,
              REASON_TAG: effectivePick(detailRow).reasonTag,
            }}
            scope={rowScope(detailRow)}
            onClose={() => setDetailRow(null)}
            onSavePick={(patch) => savePick(detailRow, patch)}
          />
        )}

        {!hideToolbar && showRiskLegend && <RiskLegendModal onClose={() => setShowRiskLegend(false)} />}
      </div>
    </div>
  )
}

// 색 규칙은 한 문장이다: "초록이면 플핸에 유리".
// 정승만 낮을수록 초록이고, 플핸무·플은 높을수록 초록이다.
// 묶음마다 값의 분포가 완전히 달라 경계도 따로 잡았다 — columnGroups.js cellStyle과 일치.
const RISK_LEGEND = [
  {
    title: '정승 % — 국)정 · 해)정 (정배가 그냥 이길 확률, 낮을수록 좋음)',
    bands: [
      { label: '양호', range: '~40%', bg: '#66BB6A', color: '#0D1B2A' },
      { label: '보통', range: '40~55%', bg: '#FBC02D', color: '#0D1B2A' },
      { label: '주의', range: '55~70%', bg: '#EF6C00', color: '#fff' },
      { label: '위험', range: '70%~', bg: '#C62828', color: '#fff' },
    ],
  },
  {
    title: '플핸무 % — 국)플 · 국)지 · 해)지 (핸승이 아닐 확률, 높을수록 좋음)',
    bands: [
      { label: '안전', range: '85%~', bg: '#1B5E20', color: '#fff' },
      { label: '양호', range: '75~85%', bg: '#66BB6A', color: '#0D1B2A' },
      { label: '보통', range: '65~75%', bg: '#FBC02D', color: '#0D1B2A' },
      { label: '주의', range: '55~65%', bg: '#EF6C00', color: '#fff' },
      { label: '위험', range: '~55%', bg: '#C62828', color: '#fff' },
    ],
  },
  {
    title: '플 % — 국)플 · 국)지 · 해)지 (무 또는 역, 높을수록 좋음)',
    bands: [
      { label: '안전', range: '55%~', bg: '#1B5E20', color: '#fff' },
      { label: '양호', range: '48~55%', bg: '#66BB6A', color: '#0D1B2A' },
      { label: '보통', range: '41~48%', bg: '#FBC02D', color: '#0D1B2A' },
      { label: '주의', range: '34~41%', bg: '#EF6C00', color: '#fff' },
      { label: '위험', range: '~34%', bg: '#C62828', color: '#fff' },
    ],
  },
]

export function RiskLegendModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card risk-legend-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <h2 className="modal-title">📖 확률 칸 색상 참고표</h2>
        <p className="modal-meta">
          6대리그 실측 기준입니다. 세 묶음 모두 색이 뜻하는 바는 같아서{' '}
          <b>초록이면 플핸에 유리</b>합니다. 칸 이름은 앞글자가 어느 시장에서 나온
          값인지(국=국내, 해=해외), 뒷글자가 무엇으로 계산했는지(정=승무패 배당, 플=핸디
          배당, 지=26개 지표)를 뜻합니다. 플핸무에서 플을 빼면 핸무 확률이 나오며 대개
          23~24%입니다.
        </p>

        {RISK_LEGEND.map((g) => (
          <div key={g.title}>
            <p className="risk-legend-group-title">{g.title}</p>
            <table className="detail-table risk-legend-table">
              <tbody>
                <tr>
                  {g.bands.map((b) => (
                    <td key={b.label} style={{ background: b.bg, color: b.color, fontWeight: 700 }}>
                      {b.label}
                      <br />
                      {b.range}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
