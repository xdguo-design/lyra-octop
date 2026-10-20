// 入院登记演示服务客户端：/api/admission-registration/v1 下的业务端点，
// 以及转发到平台现有入院提取接口的 AI 候选入口。平台侧通用能力在 platform.js。
import { applyRenewedToken, authHeaders } from './platform.js'

const apiRoot = '/api/admission-registration/v1'

async function request(path, options = {}) {
  const headers = authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) })
  const response = await fetch(`${apiRoot}${path}`, { ...options, headers })
  applyRenewedToken(response)
  const body = response.status === 204 ? null : await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(typeof body.detail === 'string' ? body.detail : '请求失败，请稍后重试')
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

export const admissionApi = {
  validate: (fields) => request('/validate', { method: 'POST', body: JSON.stringify({ fields }) }),
  verify: (method, mockScenario, signal) =>
    request('/identity/verify', {
      method: 'POST',
      body: JSON.stringify({ method, mockScenario }),
      signal,
    }),
  applications: (identityToken, signal) =>
    request(`/applications?identityToken=${encodeURIComponent(identityToken)}`, { signal }),
  selectApplication: (identityToken, applicationId, signal) =>
    request('/applications/select', {
      method: 'POST',
      body: JSON.stringify({ identityToken, applicationId }),
      signal,
    }),
  getSession: (sessionId, identityToken, signal) =>
    request(
      `/sessions/${encodeURIComponent(sessionId)}?identityToken=${encodeURIComponent(
        identityToken
      )}`,
      {
        signal,
      }
    ),
  saveTurn: (sessionId, payload, signal) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  confirmReview: (sessionId, payload, signal) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/review`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  submit: (payload, signal) =>
    request('/submissions', { method: 'POST', body: JSON.stringify(payload), signal }),
  result: (identityToken, idempotencyKey, signal) =>
    request('/submissions/result', {
      method: 'POST',
      body: JSON.stringify({ identityToken, idempotencyKey }),
      signal,
    }),
}

export async function extractCandidates(text, page, identityToken, sessionId, signal) {
  return request('/ai/candidates', {
    method: 'POST',
    body: JSON.stringify({ text, page, identityToken, sessionId }),
    signal,
  })
}
