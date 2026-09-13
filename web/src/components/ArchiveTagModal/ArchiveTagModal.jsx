import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { TEAM_TAG_OPTIONS, MATCHUP_TAG_OPTIONS } from '../../utils/pickOptions'
import { archiveTargetText, archiveSpanText, archiveStatsText } from '../../utils/archiveTags'
import './ArchiveTagModal.css'

// 상세보기 📌 아카이브 버튼 → 이 경기의 팀·맞대결에 내 판단 태그를 단다(2026-09-13).
// 달아 둔 태그는 그 팀/맞대결이 다시 나올 때 경기지표에 뱃지로 뜨고, 아카이브 탭에 모인다.
// 지금 보는 경기가 '근거 경기'로 같이 저장된다(태그 이후 성적도 이 경기 다음부터 센다).
export default function ArchiveTagModal({ row, code, scope, tags, onClose, onChanged }) {
  const ht = String(row.HT || '').trim()
  const at = String(row.AT || '').trim()
  const targets = [
    { value: 'home', label: `${ht} (홈팀)`, kind: 'team', a: ht, b: null },
    { value: 'away', label: `${at} (원정팀)`, kind: 'team', a: at, b: null },
    { value: 'h2a', label: `맞대결 ${ht} → ${at}`, kind: 'matchup', a: ht, b: at },
    { value: 'a2h', label: `맞대결 ${at} → ${ht}`, kind: 'matchup', a: at, b: ht },
  ]
  const [target, setTarget] = useState('home')
  const [tag, setTag] = useState('')
  const [memo, setMemo] = useState('')
  const [span, setSpan] = useState('season')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const cur = targets.find((t) => t.value === target)
  const options = cur.kind === 'matchup' ? MATCHUP_TAG_OPTIONS : TEAM_TAG_OPTIONS

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function changeTarget(value) {
    setTarget(value)
    setTag('')
    // 맞대결은 시즌이 바뀌어도 이어지는 경우가 많아 기본을 '전체'로, 팀은 '이번 시즌'으로.
    setSpan(targets.find((t) => t.value === value).kind === 'matchup' ? 'all' : 'season')
  }

  async function save() {
    if (!tag) {
      setMessage('태그를 골라주세요.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await api.post('/api/archive/tags', {
        kind: cur.kind, scope, code, team_a: cur.a, team_b: cur.b, tag, memo, span,
        S: row.S, R: row.R, No: row.No, HT: ht, AT: at,
      })
      setMessage(`저장했습니다 — 📌 ${cur.kind === 'matchup' ? `${cur.a}→${cur.b}` : cur.a} ${tag}`)
      setTag('')
      setMemo('')
      onChanged()
    } catch (err) {
      setMessage(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function release(t) {
    try {
      await api.post(`/api/archive/tags/${t.id}/update`, { active: false })
      onChanged()
    } catch (err) {
      setMessage(err.message)
    }
  }

  return (
    <div className="modal-backdrop archive-tag-back" onClick={onClose}>
      <div className="modal-card archive-tag-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">📌 아카이브에 태그 달기</h2>
        <p className="archive-tag-desc">
          {row.S} · {row.R} · {ht} vs {at} — 이 경기가 근거 경기로 같이 저장됩니다.
        </p>

        <div className="archive-tag-form">
          <label className="archive-tag-row">
            <span className="archive-tag-label">대상</span>
            <select id="archive-target" value={target} onChange={(e) => changeTarget(e.target.value)}>
              {targets.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="archive-tag-row">
            <span className="archive-tag-label">태그</span>
            <select id="archive-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">태그 선택</option>
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="archive-tag-row">
            <span className="archive-tag-label">범위</span>
            <select id="archive-span" value={span} onChange={(e) => setSpan(e.target.value)}>
              <option value="season">{row.S} 시즌만</option>
              <option value="all">전체 시즌</option>
            </select>
          </label>
          <label className="archive-tag-row">
            <span className="archive-tag-label">메모</span>
            <input
              id="archive-memo"
              type="text"
              value={memo}
              placeholder="왜 이 태그를 다는지 짧게"
              onChange={(e) => setMemo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
            />
          </label>
          <div className="archive-tag-actions">
            {message && <span className="archive-tag-message">{message}</span>}
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>

        <h3 className="archive-tag-subtitle">이 경기에 걸린 태그</h3>
        {tags.length === 0 ? (
          <p className="archive-tag-empty">아직 없습니다.</p>
        ) : (
          <ul className="archive-tag-list">
            {tags.map((t) => (
              <li key={t.id}>
                <span className="archive-tag-chip">📌 {archiveTargetText(t)} · {t.tag}</span>
                <span className="archive-tag-meta">
                  {archiveSpanText(t)} · 이후 {archiveStatsText(t.stats)}
                  {t.memo ? ` · ${t.memo}` : ''}
                </span>
                <button className="archive-tag-release" onClick={() => release(t)}>해제</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
