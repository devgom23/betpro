// 백엔드(FastAPI) 호출 공용 함수.
// vite.config.js의 프록시 설정 덕분에 '/api/...'로만 호출하면 8000번 서버로 연결된다.

const TOKEN_KEY = 'betpro_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token, persist) {
  // persist(로그인 유지 체크) true면 브라우저를 꺼도 유지되는 localStorage에,
  // false면 이 탭을 닫으면 사라지는 sessionStorage에 저장한다.
  clearToken()
  if (!token) return
  ;(persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    let detail = `요청 실패 (HTTP ${res.status})`
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch {
      // JSON 아닌 응답이면 기본 메시지 사용
    }
    throw new ApiError(detail, res.status)
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
}
