import { useEffect, useState } from 'react'
import { api, saveBlob } from '../../api/client'
import HeadToHeadResult from '../HeadToHead/HeadToHeadResult'
import './MatchDetailModal.css'

const RT_COLOR = { 핸승: '#1565C0', 핸무: '#64B5F6', 무: '#757575', 역: '#C62828' }

function rtLabel(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  return { 1: '핸승', 2: '핸무', 3: '무', 4: '역' }[Math.trunc(n)] || ''
}

function RtBadge({ label }) {
  if (!label) return null
  const bg = RT_COLOR[label] || '#9E9E9E'
  const fg = label === '핸무' ? '#0D1B2A' : '#fff'
  return (
    <span className="rt-badge" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

function numOrDash(v, digits = 2) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  return Number.isNaN(n) ? '-' : n.toFixed(digits)
}

const SAMPLE_INDICATORS = [
  ['K-W', '국) 승'], ['K-L', '국) 패'], ['K-WL', '국) 승+패'], ['K-WDL', '국) 승+무+패'],
  ['K-W-HT', '국) 승=홈팀'], ['K-L-AT', '국) 패=원정팀'],
  ['TK-W', '국/통) 승'], ['TK-L', '국/통) 패'], ['TK-WL', '국/통) 승+패'], ['TK-WDL', '국/통) 승+무+패'],
  ['F-W', '해) 승'], ['F-L', '해) 패'], ['F-WL', '해) 승+패'], ['F-WDL', '해) 승+무+패'],
  ['F-W-HT', '해) 승=홈팀'], ['F-L-AT', '해) 패=원정팀'],
  ['TF-W', '해/통) 승'], ['TF-L', '해/통) 패'], ['TF-WL', '해/통) 승+패'], ['TF-WDL', '해/통) 승+무+패'],
]

function OddsTable({ row }) {
  const rows = [
    ['국내 배당', 'KW', 'KD', 'KL'],
    ['국내 핸디', 'KHW', 'KHD', 'KHL'],
    ['해외 배당', 'FW', 'FD', 'FL'],
    ['해외 핸디', 'FHW', 'FHD', 'FHL'],
  ]
  return (
    <table className="detail-table">
      <thead>
        <tr>
          <th>구분</th>
          <th>승(홈)</th>
          <th>무</th>
          <th>패(원정)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, w, d, l]) => (
          <tr key={label}>
            <td className="row-label">{label}</td>
            <td>{numOrDash(row[w])}</td>
            <td>{numOrDash(row[d])}</td>
            <td>{numOrDash(row[l])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PhPredictionCard({ row }) {
  const pick = row.PH_PICK
  const pickStyle = (() => {
    const s = String(pick || '').trim()
    if (s.startsWith('플핸')) {
      if (s.includes('(역)')) return { background: '#4A148C', color: '#fff' }
      if (s.includes('(무)')) return { background: '#6A1B9A', color: '#fff' }
      if (s.includes('(핸무)')) return { background: '#E65100', color: '#fff' }
      return { background: '#7B1FA2', color: '#fff' }
    }
    if (s === '핸승') return { background: '#1565C0', color: '#fff' }
    return {}
  })()

  return (
    <table className="detail-table">
      <thead>
        <tr>
          <th>해)플핸</th>
          <th>국)플핸</th>
          <th>PICK</th>
          <th>실측</th>
          <th>비중</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{row.PH_F != null ? `${Number(row.PH_F).toFixed(0)}%` : '-'}</td>
          <td>{row.PH_K != null ? `${Number(row.PH_K).toFixed(0)}%` : '-'}</td>
          <td style={pickStyle}>{pick || '-'}</td>
          <td>{row.PH_HIT != null ? `${Number(row.PH_HIT).toFixed(0)}%` : '-'}</td>
          <td>{row.PH_DOM != null ? `${Number(row.PH_DOM).toFixed(0)}%` : '-'}</td>
        </tr>
      </tbody>
    </table>
  )
}

// 한 행의 4칸(핸승/핸무/무/역) 중 최댓값 칸에 표시할 클래스. 전부 0이면 강조 안 함.
function maxCellClass(vals, i) {
  const max = Math.max(...vals)
  return max > 0 && vals[i] === max ? 'cell-max' : ''
}

function SampleTable({ row }) {
  const lines = SAMPLE_INDICATORS.map(([code, label]) => {
    const vals = [1, 2, 3, 4].map((i) => {
      const v = row[`${code} ${i}`]
      const n = Number(v)
      return Number.isNaN(n) ? 0 : Math.trunc(n)
    })
    const total = vals.reduce((a, b) => a + b, 0)
    return { code, label, vals, total }
  })

  const grandVals = [0, 1, 2, 3].map((i) => lines.reduce((sum, l) => sum + l.vals[i], 0))
  const grandTotal = grandVals.reduce((a, b) => a + b, 0)

  return (
    <table className="detail-table sample-table">
      <thead>
        <tr>
          <th>지표</th>
          <th className="col-hs">핸승</th>
          <th className="col-hm">핸무</th>
          <th className="col-mu">무</th>
          <th className="col-yk">역</th>
          <th>토탈</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, li) => {
          const isForeign = /^(F|TF)-/.test(l.code)
          const groupStart = li > 0 && isForeign && !/^(F|TF)-/.test(lines[li - 1].code)
          return (
            <tr key={l.code} className={groupStart ? 'sample-group-start' : undefined}>
              <td className="row-label">{l.label}</td>
              {l.vals.map((v, i) => (
                <td key={i} className={maxCellClass(l.vals, i)}>
                  {v}
                </td>
              ))}
              <td className="col-total">{l.total}</td>
            </tr>
          )
        })}
        <tr className="sample-grand-total">
          <td className="row-label">토탈</td>
          {grandVals.map((v, i) => (
            <td key={i} className={maxCellClass(grandVals, i)}>
              {v}
            </td>
          ))}
          <td className="col-total">{grandTotal}</td>
        </tr>
      </tbody>
    </table>
  )
}

