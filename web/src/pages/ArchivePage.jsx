import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import MatchDetailModal from '../components/MatchDetailModal/MatchDetailModal'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import { bettingDayOf } from '../components/LeagueTable/columnGroups'
import { TEAM_TAG_OPTIONS, MATCHUP_TAG_OPTIONS, ARCHIVE_ODDS_TAG_OPTIONS } from '../utils/pickOptions'
import {
  archiveTargetText, archiveSourceText, archiveStatsText, archiveStatsLines, archiveDateText,
} from '../utils/archiveTags'
import './WeekListPage.css'
import './ArchivePage.css'

// 아카이브 탭 — 상세보기 📌 아카이브 버튼으로 팀·맞대결에 달아 둔 태그를 리그별로 모아
// 본다(2026-09-13). 태그·범위·메모는 표에서 바로 고치고, 해제/복원·삭제도 여기서 한다.
// '태그 이후 성적'은 근거 경기 다음부터 지금까지(팀=그 팀 기준, 맞대결=주어 팀 기준).
//
// '배답벳' 탭(2026-09-14 사용자 지정)은 팀·맞대결 태그와는 완전히 다른 자료(archive_tags
// 테이블이 아니라 my_picks.odds_bet)라 세 번째 kind로 넣되 표는 통째로 따로 그린다 —
// 상세보기 '배답벳' 드롭박스에서 뭔가 골라 둔 경기를 이번주 리스트처럼 날짜별로 보여
// 달라는 요청이라, WeekListPage의 요일 묶기 방식을 그대로 재사용한다(날짜 범위 제한만 뺀다
// — 이번주 리스트는 이번 회차만, 여기는 지금까지 찍어 둔 것 전부).
const NO_DAY = { key: '￿', label: '날짜 미정' }

function tmOf(row) {
  const n = Number(row.TM)
  if (!Number.isFinite(n)) return 0
  return Math.floor(n / 100) < 6 ? n + 2400 : n
}

