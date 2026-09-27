import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import MMSampleModal from '../components/MMSampleModal/MMSampleModal'
import RtBadge from '../components/RtBadge/RtBadge'
import SeasonStats from '../components/SeasonStats/SeasonStats'
import './MiscMatchesPage.css'

// 기타경기(2026-09-27 사용자 지정) — 6대리그·K1·K2를 뺀 나머지 축구 경기를 프로토 회차별로
// 모아, 국배(국내 승무패)만으로 정무/플핸무를 판정한다. 26개 지표는 안 낸다(계산은
// api/misc_matches.py). 판정 표본이 적어도(사용자 지정: "다 내주고 표본적음 정도만 알려줘")
// 판정 자체는 내고 '표본적음' 태그만 붙인다.
const OUTCOME_BADGE = {
  적중: { background: 'var(--chip-yellow-bg)', color: 'var(--chip-yellow-fg)' },
  미적: { background: 'var(--chip-red-bg)', color: 'var(--chip-red-fg)' },
  보험: { background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-fg)' },
}
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))
// RT는 CLAUDE.md 도메인 용어 그대로 핸승/핸무/무/역(1~4) — 기타경기는 국내 핸디가 없어
// RT2(핸무)는 절대 안 나오지만, 이름은 앱 전체와 똑같이 맞춘다(사용자 지정: "결과는 핸승/핸무/무/역이지").
const RT_TEXT = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }
// DT = 'YYYY-MM-DD HH:MM:SS'(와이즈토토 원본 그대로, api/kr_crawler.py _to_row 참고) → '09.27 09:00'
function kickoff(dt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(dt || '')
  return m ? `${m[2]}.${m[3]} ${m[4]}:${m[5]}` : (dt || '-')
}

