<template>
  <div
    v-if="visible"
    class="voice-hold-overlay"
    :class="{ 'voice-hold-overlay--cancel': cancel }"
    role="status"
    aria-live="polite"
  >
    <div class="voice-hold-overlay__panel">
      <div class="voice-hold-overlay__orb" aria-hidden="true">
        <i class="el-icon-microphone"></i>
      </div>
      <div class="voice-hold-overlay__wave" :class="{ 'voice-hold-overlay__wave--cancel': cancel }">
        <VoiceWaveform :sound-detected="soundDetected" :volume-level="volumeLevel" />
      </div>
      <p class="voice-hold-overlay__listening">{{ cancel ? '取消本次录音' : '正在倾听…' }}</p>
      <p
        class="voice-hold-overlay__primary"
        :class="{ 'voice-hold-overlay__primary--cancel': cancel }"
      >
        {{ cancel ? '松开取消' : '松开 发送' }}
      </p>
      <p class="voice-hold-overlay__secondary">
        {{ cancel ? '松开手指，取消本次录音' : '请按住说话，松开发送 · 上滑取消' }}
      </p>
    </div>
  </div>
</template>

<script>
import VoiceWaveform from './VoiceWaveform.vue'

// 按住说话时的全屏遮罩：只做状态展示，不拦截指针（手指仍停在麦克风上）。
export default {
  name: 'VoiceHoldOverlay',
  components: { VoiceWaveform },
  props: {
    visible: { type: Boolean, default: false },
    cancel: { type: Boolean, default: false },
    soundDetected: { type: Boolean, default: false },
    volumeLevel: { type: Number, default: 0 },
  },
}
</script>
