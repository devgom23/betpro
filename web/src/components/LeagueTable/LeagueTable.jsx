import { useEffect, useMemo, useRef, useState } from 'react'
import { buildColumnGroups, formatCell, cellStyle, myHitStyle } from './columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import MyPickModal from '../MyPickModal/MyPickModal'
import { api } from '../../api/client'
import { useFontSize } from '../../context/FontSizeContext'
import './LeagueTable.css'

const VISIBLE_ROWS = 20
// 화면 위아래로 미리 그려둘 여유 행수. 스크롤할 때 빈 칸이 스치는 걸 막아준다.
const OVERSCAN = 10
// 아직 실제 행 높이를 재기 전에 쓸 근사값(px)
const DEFAULT_ROW_H = { small: 28, large: 31 }

function groupKey(g) {
  return g.label1
}

function matchKey(row) {
  return `${row.S}|${row.R}|${row.No}|${row.HT}|${row.AT}`
}

function isStarred(v) {
  return v === true || v === 1 || v === '1'
}

// 선택 삭제(체크박스)용 행 식별 키. 이번주 픽처럼 여러 리그를 한 표에 모아 보여줄 때
// 쓰라고 L(리그 코드)·scope까지 포함한다 — 일반 리그 탭에서는 항상 같은 값이라 무해하다.
export function selectKey(row) {
  return `${row.L ?? ''}|${row.scope ?? ''}|${row.S}|${row.R}|${row.No}|${row.HT}|${row.AT}`
}

