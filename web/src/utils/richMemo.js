// 메모 글자 꾸밈(2026-09-15) — 형광펜 ==글자== / 취소줄 ~~글자~~.
// DB에는 HTML이 아니라 이 표시 기호만 넣은 글자 그대로 저장한다. 그래서 예전 메모(표시
// 없는 글)는 그대로 읽히고, 화면에 그릴 때도 태그를 문자열로 끼워 넣지 않아 이상한 코드가
// 섞일 틈이 없다. 둘은 겹칠 수 있다(==~~둘 다~~==).
//
// run = { text, hl, st } — 같은 꾸밈이 이어지는 글자 묶음.

const MARKS = [['==', 'hl'], ['~~', 'st']]

export function parseMemo(markup) {
  const s = String(markup ?? '')
  const runs = []
  const flags = { hl: false, st: false }
  let buf = ''
  const flush = () => {
    if (buf) runs.push({ text: buf, hl: flags.hl, st: flags.st })
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
  if (flags.hl || flags.st) return s ? [{ text: s, hl: false, st: false }] : []
  return runs
}

// 여는·닫는 기호를 꾸밈이 바뀌는 자리에서만 넣는다 — 취소줄 안에서 형광펜만 끝나도 취소줄은
// 닫았다 다시 열지 않는다.
export function serializeRuns(runs) {
  let out = ''
  let hl = false
  let st = false
  for (const r of runs) {
    if (!r.text) continue
    if (st && !r.st) { out += '~~'; st = false }
    if (hl && !r.hl) { out += '=='; hl = false }
    if (r.hl && !hl) { out += '=='; hl = true }
    if (r.st && !st) { out += '~~'; st = true }
    out += r.text
  }
  if (st) out += '~~'
  if (hl) out += '=='
  return out
}

export function stripMemo(markup) {
  return parseMemo(markup).map((r) => r.text).join('')
}

// 글자 하나하나로 펼쳤다가(꾸밈 켜고 끄기용) 다시 묶는다. 화면 선택 위치(Range)가 세는
// 단위(UTF-16)와 맞추려고 [...text]가 아니라 split('')로 나눈다.
export function runsToChars(runs) {
  return runs.flatMap((r) => r.text.split('').map((c) => ({ c, hl: r.hl, st: r.st })))
}

export function charsToRuns(chars) {
  const runs = []
  for (const ch of chars) {
    const last = runs[runs.length - 1]
    if (last && last.hl === ch.hl && last.st === ch.st) last.text += ch.c
    else runs.push({ text: ch.c, hl: ch.hl, st: ch.st })
  }
  return runs
}

export function memoClass(run) {
  return [run.hl && 'memo-hl', run.st && 'memo-st'].filter(Boolean).join(' ')
}
