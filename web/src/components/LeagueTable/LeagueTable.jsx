import { useEffect, useMemo, useRef, useState } from 'react'
import { buildColumnGroups, formatCell, cellStyle } from './columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import { useFontSize } from '../../context/FontSizeContext'
import './LeagueTable.css'

const VISIBLE_ROWS = 20

function groupKey(g) {
  return g.label1
}

export default function LeagueTable({ columns, rows, scope, highlightCols = [] }) {
  const groups = useMemo(() => buildColumnGroups(columns || []), [columns])
  const [detailRow, setDetailRow] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const { fontSize } = useFontSize() // 'small' | 'large' — 상단바 토글로 전역 제어, 표 데이터 셀에만 적용
  const scrollRef = useRef(null)

  // 화면에는 항상 딱 20행만 보이게 높이를 고정하고, 그 이상은 표 내부 스크롤로 본다.
  // 헤더 2줄 + 실제 데이터 행 높이(글씨 크기에 따라 달라짐)를 직접 측정해서 계산한다.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const thead = el.querySelector('thead')
    const firstRow = el.querySelector('tbody tr')
    if (!thead || !firstRow) return
    const headerH = thead.getBoundingClientRect().height
    const rowH = firstRow.getBoundingClientRect().height
    el.style.maxHeight = `${headerH + rowH * VISIBLE_ROWS}px`
  }, [rows, fontSize])

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
      <div className="league-table-scroll" ref={scrollRef}>
        <table className={`league-table ${fontSize === 'large' ? 'font-large' : ''}`}>
          <thead>
            <tr>
              <th className="detail-col sticky-col" rowSpan={2}></th>
              {groups.map((g, gi) => {
                const key = groupKey(g)
                const isCollapsed = collapsed.has(key)
                if (isCollapsed) {
                  return (
                    <th key={gi} colSpan={1} className="group-header group-collapsed">
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
                  <th key={gi} colSpan={g.cols.length} className="group-header">
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
                if (collapsed.has(key)) {
                  return [<th key={`${gi}-c`} className="sub-header collapsed-cell">···</th>]
                }
                return g.cols.map((c, ci) => (
                  <th
                    key={`${gi}-${ci}`}
                    className={`sub-header ${highlightCols.includes(c.key) ? 'col-highlight' : ''}`}
                  >
                    {c.sub}
                  </th>
                ))
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
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
                  if (collapsed.has(key)) {
                    return [<td key={`${gi}-c`} className="collapsed-cell">·</td>]
                  }
                  return g.cols.map((c, ci) => {
                    const value = row[c.key]
                    const style = cellStyle(g, c, value)
                    const isHighlighted = highlightCols.includes(c.key)
                    return (
                      <td
                        key={`${gi}-${ci}`}
                        className={isHighlighted ? 'cell-highlight' : undefined}
                        style={style || undefined}
                      >
                        {formatCell(g, c, value)}
                      </td>
                    )
                  })
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {detailRow && (
          <MatchDetailModal row={detailRow} scope={scope} onClose={() => setDetailRow(null)} />
        )}
      </div>
    </div>
  )
}
