// 浏览器麦克风录音封装：挑选可用编码、收集分片、限制单次时长。
// 语音识别与业务处理由 onComplete 的调用方负责，本类只产出音频 Blob。
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

// 浏览器只在安全上下文（HTTPS 或 127.0.0.1 / localhost）暴露 mediaDevices；
// 其它来源（局域网 IP、file://、被降级的页面）下 getUserMedia 直接不存在。
export const MIC_UNSUPPORTED_MESSAGE =
  '当前页面未开启麦克风接口（需 HTTPS 或 127.0.0.1/localhost 打开），无法录音，请改用「手动输入」。'

export function canUseMicrophone() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
}

// 把 DOMException 翻成可操作的中文，避免把原始 JS 错误抛到界面上。
export function describeMicrophoneError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试，或改用「手动输入」。'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '未检测到可用的麦克风设备，请改用「手动输入」。'
    case 'NotReadableError':
      return '麦克风正被其他程序占用，请关闭占用后重试。'
    default:
      return '无法使用麦克风，请检查设备权限，或改用「手动输入」。'
  }
}

export class VoiceRecorder {
  constructor({
    maxDuration = 60000,
    silenceDuration = 3000,
    onComplete,
    onError,
    onLevel,
    onSilenceStop,
  } = {}) {
    this.maxDuration = maxDuration
    // 说完后静音多久自动结束录音；0 表示关闭自动结束。
    this.silenceDuration = silenceDuration
    this.onComplete = onComplete
    this.onError = onError
    this.onLevel = onLevel
    this.onSilenceStop = onSilenceStop
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.limitTimer = null
    this.limitHit = false
    this.stopping = false
    this.audioContext = null
    this.analyser = null
    this.source = null
    this.levelBuffer = null
    this.animationFrame = null
    this.soundFrames = 0
    this.soundDetected = false
    this.heardSpeech = false
    this.lastSoundAt = 0
    this.silenceStopped = false
    this.handleStop = () => this.finish()
  }

  async start() {
    if (!canUseMicrophone()) throw new Error(MIC_UNSUPPORTED_MESSAGE)
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      throw new Error(describeMicrophoneError(error))
    }
    try {
      this.audioContext = new AudioContext()
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 1024
      this.levelBuffer = new Float32Array(this.analyser.fftSize)
      this.source = this.audioContext.createMediaStreamSource(this.stream)
      this.source.connect(this.analyser)
      this.measureLevel()

      const mimeType = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
      this.chunks = []
      this.recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) this.chunks.push(event.data)
      })
      this.recorder.addEventListener('stop', this.handleStop, { once: true })
      this.recorder.start()
      this.limitTimer = window.setTimeout(() => {
        this.limitHit = true
        this.stop()
      }, this.maxDuration)
    } catch (error) {
      this.cleanup()
      throw error
    }
  }

  measureLevel(timestamp) {
    this.analyser.getFloatTimeDomainData(this.levelBuffer)
    let squaredTotal = 0
    for (const sample of this.levelBuffer) squaredTotal += sample * sample
    const rms = Math.sqrt(squaredTotal / this.levelBuffer.length)
    const now = typeof timestamp === 'number' ? timestamp : performance.now()
    if (rms >= 0.018) this.soundFrames += 1
    else if (rms < 0.012) this.soundFrames = 0
    if (this.soundFrames >= 3) this.soundDetected = true
    if (rms < 0.012) this.soundDetected = false
    const speechEnergy = this.soundDetected || (this.heardSpeech && rms >= 0.018)
    if (speechEnergy) {
      // 只有真正说过话之后再判定静音，否则刚点开麦克风的安静环境会被立刻截断。
      if (this.soundDetected) this.heardSpeech = true
      this.lastSoundAt = now
    } else if (this.shouldStopForSilence(now)) {
      this.stopForSilence()
      return
    }
    const silenceCountdown =
      this.heardSpeech && !speechEnergy
        ? Math.max(1, Math.ceil((this.silenceDuration - (now - this.lastSoundAt)) / 1000))
        : null
    this.onLevel?.({
      level: Math.min(1, rms * 10),
      soundDetected: this.soundDetected,
      silenceCountdown,
    })
    this.animationFrame = requestAnimationFrame((time) => this.measureLevel(time))
  }

  shouldStopForSilence(now) {
    return (
      this.heardSpeech && this.silenceDuration > 0 && now - this.lastSoundAt >= this.silenceDuration
    )
  }

  // 用户说完后自动结束录音：先停掉电平轮询，再收尾并交给调用方切换界面状态。
  stopForSilence() {
    if (this.silenceStopped) return
    this.silenceStopped = true
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    this.stop()
    this.onSilenceStop?.()
  }

  stop() {
    if (this.stopping) return
    this.stopping = true
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
  }

  // 丢弃未完成的录音（重置/离开流程时），不触发 onComplete/onError。
  cleanup() {
    if (this.limitTimer) window.clearTimeout(this.limitTimer)
    this.limitTimer = null
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    this.source?.disconnect()
    this.source = null
    this.analyser?.disconnect()
    this.analyser = null
    this.levelBuffer = null
    if (this.audioContext && this.audioContext.state !== 'closed') {
      const closeResult = this.audioContext.close()
      closeResult?.catch?.(() => {})
    }
    this.audioContext = null
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop())
    this.stream = null
    if (this.recorder) {
      if (this.recorder.state !== 'inactive') {
        this.recorder.removeEventListener('stop', this.handleStop)
        this.recorder.stop()
      }
      this.recorder = null
    }
    this.chunks = []
  }

  finish() {
    const blob = new Blob(this.chunks, {
      type: this.recorder ? this.recorder.mimeType : 'audio/webm',
    })
    const limitHit = this.limitHit
    this.cleanup()
    if (!blob.size) this.onError?.(new Error('没有录到语音，请重试。'))
    else this.onComplete?.(blob, limitHit)
  }
}
