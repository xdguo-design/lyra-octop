<template>
  <div v-if="visible" class="conversation-dialog-backdrop" @click.self="$emit('close')">
    <aside
      class="conversation-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="home ? '手动和语音对话' : '智能登记对话'"
    >
      <header class="conversation-dialog__header">
        <div>
          <strong>{{ home ? '智能导诊对话' : '智能登记对话' }}</strong>
          <span>{{ home ? '描述您的需求，AI 将为您解读' : '本次登记内容仅用于当前办理' }}</span>
        </div>
        <button type="button" aria-label="收起对话" @click="$emit('close')">×</button>
      </header>
      <div class="conversation-dialog__messages" aria-live="polite">
        <p v-if="!messages.length" class="conversation-message conversation-message--assistant">
          {{ home ? '您好，请告诉我您需要办理什么。' : question }}
        </p>
        <template v-for="(message, index) in messages">
          <p
            :key="`${index}-${message.role}`"
            class="conversation-message"
            :class="`conversation-message--${message.role}`"
          >
            {{ maskText(message.text) }}
          </p>
        </template>
        <p
          v-if="transcript && !transcriptInMessages"
          class="conversation-message conversation-message--patient"
        >
          {{ maskText(transcript) }}
        </p>
        <p
          v-if="!home && messages.length && question && !questionInMessages"
          class="conversation-message conversation-message--assistant"
        >
          {{ question }}
        </p>
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
            :disabled="thinking || recording || recognizing || startingVoice || saving"
            @click="$emit('select-option', choice)"
          >
            {{ choice }}
          </button>
        </div>
        <p v-if="thinking" class="conversation-dialog__status">
          {{ home ? '正在解读您的需求…' : '正在理解并核对本轮信息…' }}
        </p>
        <p v-if="voiceError" class="conversation-dialog__error" role="alert">
          {{ voiceError }}
        </p>
        <p v-if="aiNotice && !noticeInMessages" class="conversation-dialog__status" role="status">
          {{ aiNotice }}
        </p>
      </div>
      <form
        class="conversation-dialog__input conversation-dialog__desktop-input"
        @submit.prevent="send"
      >
        <el-input
          v-model="draft"
          maxlength="500"
          :placeholder="home ? '请输入您要办理的内容' : '输入需要补充或修改的信息'"
          @keydown.native.enter.prevent="send"
        />
        <el-button
          type="primary"
          :disabled="!draft.trim() || thinking || saving"
          native-type="submit"
        >
          发送
        </el-button>
        <el-button
          class="conversation-dialog__voice"
          :type="recording ? 'danger' : 'default'"
          :disabled="saving || startingVoice || recognizing || (thinking && !recording)"
          @click="$emit('toggle-record')"
        >
          <i :class="recording ? 'el-icon-video-pause' : 'el-icon-microphone'"></i>
          {{ recording ? '结束录音' : recognizing ? '正在识别…' : '语音输入' }}
        </el-button>
      </form>
      <form class="conversation-dialog__mobile-input" @submit.prevent="send">
        <button
          class="conversation-dialog__mode"
          type="button"
          :aria-label="
            home
              ? inputMode === 'text'
                ? '切换语音输入'
                : '切换文字输入'
              : recording
              ? '结束录音'
              : '开始录音'
          "
          :disabled="saving || startingVoice || recognizing || (thinking && !recording)"
          @click="home ? toggleInputMode() : $emit('toggle-record')"
        >
          <i
            :class="
              home
                ? inputMode === 'text'
                  ? 'el-icon-microphone'
                  : 'el-icon-edit-outline'
                : recording
                ? 'el-icon-video-pause'
                : 'el-icon-microphone'
            "
          ></i>
        </button>
        <el-input
          v-if="!home || inputMode === 'text'"
          v-model="draft"
          maxlength="500"
          placeholder="发送消息…"
          @keydown.native.enter.prevent="send"
        />
        <el-button
          v-if="!home || inputMode === 'text'"
          class="conversation-dialog__send"
          type="primary"
          :disabled="!draft.trim() || thinking || saving"
          native-type="submit"
        >
          发送
        </el-button>
        <el-button
          v-if="home && inputMode === 'voice'"
          class="conversation-dialog__mobile-voice"
          :type="recording ? 'danger' : 'default'"
          :disabled="saving || startingVoice || recognizing || (thinking && !recording)"
          @click="$emit('toggle-record')"
        >
          {{ recording ? '结束录音' : recognizing ? '正在识别…' : '开始录音' }}
        </el-button>
      </form>
    </aside>
  </div>
</template>

<script>
import { maskText } from '../utils/mask.js'

export default {
  name: 'ConversationDialog',
  props: {
    home: { type: Boolean, default: false },
    visible: { type: Boolean, default: false },
    initialInputMode: { type: String, default: 'text' },
    question: { type: String, default: '' },
    choices: { type: Array, default: () => [] },
    messages: { type: Array, default: () => [] },
    thinking: { type: Boolean, default: false },
    recording: { type: Boolean, default: false },
    recognizing: { type: Boolean, default: false },
    startingVoice: { type: Boolean, default: false },
    saving: { type: Boolean, default: false },
    transcript: { type: String, default: '' },
    aiNotice: { type: String, default: '' },
    voiceError: { type: String, default: '' },
  },
  data() {
    return {
      draft: '',
      inputMode: this.initialInputMode,
      previousBodyOverflow: '',
    }
  },
  computed: {
    questionInMessages() {
      const last = this.messages[this.messages.length - 1]
      return last?.role === 'assistant' && last.text.endsWith(this.question)
    },
    transcriptInMessages() {
      if (!this.transcript || !this.messages.length) return false
      const last = this.messages[this.messages.length - 1]
      const previous = this.messages[this.messages.length - 2]
      if (this.home) {
        return (
          (last.role === 'patient' && last.text === this.transcript) ||
          (previous?.role === 'patient' &&
            previous.text === this.transcript &&
            last.role === 'assistant')
        )
      }
      if (this.thinking || this.recognizing) return false
      return (
        previous?.role === 'patient' &&
        previous.text === this.transcript &&
        last.role === 'assistant'
      )
    },
    noticeInMessages() {
      const last = this.messages[this.messages.length - 1]
      return last?.role === 'assistant' && last.text === this.aiNotice
    },
  },
  watch: {
    visible(value) {
      if (value) {
        this.inputMode = this.initialInputMode
        this.previousBodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      } else {
        document.body.style.overflow = this.previousBodyOverflow
      }
    },
  },
  beforeDestroy() {
    if (this.visible) document.body.style.overflow = this.previousBodyOverflow
  },
  methods: {
    maskText,
    toggleInputMode() {
      if (this.recording || this.recognizing || this.startingVoice || this.saving) return
      this.inputMode = this.inputMode === 'text' ? 'voice' : 'text'
    },
    send() {
      const text = this.draft.trim()
      if (
        !text ||
        this.thinking ||
        this.saving ||
        this.recording ||
        this.recognizing ||
        this.startingVoice
      )
        return
      this.$emit('send', text)
      this.draft = ''
    },
  },
}
</script>
