import { useEffect, useMemo, useRef, useState } from 'react'
import { api, saveBlob } from '../api/client'
import LeagueTable, { RiskLegendModal } from '../components/LeagueTable/LeagueTable'
import { buildColumnGroups, groupKey, splitIndicatorBatches } from '../components/LeagueTable/columnGroups'
import FilterForm from '../components/FilterForm/FilterForm'
import RtSummaryBar, { PickSummaryBar } from '../components/RtSummaryBar/RtSummaryBar'
import UploadTemplateModal from '../components/UploadTemplateModal/UploadTemplateModal'
import DeleteMatchesModal from '../components/DeleteMatchesModal/DeleteMatchesModal'
import CrawlModal from '../components/CrawlModal/CrawlModal'
import KrCrawlModal from '../components/KrCrawlModal/KrCrawlModal'
import ResultEditModal from '../components/ResultEditModal/ResultEditModal'
import SeasonStats from '../components/SeasonStats/SeasonStats'
import { buildQueryString, ODDS_KEYS } from '../utils/query'
import { getRoundFinalOddsTime, setRoundFinalOddsTime, formatFinalOddsTime } from '../utils/finalOddsTime'

function describeQuery(query) {
  if (!query) return ''
  const parts = []
  if (query.season && query.season !== 'ALL') parts.push(`S=${query.season}`)
  if (query.round && query.round !== 'ALL') parts.push(`R=${query.round}`)
  if (query.team) {
    const sideLabel = query.team_side === 'home' ? '홈' : query.team_side === 'away' ? '원정' : ''
    const favLabel = query.team_fav === 'fav' ? '정배' : query.team_fav === 'dog' ? '역배' : ''
    const tags = [sideLabel, favLabel].filter(Boolean).join('·')
    parts.push(`팀=${query.team}${tags ? `(${tags})` : ''}`)
  }
  for (const key of ODDS_KEYS) {
    if (query[key] !== undefined && query[key] !== null) {
      parts.push(`${key.toUpperCase()}=${query[key]}`)
    }
  }
  return parts.join(' · ') || '전체'
}

