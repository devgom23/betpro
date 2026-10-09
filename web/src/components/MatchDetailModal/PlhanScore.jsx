import { useEffect } from 'react'
import { PL_SPLIT_AXIS } from '../../utils/verdictCalc'
import { UNI_GRADES, uniIfOn } from '../../utils/plhanScore'
import './PlhanScore.css'

// 상세보기 경기지표 '플핸 확률' 칩을 누르면 뜨는 근거 팝업(패턴분석-02, 2026-10-09 사용자 승인).
//   ① 이 경기 계산 — 시장이 본 플핸 → 출발점 → 근거별 더하는 몫 → 플핸 확률
//   ② 등급별 지난 경기 — 시즌마다 그 앞 시즌만 배운 공식으로 낸 시험 성적(미래를 안 본 값)
//   ③ 공식 밖 참고 — 재 봤지만 확률에 안 넣은 것(플축·국≠해 · 7레드 · 첫맞대결)과 그 이유
//   ④ 기존 플핸 점수(10-07, 패턴분석-01 + 동의) — 공식의 '4점 이상' 근거라 접어서 그대로 둔다
// 계산은 utils/plhanScore.js plhanUnified, 계수·등급표는 서버 api/plhan_score.py 학습 결과(stats.json unified).

const pct = (v, nd = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(nd)}%`)
const pp = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`)
const n2 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))
const Mark = ({ on }) => <b className={on ? 'plh-ok' : 'plh-no'}>{on ? '✓' : '✗'}</b>
const rate = (hit, n) => (n ? `${((hit / n) * 100).toFixed(1)}%` : '—')

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

