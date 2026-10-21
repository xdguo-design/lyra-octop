<template>
  <div
    v-if="visible"
    class="conversation-dialog-backdrop"
    :class="{ 'conversation-dialog-backdrop--inline': inline }"
  >
    <aside
      class="conversation-dialog conversation-dialog--font-medium"
      :class="{ 'conversation-dialog--inline': inline }"
      role="region"
      :aria-label="
        identity ? '身份核验对话' : home ? '手动和语音对话' : '智能登记对话'
      "
    >
      <header class="conversation-dialog__header">
        <button
          type="button"
          class="conversation-autoplay"
          :class="{ 'is-active': autoSpeakAssistant }"
          :aria-pressed="String(autoSpeakAssistant)"
          :aria-label="
            autoSpeakAssistant ? '关闭 AI 自动语音播报' : '开启 AI 自动语音播报'
          "
          @click="$emit('toggle-auto-speak')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9v6h4l5 4V5L7 9H3z" />
            <path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11" />
          </svg>
          <span>自动播报</span>
        </button>
        <button
          v-if="allowClose"
          type="button"
          aria-label="收起对话"
          @click="$emit('close')"
        >
          <i class="el-icon-close" aria-hidden="true"></i>
        </button>
      </header>
      <div
        ref="messages"
        class="conversation-dialog__messages"
        aria-live="polite"
      >
        <ConversationMessage
          v-if="!messages.length"
          :message="{
            role: 'assistant',
            text: identity
              ? identityPrompt
              : home
              ? '您好，请告诉我您需要办理什么。'
              : question,
          }"
          :field-keywords="fieldKeywords"
          :required-progress="requiredProgress"
          :disabled="voiceActive"
          @speak="$emit('speak-message', $event)"
        />
        <ConversationMessage
          v-for="(message, index) in messages"
          :key="index"
          :message="message"
          :field-keywords="fieldKeywords"
          :required-progress="requiredProgress"
          :disabled="voiceActive"
          @speak="$emit('speak-message', $event)"
        />
        <section
          v-for="section in reviewSummary"
          :key="section.title"
          class="conversation-review-summary"
          :aria-label="section.title"
        >
          <strong class="conversation-review-summary__title">{{
            section.title
          }}</strong>
          <div
            v-for="field in section.fields"
            :key="field.label"
            class="conversation-review-summary__field"
          >
            <span>{{ field.label }}</span>
            <strong>{{ maskText(field.value) || "未填写" }}</strong>
          </div>
        </section>
        <p
          v-if="transcript && !transcriptInMessages"
          class="conversation-message conversation-message--patient"
        >
          {{ maskText(transcript) }}
        </p>
        <section
          v-if="followUp || (!home && choices.length)"
          :class="{ 'conversation-follow-up': followUp }"
          :aria-label="followUp ? '登记信息补充' : '登记选项'"
        >
          <template v-if="followUp">
            <header class="conversation-follow-up__header">
              <strong>{{ followUp.title }}</strong>
              <span
                >必填信息 {{ followUp.completed }}/{{ followUp.total }}</span
              >
            </header>
            <div
              class="conversation-follow-up__progress"
              role="progressbar"
              aria-label="必填信息填写进度"
              :aria-valuemin="0"
              :aria-valuemax="followUp.total"
              :aria-valuenow="followUp.completed"
            >
              <span
                :style="{
                  width: `${(followUp.completed / followUp.total) * 100}%`,
                }"
              ></span>
            </div>
            <p
              v-if="followUp.missing.length"
              class="conversation-follow-up__missing"
            >
              仍需补充：{{ followUp.missing.join("、") }}
            </p>
            <p class="conversation-follow-up__question">
              {{ followUp.question }}
            </p>
          </template>
          <div
            v-if="!home && choices.length"
            class="conversation-dialog__choices"
            role="group"
            aria-label="请选择一项"
          >
            <button
              v-for="choice in choices"
              :key="choice"
              type="button"
              :disabled="
                thinking || recording || recognizing || startingVoice || saving
              "
              @click="$emit('select-option', choice)"
            >
              {{ choice }}
            </button>
          </div>
          <p v-if="followUp" class="conversation-follow-up__hint">
            可直接语音回答，也可以一次提供多项信息。
          </p>
        </section>
        <p v-if="thinking" class="conversation-dialog__status">
          {{ home ? "正在解读您的需求…" : "正在理解并核对本轮信息…" }}
        </p>
        <p v-if="voiceError" class="conversation-dialog__error" role="alert">
          {{ voiceError }}
        </p>
        <p
          v-if="aiNotice && !noticeInMessages"
          class="conversation-dialog__status"
          role="status"
        >
          {{ aiNotice }}
        </p>
        <el-button
          v-if="applicationConfirmation"
          class="conversation-dialog__application-confirm"
          type="primary"
          aria-label="确定申请单并继续"
          :disabled="applicationSelecting"
          :loading="applicationSelecting"
          @click="$emit('confirm-application')"
        >
          {{ applicationSelecting ? "正在确认申请单…" : "确定申请单并继续" }}
        </el-button>
      </div>
      <div
        v-if="voiceActive"
        class="conversation-dialog__recording-feedback"
        role="status"
      >
        <i
          :class="
            recording && !recognizing ? 'el-icon-microphone' : 'el-icon-loading'
          "
          aria-hidden="true"
        ></i>
        <div class="conversation-dialog__recording-center">
          <VoiceWaveform
            v-if="recording && !recognizing"
            :sound-detected="soundDetected"
            :silence-countdown="silenceCountdown"
            :volume-level="volumeLevel"
          />
          <span>{{ recordingStateText }}</span>
        </div>
        <button
          v-if="recording && !recognizing"
          class="conversation-dialog__stop-recording"
          type="button"
          @click="$emit('toggle-record')"
        >
          <i class="el-icon-video-pause" aria-hidden="true"></i> 结束录音
        </button>
      </div>
      <div v-if="canSubmit" class="conversation-dialog__submit">
        <el-button
          type="primary"
          aria-label="确认并提交入院登记"
          :disabled="
            saving || thinking || recording || recognizing || startingVoice
          "
          :loading="saving"
          @click="$emit('submit-registration')"
        >
          确认并提交入院登记
        </el-button>
      </div>
    </aside>
  </div>
