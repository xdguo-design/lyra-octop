// 登记会话读取走平台 API；AI 提取和对话保存走独立 Demo 后端，由它调用平台 Agent 推理。
import { applyRenewedToken, authHeaders } from './platform.js'

const apiRoot = '/api/admission-registration/v1'
const aiApiRoot = '/admission-registration-api/v1'
const regionsApiUrl = import.meta.env.VITE_REGIONS_API_URL

async function request(path, options = {}, root = apiRoot) {
  const headers = authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) })
  const response = await fetch(`${root}${path}`, { ...options, headers })
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

function asRegionOption(node) {
  // Element UI cascader treats an empty children array as "expandable" and
  // ignores the leaf flag, so only set children when the node actually has some.
  const option = { ...node, value: node.code || node.value }
  if (Array.isArray(node.children) && node.children.length) {
    option.children = node.children.map(asRegionOption)
  }
  return option
}

export const admissionApi = {
  regions: async (signal) => {
    let body
    if (regionsApiUrl) {
      const response = await fetch(regionsApiUrl, { signal })
      body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error('读取行政区划失败，请检查地区服务配置')
    } else {
      body = await request('/regions', { signal }, aiApiRoot)
    }
    if (!Array.isArray(body?.items) || !body.items.length) {
      throw new Error('行政区划数据为空，请检查地区服务配置')
    }
    return {
      ...body,
      items: (body.items || []).map(asRegionOption),
    }
  },
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
    request(
      `/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      },
      aiApiRoot
    ),
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

export async function extractCandidates(text, page, identityToken, sessionId, turnId, signal) {
  return request(
    '/ai/candidates',
    {
      method: 'POST',
      body: JSON.stringify({ text, page, identityToken, sessionId, turnId }),
      signal,
    },
    aiApiRoot
  )
}
