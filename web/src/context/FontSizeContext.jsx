import { createContext, useContext, useState } from 'react'

const FontSizeContext = createContext(null)

export function FontSizeProvider({ children }) {
  const [fontSize, setFontSize] = useState('small') // 'small' | 'large' — 표 데이터 셀에만 적용

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  )
}

export function useFontSize() {
  const ctx = useContext(FontSizeContext)
  if (!ctx) throw new Error('useFontSize는 FontSizeProvider 안에서만 사용할 수 있습니다.')
  return ctx
}
