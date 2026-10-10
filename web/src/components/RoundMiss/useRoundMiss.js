import { useEffect, useState } from 'react'
import { api } from '../../api/client'

// 판정을 계산하는 6대리그(리그 화면 시즌 지표가 접힌 상태에서 이 표를 보일지 가릴 때도 쓴다)
export const LEAGUE_LABEL = { EPL: 'EPL', LALIGA: '라리가', SERIEA: '세리에A', BUNDES: '분데스', EREDIVISIE: '에레디', LIGUE1: '리그1' }
export const RM_LEAGUES = Object.keys(LEAGUE_LABEL)

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

// 한 리그의 한 라운드를 시즌별 경기 목록으로 — 시즌별 표(②)와 경기별 세팅값(③)이 같이 쓴다. 1분 안에는 다시 받지 않는다.
const detailCache = new Map()
export function useRoundDetail(lg, round) {
  const [det, setDet] = useState(null)
  useEffect(() => {
    if (!lg || !round) return undefined
    let alive = true
    setDet(null)
    const key = `${lg}|${round}`
    let hit = detailCache.get(key)
    if (!hit || Date.now() - hit.at > 60000) {
      hit = { at: Date.now(), p: api.get(`/api/round_miss/detail?league=${encodeURIComponent(lg)}&round=${round}`) }
      detailCache.set(key, hit)
    }
    hit.p.then((r) => alive && setDet(r)).catch(() => { detailCache.delete(key); if (alive) setDet({ seasons: {} }) })
    return () => { alive = false }
  }, [lg, round])
  return det
}
