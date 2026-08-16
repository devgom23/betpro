import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { RT_COLOR } from '../RtBadge/RtBadge'
import './SeasonStats.css'

const RT_ROWS = ['핸승', '핸무', '무', '역']

// 표 안에서 글자로 쓰는 결과 색 — RtBadge의 RT_CHIP과 같은 --chip-* 토큰이라
// 다크/라이트 테마 모두에서 앱 전체와 같은 기준으로 읽힌다.
const RT_TEXT = {
  핸승: 'var(--chip-blue-fg)',
  핸무: 'var(--chip-green-fg)',
  무: 'var(--chip-gray-fg)',
  역: 'var(--chip-red-fg)',
}
// 정(핸승+핸무)/플(무+역)/중(동률) — 정배·플핸 축은 내 예측 픽 색상과 같은 파랑/빨강,
// 중립은 회색. 뱃지가 아니라 칸 전체를 이 색으로 칠한다(내 예측 내픽 칸과 같은 방식).
const WINNER_CHIP = {
  정: { background: 'var(--chip-blue-bg)', color: 'var(--chip-blue-fg)', fontWeight: 700 },
  플: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)', fontWeight: 700 },
  중: { background: 'var(--chip-gray-bg)', color: 'var(--chip-gray-fg)', fontWeight: 700 },
}

// 표①·표②의 라운드 열 폭. <table table-layout:fixed>는 셀 내용에 따라 브라우저마다
// 폭 계산이 흔들려서(실측: 두 표가 서로 다른 폭으로 나옴) 대신 CSS Grid를 쓴다 —
// 두 표가 완전히 같은 grid-template-columns를 쓰면 라운드 열이 항상 정확히 포개진다.
const RT_COL = 42
const SUM_COL = 62
const ROUND_COL = 46

function gridTemplate(roundCount) {
  return `${RT_COL}px ${SUM_COL}px repeat(${roundCount}, ${ROUND_COL}px)`
}

