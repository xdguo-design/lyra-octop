import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceRecorder } from '../src/utils/voiceRecorder.js'

describe('VoiceRecorder sound meter', () => {
  let track
  let analyser
  let audioContext
  let frames
  let MediaRecorderMock

  beforeEach(() => {
    track = { stop: vi.fn() }
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }),
      },
    })
    frames = new Map()
    let nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id))
    analyser = {
      fftSize: 0,
      getFloatTimeDomainData: vi.fn((values) => values.fill(0.04)),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    audioContext = {
      createAnalyser: vi.fn(() => analyser),
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      close: vi.fn(),
    }
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => audioContext)
    )
    MediaRecorderMock = vi.fn().mockImplementation(() => ({
      state: 'inactive',
      mimeType: 'audio/webm',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      start() {
        this.state = 'recording'
      },
      stop() {
        this.state = 'inactive'
      },
    }))
    MediaRecorderMock.isTypeSupported = () => true
    vi.stubGlobal('MediaRecorder', MediaRecorderMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports real RMS as speech and releases microphone and analyser resources on cleanup', async () => {
    const onLevel = vi.fn()
    const recorder = new VoiceRecorder({ onLevel })
    await recorder.start()

    expect(frames.size).toBeGreaterThan(0)
    for (let index = 0; index < 2; index += 1) {
      const [frameId, tick] = [...frames.entries()][0]
      frames.delete(frameId)
      tick()
    }

    expect(onLevel).toHaveBeenCalledWith(expect.objectContaining({ soundDetected: true }))
    expect(onLevel.mock.calls[0][0].level).toBeGreaterThan(0.03)
    expect(frames.size).toBe(1)

    recorder.cleanup()

    expect(track.stop).toHaveBeenCalledOnce()
    expect(analyser.disconnect).toHaveBeenCalledOnce()
    expect(audioContext.close).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('keeps digital silence below the speech threshold', async () => {
    analyser.getFloatTimeDomainData.mockImplementation((values) => values.fill(0))
    const onLevel = vi.fn()
    const recorder = new VoiceRecorder({ onLevel })
    await recorder.start()

    expect(frames.size).toBeGreaterThan(0)
    const [frameId, tick] = [...frames.entries()][0]
    frames.delete(frameId)
    tick()

    expect(onLevel).toHaveBeenCalledWith({ level: 0, soundDetected: false })
    recorder.cleanup()
  })
})
