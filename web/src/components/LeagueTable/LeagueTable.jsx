import { useEffect, useMemo, useRef, useState } from 'react'
import { buildColumnGroups, formatCell, cellStyle } from './columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
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

export default function LeagueTable({ code, columns, rows, scope, highlightCols = [] }) {
  const groups = useMemo(() => buildColumnGroups(columns || []), [columns])
  const [detailRow, setDetailRow] = useState(null)
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
    1 + groups.reduce((n, g) => n + (collapsed.has(groupKey(g)) ? 1 : g.cols.length), 0)

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
  }, [rows])

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
              <th className="detail-col sticky-col" rowSpan={2}></th>
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
              return (
                <tr key={ri} data-row="">
                  <td className="detail-col sticky-col">
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
                    return g.cols.map((c, ci) => {
                      const value = row[c.key]
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
            row={detailRow}
            scope={scope}
            onClose={() => setDetailRow(null)}
          />
        )}
      </div>
    </div>
  )
}
