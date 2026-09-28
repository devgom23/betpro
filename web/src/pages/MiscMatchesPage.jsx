import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import MMSampleModal from '../components/MMSampleModal/MMSampleModal'
import RtBadge from '../components/RtBadge/RtBadge'
import SeasonStats from '../components/SeasonStats/SeasonStats'
import StarButton, { nextStarLevel } from '../components/StarButton/StarButton'
import { pickPatchBody } from '../utils/pickSave'
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

// 국배·국핸디 승/무/패(2026-09-27 사용자 지정 — "정배쪽 text블루 역배쪽 text레드" → "국핸디도
// 승무패처럼 색상 넣어줘") — 배당이 낮은 쪽(=시장이 강하다고 본 정배, CLAUDE.md fav 정의)을
// 파랑, 높은 쪽(역배)을 빨강으로. favIsW는 호출하는 쪽에서 넘긴다 — 국핸디는 그 칸 자신의
// 숫자(KHW/KHL)가 아니라 '같은 시점 국배(KW/KL)'로 정배를 정한다(핸디 승/무/패 odds는 서로
// 비슷해서 자체적으로는 어느 쪽이 정배인지 잘 안 드러난다 — 실제 정배는 항상 국배 기준).
// favSide()로 초기·배변 각자 자기 시점 값으로 판단한다(정역반전이 있으면 두 칸 색이 달라진다).
function favSide(w, l) {
  return w !== null && l !== null && w !== l ? w < l : null
}

