import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import LeagueTable, { selectKey } from '../components/LeagueTable/LeagueTable'
import BetSlip from '../components/BetSlip/BetSlip'
import './WeeklyPickPage.css'

const SLIP_IDS_KEY = 'betpro_week_bet_slip_ids'

// 슬립 카드 자체(몇 개가 떠 있는지)도 새로고침·탭 이동에도 남아있어야 한다 —
// 안의 경기·벳금액은 BetSlip이 자기 id로 따로 저장한다.
function loadSlipIdsState() {
  try {
    const raw = localStorage.getItem(SLIP_IDS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.slipIds) && parsed.slipIds.length > 0 && typeof parsed.nextId === 'number') {
      return parsed
    }
  } catch {
    // 무시하고 기본값으로
  }
  return null
}

function rangeLabel(rows) {
  const dts = rows.map((r) => String(r.DT || '')).filter(Boolean).sort()
  if (dts.length === 0) return null
  const clean = (s) => s.replace(/\s*\(.+\)$/, '').replace(/^(\d{2})-/, '20$1-')
  return `${clean(dts[0])} ~ ${clean(dts[dts.length - 1])}`
}

export default function WeeklyPickPage({ onGoBetHistory }) {
  const [data, setData] = useState({ columns: [], rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  // 선택 삭제용 체크 상태. 키→행 전체를 들고 있어야 삭제 API에 code/scope/S/R/No/HT/AT를 보낼 수 있다.
  const [selected, setSelected] = useState(new Map())
  // 슬립은 "저장"을 누를 때마다 옆에 하나씩 늘어난다. 탭을 벗어났다 돌아오거나
  // 새로고침해도 "삭제"를 누르기 전까지는 그대로 남아있어야 해서 localStorage에 저장한다.
  const persisted = loadSlipIdsState()
  const [slipIds, setSlipIds] = useState(persisted?.slipIds ?? [1])
  const [nextId, setNextId] = useState(persisted?.nextId ?? 2)

  useEffect(() => {
    localStorage.setItem(SLIP_IDS_KEY, JSON.stringify({ slipIds, nextId }))
  }, [slipIds, nextId])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get('/api/weekly_picks'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const rows = data.rows || []
  const period = rangeLabel(rows)

  function toggleRow(row) {
    setSelected((prev) => {
      const key = selectKey(row)
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, row)
      return next
    })
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(selectKey(r)))

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Map())
      return
    }
    setSelected(new Map(rows.map((r) => [selectKey(r), r])))
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 경기를 이번주 픽에서 지웁니다(리그 데이터는 그대로입니다). 계속할까요?`)) return
    setClearing(true)
    setError('')
    try {
      const items = [...selected.values()].map((row) => ({
        code: row.L, scope: row.scope, S: row.S, R: row.R, No: row.No, HT: row.HT, AT: row.AT,
      }))
      await api.post('/api/weekly_picks/hide', { items })
      setSelected(new Map())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="wp-page">
      <div className="wp-title-row">
        <h2 className="wp-title">📋 이번주 픽</h2>
        <button className="wp-guide-btn" onClick={() => setShowGuide(true)}>⚠ 배팅전필독</button>
        {rows.length > 0 && (
          <>
            <button className="wp-clear-btn" onClick={toggleSelectAll} disabled={clearing}>
              {allSelected ? '☐ 전체해제' : '☑ 전체선택'}
            </button>
            <button className="wp-clear-btn" onClick={handleDeleteSelected} disabled={clearing || selected.size === 0}>
              🗑 선택 삭제{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
          </>
        )}
      </div>
      <p className="wp-desc">
        {period && <>{period} · </>}
        별표(★) 표시한 경기 모음 · 체크 후 "선택 삭제"하면 이 화면에서만 빠집니다(리그 데이터는 유지)
      </p>

      {loading && <div className="wp-empty">불러오는 중...</div>}
      {error && <div className="wp-empty error-text">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="wp-empty">
          별표(★) 표시한 경기가 없습니다. 리그 표에서 ☆를 눌러 이번주에 볼 경기를 골라주세요.
        </div>
      )}
      {rows.length > 0 && (
        <LeagueTable
          columns={data.columns}
          rows={rows}
          scope="master"
          selectable
          selectedKeys={new Set(selected.keys())}
          onToggleRow={toggleRow}
          hideIndicators
        />
      )}

      <h2 className="wp-title wp-title-bet">
        🎲 이번주 벳 <span className="wp-title-warn">똥배는 3번 생각하고 가자</span>
      </h2>

      <div className="wp-slips">
        {slipIds.map((id) => (
          <BetSlip
            key={id}
            id={id}
            rows={rows}
            scope="master"
            canDelete={slipIds.length > 1}
            onSave={() => {
              setSlipIds((prev) => [...prev, nextId])
              setNextId((n) => n + 1)
            }}
            onDelete={() => setSlipIds((prev) => prev.filter((s) => s !== id))}
            onRegistered={onGoBetHistory}
          />
        ))}
      </div>

      {showGuide && <BettingGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  )
}

// 배팅전필독 — 강추·초강추가 "적중을 보장"하는 게 아니라 "핸승(정배 2골차 이상)은
// 안 나온다"만 보장한다는 것, 그리고 그 나머지(무·역·핸무) 중 핸무만 걸리면 적중이
// 아니라 보험이라는 걸 실측으로 보여준다. 2026-09-08 우디네세/라치오(핸무로 보험)를
// 계기로 6대리그 36,033경기 전수 실측 — 근거는 web/src/utils/verdictCalc.js의
// 강추 등급 실측(STRONG_TIER_TITLE 주석)과 같은 데이터, 여기서는 배팅 관점으로 재구성.
function BettingGuideModal({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop help-legend-back" onClick={onClose}>
      <div className="modal-card help-legend-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">⚠ 배팅 전 필독 — 강추가 떠도 무조건 맞는 게 아닙니다</h2>

        <p className="help-legend-note">
          강추·초강추(플핸무)는 <b>&quot;핸승(정배가 2골차 이상 이기는 것)은 안 나온다&quot;</b>에
          거는 판정입니다. 나머지 세 결과(핸무·무·역) 중 무엇이 나올지는 갈라주지 않습니다.
          이 중 <b>핸무</b>가 걸리면 판정표에서 <b>&apos;보험&apos;</b>(원금 근처 환급)이지{' '}
          <b>&apos;적중&apos;</b>(수익)이 아닙니다 — 강추가 뜬 경기도 5경기 중 1경기 꼴로 이렇게
          끝납니다. 아래는 그 근거입니다.
        </p>

        <p className="help-legend-title">① 핸무는 배당을 봐도 미리 못 피합니다</p>
        <p className="help-legend-note">
          핸승은 정배가 강할수록 확 줄어듭니다. 그런데 <b>핸무는 어떤 배당에서도 20~26%
          사이에서 거의 안 움직입니다</b> — 배당이 이미 아는 정보가 아니라는 뜻이라, 핸무만
          따로 피하는 신호를 이 앱에서도 만들 수가 없습니다(그래서 픽 이름을 정할 때부터
          핸무·무는 배제 후보에서 뺍니다).
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr>
              <th>배변 국내 정배배당</th><th>경기수</th><th>핸승</th><th>핸무</th>
              <th>무</th><th>역</th><th>적중</th><th>당첨</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>~1.35</td><td>6,191</td><td>52.46%</td><td>23.81%</td><td>15.36%</td><td>8.37%</td><td>23.73%</td><td>47.54%</td></tr>
            <tr><td>1.35~1.60</td><td>6,585</td><td>34.55%</td><td>25.80%</td><td>23.51%</td><td>16.14%</td><td>39.65%</td><td>65.45%</td></tr>
            <tr><td>1.60~1.90</td><td>8,102</td><td>26.20%</td><td>24.55%</td><td>26.64%</td><td>22.61%</td><td>49.25%</td><td>73.80%</td></tr>
            <tr><td>1.90~2.10</td><td>5,170</td><td>21.26%</td><td>22.28%</td><td>29.19%</td><td>27.27%</td><td>56.46%</td><td>78.74%</td></tr>
            <tr><td>2.10~2.25</td><td>3,655</td><td>18.60%</td><td>21.15%</td><td>29.25%</td><td>31.00%</td><td>60.25%</td><td>81.40%</td></tr>
            <tr><td>2.25~2.45</td><td>2,871</td><td>15.99%</td><td>21.42%</td><td>30.72%</td><td>31.87%</td><td>62.59%</td><td>84.01%</td></tr>
            <tr><td>2.45~2.65</td><td>231</td><td>10.39%</td><td>20.78%</td><td>37.66%</td><td>31.17%</td><td>68.83%</td><td>89.61%</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          핸승은 52.46% → 10.39%로 42%p나 움직이는데, <b>핸무는 20.78~25.80%, 5%p 안에서만
          흔들립니다</b>(6대리그 36,033경기 전수).
        </p>

        <p className="help-legend-title">② 강추·초강추가 떠도 5경기 중 1경기는 보험입니다</p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr>
              <th>등급</th><th>경기수</th><th>미적(핸승)</th><th>보험(핸무)</th>
              <th>무</th><th>역</th><th>적중</th><th>당첨</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>초강추·국≠해</td><td>843</td><td>14.59%</td><td>18.98%</td><td>30.37%</td><td>36.06%</td><td>66.43%</td><td>85.41%</td></tr>
            <tr><td>초강추·통합</td><td>781</td><td>14.21%</td><td>22.02%</td><td>31.24%</td><td>32.52%</td><td>63.76%</td><td>85.79%</td></tr>
            <tr><td>강추·해배</td><td>1,097</td><td>15.04%</td><td>19.05%</td><td>31.45%</td><td>34.46%</td><td>65.91%</td><td>84.96%</td></tr>
            <tr><td>강추·반전</td><td>264</td><td>12.88%</td><td>18.18%</td><td>32.20%</td><td>36.74%</td><td>68.94%</td><td>87.12%</td></tr>
            <tr><td><b>4등급 합</b></td><td><b>2,985</b></td><td><b>14.51%</b></td><td><b>19.73%</b></td><td><b>31.16%</b></td><td><b>34.61%</b></td><td><b>65.76%</b></td><td><b>85.49%</b></td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          가장 등급이 높은 초강추·국≠해도 <b>보험 확률이 18.98%</b>입니다. &quot;당첨&quot;(적중+보험)
          은 85%대로 높지만, 조합 수익을 결정하는 건 그중에서도 &quot;적중&quot;(65~69%)입니다.
        </p>

        <p className="help-legend-title">③ 조합을 짤 때 실제로 남는 확률</p>
        <p className="help-legend-note">
          강추 4등급 전체 평균(적중 65.76% · 당첨 85.49%)을 그대로 두 경기·세 경기로 곱하면
          이렇게 줄어듭니다(경기끼리 서로 무관하다고 가정한 계산입니다):
        </p>
        <table className="detail-table help-legend-table">
          <thead>
            <tr><th>조합</th><th>전부 적중(수익)</th><th>전부 당첨(적중+보험)</th><th>보험 1경기 이상 포함</th></tr>
          </thead>
          <tbody>
            <tr><td>1경기</td><td>65.76%</td><td>85.49%</td><td>—</td></tr>
            <tr><td>2경기 조합</td><td>43.25%</td><td>73.09%</td><td>26.91%</td></tr>
            <tr><td>3경기 조합</td><td>28.46%</td><td>62.48%</td><td>37.52%</td></tr>
          </tbody>
        </table>
        <p className="help-legend-note">
          강추끼리 묶은 2경기 조합이라도 <b>&quot;둘 다 적중&quot;은 절반이 안 됩니다(43.25%)</b>.
          어제처럼 한쪽이 보험(핸무)으로 끝나는 조합은 흔한 결과입니다.
        </p>

        <p className="help-legend-title">④ &quot;이 팀은 원래 핸무가 잘 나온다&quot;는 대부분 우연입니다</p>
        <p className="help-legend-note">
          ※ <b>상관계수(r)</b> — 두 값이 같이 움직이는 정도를 재는 숫자. 0이면 서로 아무 관계
          없음, 1에 가까울수록 강하게 같이 움직입니다. 0.02 정도면 사실상 무관계로 봅니다.
        </p>
        <p className="help-legend-note">
          상대전적에서 &apos;직전까지 핸무가 자주 나온 조합&apos;(40%+, 6대리그 1,393건)의
          다음 경기 핸무 비율은 <b>23.62%</b> — 전체 평균 <b>23.56%</b>와 사실상 같습니다
          (상관계수 r=+0.0165, 홈·원정 배치를 맞춰 다시 봐도 r=+0.0151). 특정 두 팀이
          &apos;핸무 잘 나오는 궁합&apos;처럼 보이는 건 조합 수가 수천 개라 우연히 하나쯤
          나오는 것이지, 다음 경기를 미리 알려주는 신호가 아닙니다.
        </p>

        <p className="help-legend-title">정리</p>
        <p className="help-legend-note">
          강추·초강추는 <b>&quot;핸승은 아니다&quot;</b>까지만 말해줍니다. 그 뒤 무·역·핸무 중
          무엇이 나올지, 그리고 핸무(보험)로 끝날지 무·역(적중)으로 끝날지는 이 시스템이
          가르지 못하는 영역입니다 — 조합을 짤 때 이 사실을 감안해서 베팅 비중을
          정하시기 바랍니다.
        </p>
      </div>
    </div>
  )
}
