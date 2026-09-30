import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// StrictMode는 뺐다(2026-09-30 3차 점검). 개발 모드에서 모든 화면의 불러오기를 일부러 두 번씩
// 실행하는 검사 기능인데, 이 앱은 평소에도 개발 서버(npm run dev)로 쓰므로 서버가 늘 2배 일하고
// 요청끼리 부딪혀 각각도 느려졌다(실측: 상세보기 요청 24개 전부 2번씩 — match_detail 서버 단독
// 0.16초가 화면에서 0.9~1.3초). 배포용 빌드에서는 원래 한 번만 실행되므로 동작 자체는 같다.
createRoot(document.getElementById('root')).render(<App />)
