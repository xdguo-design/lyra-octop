// 浏览器麦克风录音封装：挑选可用编码、收集分片、限制单次时长。
// 语音识别与业务处理由 onComplete 的调用方负责，本类只产出音频 Blob。
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export class VoiceRecorder {
  constructor({ maxDuration = 60000, onComplete, onError, onLevel } = {}) {
    this.maxDuration = maxDuration
    this.onComplete = onComplete
    this.onError = onError
    this.onLevel = onLevel
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.limitTimer = null
    this.limitHit = false
    this.audioContext = null
    this.analyser = null
    this.source = null
    this.levelBuffer = null
    this.animationFrame = null
    this.soundFrames = 0
    this.soundDetected = false
    this.handleStop = () => this.finish()
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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

  measureLevel() {
    this.analyser.getFloatTimeDomainData(this.levelBuffer)
    let squaredTotal = 0
    for (const sample of this.levelBuffer) squaredTotal += sample * sample
    const rms = Math.sqrt(squaredTotal / this.levelBuffer.length)
    if (rms >= 0.018) this.soundFrames += 1
    else if (rms < 0.012) this.soundFrames = 0
    if (this.soundFrames >= 3) this.soundDetected = true
    if (rms < 0.012) this.soundDetected = false
    this.onLevel?.({ level: Math.min(1, rms * 10), soundDetected: this.soundDetected })
    this.animationFrame = requestAnimationFrame(() => this.measureLevel())
  }

  stop() {
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
