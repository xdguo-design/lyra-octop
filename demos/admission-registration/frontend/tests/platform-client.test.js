import { afterEach, describe, expect, it, vi } from 'vitest'
import { platformJson, platformUpload } from '../src/api/platform.js'

afterEach(() => vi.unstubAllGlobals())

describe('platform request errors', () => {
  it.each([401, 429, 503])('preserves HTTP %s and its structured code', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: { code: 'AI_RATE_LIMITED', message: '请稍后重试' } }),
            { status }
          )
        )
    )
    await expect(platformJson('/admission-demo/intent')).rejects.toMatchObject({
      status,
      body: { detail: { code: 'AI_RATE_LIMITED' } },
    })
  })

  it('retains the status when an upstream returns HTML instead of JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<h1>Unavailable</h1>', { status: 503 }))
    )
    await expect(platformJson('/admission-demo/intent')).rejects.toMatchObject({ status: 503 })
  })

  it('preserves voice upload errors without losing the original status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(platformUpload('/voice/stt', new FormData())).rejects.toMatchObject({
      status: 401,
    })
  })
})