// 등급별 시험 성적 — 이 경기 등급 줄을 노랗게.
function GradeTable({ grades, me }) {
  const per = (c, k) => {
    const [hit, n] = c?.periods?.[k] || [0, 0]
    return n ? `${rate(hit, n)} (${hit}/${n})` : '—'
  }
  return (
    <table className="detail-table plh-ladder">
      <thead>
        <tr><th>등급</th><th>경기</th><th>실제 플핸</th><th>공식 예측</th><th>시즌당</th><th>찾기</th><th>고르기</th><th>최근 5시즌</th></tr>
      </thead>
      <tbody>
        {UNI_GRADES.map((g) => {
          const c = grades?.[g.key]
          if (!c) return null
          return (
            <tr key={g.key} className={me === g.key ? 'plh-me' : undefined}>
              <td>{g.label}</td>
              <td>{c.n.toLocaleString()}</td>
              <td>{c.rate === null ? '—' : `${c.rate.toFixed(1)}%`} <span className="plh-sub">({c.hit.toLocaleString()})</span></td>
              <td>{c.pred === null ? '—' : `${c.pred.toFixed(1)}%`}</td>
              <td>{c.per_season}</td>
              <td>{per(c, '찾기')}</td>
              <td>{per(c, '고르기')}</td>
              <td>{per(c, '최근')}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function PlhanScorePopup({ data: d, uni, flags, axisV, plSplit, row, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const u = d.unified
  const p = d.pattern
  const a = d.agree
  const ok = d.state === 'ok'
  const gs = uni?.gradeStats
  const ft = u?.first_test?.[uni?.phase || 'close']
  const firstInFormula = uni?.terms?.some((t) => t.key === 'first')
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
    return `${Number(s.cut).toFixed(2)} ${s.op === '<=' ? '이하' : '이상'}`
  }
  // 근거 한 줄의 '이 경기' 칸
  const termState = (t) => {
    if (t.key === 'pt45') return <>{ok ? `${d.score}점` : '—'} <Mark on={t.on} /></>
    if (t.on === null) return <span className="plh-no">{t.key === 'p85' ? '전적 불러오는 중…' : '표본·전적 불러오는 중…'}</span>
    if (t.key === 'axpl' || t.key === 'axpl_init') {
      if (t.on) return <><Mark on /> {axisV?.plAll?.join('·')}</>
      return <><Mark on={false} /> {axisV && <span className="plh-sub">레드 {axisV.ctx.nred} · 블루 {axisV.ctx.nblue} (7개 중)</span>}</>
    }
    return <Mark on={t.on} />
  }

  return (
    <div className="modal-backdrop help-legend-back" onClick={onClose}>
      <div className="modal-card help-legend-card plh-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">🎯 플핸 확률 — {String(row?.HT || '').trim()} vs {String(row?.AT || '').trim()}</h2>

        {uni ? (
          <div className="plh-head">
            <span className={`plh-score plh-grade-${uni.grade.key}`}>{pct(uni.p, 0)}</span>
            <span>
              {uni.grade.label} 등급
              {gs && <> · 이 등급 지난 경기 실제 <b>{gs.rate}%</b> ({gs.hit.toLocaleString()}/{gs.n.toLocaleString()})</>}
            </span>
            {uni.phase === 'init' && (
              <span className="plh-warn">초기 배당으로 낸 값 — 킥오프 가까이 최신배당을 불러오면 마감 공식으로 바뀝니다</span>
            )}
          </div>
        ) : (
          <div className="plh-head">
            <span className="plh-score">—</span>
            <span>확률 공식 학습 파일이 없습니다 — 터미널에서 <code>python api/plhan_score.py train</code>을 한 번 돌려 주세요.</span>
          </div>
        )}
        <p className="plh-note">
          단통 플핸 = 무+역(국내 초기 정배 기준) — 핸무는 실패로 셉니다. 패턴분석-02{u?.trained_at ? ` · ${u.trained_at} 학습` : ''}.
        </p>

        {uni && (
          <>
            <p className="help-legend-title">① 이 경기 계산</p>
            <table className="detail-table plh-table">
              <thead><tr><th>항목</th><th>이 경기</th><th>더하는 몫</th></tr></thead>
              <tbody>
                {uni.phase === 'close' ? (
                  <tr>
                    <td className="row-label">마감 시장이 본 플핸</td>
                    <td>
                      {pct(uni.market.p)}{' '}
                      <span className="plh-sub">{uni.market.src}{uni.market.src?.startsWith('12사') && d.market?.n12 ? ` ${d.market.n12}곳` : ''}</span>
                    </td>
                    <td>출발점 <b>{pct(uni.base)}</b></td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className="row-label">초기 시장이 본 플핸</td>
                      <td>{pct(uni.market.p)} <span className="plh-sub">{uni.market.src}</span></td>
                      <td rowSpan={2}>출발점 <b>{pct(uni.base)}</b></td>
                    </tr>
                    <tr>
                      <td className="row-label">국내 초기가 본 플핸</td>
                      <td>{pct(uni.market.k)}</td>
                    </tr>
                  </>
                )}
                {uni.terms.map((t) => (
                  <tr key={t.key}>
                    <td className="row-label">{t.name}</td>
                    <td>{termState(t)}</td>
                    <td>
                      {t.on
                        ? <b className="plh-ok">{pp(t.delta)}</b>
                        : <span className="plh-no">— <span className="plh-sub">(맞으면 {pp(uniIfOn(uni.p, t.coef))})</span></span>}
                    </td>
                  </tr>
                ))}
                <tr className="plh-sum">
                  <td className="row-label">플핸 확률</td>
                  <td colSpan={2}><b>{pct(uni.p)}</b></td>
                </tr>
              </tbody>
            </table>
            <p className="plh-note">
              출발점 = 시장 확률을 지난 결과에 맞게 한 번 바로잡은 값입니다(배당을 그대로 쓰면 강한 정배 경기에서 플핸을 1~5%p 많게 봅니다).
              근거는 마감 시장보다 더 맞힌 것만 넣었습니다 — 2026-10-09 실측에서 시장 예상을 넘은 칩은 기존 점수 4점 이상(+14.4%p)과
              플축(+12.3%p)뿐이었고, 플핸85는 28경기로 작습니다.
            </p>

            <p className="help-legend-title">
              ② 등급별 지난 경기 — {u.test_seasons} {u.test_games?.toLocaleString()}경기 시험{uni.phase === 'init' ? ' (초기판 공식)' : ''}
            </p>
            <GradeTable grades={u[`${uni.phase}_grades`]} me={uni.grade.key} />
            <p className="plh-note">
              시즌마다 그 앞 시즌들(15-16~)만 배운 공식으로 계산한 성적이라 미래를 안 본 값입니다. 찾기 = {u.periods?.['찾기']} ·
              고르기 = {u.periods?.['고르기']} · 최근 5시즌 = {u.periods?.['최근']}. 세 기간이 비슷하면 믿을 만합니다.
              공식 예측과 실제가 가까울수록 % 자체를 그대로 믿어도 된다는 뜻입니다.
            </p>

            <p className="help-legend-title">③ 공식 밖 참고 — 재 봤지만 확률에 넣지 않은 것</p>
            <table className="detail-table plh-table plh-ref">
              <thead><tr><th>항목</th><th>이 경기</th><th>넣지 않은 이유</th></tr></thead>
              <tbody>
                <tr>
                  <td className="row-label">플축·국≠해</td>
                  <td><Mark on={!!plSplit} /></td>
                  <td>
                    9월 실측 {PL_SPLIT_AXIS.rate}%({PL_SPLIT_AXIS.n}경기)였지만 조건의 '배변 판정 플핸무'가 저장된 지표(뒤 경기가 섞임)를 써서
                    과거 시점으로 다시 만들 수 없습니다. 배당 조건만으로 재면 시장 예상 68.0% → 실제 73.0%(367경기)인데 최근 5시즌에만
                    몰려 있습니다(+0.9 / −0.4 / +12.7%p). 이런 경기는 시장이 이미 높게 봐서 확률도 65~75% 등급으로 뜹니다.
                  </td>
                </tr>
                <tr>
                  <td className="row-label">7레드</td>
                  <td>{axisV ? <Mark on={axisV.ctx.nred === 7 && !axisV.pl} /> : '—'}</td>
                  <td>자동 방향성 7개가 전부 레드인데 플축 조건이 없는 경기 — 15-16~ 37경기 56.8%로 시장 예상(57.4%)과 같았습니다.</td>
                </tr>
                {!firstInFormula && (
                  <tr>
                    <td className="row-label">첫맞대결</td>
                    <td>{flags?.first === null || flags?.first === undefined ? '—' : <Mark on={flags.first} />}</td>
                    <td>
                      {ft
                        ? <>평균으로는 시장 예상보다 더 나왔지만(시험 {ft.n_first}경기 실제 {ft.first_rate}% · 공식 예측 {ft.first_pred_without}%),
                          넣으면 65% 이상 경기 적중이 {rate(...ft.hi_without)}({ft.hi_without[0]}/{ft.hi_without[1]}) →
                          {' '}{rate(...ft.hi_with)}({ft.hi_with[0]}/{ft.hi_with[1]})로 떨어져 뺐습니다.</>
                        : '학습 때 시험한 기록이 없습니다.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        <details className="plh-details">
          <summary>
            ④ 기존 플핸 점수 {ok ? `${d.score}점` : '대기'} — 패턴분석-01 + 동의(공식의 '4점 이상' 근거)
          </summary>
          <p className="plh-note">5점이 최대입니다(패턴 최대 2점 + 동의 최대 3점). 마감(배변) 배당으로만 계산합니다.</p>

          <p className="help-legend-title">(가) 패턴 점수 (패턴분석-01, 0~2점) — 정배 {p.fav}</p>
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

          <p className="help-legend-title">(나) 동의 점수 (다른 방법 3가지, 0~3점)</p>
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

          <p className="help-legend-title">(다) 합의 신호 6개 (3개 이상이면 동의 1점)</p>
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

          <p className="help-legend-title">(라) 점수별 실측 ({d.stats_seasons} 시즌 · {d.stats_at} 기준)</p>
          <LadderTable ladder={d.ladder} score={ok ? d.score : null} />
          <PeriodLine cell={ok && d.score >= 4 ? d.ladder?.['4+'] : ok ? d.ladder?.[String(d.score)] : d.ladder?.['4+']}
                      periods={d.stats_periods}
                      label={ok && d.score < 4 ? `${d.score}점` : '4점 이상'} />
        </details>

        <p className="plh-note plh-warn">
          ※ 마감 = 킥오프 직전 최종 배당으로 배우고 시험했습니다. 몇 시간 전 배당으로도 같은지는 아직 검증 전입니다 — 킥오프 가까이
          최신배당을 불러온 뒤 보세요. 지난 경기의 플축 판정은 표본을 지금 DB로 세서 그때와 다를 수 있습니다(앞으로 치를 경기가 정확).
        </p>
      </div>
    </div>
  )
}
