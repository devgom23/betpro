import { useEffect, useState } from 'react'
import { api } from '../api/client'

export default function AdminMasterPage() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [selectedBackup, setSelectedBackup] = useState('')
  const [rollbackConfirm, setRollbackConfirm] = useState(false)
  const [busyBackup, setBusyBackup] = useState(false)
  const [busyRestore, setBusyRestore] = useState(false)

  const [delLeague, setDelLeague] = useState('EPL')
  const [delConfirm, setDelConfirm] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)

  const [leagues, setLeagues] = useState([])

  function load() {
    api
      .get('/api/admin/master/status')
      .then((res) => {
        setStatus(res)
        if (res.backups.length) setSelectedBackup(res.backups[0].name)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    load()
    api.get('/api/leagues').then(setLeagues).catch(() => setLeagues([]))
  }, [])

  async function doBackup() {
    setBusyBackup(true)
    setNotice('')
    try {
      const res = await api.post('/api/admin/master/backup', {})
      setNotice(`백업 완료: ${res.name}`)
      load()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyBackup(false)
    }
  }

  async function doRestore() {
    if (!rollbackConfirm) {
      setNotice('롤백 확인 체크박스를 선택하세요.')
      return
    }
    setBusyRestore(true)
    setNotice('')
    try {
      await api.post('/api/admin/master/restore', { name: selectedBackup, confirm: true })
      setNotice('롤백 완료. 화면을 새로고침하세요.')
      setRollbackConfirm(false)
      load()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyRestore(false)
    }
  }

  async function doDeleteLeague() {
    if (!delConfirm) {
      setNotice('확인 체크박스를 선택하세요.')
      return
    }
    setBusyDelete(true)
    setNotice('')
    try {
      await api.post('/api/admin/master/delete_league', { league: delLeague, confirm: true })
      setNotice(`${delLeague} 삭제 완료 (백업 생성됨)`)
      setDelConfirm(false)
      load()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyDelete(false)
    }
  }

  if (error) return <p className="error-text">{error}</p>
  if (!status) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <h2 className="section-title">🛠 마스터 데이터 관리</h2>
      <p className="admin-caption">공식 데이터(master.db)를 갱신합니다. 전 고객에게 즉시 반영됩니다.</p>

      <h3 className="admin-subheader">📊 현재 현황</h3>
      <table className="dashboard-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>리그</th>
            <th>경기수</th>
            <th>시즌</th>
            <th>결과보유</th>
            <th>예정</th>
            <th>국내배당</th>
          </tr>
        </thead>
        <tbody>
          {status.rows.map((row) => (
            <tr key={row.코드}>
              <td>{row.리그}</td>
              <td>{row.경기수.toLocaleString()}</td>
              <td>{row.시즌}</td>
              <td>{row.결과보유.toLocaleString()}</td>
              <td>{row.예정.toLocaleString()}</td>
              <td>{row.국내배당.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-caption">
        {status.file_path} · {status.size_mb} MB · 최종 갱신 {status.updated_at ?? '-'}
      </p>

      <hr className="admin-divider" />
      <h3 className="admin-subheader">💾 백업 / 롤백</h3>
      <div className="admin-row">
        {status.backups.length ? (
          <select value={selectedBackup} onChange={(e) => setSelectedBackup(e.target.value)}>
            {status.backups.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} ({b.size_mb} MB)
              </option>
            ))}
          </select>
        ) : (
          <span className="admin-caption">백업이 없습니다. 데이터 갱신 시 자동 생성됩니다.</span>
        )}
        <button className="btn-primary" disabled={busyBackup} onClick={doBackup}>
          {busyBackup ? '백업 중...' : '💾 지금 백업'}
        </button>
      </div>
      {status.backups.length > 0 && (
        <div className="admin-row" style={{ marginTop: 8 }}>
          <label className="confirm-check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={rollbackConfirm}
              onChange={(e) => setRollbackConfirm(e.target.checked)}
            />
            롤백 확인
          </label>
          <button className="btn-danger" disabled={busyRestore} onClick={doRestore}>
            {busyRestore ? '롤백 중...' : '↩️ 롤백'}
          </button>
        </div>
      )}

      <hr className="admin-divider" />
      <h3 className="admin-subheader">🗑️ 리그별 초기화</h3>
      <div className="admin-row">
        <select value={delLeague} onChange={(e) => setDelLeague(e.target.value)}>
          {leagues.map((lg) => (
            <option key={lg.code} value={lg.code}>
              {lg.label}
            </option>
          ))}
        </select>
        <label className="confirm-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={delConfirm} onChange={(e) => setDelConfirm(e.target.checked)} />
          '{leagues.find((l) => l.code === delLeague)?.label ?? delLeague}' 전체 삭제 (되돌릴 수 없음)
        </label>
        <button className="btn-danger" disabled={busyDelete} onClick={doDeleteLeague}>
          {busyDelete ? '삭제 중...' : '❌ 삭제'}
        </button>
      </div>

      {notice && <p className="recompute-notice">{notice}</p>}

      <hr className="admin-divider" />
      <p className="admin-caption">
        💡 마스터 데이터 업로드는 각 리그 탭에서 상단 📊 공식 데이터를 선택한 뒤 하단 업로드
        영역으로 진행하세요. 관리자에게만 해당 UI가 보입니다.
      </p>
    </div>
  )
}
