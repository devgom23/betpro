// 메모 글자 꾸밈(2026-09-15) — 형광펜 ==글자== / 취소줄 ~~글자~~ / 물결 밑줄 __글자__
// (밑줄은 2026-09-19 추가).
// DB에는 HTML이 아니라 이 표시 기호만 넣은 글자 그대로 저장한다. 그래서 예전 메모(표시
// 없는 글)는 그대로 읽히고, 화면에 그릴 때도 태그를 문자열로 끼워 넣지 않아 이상한 코드가
// 섞일 틈이 없다. 여러 꾸밈이 겹칠 수 있다(==~~둘 다~~==). 기호는 켜고 끄는 스위치라
// 여닫는 순서가 섞여도 읽는 결과는 같다.
//
// run = { text, hl, st, ul } — 같은 꾸밈이 이어지는 글자 묶음.

const MARKS = [['==', 'hl'], ['~~', 'st'], ['__', 'ul']]
const ATTRS = MARKS.map(([, a]) => a)
const noStyle = () => Object.fromEntries(ATTRS.map((a) => [a, false]))

export function parseMemo(markup) {
  const s = String(markup ?? '')
  const runs = []
  const flags = noStyle()
  let buf = ''
  const flush = () => {
    if (buf) runs.push({ text: buf, ...flags })
    buf = ''
  }
  for (let i = 0; i < s.length; i += 1) {
    const mark = MARKS.find(([m]) => s.startsWith(m, i))
    if (mark) {
      flush()
      flags[mark[1]] = !flags[mark[1]]
      i += 1
      continue
    }
    buf += s[i]
  }
  flush()
  // 닫히지 않은 표시가 남으면(사용자가 기호를 직접 친 경우 등) 꾸밈 없이 원문 그대로 둔다.
  if (ATTRS.some((a) => flags[a])) return s ? [{ text: s, ...noStyle() }] : []
  return runs
}

// 여는·닫는 기호를 꾸밈이 바뀌는 자리에서만 넣는다 — 취소줄 안에서 형광펜만 끝나도 취소줄은
// 닫았다 다시 열지 않는다.
export function serializeRuns(runs) {
  let out = ''
  const open = noStyle()
  const rev = [...MARKS].reverse()
  for (const r of runs) {
    if (!r.text) continue
    for (const [m, a] of rev) if (open[a] && !r[a]) { out += m; open[a] = false }
    for (const [m, a] of MARKS) if (r[a] && !open[a]) { out += m; open[a] = true }
    out += r.text
  }
  for (const [m, a] of rev) if (open[a]) out += m
  return out
}

export function stripMemo(markup) {
  return parseMemo(markup).map((r) => r.text).join('')
}

// 글자 하나하나로 펼쳤다가(꾸밈 켜고 끄기용) 다시 묶는다. 화면 선택 위치(Range)가 세는
// 단위(UTF-16)와 맞추려고 [...text]가 아니라 split('')로 나눈다.
export function runsToChars(runs) {
  return runs.flatMap((r) => r.text.split('').map((c) => ({ c, ...pickAttrs(r) })))
}

export function charsToRuns(chars) {
  const runs = []
  for (const ch of chars) {
    const last = runs[runs.length - 1]
    if (last && ATTRS.every((a) => !!last[a] === !!ch[a])) last.text += ch.c
    else runs.push({ text: ch.c, ...pickAttrs(ch) })
  }
  return runs
}

function pickAttrs(o) {
  return Object.fromEntries(ATTRS.map((a) => [a, !!o[a]]))
}

export function memoClass(run) {
  return [run.hl && 'memo-hl', run.st && 'memo-st', run.ul && 'memo-ul'].filter(Boolean).join(' ')
}
