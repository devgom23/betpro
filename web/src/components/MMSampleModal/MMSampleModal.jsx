import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { PICK_OPTIONS } from '../../utils/pickOptions'
import { pickPatchBody } from '../../utils/pickSave'
import RtBadge from '../RtBadge/RtBadge'
import './MMSampleModal.css'

const RT_TEXT = { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2))

// 표본 상세 팝업(2026-09-27 사용자 지정 — "표본상세를 볼 수 잇는 팝업을 만들어줘"). 기타경기
// 목록의 '판정'·'표본' 칸이 어떤 과거 경기들을 보고 나온 숫자인지 — 그 과거 경기 목록을
// 그대로 보여준다(api/misc_matches.py sample_detail, 표본 섹션과 같은 비슷함 폭 방식).
// 내픽(2026-09-27 사용자 지정 — "내픽 컬럼 선택하면 표본상세 팝업이 뜨고 거기서 내픽 선택할
// 수 있게 해줘") — 저장은 다른 리그와 똑같이 /api/leagues/{code}/my_picks 하나를 그대로 쓴다
// (web/src/utils/pickSave.js — LeagueTable·상세보기와 같은 함수).
export default function MMSampleModal({ s, r, ht, at, no, code, scope, myPick, phase, onPickSaved, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pick, setPick] = useState(myPick || '')
  const [pickError, setPickError] = useState('')

  useEffect(() => { setPick(myPick || '') }, [myPick])

  function handlePickChange(e) {
    const next = e.target.value
    setPick(next)
    setPickError('')
    const body = pickPatchBody(scope, { S: s, R: r, No: no ?? '', HT: ht, AT: at }, { pick: next })
    api.post(`/api/leagues/${code}/my_picks`, body)
      .then(() => onPickSaved?.(next || null))
      .catch((err) => setPickError(err.message))
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    const q = new URLSearchParams({ s, r, ht, at, phase: phase || 'final' })
    api.get(`/api/misc_matches/sample?${q.toString()}`)
      .then((res) => {
        if (!alive) return
        if (res.ready) setData(res)
        else setError(res.reason || '표본을 찾지 못했습니다.')
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [s, r, ht, at, phase])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mm-sample-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">🔍 표본 상세 — {(data?.phase ?? phase) === 'init' ? '초기' : '배변'} 판정</h2>
        <p className="modal-meta">
          <strong>{ht}</strong> vs <strong>{at}</strong> ({s} {r}) — 이 경기와 비슷한{' '}
          {data?.viaHandi ? '국핸디(국내 핸디 승/무/패)' : '국배(국내 승무패)'}를 가진
          6대리그+K1+K2 과거 경기들입니다. 이 목록에서 핸승·역 중 적은 쪽을 빼고 판정을 냅니다.
          {data?.viaHandi && (
            <><br /><span className="mm-weak">
              이 경기는 국배(승무패) 자체가 없어(정배가 워낙 강해 프로토가 안 엶) 국핸디로
              대신 찾았습니다.
            </span></>
          )}
        </p>

        <div className="mm-sample-pick">
          <label>
            내픽{' '}
            <select value={pick} onChange={handlePickChange}>
              <option value="">(선택 안 함)</option>
              {PICK_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          {pickError && <span className="mm-error"> 저장 실패 — {pickError}</span>}
        </div>

        {loading && <p className="mm-empty">불러오는 중...</p>}
        {error && !loading && <p className="mm-error">{error}</p>}

        {data && !loading && (
          <>
            <div className="mm-sample-head">
              <span>
                {data.phase === 'init' ? '초기' : '배변'} 판정{' '}
                <span className={`mm-chip ${data.pick === '정무' ? 'is-blue' : 'is-red'}`}>{data.pick}</span>
              </span>
              <span className="mm-muted">
                {data.viaHandi ? '국핸디' : '국배'}{' '}
                {data.viaHandi
                  ? `${f2(data.q.KHW)} / ${f2(data.q.KHD)} / ${f2(data.q.KHL)}`
                  : `${f2(data.q.KW)} / ${f2(data.q.KD)} / ${f2(data.q.KL)}`}
                {' '}· ±{data.tick}칸에서 찾음 ·{' '}
                <strong>{data.n}건</strong>{data.weak && <span className="mm-weak"> 표본적음(30건 미만)</span>}
              </span>
              <span className="mm-muted">
                핸승 {data.pct[0]}% · 핸무 {data.pct[1]}% · 무 {data.pct[2]}% · 역 {data.pct[3]}%
              </span>
            </div>

            <div className="mm-wrap mm-sample-wrap">
              {/* 컬럼 순서·구성(2026-09-28 사용자 지정 — "시즌회차 일시 경기 점수 결과
                  국배승/무/패 이렇게 표현해줘 지금 점수가 없어") — 점수는 이긴 팀 쪽만
                  빨강(기타경기 목록의 스코어 칸과 같은 mm-win 스타일, "이긴팀 점수 빨강색"). */}
              <table className="mm-t">
                <thead>
                  <tr>
                    <th>시즌/회차</th><th>일시</th><th>경기</th><th>점수</th><th>결과</th>
                    <th>국배 승/무/패</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="mm-muted">{row.S} {row.R}</td>
                      <td className="mm-muted">{row.DT}</td>
                      <td className="mm-l"><b>{row.HT}</b> <span className="mm-muted">vs</span> <b>{row.AT}</b></td>
                      <td>
                        <span className={row.HS > row.AS ? 'mm-win' : undefined}>{Math.trunc(row.HS)}</span>
                        {' : '}
                        <span className={row.AS > row.HS ? 'mm-win' : undefined}>{Math.trunc(row.AS)}</span>
                      </td>
                      <td><RtBadge label={RT_TEXT[row.RT]} /></td>
                      <td>{f2(row.K[0])} / {f2(row.K[1])} / {f2(row.K[2])}</td>
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
