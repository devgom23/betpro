// 사다리 표 — 경기(층)마다 한 열, 각 층에서 하나씩 고른 모든 조합이 한 줄씩. 뒤에 뱃배당·뱃금액·당첨금·수익금·수익률
// (예전 이번주 벳 조합표와 같은 순서). 지금 짜는 벳(입력 가능)과 저장된 벳(읽기 전용)이 같이 쓴다.
//   cols: [{ title, sub, axis }]
//   rows: [{ key, odds, cells: [{ lab, odds, role: 'ax'|'main'|'ins' }] }]
const fmt = (v) => (v === null || v === undefined ? '-' : Math.round(v).toLocaleString())
const ROLE = { main: '메인 ', ins: '보험 ', ax: '' }
export const MAX_ROWS = 1000

export default function LadderTable({ cols, rows, stakes, onStake, editable }) {
  if (rows.length > MAX_ROWS) {
    return <div className="wk-empty">조합이 {rows.length.toLocaleString()}개라 표를 그리지 않습니다 — 복수 경기를 줄여 주세요(최대 {MAX_ROWS.toLocaleString()}줄).</div>
  }
  const total = rows.reduce((a, r) => a + (Number(stakes[r.key]) || 0), 0)
  return (
    <div className="wk-ladder-wrap">
      <table className="wk-ladder">
        <thead>
          <tr>
            <th>#</th>
            {cols.map((c, i) => (
              <th key={i} className="wk-lg-col">
                <span className={`wk-tag ${c.axis ? 'is-axis' : 'is-multi'}`}>{c.axis ? '축' : '복수'}</span> {c.title}
                <small>{c.sub}</small>
              </th>
            ))}
            <th>뱃배당</th><th>뱃금액</th><th>당첨금</th><th>수익금</th><th>수익률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => {
            const stake = Number(stakes[r.key]) || 0
            const win = stake ? Math.floor(stake * r.odds) : null
            const profit = win !== null ? win - total : null
            const cls = profit === null ? '' : profit >= 0 ? 'is-pos' : 'is-neg'
            return (
              <tr key={r.key}>
                <td>{n + 1}</td>
                {r.cells.map((c, i) => <td key={i} className={`wk-role-${c.role}`}>{ROLE[c.role]}{c.lab} {Number(c.odds).toFixed(2)}</td>)}
                <td className="wk-odds2">{r.odds.toFixed(1)}</td>
                <td>
                  {editable ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      className="wk-stake"
                      value={stake ? stake.toLocaleString() : ''}
                      placeholder="0"
                      onChange={(e) => onStake(r.key, Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                    />
                  ) : fmt(stake)}
                </td>
                <td>{fmt(win)}</td>
                <td className={cls}>{fmt(profit)}</td>
                <td className={cls}>{profit !== null && total ? `${((win / total - 1) * 100).toFixed(1)}%` : '-'}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={cols.length + 2} className="wk-right">뱃금액 합계</td>
            <td>{fmt(total)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
