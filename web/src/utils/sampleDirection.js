// 표본 7개 섹션의 방향성 자동 제안과 '플핸축' 판별(2026-09-21 사용자 지정 — "레드/약레드/
// 블루/약블루 기준을 36,000여 경기를 보고 세워라, 7개가 한 방향이고 배당도 강하게 가리키면
// 단통을 찍을 수 있는지 분석해라").
//
// ── 기준 (2026-09-24 전면 개편 — 사용자 지정) ────────────────────────────────
// 예전엔 '이 경기 방향'(위 줄) 하나만 보고 판정했다. 사용자가 실제로 라벨을 고를 때는
// **위 줄과 아래 줄(반대 방향)을 같이** 봤다고 해서 그 방식으로 바꿨다:
//   ① 두 줄이 같은 방향을 가리키면 → 블루(또는 레드), 크기가 작으면 '약'
//   ② 두 줄이 서로 다른 방향이면  → 엇갈림 (크기와 무관)
//   ③ 한 줄에만 표본이 있으면     → 있는 줄만으로 판정
//
// t = (경기당 흐름 − 0.1644) × √표본수 ÷ 1.5858
//   경기당 흐름 = (핸승×2+핸무 − 무 − 역×2) ÷ 표본수 (−2 ~ +2)
//   0.1644 = 6대리그 36,160경기 전체의 평균 흐름 ★ 2026-09-24 추가한 '중심 보정'
//   1.5858 = 같은 전수의 표준편차(예전에 쓰던 1.585가 실측과 맞았다)
// ★ 중심 보정을 왜 넣었나: 정배승(RT1+2)이 원래 53.73%라 흐름의 평균이 0이 아니라
//   +0.1644다. 보정 없이 '흐름>0이면 정배 쪽'으로 보면, 실제로는 6대리그 평균과 똑같은
//   표본이 '약블루'로 찍힌다(보정 전 t 0~0.75 구간 실측 정배승 49~53% — 기준선 54% 미만).
//   빼주고 나면 부호가 곧 "평균보다 정배 쪽인가"가 되어 ①의 방향 비교가 뜻을 갖는다.
// 판정에 쓰는 t는 두 줄의 t를 각각 구해 **평균**낸 값이다(사용자 지정).
//
//   두 줄 평균 t ≥ 1.25   블루     (정배승 71.41% · 기준선 54.02% 대비 +17.4%p)
//   0 < 평균 t < 1.25     약블루   (정배승 58.78% · +4.8%p)
//   두 줄이 반대 방향     엇갈림   (정배승 52.54% — 거의 반반, 정보가 없다)
//   −1.5 < 평균 t ≤ 0     약레드   (플핸 52.28% · +6.3%p)
//   평균 t ≤ −1.5         레드     (플핸 58.35% · +12.4%p)
//   두 줄 다 표본 0건     표본없음
// 경계 1.25/−1.5는 36,160경기 전수 실측에서 기준선 대비 ±10%p 이상 벌어지는 지점이다.
// 앞/뒤 절반으로 갈라도 같다(블루 72.07→70.87 · 레드 42.32→41.15 · 엇갈림 52.73→52.30).
// 7개 섹션 전부 같은 방향으로 갈렸다(블루계열−레드계열 정배승 차이 13.9~24.5%p).
// 예전 방식보다 판정을 내는 줄이 53.3%→72.8%로 늘고, 블루 순도도 69.09%→71.41%로 올랐다.
//
// ⚠ 섹션 하나하나는 배당 이상의 정보를 거의 안 준다 — 위 실측 %는 같은 배당대의 기대치와
//   거의 같다(초과분 −1.7~+1.1%p). 방향은 맞지만 그 정보가 배당에서 온 것이다.
//   블루 쪽은 7개가 전부 블루여도 배당 이상이 없었다(75.9% vs 배당 78.8%).
//
// ── 플핸축 — 이 분석에서 배당을 넘어선 유일한 조합 ─────────────────────────
// 7개 섹션이 전부 t ≤ −1(레드·약레드, 표본 있음) + 아래 셋 중 하나
//   ① 정역반전(국내 또는 해외)  ② 국≠해(국내·해외 정배가 다른 팀)  ③ 해외 정배배당 2.5↑(배변 우선)
// 6대리그 18시즌, 경기 날짜 이전 경기만으로 표본을 다시 세서(미래 경기 제외) 잰 값:
//   n=100 · 단통 플핸(무+역) 78.0% · 같은 배당 기대 61.5% · +16.5%p · z=4.00
//   앞 12시즌 76.7%(n=30) → 뒤 6시즌 78.6%(n=70, z=3.52) · 리그 6/6 같은 방향(분데스·에레디 약함)
//   초기 국내 플핸 배당 평균 1.48, 회수율 1.131 · 최근 시즌 기준 한 시즌 약 12경기
// 셋 다 없이 7레드만이면 64.7%(기대 59.8%, z=1.04)로 약하다 — 그래서 뱃지는 따로 표시한다.
//
// ⚠ 플축·정축은 위 화면 라벨을 쓰지 않는다(2026-09-24). 아래 plhanAxis/axisVerdict와
//   서버 api/axis_stats.py는 예전 기준(이 경기 방향 한 줄 · 보정 없는 t ≤ −1 / ≥ 1)을
//   그대로 쓴다 — 두 줄 평균으로 바꿔서 재보니 플축이 확실히 나빠졌기 때문이다
//   (7레드: 예전 202건 플핸 71.29% → 새 기준 중 가장 좋은 임계로도 111건 67.57%).
//   플축은 "이 경기의 배당 자리에서 플핸이 많이 나왔다"는 신호라 반대편 자리를 섞으면
//   신호가 묽어진다. 그래서 화면 라벨(사람이 읽는 것)과 플축 내부 셈(성능)이 갈라져 있다.
export const SAMPLE_FLOW_SD = 1.585        // 플축·정축 전용(예전 기준 유지)
export const SAMPLE_FLOW_SD_X = 1.5858     // 화면 라벨용 — 36,160경기 전수 실측 표준편차
export const SAMPLE_FLOW_MU = 0.1644       // 화면 라벨용 — 전수 평균 흐름(중심 보정)
export const SAMPLE_BLUE_T = 1.25
export const SAMPLE_RED_T = -1.5
export const SAMPLE_SECTION_ORDER = ['fav', 'pl', 'ffav', 'k_wl', 'f_wl', 'k_wdl', 'f_wdl']

