// 이번주 TOP20 — 이번주 리스트 중 '당첨 확률'이 높은 경기를 1위부터 세운다.
//
// 당첨 확률 = 시스템 판정(verdictCalc.js phaseVerdict)의 rate — 가중 일치율 구간을 픽(정무·
// 플핸무)과 강추로 쪼갠 실측 당첨률(PHASE_CELL_RATE, 적중+보험). 리그 표·상세보기 판정과
// 같은 값이다. 배변 판정이 나오면 배변, 아니면 초기. 판정은 볼 때마다 지금 배당 전부로
// 다시 계산하므로(CLAUDE.md 4-1) 배변이 들어오면 칸이 바뀌어 순위도 바뀐다.
//
// ⚠ 정무·플핸무를 한 줄로 같이 세우면 정무가 다 쓸어간다 — 정무 구간(85.92%대)이
// 플핸무 최고 구간(강추 85.33%)보다 항상 높아서, 하나로 합친 TOP20은 거의 전부 정무만
// 남았다(2026-09-10 확인). 그래서 **정무 TOP15 / 플핸무 TOP15를 따로 매긴다**(2026-09-11
// 사용자 지정, 2026-09-12 TOP10→TOP15) — 갈래 안에서는 같은 방식(실측 당첨률 내림차순,
// 동률이면 킥오프 순)이다.
//
// 같은 칸끼리는 킥오프가 이른 경기부터. 가중비율(1.00 vs 0.90~0.99)은 칸 안에서 차이가
// 없어(배변 86.14% vs 85.64%, z=0.79) 기준에서 뺐다. 플핸85는 상대전적(서버 계산)이
// 있어야 알 수 있어 목록 데이터만으로는 못 쓴다.
//
// 대상 — 경기 결과(RT)와 무관하게, 이번주 리스트 전체를 매번 순수하게 시스템 판정
// 순서로 다시 매긴다(2026-09-12 사용자 지정). 예전엔 "끝난 경기는 예전에 순위에 든
// 적이 있을 때만 후보"였는데, 그 규칙 때문에 경기 시작 직전 짧은 시간에 아무도 화면을
// 안 보면(최신배당이 그 사이에 들어와 강추권으로 올라선 경우 등) 영원히 후보 자격을
// 잃는 문제가 있었다(렌 vs 마르세유 사례) — 판정 rate는 배당에서만 나오고 결과(RT)를
// 안 쓰므로, 끝난 경기를 그대로 순위 경쟁에 계속 포함해도 결과를 보고 유리하게
// 끼워 넣는 게 아니다.
//   · K1/K2(내 데이터)는 실측 %가 없어(6대리그로만 잰 값) 순위를 못 매겨 뺀다.
import { phaseVerdict } from './verdictCalc'
import { bettingDayOf } from '../components/LeagueTable/columnGroups'

export const TOP_N = 15   // 갈래(정무/플핸무) 하나당 순위 수
export const KINDS = ['정무', '플핸무']

function hasResult(v) {
  return v !== null && v !== undefined && String(v).trim() !== ''
}

// 경기 식별 키 — 여러 리그·스코프가 섞인 목록이라 L·scope까지 넣는다(LeagueTable selectKey와 같은 꼴).
export function top20Key(row) {
  return `${row.L ?? ''}|${row.scope ?? ''}|${row.S}|${row.R}|${row.No}|${row.HT}|${row.AT}`
}

// 한 경기의 순위 점수. 실측 %가 없으면 null(순위 대상 아님).
export function top20Score(row) {
  let phase = '배변'
  let v = phaseVerdict(row, true, '배변')
  if (!v.pick || v.rate == null) {
    phase = '초기'
    v = phaseVerdict(row, false, '초기')
  }
  if (!v.pick || v.rate == null) return null
  return { phase, pick: v.pick, rate: v.rate, n: v.n, bandRate: v.bandRate, strong: v.strong }
}