function OddsBetList({ data, loading, error }) {
  const [collapsed, setCollapsed] = useState(() => new Set(['일반정보', '경기정보', '지표', '똥배']))
  const [showRiskLegend, setShowRiskLegend] = useState(false)
  const rows = useMemo(() => data.rows || [], [data.rows])

  // 최근 것부터 위로 — 팀·맞대결 태그가 최신순인 것과 같은 방향이고, 계속 쌓이는
  // 목록이라 방금 찍은 배답벳이 스크롤 없이 바로 보여야 한다(이번주 리스트는 반대로
  // 오름차순인데, 그건 "이번 회차"라는 좁은 기간 안에서 다가올 순서를 보는 화면이라 다르다).
  const daySections = useMemo(() => {
    const buckets = new Map()
    for (const row of rows) {
      const day = bettingDayOf(row) || NO_DAY
      if (!buckets.has(day.key)) buckets.set(day.key, { ...day, rows: [] })
      buckets.get(day.key).rows.push(row)
    }
    for (const sec of buckets.values()) {
      sec.rows.sort((a, b) => tmOf(a) - tmOf(b))
    }
    return [...buckets.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  }, [rows])

  if (loading) return <div className="ar-empty">불러오는 중...</div>
  if (error) return <div className="ar-empty error-text">{error}</div>
  if (rows.length === 0) {
    return (
      <div className="ar-empty">
        배답벳을 찍어 둔 경기가 없습니다. 상세보기의 배답벳 드롭박스에서 고를 수 있습니다.
      </div>
    )
  }

  return (
    <div className="wl-page">
      <p className="wl-summary" style={{ marginBottom: 12 }}>
        <strong>{daySections.length}</strong>일 · 경기 <strong>{rows.length}</strong>
      </p>
      {daySections.map((sec) => (
        <section className="wl-day" key={sec.key}>
          <div className="wl-day-head">
            <span className={`wl-day-chip wl-day-${sec.weekday || 'none'}`}>{sec.label}</span>
            <span className="wl-day-count">{sec.rows.length}경기</span>
          </div>
          <LeagueTable
            columns={data.columns}
            rows={sec.rows}
            scope="master"
            hideIndicators
            fitContent
            showOddsBet
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            showRiskLegend={showRiskLegend}
            onShowRiskLegendChange={setShowRiskLegend}
          />
        </section>
      ))}
    </div>
  )
}

export default function ArchivePage() {
  const [tags, setTags] = useState(null)
  const [error, setError] = useState('')
  const [league, setLeague] = useState('')
  const [kind, setKind] = useState('team')
  const [showInactive, setShowInactive] = useState(false)
  const [detail, setDetail] = useState(null)
  const [oddsBet, setOddsBet] = useState(null)
  const [oddsBetError, setOddsBetError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/archive/tags')
      setTags(res.tags || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadOddsBet = useCallback(async () => {
    try {
      const res = await api.get('/api/archive/odds_bet_picks')
      setOddsBet(res)
      setOddsBetError('')
    } catch (err) {
      setOddsBetError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadOddsBet() }, [loadOddsBet])

  const leagues = useMemo(() => {
    const seen = new Map()
    for (const t of tags || []) {
      const key = `${t.scope}|${t.code}`
      if (!seen.has(key)) seen.set(key, `${t.league_label}${t.scope === 'user' ? ' (내 데이터)' : ''}`)
    }
    return [...seen.entries()]
  }, [tags])

  const inLeague = (tags || []).filter((t) => !league || `${t.scope}|${t.code}` === league)
  const counts = {
    team: inLeague.filter((t) => t.kind === 'team' && (showInactive || t.active)).length,
    matchup: inLeague.filter((t) => t.kind === 'matchup' && (showInactive || t.active)).length,
    odds: inLeague.filter((t) => t.kind === 'odds' && (showInactive || t.active)).length,
  }
  const rows = inLeague.filter((t) => t.kind === kind && (showInactive || t.active))

  async function update(t, patch) {
    setTags((list) => list.map((x) => (x.id === t.id ? { ...x, ...patch, active: patch.active ?? x.active } : x)))
    try {
      await api.post(`/api/archive/tags/${t.id}/update`, patch)
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  async function remove(t) {
    if (!window.confirm(`📌 ${archiveTargetText(t)} · ${t.tag} 태그를 삭제할까요? (해제와 달리 되돌릴 수 없습니다)`)) return
    try {
      await api.post(`/api/archive/tags/${t.id}/delete`, {})
      setTags((list) => list.filter((x) => x.id !== t.id))
    } catch (err) {
      setError(err.message)
    }
  }

  // 근거 경기 열기 — 그 시즌·라운드 표를 받아 경기를 찾아 상세보기를 바로 띄운다.
  // 근거 경기 열기 — 상세보기가 어떤 메뉴에서든 /api/match_detail로 직접 받아오므로
  // 여기서는 "어떤 경기인지"만 넘긴다(못 찾으면 상세보기 창이 이유를 보여준다).
  function openSource(t) {
    setDetail({ code: t.code, scope: t.scope, row: { S: t.S, R: t.R, No: t.No, HT: t.HT, AT: t.AT } })
  }

  const tagOptions = kind === 'matchup' ? MATCHUP_TAG_OPTIONS
    : kind === 'odds' ? ARCHIVE_ODDS_TAG_OPTIONS
      : TEAM_TAG_OPTIONS
  const targetLabel = kind === 'matchup' ? '맞대결 (주어 → 상대)' : kind === 'odds' ? '배당' : '팀'
  const isOddsBet = kind === 'odds_bet'

  return (
    <div className="ar-page">
      <h2 className="ar-title">📌 아카이브</h2>
      <p className="ar-desc">
        {isOddsBet ? (
          <>상세보기의 <b>배답벳</b> 드롭박스에서 고른 경기를 날짜별로 모아 봅니다(이번주 리스트와 같은 모양).</>
        ) : kind === 'odds' ? (
          <>상세보기의 <b>📌 아카이브</b> 버튼으로 국내 승/무/패 배당 값에 달아 둔 태그입니다(공식 데이터 6대리그
          전용). 켜져 있는 태그는 어느 리그든 그 배당 값이 다시 나오면 경기지표에 뱃지로 뜹니다. 판정 %·별점에는
          반영하지 않습니다.</>
        ) : (
          <>상세보기의 <b>📌 아카이브</b> 버튼으로 팀·맞대결에 달아 둔 태그입니다. 켜져 있는 태그는 그 팀/맞대결이
          다시 나오면 경기지표에 뱃지로 뜹니다. 판정 %·별점에는 반영하지 않습니다.</>
        )}
      </p>

      <div className="ar-toolbar">
        {!isOddsBet && (
          <select id="ar-league" value={league} onChange={(e) => setLeague(e.target.value)}>
            <option value="">전체 리그</option>
            {leagues.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
        <div className="ar-kind-tabs">
          <button className={kind === 'team' ? 'active' : ''} onClick={() => setKind('team')}>
            팀 <span className="ar-count">{counts.team}</span>
          </button>
          <button className={kind === 'matchup' ? 'active' : ''} onClick={() => setKind('matchup')}>
            맞대결 <span className="ar-count">{counts.matchup}</span>
          </button>
          <button className={kind === 'odds' ? 'active' : ''} onClick={() => setKind('odds')}>
            배당 <span className="ar-count">{counts.odds}</span>
          </button>
          <button className={isOddsBet ? 'active' : ''} onClick={() => setKind('odds_bet')}>
            배답벳 <span className="ar-count">{oddsBet ? oddsBet.total : ''}</span>
          </button>
        </div>
        {!isOddsBet && (
          <label className="ar-inactive-toggle">
            <input
              id="ar-show-inactive"
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            해제된 태그도 보기
          </label>
        )}
      </div>

      {isOddsBet && (
        <OddsBetList
          data={oddsBet || { rows: [], columns: [] }}
          loading={oddsBet === null && !oddsBetError}
          error={oddsBetError}
        />
      )}

      {!isOddsBet && error && <p className="ar-error">{error}</p>}
      {!isOddsBet && tags === null && !error && <div className="ar-empty">불러오는 중...</div>}
      {!isOddsBet && tags !== null && rows.length === 0 && (
        <div className="ar-empty">
          {targetLabel} 태그가 없습니다. 상세보기에서 📌 아카이브 버튼으로 달 수 있습니다.
        </div>
      )}

      {!isOddsBet && rows.length > 0 && (
        <div className="ar-table-wrap">
          <table className="ar-table">
            <thead>
              <tr>
                <th>리그</th>
                <th>{targetLabel}</th>
                <th>태그</th>
                <th>범위</th>
                <th>메모</th>
                <th>근거 경기</th>
                <th>등록일</th>
                <th>태그 이후 성적</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'ar-row-inactive'}>
                  <td>{t.league_label}</td>
                  <td className="ar-target">📌 {archiveTargetText(t)}</td>
                  <td>
                    <select value={t.tag} onChange={(e) => update(t, { tag: e.target.value })}>
                      {(tagOptions.includes(t.tag) ? tagOptions : [t.tag, ...tagOptions]).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={t.span} onChange={(e) => update(t, { span: e.target.value })}>
                      <option value="season">{t.S} 시즌만</option>
                      <option value="all">전체 시즌</option>
                    </select>
                  </td>
                  <td className="ar-memo-cell">
                    <input
                      type="text"
                      defaultValue={t.memo || ''}
                      placeholder="메모"
                      onBlur={(e) => {
                        if ((e.target.value || '') !== (t.memo || '')) update(t, { memo: e.target.value })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                    />
                  </td>
                  <td>
                    <button className="ar-link" onClick={() => openSource(t)}>
                      {archiveSourceText(t)}
                    </button>
                  </td>
                  <td>{archiveDateText(t.created_dt)}</td>
                  <td className="ar-stats" title={archiveStatsLines(t).join('\n') || undefined}>
                    {archiveStatsText(t)}
                  </td>
                  <td>
                    <button
                      className={`ar-state ${t.active ? 'ar-state-on' : 'ar-state-off'}`}
                      onClick={() => update(t, { active: !t.active })}
                      title={t.active ? '누르면 해제 — 경기지표에 더 이상 안 뜹니다' : '누르면 다시 켭니다'}
                    >
                      {t.active ? '켜짐' : '해제됨'}
                    </button>
                  </td>
                  <td>
                    <button className="ar-delete" onClick={() => remove(t)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <MatchDetailModal
          code={detail.code}
          row={detail.row}
          scope={detail.scope}
          onClose={() => {
            setDetail(null)
            load()
          }}
        />
      )}
    </div>
  )
}
