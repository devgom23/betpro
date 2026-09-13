import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import MatchDetailModal from '../components/MatchDetailModal/MatchDetailModal'
import { TEAM_TAG_OPTIONS, MATCHUP_TAG_OPTIONS } from '../utils/pickOptions'
import {
  archiveTargetText, archiveSourceText, archiveStatsText, archiveStatsLines, archiveDateText,
} from '../utils/archiveTags'
import './ArchivePage.css'

// 아카이브 탭 — 상세보기 📌 아카이브 버튼으로 팀·맞대결에 달아 둔 태그를 리그별로 모아
// 본다(2026-09-13). 태그·범위·메모는 표에서 바로 고치고, 해제/복원·삭제도 여기서 한다.
// '태그 이후 성적'은 근거 경기 다음부터 지금까지(팀=그 팀 기준, 맞대결=주어 팀 기준).

// 상세보기 저장(onSavePick) 패치 키 → 행 컬럼 — LeagueTable.savePick과 같은 짝.
const PICK_FIELDS = {
  important: 'IMPORTANT', pick: 'MY_PICK', p: 'MY_P', hit: 'MY_HIT', memo: 'MEMO',
  memoPre: 'MEMO_PRE', reasonTag: 'REASON_TAG', oddsPick: 'MY_ODDS_PICK', oddsBet: 'MY_ODDS_BET',
}

export default function ArchivePage() {
  const [tags, setTags] = useState(null)
  const [error, setError] = useState('')
  const [league, setLeague] = useState('')
  const [kind, setKind] = useState('team')
  const [showInactive, setShowInactive] = useState(false)
  const [detail, setDetail] = useState(null)
  const [opening, setOpening] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/archive/tags')
      setTags(res.tags || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

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
  async function openSource(t) {
    setOpening(t.id)
    try {
      const params = new URLSearchParams({ scope: t.scope, season: t.S, round: t.R ?? 'ALL', limit: '500' })
      const res = await api.get(`/api/leagues/${t.code}?${params.toString()}`)
      const row = (res.rows || []).find((r) =>
        String(r.HT).trim() === t.HT && String(r.AT).trim() === t.AT
        && (t.No == null || t.No === '' || Number(r.No) === Number(t.No)))
      if (!row) {
        setError(`근거 경기를 찾지 못했습니다 — ${archiveSourceText(t)}`)
        return
      }
      setDetail({ code: t.code, scope: t.scope, row })
    } catch (err) {
      setError(err.message)
    } finally {
      setOpening(null)
    }
  }

  async function saveDetailPick(patch) {
    if (!detail) return
    const next = { ...detail.row }
    for (const [k, v] of Object.entries(patch)) {
      if (PICK_FIELDS[k]) next[PICK_FIELDS[k]] = v
    }
    setDetail((d) => (d ? { ...d, row: next } : d))
    try {
      await api.post(`/api/leagues/${detail.code}/my_picks`, {
        scope: detail.scope, S: next.S, R: next.R, No: next.No, HT: next.HT, AT: next.AT,
        starred: Number(next.IMPORTANT) || 0,
        pick: next.MY_PICK || null, p: next.MY_P || null, hit: next.MY_HIT || null,
        memo: next.MEMO || null, memo_pre: next.MEMO_PRE || null, reason_tag: next.REASON_TAG || null,
        odds_pick: next.MY_ODDS_PICK || null, odds_bet: next.MY_ODDS_BET || null,
      })
    } catch (err) {
      setError(err.message)
    }
  }

  const tagOptions = kind === 'matchup' ? MATCHUP_TAG_OPTIONS : TEAM_TAG_OPTIONS

  return (
    <div className="ar-page">
      <h2 className="ar-title">📌 아카이브</h2>
      <p className="ar-desc">
        상세보기의 <b>📌 아카이브</b> 버튼으로 팀·맞대결에 달아 둔 태그입니다. 켜져 있는 태그는 그 팀/맞대결이
        다시 나오면 경기지표에 뱃지로 뜹니다. 판정 %·별점에는 반영하지 않습니다.
      </p>

      <div className="ar-toolbar">
        <select id="ar-league" value={league} onChange={(e) => setLeague(e.target.value)}>
          <option value="">전체 리그</option>
          {leagues.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="ar-kind-tabs">
          <button className={kind === 'team' ? 'active' : ''} onClick={() => setKind('team')}>
            팀 <span className="ar-count">{counts.team}</span>
          </button>
          <button className={kind === 'matchup' ? 'active' : ''} onClick={() => setKind('matchup')}>
            맞대결 <span className="ar-count">{counts.matchup}</span>
          </button>
        </div>
        <label className="ar-inactive-toggle">
          <input
            id="ar-show-inactive"
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          해제된 태그도 보기
        </label>
      </div>

      {error && <p className="ar-error">{error}</p>}
      {tags === null && !error && <div className="ar-empty">불러오는 중...</div>}
      {tags !== null && rows.length === 0 && (
        <div className="ar-empty">
          {kind === 'team' ? '팀' : '맞대결'} 태그가 없습니다. 상세보기에서 📌 아카이브 버튼으로 달 수 있습니다.
        </div>
      )}

      {rows.length > 0 && (
        <div className="ar-table-wrap">
          <table className="ar-table">
            <thead>
              <tr>
                <th>리그</th>
                <th>{kind === 'matchup' ? '맞대결 (주어 → 상대)' : '팀'}</th>
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
                    <button className="ar-link" onClick={() => openSource(t)} disabled={opening === t.id}>
                      {opening === t.id ? '여는 중...' : archiveSourceText(t)}
                    </button>
                  </td>
                  <td>{archiveDateText(t.created_dt)}</td>
                  <td className="ar-stats" title={archiveStatsLines(t.stats).join('\n') || undefined}>
                    {archiveStatsText(t.stats)}
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
          sameOdds={null}
          weekRank={null}
          onClose={() => {
            setDetail(null)
            load()
          }}
          onSavePick={saveDetailPick}
        />
      )}
    </div>
  )
}