// 킥오프 순서 키 — 새벽(6시 전) 경기는 전날 베팅일의 맨 뒤(백엔드 _betting_day_sort_key와 같은 규칙).
function kickoffKey(row) {
  const day = bettingDayOf(row)?.key ?? '9999-99-99'
  const n = Number(row.TM)
  const tm = Number.isFinite(n) ? (Math.floor(n / 100) < 6 ? n + 2400 : n) : 9999
  return `${day}|${String(tm).padStart(4, '0')}`
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// rows: /api/week_list 행 전부 · kind: '정무' | '플핸무' · prevRanks: 직전에 저장된
// 이 갈래의 순위(Map, key → 1부터 시작하는 순위) — 등락 화살표 계산용(아래 delta 참고).
// 반환: { top: [{row, key, rank, played, score, prevRank, delta}], candidateCount }
// rankByKind가 돌려준 한 후보(c)를 사람이 읽는 문구로 바꾼다 — '이번주 TOP30' 목록
// (WeekTopPage.rankOf)과 상세보기 배당표(구분 위 칸, LeagueTable의 자동 계산)가
// 같은 문구를 쓴다. JSX는 안 만든다(이 파일은 .js라 JSX 빌드 설정이 없다) — 호출한
//쪽(.jsx)에서 이 데이터로 직접 배지를 그린다.
export function rankInfoOf(c, kind, row) {
  const { rank, played, score, prevRank, delta } = c
  const day = bettingDayOf(row)?.label ?? '날짜 미정'
  // delta>0(숫자가 커짐)=하락▼ · delta<0=상승▲ · 0=변동 없음 · null=새로 순위에 듦.
  const deltaLine = delta === null
    ? '새로 순위에 들었습니다'
    : delta === 0
      ? '직전과 순위가 같습니다'
      : delta > 0
        ? `직전 ${prevRank}위에서 ${delta}계단 내려왔습니다`
        : `직전 ${prevRank}위에서 ${-delta}계단 올라왔습니다`
  const title = [
    `${rank}위(${kind} 갈래) · ${score.phase} 판정 ${score.pick}${score.strong ? ` · ${score.strong}` : ''}`,
    `실측 당첨률 ${score.rate.toFixed(2)}% (같은 칸·같은 픽 과거 ${score.n.toLocaleString()}경기)`,
    `가중 일치율 구간 평균 ${score.bandRate.toFixed(2)}%를 픽·강추로 나눈 실측값입니다`,
    deltaLine,
    played ? '경기 종료 — 결과와 무관하게 배당(배변) 기준 판정으로 순위를 매깁니다' : `베팅일 ${day}`,
  ].join('\n')
  return { title, rank, delta, prevRank, played, score, day }
}

export function rankByKind(rows, kind, prevRanks) {
  const cands = []
  for (const row of rows) {
    if (row.scope === 'user') continue
    const key = top20Key(row)
    const score = top20Score(row)
    if (!score || score.pick !== kind) continue
    cands.push({ row, key, played: hasResult(row.RT), score, ko: kickoffKey(row) })
  }
  // 강추(strongPickTier)부터 우선 — 실측표(PHASE_CELL_RATE)상 강추 칸이 같은 픽의 어떤
  // 비강추 칸보다도 항상 높아 지금은 rate만 비교해도 결과가 같지만, 표를 다시 잴 때마다
  // 그 관계가 유지된다는 보장이 없어 강추 여부를 정렬 기준 맨 앞에 명시로 둔다(2026-09-11
  // 사용자 지정 — "플핸무 탭에서도 강추 우선으로 정렬").
  cands.sort((a, b) =>
    (b.score.strong ? 1 : 0) - (a.score.strong ? 1 : 0)
    || b.score.rate - a.score.rate
    || cmp(a.ko, b.ko)
    || cmp(a.key, b.key))
  return {
    // prevRank는 직전 저장분에 있었을 때만(없으면 null → 새로 들어온 경기, 화살표 없음).
    // delta = 이번 순위 − 직전 순위. 양수(숫자가 커짐=더 밀림)면 하락(▼), 음수면 상승(▲).
    top: cands.slice(0, TOP_N).map((c, i) => {
      const rank = i + 1
      const prevRank = prevRanks.get(c.key) ?? null
      return { ...c, rank, prevRank, delta: prevRank === null ? null : rank - prevRank }
    }),
    candidateCount: cands.length,
  }
}