// 배변(최신) 칸의 '움직였다' 표시는 굵게 대신, 셀 자체를 보이거나 '-'로 가리는 걸로 바꿨다
// (2026-09-27 — "배변 되면 텍스트만 표시 해주고 배변이 안되면 - 해줘"). 안 움직인 경기는
// 초기 칸과 똑같은 숫자를 또 보여줄 필요가 없어서다 — 호출하는 쪽(아래 표)에서 판단해 넘긴다.
// flipTitle: 정역반전(초기·배변에서 정배 팀이 바뀜) 툴팁 — 있으면 ⇄를 붙인다(2026-09-28
// 사용자 지정 — "배변이 되면서 정역이 변경이 된 경기네... 12개사 판정에 사용했던" — 상세보기
// '12개 배당사' 표에서 회사 정배가 우리 정배와 반대일 때 쓰던 것과 같은 표시(mb-flip, ⇄)를
// 그대로 가져왔다. 예: 중국 vs 뉴질랜드 — 초기 KW 2.39<KL 2.55(중국 정배) → 배변 EKW
// 3.00>EKL 2.07(뉴질랜드 정배로 역전).
function OddsWDL({ w, d, l, favIsW, flipTitle }) {
  if (w === null && l === null) return <span className="mm-muted">-</span>
  const cls = (isFav) => (isFav === true ? 'mm-fav-txt' : isFav === false ? 'mm-dog-txt' : undefined)
  return (
    <>
      <span className={cls(favIsW)}>{f2(w)}</span>
      {' / '}
      <span>{f2(d)}</span>
      {' / '}
      <span className={cls(favIsW === null ? null : !favIsW)}>{f2(l)}</span>
      {flipTitle && <span className="mb-flip" title={flipTitle}>⇄</span>}
    </>
  )
}
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
      // 초기배당 채움(2026-09-28 사용자 제보 — "초기배당을 안가져오고 최신 배당만 가져오네")
      // — 프로토가 먼저 담아 둔 뒤에야 배당을 여는 미래 회차(115·116회차 등)라 처음엔 못 채웠던
      // 국배 초기를, 배당이 열린 지금 회차정보를 다시 가져오면서 채운 건수.
      // 핸디 채움(2026-09-28 — "+2핸디라고 해도 일단 가져오고 우리쪽에는 그냥 +-1로 만들어
      // 버려") — ±1 핸디가 없는 경기(대부분 배당 차이가 아주 큰 경기)는 프로토가 대신 연
      // ±2·±3.5 같은 다른 핸디 줄 중 ±1에 가장 가까운 것을 국핸디 칸에 채운다.
      setNotice(`새 경기 ${res.added}건 · 초기배당 채움 ${res.init_odds_filled}건 · 핸디 채움 ${res.handi_filled}건 · 배변 갱신 ${res.odds_updated}건 · 결과 채움 ${res.score_filled}건 (회차 ${res.rounds}개 확인${res.reason ? ` · ${res.reason}` : ''})`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // 별표·내픽(2026-09-27 사용자 지정 — "결과 컬럼 오른쪽으로 별표/내픽 컬럼 추가") — 저장은
  // 다른 리그와 완전히 같은 공용 API(/api/leagues/{code}/my_picks, web/src/utils/pickSave.js)를
  // 그대로 쓴다. No가 늘 비어 있어서(와이즈토토 크롤러가 안 줌) S·R·HT·AT로만 행을 찾는다.
  const sameMatch = (a, b) => a.S === b.S && a.R === b.R && a.HT === b.HT && a.AT === b.AT
  function patchRowLocal(match, patch) {
    setData((d) => ({ ...d, rows: d.rows.map((r) => (sameMatch(r, match) ? { ...r, ...patch } : r)) }))
  }
  function savePick(row, patch) {
    patchRowLocal(row, {
      ...(patch.important !== undefined ? { starred: patch.important } : {}),
      ...(patch.pick !== undefined ? { myPick: patch.pick } : {}),
    })
    const body = pickPatchBody(data.scope, { ...row, No: row.No ?? '' }, patch)
    api.post(`/api/leagues/${data.code}/my_picks`, body).catch((err) => setError(err.message))
  }
  function toggleStar(row) {
    savePick(row, { important: nextStarLevel(row.starred) })
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

  // 판정을 낼 기준(국배 또는 국핸디)이 하나라도 있는지 — api/misc_matches.py build_list의
  // q 판단과 같다(2026-09-28 — "판정도 국핸디 기반으로 낼 수 있게 해줘": 국배 자체가 없는
  // 경기도 국핸디로 대신 찾는다).
  const hasOddsBasis = (r) => (r.KW !== null && r.KL !== null) || (r.KHW !== null && r.KHL !== null)

  // api/misc_matches.py build_list와 정확히 같은 기준으로 나눈다. 판정 기준(국배·국핸디)이
  // 있는데 판정을 못 낸 건 표본없음, 둘 다 아예 없는 건 배당없음. 판정(v)은 있는데 경기가 이미
  // 끝났고 RT가 없는 건(2026-09-27 — 핸디 마켓 자체가 없어 채점 불가, _rt_from_score 정정과
  // 같이 생기는 경우)도 '결과 예정'이 아니라 표본없음 통에 넣는다 — 진짜 예정 경기와 섞이면 안 된다.
  const resultOf = (r) => {
    if (r.outcome === '적중') return 'hit'
    if (r.outcome === '미적') return 'miss'
    if (r.outcome === '보험') return 'insure'
    if (r.verdict) return r.HS === null ? 'pending' : 'no_sample'
    return hasOddsBasis(r) ? 'no_sample' : 'no_odds'
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

  // 표본 상세 팝업이 지금 보여줄 경기의 최신 행(별표·내픽 저장 직후에도 팝업이 새 값을 보게).
  const sampleRow = sampleSel
    ? data.rows.find((r) => r.S === sampleSel.s && r.R === sampleSel.r && r.HT === sampleSel.ht && r.AT === sampleSel.at)
    : null

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
        <b> 표본이 적어도 판정은 내립니다 — 표본 칸의 괄호 안 숫자가 [핸승/핸무/무/역] 건수입니다.</b>
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
            <small>적중</small>
            <SumNum className="mm-pos" active={resultFilter === 'hit'} onClick={() => setResultFilter((f) => (f === 'hit' ? 'ALL' : 'hit'))}>
              {s.hit.toLocaleString()}
            </SumNum>
          </div>
          <div>
            <small>미적</small>
            <SumNum className="mm-neg" active={resultFilter === 'miss'} onClick={() => setResultFilter((f) => (f === 'miss' ? 'ALL' : 'miss'))}>
              {s.miss.toLocaleString()}
            </SumNum>
          </div>
          <div>
            {/* 보험(2026-09-27 추가) — 정무 픽인데 결과가 '무'로 난 경우처럼, 메인은 빗나갔지만
                보험 다리는 맞은 경우다. 적중·미적처럼 결과가 이미 나온 경기라 '결과 난 경기' 합에 들어간다. */}
            <small>보험</small>
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
                {{ graded: '결과 난 경기', hit: '적중', miss: '미적', insure: '보험', pending: '결과 예정', no_sample: '표본없음', no_odds: '배당없음' }[resultFilter]} 필터 해제
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
                <th>회차</th><th>경기일시</th><th>리그</th><th>경기</th><th>스코어</th><th>결과</th>
                <th>별표</th><th>내픽</th>
                <th>표본</th><th>판정</th><th>적중결과</th><th>똥배</th>
                <th>국배 승/무/패 (초기)</th><th>배변(최신)</th><th>국핸디 (초기)</th><th>배변(최신)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const v = r.verdict
                // 국핸디 칸은 자기 숫자(KHW/KHL)가 아니라 같은 시점 국배(KW/KL)로 정배를 정한다
                // (2026-09-27 — "국핸디도 승무패처럼 색상 넣어줘"). 배변은 최신 국배가 있으면
                // 그걸로, 없으면(안 움직였으면) 초기 국배 그대로 — 국핸디 배변 칸도 같은 규칙.
                // 국배(KW/KL) 자체가 없는 경기(2026-09-28 사용자 지정 — "초 승무패 배당은
                // 안주고 핸디 배당만 주는 경기가 있네... 국핸디 기반으로 배당이 낮은쪽이
                // 정배" — 정배가 워낙 강해 프로토가 승무패 자체를 안 여는 경우, 예: 일본W
                // vs 필리핀W)는 국핸디(KHW/KHL)로 대신 정배를 정한다 — api/misc_matches.py
                // _kh_and_fav와 같은 규칙.
                const favInit = favSide(r.KW, r.KL) ?? favSide(r.KHW, r.KHL)
                const favFinal = favSide(r.EKW ?? r.KW, r.EKL ?? r.KL) ?? favSide(r.EKHW ?? r.KHW, r.EKHL ?? r.KHL)
                // 정역반전(2026-09-28 사용자 지정) — 초기·배변에서 정배 팀 자체가 바뀐 경기만.
                const flipTitle = favInit !== null && favFinal !== null && favInit !== favFinal
                  ? `정역반전 — 초기 정배 ${favInit ? r.HT : r.AT} → 배변 정배 ${favFinal ? r.HT : r.AT}`
                  : null
                return (
                  <tr key={i}>
                    <td className="mm-muted">{r.S} {r.R}</td>
                    <td className="mm-muted">{kickoff(r.DT)}</td>
                    <td className="mm-muted">{r.LG}</td>
                    <td className="mm-l"><b>{r.HT}</b> <span className="mm-muted">vs</span> <b>{r.AT}</b></td>
                    {/* 스코어·결과는 경기 오른쪽으로(2026-09-27 사용자 지정) */}
                    <td>
                      {r.HS === null ? <span className="mm-muted">예정</span> : (
                        <><span className={r.HS > r.AS ? 'mm-win' : undefined}>{r.HS}</span> : <span className={r.AS > r.HS ? 'mm-win' : undefined}>{r.AS}</span></>
                      )}
                    </td>
                    {/* 2026-09-27 정정 — 사용자 제보: "3:2인데 왜 결과가 핸무가 아니라 핸승이지"
                        (아이티 vs 트리니다). 예전엔 핸디 마켓(국핸디 KHW~) 유무와 상관없이 그냥
                        승/무/패만 보고 이겼으면 무조건 핸승으로 매겼다 — 틀렸다. 프로토가 이
                        경기들에 여는 핸디는 항상 '정배 -1'이라(api/kr_crawler.py 주석: "리그 표는
                        ±1 핸디만 담는다"), 정배가 2점차 이상 이기면 핸승 · 정확히 1점차면 핸디
                        그대로 적중(핸무) · 실제로 비기면 무 · 정배가 지면 역으로 고쳤다. 핸디
                        마켓 자체가 없던 경기(국핸디 칸이 '-')는 핸승·핸무를 가를 기준이 없어
                        RT를 안 낸다 — 스코어는 나왔는데 결과가 '핸디없음'으로 뜨는 게 이 경우다. */}
                    <td>
                      {r.RT != null ? <RtBadge label={RT_TEXT[r.RT]} />
                        : r.HS !== null ? <span className="mm-muted" title="이 경기는 프로토가 1점 핸디 마켓을 안 열어서, 핸승·핸무를 가를 기준이 없습니다.">핸디없음</span>
                        : <span className="mm-muted">-</span>}
                    </td>
                    {/* 별표·내픽은 결과 오른쪽으로(2026-09-27 사용자 지정 — "결과 컬럼 오른쪽으로
                        별표/내픽 컬럼 추가 내픽 컬럼 선택하면 표본상세 팝업이 뜨고 거기서 내픽
                        선택할 수 있게"). 다른 리그의 별표·내픽과 저장소가 완전히 같다. */}
                    <td>
                      <StarButton level={r.starred} onClick={() => toggleStar(r)} />
                    </td>
                    <td>
                      <button
                        type="button" className="mm-sample-btn"
                        onClick={() => setSampleSel({ s: r.S, r: r.R, ht: r.HT, at: r.AT })}
                        title="눌러서 표본 상세에서 내픽을 고를 수 있습니다"
                      >
                        {r.myPick || <span className="mm-muted">-</span>}
                      </button>
                    </td>
                    {/* 표본·판정·적중결과는 결과 오른쪽으로(2026-09-27 사용자 지정) */}
                    <td>
                      {v ? (
                        // '표본적음' 태그는 뺐다(2026-09-27 사용자 지정) — 대신 건수 뒤에 한 칸
                        // 띄우고 [핸승/핸무/무/역] 4칸 실제 건수를 뱃지로 붙인다(사용자 지정:
                        // "3건[스페이스] 뱃지로 1/0/2/0 이렇게"). 뱃지 색은 판정과 같은 기준
                        // (핸승·역 건수 비교, verdict_of와 동일)으로 — 핸승이 많으면 파랑(정무 쪽),
                        // 역이 많으면 빨강(플핸무 쪽), 같으면 회색(사용자 지정: "동점이면 회색").
                        // 둘 차이가 3건 이상이면 테두리 강조(사용자 지정: "차이가 3이상 나면
                        // 뱃지 보더에 하이라이트").
                        <button
                          type="button" className="mm-sample-btn"
                          onClick={() => setSampleSel({ s: r.S, r: r.R, ht: r.HT, at: r.AT })}
                          title="눌러서 표본 목록 보기"
                        >
                          <span className="mm-sample-num">{v.n}건</span>{' '}
                          <span className={[
                            'mm-cnt-badge',
                            v.cnt[0] === v.cnt[3] ? '' : v.cnt[0] > v.cnt[3] ? 'is-blue' : 'is-red',
                            Math.abs(v.cnt[0] - v.cnt[3]) >= 3 ? 'is-strong' : '',
                          ].filter(Boolean).join(' ')}
                          >
                            {v.cnt.join('/')}
                          </span>
                        </button>
                      ) : '-'}
                    </td>
                    {/* 판정 기준(국배 또는 국핸디)이 있는데도 v가 없으면 '비슷한 과거 경기를 못 찾은 것'
                        (표본없음) — 둘 다 아예 없는 것(배당없음)과 원인이 다르다(2026-09-27 사용자
                        제보: 한국M vs 베트남M — KW 1.08 · KL 18.5처럼 배당은 있지만 너무 극단적이라
                        ±10칸 안에서도 비슷한 과거 경기가 하나도 없었다). */}
                    <td>
                      {v ? (
                        <span className={`mm-chip ${v.pick === '정무' ? 'is-blue' : 'is-red'}`} title={v.viaHandi ? '국핸디 기반 판정(국배 없음)' : undefined}>
                          {v.pick}{v.viaHandi && '*'}
                        </span>
                      ) : <span className="mm-muted">{hasOddsBasis(r) ? '표본없음' : '국배 없음'}</span>}
                    </td>
                    <td>
                      {r.outcome ? <span className="mm-badge" style={OUTCOME_BADGE[r.outcome]}>{r.outcome}</span>
                        : v && r.HS === null ? <RtBadge label="예정" />
                        : v
                          ? <span className="mm-muted" title="판정은 냈지만 이 경기에 핸디 마켓이 없어(결과 칸의 '핸디없음' 참고) 채점을 못 합니다.">핸디없음</span>
                          : hasOddsBasis(r)
                            ? <span className="mm-muted" title="배당은 있지만 비슷한 과거 경기(±10칸 안)를 하나도 못 찾아 판정을 못 냈습니다.">표본없음</span>
                            : <span className="mm-muted" title="프로토가 이 경기에 배당 자체를 안 줍니다 — 결과를 기다리는 게 아니라 애초에 판정을 못 냅니다.">배당없음</span>}
                    </td>
                    <td>
                      {r.ddong && (
                        <span className={`mm-ddong${r.ddongsa ? ' is-sa' : ''}`} title={r.ddong && r.ddongsa === null ? '똥배(국배 1.49 이하) — 결과가 나오면 똥사 여부도 표시' : r.ddongsa ? '똥사 — 똥배인데 무·역이 나옴(정배가 완전히 무너짐)' : '똥배'}>
                          {r.ddongsa ? '똥사' : '똥배'}
                        </span>
                      )}
                    </td>
                    <td><OddsWDL w={r.KW} d={r.KD} l={r.KL} favIsW={favInit} /></td>
                    {/* 배변(최신) — 초기와 하나라도 다를 때(=진짜 배변)만 보여주고, 안 움직였으면
                        초기 칸과 같은 숫자를 또 보여줄 필요가 없어 '-'(2026-09-27 사용자 지정:
                        "배변 되면 텍스트만 표시 해주고 배변이 안되면 - 해줘"). */}
                    <td>
                      {r.EKW !== null && (r.EKW !== r.KW || r.EKD !== r.KD || r.EKL !== r.KL)
                        ? <OddsWDL w={r.EKW} d={r.EKD} l={r.EKL} favIsW={favFinal} flipTitle={flipTitle} />
                        : <span className="mm-muted">-</span>}
                    </td>
                    <td>{r.KHW === null ? <span className="mm-muted">-</span> : <OddsWDL w={r.KHW} d={r.KHD} l={r.KHL} favIsW={favInit} />}</td>
                    <td>
                      {r.EKHW !== null && (r.EKHW !== r.KHW || r.EKHD !== r.KHD || r.EKHL !== r.KHL)
                        ? <OddsWDL w={r.EKHW} d={r.EKHD} l={r.EKHL} favIsW={favFinal} flipTitle={flipTitle} />
                        : <span className="mm-muted">-</span>}
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
          no={sampleRow?.No} code={data.code} scope={data.scope} myPick={sampleRow?.myPick}
          onPickSaved={(next) => patchRowLocal({ S: sampleSel.s, R: sampleSel.r, HT: sampleSel.ht, AT: sampleSel.at }, { myPick: next })}
          onClose={() => setSampleSel(null)}
        />
      )}
    </div>
  )
}
