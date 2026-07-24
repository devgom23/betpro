import { useEffect, useState } from 'react'
import { api, apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function AdminAccountsPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 계정 추가
  const [newId, setNewId] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newExpiry, setNewExpiry] = useState('permanent')
  const [newRole, setNewRole] = useState('user')
  const [busyAdd, setBusyAdd] = useState(false)

  // 계정 수정
  const [target, setTarget] = useState('')
  const [targetExpiry, setTargetExpiry] = useState('permanent')
  const [targetPw, setTargetPw] = useState('')
  const [delConfirm, setDelConfirm] = useState(false)
  const [busyExpiry, setBusyExpiry] = useState(false)
  const [busyPw, setBusyPw] = useState(false)
  const [busyDel, setBusyDel] = useState(false)

  // 고객 데이터 열람
  const [customers, setCustomers] = useState([])
  const [viewUser, setViewUser] = useState('')
  const [viewLeagues, setViewLeagues] = useState([])
  const [viewLeague, setViewLeague] = useState('')
  const [viewData, setViewData] = useState(null)
  const [busyView, setBusyView] = useState(false)

  const [accessLog, setAccessLog] = useState([])

  function loadUsers() {
    api
      .get('/api/admin/users')
      .then((res) => {
        setUsers(res.users)
        if (res.users.length && !target) setTarget(res.users[0].username)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    loadUsers()
    api.get('/api/admin/customer_data').then((res) => setCustomers(res.customers)).catch(() => {})
    api.get('/api/admin/access_log').then((res) => setAccessLog(res.logs)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!viewUser) {
      setViewLeagues([])
      return
    }
    api
      .get(`/api/admin/customer_data/${encodeURIComponent(viewUser)}/leagues`)
      .then((res) => {
        setViewLeagues(res.leagues)
        setViewLeague(res.leagues[0]?.code ?? '')
      })
      .catch(() => setViewLeagues([]))
  }, [viewUser])

  async function handleAddUser(e) {
    e.preventDefault()
    setBusyAdd(true)
    setNotice('')
    try {
      const res = await api.post('/api/admin/users', {
        username: newId,
        password: newPw,
        expiry: newExpiry,
        role: newRole,
      })
      setNotice(res.warning ? `${res.msg} (${res.warning})` : res.msg)
      setNewId('')
      setNewPw('')
      setNewExpiry('permanent')
      setNewRole('user')
      loadUsers()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyAdd(false)
    }
  }

  async function handleExpiry() {
    setBusyExpiry(true)
    setNotice('')
    try {
      const res = await api.post(`/api/admin/users/${encodeURIComponent(target)}/expiry`, {
        expiry: targetExpiry,
      })
      setNotice(res.msg)
      loadUsers()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyExpiry(false)
    }
  }

  async function handlePassword() {
    setBusyPw(true)
    setNotice('')
    try {
      const res = await api.post(`/api/admin/users/${encodeURIComponent(target)}/password`, {
        password: targetPw,
      })
      setNotice(res.msg)
      setTargetPw('')
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyPw(false)
    }
  }

  async function handleDelete() {
    if (!delConfirm) {
      setNotice('확인 체크박스를 선택하세요.')
      return
    }
    setBusyDel(true)
    setNotice('')
    try {
      const res = await apiFetch(
        `/api/admin/users/${encodeURIComponent(target)}?confirm=true`,
        { method: 'DELETE' }
      )
      setNotice(res.msg)
      setDelConfirm(false)
      setTarget('')
      loadUsers()
    } catch (err) {
      setNotice(`실패: ${err.message}`)
    } finally {
      setBusyDel(false)
    }
  }

  async function handleViewData() {
    setBusyView(true)
    setViewData(null)
    try {
      const res = await api.get(
        `/api/admin/customer_data/${encodeURIComponent(viewUser)}/${viewLeague}`
      )
      setViewData(res)
      api.get('/api/admin/access_log').then((r) => setAccessLog(r.logs)).catch(() => {})
    } catch (err) {
      setNotice(`열람 실패: ${err.message}`)
    } finally {
      setBusyView(false)
    }
  }

  if (error) return <p className="error-text">{error}</p>
  if (!users) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <h2 className="section-title">👑 계정 관리</h2>

      <table className="dashboard-table" style={{ maxWidth: 720, marginBottom: 8 }}>
        <thead>
          <tr>
            <th>아이디</th>
            <th>역할</th>
            <th>만료일</th>
            <th>생성일</th>
            <th>메모</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{u.role}</td>
              <td>{u.expiry}</td>
              <td>{u.created_dt}</td>
              <td>{u.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {notice && <p className="recompute-notice">{notice}</p>}

      <hr className="admin-divider" />
      <h3 className="admin-subheader">➕ 계정 추가</h3>
      <form className="admin-row" onSubmit={handleAddUser}>
        <input placeholder="아이디" value={newId} onChange={(e) => setNewId(e.target.value)} required />
        <input
          type="password"
          placeholder="비밀번호"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          required
        />
        <input
          placeholder="만료일 (YYYY-MM-DD 또는 permanent)"
          value={newExpiry}
          onChange={(e) => setNewExpiry(e.target.value)}
        />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="btn-primary" disabled={busyAdd}>
          {busyAdd ? '생성 중...' : '계정 생성'}
        </button>
      </form>
      <p className="admin-caption">
        아이디는 개인 데이터 폴더명으로 쓰입니다. 영문/숫자/언더스코어/하이픈 3~32자만 가능합니다.
      </p>

      <hr className="admin-divider" />
      <h3 className="admin-subheader">🔧 계정 수정</h3>
      <div className="admin-row">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {users.map((u) => (
            <option key={u.username} value={u.username}>
              {u.username}
            </option>
          ))}
        </select>
        <input
          placeholder="새 만료일"
          value={targetExpiry}
          onChange={(e) => setTargetExpiry(e.target.value)}
        />
        <button className="btn-primary" disabled={busyExpiry} onClick={handleExpiry}>
          기간 변경
        </button>
        <input
          type="password"
          placeholder="새 비밀번호"
          value={targetPw}
          onChange={(e) => setTargetPw(e.target.value)}
        />
        <button className="btn-primary" disabled={busyPw || !targetPw} onClick={handlePassword}>
          비밀번호 변경
        </button>
      </div>

      <h4 className="admin-subheader-sm">🗑️ 계정 삭제</h4>
      <div className="admin-row">
        <label className="confirm-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={delConfirm} onChange={(e) => setDelConfirm(e.target.checked)} />
          '{target}' 계정과 개인 데이터 전체를 삭제합니다 (되돌릴 수 없음)
        </label>
        <button
          className="btn-danger"
          disabled={busyDel || target === user.username}
          onClick={handleDelete}
        >
          ❌ 삭제
        </button>
      </div>
      {target === user.username && (
        <p className="admin-caption">현재 로그인한 본인 계정은 삭제할 수 없습니다.</p>
      )}

      <hr className="admin-divider" />
      <h3 className="admin-subheader">🗂️ 고객 업로드 현황</h3>
      {customers.length ? (
        <table className="dashboard-table" style={{ maxWidth: 720, marginBottom: 12 }}>
          <thead>
            <tr>
              <th>아이디</th>
              <th>경기수</th>
              <th>리그</th>
              <th>예측로그</th>
              <th>최종수정</th>
              <th>크기(MB)</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.아이디}>
                <td>{c.아이디}</td>
                <td>{c.경기수.toLocaleString()}</td>
                <td>{c.리그}</td>
                <td>{c.예측로그}</td>
                <td>{c.최종수정}</td>
                <td>{c["크기(MB)"]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="admin-caption">업로드 데이터가 있는 고객 계정이 없습니다.</p>
      )}

      <h4 className="admin-subheader-sm">🔍 원본 열람</h4>
      <p className="admin-caption">
        고객이 업로드한 원본 데이터를 조회합니다. 열람 기록이 남습니다. 관리자는 열람만 가능하며
        수정·삭제할 수 없습니다.
      </p>
      <div className="admin-row">
        <select value={viewUser} onChange={(e) => setViewUser(e.target.value)}>
          <option value="">대상 계정 선택</option>
          {customers.map((c) => (
            <option key={c.아이디} value={c.아이디}>
              {c.아이디}
            </option>
          ))}
        </select>
        <select value={viewLeague} onChange={(e) => setViewLeague(e.target.value)} disabled={!viewLeagues.length}>
          {viewLeagues.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label} ({l.rows.toLocaleString()}건)
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={!viewUser || !viewLeague || busyView} onClick={handleViewData}>
          {busyView ? '불러오는 중...' : '🔍 열람'}
        </button>
      </div>

      {viewData && (
        <>
          <p className="admin-caption">
            '{viewUser}' / {viewLeague} - {viewData.total.toLocaleString()}건 (읽기 전용)
          </p>
          <div className="league-table-scroll" style={{ maxHeight: 400 }}>
            <table className="league-table">
              <thead>
                <tr>
                  {viewData.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewData.rows.map((r, i) => (
                  <tr key={i}>
                    {viewData.columns.map((c) => (
                      <td key={c}>{r[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <hr className="admin-divider" />
      <h3 className="admin-subheader">📜 열람 기록</h3>
      {accessLog.length ? (
        <table className="dashboard-table" style={{ maxWidth: 720 }}>
          <thead>
            <tr>
              <th>시각</th>
              <th>관리자</th>
              <th>대상</th>
              <th>리그</th>
              <th>동작</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            {accessLog.map((l, i) => (
              <tr key={i}>
                <td>{l.시각}</td>
                <td>{l.관리자}</td>
                <td>{l.대상}</td>
                <td>{l.리그}</td>
                <td>{l.동작}</td>
                <td>{l.건수}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="admin-caption">기록 없음</p>
      )}
    </div>
  )
}
