import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildColumnGroups, formatCell, cellStyle, myHitStyle, myPickStyle, formStyle, bettingDayStyle,
  computeAutoVerdict, pickVerdictStyle,
} from './columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import MyPickModal from '../MyPickModal/MyPickModal'
import { api } from '../../api/client'
import { useFontSize } from '../../context/FontSizeContext'
import { isStarred } from '../../utils/format'
import './LeagueTable.css'

const VISIBLE_ROWS = 20
// 화면 위아래로 미리 그려둘 여유 행수. 스크롤할 때 빈 칸이 스치는 걸 막아준다.
const OVERSCAN = 10
// 아직 실제 행 높이를 재기 전에 쓸 근사값(px)
const DEFAULT_ROW_H = { small: 28, large: 31 }
// 폼(PPG) 칸 — 칸 전체가 아니라 값만 뱃지로 강조한다.
const FORM_COLS = new Set(['HTF', 'HF', 'AF', 'ATF'])

function groupKey(g) {
  return g.label1
}

// 그룹 경계 구분선 클래스 — 국내배당/해외배당 사이는 두 "배당" 블록이 헷갈리기 쉬워
// 다른 경계보다 더 두껍게 강조한다(divider-strong, LeagueTable.css 참고).
function dividerClass(g, isLastGroup) {
  if (isLastGroup) return ''
  return g.label1 === '국내배당' ? ' group-divider divider-strong' : ' group-divider'
}

