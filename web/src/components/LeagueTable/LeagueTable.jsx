import { useMemo, useState } from 'react'
import { buildColumnGroups, formatCell, cellStyle } from './columnGroups'
import './LeagueTable.css'

export default function LeagueTable({ columns, rows }) {
  const groups = useMemo(() => buildColumnGroups(columns || []), [columns])
  const [selected, setSelected] = useState(() => new Set())

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

  if (!rows || rows.length === 0) {
    return <p className="table-empty">표시할 경기가 없습니다.</p>
  }

  return (
    <div className="league-table-scroll">
      <table className="league-table">
        <thead>
          <tr>
            <th className="checkbox-col sticky-col" rowSpan={2}>
              <input
                type="checkbox"
                checked={selected.size === rows.length}
                onChange={toggleAll}
              />
            </th>
            {groups.map((g, gi) => (
              <th key={gi} colSpan={g.cols.length} className="group-header">
                <div className="group-title">{g.label1}</div>
                <div className="group-subtitle">{g.label2}</div>
              </th>
            ))}
          </tr>
          <tr>
            {groups.flatMap((g, gi) =>
              g.cols.map((c, ci) => (
                <th key={`${gi}-${ci}`} className="sub-header">
                  {c.sub}
                </th>
              ))
            )}
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
              {groups.flatMap((g, gi) =>
                g.cols.map((c, ci) => {
                  const value = row[c.key]
                  const style = cellStyle(g, c, value)
                  return (
                    <td key={`${gi}-${ci}`} style={style || undefined}>
                      {formatCell(g, c, value)}
                    </td>
                  )
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