</template>

<script>
import { maskText } from "../utils/mask.js";
import VoiceWaveform from "./VoiceWaveform.vue";
import ConversationMessage from "./ConversationMessage.vue";

export default {
  name: "ConversationDialog",
  components: { ConversationMessage, VoiceWaveform },
  props: {
    home: { type: Boolean, default: false },
    inline: { type: Boolean, default: false },
    allowClose: { type: Boolean, default: true },
    identity: { type: Boolean, default: false },
    identityPrompt: { type: String, default: "" },
    visible: { type: Boolean, default: false },
    applicationConfirmation: { type: Boolean, default: false },
    applicationSelecting: { type: Boolean, default: false },
    question: { type: String, default: "" },
    followUp: { type: Object, default: null },
    requiredProgress: {
      type: Object,
      default: () => ({ completed: 0, total: 0 }),
    },
    choices: { type: Array, default: () => [] },
    messages: { type: Array, default: () => [] },
    reviewSummary: { type: Array, default: () => [] },
    fieldKeywords: { type: Array, default: () => [] },
    autoSpeakAssistant: { type: Boolean, default: false },
    thinking: { type: Boolean, default: false },
    recording: { type: Boolean, default: false },
    recognizing: { type: Boolean, default: false },
    startingVoice: { type: Boolean, default: false },
    soundDetected: { type: Boolean, default: false },
    silenceCountdown: { type: Number, default: null },
    volumeLevel: { type: Number, default: 0 },
    saving: { type: Boolean, default: false },
    canSubmit: { type: Boolean, default: false },
    transcript: { type: String, default: "" },
    aiNotice: { type: String, default: "" },
    voiceError: { type: String, default: "" },
  },
  computed: {
    voiceActive() {
      return this.recording || this.recognizing || this.startingVoice;
    },
    recordingStateText() {
      if (this.recognizing) return "录音已结束，正在识别语音…";
      if (this.startingVoice && !this.recording) return "正在打开麦克风…";
      if (this.silenceCountdown !== null)
        return `静音倒计时 ${this.silenceCountdown} 秒，继续说话会重新计时`;
      return this.soundDetected
        ? "正在录音 · 已检测到声音，停顿 3 秒后自动结束"
        : "正在录音 · 等待声音输入";
    },
    lastPatientMessageIndex() {
      for (let index = this.messages.length - 1; index >= 0; index -= 1) {
        if (this.messages[index].role === "patient") return index;
      }
      return -1;
    },
    transcriptInMessages() {
      const index = this.lastPatientMessageIndex;
      return (
        index >= 0 &&
        this.messages[index].text === this.transcript &&
        (this.home ||
          this.messages
            .slice(index + 1)
            .some((message) => message.role === "assistant"))
      );
    },
    noticeInMessages() {
      return this.messages
        .slice(this.lastPatientMessageIndex + 1)
        .some(
          (message) =>
            message.role === "assistant" && message.text === this.aiNotice,
        );
    },
  },
  methods: {
    maskText,
  },
};
</script>