export default function LeagueTable({
  code, columns, rows, scope, highlightCols = [],
  selectable = false, selectedKeys, onToggleRow, hideIndicators = false,
}) {
  const groups = useMemo(() => buildColumnGroups(columns || [], { hideIndicators }), [columns, hideIndicators])
  const [detailRow, setDetailRow] = useState(null)
  const [pickRow, setPickRow] = useState(null) // 내픽 팝업 대상 행
  // 별표/내픽/메모 클릭 즉시 반영용 오버레이. 새로 조회하면(rows가 바뀌면) 서버가 다시
  // 내려준 최신값으로 자연히 대체되므로 초기화한다.
  // ref로도 같은 값을 들고 있는 이유: React state 갱신은 비동기라 "별표 클릭 직후 곧바로
  // 픽 선택"처럼 리렌더가 끼기 전에 연달아 저장하면 이전 변경을 못 보고 덮어쓸 수 있다.
  // ref는 즉시(동기) 최신값을 읽고 쓸 수 있어 이 경쟁 상태를 막아준다.
  const pickOverridesRef = useRef({})
  const [pickOverrides, setPickOverrides] = useState({})
  const [collapsed, setCollapsed] = useState(() => new Set())
  const { fontSize } = useFontSize() // 'small' | 'large' — 상단바 토글로 전역 제어, 표 데이터 셀에만 적용
  const scrollRef = useRef(null)

  // ── 가상 스크롤 ──
  // 조회 결과가 500~2000행인데 전부 DOM에 그리면 셀이 수십만 개가 되어 화면이 수 초간
  // 멈춘다(실측: 500행 4초, 2000행 25초 이상). 실제로 보이는 구간만 그리고, 위아래는
  // 높이만 차지하는 빈 행으로 채워 스크롤 막대 길이와 위치를 그대로 유지한다.
  const [rowH, setRowH] = useState(0) // 0 = 아직 측정 전
  const [scrollTop, setScrollTop] = useState(0)

  const totalRows = rows ? rows.length : 0
  const effRowH = rowH || DEFAULT_ROW_H[fontSize] || DEFAULT_ROW_H.small
  const startIndex = Math.max(0, Math.floor(scrollTop / effRowH) - OVERSCAN)
  const endIndex = Math.min(totalRows, startIndex + VISIBLE_ROWS + OVERSCAN * 2)
  const windowRows = rows ? rows.slice(startIndex, endIndex) : []
  const padTop = startIndex * effRowH
  const padBottom = Math.max(0, (totalRows - endIndex) * effRowH)

  // 접힌 그룹까지 반영한 실제 열 개수 (위아래 빈 행의 colSpan 용)
  const leafCount =
    (selectable ? 1 : 0) + 1 +
    groups.reduce((n, g) => n + (collapsed.has(groupKey(g)) ? 1 : g.cols.length), 0)

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
      important: o?.important ?? isStarred(row.IMPORTANT),
      pick: o?.pick !== undefined ? o.pick : row.MY_PICK || '',
      hit: o?.hit !== undefined ? o.hit : row.MY_HIT || '',
      memo: o?.memo !== undefined ? o.memo : row.MEMO || '',
    }
  }

  // 별표/내픽/적중여부/메모 공용 저장 — patch에 준 필드만 바꾸고 나머지는 현재 값을 유지한 채
  // 전체 상태를 다시 올린다(서버는 매번 값을 다 받아 upsert).
  async function savePick(row, patch) {
    const key = matchKey(row)
    const prevValue = pickOverridesRef.current[key] ?? {
      important: isStarred(row.IMPORTANT),
      pick: row.MY_PICK || '',
      hit: row.MY_HIT || '',
      memo: row.MEMO || '',
    }
    const next = { ...prevValue, ...patch }
    pickOverridesRef.current = { ...pickOverridesRef.current, [key]: next }
    setPickOverrides(pickOverridesRef.current)
    try {
      await api.post(`/api/leagues/${code}/my_picks`, {
        scope,
        S: row.S,
        R: row.R,
        No: row.No,
        HT: row.HT,
        AT: row.AT,
        starred: next.important,
        pick: next.pick || null,
        hit: next.hit || null,
        memo: next.memo || null,
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
    const firstRow = el.querySelector('tbody tr[data-row]')
    if (!thead || !firstRow) return
    const h = firstRow.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - rowH) > 0.5) setRowH(h)
    if (h > 0) {
      el.style.maxHeight = `${thead.getBoundingClientRect().height + h * VISIBLE_ROWS}px`
    }
  }, [rows, fontSize, rowH, collapsed])

  function toggleGroup(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!rows || rows.length === 0) {
    return <p className="table-empty">표시할 경기가 없습니다.</p>
  }

  return (
    <div>
      <div className="league-table-scroll" ref={scrollRef} onScroll={handleScroll}>
        <table className={`league-table ${fontSize === 'large' ? 'font-large' : ''}`}>
          <thead>
            <tr>
              {selectable && <th className="select-col sticky-col" rowSpan={2}></th>}
              <th className={`detail-col sticky-col${selectable ? ' sticky-col-2' : ''}`} rowSpan={2}></th>
              {groups.map((g, gi) => {
                const key = groupKey(g)
                const isCollapsed = collapsed.has(key)
                const isLastGroup = gi === groups.length - 1
                const dividerClass = isLastGroup ? '' : ' group-divider'
                if (isCollapsed) {
                  return (
                    <th key={gi} colSpan={1} className={`group-header group-collapsed${dividerClass}`}>
                      <button
                        className="fold-btn fold-btn-collapsed"
                        onClick={() => toggleGroup(key)}
                        title={`펼치기: ${g.label1}`}
                      >
                        ▸
                      </button>
                    </th>
                  )
                }
                return (
                  <th key={gi} colSpan={g.cols.length} className={`group-header${dividerClass}`}>
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
              })}
            </tr>
            <tr>
              {groups.flatMap((g, gi) => {
                const key = groupKey(g)
                const isLastGroup = gi === groups.length - 1
                if (collapsed.has(key)) {
                  return [
                    <th key={`${gi}-c`} className={`sub-header collapsed-cell${isLastGroup ? '' : ' group-divider'}`}>
                      ···
                    </th>,
                  ]
                }
                return g.cols.map((c, ci) => {
                  const isLastCol = !isLastGroup && ci === g.cols.length - 1
                  return (
                    <th
                      key={`${gi}-${ci}`}
                      className={`sub-header ${highlightCols.includes(c.key) ? 'col-highlight' : ''}${
                        isLastCol ? ' group-divider' : ''
                      }`}
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
              return (
                <tr key={ri} data-row="" className={pickState.important ? 'row-starred' : undefined}>
                  {selectable && (
                    <td className="select-col sticky-col">
                      <input
                        type="checkbox"
                        checked={selectedKeys?.has(selectKey(row)) ?? false}
                        onChange={() => onToggleRow?.(row)}
                      />
                    </td>
                  )}
                  <td className={`detail-col sticky-col${selectable ? ' sticky-col-2' : ''}`}>
                    <button
                      className="detail-btn"
                      title="상세 경기 정보"
                      onClick={() => setDetailRow(row)}
                    >
                      🔍
                    </button>
                  </td>
                  {groups.flatMap((g, gi) => {
                    const key = groupKey(g)
                    const isLastGroup = gi === groups.length - 1
                    if (collapsed.has(key)) {
                      return [
                        <td key={`${gi}-c`} className={`collapsed-cell${isLastGroup ? '' : ' group-divider'}`}>
                          ·
                        </td>,
                      ]
                    }
                    if (g.kind === 'mypick') {
                      return g.cols.map((c, ci) => {
                        const isLastCol = !isLastGroup && ci === g.cols.length - 1
                        const className = isLastCol ? 'group-divider' : undefined
                        if (c.key === 'IMPORTANT') {
                          return (
                            <td key={`${gi}-${ci}`} className={className}>
                              <button
                                className={`star-btn ${pickState.important ? 'star-on' : ''}`}
                                title={pickState.important ? '중요 표시 해제' : '중요 표시'}
                                onClick={() => savePick(row, { important: !pickState.important })}
                              >
                                {pickState.important ? '★' : '☆'}
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
                                onClick={() => setPickRow(row)}
                              >
                                {pickState.hit || <span className="mypick-blank">－</span>}
                              </button>
                            </td>
                          )
                        }
                        // MY_PICK
                        return (
                          <td key={`${gi}-${ci}`} className={className}>
                            <button className="mypick-btn" onClick={() => setPickRow(row)}>
                              {pickState.pick || <span className="mypick-blank">－</span>}
                            </button>
                          </td>
                        )
                      })
                    }
                    return g.cols.map((c, ci) => {
                      // L(리그) 칸은 내부 매칭용 코드(ul_2 등)가 아니라 사용자가 지은 리그명을 보여준다
                      // (이번주 픽처럼 여러 스코프 리그를 한 표에 모아 보여줄 때만 L_LABEL이 붙어 온다).
                      const value = c.key === 'L' && row.L_LABEL != null ? row.L_LABEL : row[c.key]
                      const style = cellStyle(g, c, value, row)
                      const isHighlighted = highlightCols.includes(c.key)
                      const isLastCol = !isLastGroup && ci === g.cols.length - 1
                      const classNames = [
                        isHighlighted ? 'cell-highlight' : '',
                        isLastCol ? 'group-divider' : '',
                      ].filter(Boolean).join(' ')
                      return (
                        <td
                          key={`${gi}-${ci}`}
                          className={classNames || undefined}
                          style={style || undefined}
                        >
                          {formatCell(g, c, value)}
                        </td>
                      )
                    })
                  })}
                </tr>
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
            code={code || detailRow.Source_League}
            row={{
              ...detailRow,
              IMPORTANT: effectivePick(detailRow).important,
              MY_PICK: effectivePick(detailRow).pick,
              MY_HIT: effectivePick(detailRow).hit,
              MEMO: effectivePick(detailRow).memo,
            }}
            scope={scope}
            onClose={() => setDetailRow(null)}
            onSavePick={(patch) => savePick(detailRow, patch)}
          />
        )}

        {pickRow && (
          <MyPickModal
            code={code || pickRow.Source_League}
            scope={scope}
            row={{
              ...pickRow,
              MY_PICK: effectivePick(pickRow).pick,
              MY_HIT: effectivePick(pickRow).hit,
              IMPORTANT: effectivePick(pickRow).important,
            }}
            onClose={() => setPickRow(null)}
            onSaved={(patch) => savePick(pickRow, patch)}
          />
        )}
      </div>
    </div>
  )
}
