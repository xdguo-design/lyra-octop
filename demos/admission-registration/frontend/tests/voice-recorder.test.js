import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VoiceRecorder,
  MIC_UNSUPPORTED_MESSAGE,
  canUseMicrophone,
} from '../src/utils/voiceRecorder.js'

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

    expect(onLevel).toHaveBeenCalledWith({ level: 0, soundDetected: false, silenceCountdown: null })
    recorder.cleanup()
  })

  it('counts down three seconds of silence and restarts the countdown when speech resumes', async () => {
    const onSilenceStop = vi.fn()
    const onLevel = vi.fn()
    const recorder = new VoiceRecorder({ silenceDuration: 3000, onSilenceStop, onLevel })
    await recorder.start()
    const recorderStop = vi.spyOn(recorder.recorder, 'stop')

    const tickAt = (time) => {
      const [frameId, tick] = [...frames.entries()][0]
      frames.delete(frameId)
      tick(time)
    }

    tickAt(0)
    tickAt(16)
    tickAt(32)
    expect(recorder.soundDetected).toBe(true)

    analyser.getFloatTimeDomainData.mockImplementation((values) => values.fill(0))
    tickAt(500)
    tickAt(1500)
    expect(recorderStop).not.toHaveBeenCalled()
    expect(onSilenceStop).not.toHaveBeenCalled()
    expect(onLevel.mock.calls.at(-1)[0].silenceCountdown).toBe(2)

    analyser.getFloatTimeDomainData.mockImplementation((values) => values.fill(0.04))
    tickAt(2000)
    expect(onLevel.mock.calls.at(-1)[0].silenceCountdown).toBeNull()
    tickAt(2016)
    tickAt(2032)
    expect(recorder.soundDetected).toBe(true)

    analyser.getFloatTimeDomainData.mockImplementation((values) => values.fill(0))
    tickAt(2500)
    tickAt(4000)
    expect(onLevel.mock.calls.at(-1)[0].silenceCountdown).toBe(2)
    tickAt(5000)
    expect(onLevel.mock.calls.at(-1)[0].silenceCountdown).toBe(1)
    expect(recorderStop).not.toHaveBeenCalled()
    tickAt(5032)
    expect(recorderStop).toHaveBeenCalledOnce()
    expect(onSilenceStop).toHaveBeenCalledOnce()
    // 自动结束后不再继续轮询电平，避免重复结束。
    expect(frames.size).toBe(0)
  })

  it('keeps listening while the user has not started speaking yet', async () => {
    analyser.getFloatTimeDomainData.mockImplementation((values) => values.fill(0))
    const onSilenceStop = vi.fn()
    const recorder = new VoiceRecorder({ silenceDuration: 3000, onSilenceStop })
    await recorder.start()

    const tickAt = (time) => {
      const [frameId, tick] = [...frames.entries()][0]
      frames.delete(frameId)
      tick(time)
    }
    tickAt(0)
    tickAt(10000)
    tickAt(30000)

    expect(onSilenceStop).not.toHaveBeenCalled()
    recorder.cleanup()
  })
})

describe('VoiceRecorder microphone availability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a readable error instead of touching navigator.mediaDevices when it is missing', async () => {
    // 不安全上下文（http://192.168.x.x:8200）下浏览器不暴露 mediaDevices。
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('MediaRecorder', class {})

    expect(canUseMicrophone()).toBe(false)
    const recorder = new VoiceRecorder({})
    await expect(recorder.start()).rejects.toThrow(MIC_UNSUPPORTED_MESSAGE)
  })

  it('translates a denied permission into an actionable message', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(denied) },
    })
    vi.stubGlobal('MediaRecorder', class {})

    const recorder = new VoiceRecorder({})
    await expect(recorder.start()).rejects.toThrow(/麦克风权限被拒绝/)
  })
})
