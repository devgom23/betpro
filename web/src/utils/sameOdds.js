// 동배당(정배·플핸) 상세 목록 공용 포맷 — 상세보기 '동' 뱃지 호버와 리그 표 이중밑줄
// 호버가 반드시 같은 문구를 쓰게 한다(2026-09-20 사용자 지적 — 같은 내용을 두 곳이
// 각자 따로 만들어서 한쪽만 고치면 다른 쪽이 안 맞았다. pickOptions.js와 같은 이유로
// 포맷을 여기 하나로 모은다 — 고칠 게 생기면 이 파일 하나만 고치면 된다).
import { formatDt, formatTime } from './format'
import { rtToText } from '../components/LeagueTable/columnGroups'

// entry: { league, round, dt, tm, home, away, markHome, hs, as_, rt }
//   markHome — 이 경기에서 '표시할 쪽'(정 또는 플)이 홈팀인지. 팀 이름 옆에 (정)/(플)을 붙인다.
//   hs/as_/rt — 지난 경기면(둘 다 있으면) 스코어·판정(핸승/핸무/무/역)을 줄 끝에 덧붙인다.
//   아직 안 끝난 경기는 hs/as_가 없어 팀 이름까지만 보여준다.
function formatSameOddsEntry(entry, mark) {
  const line = `· ${[formatDt(entry.dt), formatTime(entry.tm)].filter(Boolean).join(' ')} `
    + `${entry.league}${entry.round ? ` ${entry.round}` : ''} `
    + `${entry.home}${entry.markHome ? `(${mark})` : ''} vs ${entry.away}${entry.markHome ? '' : `(${mark})`}`
  if (entry.hs === null || entry.hs === undefined || entry.as_ === null || entry.as_ === undefined) return line
  const rt = rtToText(entry.rt)
  return `${line} — ${entry.hs}:${entry.as_}${rt ? ` ${rt}` : ''}`
}

// label: '정배' | '플핸(언더독 핸디)' 등 사람이 읽을 이름. mark: '정' | '플' 등 팀 이름 옆에 붙일 글자.
export function sameOddsGroupTitle(label, odds, entries, mark) {
  const list = entries.map((o) => formatSameOddsEntry(o, mark)).join('\n')
  return `같은 회차에 국내 ${label}배당이 ${odds}로 똑같은 경기가 ${entries.length}개 더 있습니다.\n${list}`
}
