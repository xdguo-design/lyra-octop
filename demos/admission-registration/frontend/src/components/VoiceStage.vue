<template>
  <section
    class="voice-stage"
    :class="{ 'voice-stage--single': !showSelfMode, 'voice-stage--home': showSelfMode }"
  >
    <button v-if="showSelfMode" class="self-mode" type="button" @click="$emit('self-mode')">
      <i class="el-icon-thumb"></i>
      <span>自助模式</span>
    </button>
    <div class="voice-main">
      <div v-if="showFeedback && transcript" class="transcript-bubble">
        {{ maskText(transcript) }}
      </div>
      <div v-if="showFeedback && transcript && (aiThinking || aiNotice)" class="transcript-status">
        {{ aiThinking ? '正在理解您的需求…' : aiNotice }}
      </div>
      <p v-if="showFeedback && voiceError" class="voice-error" role="alert">{{ voiceError }}</p>
      <div class="voice-control-bar" :class="{ 'voice-control-bar--recording': recording }">
        <button
          class="mic-button"
          :class="{ recording }"
          :disabled="disabled || recognizing || startingVoice"
          :aria-label="recording ? '结束语音输入' : '开始语音输入'"
          @click="$emit('toggle-record')"
        >
          <i :class="recording ? 'el-icon-video-pause' : 'el-icon-microphone'"></i>
        </button>
        <div class="voice-control-center" aria-live="polite">
          <div
            v-if="recording && !recognizing"
            class="voice-waveform"
            :aria-label="waveformLabel"
            role="img"
          >
            <span
              v-for="(height, index) in waveformBars"
              :key="index"
              class="voice-waveform__bar"
              :style="{ height: height + 'px' }"
            ></span>
          </div>
          <span v-if="recording || recognizing" class="voice-state">{{ stateText }}</span>
          <span v-else class="voice-prompt">按住说话，松开发送</span>
        </div>
        <button
          class="manual-entry-button"
          type="button"
          :disabled="disabled"
          @click="$emit('manual-input')"
        >
          <i class="el-icon-edit-outline"></i>
          <span>手动输入</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script>
import { maskText } from '../utils/mask.js'

export default {
  name: 'VoiceStage',
  props: {
    disabled: { type: Boolean, default: false },
    showSelfMode: { type: Boolean, default: false },
    showFeedback: { type: Boolean, default: true },
    transcript: { type: String, default: '' },
    aiThinking: { type: Boolean, default: false },
    aiNotice: { type: String, default: '' },
    voiceError: { type: String, default: '' },
    recording: { type: Boolean, default: false },
    recognizing: { type: Boolean, default: false },
    startingVoice: { type: Boolean, default: false },
    soundDetected: { type: Boolean, default: false },
    volumeLevel: { type: Number, default: 0 },
  },
  computed: {
    waveformLabel() {
      return this.soundDetected ? '正在收音' : '正在听，等待您说话'
    },
    waveformBars() {
      const profile = [
        0.2, 0.35, 0.5, 0.28, 0.62, 0.4, 0.75, 0.46, 0.32, 0.58, 0.84, 0.42, 0.7, 0.3, 0.52, 0.78,
        0.44, 0.64, 0.34, 0.55, 0.76, 0.39, 0.6, 0.25,
      ]
      const level = this.soundDetected ? Math.max(0, Math.min(this.volumeLevel, 1)) : 0.08
      return profile.map((height) => Math.round(3 + height * level * 42))
    },
    stateText() {
      if (this.recognizing) return '正在识别语音…'
      return this.soundDetected ? '检测到声音，松开发送' : '正在听，等待您说话'
    },
  },
  methods: { maskText },
}
</script>
