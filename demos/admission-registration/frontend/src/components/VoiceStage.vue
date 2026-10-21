<template>
  <section
    class="voice-stage"
    :class="{
      'voice-stage--single': !showSelfMode,
      'voice-stage--home': showSelfMode,
    }"
  >
    <div v-if="!showSelfMode && showFeedback" class="voice-main">
      <div v-if="transcript" class="transcript-bubble">
        {{ maskText(transcript) }}
      </div>
      <div
        v-if="transcript && (aiThinking || aiNotice)"
        class="transcript-status"
      >
        {{ aiThinking ? "正在理解您的需求…" : aiNotice }}
      </div>
      <p v-if="voiceError" class="voice-error" role="alert">{{ voiceError }}</p>
    </div>
    <form
      v-if="textMode"
      class="voice-pill voice-pill--text"
      @submit.prevent="sendText"
    >
      <button
        class="voice-pill__mode"
        type="button"
        aria-label="切换语音输入"
        title="切换语音输入"
        :disabled="disabled || recording || recognizing"
        @click="$emit('voice-input')"
      >
        <i class="el-icon-refresh" aria-hidden="true"></i>
      </button>
      <input
        v-model="draft"
        class="voice-pill__input"
        type="text"
        maxlength="500"
        :placeholder="
          voiceDraft ? '请核对语音识别内容，可修改后发送' : '发送消息…'
        "
        :disabled="disabled"
        aria-label="发送消息"
      />
      <button
        class="voice-pill__send"
        type="submit"
        :disabled="disabled || !draft.trim()"
      >
        发送
      </button>
    </form>
    <div
      v-else
      class="voice-pill voice-pill--mic"
      :class="{ 'voice-pill--recording': recording }"
    >
      <div class="voice-pill__status">
        <p
          class="voice-pill__hint"
          :class="{ 'voice-state': recording || recognizing }"
          aria-live="polite"
        >
          {{ recording || recognizing ? stateText : "按住说话，松开后发送" }}
        </p>
      </div>
      <p v-if="voiceError" class="voice-error voice-pill__error" role="alert">
        {{ voiceError }}
      </p>
      <button
        class="mic-button voice-pill__hold"
        :class="{ recording }"
        type="button"
        :disabled="disabled || recognizing"
        :aria-label="recording ? '松开发送' : '按住说话'"
        @pointerdown="onHoldDown"
        @contextmenu.prevent
      >
        <i
          v-if="!recording || recognizing"
          class="el-icon-microphone"
          aria-hidden="true"
        ></i>
        <VoiceWaveform
          v-else
          :sound-detected="soundDetected"
          :volume-level="volumeLevel"
        />
      </button>
      <button
        v-if="showManualEntry"
        class="manual-entry-button voice-pill__manual"
        type="button"
        :disabled="disabled || recording || recognizing"
        aria-label="切换文字输入"
        title="切换文字输入"
        @click="$emit('manual-input')"
      >
        <i class="el-icon-refresh" aria-hidden="true"></i>
      </button>
    </div>
  </section>
</template>

<script>
import { maskText } from "../utils/mask.js";
import VoiceWaveform from "./VoiceWaveform.vue";

export default {
  name: "VoiceStage",
  components: { VoiceWaveform },
  props: {
    disabled: { type: Boolean, default: false },
    showSelfMode: { type: Boolean, default: false },
    homeActivity: { type: Number, default: 0 },
    showFeedback: { type: Boolean, default: true },
    // 身份核验页只走刷卡，没有文字输入入口，故隐藏“切换文字输入”
    showManualEntry: { type: Boolean, default: true },
    textMode: { type: Boolean, default: false },
    voiceDraft: { type: String, default: "" },
    transcript: { type: String, default: "" },
    aiThinking: { type: Boolean, default: false },
    aiNotice: { type: String, default: "" },
    voiceError: { type: String, default: "" },
    recording: { type: Boolean, default: false },
    recognizing: { type: Boolean, default: false },
    soundDetected: { type: Boolean, default: false },
    silenceCountdown: { type: Number, default: null },
    volumeLevel: { type: Number, default: 0 },
  },
  data() {
    return {
      draft: this.voiceDraft,
      countdownRemaining: 380,
      countdownTimer: null,
    };
  },
  watch: {
    voiceDraft(value) {
      if (value) this.draft = value;
    },
    showSelfMode: {
      immediate: true,
      handler() {
        clearInterval(this.countdownTimer);
        this.countdownRemaining = 380;
        this.$emit("countdown-change", this.countdownRemaining);
      },
    },
    homeActivity() {
      if (!this.showSelfMode) return;
      clearInterval(this.countdownTimer);
      this.countdownRemaining = 380;
      this.$emit("countdown-change", this.countdownRemaining);
      const deadline = Date.now() + 380000;
      this.countdownTimer = setInterval(() => {
        this.countdownRemaining = Math.max(
          0,
          Math.ceil((deadline - Date.now()) / 1000),
        );
        this.$emit("countdown-change", this.countdownRemaining);
        if (this.countdownRemaining === 0) clearInterval(this.countdownTimer);
      }, 1000);
    },
  },
  beforeDestroy() {
    clearInterval(this.countdownTimer);
  },
  computed: {
    stateText() {
      if (this.recognizing) return "正在识别语音…";
      if (this.silenceCountdown !== null)
        return `静音倒计时 ${this.silenceCountdown} 秒，继续说话会重新计时`;
      if (this.soundDetected) return "检测到声音，停顿 3 秒后自动结束";
      return "正在听，等待您说话";
    },
  },
  methods: {
    maskText,
    onHoldDown(event) {
      this.$emit("hold-start", event);
    },
    sendText() {
      const text = this.draft.trim();
      if (!text || this.disabled) return;
      this.$emit("send", text);
      this.draft = "";
    },
  },
};
</script>
