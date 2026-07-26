import { useEffect, useRef, useState } from 'react'
import { api, saveBlob } from '../api/client'
import { useAuth } from '../context/AuthContext'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import FilterForm from '../components/FilterForm/FilterForm'
import HeadToHeadResult from '../components/HeadToHead/HeadToHeadResult'
import RtSummaryBar from '../components/RtSummaryBar/RtSummaryBar'

const ODDS_KEYS = ['kw', 'kd', 'kl', 'khw', 'khd', 'khl', 'fw', 'fd', 'fl']

function buildQueryString(scope, query) {
  const params = new URLSearchParams({ scope })
  if (query) {
    if (query.season) params.set('season', query.season)
    if (query.round) params.set('round', query.round)
    for (const key of ODDS_KEYS) {
      if (query[key] !== undefined && query[key] !== null) {
        params.set(key, String(query[key]))
      }
    }
  }
  return params.toString()
}

function describeQuery(query) {
  if (!query) return ''
  const parts = []
  if (query.season && query.season !== 'ALL') parts.push(`S=${query.season}`)
  if (query.round && query.round !== 'ALL') parts.push(`R=${query.round}`)
  for (const key of ODDS_KEYS) {
    if (query[key] !== undefined && query[key] !== null) {
      parts.push(`${key.toUpperCase()}=${query[key]}`)
    }
  }
  return parts.join(' · ') || '전체'
}

