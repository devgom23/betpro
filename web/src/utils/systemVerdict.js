// 시스템 판정 — 지표 방향성 4칸 + 무배당 보정을 합쳐 하나의 결론과 신뢰도를 낸다.
//
// ── 아래 상수는 전부 실측값이다 (2026-09-02, 6대리그 29,230경기) ──
// 화면(MatchDetailModal.jsx의 analysisPair/weightedAnalysis/directionName)과 완전히
// 같은 계산을 파이썬으로 옮겨 쟀고, 코드에 이미 있던 DIR_HIT 표와 대조해 이식이
// 맞는지 확인했다(초기/갈림/국/정무/~1.5 = 코드 [85%, 534건] vs 이식 85.1%, 537건).
//
// 왜 이렇게 조합하나 — 재료를 하나씩 재서 값이 있는 것만 넣었다.
//   ✅ 4칸 일치도       만장일치 82.8% / 3칸 79.3% / 반반 77.3% / 1칸 74.8%
//   ✅ 무배당 보정      같은편 85.3% / 중립 77.7% / 무관 77.4% / 상충 73.4%
//   ✅ 해배 > 국배      갈리면 해배가 +1.8%p (McNemar z=2.69, 6/6 리그)
//   ✅ 초기 > 배변      초기 단독이 배변 단독보다 +1.2~1.4%p, 갈리면 초기가 낫다
//   ✅ 고립되면 다수결   해초가 나머지 3칸과 전부 다르면 해초보다 다수결이 낫다(아래)
//   ❌ 상대전적 우세    5개 각도로 재서 전부 0 (−0.01 ~ +1.09%p, 부호 뒤섞임)
//   ❌ 똥배·배당차      배당에서 파생된 값이라 확률 지표와 중복
//   ⚠ 무승부 궁합      국내·해외 무배당을 둘 다 고정하면 z=2.03으로 턱걸이라 뺐다
// 그래서 종합 판정은 '해배·초기' 칸을 기본으로 쓰되, 고립되면 다수결로 뒤집는다
// (resolveSystemPick). 신뢰도는 그 위에 4칸 일치도·무배당 보정을 얹어 매긴다.

const PICK_SIDE = { 정무: '정', 정역: '정', 정: '정', 플핸무: '플', 플핸승: '플', 플: '플' }
const SINGLE_NAMES = new Set(['정무', '정역', '플핸무', '플핸승'])

// ── 종합 판정 — 기본은 '해배·초기'지만, 고립되면 다수결로 뒤집는다 (2026-09-02(5)) ──
// 사용자 지적: "선덜랜드 vs 풀럼처럼 4칸 중 3칸(국초·국배·해배)이 플 방향인데
// 해초 하나 때문에 정으로 미는 건 억지 아니냐" — 실측해보니 맞는 지적이었다.
//
// 해초가 나머지 3칸과 전부 다른 경우(6대리그 3,676경기)만 떼서 대조:
//   해초를 그대로 따름          74.6%
//   나머지 3칸의 방향(대표=해배)을 따름   78.0%   z=3.00, 5/6 리그
// 무배당 보정과 교차해도 4칸 중 3칸(같은편·무관·중립)에서 다수결이 이긴다.
// 상충 칸만 표본이 작아(274건) 뒤집히는데(73.0 vs 75.5) 오차 범위 안이다.
//
// 나머지 3칸(국초·국배·해배)은 '고립' 조건상 서로 방향(정/플)은 이미 같으므로,
// 그중 대표 이름 하나를 뽑아야 실제로 걸 수 있는 픽이 나온다 — 해배(해외 배변)를
// 쓴다. 국내보다 해외가 낫고(+1.8%p), 배변이라도 나머지 둘과 같은 편이라는 확인이
// 이미 끝난 자리라 초기·배변 우위 문제가 없다.
export function resolveSystemPick(names) {
  const base = names[2]                                     // 해초
  if (!base || !PICK_SIDE[base]) return { pick: base, flipped: false }
  const others = [names[0], names[1], names[3]]              // 국초, 국배, 해배
  const agree3 = others.filter((n) => n && PICK_SIDE[n] === PICK_SIDE[base]).length
  if (agree3 === 0 && names[3] && SINGLE_NAMES.has(names[3])) {
    return { pick: names[3], flipped: true }                 // 다수결(해배)로 뒤집음
  }
  return { pick: base, flipped: false }
}

// ── 무배당 보정 ──
// 국내 무배당이 낮으면 무가 시장 예상보다 더 나오고, 높으면 덜 나온다.
//   국배 ~3.20  실제 무 30.0% (시장예상 28.5%, +1.6p, z=3.83, 7/8 리그)
//   국배 3.80+  실제 무 17.2% (시장예상 18.7%, −1.5p, z=−3.62, 1/6 리그만 반대)
// 해외 무배당은 거의 정확해서(초과분 −0.5 ~ +1.6p) 빈틈이 국내에만 있다.
// 다만 두 시장이 같이 낮을 때가 가장 강해서(z=4.06 > 3.83) '무고려'는 합의 조건으로 둔다.
const DRAW_HEAVY_K = 3.20      // 국내 무배당이 이보다 낮고
const DRAW_HEAVY_F = 3.40      // 해외 무배당도 이보다 낮으면 → 무고려 (빈도 25.1%)
const DRAW_LIGHT_K = 3.80      // 국내 무배당이 이 이상이면 → 무제외 (빈도 23.3%)

/**
 * 이 경기의 무배당이 무를 어느 쪽으로 미는가.
 * @returns {'무고려'|'무제외'|null} 국내 무배당이 없으면 null(신호가 국내에만 있다)
 */
