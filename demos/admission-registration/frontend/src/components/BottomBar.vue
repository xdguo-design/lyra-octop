<template>
  <footer class="bottom-bar">
    <button
      class="bar-circle"
      type="button"
      :disabled="disabled"
      aria-label="返回上一步"
      @click="$emit('back')"
    >
      <i class="el-icon-back" aria-hidden="true"></i>
    </button>
    <button
      class="bar-circle"
      type="button"
      :disabled="disabled"
      aria-label="返回首页"
      @click="$emit('home')"
    >
      <i class="el-icon-house" aria-hidden="true"></i>
    </button>
    <div class="bar-user">
      <i class="el-icon-user-solid bar-user__icon" aria-hidden="true"></i>
      <span class="bar-user__identity">
        <strong>{{ patientName ? maskName(patientName) : '未核验身份' }}</strong>
        <span v-if="phone">{{ maskPhone(phone) }}</span>
      </span>
      <span v-if="page !== 'result'" class="home-countdown"
        ><span class="home-countdown__label">倒计时 </span>{{ countdown }} 秒</span
      >
      <button
        class="bar-exit"
        type="button"
        :disabled="disabled"
        aria-label="退出办理"
        @click="$emit('logout')"
      >
        退出登录
      </button>
    </div>
  </footer>
</template>

<script>
import { maskName, maskPhone } from '../utils/mask.js'

export default {
  name: 'BottomBar',
  props: {
    disabled: { type: Boolean, default: false },
    page: { type: String, required: true },
    countdown: { type: Number, default: 380 },
    patientName: { type: String, default: '' },
    phone: { type: String, default: '' },
  },
  methods: { maskName, maskPhone },
}
</script>