// "핸승 위험도" 그룹 안에서 배당 기반 값(핸승값/국정값/해정값/배당·AI)과 26개
// 지표 기반 값(K값/F값/KF·AI)을 가르는 구분선 — 그룹과 그룹 사이에 쓰는 것과
// 똑같은 굵기(group-divider)를 그대로 쓴다.
function riskSubDividerClass(g, c) {
  return g.kind === 'risk' && c.key === 'AI_PICK' ? ' group-divider' : ''
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
  const [pickRow, setPickRow] = useState(null) // 내픽 팝업 대상 행
  // 별표/내픽/메모 클릭 즉시 반영용 오버레이. 새로 조회하면(rows가 바뀌면) 서버가 다시
  // 내려준 최신값으로 자연히 대체되므로 초기화한다.
  // ref로도 같은 값을 들고 있는 이유: React state 갱신은 비동기라 "별표 클릭 직후 곧바로
  // 픽 선택"처럼 리렌더가 끼기 전에 연달아 저장하면 이전 변경을 못 보고 덮어쓸 수 있다.
  // ref는 즉시(동기) 최신값을 읽고 쓸 수 있어 이 경쟁 상태를 막아준다.
  const pickOverridesRef = useRef({})
  const [pickOverrides, setPickOverrides] = useState({})
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [showRiskLegend, setShowRiskLegend] = useState(false)
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
      await api.post(`/api/leagues/${rowCode(row)}/my_picks`, {
        scope: rowScope(row),
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
    const headerRow1 = el.querySelector('thead tr:first-child')
    const firstRow = el.querySelector('tbody tr[data-row]')
    if (!thead || !firstRow) return
    const h = firstRow.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - rowH) > 0.5) setRowH(h)
    if (h > 0) {
      el.style.maxHeight = `${thead.getBoundingClientRect().height + h * VISIBLE_ROWS}px`
    }
    // 헤더 1번째 줄(그룹명) 높이를 재서 2번째 줄(L/S/R 등)이 스크롤 중 붙는 위치로 쓴다.
    // CSS에 숫자를 고정해두면 실제 높이와 어긋나 돋보기·체크박스 칸(rowSpan)의 아래
    // 경계선과 2번째 줄의 경계선이 다른 높이에 생겨 계단처럼 보인다.
    if (headerRow1) {
      const row1H = headerRow1.getBoundingClientRect().height
      if (row1H > 0) el.style.setProperty('--header-row1-h', `${row1H}px`)
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

  // 26개 지표 그룹을 해외(F-/TF-)/국내(K-/TK-) 묶음으로 한 번에 접고 펼 수 있게 한다.
  function indicatorBatch(g) {
    if (g.kind !== 'indicator') return null
    const code = g.label2 || ''
    if (code.startsWith('TF-') || code.startsWith('F-')) return 1
    if (code.startsWith('TK-') || code.startsWith('K-')) return 2
    return null
  }

  const batch1Groups = groups.filter((g) => indicatorBatch(g) === 1)
  const batch2Groups = groups.filter((g) => indicatorBatch(g) === 2)

  // 그룹 제목("1. 해) 승 분석")에서 번호만 뽑아 실제 보이는 범위를 표시한다 —
  // 내 데이터처럼 통합지표(TF-*/TK-*)가 빠지면 번호가 1~9/14~22로 줄어들기 때문에
  // "1~13" 같은 고정 문구를 쓰면 실제와 어긋난다.
  function batchRangeLabel(batchGroups) {
    const nums = batchGroups.map((g) => parseInt(g.label1, 10)).filter((n) => !Number.isNaN(n))
    if (nums.length === 0) return ''
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    return min === max ? `${min}` : `${min}~${max}`
  }

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
      {(batch1Groups.length > 0 || batch2Groups.length > 0) && (
        <div className="batch-fold-bar">
          {batch1Groups.length > 0 && (
            <button className="batch-fold-btn" onClick={() => toggleBatch(batch1Groups)}>
              {batch1Groups.every((g) => collapsed.has(groupKey(g))) ? '▸' : '◂'} 해외 지표 (
              {batchRangeLabel(batch1Groups)})
            </button>
          )}
          {batch2Groups.length > 0 && (
            <button className="batch-fold-btn" onClick={() => toggleBatch(batch2Groups)}>
              {batch2Groups.every((g) => collapsed.has(groupKey(g))) ? '▸' : '◂'} 국내 지표 (
              {batchRangeLabel(batch2Groups)})
            </button>
          )}
        </div>
      )}
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
                const dividerCls = dividerClass(g, isLastGroup)
                if (isCollapsed) {
                  return (
                    <th key={gi} colSpan={1} className={`group-header group-collapsed${dividerCls}`}>
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
                  <th key={gi} colSpan={g.cols.length} className={`group-header${dividerCls}`}>
                    <div className="group-header-row">
                      <div className="group-text">
                        <div className="group-title">{g.label1}</div>
                        <div className="group-subtitle">{g.label2}</div>
                      </div>
                      {g.kind === 'risk' && (
                        <button
                          className="risk-legend-btn"
                          onClick={() => setShowRiskLegend(true)}
                          title="색상별 구간 참고표"
                        >
                          참고
                        </button>
                      )}
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
                    <th key={`${gi}-c`} className={`sub-header collapsed-cell${dividerClass(g, isLastGroup)}`}>
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
                        isLastCol ? dividerClass(g, isLastGroup) : ''
                      }${riskSubDividerClass(g, c)}`}
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
              const prevRow = ri > 0 ? rows[ri - 1] : null
              const isRoundStart = prevRow && (prevRow.S !== row.S || prevRow.R !== row.R)
              const rowClass = [
                pickState.important ? 'row-starred' : '',
                isRoundStart ? 'round-start' : '',
              ].filter(Boolean).join(' ')
              return (
                <tr key={ri} data-row="" className={rowClass || undefined}>
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
                      // 일반정보를 접어도 금/토/일 베팅일 색상 + 시간(TM)은 계속 보여야
                      // 한다 — 접힌 채로도 몇 시 경기인지 바로 알 수 있게.
                      const isGenInfo = g.label1 === '일반정보'
                      // 똥배를 접어도 똥1/똥2 순번은 계속 보여야 한다 — 그게 이 그룹의
                      // 핵심 정보라 접혀서 안 보이면 의미가 없다.
                      const isDdong = g.label1 === '똥배'
                      const style = isGenInfo ? bettingDayStyle(row) : null
                      return [
                        <td
                          key={`${gi}-c`}
                          className={`collapsed-cell${dividerClass(g, isLastGroup)}`}
                          style={style || undefined}
                        >
                          {isGenInfo
                            ? formatCell(g, { sub: 'TM' }, row.TM)
                            : isDdong
                              ? row.DDONG || '·'
                              : '·'}
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
                        if (c.key === 'PICK_VERDICT') {
                          const verdict = computeAutoVerdict(pickState.pick, row.RT)
                          return (
                            <td
                              key={`${gi}-${ci}`}
                              className={className}
                              style={pickVerdictStyle(verdict) || undefined}
                            >
                              {verdict || <span className="mypick-blank">－</span>}
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
                            <button
                              className="mypick-btn"
                              style={myPickStyle(pickState.pick) || undefined}
                              onClick={() => setPickRow(row)}
                            >
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
                      const isHighlighted = highlightCols.includes(c.key)
                      const isLastCol = !isLastGroup && ci === g.cols.length - 1
                      const classNames = [
                        isHighlighted ? 'cell-highlight' : '',
                        isLastCol ? dividerClass(g, isLastGroup).trim() : '',
                        riskSubDividerClass(g, c).trim(),
                      ].filter(Boolean).join(' ')
                      const text = formatCell(g, c, value, row)
                      // 폼(PPG) 칸은 칸 전체를 칠하지 않고, 값만 작은 뱃지로 보여준다.
                      if (g.label1 === '경기정보' && FORM_COLS.has(c.key)) {
                        const badgeStyle = formStyle(value)
                        return (
                          <td key={`${gi}-${ci}`} className={classNames || undefined}>
                            {badgeStyle ? (
                              <span className="form-badge" style={badgeStyle}>
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
            code={rowCode(detailRow)}
            row={{
              ...detailRow,
              IMPORTANT: effectivePick(detailRow).important,
              MY_PICK: effectivePick(detailRow).pick,
              MY_HIT: effectivePick(detailRow).hit,
              MEMO: effectivePick(detailRow).memo,
            }}
            scope={rowScope(detailRow)}
            onClose={() => setDetailRow(null)}
            onSavePick={(patch) => savePick(detailRow, patch)}
          />
        )}

        {pickRow && (
          <MyPickModal
            code={rowCode(pickRow)}
            scope={rowScope(pickRow)}
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

        {showRiskLegend && <RiskLegendModal onClose={() => setShowRiskLegend(false)} />}
      </div>
    </div>
  )
}

// 핸승값·배당·AI·K값·F값·KF·AI는 같은 5구간 색상(15/25/35/45%), 국정값·해정값은
// 정배 승리 확률이라 스케일이 달라 따로 4구간 색상(40/55/70%)을 쓴다 —
// columnGroups.js cellStyle의 두 색상 규칙과 그대로 맞춘 참고표.
const RISK_LEGEND_5 = [
  { label: '안전', range: '0~15%', bg: '#1B5E20', color: '#fff' },
  { label: '양호', range: '15~25%', bg: '#66BB6A', color: '#0D1B2A' },
  { label: '보통', range: '25~35%', bg: '#FBC02D', color: '#0D1B2A' },
  { label: '주의', range: '35~45%', bg: '#EF6C00', color: '#fff' },
  { label: '위험', range: '45%~', bg: '#C62828', color: '#fff' },
]
const RISK_LEGEND_WIN = [
  { label: '양호', range: '~40%', bg: '#66BB6A', color: '#0D1B2A' },
  { label: '보통', range: '40~55%', bg: '#FBC02D', color: '#0D1B2A' },
  { label: '주의', range: '55~70%', bg: '#EF6C00', color: '#fff' },
  { label: '위험', range: '70%~', bg: '#C62828', color: '#fff' },
]
// RISK_LEGEND_5을 100-n으로 뒤집은 표시값 기준(화면에 실제 보이는 플핸% 숫자) — 순서도
// "안전→위험"이 "높은 %→낮은 %"가 되도록 그대로 뒤집는다.
const RISK_LEGEND_5_FLIPPED = [
  { label: '안전', range: '85~100%', bg: '#1B5E20', color: '#fff' },
  { label: '양호', range: '75~85%', bg: '#66BB6A', color: '#0D1B2A' },
  { label: '보통', range: '65~75%', bg: '#FBC02D', color: '#0D1B2A' },
  { label: '주의', range: '55~65%', bg: '#EF6C00', color: '#fff' },
  { label: '위험', range: '~55%', bg: '#C62828', color: '#fff' },
]

function RiskLegendModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card risk-legend-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <h2 className="modal-title">📖 핸승 위험도 색상 참고표</h2>
        <p className="modal-meta">실측(6대리그) 기준 색상별 구간입니다.</p>

        <p className="risk-legend-group-title">핸승값 · K값 · F값 (핸승이 나올 확률, 적을수록 좋음)</p>
        <table className="detail-table risk-legend-table">
          <tbody>
            <tr>
              {RISK_LEGEND_5.map((b) => (
                <td key={b.label} style={{ background: b.bg, color: b.color, fontWeight: 700 }}>
                  {b.label}
                  <br />
                  {b.range}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <p className="risk-legend-group-title">국정값 · 해정값 (정배가 나올 확률, 적을수록 좋음)</p>
        <table className="detail-table risk-legend-table">
          <tbody>
            <tr>
              {RISK_LEGEND_WIN.map((b) => (
                <td key={b.label} style={{ background: b.bg, color: b.color, fontWeight: 700 }}>
                  {b.label}
                  <br />
                  {b.range}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <p className="risk-legend-group-title">배당·AI · KF·AI (플핸이 나올 확률, 높을수록 좋음)</p>
        <table className="detail-table risk-legend-table">
          <tbody>
            <tr>
              {RISK_LEGEND_5_FLIPPED.map((b) => (
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
    </div>
  )
}