export function drawTendency(row) {
  const kd = num(row.KD)
  const fd = num(row.FD)
  if (kd === null) return null
  if (kd < DRAW_HEAVY_K && fd !== null && fd < DRAW_HEAVY_F) return '무고려'
  if (kd >= DRAW_LIGHT_K) return '무제외'
  return null
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── 무 보정이 그 픽과 같은 편인가 ──
// 무(RT3)는 픽마다 자리가 다르다:
//   정무   적중 핸승·핸무 / 보험 무   / 죽음 역     → 무가 늘면 손해(보험으로만 산다)
//   정역   적중 핸승·핸무 / 보험 역   / 죽음 무     → 무가 늘면 죽는다
//   플핸무 적중 무·역     / 보험 핸무 / 죽음 핸승   → 무가 늘면 이득
//   플핸승 적중 무·역     / 보험 핸승 / 죽음 핸무   → 핸무는 무배당과 무관 → 항상 무관
//
// ★ 플핸승이 '무관'인 건 실측으로 확인했다 — 핸무 비율이 무배당 구간과 상관없이
//   24% 근처로 고정이라, 플핸승 적중률이 무고려 77.3% / 중립 77.3% / 무제외 77.8%로
//   소수점까지 같았다. 여기 가중치를 주면 근거 없는 조작이 된다.
const REL = {
  무고려: { 플핸무: '같은편', 정무: '상충', 정역: '상충' },
  무제외: { 플핸무: '상충', 정무: '같은편', 정역: '같은편' },
}

export function drawRelation(tendency, pick) {
  if (pick === '플핸승') return '무관'
  if (!tendency) return '중립'
  return (REL[tendency] && REL[tendency][pick]) || '중립'
}

// ── 일치도 × 무 보정 → 실측 적중률 (해초가 그대로 종합 판정일 때) ──
// [적중률%, 표본] — 16칸 전부 실측했다(가장 작은 칸이 195건).
// 두 신호가 서로 독립적으로 더해진다: 같은편이면 어느 일치도에서든 +4.4~6.2%p,
// 상충이면 −3.0~−6.5%p. 최고 86.4%(만장일치+같은편) ↔ 최저 71.8%(1칸+상충), 폭 14.6%p.
// 리그 재현은 '만장일치+같은편 vs 반반+상충'으로 4/4(분데스·에레디는 표본 부족).
// ⚠ agree=1(해초만 일치) 칸은 resolveSystemPick이 다수결로 뒤집는 대상이라, 뒤집힌
// 뒤에는 이 표가 아니라 아래 GRADE_FLIP을 쓴다 — 표본 모집단 자체가 다르다
// (이 표의 1칸 칸은 '뒤집기 전' 기준이라 뒤집힌 경기에 그대로 재사용하면 안 된다).
const GRADE = {
  4: { 같은편: [86.4, 4661], 중립: [80.6, 3471], 무관: [78.6, 1911], 상충: [76.9, 195] },
  3: { 같은편: [84.6, 2244], 중립: [78.0, 3568], 무관: [77.2, 2087], 상충: [72.7, 455] },
  2: { 같은편: [83.5, 1051], 중립: [75.8, 3062], 무관: [77.5, 1718], 상충: [74.4, 753] },
  1: { 같은편: [79.2, 260], 중립: [75.0, 1746], 무관: [75.4, 1278], 상충: [71.8, 770] },
}

// ── 고립 → 다수결로 뒤집었을 때의 적중률 (2026-09-02(5) 실측) ──
// resolveSystemPick이 flipped=true를 반환하는 경우 전용. 뒤집은 뒤에는 나머지
// 3칸이 전부 새 pick과 같은 편이 되므로(사실상 '3칸' 모양) 위 GRADE[3]과 헷갈리기
// 쉬운데, 표본 자체가 다른 별도 측정이라 섞지 않는다.
const GRADE_FLIP = { 같은편: [81.1, 834], 무관: [77.0, 939], 중립: [77.9, 1629], 상충: [73.0, 274] }

// 별 등급 경계 — 실측 적중률로 자른다(83%↑ / 78%↑ / 그 아래).
function starsOf(rate) {
  if (rate >= 83) return 3
  if (rate >= 78) return 2
  return 1
}

/**
 * 시스템 판정 등급.
 * @param {string[]} names 4칸 방향성 [국초, 국배, 해초, 해배] — null 가능
 * @param {string}   pick  resolveSystemPick()이 정한 최종 픽(해초 또는 뒤집힌 해배)
 * @param {'무고려'|'무제외'|null} tendency
 * @param {boolean}  measured 6대리그로 잰 값을 이 리그에 써도 되나(K리그는 false)
 * @param {boolean}  flipped resolveSystemPick()의 flipped 값 — 다수결로 뒤집혔는지
 */
export function systemGrade(names, pick, tendency, measured = true, flipped = false) {
  const known = names.filter(Boolean)
  if (!pick || !PICK_SIDE[pick] || known.length < 4) return null
  const agree = known.filter((n) => PICK_SIDE[n] === PICK_SIDE[pick]).length
  const rel = drawRelation(tendency, pick)
  const cell = flipped ? GRADE_FLIP[rel] : (GRADE[agree] && GRADE[agree][rel])
  // K1/K2(내 데이터)는 6대리그로만 잰 값이라 숫자를 띄우지 않는다 — 방향과 일치도만.
  if (!measured || !cell) return { agree, rel, rate: null, n: null, stars: null }
  return { agree, rel, rate: cell[0], n: cell[1], stars: starsOf(cell[0]) }
}

export const AGREE_LABEL = { 4: '4칸 만장일치', 3: '3칸 일치', 2: '반반', 1: '1칸만' }