export default function MatchDetailModal({ code, row, scope, onClose }) {
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const rt = rtLabel(row.RT)
  const hasScore = row.HS !== null && row.HS !== undefined && row.AS !== null && row.AS !== undefined
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleDownload() {
    setDownloading(true)
    setDownloadError('')
    try {
      const params = new URLSearchParams({
        scope,
        season: String(row.S ?? ''),
        round: String(row.R ?? ''),
        no: String(row.No ?? ''),
      })
      const { blob, filename } = await api.download(
        `/api/leagues/${code}/match_excel?${params.toString()}`
      )
      saveBlob(blob, filename)
    } catch (err) {
      setDownloadError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <h2 className="modal-title">
          {ht} vs {at}
        </h2>
        <p className="modal-meta">
          {row.S} · {row.R}
          {row.DT ? ` · ${row.DT}` : ''}
          &nbsp;&nbsp;
          {rt ? <RtBadge label={rt} /> : <span className="modal-scheduled">예정 경기</span>}
        </p>
        {hasScore && (
          <p className="modal-score">
            {ht} <strong>{Math.trunc(row.HS)} : {Math.trunc(row.AS)}</strong> {at}
          </p>
        )}

        <div className="modal-columns">
          <div className="modal-col">
            <h3>💰 배당</h3>
            <OddsTable row={row} />
            <h3>🎯 플핸 예측</h3>
            <PhPredictionCard row={row} />
            <h3>📊 지표별 표본</h3>
            <SampleTable row={row} />
          </div>
          <div className="modal-col">
            <h3>🆚 상대전적</h3>
            <HeadToHeadResult scope={scope} home={ht} away={at} cross limit={15} />
          </div>
        </div>

        <div className="modal-footer">
          {downloadError && <p className="error-text">{downloadError}</p>}
          <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
            {downloading ? '다운로드 중...' : '⬇ 엑셀 다운로드'}
          </button>
        </div>
      </div>
    </div>
  )
}