// mm-summary 숫자 — 밑줄 그어 누를 수 있게(사용자 지정: 누르면 그 결과만 걸러 본다).
// 다시 누르면 풀린다(active일 때 진한 색으로 '지금 이걸로 걸렀다'는 표시).
function SumNum({ active, className, onClick, children }) {
  return (
    <button type="button" className={`mm-sumnum${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

export default function MiscMatchesPage() {
  const [data, setData] = useState({ rows: [], summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [roundSel, setRoundSel] = useState('ALL')   // 상단 검색영역 — 회차 선택(사용자 지정: 한 줄로 나오는 select)
  const [lgSel, setLgSel] = useState('ALL')          // 상단 검색영역 — 리그(L, 와이즈토토 표기 리그명) 선택
  const [autoRoundDone, setAutoRoundDone] = useState(false)
  const [resultFilter, setResultFilter] = useState('ALL')   // mm-summary 숫자 클릭 — 'ALL'|'graded'|'hit'|'miss'|'pending'
  const [sampleSel, setSampleSel] = useState(null)          // 표본 칸 클릭 — {s,r,ht,at} 또는 null(닫힘)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get('/api/misc_matches'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function collect() {
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const res = await api.post('/api/misc_matches/collect', {})
      setNotice(`새 경기 ${res.added}건 · 배변 갱신 ${res.odds_updated}건 · 결과 채움 ${res.score_filled}건 (회차 ${res.rounds}개 확인${res.reason ? ` · ${res.reason}` : ''})`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // 상단 검색영역(회차·리그 select) — '한 줄로'는 select 자체가 늘 한 줄이라 자연히 지켜진다.
  const rounds = useMemo(() => [...new Set(data.rows.map((r) => `${r.S} ${r.R}`))].sort().reverse(), [data.rows])
  const leagues = useMemo(() => {
    const cnt = new Map()
    data.rows.forEach((r) => cnt.set(r.LG, (cnt.get(r.LG) || 0) + 1))
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([lg]) => lg)
  }, [data.rows])

  // mm-summary·표가 다 같이 보는 범위 — 회차·리그로 먼저 좁힌다(2026-09-27 사용자 지정: "회차가
  // 선택이 되면 회차별 정보만 보여줘" — 예전엔 서머리가 항상 전체 163건 기준이라 114회차를 골라도
  // 아직 배당이 안 열린 115·116회차 경기까지 '배당없음'에 섞여 82건으로 보였다. 82 중 78건이
  // 그 미래 회차였고, 114회차만 보면 진짜 배당없음은 7건이었다 — 이제 회차를 고르면 그 7건만 센다).
  const scoped = useMemo(() => data.rows.filter((r) => {
    if (roundSel !== 'ALL' && `${r.S} ${r.R}` !== roundSel) return false
    if (lgSel !== 'ALL' && r.LG !== lgSel) return false
    return true
  }), [data.rows, roundSel, lgSel])

  // api/misc_matches.py build_list와 정확히 같은 기준으로 나눈다. 국배가 있는데 판정을 못 낸
  // 건 표본없음, 국배 자체가 없는 건 배당없음.
  const resultOf = (r) => {
    if (r.outcome === '적중') return 'hit'
    if (r.outcome === '미적') return 'miss'
    if (r.outcome === '보험') return 'insure'
    if (r.verdict) return 'pending'
    return r.KW !== null && r.KL !== null ? 'no_sample' : 'no_odds'
  }

  // mm-summary 숫자 — scoped(지금 고른 회차·리그) 안에서 이 화면이 직접 센다(백엔드 summary는
  // 항상 전체 163건 기준이라 더 이상 안 쓴다).
  const s = useMemo(() => {
    let hit = 0, miss = 0, insure = 0, pending = 0, noSample = 0, noOdds = 0
    scoped.forEach((r) => {
      const k = resultOf(r)
      if (k === 'hit') hit += 1
      else if (k === 'miss') miss += 1
      else if (k === 'insure') insure += 1
      else if (k === 'pending') pending += 1
      else if (k === 'no_sample') noSample += 1
      else noOdds += 1
    })
    const decided = hit + miss
    return {
      total: scoped.length, graded: decided + insure, hit, miss, insure, pending,
      no_sample: noSample, no_odds: noOdds,
      rate: decided ? Math.round((hit / decided) * 10000) / 100 : null,
    }
  }, [scoped])

  const shown = useMemo(() => {
    if (resultFilter === 'ALL') return scoped
    return scoped.filter((r) => {
      const k = resultOf(r)
      return resultFilter === 'graded' ? (k === 'hit' || k === 'miss' || k === 'insure') : k === resultFilter
    })
  }, [scoped, resultFilter])

  // 기본값 = '지금 진행 중인 회차'(사용자 지정) — 결과가 아직 안 나온 경기가 있는 회차 중
  // 가장 이른(작은 번호) 것. 새로고침할 때마다 다시 계산해서, 매번 같은 기준으로 114회차처럼
  // 지금 진행 중인 회차가 뜬다(전에는 기본이 '전체'라 표가 116회차부터 나열돼 헷갈렸다).
  useEffect(() => {
    if (autoRoundDone || !data.rows.length) return
    const pending = [...new Set(data.rows.filter((r) => r.HS === null).map((r) => `${r.S} ${r.R}`))]
    const numOf = (x) => Number((/(\d+)회차/.exec(x) || [])[1] || 0)
    pending.sort((a, b) => numOf(a) - numOf(b))
    setRoundSel(pending[0] || 'ALL')
    setAutoRoundDone(true)
  }, [data.rows, autoRoundDone])

  // '시즌 지표'(기타경기는 ①·③을 뺀 ②만) — 회차를 하나 골랐을 때만 뜻이 있다.
  const [seasonPart, roundPart] = roundSel === 'ALL' ? [null, null] : roundSel.split(' ')

  return (
    <div className="mm-page">
      <div className="mm-title-row">
        <h2 className="mm-title">⚽ 기타경기</h2>
        <button className="mm-btn is-pri" disabled={busy} onClick={collect}>{busy ? '가져오는 중...' : '🔄 회차정보 가져오기'}</button>
        {notice && <span className="mm-notice">{notice}</span>}
      </div>
      <p className="mm-desc">
        6대리그·K1·K2를 뺀 나머지 축구 경기를 프로토 회차별로 모읍니다. 판정(정무/플핸무)은 국배(국내 승무패)만 보고,
        비슷한 국배의 6대리그+K1+K2 과거 경기가 실제로 어떻게 났는지로 정합니다 — 26개 지표는 계산하지 않습니다.
        <b> 표본이 적어도 판정은 내리고 &apos;표본적음&apos;만 따로 표시합니다.</b>
      </p>

      {error && <p className="mm-error">{error}</p>}
      {loading && <p className="mm-empty">불러오는 중...</p>}

      {/* 정보 구조: 회차(무엇을 볼지) 선택이 가장 위, 그 아래가 그 범위의 서머리(2026-09-27
          사용자 지정 — "회차 선택이 가장 위 그아래 서머리 영역이 위치하게"). */}
      {!loading && data.rows.length > 0 && (
        <div className="mm-search">
          <span className="mm-k">회차</span>
          <select value={roundSel} onChange={(e) => setRoundSel(e.target.value)}>
            <option value="ALL">전체</option>
            {rounds.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <span className="mm-k">리그</span>
          <select value={lgSel} onChange={(e) => setLgSel(e.target.value)}>
            <option value="ALL">전체</option>
            {leagues.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      )}

      {!loading && data.rows.length > 0 && (
        <div className="mm-summary">
          <div><small>{roundSel === 'ALL' ? '전체 경기' : '이 회차 경기'}</small><b>{s.total.toLocaleString()}</b></div>
          <div>
            <small>결과 난 경기</small>
            <SumNum active={resultFilter === 'graded'} onClick={() => setResultFilter((f) => (f === 'graded' ? 'ALL' : 'graded'))}>
              {s.graded.toLocaleString()}
            </SumNum>
          </div>
          <div>
            <small>판정 적중</small>
            <SumNum className="mm-pos" active={resultFilter === 'hit'} onClick={() => setResultFilter((f) => (f === 'hit' ? 'ALL' : 'hit'))}>
              {s.hit.toLocaleString()}
            </SumNum>
          </div>
          <div>
            <small>판정 미적</small>
            <SumNum className="mm-neg" active={resultFilter === 'miss'} onClick={() => setResultFilter((f) => (f === 'miss' ? 'ALL' : 'miss'))}>
              {s.miss.toLocaleString()}
            </SumNum>
          </div>
          <div>
            {/* 보험(2026-09-27 추가) — 정무 픽인데 결과가 '무'로 난 경우처럼, 메인은 빗나갔지만
                보험 다리는 맞은 경우다. 적중·미적처럼 결과가 이미 나온 경기라 '결과 난 경기' 합에 들어간다. */}
            <small>판정 보험</small>
            <SumNum active={resultFilter === 'insure'} onClick={() => setResultFilter((f) => (f === 'insure' ? 'ALL' : 'insure'))}>
              {s.insure.toLocaleString()}
            </SumNum>
          </div>
          <div>
            <small>결과 예정</small>
            <SumNum active={resultFilter === 'pending'} onClick={() => setResultFilter((f) => (f === 'pending' ? 'ALL' : 'pending'))}>
              {s.pending.toLocaleString()}
            </SumNum>
          </div>
          <div>
            {/* 표본없음/배당없음(2026-09-27 사용자 지정 — "결과 예정 옆에 표본없음, 배당없음 등의
                지표가 나와서 합이 163이 되어야". 국배는 있는데 비슷한 과거 경기를 못 찾아 판정 자체를
                못 낸 경기 — 한국M vs 베트남M처럼 배당이 너무 극단적인 경우다. */}
            <small>표본없음</small>
            <SumNum active={resultFilter === 'no_sample'} onClick={() => setResultFilter((f) => (f === 'no_sample' ? 'ALL' : 'no_sample'))}>
              {s.no_sample.toLocaleString()}
            </SumNum>
          </div>
          <div>
            {/* 프로토가 이 경기에 국배 자체를 안 준 경우 — 결과가 나와도 판정을 낼 방법이 없다. */}
            <small>배당없음</small>
            <SumNum active={resultFilter === 'no_odds'} onClick={() => setResultFilter((f) => (f === 'no_odds' ? 'ALL' : 'no_odds'))}>
              {s.no_odds.toLocaleString()}
            </SumNum>
          </div>
          <div><small>적중률(예정 제외)</small><b>{s.rate === null ? '-' : `${s.rate}%`}</b></div>
          {/* 필터 해제 버튼(2026-09-27 사용자 지정 — "필터 해제 버튼은 서머리 영역에 위치시켜줘") */}
          {resultFilter !== 'ALL' && (
            <div className="mm-summary-clear">
              <small className="mm-muted">{shown.length.toLocaleString()} / {s.total.toLocaleString()}건 표시 중</small>
              <button type="button" className="mm-btn" onClick={() => setResultFilter('ALL')}>
                {{ graded: '결과 난 경기', hit: '판정 적중', miss: '판정 미적', insure: '판정 보험', pending: '결과 예정', no_sample: '표본없음', no_odds: '배당없음' }[resultFilter]} 필터 해제
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && data.rows.length === 0 && <p className="mm-empty">아직 모은 경기가 없습니다 — 위 &apos;회차정보 가져오기&apos;를 눌러 주세요.</p>}

      {!loading && data.code && seasonPart && roundPart && (
        <SeasonStats code={data.code} scope={data.scope} season={seasonPart} round={roundPart} hide1and3 />
      )}

      {!loading && shown.length > 0 && (
        <div className="mm-wrap">
          <table className="mm-t">
            <thead>
              <tr>
                <th>회차</th><th>경기일시</th><th>리그</th><th>경기</th><th>똥배</th><th>국배 승/무/패 (초기)</th><th>배변(최신)</th>
                <th>국핸디 (초기)</th><th>배변(최신)</th><th>스코어</th><th>결과</th>
                <th>판정</th><th>표본</th><th>적중결과</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const v = r.verdict
                return (
                  <tr key={i}>
                    <td className="mm-muted">{r.S} {r.R}</td>
                    <td className="mm-muted">{kickoff(r.DT)}</td>
                    <td className="mm-muted">{r.LG}</td>
                    <td className="mm-l"><b>{r.HT}</b> <span className="mm-muted">vs</span> <b>{r.AT}</b></td>
                    <td>
                      {r.ddong && (
                        <span className={`mm-ddong${r.ddongsa ? ' is-sa' : ''}`} title={r.ddong && r.ddongsa === null ? '똥배(국배 1.49 이하) — 결과가 나오면 똥사 여부도 표시' : r.ddongsa ? '똥사 — 똥배인데 무·역이 나옴(정배가 완전히 무너짐)' : '똥배'}>
                          {r.ddongsa ? '똥사' : '똥배'}
                        </span>
                      )}
                    </td>
                    <td>{f2(r.KW)} / {f2(r.KD)} / {f2(r.KL)}</td>
                    <td className={r.EKW !== null && r.EKW !== r.KW ? 'mm-moved' : undefined}>
                      {r.EKW === null ? <span className="mm-muted">-</span> : `${f2(r.EKW)} / ${f2(r.EKD)} / ${f2(r.EKL)}`}
                    </td>
                    <td>{r.KHW === null ? <span className="mm-muted">-</span> : `${f2(r.KHW)} / ${f2(r.KHD)} / ${f2(r.KHL)}`}</td>
                    <td className={r.EKHW !== null && r.EKHW !== r.KHW ? 'mm-moved' : undefined}>
                      {r.EKHW === null ? <span className="mm-muted">-</span> : `${f2(r.EKHW)} / ${f2(r.EKHD)} / ${f2(r.EKHL)}`}
                    </td>
                    <td>
                      {r.HS === null ? <span className="mm-muted">예정</span> : (
                        <><span className={r.HS > r.AS ? 'mm-win' : undefined}>{r.HS}</span> : <span className={r.AS > r.HS ? 'mm-win' : undefined}>{r.AS}</span></>
                      )}
                    </td>
                    <td>{r.RT != null ? <RtBadge label={RT_TEXT[r.RT]} /> : <span className="mm-muted">-</span>}</td>
                    {/* 국배(KW/KL)가 있는데도 v가 없으면 '비슷한 배당의 과거 경기를 못 찾은 것'(표본없음) —
                        국배 자체가 없는 것(배당없음)과 원인이 다르다(2026-09-27 사용자 제보: 한국M vs
                        베트남M — KW 1.08 · KL 18.5처럼 배당은 있지만 너무 극단적이라 ±10칸 안에서도
                        비슷한 과거 경기가 하나도 없었다). */}
                    <td>
                      {v ? (
                        <span className={`mm-chip ${v.pick === '정무' ? 'is-blue' : 'is-red'}`}>{v.pick}</span>
                      ) : <span className="mm-muted">{r.KW !== null && r.KL !== null ? '표본없음' : '국배 없음'}</span>}
                    </td>
                    <td>
                      {v ? (
                        <button
                          type="button" className="mm-sample-btn"
                          onClick={() => setSampleSel({ s: r.S, r: r.R, ht: r.HT, at: r.AT })}
                          title={`±${v.tick}칸에서 찾음 · 핸승 ${v.pct[0]}% 무 ${v.pct[2]}% 정배패 ${v.pct[3]}% — 눌러서 표본 목록 보기`}
                        >
                          {v.n}건{v.weak && <span className="mm-weak"> 표본적음</span>}
                        </button>
                      ) : '-'}
                    </td>
                    <td>
                      {r.outcome ? <span className="mm-badge" style={OUTCOME_BADGE[r.outcome]}>{r.outcome}</span>
                        : v ? <RtBadge label="예정" />
                        : r.KW !== null && r.KL !== null
                          ? <span className="mm-muted" title="배당은 있지만 비슷한 과거 경기(±10칸 안)를 하나도 못 찾아 판정을 못 냈습니다.">표본없음</span>
                          : <span className="mm-muted" title="프로토가 이 경기에 배당 자체를 안 줍니다 — 결과를 기다리는 게 아니라 애초에 판정을 못 냅니다.">배당없음</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {sampleSel && (
        <MMSampleModal
          s={sampleSel.s} r={sampleSel.r} ht={sampleSel.ht} at={sampleSel.at}
          onClose={() => setSampleSel(null)}
        />
      )}
    </div>
  )
}
