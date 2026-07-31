import { useEffect, useRef, useState } from 'react'
import { api, saveBlob } from '../api/client'
import { useAuth } from '../context/AuthContext'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import FilterForm from '../components/FilterForm/FilterForm'
import HeadToHeadResult from '../components/HeadToHead/HeadToHeadResult'
import RtSummaryBar, { PickSummaryBar } from '../components/RtSummaryBar/RtSummaryBar'
import UploadTemplateModal from '../components/UploadTemplateModal/UploadTemplateModal'
import DeleteMatchesModal from '../components/DeleteMatchesModal/DeleteMatchesModal'
import CrawlModal from '../components/CrawlModal/CrawlModal'
import ResultEditModal from '../components/ResultEditModal/ResultEditModal'

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

  // 엑셀 다운로드 / 업로드
  const fileInputRef = useRef(null)
  const [pendingFile, setPendingFile] = useState(null)   // 업로드 대기 파일(확인 전)
  const [preview, setPreview] = useState(null)           // 저장 전 미리보기 결과
  const [busyExcel, setBusyExcel] = useState('')         // '' | 'table' | 'upload' | 'save'
  const [excelNotice, setExcelNotice] = useState('')
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showCrawlModal, setShowCrawlModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [leagues, setLeagues] = useState([])

  // 업로드 표본 생성 / 삭제 선택 모달의 "리그 선택" 옵션용.
  // 스코프마다 리그가 다르므로(공식=6대리그 / 내 데이터=내가 만든 리그) 스코프별로 불러온다.
  useEffect(() => {
    api
      .get(`/api/leagues?scope=${scope}`)
      .then((res) => setLeagues(Array.isArray(res) ? res : res.leagues || []))
      .catch(() => setLeagues([]))
  }, [scope])

  // 리그/스코프가 바뀌면 시즌·라운드 선택지부터 다시 불러온다.
  // reloadKey만 바뀐 경우(저장/삭제 후 새로고침)는 진짜로 리그를 바꾼 게 아니므로
  // filters/query/h2h를 비우지 않는다 — 그걸 비우면 아래 렌더의 "불러오는 중..." 가드에
  // 걸려 화면 전체(열려 있는 입력 모달 포함)가 통째로 언마운트됐다가 다시 마운트되면서
  // 모달 안의 상태(저장 완료 안내, 진행 중이던 입력 등)가 날아가 버린다.
  const prevLeagueKeyRef = useRef(`${code}:${scope}`)
  useEffect(() => {
    let cancelled = false
    const leagueKey = `${code}:${scope}`
    const isNewLeague = prevLeagueKeyRef.current !== leagueKey
    prevLeagueKeyRef.current = leagueKey
    if (isNewLeague) {
      setFilters(null)
      setQuery(null)
      setH2h(null)
    }
    api
      .get(`/api/leagues/${code}/filters?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setFilters(res)
        setQuery((prev) =>
          isNewLeague || !prev
            ? { season: res.latest?.season ?? 'ALL', round: res.latest?.round ?? 'ALL' }
            : prev
        )
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, reloadKey])

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
        <PickSummaryBar summary={filters.hit_summary} />
      </div>

      <FilterForm filters={filters} onSearch={handleSearch} teams={teams} onH2HSearch={setH2h} />

      {!h2h && (
        <div className="excel-bar">
          {data.can_write && (
            <>
              <button
                className="btn-reset"
                onClick={() => setShowCrawlModal(true)}
                title="스코어맨 화면에서 경기·배당을 그대로 가져옵니다"
              >
                🛰 Data 가져오기
              </button>
              <button
                className="btn-reset"
                onClick={() => setShowEditModal(true)}
                title="경기결과(RT)·국내핸디(KH)·해외핸디(FH)를 직접 입력합니다"
              >
                📝 결과·핸디 입력
              </button>
              <button
                className="btn-reset"
                onClick={() => setShowTemplateModal(true)}
                title="리그·시즌·라운드를 입력해 업로드용 표본 엑셀을 만듭니다"
              >
                ⬇ 경기 Data 업로드 엑셀 만들기
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

      {showTemplateModal && (
        <UploadTemplateModal
          leagues={leagues.length ? leagues : [{ code, label: code }]}
          defaultCode={code}
          scope={scope}
          onClose={() => setShowTemplateModal(false)}
        />
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
            새로 추가되는 경기만 26개 지표와 예측이 계산됩니다. 이미 있던 경기의 예측은 그대로
            유지되고, 스코어 등 원본 값만 이번 업로드로 갱신됩니다
            {scope === 'master' ? ' (저장 전 자동 백업)' : ''}.
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
          <HeadToHeadResult
            scope={scope}
            code={code}
            home={h2h.home}
            away={h2h.away}
            cross={h2h.cross}
            limit={50}
          />
        </>
      ) : (
        <>
          <div className="league-summary">
            <span>🔍 조회 조건: {describeQuery(query)}</span>
            <span>
              <strong>{data.total.toLocaleString()}</strong>경기
            </span>
            <RtSummaryBar summary={data.rt_summary} inline />
            <PickSummaryBar summary={data.hit_summary} />
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
        <div className="delete-select-bar">
          <button className="btn-reset" onClick={() => setShowDeleteModal(true)}>
            🗑 경기 Data 삭제 선택
          </button>
          <span className="delete-select-caption">
            '경기 Data 삭제 선택'을 클릭하시면 삭제할 리그 및 경기를 선택한 후 삭제를 하시면 됩니다.
          </span>
        </div>
      )}

      {showEditModal && (
        <ResultEditModal
          code={code}
          scope={scope}
          label={leagues.find((l) => l.code === code)?.label}
          onClose={() => setShowEditModal(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}

      {showCrawlModal && (
        <CrawlModal
          code={code}
          scope={scope}
          label={leagues.find((l) => l.code === code)?.label}
          onClose={() => setShowCrawlModal(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}

      {showDeleteModal && (
        <DeleteMatchesModal
          leagues={leagues.length ? leagues : [{ code, label: code }]}
          defaultCode={code}
          scope={scope}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
