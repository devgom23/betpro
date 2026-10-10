import { useEffect, useState } from 'react'
import { api } from '../../api/client'

// 요약은 화면 여러 곳이 같이 쓴다(시즌분석 · 리그 화면 시즌 지표 ④) — 1분 안에는 다시 받지 않는다.
let sumCache = null
export function useRoundMissSummary(enabled = true) {
  const [sum, setSum] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    if (!sumCache || Date.now() - sumCache.at > 60000) sumCache = { at: Date.now(), p: api.get('/api/round_miss') }
    sumCache.p.then((r) => alive && setSum(r)).catch((e) => { sumCache = null; if (alive) setError(e.message) })
    return () => { alive = false }
  }, [enabled])
  return { sum, error }
}