// 섹션의 '이 경기 방향 · 통합' 카운트 [핸승,핸무,무,역] — 서버 samples[key][0].total.
export function sectionSelfTotal(samples, key) {
  const entries = samples?.[key]
  if (!Array.isArray(entries) || !entries.length) return null
  return entries[0]?.total || null
}

// 섹션의 '반대 방향 · 통합' 카운트 — 표의 아래 줄(samples[key][1].total).
// 같은 배당값이 반대 자리(원정↔홈, 언더독 반대편)에서 나온 경기들이다.
export function sectionMirrorTotal(samples, key) {
  const entries = samples?.[key]
  if (!Array.isArray(entries) || entries.length < 2) return null
  return entries[1]?.total || null
}

// 플축·정축이 쓰는 예전 t(중심 보정 없음, 한 줄 기준) — 바꾸지 말 것(위 ⚠ 참고).
export function sampleFlowT(vals) {
  if (!vals) return { t: null, n: 0, flow: null }
  const n = vals.reduce((a, b) => a + (Number(b) || 0), 0)
  if (n <= 0) return { t: null, n: 0, flow: null }
  const [hs, hm, mu, yk] = vals.map((v) => Number(v) || 0)
  const flow = (hs * 2 + hm - mu - yk * 2) / n
  return { t: (flow * Math.sqrt(n)) / SAMPLE_FLOW_SD, n, flow }
}

