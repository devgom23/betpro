import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { RT_COLOR } from '../RtBadge/RtBadge'
import { summarizeVerdicts, summarizeSystemVerdicts } from '../LeagueTable/columnGroups'
import { PickSummaryBar } from '../RtSummaryBar/RtSummaryBar'
import { RichMemoInput } from '../RichMemo/RichMemo'
import { MarketSwitch, RoundMissDetail, RoundMissGames } from '../RoundMiss/RoundMiss'
import RoundMissMemo from '../RoundMiss/RoundMissMemo'
import { LEAGUE_LABEL, RM_LEAGUES, useRoundMissSummary } from '../RoundMiss/useRoundMiss'
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

// hide1and3(2026-09-27, 기타경기 전용) — ①·③은 '같은 라운드가 매 시즌 반복된다'는 전제로
// 만든 표라, 라운드가 그날그날의 프로토 회차 번호일 뿐인 기타경기에는 뜻이 없다(사용자 지정).
// 기본값은 false라 기존 호출(6대리그·K1·K2)은 전부 그대로 ①②③ 다 보여준다.
export default function SeasonStats({ code, scope, season, round, hide1and3 = false }) {
  const [data, setData] = useState(null)
  // 판정(시스템)·내 예측 적중 요약 — '시즌 지표'라는 이름대로 이번 라운드가 아니라
  // 시즌 전체 기준이어야 한다(2026-09-12 사용자 지정). 위 season_stats API는 라운드별
  // 집계표(똥배/결과분포)만 주고 적중 계산에 쓰는 원본 행(MY_PICK·배당·27개 지표)은
  // 안 주므로, 시즌 전체 행을 따로 한 번 받아 클라이언트에서 센다(round=ALL, 리그
  // 화면의 /api/leagues/{code}와 같은 엔드포인트 — round만 다르다). 라운드를 옮겨
  // 다녀도(같은 시즌 안이면) 다시 안 받는다 — 의존성이 season까지만이라서다.
  const [seasonSummary, setSeasonSummary] = useState({ pick: null, system: null })
  useEffect(() => {
    const ready = season && season !== 'ALL'
    if (!ready) {
      setSeasonSummary({ pick: null, system: null })
      return undefined
    }
    let cancelled = false
    api
      .get(`/api/leagues/${code}?scope=${scope}&season=${encodeURIComponent(season)}&round=ALL`)
      .then((res) => {
        if (cancelled) return
        const rows = res?.rows || []
        setSeasonSummary({ pick: summarizeVerdicts(rows), system: summarizeSystemVerdicts(rows) })
      })
      .catch(() => {
        if (!cancelled) setSeasonSummary({ pick: null, system: null })
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, season])
  const [open, setOpen] = useState(false)
  const [ddongOpen, setDdongOpen] = useState(false)
  const [resultOpen, setResultOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  // ④ 라운드별 판정(2026-10-10 사용자 지정) — 판정은 공식 데이터(master) 기준이라 개인 데이터(user) 탭에서는 뺀다.
  // 위에서 고른 시즌·라운드를 그대로 쓴다(시즌분석 화면처럼 라운드를 따로 고르지 않는다).
  const [rmOpen, setRmOpen] = useState(true)
  const [rmGamesOpen, setRmGamesOpen] = useState(true)   // ⑤ 경기별 세팅값 접기(2026-10-10 — ④에서 나눔)
  const [rmMkt, setRmMkt] = useState('v')
  const rmOk = !hide1and3 && scope !== 'user'
  const { sum: rmSum } = useRoundMissSummary(open && rmOk && rmOpen)
  // 표①·표②는 라운드 열이 서로 포개져 보여야 하므로, 한쪽을 가로 스크롤하면
  // 다른 쪽도 같은 위치로 맞춘다(폭은 이미 같은 grid-template-columns라 동일하니
  // 스크롤 위치만 맞추면 된다).
  const ddongScrollRef = useRef(null)
  const resultScrollRef = useRef(null)
  // ③ 과거 이력 메모 — 경기 하나가 아니라 '이 리그+시즌+라운드' 하나에 메모 하나뿐이다
  // (특정 두 팀이 아니라 그 라운드 전체를 보고 남기는 생각이라 my_picks와 별도 저장).
  const [seasonMemo, setSeasonMemo] = useState('')
  const [savedSeasonMemo, setSavedSeasonMemo] = useState('')
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

  // season_stats와 별개 API — season_notes는 (code,scope,S,R) 단위라 시즌 지표
  // 데이터가 없어도(예: 표본 자체가 없는 라운드) 메모는 남길 수 있어야 한다.
  useEffect(() => {
    const ready = season && season !== 'ALL' && round && round !== 'ALL'
    if (!ready) {
      setSeasonMemo('')
      setSavedSeasonMemo('')
      return undefined
    }
    let cancelled = false
    api
      .get(
        `/api/leagues/${code}/season_note?scope=${scope}` +
          `&season=${encodeURIComponent(season)}&round=${encodeURIComponent(round)}`
      )
      .then((res) => {
        if (cancelled) return
        setSeasonMemo(res?.memo || '')
        setSavedSeasonMemo(res?.memo || '')
      })
      .catch(() => {
        if (!cancelled) {
          setSeasonMemo('')
          setSavedSeasonMemo('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, season, round])

  function saveSeasonMemoIfChanged(next) {
    setSeasonMemo(next)
    if (next === savedSeasonMemo) return
    setSavedSeasonMemo(next)
    api
      .post(`/api/leagues/${code}/season_note`, { scope, season, round, memo: next || null })
      .catch(() => {
        // 저장 실패 시 되돌린다
        setSeasonMemo(savedSeasonMemo)
        setSavedSeasonMemo(savedSeasonMemo)
      })
  }

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
        {/* ①(라운드별 똥배 격자)이 없으면 '어느 값이 이번 라운드와 같은 똥배인지'도 뜻이 없어
            같이 뺀다(2026-09-27 사용자 지정: "ss-bar 이번라운드 똥배 배당률 나열되는거 삭제") —
            기타경기 전용, hide1and3=false인 기존 6대리그·K1·K2는 그대로 나온다. */}
        {!hide1and3 && focus.size > 0 && (
          <span className="ss-bar-focus">
            이번 라운드 똥배:{' '}
            {[...focus].map((v) => (
              <b key={v}>{v.toFixed(2)}</b>
            ))}
          </span>
        )}
        {/* '판정'·내픽 적중 뱃지(2026-09-27 삭제 — 사용자 지정: "ss-bar에 판정 선택 판정 이 뱃지
            삭제해줘"). 기타경기는 내픽·시스템판정 둘 다 추적하지 않아 항상 0건(0.0%)으로만 나와
            의미 없는 뱃지였다 — 기타경기 전용(hide1and3)으로만 뺀다. 6대리그·K1·K2는 그대로 나온다. */}
        {!hide1and3 && (
          <>
            <span className="league-summary-divider" aria-hidden="true" />
            <span className="league-summary-pick-group">
              <span className="league-summary-pick-label">판정</span>
              <PickSummaryBar summary={seasonSummary.system} />
            </span>
            <span className="league-summary-divider" aria-hidden="true" />
            <PickSummaryBar summary={seasonSummary.pick} />
          </>
        )}
      </div>

      {/* 시즌 지표가 접힌 상태에서도 경기별 세팅값은 보인다(2026-10-10 사용자 지정) — 펼치면 ⑤에 같은 표가 들어 있다. */}
      {!open && rmOk && RM_LEAGUES.includes(code) && (
        <div className="ss-body">
          <RoundMissGames lg={code} season={data.season} round={Number(String(data.round).replace(/\D/g, ''))} mkt={rmMkt} />
        </div>
      )}

      {open && (
        <div className="ss-body">
          {/* ① 똥배 격자 — 결과별로 라운드마다 어떤 배당이 나왔는지 */}
          {!hide1and3 && (
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
          )}

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
          {!hide1and3 && (
          <div className="ss-block">
            <div className="ss-title">
              <button className="ss-fold ss-fold-sub" onClick={() => setHistoryOpen((v) => !v)}>
                {historyOpen ? '◂' : '▸'}
              </button>
              ③ {data.round} 과거 이력
              <span className="ss-hint">시즌마다 이 라운드의 결과 분포와 똥배 경기 (최근 시즌 순)</span>
              {/* 타이틀 줄 안에 둬서 ③을 접어도(historyOpen=false) 메모는 계속 보이게 한다. */}
              <RichMemoInput
                className="ss-history-memo"
                value={seasonMemo}
                placeholder="이 라운드에 대한 생각을 입력해주세요"
                onCommit={saveSeasonMemoIfChanged}
              />
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
          )}

          {/* ④ 시즌별 · ⑤ 경기별 세팅값(2026-10-10 사용자 지정 — 예전 '④ 라운드별 판정' 하나에 둘이 들어 있던 것을 두 블록으로 나눔).
              판정 = 배변 시스템 판정. 위 '판정 기준/국배 세팅값 기준' 스위치는 ④·⑤에 같이 걸린다. */}
          {rmOk && (!rmSum || rmSum.leagues.some((L) => L.code === code)) && (() => {
            const rn = Number(String(data.round).replace(/\D/g, ''))
            return (
              <>
                <div className="ss-block">
                  <div className="ss-title">
                    <button className="ss-fold ss-fold-sub" onClick={() => setRmOpen((v) => !v)}>
                      {rmOpen ? '◂' : '▸'}
                    </button>
                    ④ {LEAGUE_LABEL[code] || code} {rn}R 시즌별
                    {rmOpen && <MarketSwitch mkt={rmMkt} setMkt={setRmMkt} />}
                    {rmOpen && (
                      <RoundMissMemo lg={code} season={data.season} round={rn} kind="tab" placeholder="이 라운드 판정에 대한 생각을 입력해주세요" />
                    )}
                  </div>
                  {rmOpen && (rmSum ? (
                    <RoundMissDetail sum={rmSum} lg={code} season={data.season} round={rn} mkt={rmMkt} noGames noHead />
                  ) : <p className="ss-hint">라운드별 판정 계산 중… (처음 한 번은 5초쯤 걸립니다)</p>)}
                </div>
                <div className="ss-block">
                  <div className="ss-title">
                    <button className="ss-fold ss-fold-sub" onClick={() => setRmGamesOpen((v) => !v)}>
                      {rmGamesOpen ? '◂' : '▸'}
                    </button>
                    ⑤ {data.season} {LEAGUE_LABEL[code] || code} {rn}R 경기별 세팅값
                    <RoundMissMemo lg={code} season={data.season} round={rn} kind="games" placeholder="이 라운드 경기별 세팅값에 대한 생각을 입력해주세요" />
                  </div>
                  {rmGamesOpen && <RoundMissGames lg={code} season={data.season} round={rn} mkt={rmMkt} noHead />}
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
