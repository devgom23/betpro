import { useEffect } from 'react'
import './PlhanScore.css'

// 상세보기 경기지표 맨 위 '플핸 점수' 칩을 누르면 뜨는 근거 팝업(2026-10-07 사용자 지정 —
// "뱃지만 경기지표에 보여주고 클릭 시 해당 점수를 낸 근거가 팝업으로").
// 점수 = 패턴(패턴분석-01, 0~2) + 동의(다른 방법 3가지, 0~3) — 계산·기준·실측은 api/plhan_score.py.

const pct = (v, nd = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(nd)}%`)
const pp = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`)
const n2 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))
const Mark = ({ on }) => <b className={on ? 'plh-ok' : 'plh-no'}>{on ? '✓' : '✗'}</b>

function LadderTable({ ladder, score }) {
  const rows = ['5', '4', '3', '2', '1', '0']
  return (
    <table className="detail-table plh-ladder">
      <thead>
        <tr><th>점수</th><th>지난 경기 플핸</th><th>적중 / 경기</th><th>시즌당</th><th>핸승(실패)</th></tr>
      </thead>
      <tbody>
        {rows.map((k) => {
          const c = ladder?.[k]
          if (!c) return null
          return (
            <tr key={k} className={String(score) === k ? 'plh-me' : undefined}>
              <td>{k}점</td>
              <td>{c.rate === null ? '—' : `${c.rate.toFixed(1)}%`}</td>
              <td>{c.hit.toLocaleString()} / {c.n.toLocaleString()}</td>
              <td>{c.per_season}</td>
              <td>{c.cov === null ? '—' : `${c.cov.toFixed(1)}%`}</td>
            </tr>
          )
        })}
        {ladder?.['4+'] && (
          <tr className={score >= 4 ? 'plh-sum plh-me-soft' : 'plh-sum'}>
            <td>4점 이상</td>
            <td>{ladder['4+'].rate.toFixed(1)}%</td>
            <td>{ladder['4+'].hit} / {ladder['4+'].n}</td>
            <td>{ladder['4+'].per_season}</td>
            <td>{ladder['4+'].cov.toFixed(1)}%</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function PeriodLine({ cell, periods, label }) {
  if (!cell?.periods) return null
  const f = ([hit, n]) => (n ? `${((hit / n) * 100).toFixed(1)}% (${hit}/${n})` : '—')
  return (
    <p className="plh-note">
      {label} 기간별: 찾기 {f(cell.periods['찾기'])} · 고르기 {f(cell.periods['고르기'])} · 최근 5시즌 {f(cell.periods['최근'])}
      <br />
      찾기 = 패턴을 찾은 시기({periods?.['찾기']}) · 고르기 = 후보를 고른 시기({periods?.['고르기']}) ·
      최근 5시즌 = 안 보고 남겨 둔 시험 시기({periods?.['최근']}). 세 숫자가 비슷하면 믿을 만합니다.
    </p>
  )
}

export default function PlhanScorePopup({ data: d, row, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const p = d.pattern
  const a = d.agree
  const ok = d.state === 'ok'
  const cut = (v) => `${(v * 100).toFixed(1)}%p 이하`
  const sigVal = (s) => {
    if (s.value === null) return '없음'
    if (s.key === 'sbo') return pp(s.value)
    if (s.key === 'card') return pct(s.value, 0)
    return `${s.value > 0 ? '+' : ''}${Number(s.value).toFixed(2)}`
  }
  const sigCut = (s) => {
    if (s.key === 'sbo') return `${(s.cut * 100).toFixed(1)}%p 이하`
    if (s.key === 'card') return `${Math.round(s.cut * 100)}% 이상`
    return `${s.op === '<=' ? '' : ''}${Number(s.cut).toFixed(2)} ${s.op === '<=' ? '이하' : '이상'}`
  }
  return (
    <div className="modal-backdrop help-legend-back" onClick={onClose}>
      <div className="modal-card help-legend-card plh-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">🎯 플핸 점수 — {String(row?.HT || '').trim()} vs {String(row?.AT || '').trim()}</h2>

        {ok ? (
          <div className="plh-head">
            <span className={`plh-score${d.score >= 4 ? ' hi' : d.score === 3 ? ' mid' : ''}`}>{d.score} / 5점</span>
            <span>
              같은 점수였던 지난 경기 <b>{d.ladder?.[String(d.score)]?.rate ?? '—'}%</b>
              {' '}({d.ladder?.[String(d.score)]?.hit ?? '—'}/{d.ladder?.[String(d.score)]?.n ?? '—'})
              {d.score >= 5 && <> — 경기 수가 적어 칩에는 <b>4점 이상 {d.ladder?.['4+']?.rate}%</b>로 표시</>}
            </span>
          </div>
        ) : (
          <div className="plh-head">
            <span className="plh-score">대기</span>
            <span>마감(배변) 배당이 아직 없어 계산 전입니다 — 아래 기준 배당을 보세요.</span>
          </div>
        )}
        <p className="plh-note">5점이 최대입니다(패턴 최대 2점 + 동의 최대 3점). 단통 플핸 = 무+역 — 핸무는 실패로 셉니다.</p>

        <p className="help-legend-title">① 패턴 점수 (패턴분석-01, 0~2점) — 정배 {p.fav}</p>
        <table className="detail-table plh-table">
          <thead><tr><th>항목</th><th>이 경기</th><th>기준</th><th>결과</th></tr></thead>
          <tbody>
            <tr>
              <td className="row-label">국내 접전형</td>
              <td>역배 {n2(p.k_dog)} ≤ 무 {n2(p.k_draw)}×0.876({n2(p.dog_cut)})</td>
              <td>역배 ≤ 무×0.876</td>
              <td><Mark on={p.close} /></td>
            </tr>
            <tr>
              <td className="row-label">Bet365 마감 정배확률</td>
              <td>{p.has365 ? `${pct(p.k_pf)} → ${pct(p.ef_pf)} (${pp(p.d365)})` : `마감 없음 — 정배 팀 ${n2(p.need365)} 이상이면 해당`}</td>
              <td>{cut(p.cut365)} → B</td>
              <td>{p.has365 ? <><Mark on={p.B} />{p.B ? ' B' : ''}</> : '—'}</td>
            </tr>
            <tr>
              <td className="row-label">12사 마감 평균 정배확률</td>
              <td>{p.has12 ? `${pct(p.k_pf)} → ${pct(p.mb_pf)} (${pp(p.d12)})` : `마감 없음 — 정배 팀 평균 ${n2(p.need12)} 이상이면 해당`}</td>
              <td>{cut(p.cut12)} → B12s</td>
              <td>{p.has12 ? <><Mark on={p.B12s} />{p.B12s ? ' B12s' : ''}</> : '—'}</td>
            </tr>
            <tr>
              <td className="row-label">마감에 정배 뒤집힘</td>
              <td>Bet365 {p.has365 ? (p.flip365 ? '뒤집힘' : '그대로') : '—'} · 12사 {p.flip12 === null ? '—' : `${Math.round(p.flip12 * 100)}%가 반대`}</td>
              <td>Bet365 반대 또는 12사 50%↑</td>
              <td><Mark on={p.flip} /></td>
            </tr>
            <tr className="plh-sum">
              <td className="row-label">패턴 점수</td>
              <td colSpan={2}>B12s = 2점 · B 또는 뒤집힘 = 1점 · 없음 = 0점</td>
              <td><b>{p.points}점</b></td>
            </tr>
          </tbody>
        </table>

        <p className="help-legend-title">② 동의 점수 (다른 방법 3가지, 0~3점)</p>
        <table className="detail-table plh-table">
          <thead><tr><th>방법</th><th>이 경기</th><th>기준</th><th>동의</th></tr></thead>
          <tbody>
            {a.items.map((it) => (
              <tr key={it.key}>
                <td className="row-label">{it.name}</td>
                <td>{it.value === null ? '—' : it.key === 'cons' ? `${it.value} / 6` : n2(it.value)}</td>
                <td>{it.key === 'cons' ? `${it.cut}개 이상` : `${n2(it.cut)} 이상`}</td>
                <td><Mark on={it.on} /></td>
              </tr>
            ))}
            <tr className="plh-sum">
              <td className="row-label">동의 점수</td>
              <td colSpan={2}>하나당 1점</td>
              <td><b>{a.count}점</b></td>
            </tr>
          </tbody>
        </table>
        {a.model_src && <p className="plh-note">모델 점수: {a.model_src}</p>}

        <p className="help-legend-title">③ 합의 신호 6개 (3개 이상이면 동의 1점)</p>
        <table className="detail-table plh-table">
          <thead><tr><th>신호</th><th>이 경기</th><th>기준</th><th>켜짐</th></tr></thead>
          <tbody>
            {a.signals.map((s) => (
              <tr key={s.key}>
                <td className="row-label">{s.name}</td>
                <td>{sigVal(s)}{s.note ? <span className="plh-sub"> · {s.note}</span> : null}</td>
                <td>{sigCut(s)}</td>
                <td><Mark on={s.on} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="plh-note">
          같은배당 표본 방향 = (그 배당이었던 과거 경기의 플핸 비율 − 46.2%) × √경기 수 ÷ 0.5 — 그 경기 날짜 이전에 끝난 경기만 셉니다.
          배당사 방향 점수는 각 회사의 방향을 국내 정배 기준으로 맞춰 뒤집은 값입니다(−면 플 쪽).
        </p>

        <p className="help-legend-title">④ 점수별 실측 ({d.stats_seasons} 시즌 · {d.stats_at} 기준)</p>
        <LadderTable ladder={d.ladder} score={ok ? d.score : null} />
        <PeriodLine cell={ok && d.score >= 4 ? d.ladder?.['4+'] : ok ? d.ladder?.[String(d.score)] : d.ladder?.['4+']}
                    periods={d.stats_periods}
                    label={ok && d.score < 4 ? `${d.score}점` : '4점 이상'} />
        <p className="plh-note plh-warn">
          ※ 모든 점수는 마감(배변) 배당으로 계산합니다. 과거 경기의 마감은 킥오프 직전 최종값이라, 몇 시간 전 배당으로도
          같은지는 아직 검증 전입니다 — 킥오프 가까이 최신배당을 불러온 뒤 보세요.
        </p>
      </div>
    </div>
  )
}