// 화면 라벨용 t — 중심 보정(−0.1644)을 넣어 '평균보다 정배 쪽인가'를 0 기준으로 만든다.
export function sampleFlowTx(vals) {
  if (!vals) return { t: null, n: 0, flow: null }
  const n = vals.reduce((a, b) => a + (Number(b) || 0), 0)
  if (n <= 0) return { t: null, n: 0, flow: null }
  const [hs, hm, mu, yk] = vals.map((v) => Number(v) || 0)
  const flow = (hs * 2 + hm - mu - yk * 2) / n
  return { t: ((flow - SAMPLE_FLOW_MU) * Math.sqrt(n)) / SAMPLE_FLOW_SD_X, n, flow }
}

// 두 줄(이 경기 방향 / 반대 방향)로 방향을 판정한다 — 파일 맨 위 기준 주석 참고.
// 반환에 self·mirror를 같이 실어 화면 툴팁이 두 줄을 그대로 보여줄 수 있게 한다.
export function autoSampleDirection(selfVals, mirrorVals) {
  const s = sampleFlowTx(selfVals)
  const m = sampleFlowTx(mirrorVals)
  const base = { self: s, mirror: m }
  if (s.t === null && m.t === null) {
    return { label: '표본없음', t: null, n: 0, flow: null, clash: false, ...base }
  }
  const n = s.n + m.n
  // ② 두 줄이 서로 다른 방향을 가리키면 크기와 무관하게 엇갈림.
  //    (한쪽이 정확히 평균이면(0) 반대라고 보지 않는다 — 나머지 한 줄을 따른다.)
  if (s.t !== null && m.t !== null && s.t !== 0 && m.t !== 0 && Math.sign(s.t) !== Math.sign(m.t)) {
    return { label: '엇갈림', t: (s.t + m.t) / 2, n, flow: null, clash: true, ...base }
  }
  // ①③ 같은 방향(또는 한 줄만 있음) — 두 t의 평균으로 강약을 가른다.
  const ts = [s.t, m.t].filter((v) => v !== null)
  const t = ts.reduce((a, b) => a + b, 0) / ts.length
  let label
  if (t >= SAMPLE_BLUE_T) label = '블루'
  else if (t > 0) label = '약블루'
  else if (t > SAMPLE_RED_T) label = '약레드'
  else label = '레드'
  return { label, t, n, flow: null, clash: false, ...base }
}

// 화면이 samples에서 바로 판정까지 가는 지름길 — 두 줄을 알아서 꺼내 쓴다.
export function autoSectionDirection(samples, key) {
  return autoSampleDirection(sectionSelfTotal(samples, key), sectionMirrorTotal(samples, key))
}

function favHome(w, l) {
  const a = Number(w)
  const b = Number(l)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return null
  return a < b
}

function firstNum(...vs) {
  for (const v of vs) {
    const n = Number(v)
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0) return n
  }
  return null
}

