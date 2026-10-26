<template>
  <div class="identity-stage">
    <div class="reader-card">
      <div class="reader-content">
        <h2 class="reader-heading">
          {{ verifying ? '正在模拟识别身份信息' : '请将身份证放在' }}<br v-if="!verifying" />
          <template v-if="!verifying">自助机身份证识别区</template>
        </h2>
        <div class="reader-terminal-wrap">
          <img class="reader-terminal-image" :src="readerTerminal" alt="自助机身份证识别区" />
          <span class="reader-target-pulse" aria-hidden="true"></span>
        </div>
        <p class="reader-copy">支持居民身份证、社保卡、就诊卡</p>
        <button class="reader-trigger" type="button" :disabled="verifying" @click="$emit('verify')">
          {{ verifying ? '正在模拟刷卡…' : '模拟刷卡' }}
        </button>
        <button class="reader-close" type="button" aria-label="关闭" @click="$emit('close')">
          ×
        </button>
      </div>
      <button class="speak-hint" type="button" aria-label="重播语音提示" @click="$emit('speak')">
        <i class="el-icon-service"></i>
      </button>
    </div>
    <p v-if="formError" class="error-text" role="alert">{{ formError }}</p>
  </div>
</template>

<script>
import readerTerminal from '../assets/reader-terminal.png'

export default {
  name: 'IdentityCard',
  props: {
    verifying: { type: Boolean, default: false },
    formError: { type: String, default: '' },
  },
  data() {
    return { readerTerminal }
  },
}
</script>
