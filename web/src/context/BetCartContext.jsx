import { createContext, useContext, useMemo, useState } from 'react'

const BetCartContext = createContext(null)

// 리그 표 행을 조합베팅(파를레이) 다리로 하나씩 담아두는 카트.
// 리그 탭을 옮겨 다녀도(예: 김포/충북청주 리그 -> 경남/대구 리그) 유지되도록
// MainPage보다 위(App)에서 감싼다.
function legKey(l) {
  return [l.code, l.S, l.R, l.No, l.HT, l.AT].join('|')
}

export function BetCartProvider({ children }) {
  const [legs, setLegs] = useState([])

  const value = useMemo(() => ({
    legs,
    hasLeg: (leg) => legs.some((l) => legKey(l) === legKey(leg)),
    addLeg: (leg) => {
      setLegs((prev) => (prev.some((l) => legKey(l) === legKey(leg))
        ? prev
        : [...prev, { ...leg, pick_type: leg.pick_type || '' }]))
    },
    removeLeg: (leg) => {
      setLegs((prev) => prev.filter((l) => legKey(l) !== legKey(leg)))
    },
    setLegPickType: (leg, pick_type) => {
      setLegs((prev) => prev.map((l) => (legKey(l) === legKey(leg) ? { ...l, pick_type } : l)))
    },
    clear: () => setLegs([]),
  }), [legs])

  return <BetCartContext.Provider value={value}>{children}</BetCartContext.Provider>
}

export function useBetCart() {
  const ctx = useContext(BetCartContext)
  if (!ctx) throw new Error('useBetCart는 BetCartProvider 안에서만 사용할 수 있습니다.')
  return ctx
}