export default function LeaguePage({ code, scope }) {
  const { user } = useAuth()
  const [filters, setFilters] = useState(null)
  const [query, setQuery] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
  const [h2h, setH2h] = useState(null) // {home, away, cross} | null — 있으면 표 대신 상대전적 표시
  const [reloadKey, setReloadKey] = useState(0)

  const [delConfirm, setDelConfirm] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)
  const [deleteNotice, setDeleteNotice] = useState('')

  // 엑셀 다운로드 / 업로드
  const fileInputRef = useRef(null)
  const [pendingFile, setPendingFile] = useState(null)   // 업로드 대기 파일(확인 전)
  const [preview, setPreview] = useState(null)           // 저장 전 미리보기 결과
  const [busyExcel, setBusyExcel] = useState('')         // '' | 'template' | 'table' | 'upload' | 'save'
  const [excelNotice, setExcelNotice] = useState('')

  // 리그/스코프가 바뀌면 시즌·라운드 선택지부터 다시 불러온다
  useEffect(() => {
    let cancelled = false
    setFilters(null)
    setQuery(null)
    setH2h(null)
    api
      .get(`/api/leagues/${code}/filters?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setFilters(res)
        setQuery({ season: res.latest?.season ?? 'ALL', round: res.latest?.round ?? 'ALL' })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, reloadKey])

  async function handleDeleteLeagueData() {
    if (!delConfirm) {
      setDeleteNotice('동의 체크박스를 선택하세요.')
      return
    }
    setBusyDelete(true)
    setDeleteNotice('')
    try {
      await api.post('/api/admin/master/delete_league', { league: code, confirm: true })
      setDeleteNotice(`'${code}' 데이터를 모두 삭제했습니다.`)
      setDelConfirm(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setDeleteNotice(`실패: ${err.message}`)
    } finally {
      setBusyDelete(false)
    }
  }

  async function runDownload(kind, path) {
    setBusyExcel(kind)
    setExcelNotice('')
    try {
      const { blob, filename } = await api.download(path)
      saveBlob(blob, filename)
    } catch (err) {
      setExcelNotice(`실패: ${err.message}`)
    } finally {
      setBusyExcel('')
    }
  }

  // ① 업로드용 빈 표본 양식 받기
  function handleTemplateDownload() {
    runDownload('template', `/api/leagues/${code}/upload_template?scope=${scope}`)
  }

  // ③ 지금 화면에 조회된 분석표 그대로 받기 (표시 상한 없이 조건에 맞는 전부)
  function handleTableDownload() {
    runDownload('table', `/api/leagues/${code}/table_excel?${buildQueryString(scope, query)}`)
  }

  // ② 파일을 고르면 먼저 저장하지 않고 미리보기(건수·중복)만 받아 확인을 받는다
  async function handleFilePicked(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change 이벤트가 뜨도록 초기화
    if (!file) return
    setBusyExcel('upload')
    setExcelNotice('')
    setPreview(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('scope', scope)
      form.append('confirm', 'false')
      const res = await api.upload(`/api/leagues/${code}/upload`, form)
      setPendingFile(file)
      setPreview(res)
    } catch (err) {
      setExcelNotice(`업로드 실패: ${err.message}`)
    } finally {
      setBusyExcel('')
    }
  }

  async function handleUploadConfirm() {
    if (!pendingFile) return
    setBusyExcel('save')
    setExcelNotice('')
    try {
      const form = new FormData()
      form.append('file', pendingFile)
      form.append('scope', scope)
      form.append('confirm', 'true')
      const res = await api.upload(`/api/leagues/${code}/upload`, form)
      setExcelNotice(
        `저장 완료: 총 ${res.rows.toLocaleString()}건` +
          (res.duplicates_removed ? ` (중복 ${res.duplicates_removed.toLocaleString()}건 대체)` : '')
      )
      setPreview(null)
      setPendingFile(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setExcelNotice(`저장 실패: ${err.message}`)
    } finally {
      setBusyExcel('')
    }
  }

  function cancelUpload() {
    setPreview(null)
    setPendingFile(null)
    setExcelNotice('')
  }

  // 스코프/리그/현재 조회 시즌이 바뀌면 상대전적 조회용 팀 목록도 그 시즌 기준으로 다시 불러온다
  useEffect(() => {
    const season = query?.season ?? 'ALL'
    api
      .get(`/api/teams?scope=${scope}&code=${code}&season=${season}`)
      .then((res) => setTeams(res.teams))
      .catch(() => setTeams([]))
  }, [scope, code, query?.season])

  // 조회 조건(query)이 확정되면 실제 표 데이터를 불러온다 (조건 입력 중엔 재조회 안 함)
  useEffect(() => {
    if (!query) return
    let cancelled = false
    setError('')
    api
      .get(`/api/leagues/${code}?${buildQueryString(scope, query)}`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, query])

  function handleSearch(nextQuery) {
    setH2h(null) // 조회 조건 필터는 상대전적 모드를 초기화하고 원래 표로 돌아간다
    setQuery(nextQuery)
  }

  if (error) return <p className="error-text">{error}</p>
  if (!filters || !data) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <div className="league-dashboard">
        <span>
          📋 등록된 시즌 {filters.seasons.length} · 경기수 {filters.total_rows.toLocaleString()}
        </span>
        <RtSummaryBar summary={filters.rt_summary} inline />
      </div>

      <FilterForm filters={filters} onSearch={handleSearch} teams={teams} onH2HSearch={setH2h} />

      {!h2h && (
        <div className="excel-bar">
          {data.can_write && (
            <>
              <button
                className="btn-reset"
                onClick={handleTemplateDownload}
                disabled={busyExcel === 'template'}
                title="경기 정보를 입력할 빈 표본 파일을 받습니다"
              >
                {busyExcel === 'template' ? '받는 중...' : '⬇ 경기 Data 업로드 엑셀 다운로드'}
              </button>
              <button
                className="btn-reset"
                onClick={() => fileInputRef.current?.click()}
                disabled={busyExcel === 'upload'}
                title="표본 파일에 입력한 경기를 DB에 등록합니다"
              >
                {busyExcel === 'upload' ? '읽는 중...' : '⬆ 경기 Data 업로드'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFilePicked}
                style={{ display: 'none' }}
              />
            </>
          )}
          <button
            className="btn-search"
            onClick={handleTableDownload}
            disabled={busyExcel === 'table'}
            title="지금 조회된 표를 그대로 받습니다"
          >
            {busyExcel === 'table' ? '받는 중...' : '⬇ 엑셀 다운로드'}
          </button>
        </div>
      )}

      {excelNotice && <p className="recompute-notice">{excelNotice}</p>}

      {preview && (
        <div className="upload-preview">
          <p className="upload-preview-title">📤 업로드 확인</p>
          <p className="upload-preview-line">
            읽어온 경기 <strong>{preview.new_rows.toLocaleString()}</strong>건 · 기존{' '}
            {preview.existing_rows.toLocaleString()}건 → 저장 후{' '}
            <strong>{preview.after_merge.toLocaleString()}</strong>건
            {preview.duplicates_removed > 0 &&
              ` (같은 경기 ${preview.duplicates_removed.toLocaleString()}건은 새 값으로 대체)`}
          </p>
          <p className="upload-preview-caption">
            저장하면 이 리그의 26개 지표와 예측이 다시 계산됩니다. 경기 수가 많으면 수 분 걸릴 수
            있습니다{scope === 'master' ? ' (저장 전 자동 백업)' : ''}.
          </p>
          <div className="upload-preview-actions">
            <button className="btn-reset" onClick={cancelUpload} disabled={busyExcel === 'save'}>
              취소
            </button>
            <button className="btn-primary" onClick={handleUploadConfirm} disabled={busyExcel === 'save'}>
              {busyExcel === 'save' ? '저장 중... (기다려 주세요)' : '💾 저장'}
            </button>
          </div>
        </div>
      )}

      {h2h ? (
        <>
          <div className="league-summary">
            <span>
              🆚 상대전적 조회: {h2h.home} vs {h2h.away}
              {h2h.cross ? ' (홈원 교차보기)' : ''}
            </span>
            <button className="btn-reset" onClick={() => setH2h(null)}>
              ✕ 표로 돌아가기
            </button>
          </div>
          <HeadToHeadResult scope={scope} home={h2h.home} away={h2h.away} cross={h2h.cross} limit={50} />
        </>
      ) : (
        <>
          <div className="league-summary">
            <span>🔍 조회 조건: {describeQuery(query)}</span>
            <span>
              <strong>{data.total.toLocaleString()}</strong>경기
            </span>
            <RtSummaryBar summary={data.rt_summary} inline />
          </div>
          <LeagueTable
            code={code}
            columns={data.columns}
            rows={data.rows}
            scope={scope}
            highlightCols={ODDS_KEYS.filter((k) => query?.[k] !== undefined).map((k) => k.toUpperCase())}
          />
        </>
      )}

      {user.role === 'admin' && scope === 'master' && (
        <div className="danger-zone">
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={delConfirm}
              onChange={(e) => setDelConfirm(e.target.checked)}
            />
            Data를 삭제하시면 현재 등록된 모든 Data가 삭제가 됩니다. 동의하십니까?
          </label>
          <button className="btn-danger" disabled={busyDelete} onClick={handleDeleteLeagueData}>
            {busyDelete ? '삭제 중...' : '경기 Data 모두삭제'}
          </button>
          {deleteNotice && <p className="recompute-notice">{deleteNotice}</p>}
        </div>
      )}
    </div>
  )
}
