// Octop 平台通用客户端：登录态读取/续期与平台级语音接口（ASR/TTS）。
// 与具体业务无关，可被任何挂在平台同源下的演示页面复用。
export function getToken() {
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || ''
}

export function authHeaders(headers = {}) {
  const token = getToken()
  return {
    'Accept-Language': 'zh',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  }
}

export function applyRenewedToken(response) {
  const renewed = response.headers.get('X-Octop-Access-Token')
  if (!renewed) return
  const sessionOnly = sessionStorage.getItem('auth_token') && !localStorage.getItem('auth_token')
  ;(sessionOnly ? sessionStorage : localStorage).setItem('auth_token', renewed)
}

async function requestError(response, fallback) {
  const body = await response.json().catch(() => ({}))
  const error = new Error(response.status === 401 ? '平台登录已失效，请重新登录' : fallback)
  error.status = response.status
  error.body = body
  return error
}

export async function platformJson(path, options = {}) {
  const headers = authHeaders({ Accept: 'application/json', ...(options.headers || {}) })
  const response = await fetch(`/api${path}`, { ...options, headers })
  applyRenewedToken(response)
  if (!response.ok) throw await requestError(response, '平台服务暂不可用')
  return response.json()
}

export function classifyAdmissionIntent(text, signal) {
  return platformJson('/admission-demo/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'home', text }),
    signal,
  })
}

export function classifyAdmissionCandidateConfirmation(
  text,
  fieldKey,
  currentValue,
  candidateValue,
  signal
) {
  return platformJson('/admission-demo/candidate-confirmation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      field_key: fieldKey,
      current_value: currentValue,
      candidate_value: candidateValue,
    }),
    signal,
  })
}

export async function platformUpload(path, form, signal) {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal,
  })
  applyRenewedToken(response)
  if (!response.ok) throw await requestError(response, '语音识别暂不可用')
  return response.json()
}

export async function platformTts(text, signal) {
  const headers = authHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch('/api/voice/tts', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
    signal,
  })
  applyRenewedToken(response)
  if (!response.ok) throw await requestError(response, '平台语音播报暂不可用')
  return URL.createObjectURL(await response.blob())
}