// ── 플축 · 정축 (2026-09-21, 사용자 지정 "z 2.0 안 넘어도 확률과 표본이 많으면 된다") ──
// 32,900경기, 경기 이전 기록만으로 센 실측. 조합 5,285개를 앞 12시즌 적중률로 고르고
// 뒤 6시즌에서 다시 맞는지로 확인했다(z 대신).
//   플축 P1  7레드 + 배당신호                                      78.0% n=100 앞76.7/뒤78.6 회수 1.131
//   플축 P3  5레드↑ + 배당신호 + 전적 역배편 + 폼·순위 정배편 아님   77.1% n=118 앞75.9/뒤78.3 회수 1.103
//   플축 P2  7레드 + 국내 정배배당 2.1 초과 + 전적 정배편 아님       76.0% n=146 앞77.3/뒤75.5 회수 1.108
//   (셋 중 하나라도 75.5% n=269, 최근 시즌 기준 한 시즌 약 28경기)
//   정축 A   정배배당 1.15↓ + 블루7 + 전적·순위·폼 전부 정배편      84.7% n=242 앞83.4/뒤87.1 회수 0.908
//   정축 B   정배배당 1.20↓ + 블루6↑ + 전적·순위 정배편            82.6% n=643 앞81.7/뒤84.1 회수 0.906
// ⚠ 정축은 같은 배당의 기대치(82~84%)만큼만 맞는다 — 적중률은 높지만 단통 장기 회수율 0.91.
// 레드/블루 = 자동 방향성(레드·약레드 / 블루·약블루). '정배' = 국내 초기 정배(KW<KL이면 홈).
// 전적 = 최근 5시즌(이번 시즌 포함) 맞대결 정배 관점 보정승점 (승점+1.363×5)/(경기+5) − 1.363,
//        +0.30↑ 정배편 / −0.30↓ 역배편. 시즌폼 = HTF−ATF(정배 관점) +0.5↑ 정배편 / −0.2↓ 역배편.
//        순위 = 정배가 8계단↑ 위면 정배편 / 역배가 2계단↑ 위면 역배편.
//
// ── 숫자는 서버가 스스로 다시 잰다 (2026-09-21 사용자 지정 A+B안) ──────────────────
// B: api/axis_stats.py가 위와 똑같은 조건으로 전 경기를 다시 세서 등급별 적중률을 낸다
//    (결과가 새로 들어오면 뒤에서 다시 계산 — /api/axis_stats).
// A: 뱃지 % = 이 경기 배당의 기대치(서버가 맞춘 배당 모델) + 그 등급이 배당보다 더 맞은 몫(uplift).
//    그래서 같은 P1이라도 배당에 따라 %가 달라진다.
// 아래 FALLBACK은 서버 응답을 못 받았을 때만 쓰는 값(2026-09-21 32,935경기 측정).
// ⚠ 정축 B는 A가 아닌 경기만 센 값이다(A 포함 82.6% → A 제외 81.3%).
export const AXIS_FALLBACK = {
  model: { coef: [0.150831, -0.003402, -0.053116, 1.135303, -0.118703, -0.017575] },
  tiers: {
    P1: { side: '플', n: 100, rate: 78.0, exp: 64.38, uplift: 13.62, early: 76.67, late: 78.57, roi: 1.131, per_season: 11.7, text: '7레드 + 배당신호' },
    P3: { side: '플', n: 116, rate: 77.59, exp: 64.26, uplift: 13.32, early: 75.86, late: 79.31, roi: 1.111, per_season: 9.7, text: '5레드↑ + 배당신호 + 전적 역배편 + 폼·순위 정배편 아님' },
    P2: { side: '플', n: 146, rate: 76.03, exp: 62.22, uplift: 13.8, early: 77.27, late: 75.49, roi: 1.108, per_season: 17.0, text: '7레드 + 국내 정배배당 2.1 초과 + 전적 정배편 아님' },
    A: { side: '정', n: 242, rate: 84.71, exp: 83.52, uplift: 1.19, early: 83.44, late: 87.06, roi: 0.908, per_season: 14.2, text: '정배배당 1.15↓ + 블루7 + 전적·순위·폼 전부 정배편' },
    B: { side: '정', n: 401, rate: 81.3, exp: 81.29, uplift: 0.0, early: 80.63, late: 82.43, roi: 0.905, per_season: 24.7, text: '정배배당 1.20↓ + 블루6↑ + 전적·순위 정배편' },
    RED7: { side: '플', n: 37, rate: 56.76, exp: 57.01, uplift: -0.25, early: 50.0, late: 58.62, roi: 0.873, per_season: 4.8, text: '7레드인데 플축 조건 없음' },
  },
  seasons: { early: '09-10~20-21', late: '21-22~26-27' },
}