export default function SeasonStats({ code, scope, season, round }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [ddongOpen, setDdongOpen] = useState(true)
  const [resultOpen, setResultOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  // 표①·표②는 라운드 열이 서로 포개져 보여야 하므로, 한쪽을 가로 스크롤하면
  // 다른 쪽도 같은 위치로 맞춘다(폭은 이미 같은 grid-template-columns라 동일하니
  // 스크롤 위치만 맞추면 된다).
  const ddongScrollRef = useRef(null)
  const resultScrollRef = useRef(null)
  function syncScroll(target) {
    return (e) => {
      if (target.current) target.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  // 시즌·라운드가 각각 1개로 좁혀졌을 때만 불러온다(전체 조회에서는 라운드 축이 없어 의미가 없음).
  useEffect(() => {
    const ready = season && season !== 'ALL' && round && round !== 'ALL'
    if (!ready) {
      setData(null)
      return undefined
    }
    let cancelled = false
    api
      .get(
        `/api/leagues/${code}/season_stats?scope=${scope}` +
          `&season=${encodeURIComponent(season)}&round=${encodeURIComponent(round)}`
      )
      .then((res) => {
        if (!cancelled) setData(res?.available ? res : null)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, season, round])

  // 이번 라운드에 나온 똥배 배당값 — 과거 라운드의 같은 값에 표시를 넣어
  // "그때는 어떤 결과였나"를 눈으로 찾을 수 있게 한다.
  const focus = useMemo(() => new Set(data?.ddong?.focus ?? []), [data])

  if (!data) return null
  const { rounds, ddong, result, history } = data
  const colCls = (r) => (r === data.round ? ' ss-cur' : '')
  const template = gridTemplate(rounds.length)
  // 똥사 = 똥배(정배가 극단적으로 강한 경기) 중 무·역이 나온(=정배가 완전히 무너진) 경기 수
  const ddongSago = ddong.rows
    .filter((r) => r.rt === '무' || r.rt === '역')
    .reduce((sum, r) => sum + r.count, 0)
  const ddongSagoPct = ddong.total > 0 ? ((ddongSago / ddong.total) * 100).toFixed(1) : '0.0'

  return (
    <div className="season-stats">
      <div className="ss-bar">
        <button className="ss-fold" onClick={() => setOpen((v) => !v)}>
          {open ? '◂' : '▸'} 시즌 지표
        </button>
        <span className="ss-bar-meta">
          <strong>{data.season}</strong> 시즌 · <strong>{data.round}</strong> 기준 · 전체{' '}
          <strong>{result.total}</strong>경기 ·{' '}
          <span className="ss-bar-rt">
            {result.rows.map((row) => `${row.rt} ${row.count} (${row.pct}%)`).join(' / ')}
          </span>{' '}
          · 똥배 <strong>{ddong.total}</strong> /{' '}
          <span className="ss-bar-sago">똥사 {ddongSago} ({ddongSagoPct}%)</span>
        </span>
        {focus.size > 0 && (
          <span className="ss-bar-focus">
            이번 라운드 똥배:{' '}
            {[...focus].map((v) => (
              <b key={v}>{v.toFixed(2)}</b>
            ))}
          </span>
        )}
      </div>

      {open && (
        <div className="ss-body">
          {/* ① 똥배 격자 — 결과별로 라운드마다 어떤 배당이 나왔는지 */}
          <div className="ss-block">
            <div className="ss-title">
              <button className="ss-fold ss-fold-sub" onClick={() => setDdongOpen((v) => !v)}>
                {ddongOpen ? '◂' : '▸'}
              </button>
              ① 라운드별 똥배 현황
              <span className="ss-hint">
                국내배당 1.49 이하 · 노란 칸이 이번 라운드, 테두리 친 값은 이번 라운드와 같은 배당
              </span>
            </div>
            {ddongOpen && (
            <div className="ss-scroll" ref={ddongScrollRef} onScroll={syncScroll(resultScrollRef)}>
              <div className="ss-tgrid" style={{ gridTemplateColumns: template }}>
                <div className="ss-cell ss-head-rt">결과</div>
                <div className="ss-cell ss-head-sum">계</div>
                {rounds.map((r) => (
                  <div key={r} className={`ss-cell ss-th${colCls(r)}`}>
                    {r.replace('R', '')}
                  </div>
                ))}

                {ddong.rows.map((row) => (
                  <Fragment key={row.rt}>
                    <div className="ss-cell ss-rt" style={{ color: RT_TEXT[row.rt] }}>
                      {row.rt}
                    </div>
                    <div className="ss-cell ss-sum">
                      {row.count} <span className="ss-pct">{row.pct}%</span>
                    </div>
                    {rounds.map((r) => (
                      <div key={r} className={`ss-cell${colCls(r)}`}>
                        {(row.cells[r] || []).map((v, i) => (
                          <span key={i} className={focus.has(v) ? 'ss-odds ss-odds-hit' : 'ss-odds'}>
                            {v.toFixed(2)}
                          </span>
                        ))}
                      </div>
                    ))}
                  </Fragment>
                ))}

                <div className="ss-cell ss-rt ss-foot-cell">Total</div>
                <div className="ss-cell ss-sum ss-foot-cell">{ddong.total}</div>
                {rounds.map((r) => (
                  <div key={r} className="ss-cell ss-foot-cell" />
                ))}
              </div>
            </div>
            )}
          </div>

          {/* ② 결과 격자 — 그 시즌 전 경기의 라운드별 결과 개수 */}
          <div className="ss-block">
            <div className="ss-title">
              <button className="ss-fold ss-fold-sub" onClick={() => setResultOpen((v) => !v)}>
                {resultOpen ? '◂' : '▸'}
              </button>
              ② 라운드별 결과 분포
              <span className="ss-hint">정 = 핸승+핸무 · 플 = 무+역</span>
            </div>
            {resultOpen && (
            <div className="ss-scroll" ref={resultScrollRef} onScroll={syncScroll(ddongScrollRef)}>
              <div className="ss-tgrid" style={{ gridTemplateColumns: template }}>
                <div className="ss-cell ss-head-rt">결과</div>
                <div className="ss-cell ss-head-sum">계</div>
                {rounds.map((r) => (
                  <div key={r} className={`ss-cell ss-th${colCls(r)}`}>
                    {r.replace('R', '')}
                  </div>
                ))}

                {result.rows.map((row) => (
                  <Fragment key={row.rt}>
                    <div className="ss-cell ss-rt" style={{ color: RT_TEXT[row.rt] }}>
                      {row.rt}
                    </div>
                    <div className="ss-cell ss-sum">
                      {row.count} <span className="ss-pct">{row.pct}%</span>
                    </div>
                    {rounds.map((r) => (
                      <div key={r} className={`ss-cell${colCls(r)}`}>
                        {row.cells[r] ?? ''}
                      </div>
                    ))}
                  </Fragment>
                ))}

                <div className="ss-cell ss-rt ss-foot-cell">정/플</div>
                <div className="ss-cell ss-sum ss-foot-cell">{result.total}</div>
                {rounds.map((r) => (
                  <div key={r} className={`ss-cell ss-foot-cell${colCls(r)}`}>
                    {result.ratio[r] ? `${result.ratio[r].jung}/${result.ratio[r].pl}` : ''}
                  </div>
                ))}

                <div className="ss-cell ss-rt ss-foot-cell">분포</div>
                <div className="ss-cell ss-sum ss-foot-cell ss-tally">
                  {result.tally['정']}/{result.tally['중']}/{result.tally['플']}
                </div>
                {rounds.map((r) => {
                  const t = result.ratio[r]
                  return (
                    <div
                      key={r}
                      className={`ss-cell ss-foot-cell${colCls(r)}`}
                      style={t ? WINNER_CHIP[t.winner] : undefined}
                    >
                      {t ? t.winner : ''}
                    </div>
                  )
                })}
              </div>
            </div>
            )}
          </div>

          {/* ③ 라운드 이력 — 같은 라운드를 과거 시즌까지(최근 시즌부터) */}
          <div className="ss-block">
            <div className="ss-title">
              <button className="ss-fold ss-fold-sub" onClick={() => setHistoryOpen((v) => !v)}>
                {historyOpen ? '◂' : '▸'}
              </button>
              ③ {data.round} 과거 이력
              <span className="ss-hint">시즌마다 이 라운드의 결과 분포와 똥배 경기 (최근 시즌 순)</span>
            </div>
            {historyOpen && (
              <div className="ss-scroll">
                <div className="ss-history">
                  {history.map((h) => (
                    <div
                      key={h.season}
                      className={`ss-card${h.season === data.season ? ' ss-card-cur' : ''}`}
                    >
                      <div className="ss-card-head">{h.season}</div>
                      <div className="ss-card-counts">
                        {RT_ROWS.map((rt) => (
                          <div key={rt} className="ss-count">
                            <span className="ss-dot" style={{ background: RT_COLOR[rt] }} />
                            <span className="ss-count-label">{rt}</span>
                            <b>{h.counts[rt]}</b>
                          </div>
                        ))}
                      </div>
                      <div className="ss-card-ratio">
                        <span className="ss-ratio-jung">{h.jung}</span> <span>vs</span>{' '}
                        <span className="ss-ratio-pl">{h.pl}</span>
                      </div>
                      {h.picks.length > 0 && (
                        <div className="ss-picks-tally">
                          {RT_ROWS.map((rt) => h.picks.filter((p) => p.rt === rt).length).join('/')}
                        </div>
                      )}
                      <ul className="ss-picks">
                        {h.picks.length === 0 && <li className="ss-pick-none">똥배 없음</li>}
                        {h.picks.map((p) => (
                          <li key={p.rank} style={{ color: RT_TEXT[p.rt] || 'var(--text-muted)' }}>
                            <span className="ss-pick-main">
                              <span className="ss-pick-odds">{p.odds.toFixed(2)}</span>
                              {p.HT} <span className="ss-pick-vs">vs</span> {p.AT}
                              {p.HS != null && ` (${p.HS}:${p.AS})`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
