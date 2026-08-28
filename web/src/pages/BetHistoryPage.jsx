import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import './BetHistoryPage.css'

// 유형(정/역/무/핸승/핸무/플핸) 배지 — LeagueTable columnGroups.js의 myPickStyle과
// 정확히 같은 "정배 쪽/플핸 쪽" 2축 색상(파랑/빨강)을 그대로 쓴다. BetSlip.jsx의
// PICK_TYPES 6종이 그 두 그룹(정·핸승·핸무=정배 쪽 / 역·무·플핸=플핸 쪽)과 정확히
// 겹친다 — 새 색을 만들지 않고 이미 있는 픽 색상 기준을 그대로 재사용한다.
const PICK_CHIP_FAV = { background: 'var(--chip-blue-bg)', color: 'var(--chip-blue-fg)' }
const PICK_CHIP_DOG = { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' }
const PICK_BADGE = {
  정: PICK_CHIP_FAV,
  핸승: PICK_CHIP_FAV,
  핸무: PICK_CHIP_FAV,
  역: PICK_CHIP_DOG,
  무: PICK_CHIP_DOG,
  플핸: PICK_CHIP_DOG,
}
const PICK_BADGE_DEFAULT = { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' }

// 다리별 적중 · 조합 전체 결과 모두 같은 배색을 쓴다. "적중"은 픽 결과 배지(pickVerdictStyle)와
// 같은 노란색, "미적중"은 같은 빨간색 — 내 예측 칸에서 이미 쓰는 기준을 그대로 맞춘다.
const HIT_BADGE = {
  적중: { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)' },
  미적중: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
  대기: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)' },
  취소: { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)' },
}
const num = (v) => (v == null ? '-' : v.toLocaleString())
const odds = (v) => (v == null ? '-' : v.toFixed(2))
const pct = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v}%`)
const signClass = (v) => (v == null ? '' : v > 0 ? 'bh-pos' : v < 0 ? 'bh-neg' : '')

// 벳 한 줄의 수익금·수익률 — 실제로 적중금이 찍힌 줄에만 보여준다(그 묶음에서
// 돈이 들어온 유일한 줄이라, "이 등록 묶음 소계"와 같은 기준 — 적중금 대비 묶음
// 전체 뱃금액 — 으로 계산한 값을 그대로 가져다 쓴다). 미적중·대기 줄은 공란.
function rowProfitRoi(slip, batch) {
  if (slip.result !== '적중') return { profit: null, roi: null }
  return { profit: batch.subtotal.profit, roi: batch.subtotal.roi }
}

// 다리에 딸려 온 실제 경기일(leg.dt, 'YY-MM-DD (요일)')에서 월-일만 뽑아
// 묶음 맨 위 경기 라벨 줄의 날짜 프리픽스로 쓴다.
function shortDt(v) {
  const m = /(\d{2})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? `${m[2]}-${m[3]}` : ''
}

// 회차 구간 표시 — 확정된 회차는 "시작일 ~ 종료일(월-일)", 아직 확정 전이면
// "시작일 ~ 진행 중"으로 끝을 열어 둔다(종료일은 회차 설정 전까지 정해지지 않으니까).
function rangeLabel(start, end) {
  if (!start) return ''
  if (!end) return `${start} ~ 진행 중`
  return `${start} ~ ${end.slice(5)}`
}

function Badge({ value, map, fallback }) {
  return <span className="bh-badge" style={map[value] || fallback}>{value}</span>
}

function ProfitRoi({ profit, roi }) {
  if (profit == null) return <span className="bh-muted">-</span>
  return (
    <span className={signClass(profit)}>
      {num(profit)} <small>{pct(roi)}</small>
    </span>
  )
}

// 전체 요약 바 — 회차 구분과 무관하게 지금까지 등록된 모든 벳을 통틀어 계산한 값
// (백엔드 /api/bet_slips의 summary)을 제목 줄 오른쪽에 한눈에 보여준다.
function SummaryBar({ summary }) {
  if (!summary) return null
  return (
    <div className="bh-summary-bar">
      <div className="bh-summary-item">
        <span className="bh-summary-label">총 투자</span>
        <b>{num(summary.stake)}</b>
      </div>
      <div className="bh-summary-item">
        <span className="bh-summary-label">총 회수</span>
        <b>{num(summary.hit_amount)}</b>
      </div>
      <div className="bh-summary-item">
        <span className="bh-summary-label">수익</span>
        <b className={signClass(summary.profit)}>{num(summary.profit)}</b>
      </div>
      <div className="bh-summary-item">
        <span className="bh-summary-label">수익률</span>
        <b className={signClass(summary.roi)}>{pct(summary.roi)}</b>
      </div>
      <div className="bh-summary-item">
        <span className="bh-summary-label">적중</span>
        <b>
          {summary.hit_count}/{summary.total_count}{' '}
          <small>
            {summary.total_count
              ? `${Math.round((summary.hit_count / summary.total_count) * 1000) / 10}%`
              : '-'}
          </small>
        </b>
      </div>
    </div>
  )
}

// 회차(또는 미확정 구간) 헤더 — 예전엔 표 맨 아래에만 있던 "회차총계"를 구간 맨 위
// 띠로 올려서, 그 구간이 시작하는 자리에서 바로 손익을 알 수 있게 한다. 미확정
// 구간에는 "선택 삭제/회차 설정" 버튼도 여기로 옮겨, 그 구간 자체를 다루는
// 조작이 전부 한 자리에 모이게 했다.
function SectionHeader({
  sec, index, locked, colSpan, selectedCount, busy, onDeleteSelected, onLockSelected,
  open, onToggleOpen,
}) {
  const batchCount = sec.batches.length
  const slipCount = sec.batches.reduce((n, b) => n + b.slips.length, 0)
  return (
    <tbody className="bh-section-head">
      <tr className="bh-section-header-row bh-round-row bh-round-first">
        <td colSpan={colSpan}>
          <div className="bh-section-header">
            <div className="bh-section-title">
              {/* 확정된 회차만 접을 수 있다 — 미확정 구간은 체크박스로 벳을 고르는
                  작업 중인 곳이라 항상 펼쳐 둔다. */}
              {locked && (
                <button
                  className="bh-fold-btn"
                  onClick={onToggleOpen}
                  title={open ? '접기' : '펼치기'}
                >
                  {open ? '▾' : '▸'}
                </button>
              )}
              <span className="bh-section-name">{locked ? `${index}회차` : '미확정'}</span>
              <span className="bh-section-range">{rangeLabel(sec.round_start, sec.round_end)}</span>
              {locked && <span className="bh-locked-badge">확정 · 잠김</span>}
              <span className="bh-section-meta">
                {batchCount}묶음 · {slipCount}벳
                {!locked && selectedCount > 0 ? ` · ${selectedCount}개 선택됨` : ''}
              </span>
            </div>
            <div className="bh-section-right">
              {!locked && (
                <div className="bh-section-actions">
                  <button className="bh-action-btn" onClick={onDeleteSelected} disabled={busy || selectedCount === 0}>
                    🗑 선택 삭제{selectedCount > 0 ? ` (${selectedCount})` : ''}
                  </button>
                  <button className="bh-action-btn bh-action-primary" onClick={onLockSelected} disabled={busy || selectedCount === 0}>
                    🔒 회차 설정{selectedCount > 0 ? ` (${selectedCount})` : ''}
                  </button>
                </div>
              )}
              <div className="bh-section-stats">
                <span>투자 {num(sec.total.stake)}</span>
                <span>회수 {num(sec.total.hit_amount)}</span>
                <span className={signClass(sec.total.profit)}>
                  {num(sec.total.profit)} {pct(sec.total.roi)}
                </span>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  )
}

export default function BetHistoryPage({ scope }) {
  const [data, setData] = useState({ max_legs: 0, sections: [], summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 회차 설정 전(group_id가 없는) 벳만 체크할 수 있다.
  const [selected, setSelected] = useState(new Set())
  // 회차별 펼침 상태 — "이 회차는 펼쳐 봤다"만 담는다. 확정된(group_id 있는) 회차는
  // 여기 없으면 기본이 접힘이고, 미확정 구간은 group_id가 없어 애초에 이 Set을
  // 안 보고 항상 펼친다(SectionHeader의 open prop 계산 참고).
  const [openRounds, setOpenRounds] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/api/bet_slips?scope=${scope}`)
      setData({ max_legs: res.max_legs || 0, sections: res.sections || [], summary: res.summary || null })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [scope])

  function toggleSlip(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 벳을 삭제할까요?`)) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/bet_slips/delete_selected', { scope, slip_ids: [...selected] })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleLockSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 벳을 하나의 회차로 확정합니다. 확정되면 더 이상 선택 삭제·재설정을 할 수 없어요. 계속할까요?`)) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/bet_slips/lock', { scope, slip_ids: [...selected] })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="bh-empty">불러오는 중...</div>
  if (error) return <div className="bh-empty error-text">{error}</div>

  const { max_legs: maxLegs, sections, summary } = data
  const legCols = Array.from({ length: maxLegs }, (_, i) => i)
  // 경기 이름은 각 등록 묶음 위에 한 번(띠 형태)만 보여주고, 표 본문은 유형 배지만
  // 나열한다 — "이번주 벳"에서 조합을 만들 때 쓰는 화면과 같은 구조. 같은 묶음
  // 안에서는 항상 같은 경기 조합에 유형만 바꿔가며 등록하므로, 첫 슬립의 다리
  // 목록을 그 묶음의 경기 목록으로 그대로 써도 된다.
  const matchStripSpan = 2 + maxLegs + 6   // 체크박스+#(2) + 유형N + 배당·뱃금액·예상당첨금·결과·적중금·수익(6칸)
  // 소계·회차총계 라벨은 체크박스~배당 칸까지를 하나로 합쳐 쓴다.
  const labelSpan = 2 + maxLegs + 1

  // 회차 번호(1회차, 2회차...)는 group_id가 있는 섹션 순서대로 매긴다.
  let roundIdx = 0

  return (
    <div className="bh-page">
      <div className="bh-title-row">
        <h2 className="bh-title">📋 베팅내역</h2>
        {sections.length > 0 && <SummaryBar summary={summary} />}
      </div>
      <p className="bh-desc">
        체크박스로 벳을 고른 뒤 "회차 설정"을 누르면 그 벳들만 묶여 회차총계가 계산됩니다. 확정 전에는 "선택 삭제"로 지울 수 있고, 확정되면 체크박스가 비활성화됩니다.
      </p>

      {sections.length === 0 && <div className="bh-empty">등록된 베팅내역이 없습니다.</div>}

      {sections.length > 0 && (
        <div className="bh-table-wrap">
          <table className="bh-table">
            <thead>
              <tr>
                <th className="bh-check-col" />
                <th className="bh-no-col" />
                {legCols.map((i) => <th key={`t${i}`}>유형{i + 1}</th>)}
                <th>배당</th>
                <th>뱃금액</th>
                <th>예상 당첨금</th>
                <th>결과</th>
                <th>적중금</th>
                <th>수익</th>
              </tr>
            </thead>
            {(() => {
              // 번호는 실제 DB id가 아니라 화면에 보이는 순서대로 1부터 다시 매긴다 —
              // 지운 벳은 완전히 삭제되니(복구용으로 남겨두지 않음) 번호에 흔적이 없다.
              let rowNum = 0
              return sections.map((sec, si) => {
              const locked = sec.group_id != null
              if (locked) roundIdx += 1
              // 미확정 구간은 항상 펼침. 확정된 회차는 openRounds에 명시적으로
              // 펼쳐 뒀다고 기록돼 있을 때만 펼친다(기본값 = 접힘).
              const isOpen = !locked || openRounds.has(sec.group_id)
              return (
                <Fragment key={sec.group_id ?? `pending-${si}`}>
                  {si > 0 && (
                    <tbody className="bh-round-gap">
                      <tr><td colSpan={matchStripSpan} /></tr>
                    </tbody>
                  )}
                  <SectionHeader
                    sec={sec}
                    index={roundIdx}
                    locked={locked}
                    colSpan={matchStripSpan}
                    selectedCount={selected.size}
                    busy={busy}
                    onDeleteSelected={handleDeleteSelected}
                    onLockSelected={handleLockSelected}
                    open={isOpen}
                    onToggleOpen={() => setOpenRounds((prev) => {
                      const next = new Set(prev)
                      if (next.has(sec.group_id)) next.delete(sec.group_id)
                      else next.add(sec.group_id)
                      return next
                    })}
                  />
                  {/* 번호(rowNum)는 원래도 DB id가 아니라 '화면에 보이는 순서'로 매긴다
                      (위 주석 참고) — 접힌 회차는 안 보이니 그만큼 자연스럽게 건너뛴다. */}
                  {isOpen && sec.batches.map((batch, bi) => {
                    const isLastBatch = bi === sec.batches.length - 1
                    return (
                    // 등록 묶음마다 tr을 굵은 선으로 갈라 보여준다.
                    <tbody key={batch.batch_id} className="bh-batch">
                      {/* 같은 묶음은 항상 같은 경기 조합에 유형만 바꿔가며 등록한 것이라,
                          첫 슬립의 다리 목록을 그 묶음의 경기 목록으로 그대로 쓴다. */}
                      <tr className="bh-match-strip bh-round-row">
                        <td colSpan={matchStripSpan}>
                          <span className="bh-match-date">{shortDt(batch.slips[0]?.legs?.[0]?.dt)}</span>
                          <div className="bh-match-chips">
                            {(batch.slips[0]?.legs || []).map((leg, i) => (
                              <span key={i} className="bh-match-chip">
                                <b>{i + 1}</b> {leg.HT} vs {leg.AT}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                      {batch.slips.map((slip) => {
                        const rowClass = [
                          'bh-round-row',
                          locked && 'bh-row-locked',
                          slip.result === '적중' && 'bh-row-hit',
                          !locked && selected.has(slip.id) && 'bh-row-selected',
                        ].filter(Boolean).join(' ')
                        return (
                        <tr key={slip.id} className={rowClass}>
                          <td className="bh-check-col">
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={selected.has(slip.id)}
                              onChange={() => toggleSlip(slip.id)}
                            />
                          </td>
                          <td className="bh-no-col bh-muted">{++rowNum}</td>
                          {legCols.map((i) => {
                            const leg = slip.legs[i]
                            return (
                              <td key={`t${i}`}>
                                {leg && (
                                  <>
                                    <Badge value={leg.pick_type} map={PICK_BADGE} fallback={PICK_BADGE_DEFAULT} />
                                    {leg.hit === '적중' && <span className="bh-leg-hit bh-leg-hit-ok"> 적중</span>}
                                    {leg.hit === '미적중' && <span className="bh-leg-hit bh-leg-hit-no"> 미적</span>}
                                  </>
                                )}
                              </td>
                            )
                          })}
                          <td className="bh-nowrap">{odds(slip.odds)}</td>
                          <td className="bh-nowrap">{num(slip.stake)}</td>
                          <td className="bh-nowrap">{num(slip.payout)}</td>
                          <td>
                            <Badge value={slip.result} map={HIT_BADGE} fallback={HIT_BADGE['대기']} />
                          </td>
                          <td className="bh-nowrap">{num(slip.hit_amount)}</td>
                          <td className="bh-nowrap">
                            <ProfitRoi {...rowProfitRoi(slip, batch)} />
                          </td>
                        </tr>
                        )
                      })}
                      <tr className={`bh-subtotal bh-round-row${isLastBatch ? ' bh-round-last' : ''}`}>
                        <td colSpan={labelSpan} className="bh-subtotal-label">
                          └ 이 등록 묶음 소계
                        </td>
                        <td className="bh-nowrap">{num(batch.subtotal.stake)}</td>
                        <td />
                        <td />
                        <td className="bh-nowrap">{num(batch.subtotal.hit_amount)}</td>
                        <td className="bh-nowrap">
                          <ProfitRoi profit={batch.subtotal.profit} roi={batch.subtotal.roi} />
                        </td>
                      </tr>
                    </tbody>
                    )
                  })}
                </Fragment>
              )
            })
            })()}
          </table>
        </div>
      )}
    </div>
  )
}
