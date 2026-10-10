import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { RichMemoInput } from '../RichMemo/RichMemo'

// 라운드별 판정 메모 한 줄(2026-10-10 사용자 지정) — 리그·시즌·라운드마다, kind('tab' 탭 옆 · 'games' 경기별 세팅값) 따로 저장한다.
// 앱 전체 메모 칸 관례(RichMemoInput)를 그대로 쓴다.
export default function RoundMissMemo({ lg, season, round, kind, placeholder }) {
  const [memo, setMemo] = useState('')
  const [saved, setSaved] = useState('')
  const q = new URLSearchParams({ league: lg || '', season: season || '', round: String(round || ''), kind })
  useEffect(() => {
    if (!lg || !season || !round) { setMemo(''); setSaved(''); return undefined }
    let alive = true
    api.get(`/api/round_miss/note?${q.toString()}`)
      .then((r) => { if (alive) { setMemo(r?.memo || ''); setSaved(r?.memo || '') } })
      .catch(() => { if (alive) { setMemo(''); setSaved('') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lg, season, round, kind])

  function commit(next) {
    setMemo(next)
    if (next === saved) return
    const before = saved
    setSaved(next)
    api.post('/api/round_miss/note', { league: lg, season, round: Number(round), kind, memo: next || null })
      .catch(() => { setMemo(before); setSaved(before) })    // 저장 실패하면 되돌린다
  }
  if (!lg || !season || !round) return null
  return <RichMemoInput className="rm-memo" value={memo} placeholder={placeholder} onCommit={commit} />
}
