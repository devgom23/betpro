import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { LEAGUE_LABEL, useRoundDetail, useRoundMissSummary } from './useRoundMiss'
import { myPickStyle } from '../LeagueTable/columnGroups'
import MatchDetailModal from '../MatchDetailModal/MatchDetailModal'
import RoundMissMemo from './RoundMissMemo'
import './RoundMiss.css'

// 라운드별 판정 빗나감(2026-10-10 사용자 지정 — 엑셀 '라운드마다 속성'을 시즌분석에 자동화).
// 세팅값 = 배변 판정(국배·해배) — 블루(정 쪽) / 레드(플 쪽). 빗나감 = 세팅과 반대로 나온 경기:
//   정배→플핸 = 세팅 블루인데 무·역 / 플핸→정배 = 세팅 레드인데 핸승·핸무.
// 판정은 그 라운드 첫 경기보다 앞선 경기만으로 다시 센 값이다(api/round_miss.py) — 지난 시즌 판정이 미래를 보지 않게.
// 표는 사용자 요청대로 라운드·시즌이 가로축이다(엑셀은 세로였다).

const RT_TEXT = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }
const RT_CLS = { 1: 'blue', 2: 'green', 3: 'gray', 4: 'red' }
// 내 예측(2026-10-10 사용자 지정) — 이 판정이 맞을 것 같은 정도. 경기 전에만 고르고, 끝나면 읽기 전용 + 맞았는지 표시.
const PREDS = ['확신', '맞겠지', '애매해', '틀릴듯']
const PRED_CLS = { 확신: 'rm-p-sure', 맞겠지: 'rm-p-likely', 애매해: 'rm-p-unsure', 틀릴듯: 'rm-p-unlikely' }
const MIN_SEASON = '20-21'
const MARKET = [['v', '판정 기준'], ['k', '국배 세팅값 기준']]   // 기본 = 시스템 판정(2026-10-10 사용자 지정)

const missOf = (side, rt) => (side === 1 && (rt === 3 || rt === 4)) || (side === -1 && (rt === 1 || rt === 2))

// 요약 배열 [전체, 결과, 세팅, 정→플 무, 정→플 역, 플→정 핸무, 플→정 핸승, 그중 엇(정), 그중 엇(플)] 풀기
function unpack(a) {
  if (!a) return null
  const [tot, done, set, jpMu, jpYk, pjHm, pjHs, jpSp = 0, pjSp = 0] = a
  return { tot, done, set, jpMu, jpYk, pjHm, pjHs, jpSp, pjSp, jp: jpMu + jpYk, pj: pjHm + pjHs, miss: jpMu + jpYk + pjHm + pjHs }
}

// 엇갈림 판정이었던 경기 수 — 엇(정)은 정 쪽, 엇(플)은 플 쪽 판정이라 각각 정배→플핸, 플핸→정배 안에 들어 있다.
function SplitTag({ n, label }) {
  if (!n) return null
  return <small className="rm-sp" title={`이 중 ${label} 판정(국·해가 갈려 해 쪽 방향으로 센 경기)이 ${n}경기`}>{label} {n}</small>
}

function Sub({ parts }) {
  const shown = parts.filter(([n]) => n > 0)
  if (!shown.length) return null
  return (
    <small className="rm-sub">
      {shown.map(([n, label, cls], i) => <span key={label} className={cls}>{i ? ' ' : ''}{n}{label}</span>)}
    </small>
  )
}

// 같은 3줄(빗나감 / 정배→플핸 / 플핸→정배)을 라운드 표와 시즌 표가 같이 쓴다. ri = 줄 번호(0·1·2).
function countCell(x, ri) {
  if (!x) return { cls: 'rm-none', node: null }
  if (!x.done) return { cls: 'rm-none', node: <span className="gray">예정</span> }
  if (ri === 0) return { cls: x.miss >= 4 ? 'rm-hot' : '', node: <b>{x.miss}</b> }
  if (ri === 1) {
    return { cls: '', node: <>{x.jp || <span className="gray">·</span>}<SplitTag n={x.jpSp} label="엇(정)" /><Sub parts={[[x.jpMu, '무', 'gray'], [x.jpYk, '역', 'red']]} /></> }
  }
  return { cls: '', node: <>{x.pj || <span className="gray">·</span>}<SplitTag n={x.pjSp} label="엇(플)" /><Sub parts={[[x.pjHm, '핸무', 'green'], [x.pjHs, '핸승', 'blue']]} /></> }
}

