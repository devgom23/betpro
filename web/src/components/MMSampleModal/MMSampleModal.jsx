import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import RtBadge from '../RtBadge/RtBadge'
import './MMSampleModal.css'

const RT_TEXT = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))

// 표본 상세 팝업(2026-09-27 사용자 지정 — "표본상세를 볼 수 잇는 팝업을 만들어줘"). 기타경기
// 목록의 '판정'·'표본' 칸이 어떤 과거 경기들을 보고 나온 숫자인지 — 그 과거 경기 목록을
// 그대로 보여준다(api/misc_matches.py sample_detail, 표본 섹션과 같은 비슷함 폭 방식).
export default function MMSampleModal({ s, r, ht, at, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    const q = new URLSearchParams({ s, r, ht, at })
    api.get(`/api/misc_matches/sample?${q.toString()}`)
      .then((res) => {
        if (!alive) return
        if (res.ready) setData(res)
        else setError(res.reason || '표본을 찾지 못했습니다.')
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [s, r, ht, at])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mm-sample-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">🔍 표본 상세</h2>
        <p className="modal-meta">
          <strong>{ht}</strong> vs <strong>{at}</strong> ({s} {r}) — 이 경기와 비슷한 국배(국내
          승무패)를 가진 6대리그+K1+K2 과거 경기들입니다. 이 목록에서 핸승·역 중 적은 쪽을
          빼고 판정을 냅니다.
        </p>

        {loading && <p className="mm-empty">불러오는 중...</p>}
        {error && !loading && <p className="mm-error">{error}</p>}

        {data && !loading && (
          <>
            <div className="mm-sample-head">
              <span>
                판정 <span className={`mm-chip ${data.pick === '정무' ? 'is-blue' : 'is-red'}`}>{data.pick}</span>
              </span>
              <span className="mm-muted">
                국배 {f2(data.q.KW)} / {f2(data.q.KD)} / {f2(data.q.KL)} · ±{data.tick}칸에서 찾음 ·{' '}
                <strong>{data.n}건</strong>{data.weak && <span className="mm-weak"> 표본적음(30건 미만)</span>}
              </span>
              <span className="mm-muted">
                핸승 {data.pct[0]}% · 핸무 {data.pct[1]}% · 무 {data.pct[2]}% · 역 {data.pct[3]}%
              </span>
            </div>

            <div className="mm-wrap mm-sample-wrap">
              <table className="mm-t">
                <thead>
                  <tr>
                    <th>리그</th><th>시즌/회차</th><th>경기</th><th>일시</th>
                    <th>국배 승/무/패</th><th>결과</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="mm-muted">{row.lg}</td>
                      <td className="mm-muted">{row.S} {row.R}</td>
                      <td className="mm-l"><b>{row.HT}</b> <span className="mm-muted">vs</span> <b>{row.AT}</b></td>
                      <td className="mm-muted">{row.DT}</td>
                      <td>{f2(row.K[0])} / {f2(row.K[1])} / {f2(row.K[2])}</td>
                      <td><RtBadge label={RT_TEXT[row.RT]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.shown < data.n && (
              <p className="mm-notice">최근 {data.shown}건만 표시합니다(전체 {data.n}건).</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
