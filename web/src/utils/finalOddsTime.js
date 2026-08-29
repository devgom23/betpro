// "최신배당 불러오기"를 마지막으로 실제 실행한 시각 — 브라우저(localStorage)에 저장.
//
// 두 화면이 각각 독립된 값을 가진다(요구사항 그대로):
//   · 리그 화면(리그+시즌+라운드 하나) — 그 라운드 버튼을 직접 눌렀을 때만 갱신
//   · 이번주 리스트(화면에 보이는 여러 조합을 한 번에) — 그 버튼을 직접 눌렀을 때만 갱신
// 단, 이번주 리스트에서 누르면 실제로 그 안의 각 라운드를 전부 갱신하는 것이므로
// (같은 API를 조합마다 그대로 호출) 그 각 라운드의 값도 같이 찍는다 — 반대로 리그
// 화면에서 한 라운드만 눌렀다고 이번주 리스트 값이 바뀌면 안 된다(그건 "전체를
// 갱신했다"는 뜻이 아니므로).
//
// ⚠ 지금은 로컬 1인용이라 브라우저 저장이지만, 여러 사람이 같이 쓰는 서버 제품이
// 되면 기기마다 값이 따로 놀아서 안 맞는다 — 그때는 이 파일의 get/set 구현만
// 백엔드 API 호출로 바꾸면 된다(호출부는 안 건드려도 되게 함수로 감싸 둠).

const PREFIX = 'betpro_final_odds_ts'
const WEEKLIST_KEY = `${PREFIX}::weeklist`

function roundKey(scope, code, season, round) {
  return `${PREFIX}::${scope}::${code}::${season}::${round}`
}

function readRaw(key) {
  try {
    const v = localStorage.getItem(key)
    return v || null
  } catch {
    return null
  }
}

function writeRaw(key, iso) {
  try {
    localStorage.setItem(key, iso)
  } catch {
    // 저장 실패(프라이빗 모드 등)해도 화면 동작 자체는 막지 않는다 — 시각 표시만 안 될 뿐.
  }
}

/** 'YY-MM-DD HH:mm' — DB의 DT 컬럼과 같은 두 자리 연도 표기(utils/format.js formatDt 참고). */
export function formatFinalOddsTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${yy}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function getRoundFinalOddsTime(scope, code, season, round) {
  return readRaw(roundKey(scope, code, season, round))
}

export function setRoundFinalOddsTime(scope, code, season, round, iso = new Date().toISOString()) {
  writeRaw(roundKey(scope, code, season, round), iso)
}

/** 이번주 리스트가 한 번에 처리한 (scope,code,season,round) 조합 전부에 같은 시각을 찍는다. */
export function setManyRoundFinalOddsTime(combos, iso = new Date().toISOString()) {
  for (const { scope, code, season, round } of combos) {
    writeRaw(roundKey(scope, code, season, round), iso)
  }
}

export function getWeekListFinalOddsTime() {
  return readRaw(WEEKLIST_KEY)
}

export function setWeekListFinalOddsTime(iso = new Date().toISOString()) {
  writeRaw(WEEKLIST_KEY, iso)
}
