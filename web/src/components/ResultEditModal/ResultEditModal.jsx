import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import './ResultEditModal.css'

const ALL = 'ALL'
const RT_OPTIONS = ['', '핸승', '핸무', '무', '역', '취소', '연기']
const HANDICAP_OPTIONS = ['', '-1', '+1']
// 국내(K)/해외(F) 배당 그룹 — 메인 분석표(경기정보 옆 국내배당/해외배당)와 같은 순서·코드.
const ODDS_GROUPS = [
  { prefix: 'K', title: '국내배당' },
  { prefix: 'F', title: '해외배당' },
]

function scoreInit(v) {
  return v === null || v === undefined || v === '' ? '' : String(Math.trunc(Number(v)))
}

// 배당은 항상 소수 둘째 자리로 맞춰 보여준다(3 → 3.00). 입력 중엔 사용자가 친 그대로 둔다.
function oddsInit(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return Number.isNaN(n) ? '' : n.toFixed(2)
}

function handicapInit(v) {
  return v === null || v === undefined || v === '' ? '' : String(v > 0 ? '+1' : '-1')
}

function numOrNull(s) {
  return s === '' || s === null || s === undefined ? null : parseFloat(s)
}

// DT는 'YY-MM-DD (요일)' 문자열로 저장돼 있다 — <input type="date">는 'YYYY-MM-DD'가 필요해서
// 서로 변환한다. 연도는 2000년대로 가정(이 앱이 다루는 시즌 범위 안에서는 항상 맞다).
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dtToInputDate(v) {
  const m = /^(\d{2})-(\d{2})-(\d{2})/.exec(String(v ?? ''))
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : ''
}

function inputDateToDt(v) {
  if (!v) return null
  const [y, mo, d] = v.split('-')
  const day = WEEKDAY_ABBR[new Date(`${v}T00:00:00`).getDay()]
  return `${y.slice(2)}-${mo}-${d} (${day})`
}

// TM은 'HHMM' 숫자(예: 1930)로 저장돼 있다 — <input type="time">은 'HH:MM'이 필요하다.
function tmToInputTime(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  const s = String(Math.trunc(n)).padStart(4, '0')
  return `${s.slice(0, 2)}:${s.slice(2)}`
}

function inputTimeToTm(v) {
  if (!v) return null
  const [h, m] = v.split(':')
  return Number(h) * 100 + Number(m)
}

// 승(W)/패(L) 배당 기준 핸디 부호 — 배당이 낮은(유리한) 쪽이 핸디를 준다.
// 홈이 유리하면 -1, 원정이 유리하면 +1, 배당이 같으면(동배) -1.
function computeHandicap(wRaw, lRaw) {
  const w = parseFloat(wRaw)
  const l = parseFloat(lRaw)
  if (Number.isNaN(w) || Number.isNaN(l)) return null
  return w > l ? '+1' : '-1'
}

// 점수가 둘 다 있고 서로 다를 때만 이긴 쪽을 강조한다(무승부·예정 경기는 강조 없음).
// 지금 입력 중인 값(문자열) 기준으로 판단 — 저장 전에도 바로 반영되게.
function scoreClass(hs, as_, side) {
  if (hs === '' || as_ === '') return undefined
  const h = Number(hs)
  const a = Number(as_)
  if (Number.isNaN(h) || Number.isNaN(a) || h === a) return undefined
  return (h > a ? 'home' : 'away') === side ? 'winner-score' : undefined
}

function OddsCell({ value, onChange }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      className="odds-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="-"
    />
  )
}

function HandicapCell({ value, onChange }) {
  return (
    <select className="handicap-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {HANDICAP_OPTIONS.map((o) => (
        <option key={o || 'blank'} value={o}>
          {o || '미정'}
        </option>
      ))}
    </select>
  )
}

// 국내/해외 한 그룹(승·무·패·핸디·H승·H무·H패 7칸)을 그린다. prefix='K'|'F'.
function OddsGroupCells({ prefix, r, i, updateRow, dividerAfter }) {
  const w = `${prefix}W`
  const d = `${prefix}D`
  const l = `${prefix}L`
  const h = `${prefix}H`
  const hw = `${prefix}HW`
  const hd = `${prefix}HD`
  const hl = `${prefix}HL`
  return (
    <>
      <td>
        <OddsCell value={r[`_${w}`]} onChange={(v) => updateRow(i, `_${w}`, v)} />
      </td>
      <td>
        <OddsCell value={r[`_${d}`]} onChange={(v) => updateRow(i, `_${d}`, v)} />
      </td>
      <td>
        <OddsCell value={r[`_${l}`]} onChange={(v) => updateRow(i, `_${l}`, v)} />
      </td>
      <td>
        <HandicapCell value={r[`_${h}`]} onChange={(v) => updateRow(i, `_${h}`, v)} />
      </td>
      <td>
        <OddsCell value={r[`_${hw}`]} onChange={(v) => updateRow(i, `_${hw}`, v)} />
      </td>
      <td>
        <OddsCell value={r[`_${hd}`]} onChange={(v) => updateRow(i, `_${hd}`, v)} />
      </td>
      <td className={dividerAfter ? 'group-divider' : undefined}>
        <OddsCell value={r[`_${hl}`]} onChange={(v) => updateRow(i, `_${hl}`, v)} />
      </td>
    </>
  )
}