// 배당 모델 — 국내 초기 정배가 이길(RT1+2) 확률. api/axis_stats.py model_row와 같은 식:
// 입력 = logit(국초 정배 승확률) · logit(해초 같은 팀) · logit(해배 같은 팀) · 해배 있음 · 정배 홈.
// 해초·해배가 없으면 바로 앞 값으로 채운다. 확률은 1/배당을 세 칸 합으로 나눈 값(마진 제거).
function implied(w, d, l) {
  const a = num(w)
  const b = num(d)
  const c = num(l)
  if (!a || !b || !c || a <= 0 || b <= 0 || c <= 0) return null
  const inv = 1 / a + 1 / b + 1 / c
  return [(1 / a) / inv, (1 / c) / inv]
}
const logit = (p) => {
  const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4)
  return Math.log(q / (1 - q))
}
export function axisExpected(row, model) {
  const coef = model?.coef
  const kw = num(row.KW)
  const kl = num(row.KL)
  const pk = implied(row.KW, row.KD, row.KL)
  if (!coef || kw === null || kl === null || !pk) return null
  const side = kw < kl ? 0 : 1
  const pf = implied(row.FW, row.FD, row.FL)
  const pe = implied(row.EFW, row.EFD, row.EFL)
  const p_k = pk[side]
  const p_f = pf ? pf[side] : p_k
  const p_fe = pe ? pe[side] : p_f
  const x = [1, logit(p_k), logit(p_f), logit(p_fe), pe ? 1 : 0, kw < kl ? 1 : 0]
  const z = x.reduce((s, v, i) => s + v * coef[i], 0)
  return 1 / (1 + Math.exp(-z))
}

