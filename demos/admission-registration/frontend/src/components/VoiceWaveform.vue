<template>
  <div
    class="voice-waveform"
    :aria-label="soundDetected ? '正在收音' : '正在听，等待您说话'"
    role="img"
  >
    <span
      v-for="(height, index) in bars"
      :key="index"
      class="voice-waveform__bar"
      :style="{ height: height + 'px' }"
    ></span>
  </div>
</template>

<script>
export default {
  name: 'VoiceWaveform',
  props: {
    soundDetected: { type: Boolean, default: false },
    volumeLevel: { type: Number, default: 0 },
  },
  computed: {
    bars() {
      const profile = [
        0.06, 0.08, 0.12, 0.22, 0.3, 0.45, 0.6, 0.72, 0.86, 0.68, 0.9, 1, 1, 0.9, 0.68, 0.86, 0.72,
        0.6, 0.45, 0.3, 0.22, 0.12, 0.08, 0.06,
      ]
      const level = this.soundDetected ? Math.max(0, Math.min(this.volumeLevel, 1)) : 0.08
      return profile.map((height) => Math.round(3 + height * level * 42))
    },
  },
}
</script>
