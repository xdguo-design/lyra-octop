<template>
  <div class="identity-stage">
    <div class="reader-card">
      <div class="reader-content">
        <div class="reader-heading">
          <strong>{{ verifying ? '正在模拟识别' : '零触登录' }}</strong>
        </div>
        <p class="reader-copy">请将证件放置到读卡区，然后点击“模拟刷卡”。</p>
        <img class="reader-terminal-image" :src="readerTerminal" alt="读卡终端和证件放置位置" />
        <button class="reader-trigger" type="button" :disabled="verifying" @click="$emit('verify')">
          {{ verifying ? '正在模拟刷卡…' : '模拟刷卡' }}
        </button>
        <button class="reader-close" type="button" aria-label="关闭" @click="$emit('close')">
          ×
        </button>
      </div>
      <div class="reader-countdown">倒计时{{ remainingSeconds }}s</div>
    </div>
    <button class="speak-hint" type="button" aria-label="重播语音提示" @click="$emit('speak')">
      <i class="el-icon-service"></i>
    </button>
    <p v-if="formError" class="error-text" role="alert">{{ formError }}</p>
  </div>
</template>

<script>
import readerTerminal from '../assets/reader-terminal.png'

export default {
  name: 'IdentityCard',
  props: {
    remainingSeconds: { type: Number, required: true },
    verifying: { type: Boolean, default: false },
    formError: { type: String, default: '' },
  },
  data() {
    return { readerTerminal }
  },
}
</script>