// 이 경기의 뱃지 % — 배당 기대(그 쪽) + 등급 몫. 0~100 밖으로는 안 나가게 1~99로 자른다.
export function axisMatchPct(row, stats, tierKey) {
  const src = stats?.tiers?.[tierKey]?.rate != null && stats?.model?.coef ? stats : AXIS_FALLBACK
  const t = src.tiers[tierKey]
  const pJ = axisExpected(row, src.model)
  if (!t || pJ === null) return { tier: t, exp: null, pct: t?.rate ?? null }
  const exp = (t.side === '정' ? pJ : 1 - pJ) * 100
  return { tier: t, exp, pct: Math.min(99, Math.max(1, exp + t.uplift)) }
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 최근 5시즌 맞대결(홈팀 관점) → 정배 관점 보정승점 차. matches = pick_ai h2h.matches
// (경기 직전까지·최신순 최대 15경기 — 한 시즌 2번씩이라 5시즌이면 다 들어온다).
function h2hEdge(matches, row, favIsHome) {
  const si = parseInt(String(row.S).slice(0, 2), 10)
  const ht = String(row.HT).trim()
  let pts = 0
  let n = 0
  for (const m of matches || []) {
    const ms = parseInt(String(m.S).slice(0, 2), 10)
    const hs = num(m.HS)
    const as = num(m.AS)
    if (!Number.isFinite(ms) || ms < si - 4 || ms > si || hs === null || as === null) continue
    const home = String(m.HT).trim() === ht
    const mine = home ? hs : as
    const theirs = home ? as : hs
    pts += mine > theirs ? 3 : mine === theirs ? 1 : 0
    n += 1
  }
  const edge = (pts + 1.363 * 5) / (n + 5) - 1.363
  return { edge: favIsHome ? edge : -edge, n }
}

const side3 = (x, hi, lo) => (x >= hi ? '정배' : x <= lo ? '역배' : '보합')

// 플축·정축이 세는 '레드/블루' — 화면 라벨(autoSampleDirection)과 일부러 다르다.
// 이 경기 방향 한 줄만, 중심 보정 없는 예전 t로 t≤−1을 레드, t≥1을 블루로 센다
// (= 예전 화면 라벨의 레드+약레드 / 블루+약블루와 똑같은 범위). 서버 api/axis_stats.py도
// 같은 식이라 둘이 어긋나면 안 된다. 왜 안 바꿨는지는 이 파일 맨 위 ⚠ 참고.
function axisSideLabel(vals) {
  const { t } = sampleFlowT(vals)
  if (t === null) return null
  return t <= -1 ? '레드' : t >= 1 ? '블루' : null
}

// 플축·정축 판별. h2hMatches가 아직 없으면(불러오는 중) null — 전적이 필요한 조건이 있어서.
// 반환: { pl: 'P1'|'P3'|'P2'|null, plAll: [...], jung: 'A'|'B'|null, ctx }
export function axisVerdict(samples, row, h2hMatches) {
  if (!samples || !h2hMatches) return null
  const labels = SAMPLE_SECTION_ORDER.map((k) => axisSideLabel(sectionSelfTotal(samples, k)))
  const nred = labels.filter((l) => l === '레드').length
  const nblue = labels.filter((l) => l === '블루').length
  const kw = num(row.KW)
  const kl = num(row.KL)
  if (kw === null || kl === null) return null
  const favIsHome = kw < kl
  const sg = favIsHome ? 1 : -1
  const jungOdds = Math.min(kw, kl)
  const cues = plhanAxis(samples, row)?.cues || []
  const h = h2hEdge(h2hMatches, row, favIsHome)
  const htf = num(row.HTF)
  const atf = num(row.ATF)
  const hp = num(row.HP)
  const ap = num(row.AP)
  const form = side3(htf !== null && atf !== null ? (htf - atf) * sg : 0, 0.5, -0.2)
  const rank = side3(hp !== null && ap !== null ? ((ap - hp) * sg) / 10 : 0, 0.8, -0.2)
  const h2h = side3(h.edge, 0.3, -0.3)

  const plAll = []
  if (nred === 7 && cues.length) plAll.push('P1')
  if (nred >= 5 && cues.length && h2h === '역배' && form !== '정배' && rank !== '정배') plAll.push('P3')
  if (nred === 7 && jungOdds > 2.1 && h2h !== '정배') plAll.push('P2')

  let jung = null
  if (jungOdds <= 1.15 && nblue === 7 && h2h === '정배' && rank === '정배' && form === '정배') jung = 'A'
  else if (jungOdds <= 1.2 && nblue >= 6 && h2h === '정배' && rank === '정배') jung = 'B'

  return {
    pl: plAll[0] || null, plAll, jung,
    ctx: { nred, nblue, cues, jungOdds, h2h, h2hN: h.n, h2hEdge: h.edge, form, rank },
  }
}

// 플핸축 판별 — { red7, cues: ['정역반전', ...], axis } / 표본을 아직 못 받았으면 null.
export function plhanAxis(samples, row) {
  if (!samples) return null
  const red7 = SAMPLE_SECTION_ORDER.every((key) => {
    const { t, n } = sampleFlowT(sectionSelfTotal(samples, key))
    return n > 0 && t !== null && t <= -1
  })
  const cues = []
  const flip = (w, l, ew, el) => {
    const a = favHome(row[w], row[l])
    const b = favHome(row[ew], row[el])
    return a !== null && b !== null && a !== b
  }
  if (flip('KW', 'KL', 'EKW', 'EKL') || flip('FW', 'FL', 'EFW', 'EFL')) cues.push('정역반전')
  const kf = favHome(row.KW, row.KL)
  const ff = favHome(row.FW, row.FL)
  if (kf !== null && ff !== null && kf !== ff) cues.push('국≠해')
  const fw = firstNum(row.EFW, row.FW)
  const fl = firstNum(row.EFL, row.FL)
  if (fw !== null && fl !== null && Math.min(fw, fl) >= 2.5) cues.push('해외접전')
  return { red7, cues, axis: red7 && cues.length > 0 }
}
