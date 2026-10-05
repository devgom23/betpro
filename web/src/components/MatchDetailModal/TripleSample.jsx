import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import RtBadge from '../RtBadge/RtBadge'
import './TripleSample.css'

// 상세보기 '표본' 섹션 — 12개 배당사 섹션 바로 아래(2026-09-26 사용자 지정).
// 초기 표본(12사 초기 평균 + 국배 초기)과 배변 표본(12사 마감 평균 + 국배 최신, 서버 /api/triple_sample?phase=final)을
// 한 섹션에서 비교해 본다(2026-10-04 사용자 지정 A안 — 예전엔 두 섹션을 위아래로 따로 뒀다. 아래 '초기·배변 한 번에 보기' 주석 참고).
// 12사 평균 승·패 + 국배 승·패가 둘 다 비슷한 과거 경기를 결과(핸승·핸무·무·역)별 4칸으로 보여준다.
//   위   = 같은 리그 / 아래 = 통합(다른 리그만). 폭은 둘 다 ±0칸(완전 일치)에서 시작해 0건이면 1건 나올 때까지 1칸씩 넓히고, 제목에 쓴 폭(±N칸)을 적는다. 계산·기준은 서버 api/triple_sample.py.
// 카드 = 경기일 · 팀 이름(스코어) · 12사 평균 · 국배 · 국핸디.
//   이번 경기와 국배·국핸디가 '같은 값'이면 노랑 배경, 1~2칸 차이면 글자색만(배지처럼 안 보이게),
//   12사 평균이 같은 값이면 파랑 밑줄.
// 설명(어떻게 산출했나)은 제목 옆 ? 도움말에 있다 — 화면에는 부제를 두지 않는다.

const RT_LABEL = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }

// 국내 배당 호가 단위(한 칸) — 2026-09-26 과거 자료로 확인: 2.5 미만 0.01 · 2.5~5 0.05 · 5 이상 0.10
// (무는 늘 2.5 이상이라 0.05부터). 글자 강조는 같은 값이 아니면서 이 단위로 2칸 이내일 때.
const NEAR_TICKS = 2
function tickOf(v) {
  return v < 2.5 ? 0.01 : v < 5 ? 0.05 : 0.10
}
function ticksApart(v, ref) {
  if (v === null || v === undefined || ref === null || ref === undefined) return null
  return Math.round(Math.abs(v - ref) * 100) / Math.round(tickOf(Math.min(v, ref)) * 100)
}
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))
const khText = (v) => (v === null || v === undefined ? '' : `${v > 0 ? '+' : ''}${v}`)

// 배변 표본의 '이번 경기' 줄 — 배변 값 옆에 초기 대비 변화량을 붙인다(2026-10-04 사용자 지정 — "1.71(0.4▼) 이런 식으로
// 평균·국배·국핸디 모두"). 초기보다 오르면 빨강 ▲, 내리면(=돈이 몰린 쪽) 파랑 ▼ — 배당 표·리그 표와 같은 규칙.
// 안 움직였으면 흐린 '(0.00 ■)'(2026-10-04 사용자 지정 — "(0.0 ■) 이렇게"). 변화량은 앱 전체 규칙대로 소수 둘째 자리까지
// (2026-10-04 사용자 지정 — "통일성 있게 소수점 두자리로 0.10 이런 식으로"): 0.40▼ · 0.10▲ · 0.00 ■.
function MoveMark({ v, v0 }) {
  if (v === null || v === undefined || v0 === null || v0 === undefined) return null
  const d = Math.round((v - v0) * 100)
  if (d === 0) return <span className="ts-mv same" title={`초기 ${f2(v0)}와 같음`}>(0.00 ■)</span>
  return <span className={`ts-mv ${d > 0 ? 'up' : 'down'}`} title={`초기 ${f2(v0)} → 배변 ${f2(v)}`}>({f2(Math.abs(d) / 100)}{d > 0 ? '▲' : '▼'})</span>
}

// 아주 비슷한 값(밑줄) — 폭을 넓혀 찾은 표본은 값이 멀어지니 그중에서도 특히 가까운 값을 따로 표시한다.
// 쓴 폭 1~4칸이면 1칸 이내, 5칸 이상이면 2칸 이내(2026-09-26 사용자 지정). 완전 일치(0칸)는 비슷한 값이 없다.
// 칸 = 12사 평균은 0.01, 국배·국핸디는 국내 호가 단위.
function closeLimit(tol) {
  const k = Math.round(tol * 100)
  return k >= 5 ? 2 : k >= 1 ? 1 : 0
}
function isClose(v, base, tol, useTick) {
  const lim = closeLimit(tol)
  if (!lim) return false
  const t = useTick ? ticksApart(v, base) : Math.round(Math.abs(v - base) * 100)
  return t !== null && t <= lim
}

// 값 하나의 상태 — 같은 값(same) / 비슷한 값(near) / 그 밖(null).
//   비슷한 값 = 같은 값이 아니면서 ① 이 영역의 허용 폭 안(같은 리그 ±0.03 · 통합 ±0.02)이거나
//              ② (국배·국핸디만) 국내 호가 단위로 1~2칸 차이.
//   12사 평균은 계산으로 나오는 값이라 호가 단위가 없어 ①만 쓴다.
function stateOf(v, base, tol, useTick) {
  if (v === null || v === undefined || base === null || base === undefined) return null
  const d = Math.round(Math.abs(v - base) * 100)
  if (d === 0) return 'same'
  if (d <= Math.round(tol * 100)) return 'near'
  if (useTick) {
    const t = ticksApart(v, base)
    if (t !== null && t <= NEAR_TICKS) return 'near'
  }
  return null
}

// 국배·국핸디 한 칸 — 같은 값 노랑 배경 / 비슷한 값 글자색만
function OddsCell({ v, base, tol }) {
  if (v === null || v === undefined) return <>-</>
  const st = stateOf(v, base, tol, true)
  if (st === 'same') return <span className="ts-same">{f2(v)}</span>
  if (st === 'near') return <span className={`ts-near${isClose(v, base, tol, true) ? ' ts-close' : ''}`} title={`이번 경기 ${f2(base)}와 비슷한 값(${f2(Math.abs(v - base))} 차이)${isClose(v, base, tol, true) ? ' — 특히 가까움' : ''}`}>{f2(v)}</span>
  return <>{f2(v)}</>
}

// 12사 평균 한 칸 — 같은 값 파랑 밑줄 / 비슷한 값 글자색만
function AvgCell({ v, base, tol }) {
  const st = stateOf(v, base, tol, false)
  if (st === 'same') return <span className="ts-a-same">{f2(v)}</span>
  if (st === 'near') return <span className={`ts-near${isClose(v, base, tol, false) ? ' ts-close' : ''}`} title={`이번 경기 12사 평균 ${f2(base)}와 비슷한 값(${f2(Math.abs(v - base))} 차이)${isClose(v, base, tol, false) ? ' — 특히 가까움' : ''}`}>{f2(v)}</span>
  return <>{f2(v)}</>
}