export default function LeaguePage({ code, scope }) {
  const [filters, setFilters] = useState(null)
  const [query, setQuery] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
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
  const [showKrCrawlModal, setShowKrCrawlModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [leagues, setLeagues] = useState([])

  // 표의 "해외지표 접기/국내지표 접기/플핸무 확률 참고" — 조회 조건 줄에서 같이
  // 보여주려고 표(LeagueTable) 대신 여기서 상태를 들고 있다가 props로 내려준다.
  // 일반정보(시즌/라운드 등 조회 조건에 이미 나와 있는 정보)는 기본으로 접어둔다.
  // '지표'는 칸이 하나뿐이라 접어도 값(강/약)이 그대로 보인다 — 기본 접힘으로 둔다.
  const [collapsed, setCollapsed] = useState(() => new Set(['일반정보', '경기정보', '지표']))
  const [showRiskLegend, setShowRiskLegend] = useState(false)
  const groups = useMemo(() => buildColumnGroups(data?.columns || []), [data?.columns])
  const { batch1Groups, batch2Groups } = splitIndicatorBatches(groups)

  function toggleBatch(batchGroups) {
    const keys = batchGroups.map(groupKey)
    const allCollapsed = keys.length > 0 && keys.every((k) => collapsed.has(k))
    setCollapsed((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => (allCollapsed ? next.delete(k) : next.add(k)))
      return next
    })
  }

  // 최신배당(배변) 불러오기 — 지금 조회된 시즌·라운드 경기들의 최종배당(EK*/EF*)만
  // 다시 받는다. 초기배당·26개 지표는 절대 안 건드린다(api/main.py refresh_final_odds).
  const [busyRefreshOdds, setBusyRefreshOdds] = useState(false)
  const [refreshOddsNotice, setRefreshOddsNotice] = useState('')
  // 이 리그·시즌·라운드에서 '최신배당 불러오기'를 마지막으로 실제 실행한 시각
  // (브라우저 저장 — utils/finalOddsTime.js). 조회 조건(시즌·라운드)이 바뀌면
  // 그 조합의 값을 다시 읽는다. 시즌·라운드가 'ALL'이면 특정 라운드 하나를 가리키는
  // 값이 없어 표시하지 않는다.
  const [finalOddsTs, setFinalOddsTs] = useState(null)
  useEffect(() => {
    if (!query || query.season === 'ALL' || query.round === 'ALL') {
      setFinalOddsTs(null)
      return
    }
    setFinalOddsTs(getRoundFinalOddsTime(scope, code, query.season, query.round))
  }, [scope, code, query])

  // 재계산('내 데이터' 리그 1개 전용 — RT 없는 예정 경기만, 이 리그 하나만 대상)
  const [busyRecomputePending, setBusyRecomputePending] = useState(false)
  const [recomputeNotice, setRecomputeNotice] = useState('')
  // 통합 재분석(과거 경기 포함 전체) — 같은 엔드포인트를 include_historical=true로 호출
  const [busyRecomputeAll, setBusyRecomputeAll] = useState(false)

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
  // filters/query를 비우지 않는다 — 그걸 비우면 아래 렌더의 "불러오는 중..." 가드에
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
    runDownload('table', `/api/leagues/${code}/table_excel?${buildQueryString({ scope }, query)}`)
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

  async function runRefreshFinalOdds() {
    if (!query || query.season === 'ALL' || query.round === 'ALL') {
      setRefreshOddsNotice('시즌·라운드를 하나씩 골라야 합니다(전체 불가).')
      return
    }
    setBusyRefreshOdds(true)
    setRefreshOddsNotice('')
    try {
      const res = await api.post(`/api/leagues/${code}/refresh_final_odds`, {
        scope, season: query.season, round: query.round,
      })
      const parts = [`국내 ${res.domestic_updated}건 · 해외 ${res.overseas_updated}건 갱신`]
      if (res.domestic_error) parts.push(`국내 실패: ${res.domestic_error}`)
      if (res.overseas_error) parts.push(`해외 실패: ${res.overseas_error}`)
      setRefreshOddsNotice(parts.join(' · '))
      // API가 에러 없이 응답했으면(갱신 건수가 0이어도) "지금 확인했다"는 사실이라
      // 시각을 찍는다 — 실패(catch)했을 때만 안 찍는다.
      const now = new Date().toISOString()
      setRoundFinalOddsTime(scope, code, query.season, query.round, now)
      setFinalOddsTs(now)
      if (res.domestic_updated || res.overseas_updated) setReloadKey((k) => k + 1)
    } catch (err) {
      setRefreshOddsNotice(`실패: ${err.message}`)
    } finally {
      setBusyRefreshOdds(false)
    }
  }

  // 재분석 결과 요약을 "리그명 N건 · 리그명 N건" 으로. 공식 데이터는 6대리그가 한꺼번에
  // 돌아 여러 리그가 나오고, 내 데이터는 그 리그 하나만 나온다.
  function summaryText(summary) {
    return Object.entries(summary || {})
      .filter(([, n]) => n > 0)
      .map(([lg, n]) => `${leagues.find((l) => l.code === lg)?.label ?? lg} ${n}건`)
      .join(' · ')
  }

  async function runRecomputePending() {
    setBusyRecomputePending(true)
    setRecomputeNotice('')
    try {
      // 두 스코프 모두 '이 리그 하나만' 돌린다. 공식 데이터도 표본은 6대리그 통합DB를
      // 쓰지만(서버가 알아서 고른다) 값을 쓰는 대상은 이 리그뿐이라, 6개를 전부 돌릴
      // 때와 결과가 같으면서 시간은 1/6이다(api/main.py _recompute_one_league의 ★ 주석).
      const res = await api.post(`/api/leagues/${code}/recompute`, {
        scope,
        include_historical: false,
      })
      const txt = summaryText(res.summary)
      setRecomputeNotice(txt ? `재분석 완료 → ${txt}` : '재분석 대상(예정 경기)이 없습니다.')
      setReloadKey((k) => k + 1)
    } catch (err) {
      setRecomputeNotice(`실패: ${err.message}`)
    } finally {
      setBusyRecomputePending(false)
    }
  }

  async function runRecomputeAll() {
    const n = filters?.total_rows ?? 0
    if (
      !window.confirm(
        `이 리그(${n.toLocaleString()}경기)만 과거 경기까지 포함해 다시 계산합니다.\n` +
          '다른 리그는 건드리지 않습니다. 경기 수에 따라 몇 분 걸릴 수 있습니다. 계속할까요?'
      )
    ) {
      return
    }
    setBusyRecomputeAll(true)
    setRecomputeNotice('')
    try {
      const res = await api.post(`/api/leagues/${code}/recompute`, {
        scope,
        include_historical: true,
        confirm: true,
      })
      const txt = summaryText(res.summary)
      setRecomputeNotice(txt ? `통합 재분석 완료 → ${txt}` : '재계산할 데이터가 없습니다.')
      setReloadKey((k) => k + 1)
    } catch (err) {
      setRecomputeNotice(`실패: ${err.message}`)
    } finally {
      setBusyRecomputeAll(false)
    }
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
      .get(`/api/leagues/${code}?${buildQueryString({ scope }, query)}`)
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
    setQuery(nextQuery)
  }

  if (error) return <p className="error-text">{error}</p>
  if (!filters || !data) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <div className="league-dashboard">
        <span>
          등록된 시즌 <strong>{filters.seasons.length}</strong> · 경기수{' '}
          <strong>{filters.total_rows.toLocaleString()}</strong> · 국배 등록{' '}
          <strong>{(filters.kw_count ?? 0).toLocaleString()}</strong> · 해배 등록{' '}
          <strong>{(filters.fw_count ?? 0).toLocaleString()}</strong>
        </span>
        <RtSummaryBar summary={filters.rt_summary} inline />
      </div>

      <FilterForm
        filters={filters}
        leagueKey={`${code}:${scope}`}
        onSearch={handleSearch}
        teams={teams}
      />

      <div className="excel-bar">
        {data.can_write && (
            <>
              <button
                className="btn-reset"
                onClick={() => setShowCrawlModal(true)}
                title="스코어맨 화면에서 경기·배당을 그대로 가져옵니다"
              >
                해배 가져오기
              </button>
              <button
                className="btn-reset"
                onClick={() => setShowKrCrawlModal(true)}
                title="젠토토 화면에서 국내배당(초기배당)을 가져와 기존 경기에 채웁니다"
              >
                국배 가져오기
              </button>
              <button
                className="btn-reset"
                onClick={() => setShowEditModal(true)}
                title="경기결과(RT)·국내핸디(KH)·해외핸디(FH)를 직접 입력합니다"
              >
                결과·핸디 입력
              </button>
              <button
                className="btn-reset"
                onClick={() => setShowTemplateModal(true)}
                title="리그·시즌·라운드를 입력해 업로드용 표본 엑셀을 만듭니다"
              >
                경기 Data 업로드 엑셀 만들기
              </button>
              <button
                className="btn-reset"
                onClick={() => fileInputRef.current?.click()}
                disabled={busyExcel === 'upload'}
                title="표본 파일에 입력한 경기를 DB에 등록합니다"
              >
                {busyExcel === 'upload' ? '읽는 중...' : '경기 Data 업로드'}
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
            {busyExcel === 'table' ? '받는 중...' : '엑셀 다운로드'}
          </button>
        </div>

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

      <SeasonStats code={code} scope={scope} season={query?.season} round={query?.round} />

      <div className="league-summary">
        <span>조회 조건 {describeQuery(query)}</span>
        <span>
          경기수 <strong>{data.total.toLocaleString()}</strong> · 국배 등록{' '}
          <strong>{(data.odds_summary?.국배 ?? 0).toLocaleString()}</strong> · 해배 등록{' '}
          <strong>{(data.odds_summary?.해배 ?? 0).toLocaleString()}</strong>
        </span>
        <RtSummaryBar summary={data.rt_summary} inline />
        <span className="league-summary-divider" aria-hidden="true" />
        <PickSummaryBar summary={data.hit_summary} />
        <div className="league-summary-toolbar">
          {finalOddsTs && (
            <span className="final-odds-ts">최신배당({formatFinalOddsTime(finalOddsTs)})</span>
          )}
          <button
            className="batch-fold-btn"
            onClick={runRefreshFinalOdds}
            disabled={busyRefreshOdds}
            title="이 시즌·라운드 경기들의 국내·해외 최종배당(배변 후)만 다시 받습니다. 초기배당은 그대로 둡니다."
          >
            {busyRefreshOdds ? '불러오는 중…' : '최신배당 불러오기'}
          </button>
          <button
            className="batch-fold-btn"
            onClick={() => setShowRiskLegend(true)}
            title="색상별 구간 참고표"
          >
            플핸무 확률 참고
          </button>
          {batch1Groups.length > 0 && (
            <button className="batch-fold-btn" onClick={() => toggleBatch(batch1Groups)}>
              해외지표 {batch1Groups.every((g) => collapsed.has(groupKey(g))) ? '펼치기' : '접기'}
            </button>
          )}
          {batch2Groups.length > 0 && (
            <button className="batch-fold-btn" onClick={() => toggleBatch(batch2Groups)}>
              국내지표 {batch2Groups.every((g) => collapsed.has(groupKey(g))) ? '펼치기' : '접기'}
            </button>
          )}
        </div>
      </div>
      {refreshOddsNotice && <p className="recompute-notice">{refreshOddsNotice}</p>}
      <LeagueTable
        code={code}
        columns={data.columns}
        rows={data.rows}
        scope={scope}
        highlightCols={ODDS_KEYS.filter((k) => query?.[k] !== undefined).map((k) => k.toUpperCase())}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        showRiskLegend={showRiskLegend}
        onShowRiskLegendChange={setShowRiskLegend}
        hideToolbar
      />
      {showRiskLegend && <RiskLegendModal onClose={() => setShowRiskLegend(false)} />}

      {data.can_write && (
        <div style={{ marginTop: 10 }}>
          <div className="league-recompute-row">
            <button className="btn-primary" disabled={busyRecomputePending} onClick={runRecomputePending}
                   title="이 리그의 예정 경기만, 초기배당·배변배당 둘 다 다시 계산합니다.">
              {busyRecomputePending ? '재분석 중...' : '🔄 예정경기 재분석'}
            </button>
            <button className="btn-danger" disabled={busyRecomputeAll} onClick={runRecomputeAll}
                   title="이 리그의 과거 경기까지 전부, 초기배당·배변배당 둘 다 다시 계산합니다(오래 걸립니다).">
              {busyRecomputeAll ? '재계산 중...' : '🔧 통합 재분석'}
            </button>
            <div className="league-stat">
              <span className="league-stat-label">경기수</span>
              <span className="league-stat-value">{filters.total_rows.toLocaleString()}</span>
            </div>
            <div className="league-stat">
              <span className="league-stat-label">시즌</span>
              <span className="league-stat-value">{filters.season_range}</span>
            </div>
            <div className="league-stat">
              <span className="league-stat-label">결과보유</span>
              <span className="league-stat-value">{(filters.rt_summary?.총 ?? 0).toLocaleString()}</span>
            </div>
            <div className="league-stat">
              <span className="league-stat-label">예정</span>
              <span className="league-stat-value">
                {(filters.pending_count - filters.cancelled_count - filters.postponed_count).toLocaleString()}
              </span>
            </div>
            <div className="league-stat">
              <span className="league-stat-label">연기</span>
              <span className="league-stat-value">{filters.postponed_count.toLocaleString()}</span>
            </div>
            <div className="league-stat">
              <span className="league-stat-label">취소</span>
              <span className="league-stat-value">{filters.cancelled_count.toLocaleString()}</span>
            </div>
            <div className="league-stat">
              <span className="league-stat-label">국내배당</span>
              <span className="league-stat-value">{filters.kw_count.toLocaleString()}</span>
            </div>
            <button className="btn-reset" onClick={() => setShowDeleteModal(true)}>
              🗑 경기 Data 삭제 선택
            </button>
          </div>
          {recomputeNotice && <p className="recompute-notice">{recomputeNotice}</p>}
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

      {showKrCrawlModal && (
        <KrCrawlModal
          code={code}
          scope={scope}
          label={leagues.find((l) => l.code === code)?.label}
          onClose={() => setShowKrCrawlModal(false)}
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