// 경기결과(RT)·스코어(HS/AS)·국내/해외 배당·국내/해외 핸디배당을 화면에서 직접 입력한다.
// 이미 값이 있으면 그 값을 그대로 채워서 보여주고, 저장하면 이 칸들만 갱신된다 —
// 26개 지표·플핸예측 등 분석 컬럼은 전혀 건드리지 않는다.
export default function ResultEditModal({ code, scope, label, onClose, onSaved }) {
  const [filters, setFilters] = useState(null)
  const [season, setSeason] = useState(ALL)
  const [round, setRound] = useState(ALL)
  const [onlyBlank, setOnlyBlank] = useState(true)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .get(`/api/leagues/${code}/filters?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setFilters(res)
        setSeason(res.latest?.season ?? ALL)
        setRound(res.latest?.round ?? ALL)
      })
      .catch(() => {
        if (!cancelled) setFilters({ seasons: [], rounds_by_season: {} })
      })
    return () => {
      cancelled = true
    }
  }, [code, scope])

  function loadRows({ keepNotice = false } = {}) {
    setLoading(true)
    setError('')
    if (!keepNotice) setNotice('')
    const params = new URLSearchParams({
      scope,
      season: season === ALL ? 'ALL' : season,
      round: round === ALL ? 'ALL' : round,
      only_blank: onlyBlank ? 'true' : 'false',
    })
    api
      .get(`/api/leagues/${code}/edit_rows?${params.toString()}`)
      .then((res) => {
        setRows(
          (res.rows || []).map((r) => ({
            ...r,
            _RT: r.RT_label || '',
            _DT: dtToInputDate(r.DT),
            _TM: tmToInputTime(r.TM),
            _HS: scoreInit(r.HS),
            _AS: scoreInit(r.AS),
            _KW: oddsInit(r.KW),
            _KD: oddsInit(r.KD),
            _KL: oddsInit(r.KL),
            _KH: handicapInit(r.KH) || computeHandicap(r.KW, r.KL) || '',
            _KHW: oddsInit(r.KHW),
            _KHD: oddsInit(r.KHD),
            _KHL: oddsInit(r.KHL),
            _FW: oddsInit(r.FW),
            _FD: oddsInit(r.FD),
            _FL: oddsInit(r.FL),
            _FH: handicapInit(r.FH) || computeHandicap(r.FW, r.FL) || '',
            _FHW: oddsInit(r.FHW),
            _FHD: oddsInit(r.FHD),
            _FHL: oddsInit(r.FHL),
          }))
        )
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (filters) loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, season, round, onlyBlank])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const seasonOptions = [ALL, ...(filters?.seasons ?? [])]
  const roundOptions =
    season === ALL
      ? [ALL, ...new Set(Object.values(filters?.rounds_by_season ?? {}).flat())]
      : [ALL, ...(filters?.rounds_by_season?.[season] ?? [])]

  // 승/패 배당(KW·KL 또는 FW·FL) 칸을 고치면 그 자리에서 핸디 부호도 같이 다시 계산한다.
  function updateRow(i, field, value) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r
        const next = { ...r, [field]: value }
        if (field === '_KW' || field === '_KL') {
          const h = computeHandicap(next._KW, next._KL)
          if (h) next._KH = h
        } else if (field === '_FW' || field === '_FL') {
          const h = computeHandicap(next._FW, next._FL)
          if (h) next._FH = h
        }
        return next
      })
    )
  }

  async function handleSave() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const oddsKeys = ['KW', 'KD', 'KL', 'KH', 'KHW', 'KHD', 'KHL', 'FW', 'FD', 'FL', 'FH', 'FHW', 'FHD', 'FHL']
      const payload = rows.map((r) => {
        const item = {
          S: r.S,
          R: r.R,
          No: r.No,
          HT: r.HT,
          AT: r.AT,
          RT: r._RT || null,
          DT: inputDateToDt(r._DT),
          TM: inputTimeToTm(r._TM),
          HS: numOrNull(r._HS),
          AS: numOrNull(r._AS),
        }
        for (const k of oddsKeys) item[k] = numOrNull(r[`_${k}`])
        return item
      })
      const res = await api.post(`/api/leagues/${code}/edit_rows`, { scope, rows: payload })
      setNotice(`저장 완료: ${res.updated}건`)
      onSaved?.()
      loadRows({ keepNotice: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card edit-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">📝 결과·핸디 입력</h2>
        <p className="modal-meta">
          {label || code} · 경기결과(RT)·스코어·국내/해외 배당·국내/해외 핸디배당을 입력·수정합니다.
          이미 있는 값은 그대로 보여줍니다. 26개 지표·플핸예측은 바뀌지 않습니다.
        </p>

        <div className="edit-filter-row">
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasonOptions.map((s) => (
              <option key={s} value={s}>
                {s === ALL ? '시즌 전체' : s}
              </option>
            ))}
          </select>
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            {roundOptions.map((r) => (
              <option key={r} value={r}>
                {r === ALL ? '라운드 전체' : r}
              </option>
            ))}
          </select>
          <label className="edit-blank-toggle">
            <input
              type="checkbox"
              checked={onlyBlank}
              onChange={(e) => setOnlyBlank(e.target.checked)}
            />
            비어 있는 경기만 보기
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="recompute-notice">{notice}</p>}

        {loading ? (
          <p className="loading-text">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="edit-empty">해당 조건에 맞는 경기가 없습니다.</p>
        ) : (
          <>
            <div className="edit-table-scroll">
              <table className="detail-table edit-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>R</th>
                    <th rowSpan={2}>No</th>
                    <th rowSpan={2}>날짜</th>
                    <th rowSpan={2}>시간</th>
                    <th rowSpan={2}>홈</th>
                    <th rowSpan={2}>스코어</th>
                    <th rowSpan={2}>원정</th>
                    <th rowSpan={2}>RT</th>
                    {ODDS_GROUPS.map((g) => (
                      <th key={g.prefix} colSpan={7} className="group-title">
                        {g.title}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {ODDS_GROUPS.flatMap((g) =>
                      [`${g.prefix}W`, `${g.prefix}D`, `${g.prefix}L`, `${g.prefix}H`,
                       `${g.prefix}HW`, `${g.prefix}HD`, `${g.prefix}HL`].map((code) => (
                        <th key={code}>{code}</th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* S/R/No만으로는 식별이 안 될 수 있다 — 시즌 막판 상/하위 스플릿처럼
                      같은 라운드 안에서 그룹별로 No가 1부터 따로 매겨지는 리그가 있어
                      서로 다른 두 경기가 같은 No를 쓸 수 있다. HT/AT까지 더해 고유하게 만든다. */}
                  {rows.map((r, i) => (
                    <tr key={`${r.S}-${r.R}-${r.No}-${r.HT}-${r.AT}`}>
                      <td>{r.R}</td>
                      <td>{r.No}</td>
                      <td>
                        <input
                          type="date"
                          className="dt-input"
                          value={r._DT}
                          onChange={(e) => updateRow(i, '_DT', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          className="tm-input"
                          value={r._TM}
                          onChange={(e) => updateRow(i, '_TM', e.target.value)}
                        />
                      </td>
                      <td>{r.HT}</td>
                      <td className="score-cell">
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`score-input ${scoreClass(r._HS, r._AS, 'home') || ''}`}
                          value={r._HS}
                          onChange={(e) => updateRow(i, '_HS', e.target.value)}
                          placeholder="-"
                        />
                        <span className="score-sep">:</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`score-input ${scoreClass(r._HS, r._AS, 'away') || ''}`}
                          value={r._AS}
                          onChange={(e) => updateRow(i, '_AS', e.target.value)}
                          placeholder="-"
                        />
                      </td>
                      <td>{r.AT}</td>
                      <td>
                        <select value={r._RT} onChange={(e) => updateRow(i, '_RT', e.target.value)}>
                          {RT_OPTIONS.map((o) => (
                            <option key={o || 'blank'} value={o}>
                              {o || '미정'}
                            </option>
                          ))}
                        </select>
                      </td>
                      <OddsGroupCells prefix="K" r={r} i={i} updateRow={updateRow} dividerAfter />
                      <OddsGroupCells prefix="F" r={r} i={i} updateRow={updateRow} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="edit-actions">
              <span className="edit-count">{rows.length}경기</span>
              <button className="btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? '저장 중...' : '💾 저장'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