// 무 값이 이번 경기와 많이 다른 표본 표시(2026-09-26 사용자 지정) — 0.20 이상 주황 / 0.30 이상 빨강(글자색만, 차이값 기준).
// 12사 평균 무·국배 무에만 건다. 무 차이가 결과 일치율과 관계 있다는 실측은 없어서(103,001장, 차이별 일치율 26% 안팎) 신뢰도 점수가 아니라
// '이 표본은 무가 많이 다르다'는 눈 표시다.
const DRAW_WARN = 20
const DRAW_BAD = 30
function drawGap(v, base) {
  if (v === null || v === undefined || base === null || base === undefined) return null
  const d = Math.round(Math.abs(v - base) * 100)
  return d >= DRAW_BAD ? 'bad' : d >= DRAW_WARN ? 'warn' : null
}
function DrawMark({ v, base, children }) {
  const g = drawGap(v, base)
  if (!g) return children
  return (
    <span className={g === 'bad' ? 'ts-draw-bad' : 'ts-draw-warn'} title={`이번 경기 무 ${f2(base)}와 ${f2(Math.abs(v - base))} 차이 — ${g === 'bad' ? '0.30 이상(빨강)' : '0.20 이상(주황)'}`}>
      {children}
    </span>
  )
}

// 카드 하나의 고유키 — 신뢰 체크를 기억할 때 쓴다(같은 경기는 기본/넓힘 탭이 달라도 같은 카드).
const cardKey = (c) => `${c.lg}|${c.S}|${c.R}|${c.ht}|${c.at}`

// ── 표본 카드 점수(2026-10-05 사용자 지정 · 실측 — 도움말 ⑥ 참고) ──────────────────
// 이 카드가 이번 경기와 얼마나 닮았나(100점). 배점: 12사 승·무·패 11·4·11 / 국배 11·4·11 /
// 국핸디 4·2·4(기준점 같을 때) / 칸수 10 / 같은 리그 6 / 최근 6·4·2 / 이번 경기 팀 등장 16(무 비슷할 때만).
// 승·패 = % 차이(0% 만점 → 2.5% 0점) · 무 = 0.05 이하 만점, 0.10 이하 절반 · 칸수 = 승·패 네 값 중 가장 먼 값(0.01 칸, 0 만점 → 15칸 0).
// 실측(과거 약 2.9만 경기): 배변 표본에서 1순위 점수 70↑이면 '배제 적중'이 기대보다 +3.6%p, 구간이 낮을수록 줄어든다.
// 초기 표본은 어느 구간도 효과가 없어 화면에서 '(참고)'로 흐리게 보인다(사용자 지정 — 둘 다 표시).
const seasonNo = (v) => {
  const t = String(v ?? '').trim()
  return /^[0-9]{4}$/.test(t) ? Number(t) % 100 : parseInt(t.slice(0, 2), 10)
}
const wlSim = (v, ref) => (v == null || ref == null || !ref ? 0 : Math.max(0, 1 - (Math.abs(v - ref) / ref * 100) / 2.5))
const drawSim = (v, ref) => {
  if (v == null || ref == null) return 0
  const d = Math.round(Math.abs(v - ref) * 100)
  return d <= 5 ? 1 : d <= 10 ? 0.5 : 0
}
function cardScore(c, g, sameLeague, s0, teams) {
  const p = {}
  p.a = 11 * wlSim(c.A[0], g.A[0]) + 4 * drawSim(c.A[1], g.A[1]) + 11 * wlSim(c.A[2], g.A[2])
  p.k = 11 * wlSim(c.K[0], g.K[0]) + 4 * drawSim(c.K[1], g.K[1]) + 11 * wlSim(c.K[2], g.K[2])
  const hok = c.kh != null && c.kh === g.kh && c.khw != null && g.khw != null
  p.h = hok ? 4 * wlSim(c.khw, g.khw) + 2 * drawSim(c.khd, g.khd) + 4 * wlSim(c.khl, g.khl) : 0
  const d4 = [[c.A[0], g.A[0]], [c.A[2], g.A[2]], [c.K[0], g.K[0]], [c.K[2], g.K[2]]]
    .filter(([x, y]) => x != null && y != null).map(([x, y]) => Math.round(Math.abs(x - y) * 100))
  p.span = d4.length ? Math.max(...d4) : 15
  p.sp = 10 * Math.max(0, 1 - p.span / 15)
  p.lg = sameLeague ? 6 : 0
  const ago = s0 - seasonNo(c.S)
  p.rc = ago <= 2 ? 6 : ago <= 5 ? 4 : ago <= 9 ? 2 : 0
  const drawOk = c.A[1] != null && g.A[1] != null && Math.round(Math.abs(c.A[1] - g.A[1]) * 100) <= 10
    && Math.round(Math.abs(c.K[1] - g.K[1]) * 100) <= 10
  p.tm = drawOk && (teams.has(String(c.ht).trim()) || teams.has(String(c.at).trim())) ? 16 : 0
  const total = p.a + p.k + p.h + p.sp + p.lg + p.rc + p.tm
  return { total, p }
}
const scoreTitle = ({ total, p }, final) => `${final ? '배변' : '초기'} 표본 점수 ${total.toFixed(1)}점`
  + `\n12사 ${p.a.toFixed(1)}/26 · 국배 ${p.k.toFixed(1)}/26 · 국핸디 ${p.h.toFixed(1)}/10 · 칸수(±${p.span}칸) ${p.sp.toFixed(1)}/10`
  + `\n같은 리그 ${p.lg}/6 · 최근 ${p.rc}/6 · 팀 등장 ${p.tm}/16(무가 비슷할 때만)`
  + (final ? '\n70점 이상은 과거 실측에서 배제 적중이 평소보다 +3.6%p(도움말 ⑥)' : '\n초기 표본 점수는 실측 효과가 없어 참고용입니다(도움말 ⑥)')

