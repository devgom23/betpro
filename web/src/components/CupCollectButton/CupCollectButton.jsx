import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import './CupCollectButton.css'

// [리그 외 배당 및 결과 수집] — 리그 탭 줄의 통합DB 왼쪽(2026-09-18 사용자 지정).
// 누르면 서버가 뒤에서 유럽대항전·컵 일정·결과, 12개사 배당, 국내배당을 받는다
// (api/collect_jobs.py). 몇 분 걸리므로 2초마다 진행 상황을 읽어 버튼 옆에 보여준다.
// 리그 경기의 12개사 배당은 여기가 아니라 '해배 가져오기'·'최신배당 불러오기' 때 같이 받는다.

const POLL_MS = 2000

// 서버 로그 한 줄을 버튼 옆에 짧게 — 앞뒤 공백만 정리한다.
function lastLine(status) {
  const lines = status?.lines || []
  return String(lines[lines.length - 1] || '').trim()
}

function resultText(status) {
  if (!status) return ''
  if (status.error) return `실패 — ${status.error}`
  const r = status.result
  if (!r) return ''
  const failed = r.failed?.length ? ` · 받기 실패 ${r.failed.length}곳(${r.failed.join(', ')})` : ''
  return `완료 ${String(status.finished || '').slice(11, 16)} · 일정 ${r.matches?.toLocaleString() ?? 0}경기 · 12개사 ${r.mb_odds ?? 0} · 국배 ${r.kr_odds ?? 0}${failed}`
}

export default function CupCollectButton() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const timer = useRef(null)

  const poll = useCallback(async () => {
    try {
      const s = await api.get('/api/cup_collect/status')
      setStatus(s)
      if (s.running) timer.current = setTimeout(poll, POLL_MS)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // 화면을 새로 열었을 때 이미 돌고 있던 수집이 있으면 이어서 보여준다.
  useEffect(() => {
    poll()
    return () => clearTimeout(timer.current)
  }, [poll])

  async function start() {
    setError('')
    try {
      const res = await api.post('/api/cup_collect/start', {})
      setStatus(res.status)
      clearTimeout(timer.current)
      timer.current = setTimeout(poll, POLL_MS)
    } catch (e) {
      setError(e.message)
    }
  }

  const running = !!status?.running
  const note = error || (running ? lastLine(status) : resultText(status))
  return (
    <span className="cup-collect">
      {note && (
        <span
          className={`cup-collect-note${error || status?.error || (!running && status?.result?.failed?.length) ? ' is-error' : ''}`}
          title={(status?.lines || []).join('\n')}
        >
          {note}
        </span>
      )}
      <button
        type="button"
        className="cup-collect-btn"
        onClick={start}
        disabled={running}
        title="유럽대항전·컵 경기의 일정·결과와 12개사·국내배당을 최신으로 받습니다(몇 분 걸림)"
      >
        {running ? '수집 중…' : '리그 외 배당 및 결과 수집'}
      </button>
    </span>
  )
}
