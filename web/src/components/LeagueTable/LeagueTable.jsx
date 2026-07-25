import { useMemo, useState } from 'react'
import { buildColumnGroups, formatCell, cellStyle } from './columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import './LeagueTable.css'

function groupKey(g) {
  return g.label1
}

export default function LeagueTable({ columns, rows, scope }) {
  const groups = useMemo(() => buildColumnGroups(columns || []), [columns])
  const [selected, setSelected] = useState(() => new Set())
  const [detailRow, setDetailRow] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [fontSize, setFontSize] = useState('small') // 'small' | 'large' — 표 전용, 페이지 전체엔 영향 없음

  function toggleRow(idx) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))))
  }

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
      <div className="table-toolbar">
        <div className="font-size-toggle">
          <button
            className={fontSize === 'small' ? 'active' : ''}
            onClick={() => setFontSize('small')}
          >
            작은글씨
          </button>
          <button
            className={fontSize === 'large' ? 'active' : ''}
            onClick={() => setFontSize('large')}
          >
            큰글씨
          </button>
        </div>
      </div>

      <div className="league-table-scroll">
        <table className={`league-table ${fontSize === 'large' ? 'font-large' : ''}`}>
          <thead>
            <tr>
              <th className="checkbox-col sticky-col" rowSpan={2}>
                <input
                  type="checkbox"
                  checked={selected.size === rows.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="detail-col sticky-col-2" rowSpan={2}></th>
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
                  <th key={`${gi}-${ci}`} className="sub-header">
                    {c.sub}
                  </th>
                ))
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={selected.has(ri) ? 'row-selected' : ''}>
                <td className="checkbox-col sticky-col">
                  <input
                    type="checkbox"
                    checked={selected.has(ri)}
                    onChange={() => toggleRow(ri)}
                  />
                </td>
                <td className="detail-col sticky-col-2">
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
                    return (
                      <td key={`${gi}-${ci}`} style={style || undefined}>
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