function Card({ c, ck, game, tol, trusted, distrusted, onTrust, onDistrust, teams, avgLabel, ptag }) {
  const sameH = c.kh !== null && game.kh !== null && c.kh === game.kh
  const hRef = [game.khw, game.khd, game.khl]
  const hVals = [c.khw, c.khd, c.khl]
  return (
    <div className={`ts-card${c.prev ? ' ts-prev' : ''}${trusted ? ' ts-trust' : ''}${distrusted ? ' ts-distrust' : ''}`} title={c.prev ? '더 좁은 폭(앞 탭)의 표본에도 있던 경기' : undefined}>
      <div className="ts-card-top">
        <b className={Number(c.dt.slice(0, 4)) >= 2020 ? 'ts-date-new' : undefined} title={Number(c.dt.slice(0, 4)) >= 2020 ? '2020년 이후 경기' : undefined}>{c.dt.slice(2)}</b>
        {/* 신뢰·비신뢰(2026-09-30 사용자 지정 — "[체크] 신뢰 [체크]비신뢰") — 둘은 동시에 체크되지 않는다. */}
        <span className="ts-trust-wrap">
          <label className="ts-trust-lab" title="이 표본을 신뢰하면 체크">
            <input type="checkbox" checked={!!trusted} onChange={() => onTrust(ck)} />
            신뢰
          </label>
          <label className="ts-distrust-lab" title="이 표본을 믿지 않으면 체크">
            <input type="checkbox" checked={!!distrusted} onChange={() => onDistrust(ck)} />
            비신뢰
          </label>
        </span>
        {/* 첫 줄 오른쪽 = '초기 · 45점'(2026-10-05 사용자 지정 — 카드 위 꼬리표를 카드 안으로) */}
        {ptag}
      </div>
      {/* 둘째 줄 = 왼쪽 리그·시즌·라운드 · 오른쪽 팀 스코어(2026-10-05 사용자 지정 — 리그 정보를 첫 줄에서 내림) */}
      <div className="ts-card-teams">
        <span className="ts-card-lg">{c.lg} · {c.S} · {/R$/.test(c.R) ? c.R : `${c.R}R`}</span>
        <span className="ts-card-match">
          <span className={teams.has(String(c.ht).trim()) ? 'ts-team-hit' : undefined} title={teams.has(String(c.ht).trim()) ? '이번 경기에 나오는 팀' : undefined}>{c.ht}</span>
          <span className="ts-score">
            <b className={c.hs > c.as_ ? 'ts-win' : undefined}>{c.hs ?? '-'}</b> : <b className={c.as_ > c.hs ? 'ts-win' : undefined}>{c.as_ ?? '-'}</b>
          </span>
          <span className={teams.has(String(c.at).trim()) ? 'ts-team-hit' : undefined} title={teams.has(String(c.at).trim()) ? '이번 경기에 나오는 팀' : undefined}>{c.at}</span>
        </span>
      </div>
      <table className="ts-card-table">
        <tbody>
          {c.A.some((v) => v !== null && v !== undefined) && <tr>
            <td>{avgLabel}</td>
            {c.A.map((v, i) => <td key={i}>{i === 1 ? <DrawMark v={v} base={game.A[i]}><AvgCell v={v} base={game.A[i]} tol={tol} /></DrawMark> : <AvgCell v={v} base={game.A[i]} tol={tol} />}</td>)}
          </tr>}
          <tr>
            <td>국배</td>
            {c.K.map((v, i) => <td key={i}>{i === 1 ? <DrawMark v={v} base={game.K[i]}><OddsCell v={v} base={game.K[i]} tol={tol} /></DrawMark> : <OddsCell v={v} base={game.K[i]} tol={tol} />}</td>)}
          </tr>
          <tr title={c.khw === null ? '핸디 배당이 없는 경기입니다(20-21 시즌 이전 경기는 없는 경우가 많습니다)' : undefined}>
            <td>핸디 {khText(c.kh)}</td>
            {hVals.map((v, i) => <td key={i}><OddsCell v={v} base={sameH ? hRef[i] : null} tol={tol} /></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// 결과별 건수 — (핸승/핸무/무/역) 순서
const cntText = (a) => `(${a.cnt.join('/')})`
// 이 탭 표본 중 내가 '신뢰'로 체크한 카드 수 — 체크한 게 있을 때만 (신뢰ㆍN건)을 붙인다.
const trustText = (a, trusted, keyOf) => {
  const n = Object.values(a.cards).reduce((sum, list) => sum + list.filter((c) => trusted.has(keyOf(c))).length, 0)
  return n ? ` (신뢰ㆍ${n}건)` : ''
}

// 탭 색(2026-09-30 사용자 지정) — 표본을 찾는 데 쓴 폭(±N칸)이 좁을수록 배당이 더 비슷한 표본이다.
// ±0~1칸 노랑 · ±2~4칸 초록 · ±5칸 이상 빨강, 색은 '±N칸' 글자에만 준다. 선택 여부는 테두리로만 구분한다.
// (실측(32,591경기)으로는 폭과 적중이 무관해 '믿을 만함'을 뜻하는 색이 아니다 — 폭을 눈으로 구분하는 표시일 뿐.)
const tabTone = (k) => (k <= 1 ? 'yellow' : k <= 4 ? 'green' : 'red')
// '표본'은 보통 굵기, '1건(0/1/0/0)'은 굵게.
function TabText({ k, a, trusted, keyOf }) {
  // 색은 '±N칸' 글자에만(탭 배경은 글자가 잘 보이는 기본색) — 표본이 0건이면 색을 안 넣는다.
  return <><span className={`ts-k${a.n > 0 ? ` ts-k-${tabTone(k)}` : ''}`}>±{k}칸</span> · 표본 <b>{a.n}건 {cntText(a)}</b>{trustText(a, trusted, keyOf)}</>
}

// ── 초기·배변 한 번에 보기(A안, 2026-10-04 사용자 지정 — 목업 web/public/mockups/sample_compare_mock2.html) ──
// 예전엔 '초기 표본'·'배변 표본' 두 섹션을 위아래로 따로 뒀다. 이제 한 섹션에서
//   ① 이번 경기 줄: 초기 → 배변 값과 변화(0.39▼)
//   (변화 요약표는 2026-10-05 사용자 지정으로 뺐다 — "이거 안 본다, 화면에서 삭제". 결과 칸 머리의 '1 → 0건'은 그대로)
//   ③ [초기 · 배변 · 같이] 버튼: 같이 보면 결과 칸 안에 초기 카드 → 배변 카드 순서로, 카드 첫 줄 오른쪽 꼬리표·왼쪽 띠 색으로 구분
// 카드 모양·값 표시 규칙·신뢰/비신뢰·폭 탭·의견칸은 예전과 똑같다(초기·배변을 각자 따로 고른다).
const PHASES = ['init', 'final']
const PHASE_LABEL = { init: '초기', final: '배변' }
const keyOfPhase = (p) => (c) => (p === 'final' ? 'f:' : '') + cardKey(c)   // 배변 카드 신뢰 체크는 'f:'로 따로
const AREA_KEYS = ['same', 'other']

// 한 단계·한 영역의 지금 고른 표본(기본 폭 / 넓힌 폭)
function pickArea(d, key, wide) {
  const base = d[key]
  const nx = base.next
  const on = !!(wide && nx)
  return { base, nx, on, baseTol: d.tol[key], area: on ? nx.area : base, tol: on ? nx.tol : d.tol[key] }
}

// 초기 → 배변 건수 한 칸 — 늘면 빨강, 줄면 파랑(배당 화살표와 같은 색 규칙)
function CountMove({ a, b }) {
  if (a === b) return <>{a} → {b}</>
  return <>{a} → <b className={b > a ? 'ts-cmp-up' : 'ts-cmp-down'}>{b}</b></>
}

// 영역 하나(같은 리그 / 통합) — 보이는 단계(초기·배변·둘 다)의 폭 탭 + 결과 4칸 카드
function CompareBand({ areaKey, title, shown, data, sel, setWide, trusted, distrusted, onTrust, onDistrust, teams, notes, s0 }) {
  const both = shown.length === 2
  return (
    <div className="ts-band">
      <div className="ts-band-head">
        <span>{title}</span>
        {shown.map((p) => {
          const s = sel[p][areaKey]
          const keyOf = keyOfPhase(p)
          const kb = Math.round(s.baseTol * 100)
          const kn = s.nx ? Math.round(s.nx.tol * 100) : 0
          return (
            <span key={p} className={`ts-phase-tabs ts-phase-${p}`}>
              {both && <span className="ts-cmp-tag">{PHASE_LABEL[p]}</span>}
              {s.nx ? (
                <span className="ts-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={!s.on} className={`ts-tab${s.on ? '' : ' is-on'}`} onClick={() => setWide(p, areaKey, false)}>
                    <TabText k={kb} a={s.base} trusted={trusted} keyOf={keyOf} />
                  </button>
                  <button type="button" role="tab" aria-selected={s.on} className={`ts-tab${s.on ? ' is-on' : ''}`} onClick={() => setWide(p, areaKey, true)}
                    title="표본이 더 늘어나는 폭까지 넓힌 표본">
                    <TabText k={kn} a={s.nx.area} trusted={trusted} keyOf={keyOf} />
                  </button>
                </span>
              ) : (
                <small className="ts-tab ts-tab-static">
                  <TabText k={kb} a={s.base} trusted={trusted} keyOf={keyOf} />
                </small>
              )}
            </span>
          )
        })}
        {/* 의견칸은 영역마다 하나(2026-10-04 사용자 지정 — "메모 2개 1개만, 플레이스홀더는 표본의견") — 초기·배변 공통 */}
        {shown.length > 0 && notes}
      </div>
      <div className="ts-cols">
        {[1, 2, 3, 4].map((k) => (
          <div className="ts-col" key={k}>
            <div className="ts-col-head">
              <RtBadge label={RT_LABEL[k]} />
              {both ? (
                <span><CountMove a={sel.init[areaKey].area.cnt[k - 1]} b={sel.final[areaKey].area.cnt[k - 1]} />건</span>
              ) : (() => {
                const a = sel[shown[0]][areaKey].area
                const n = (a.cards[String(k)] || []).length
                return <span>{a.cnt[k - 1]}건{a.cnt[k - 1] > n ? ` 중 ${n}` : ''}</span>
              })()}
            </div>
            <div className="ts-cards">
              {(() => {
                const items = shown.flatMap((p) => {
                  const s = sel[p][areaKey]
                  const keyOf = keyOfPhase(p)
                  return (s.area.cards[String(k)] || []).map((c, i) => {
                    const ck = keyOf(c)
                    // 카드 첫 줄 오른쪽 '배변 · 72점'(2026-10-05 사용자 지정) — 보기와 상관없이 늘 붙인다. 점수에 마우스를 올리면 내역.
                    // 배변 70↑ 진하게 · 60~70 연하게 / 초기는 실측 근거가 없어 점수를 흐리게('(참고)' 글자는 사용자 지정으로 뺐다).
                    const sc = cardScore(c, data[p].game, areaKey === 'same', s0, teams)
                    const tone = p === 'init' ? 'ref' : sc.total >= 70 ? 'hi' : sc.total >= 60 ? 'mid' : 'base'
                    const ptag = (
                      <span className={`ts-cmp-tag ts-cmp-tag-${p}`}>
                        {PHASE_LABEL[p]}
                        <span className={`ts-pt ts-pt-${tone}`} title={scoreTitle(sc, p === 'final')}>
                          {' · '}{Math.round(sc.total)}점
                        </span>
                      </span>
                    )
                    return (
                      <div key={`${p}${i}`} className={`ts-cmp-item${both ? ` ts-cmp-${p}` : ''}`}>
                        <Card c={c} ck={ck} game={data[p].game} tol={s.tol} trusted={trusted.has(ck)} distrusted={distrusted.has(ck)} onTrust={onTrust} onDistrust={onDistrust} teams={teams} avgLabel={p === 'final' ? '마감' : '평균'} ptag={ptag} />
                      </div>
                    )
                  })
                })
                return items.length ? items : <div className="ts-empty">—</div>
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 이번 경기 줄 — 배변이 있으면 '초기 → 배변 (변화)', 없으면 초기 값만
function RefLine({ data, finalReady }) {
  const gi = data.init.game
  const gf = finalReady ? data.final.game : null
  const one = (v0, v1, cls, i) => (
    <span key={i}>
      <span className={cls}>{f2(v0)}</span>
      {gf && <>→<span className={cls}>{f2(v1)}</span><MoveMark v={v1} v0={v0} /></>}
    </span>
  )
  const sameH = gf && gf.kh === gi.kh
  return (
    // 앞 라벨('이번 경기 (초기 → 배변)')은 빼고 한 줄로(2026-10-04 사용자 지정) — 줄바꿈 대신 좁은 화면에선 가로 스크롤.
    <div className="ts-ref ts-ref-line">
      {data.init.mode === 'kr' && <span className="ts-kr-only" title="이 리그는 12사(스코어맨 12개 배당사) 과거 배당이 아직 충분히 쌓이지 않아, 국배 승·패만 비슷한 과거 경기를 찾았습니다. 12사 배당이 쌓이면 자동으로 12사 평균까지 맞춰 찾습니다.">국배만 비교</span>}
      {gi.A.some((v) => v !== null) && <span>12사 평균 <span className="ts-nums">{gi.A.map((v, i) => one(v, gf?.A[i], i === 1 ? '' : 'ts-a-same', i))}</span></span>}
      <span>국배 <span className="ts-nums">{gi.K.map((v, i) => one(v, gf?.K[i], 'ts-same', i))}</span></span>
      <span>국핸디 ({khText(gi.kh) || '-'}) <span className="ts-nums">{[gi.khw, gi.khd, gi.khl].map((v, i) => (
        sameH ? one(v, [gf.khw, gf.khd, gf.khl][i], 'ts-same', i) : <span key={i}><span className="ts-same">{f2(v)}</span></span>
      ))}</span></span>
      {gf && !sameH && gf.kh !== null && <small className="ts-msg">국핸디 기준점이 {khText(gi.kh)} → {khText(gf.kh)}로 바뀌어 핸디 값은 비교하지 않습니다</small>}
    </div>
  )
}

// noteSlots — { title, same, other } 의견 입력칸(상위에서 SampleNoteInput을 만들어 넘긴다) — 제목 옆 · 같은 리그 · 통합 각 1개
export default function TripleSampleSection({ code, scope, row, noteSlots }) {
  const [data, setData] = useState({ init: undefined, final: undefined })   // 단계별: undefined 불러오는 중 · null 실패
  const [help, setHelp] = useState(false)
  // 접기/펼치기(2026-10-04) — 접어도 '이번 경기' 줄은 남고 카드만 숨는다.
  const [folded, setFolded] = useState(false)
  // 보기 — 'both' 같이(기본) · 'init' 초기만 · 'final' 배변만
  const [view, setView] = useState('both')
  // 폭 탭(기본/넓힌) — 단계·영역마다 따로 고른다.
  const [wide, setWideState] = useState({})
  const setWide = (p, key, v) => setWideState((w) => ({ ...w, [`${p}:${key}`]: v }))
  // 신뢰/비신뢰 체크 — 이 경기에서 내가 믿는/믿지 않는 표본 카드들. 서버 DB에 저장한다(2026-09-30 사용자 지정 —
  // 예전엔 브라우저 localStorage라 다른 기기와 공유가 안 되고 나중에 '신뢰한 카드가 실제로 더 맞았나'도 못 쟀다).
  // marks = {카드키: 'trust' | 'distrust'} — 한 카드에는 둘 중 하나만 걸린다. 배변 카드는 키 앞에 'f:'.
  const [marks, setMarks] = useState({})
  const trusted = useMemo(() => new Set(Object.keys(marks).filter((k) => marks[k] === 'trust')), [marks])
  const distrusted = useMemo(() => new Set(Object.keys(marks).filter((k) => marks[k] === 'distrust')), [marks])
  // 이번 경기의 두 팀 — 표본 카드에 같은 팀이 나오면 팀명을 하이라이트한다(홈·원정 위치는 상관없이).
  const teams = new Set([String(row.HT || '').trim(), String(row.AT || '').trim()])
  const markUrl = `/api/leagues/${code}/sample_card_marks`
  const markBody = (ck, mark) => ({ scope, S: row.S, R: row.R, No: row.No ?? null, HT: row.HT, AT: row.AT, card_key: ck, mark })
  useEffect(() => {
    let alive = true
    setMarks({})
    ;(async () => {
      try {
        const q = new URLSearchParams({ scope, season: String(row.S ?? ''), round: String(row.R ?? ''), no: String(row.No ?? ''), ht: String(row.HT ?? ''), at: String(row.AT ?? '') })
        const res = await api.get(`${markUrl}?${q.toString()}`)
        const next = { ...(res.marks || {}) }
        // 예전에 이 브라우저(localStorage)에만 남겨 둔 신뢰/비신뢰가 있으면 DB로 옮기고 브라우저 것은 지운다(초기 표본 것만 있었다).
        const legacyKeys = [[`ts-trust:${code}|${scope}|${row.S}|${row.R}|${row.HT}|${row.AT}`, 'trust'],
          [`ts-distrust:${code}|${scope}|${row.S}|${row.R}|${row.HT}|${row.AT}`, 'distrust']]
        const moved = []
        for (const [lk, mk] of legacyKeys) {
          let list = []
          try { list = JSON.parse(localStorage.getItem(lk) || '[]') } catch { list = [] }
          for (const ck of list) if (!next[ck]) { next[ck] = mk; moved.push([ck, mk]) }
        }
        if (moved.length) await Promise.all(moved.map(([ck, mk]) => api.post(markUrl, markBody(ck, mk))))
        try { legacyKeys.forEach(([lk]) => localStorage.removeItem(lk)) } catch { /* 저장 불가 환경 */ }
        if (alive) setMarks(next)
      } catch { /* 못 불러오면 체크 없는 상태로 둔다 */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, scope, row.S, row.R, row.HT, row.AT])
  // 체크는 화면에 바로 반영하고 서버에는 뒤따라 저장한다(실패하면 원래대로 되돌린다).
  const setMark = (ck, mark) => {
    const before = marks[ck] ?? null
    const apply = (m) => setMarks((prev) => {
      const n = { ...prev }
      if (m) n[ck] = m
      else delete n[ck]
      return n
    })
    apply(mark)
    api.post(markUrl, markBody(ck, mark)).catch(() => apply(before))
  }
  // 신뢰·비신뢰는 한 카드에 동시에 걸리지 않는다 — 한쪽을 체크하면 다른 쪽은 자동으로 풀린다.
  const toggleTrust = (ck) => setMark(ck, marks[ck] === 'trust' ? null : 'trust')
  const toggleDistrust = (ck) => setMark(ck, marks[ck] === 'distrust' ? null : 'distrust')
  const key = `${code}|${scope}|${row.S}|${row.R}|${row.HT}|${row.AT}`
  useEffect(() => {
    let alive = true
    setData({ init: undefined, final: undefined })
    setWideState({})
    for (const phase of PHASES) {
      const params = new URLSearchParams({ code, scope, S: String(row.S ?? ''), R: String(row.R ?? ''), HT: String(row.HT ?? ''), AT: String(row.AT ?? ''), phase })
      api.get(`/api/triple_sample?${params.toString()}`)
        .then((res) => alive && setData((d) => ({ ...d, [phase]: res })))
        .catch(() => alive && setData((d) => ({ ...d, [phase]: null })))
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // 공식 6대리그 + 내 데이터 K1·K2(ul_1·ul_2, 2026-09-27). K리그는 12사 과거 배당이 쌓이기 전엔 국배만으로 찾는다(서버 mode='kr').
  if (scope !== 'master' && !['ul_1', 'ul_2'].includes(code)) return null
  const initReady = !!data.init?.ready
  const finalReady = !!data.final?.ready
  // 배변 표본이 없으면(국배 배변 전 등) 초기만 보인다 — 버튼도 숨긴다.
  const shown = !initReady ? [] : !finalReady ? ['init'] : view === 'both' ? PHASES : [view]
  const sel = { init: {}, final: {} }
  for (const p of PHASES) {
    if (!data[p]?.ready) continue
    for (const k of AREA_KEYS) sel[p][k] = pickArea(data[p], k, wide[`${p}:${k}`])
  }
  return (
    <section className="detail-section">
      <h3>
        <button
          type="button"
          className="sample-fold-btn"
          onClick={() => setFolded((f) => !f)}
          title={folded ? '펼치기' : '접기'}
          aria-expanded={!folded}
        >
          {folded ? '▸' : '▾'}
        </button>
        <button type="button" className="help-btn" onClick={() => setHelp(true)} title="표본을 어떻게 산출했는지 보기">
          표본 <small className="ts-title-sub">초기 · 배변</small> <span className="help-mark">?</span>
        </button>
        {/* 제목 옆 의견칸은 하나만(2026-10-04 사용자 지정 — "앞에 거 1개만, 뒤에 메모는 삭제") — 초기·배변 공통 */}
        {noteSlots?.title}
      </h3>
      {data.init === undefined && <div className="ts-msg">불러오는 중…</div>}
      {data.init === null && <div className="ts-msg">표본을 불러오지 못했습니다</div>}
      {data.init && !initReady && <div className="ts-msg">{data.init.reason || '표본을 만들 수 없습니다'}</div>}
      {initReady && (
        <>
          <RefLine data={data} finalReady={finalReady} />
          {!folded && (
            <>
              {finalReady ? (
                <>
                  <div className="ts-view-bar">
                    <span className="ts-view-seg" role="tablist" aria-label="표본 보기">
                      {[['init', '초기'], ['final', '배변'], ['both', '같이']].map(([v, lab]) => (
                        <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>{lab}</button>
                      ))}
                    </span>
                    {view === 'both' && <small>카드 첫 줄 오른쪽 · 왼쪽 띠 색: <span className="ts-cmp-tag ts-cmp-init-c">초기</span> <span className="ts-cmp-tag ts-cmp-final-c">배변</span></small>}
                  </div>
                </>
              ) : (
                <div className="ts-msg">
                  배변 표본: {data.final === undefined ? '불러오는 중…' : data.final === null ? '불러오지 못했습니다' : (data.final.reason || '만들 수 없습니다')}
                </div>
              )}
              {AREA_KEYS.map((k) => (
                <CompareBand
                  key={k}
                  areaKey={k}
                  title={k === 'same' ? `같은 리그 (${data.init.game.lg})` : '통합 (다른 리그)'}
                  shown={shown}
                  data={data}
                  sel={sel}
                  setWide={setWide}
                  trusted={trusted}
                  distrusted={distrusted}
                  onTrust={toggleTrust}
                  onDistrust={toggleDistrust}
                  teams={teams}
                  notes={noteSlots?.[k] || null}
                  s0={seasonNo(row.S)}
                />
              ))}
            </>
          )}
        </>
      )}
      {help && <TripleSampleLegend onClose={() => setHelp(false)} final={finalReady && view !== 'init'} />}
    </section>
  )
}

// 표본 도움말 — 산출 방법·읽는 법. 새 용어(칸·호가 단위)는 쓰기 전에 뜻을 풀었다.
function TripleSampleLegend({ onClose, final }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop help-legend-back" onClick={onClose}>
      <div className="modal-card help-legend-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">🧩 {final ? '배변 표본' : '초기 표본'} — 어떻게 산출했나</h2>

        <p className="help-legend-title">① 무엇을 보여주나</p>
        <p className="help-legend-note">
          이 섹션은 <b>초기 표본</b>(처음 나온 배당으로 찾은 과거 경기)과 <b>배변 표본</b>(움직인 뒤 배당으로 찾은 과거 경기)을 함께 보여줍니다.
          맨 위 <b>이번 경기</b> 줄은 초기 → 배변 값과 변화(오르면 빨강 ▲ · 내리면 파랑 ▼ · 그대로 0.00 ■), 결과 칸 머리의
          <b>1 → 0건</b>은 그 결과의 표본 건수가 초기 → 배변으로 어떻게 바뀌었는지입니다(늘면 빨강 · 줄면 파랑).
          카드는 <b>[초기 · 배변 · 같이]</b> 버튼으로 고르고, '같이'에서는 결과 칸 안에 초기 카드 → 배변 카드 순서로 카드 첫 줄 오른쪽(초기·배변)과 왼쪽 띠 색으로 구분합니다.
          폭 탭·신뢰/비신뢰·의견칸은 초기와 배변이 <b>따로</b>입니다. 이번 경기에 국내 배당 배변이 아직 없으면 초기만 보입니다.
        </p>
        {final && (
          <p className="help-legend-note">
            <b>배변 표본</b>은 <b>초기 표본과 계산 방식은 똑같고, 기준 배당만 다릅니다.</b> 초기 표본이 처음 나온 배당(초기)으로 비슷한 경기를 찾는다면,
            배변 표본은 <b>배당이 움직인 뒤의 배당(마감·최신)</b>으로 찾습니다. 과거 경기도 <b>배변 값이 있는 경기만</b> 후보가 됩니다
            (결과가 난 경기의 약 94%). 이번 경기에 <b>국내 배당 배변이 아직 없으면</b> 만들지 않고, 리그 화면의 &apos;최신배당 불러오기&apos;로 채우면 만들어집니다.
          </p>
        )}
        <p className="help-legend-note">
          이 경기와 <b>배당 모양이 비슷했던 과거 경기</b>를 찾아 결과(핸승·핸무·무·역)별로 나눠 보여줍니다.
          기준은 <b>12개 배당사 평균의 승·패</b>와 <b>국내 배당(국배)의 승·패</b> 두 가지이고, <b>넷이 모두</b> 폭 안에
          들어와야 합니다(승과 패 둘 다). <b>무는 조건이 아니라 참고</b>로 카드에만 보여줍니다.
        </p>

        <p className="help-legend-title">② 같은 리그 · 통합은 어떻게 나누나</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>영역</th><th>어디서 찾나</th><th>허용 폭</th></tr>
          </thead>
          <tbody>
            <tr><td><b>같은 리그</b> (위)</td><td>이 경기와 같은 리그의 과거 경기</td><td>±0칸부터, 0건이면 1칸씩 넓힘</td></tr>
            <tr><td><b>통합</b> (아래)</td><td>6대리그 전체 중 <b>다른 리그</b> 경기 — 같은 리그 경기는 위에 이미 나오므로 뺍니다</td><td>±0칸부터, 0건이면 1칸씩 넓힘</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>칸</b> = 소수 둘째 자리 한 눈금(0.01)입니다. 예를 들어 12사 평균 승이 2.55이고 폭이 ±2칸이면 2.53~2.57까지 봅니다. 승·패 네 값이 <b>모두</b> 폭 안이어야 표본이 됩니다.
          폭은 같은 리그·통합 모두 <b>완전 일치(±0칸)</b>에서 시작하고, 표본이 0건이면 <b>1건이 나올 때까지 1칸씩 넓혀</b>(최대 ±15칸) 찾습니다. 제목에 실제로 쓴 폭을 <b>±5칸</b>처럼 적으니, 숫자가 작을수록 배당이 더 비슷한 표본입니다. 폭을 넓혀 표본이 1건뿐이면 근거가 약해서, 표본이 늘어나는 더 넓은 폭을 <b>탭</b>으로 나란히 두었습니다(탭을 누르면 그 표본으로 바뀝니다). 넓은 폭 탭에는 좁은 폭 표본도 함께 들어 있어서, 그 경기들은 카드에 <b>파란 테두리</b>를 둘러 구분합니다(나머지가 새로 더해진 경기). 끝까지 없으면 비어 있습니다.
        </p>

        <p className="help-legend-title">②-2 허용 폭은 이렇게 정해집니다 — 그리고 왜 표본이 없을 수 있나</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>순서</th><th>내용</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>과거 경기마다 <b>승·패 네 값(12사 평균 승·패, 국배 승·패) 중 가장 크게 벌어진 값이 몇 칸인지</b>를 잽니다. 한 값이라도 크게 벌어지면 그 경기는 그만큼 먼 경기입니다.</td></tr>
            <tr><td>2</td><td><b>가장 가까운 경기의 칸 수</b>까지만 폭을 넓힙니다(±0칸에서 시작). 그 폭 안에 든 경기가 표본이고, 제목에 그 폭이 <b>±N칸</b>으로 적힙니다.</td></tr>
            <tr><td>3</td><td>가장 가까운 경기도 <b>15칸을 넘으면 표본을 만들지 않습니다</b>(그 이상이면 &apos;비슷한 배당&apos;이라 하기 어렵다고 봅니다). 같은 리그와 통합을 따로 계산하므로 한쪽만 비고 다른 쪽은 나올 수도 있습니다.</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>표본이 비어 있다고 자료가 부족한 것은 아닙니다.</b> 과거 경기는 충분한데, 그중 이번 경기와 가까운 경기가 <b>15칸 밖</b>이라 안 잡힌 것입니다.
          특히 <b>정배가 아주 세서 패(언더독) 배당이 8~10대로 큰 경기</b>는 잘 비어 있습니다. 칸은 0.01 단위인데, 배당이 클수록 같은 배당이라도 숫자가 크게 흔들리기 때문입니다.
          국내 배당은 5 이상에서 <b>호가 단위(배당이 움직이는 최소 눈금)가 0.10</b>이라 한 눈금만 달라도 10칸이 벌어지고, 12사 평균도 회사마다 달라 큰 배당에서는 0.2~0.3까지 벌어지는 경우가 있습니다(아래 예).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>예 — 세리에A AC밀란(홈) vs 레체 (26-27 5R)</th><th>값</th></tr>
          </thead>
          <tbody>
            <tr><td>이번 경기 12사 평균 / 국배</td><td>1.33 · 4.95 · 9.38 / 1.20 · 4.65 · 9.90</td></tr>
            <tr><td>세리에A 과거 경기 중 가장 가까운 경기</td><td>17-18 5R AC밀란-스팔 — 국배 패 9.90 vs 9.70(0.20 차이) → <b>20칸</b></td></tr>
            <tr><td>그다음으로 가까운 경기</td><td>25-26 26R AC밀란-파르마 — 12사 평균 패 9.38 vs 9.11(0.27 차이) → <b>27칸</b></td></tr>
            <tr><td>결과</td><td>둘 다 15칸을 넘어 같은 리그 표본은 <b>비어 있음</b>(세리에A에 배당이 이 정도로 극단적인 경기가 452경기나 있는데도)</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          과거 26,483경기로 재 본 결과(2026-09-26), 표본이 나오는 경기는 <b>같은 리그 18.8% · 통합 22.5%</b>이고 둘 중 하나라도 나오는 경기는 33.7%였습니다.
          그래서 <b>&apos;표본 없음&apos;은 흔한 결과</b>이고, 표본이 있어도 다수 방향이 실제와 같았던 비율은 51~53%로 우연 수준이라 예측 근거가 아니라
          <b>비슷한 배당의 과거 경기를 눈으로 보는 용도</b>입니다.
        </p>

        <p className="help-legend-title">③ 12사 평균 · 국배는 어떤 값인가</p>
        <p className="help-legend-note">
          {final ? (
            <>
              <b>12사 마감 평균</b> = 스코어맨 12개 배당사의 <b>마감 배당</b> 평균(6곳 이상이 낸 경기만)을 소수 둘째 자리로
              반올림한 값으로, 위 12개 배당사 표의 &quot;12사 평균 마감&quot; 칸과 같습니다. <b>국배 배변</b> = 국내 최신 배당(배변)입니다.
              카드의 &apos;마감&apos; 줄이 12사 마감 평균입니다.
            </>
          ) : (
            <>
              <b>12사 평균</b> = 스코어맨 12개 배당사의 <b>초기 배당</b> 평균(6곳 이상이 낸 경기만)을 소수 둘째 자리로
              반올림한 값으로, 위 12개 배당사 표의 &quot;12사 평균 초기&quot; 칸과 같습니다. <b>국배</b> = 국내 초기 배당입니다.
            </>
          )}
          국배는 12사 평균보다 보통 5~8% 낮게 매겨지고 경기마다 ±5% 안팎 흔들립니다(국내 마진과 자체 호가).
        </p>

        <p className="help-legend-title">④ 시점과 정렬</p>
        <p className="help-legend-note">
          이 경기 날짜 <b>이전</b>에 끝난 경기만 씁니다(같은 날 경기는 서로 세지 않습니다). 카드는 결과별 칸 안에서
          승·패 차이(12사+국배)가 작은 순 → 무 차이가 작은 순 → 최근 순이고, 칸마다 최대 12장까지 보입니다.
          표본 개수는 칸 제목 옆(예: <b>3건 중 12</b>)에 적힙니다. 제목 줄의 <b>표본 9건 (3/1/6/4)</b>에서 괄호 안 숫자는 <b>핸승/핸무/무/역</b> 순서의 결과별 건수입니다.
        </p>

        <p className="help-legend-title">⑤ 카드 읽는 법</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>표시</th><th>뜻</th></tr>
          </thead>
          <tbody>
            <tr><td><span className="ts-same">2.50</span></td><td>이번 경기와 <b>같은 값</b> (국배·국핸디, 노랑 배경)</td></tr>
            <tr><td><span className="ts-a-same">2.55</span></td><td>12사 평균이 이번 경기와 <b>같은 값</b> (파랑 밑줄)</td></tr>
            <tr><td><span className="ts-near">2.26</span></td><td><b>비슷한 값</b> (12사 평균·국배·국핸디 공통, 글자색만) — 같은 값은 아니면서 <b>그 영역의 허용 폭 안</b>(같은 리그 ±0.03, 통합 ±0.02)입니다. 국배·국핸디는 여기에 더해 <b>국내 호가 단위로 1~2칸 차이</b>인 값도 포함합니다(호가 단위: 2.5 미만 0.01 · 2.5~5 0.05 · 5 이상 0.10, 무는 0.05). 12사 평균 승·패는 검색 조건 자체가 폭 안이라 같은 값이 아니면 대부분 이 색이 됩니다 — 차이를 보려면 무 칸과 국배를 함께 보세요</td></tr>
            <tr><td><span className="ts-near ts-close">1.81</span></td><td><b>아주 가까운 값</b> (비슷한 값 중에서 밑줄) — 표본을 찾느라 폭이 <b>1~4칸</b>이면 이번 경기와 <b>1칸 이내</b>, <b>5칸 이상</b>이면 <b>2칸 이내</b>인 값입니다. 예: 이번 경기 12사 평균 패가 1.80이고 폭 5칸으로 찾은 표본이 1.81이면 1칸 차이라 거의 같은 값이니 밑줄을 긋습니다. 칸은 12사 평균이 0.01, 국배·국핸디는 국내 호가 단위입니다. 밑줄은 두 탭 모두, 같은 리그·통합 모두에 똑같이 적용됩니다.</td></tr>
            <tr><td><b className="ts-date-new">24-09-14</b></td><td>카드 날짜가 <b>2020년 이후</b> 경기면 날짜 색이 다릅니다(최근 경기 구분용).</td></tr>
            <tr><td><span className="ts-team-hit">첼시</span></td><td>카드의 팀이 <b>이번 경기에 나오는 팀</b>과 같으면 팀명 글자색이 노랑으로 바뀌고 굵어집니다(홈·원정 자리는 상관없음).</td></tr>
            <tr><td>☑ 신뢰</td><td>카드 날짜 옆 체크박스 — <b>이 표본은 믿는다</b>고 표시하면 <b>신뢰</b> 글자가 초록 굵은 글씨로 바뀌고, 위쪽 탭 제목의 표본 건수 옆에 <b>(신뢰ㆍ1건)</b>처럼 체크한 카드 수가 붙습니다(체크한 게 없으면 안 붙습니다). 경기별로 서버에 저장되어 다른 기기·브라우저에서도 같게 보입니다.</td></tr>
            <tr><td>☑ 비신뢰</td><td>신뢰 옆 체크박스 — <b>이 표본은 믿지 않는다</b>고 표시하면 <b>비신뢰</b> 글자가 빨간 굵은 글씨로 바뀝니다. 신뢰와 비신뢰는 <b>한 카드에 동시에 체크되지 않아</b> 한쪽을 체크하면 다른 쪽은 저절로 풀립니다. 신뢰와 같이 경기별로 서버에 저장됩니다.</td></tr>
            <tr><td><span className="ts-tab ts-tab-static"><span className="ts-k ts-k-yellow">±1칸</span></span> <span className="ts-tab ts-tab-static"><span className="ts-k ts-k-green">±3칸</span></span> <span className="ts-tab ts-tab-static"><span className="ts-k ts-k-red">±7칸</span></span></td><td><b>탭 색</b> — 탭 글자 중 <b>±N칸</b>에만 색이 있습니다. 표본을 찾는 데 쓴 폭이 <b>±0~1칸이면 노랑, ±2~4칸이면 초록, ±5칸 이상이면 빨강</b>입니다(좁을수록 배당이 더 비슷한 표본이라는 눈 표시이고, <b>과거 32,591경기 실측에서는 폭이 좁다고 결과가 더 잘 맞지는 않았습니다</b>). 지금 보고 있는 탭은 <b>테두리 색</b>이 바뀝니다. 탭 글자에서 &apos;표본&apos;은 보통 굵기, 건수(예: <b>1건 (0/1/0/0)</b>)는 굵게 보입니다.</td></tr>
            <tr><td><span className="ts-draw-warn">3.61</span> / <span className="ts-draw-bad">3.48</span></td><td><b>무 값이 많이 다른 표본</b> (12사 평균 무·국배 무의 글자색) — 이번 경기 무와의 차이가 <b>0.20 이상이면 주황, 0.30 이상이면 빨강</b>입니다. 예: 이번 경기 무가 3.82이면 3.61(0.21 차이)은 주황, 3.48(0.34 차이)은 빨강. 승·패가 폭 안에 들어와도 무가 이만큼 다르면 배당 모양이 다른 경기라는 눈 표시입니다. 무 차이가 클수록 결과가 덜 맞는다는 실측은 없어서(카드 103,001장, 차이별 결과 일치율 26% 안팎으로 비슷) 점수가 아니라 참고 표시입니다.</td></tr>
            <tr><td>핸디 +1</td><td>국내 핸디 배당(홈팀 기준선 ±1). 기준선이 같을 때만 같은 값·차이를 표시합니다. 핸디 배당은 20-21 시즌부터 거의 전 경기에 있고 그 이전은 없는 경우가 많아 <b>-</b>로 보입니다</td></tr>
          </tbody>
        </table>

        <p className="help-legend-title">⑥ 표본 점수 — 카드 첫 줄 오른쪽의 &apos;배변 · 72점&apos;</p>
        <p className="help-legend-note">
          카드마다 <b>이번 경기와 얼마나 닮았나</b>를 100점으로 매긴 값입니다. 점수에 마우스를 올리면 항목별 내역이 나옵니다.
          배점은 사용자 지정, 효과는 과거 경기로 실측했습니다(2026-10-05).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>묶음</th><th>항목</th><th>배점</th><th>계산</th></tr>
          </thead>
          <tbody>
            <tr><td>12사 평균</td><td>승 · 무 · 패</td><td>11 · 4 · 11 (26)</td><td rowSpan={3}>승·패: <b>% 차이</b> 0%면 만점, 1%면 60%, 2.5% 이상이면 0<br />무: 차이 0.05 이하 만점, 0.10 이하 절반, 그 밖 0<br />국핸디는 기준점(±1)이 같을 때만</td></tr>
            <tr><td>국배</td><td>승 · 무 · 패</td><td>11 · 4 · 11 (26)</td></tr>
            <tr><td>국핸디</td><td>승 · 무 · 패</td><td>4 · 2 · 4 (10)</td></tr>
            <tr><td>칸수</td><td>승·패 네 값 중 가장 먼 값</td><td>10</td><td>0칸 만점 → 15칸 0 (1칸 = 0.01)</td></tr>
            <tr><td rowSpan={3}>맥락</td><td>같은 리그</td><td>6</td><td></td></tr>
            <tr><td>최근 경기</td><td>6</td><td>2시즌 안 6 · 5시즌 안 4 · 9시즌 안 2</td></tr>
            <tr><td>이번 경기 팀 등장</td><td>16</td><td><b>무가 비슷할 때만</b>(12사 무·국배 무 둘 다 차이 0.10 이하)</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          <b>실측</b> — 과거 6대리그 경기마다 그 경기 날짜 이전 표본만으로 점수 1순위 카드를 정하고, <b>배제 적중</b>(1순위 카드가 정 쪽이면 &apos;역은 안 나온다&apos;,
          플 쪽이면 &apos;핸승은 안 나온다&apos;)이 같은 배당대의 평소 비율(기대)보다 얼마나 더 맞았는지 쟀습니다.
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>1순위 점수</th><th>배변 표본 (경기)</th><th>배제 적중</th><th>기대</th><th>차이</th></tr>
          </thead>
          <tbody>
            <tr><td><b>70 이상</b></td><td>717 (2.5%)</td><td><b>80.33%</b></td><td>76.76%</td><td><b>+3.57%p</b> (옛 시즌 +2.70 · 최근 시즌 +4.79)</td></tr>
            <tr><td>60~70</td><td>2,487 (8.6%)</td><td>78.41%</td><td>76.78%</td><td>+1.62%p</td></tr>
            <tr><td>50~60</td><td>7,785 (27.0%)</td><td>77.76%</td><td>76.80%</td><td>+0.96%p</td></tr>
            <tr><td>40~50</td><td>10,035 (34.8%)</td><td>77.19%</td><td>76.96%</td><td>+0.23%p</td></tr>
            <tr><td>40 미만</td><td>7,845 (27.2%)</td><td>76.80%</td><td>77.37%</td><td>−0.57%p</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          배변 표본은 <b>점수가 높을수록 더 맞는 계단</b>이 보입니다. 그래서 배변 카드 첫 줄 점수는 <b>70점 이상 진하게 · 60~70 연하게</b> 표시합니다.
          다만 맞힌 것은 &apos;무엇이 안 나오나(배제)&apos;이고, 4결과 중 무엇이 나올지(정확히)는 어느 구간도 평소와 같았습니다.
          <b>초기 표본</b>은 점수가 높아도 효과가 없어(70 이상 +0.10%p) 회색 <b>(참고)</b>로 보입니다.
          80% 대 77% 수준의 차이라 &apos;높으면 확실&apos;이 아니라 &apos;평소보다 조금 더 믿을 만함&apos;으로 보세요.
        </p>

        <p className="help-legend-title">⑦ 주의 — 참고용입니다</p>
        <p className="help-legend-note">
          과거 26,483경기로 재 보니 표본이 나오는 경기는 <b>같은 리그 18.8% · 다른 리그 22.5%</b>(둘 중 하나라도 33.7%)였고,
          표본이 가리키는 다수 방향(정/플)이 실제와 같았던 비율은 <b>51~53%로 우연 수준</b>이었습니다.
          그래서 이 표본은 결과를 예측하는 근거가 아니라 <b>비슷한 배당의 과거 경기를 눈으로 보는 용도</b>입니다.
          표본이 없으면 칸이 <b>—</b>로 비어 있습니다.
        </p>
      </div>
    </div>
  )
}