const cx = (...a) => a.filter(Boolean).join(' ') || undefined

const ROW_LABELS = [
  ['빗나감', <>빗나간 경기</>],
  ['jp', <><span className="blue">정배</span> → <span className="red">플핸</span><small>정 쪽인데 무·역</small></>],
  ['pj', <><span className="red">플핸</span> → <span className="blue">정배</span><small>플 쪽인데 핸승·핸무</small></>],
]

export function MarketSwitch({ mkt, setMkt }) {
  return (
    <span className="rm-seg" role="tablist" aria-label="시장">
      {MARKET.map(([v, lab]) => (
        <button key={v} type="button" role="tab" aria-selected={mkt === v} className={mkt === v ? 'is-on' : ''} onClick={() => setMkt(v)}>{lab}</button>
      ))}
    </span>
  )
}

// ② 같은 라운드를 시즌별로(시즌이 가로) + ③ 이번 시즌 그 라운드의 경기별 세팅값 — 시즌분석과 리그 화면 ④가 같이 쓴다.
// 경기별 세팅값(③) — 단독으로도 쓴다(리그 화면 시즌 지표가 접힌 상태에서도 이 표는 보인다, 2026-10-10 사용자 지정).
// noHead — 리그 화면 시즌 지표 ⑤처럼 블록 제목·메모를 밖에서 달 때 이 카드의 제목 줄을 뺀다(2026-10-10).
export function RoundMissGames({ lg, season, round, mkt, noHead }) {
  const det = useRoundDetail(lg, round)
  const [preds, setPreds] = useState({})
  const [picks, setPicks] = useState({})
  const [detailRow, setDetailRow] = useState(null)      // 상세보기로 연 경기(2026-10-10 사용자 지정 — 경기 칸을 누르면 열림)
  const query = `league=${encodeURIComponent(lg)}&season=${encodeURIComponent(season)}&round=${round}`
  const loadPicks = () => api.get(`/api/round_miss/picks?${query}`).then((r) => setPicks(r?.picks || {})).catch(() => {})
  useEffect(() => {
    if (!lg || !round || !season) return undefined
    let alive = true
    setPreds({})
    setPicks({})
    api.get(`/api/round_miss/preds?${query}`).then((r) => alive && setPreds(r?.preds || {})).catch(() => {})
    api.get(`/api/round_miss/picks?${query}`).then((r) => alive && setPicks(r?.picks || {})).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lg, season, round])
  // 고르면 화면에 바로 반영하고 서버에는 뒤따라 저장한다(실패하면 되돌린다).
  const setPred = (g, value) => {
    const key = `${g.ht}|${g.at}`
    const before = preds[key] || ''
    const apply = (v) => setPreds((p) => { const n = { ...p }; if (v) n[key] = v; else delete n[key]; return n })
    apply(value)
    api.post('/api/round_miss/pred', { league: lg, season, round: Number(round), ht: g.ht, at: g.at, pred: value || null })
      .catch(() => apply(before))
  }
  const lgLabel = LEAGUE_LABEL[lg] || ''
  const sel = det?.seasons?.[season] || []
  // 경기 칸 너비를 전부 같게(2026-10-10 사용자 지정) — 가장 긴 글자를 모든 칸에 보이지 않게 깔아 둬서 표가 그 너비를 최소로 잡는다
  // (한글은 영문보다 넓어 글자 수가 아니라 폭으로 가장 긴 것을 고른다). 끝난 경기는 '홈 1:0 원정'처럼 점수가 들어가고,
  // 내 픽 줄은 '정(핸무/P-고민)'처럼 길 수 있어 그것까지 재서 가장 긴 것을 쓴다.
  const longest = sel.reduce((best, g) => {
    const pk = picks[`${g.ht}|${g.at}`]
    const cands = [`${g.ht} vs ${g.at}`, `${g.ht} 0:0 ${g.at}`, pk ? pickText(pk) : '', ...oddsLines(g).map((l) => l.map((x) => x.t).join(' / '))]
    return cands.reduce((b, txt) => (textWidth(txt) > textWidth(b) ? txt : b), best)
  }, '')
  const Sz = () => <span className="rm-sizer" aria-hidden="true">{longest}</span>
  // 요일이 바뀌는 첫 경기 칸에 굵은 왼쪽 선(2026-10-10 사용자 지정 — 토·일·월 구분). 머리글부터 내 픽 줄까지 모든 줄에 같은 칸.
  const dayStart = (i) => i > 0 && sel[i].wd !== sel[i - 1].wd
  const dc = (i, cls = '') => [cls, dayStart(i) ? 'rm-day-start' : ''].filter(Boolean).join(' ') || undefined

  return (
    <>
      {/* ③ 이번 라운드 경기별 세팅값 — 와이즈토토 순서, 요일로 묶음 */}
      <div className="rm-card">
        {!noHead && (
          <h3>
            {season} {lgLabel} {round}R — 경기별 세팅값
            <RoundMissMemo lg={lg} season={season} round={round} kind="games" placeholder="이 라운드 경기별 세팅값에 대한 생각을 입력해주세요" />
          </h3>
        )}
        {!det ? <p className="rm-note">불러오는 중…</p> : sel.length === 0 ? <p className="rm-note">{season < MIN_SEASON ? `${MIN_SEASON} 시즌부터 계산합니다` : '이 시즌에는 이 라운드가 없습니다'}</p> : (
          <div className="rm-scroll">
            <table className="rm-table rm-games">
              <thead>
                <tr>
                  <th className="rm-lab" rowSpan={2}>{round} Round</th>
                  {groupByDay(sel).map((g, gi) => (
                    <th key={g.key} colSpan={g.n} className={[g.wd === '토' ? 'blue' : g.wd === '일' ? 'red' : '', gi > 0 ? 'rm-day-start' : ''].filter(Boolean).join(' ') || undefined}>{g.wd}요일</th>
                  ))}
                </tr>
                <tr>{sel.map((g, i) => <th key={i} className={dc(i)} title={`${g.ht} vs ${g.at}`}>{i + 1}경기<Sz /></th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <th className="rm-lab">판정<small>(배변 시스템 판정)</small></th>
                  {sel.map((g, i) => <td key={i} className={dc(i, missOf(g.v, g.rt) && mkt === 'v' ? 'rm-bad' : '')}><Setting side={g.v} split={g.vs} /><Sz /></td>)}
                </tr>
                <tr>
                  <th className="rm-lab">국배 세팅값</th>
                  {sel.map((g, i) => <td key={i} className={dc(i, missOf(g.k, g.rt) && mkt === 'k' ? 'rm-bad' : '')}><Setting side={g.k} weak={g.kw} /><Sz /></td>)}
                </tr>
                <tr>
                  <th className="rm-lab">결과</th>
                  {sel.map((g, i) => (
                    <td key={i} className={dc(i)}>
                      {g.rt ? <span className={RT_CLS[g.rt]}>{RT_TEXT[g.rt]}</span> : g.dd ? null : <span className="gray">예정</span>}
                      {g.dd && (
                        <span className={g.rt ? 'rm-sub rm-dd' : 'rm-dd'} title="국내 초기배당 1.49 이하 — 리그 표의 똥 순번과 같음(숫자는 정배배당)">
                          {g.dd} {g.ddo !== null ? g.ddo.toFixed(2) : ''}
                        </span>
                      )}
                      <Sz />
                    </td>
                  ))}
                </tr>
                <tr className="rm-teams">
                  <th className="rm-lab">경기</th>
                  {sel.map((g, i) => (
                    <td
                      key={i}
                      className={dc(i, picks[`${g.ht}|${g.at}`]?.done ? 'rm-open rm-entered' : 'rm-open')}
                      title={picks[`${g.ht}|${g.at}`]?.done ? '누르면 상세보기 — 밑줄 = 내픽·상세픽·의견·배당 클릭·판정·구간·상대·표본을 전부 입력한 경기' : '누르면 상세보기'}
                      onClick={() => setDetailRow({ S: season, R: `${round}R`, HT: g.ht, AT: g.at })}
                    >
                      <GameLabel g={g} /><Sz />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="rm-lab">배당<small>국내 초기 · 핸디 ±1</small></th>
                  {sel.map((g, i) => {
                    const marks = new Set(picks[`${g.ht}|${g.at}`]?.marks || [])
                    return (
                      <td key={i} className={dc(i, 'rm-odds-cell')}>
                        {oddsLines(g).map((line, li) => (
                          <span key={li} className="rm-odds-line" title={li === 0 ? '국내 초기 승/무/패' : `국내 초기 핸디 ${khText(g) || ''} 승/무/패`}>
                            {/* 한 줄 = 기준점 칸 · 승 · / · 무 · / · 패 · 같은 폭의 빈 칸. 양끝 칸 폭이 같아 숫자가 가운데에 오고,
                                두 줄의 승·무·패는 자릿수와 상관없이 같은 칸에 놓인다 */}
                            <span className="rm-odds-pre">{li === 1 ? khText(g) : ''}</span>
                            {line.map((x, xi) => (
                              <Fragment key={x.k}>
                                {xi > 0 && <span className="rm-odds-sep">/</span>}
                                <span className={`rm-odds-n${marks.has(x.k) ? ' rm-odds-mark' : ''}`}>{x.t}</span>
                              </Fragment>
                            ))}
                            <span className="rm-odds-pre" aria-hidden="true" />
                          </span>
                        ))}
                        <Sz />
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <th className="rm-lab">내 예측<small>(판정이 맞을지)</small></th>
                  {sel.map((g, i) => {
                    const v = preds[`${g.ht}|${g.at}`] || ''
                    const side = mkt === 'k' ? g.k : g.v
                    // 끝난 경기만 채점 — 확신·맞겠지는 판정이 맞아야 ✓, 틀릴듯은 빗나가야 ✓, 애매해는 채점하지 않는다
                    const graded = g.rt && side && v && v !== '애매해'
                    const ok = graded ? (v === '틀릴듯') === missOf(side, g.rt) : null
                    return (
                      <td key={i} className={dc(i, 'rm-pred-cell')}>
                        <select
                          className={`rm-pred ${PRED_CLS[v] || ''}`}
                          value={v}
                          disabled={!!g.rt}
                          title={g.rt ? '경기가 끝나 예측은 바꿀 수 없습니다(읽기 전용)' : '이 판정이 맞을 것 같은 정도'}
                          onChange={(e) => setPred(g, e.target.value)}
                        >
                          <option value="">—</option>
                          {PREDS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        {ok !== null && <span className={ok ? 'rm-pred-ok' : 'rm-pred-no'}>{ok ? '✓' : '✗'}</span>}
                        <Sz />
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <th className="rm-lab">내 픽<small>내픽(상세픽/의견)</small></th>
                  {sel.map((g, i) => (
                    <td key={i} className={dc(i, 'rm-pick-cell')} style={myPickStyle(picks[`${g.ht}|${g.at}`]?.pick) || undefined}>
                      <MyPick pk={picks[`${g.ht}|${g.at}`]} />
                      <Sz />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {detailRow && (
        <MatchDetailModal
          code={lg}
          scope="master"
          row={detailRow}
          onClose={() => { setDetailRow(null); loadPicks() }}
        />
      )}
    </>
  )
}

// noGames — 경기별 세팅값(③)을 안 붙인다 · noHead — 제목 글자를 빼고 설명만(리그 화면 시즌 지표 ④·⑤로 나눠 그릴 때, 2026-10-10).
export function RoundMissDetail({ sum, lg, season, round, mkt, noGames, noHead }) {
  const det = useRoundDetail(lg, round)

  const lgLabel = sum.leagues.find((L) => L.code === lg)?.label || ''
  const seasonCols = [...sum.seasons].reverse()          // 오래된 시즌 → 올시즌(오른쪽 끝)
  const newest = sum.seasons[0]
  const pastRows = sum.seasons.filter((s) => s !== newest).map((s) => unpack(sum[mkt]?.[lg]?.[s]?.[round])).filter((x) => x && x.done > 0)
  const pastAvg = pastRows.length ? pastRows.reduce((a, x) => a + x.miss, 0) / pastRows.length : null

  return (
    <>
      {/* ② 같은 라운드, 시즌별 — 시즌이 가로 */}
      <div className="rm-card">
        <h3>
          {!noHead && `${lgLabel} ${round}R — 시즌별`}
          <span className="rm-note">{pastAvg !== null && `지난 시즌 평균 ${pastAvg.toFixed(1)}경기 빗나감 · `}같은 라운드 번호끼리 비교</span>
        </h3>
        <div className="rm-scroll">
          <table className="rm-table rm-seasons">
            <thead>
              <tr>
                <th className="rm-lab">시즌</th>
                {seasonCols.map((s) => <th key={s} className={s === season ? 'sel' : undefined}>{s === newest ? `${s} 올시즌` : s}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROW_LABELS.map(([key, label], ri) => (
                <tr key={key}>
                  <th className="rm-lab">{label}</th>
                  {seasonCols.map((s) => {
                    const cell = countCell(unpack(sum[mkt]?.[lg]?.[s]?.[round]), ri)
                    return <td key={s} className={cx(cell.cls, s === season && 'sel')}>{cell.node}</td>
                  })}
                </tr>
              ))}
              <tr>
                <th className="rm-lab">경기 목록<small>(점수 · 결과)</small></th>
                {seasonCols.map((s) => {
                  const gl = (det?.seasons?.[s] || []).filter((g) => g.rt && missOf(g[mkt], g.rt))
                  return (
                    <td key={s} className={`rm-list${s === season ? ' sel' : ''}`}>
                      {!det ? <span className="gray">…</span> : gl.length === 0 ? <span className="gray">·</span> : gl.map((g) => (
                        <span key={`${g.ht}-${g.at}`} className={`rm-game ${RT_CLS[g.rt]}`}>
                          {g.ht} vs {g.at} <small>({g.hs}:{g.as} {RT_TEXT[g.rt]}{mkt === 'v' && g.vs ? ` · 엇(${g.v === 1 ? '정' : '플'})` : ''})</small>
                        </span>
                      ))}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {!noGames && <RoundMissGames lg={lg} season={season} round={round} mkt={mkt} />}
    </>
  )
}

export default function RoundMiss({ season, selCol, leagues }) {
  const { sum, error } = useRoundMissSummary()
  const [mkt, setMkt] = useState('v')
  const [lg, setLg] = useState('')
  const [round, setRound] = useState(null)

  // 처음 고르는 리그·라운드 — 위 회차 표에서 고른 회차의 첫 리그와 그 라운드(없으면 라리가 최근 라운드)
  const bySeason = sum?.[mkt]?.[lg]?.[season] || {}
  const playedRounds = Object.keys(bySeason).map(Number).filter((r) => bySeason[r][1] > 0).sort((a, b) => a - b)
  useEffect(() => {
    if (!sum) return
    const codes = (leagues || sum.leagues).map((L) => L.code)
    setLg((cur) => (selCol && codes.find((c) => selCol.rounds?.[c] !== undefined)) || cur || codes[0])
  }, [sum, selCol?.key, leagues])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sum || !lg) return
    const want = selCol?.rounds?.[lg]
    const last = playedRounds.length ? playedRounds[playedRounds.length - 1] : 1
    setRound(want !== undefined ? want : last)
    // 회차·리그·시즌이 바뀔 때만 다시 고른다(라운드를 직접 누른 뒤에는 건드리지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sum, lg, season, selCol?.key])

  const maxRound = useMemo(() => {
    let m = 0
    Object.values(sum?.[mkt]?.[lg] || {}).forEach((rs) => Object.keys(rs).forEach((r) => { m = Math.max(m, Number(r)) }))
    return m
  }, [sum, mkt, lg])

  if (error) return <section className="sa-section"><p className="sa-error">라운드별 판정 빗나감을 불러오지 못했습니다 — {error}</p></section>
  if (!sum) return <section className="sa-section"><p className="rm-note">라운드별 판정 빗나감 계산 중… (처음 한 번은 5초쯤 걸립니다)</p></section>

  const tooOld = season < sum.minSeason
  const lgLabel = sum.leagues.find((L) => L.code === lg)?.label || ''
  const rounds = Array.from({ length: maxRound }, (_, i) => i + 1)
  // 올시즌 평균(라운드당 빗나감) — 결과가 다 난 라운드만
  const avgOf = (rs) => {
    const xs = rs.map(unpack).filter((x) => x && x.done > 0)
    if (!xs.length) return null
    return xs.reduce((a, x) => a + x.miss, 0) / xs.length
  }
  const seasonAvg = avgOf(Object.values(bySeason))
  return (
    <section className="sa-section rm rm-wrap">
      <h2>라운드별 판정 빗나감</h2>
      <div className="rm-bar">
        <MarketSwitch mkt={mkt} setMkt={setMkt} />
        <span className="rm-seg" role="tablist" aria-label="리그">
          {sum.leagues.map((L) => (
            <button key={L.code} type="button" role="tab" aria-selected={lg === L.code} className={lg === L.code ? 'is-on' : ''} onClick={() => setLg(L.code)}>{L.label}</button>
          ))}
        </span>
        <RoundMissMemo lg={lg} season={season} round={round} kind="tab" placeholder="이 라운드 판정에 대한 생각을 입력해주세요" />
      </div>

      {/* ① 올시즌 라운드별 — 라운드가 가로 */}
      <div className="rm-card">
        <h3>
          {season} 시즌 {lgLabel} — 라운드별
          <span className="rm-note">라운드를 누르면 아래 ②③이 그 라운드로 바뀝니다{seasonAvg !== null && ` · 라운드당 평균 ${seasonAvg.toFixed(1)}경기 빗나감`}</span>
        </h3>
        {tooOld ? <p className="rm-note">{sum.minSeason} 시즌부터 계산합니다 — 위 시즌 선택을 바꿔 주세요</p> : (
          <div className="rm-scroll">
            <table className="rm-table">
              <thead>
                <tr>
                  <th className="rm-lab">라운드</th>
                  {rounds.map((r) => (
                    <th key={r} className={`rm-rd${r === round ? ' sel' : ''}`} onClick={() => setRound(r)}>{r}R</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROW_LABELS.map(([key, label], ri) => (
                  <tr key={key}>
                    <th className="rm-lab">{label}</th>
                    {rounds.map((r) => {
                      const cell = countCell(unpack(bySeason[r]), ri)
                      return <td key={r} className={cx(cell.cls, r === round && 'sel')}>{cell.node}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RoundMissDetail sum={sum} lg={lg} season={season} round={round} mkt={mkt} />
    </section>
  )
}

function Setting({ side, weak, split }) {
  if (!side) return <span className="gray">—</span>
  // 국·해 판정이 갈린 경기는 앱처럼 '엇(정)'·'엇(플)' — 해 쪽 방향으로 적중을 센다(phaseVerdict)
  if (split) {
    return <span className={`${side === 1 ? 'blue' : 'red'} rm-split`} title="국·해 판정이 갈린 경기 — 해 쪽 방향으로 셉니다">엇({side === 1 ? '정' : '플'})</span>
  }
  return <span className={side === 1 ? 'blue' : 'red'}>{side === 1 ? '블루' : '레드'}{weak ? '(약)' : ''}</span>
}

// 내 픽 — '내픽(상세픽/의견)'을 글자로만 보이고, 색은 칸 전체 배경으로(2026-10-10 사용자 지정 — 리그 표 내픽 칸과 같은 방식):
// 내픽이 정 쪽이면 파랑 배경·글자, 플핸 쪽이면 빨강 배경·글자, 그 밖은 일반. 정/플핸 쪽 구분은 리그 표와 같은 함수(myPickStyle)가 한다.
// 칸(td)에 스타일을 주므로 위 표 본문에서 적용한다. 읽기 전용 — 고치는 곳은 리그 표·상세보기다.
// 의견의 '축-정'·'축-플'은 '축정'·'축플'로 붙여 쓴다(2026-10-10 사용자 지정 — 'P-어렵' 같은 나머지는 저장된 글자 그대로).
const hitText = (h) => (h ? h.replace(/^축-/, '축') : '－')
const pickText = (pk) => `${pk.pick || '－'}(${pk.p || '－'} / ${hitText(pk.hit)})`
function MyPick({ pk }) {
  if (!pk || (!pk.pick && !pk.p && !pk.hit)) return <span className="gray">—</span>
  // 의견이 축정·축플(축 찍은 경기)이면 그 글자만 노랑(2026-10-10 사용자 지정)
  const h = hitText(pk.hit)
  return (
    <span className="rm-mypick" title="내가 찍은 내픽(상세픽/의견) — 고치는 곳은 리그 표·상세보기">
      {pk.pick || '－'}({pk.p || '－'} / {h.startsWith('축') ? <span className="rm-axis">{h}</span> : h})
    </span>
  )
}

// 배당 줄(2026-10-10 사용자 지정) — 국내 초기 승/무/패 한 줄, 핸디(±1) 승/무/패 한 줄. 서버 g.o = [KW,KD,KL,KHW,KHD,KHL,KH].
// 상세보기 배당 표에서 찍은 칸(odds_mark의 칸 이름)은 노랑으로 — 국내 칸(KW~KHL)만 이 줄에 있다.
const ODDS_KEYS = [['KW', 'KD', 'KL'], ['KHW', 'KHD', 'KHL']]
const oddsLines = (g) => ODDS_KEYS.map((keys, li) => keys.map((k, i) => {
  const v = g.o?.[li * 3 + i]
  return { k, t: v === null || v === undefined ? '-' : v.toFixed(2) }
}))

// 핸디 기준점 — 둘째 줄 앞에 '-1)'·'+1)'(닫는 괄호만, 2026-10-10 사용자 지정). 기준점이 없으면 빈 글자.
const khText = (g) => (g.o?.[6] === null || g.o?.[6] === undefined ? '' : `${g.o[6] > 0 ? '+' : ''}${g.o[6]})`)

// 경기 칸 — 결과가 있으면 점수를 팀 사이에('아스널 1:0 리즈'), 없으면 'vs'.
// 정배 팀 파랑 · 역배 팀 빨강(2026-10-10 사용자 지정). 정배는 국내 초기 배당 기준(서버 round_miss._home_fav), 못 가리면 색 없음.
const SIDE_CLS = { 1: 'blue', '-1': 'red' }
function GameLabel({ g }) {
  const homeCls = SIDE_CLS[g.hf] || ''
  const awayCls = SIDE_CLS[-g.hf] || ''
  const mid = g.rt && g.hs !== null ? ` ${g.hs}:${g.as} ` : ' vs '
  return <><span className={homeCls}>{g.ht}</span>{mid}<span className={awayCls}>{g.at}</span></>
}

// 글자 폭 추정 — 한글·한자는 1, 영문·숫자·공백은 0.55
const textWidth = (s) => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.55), 0)

// 요일이 같은 경기끼리 묶어 머리글 칸(colspan)으로 — 순서(와이즈토토)는 그대로 둔다
function groupByDay(games) {
  const out = []
  games.forEach((g) => {
    const last = out[out.length - 1]
    if (last && last.wd === g.wd) last.n += 1
    else out.push({ key: `${out.length}-${g.wd}`, wd: g.wd, n: 1 })
  })
  return out
}
