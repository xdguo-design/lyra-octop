<template>
  <footer class="bottom-bar">
    <button
      class="bar-circle"
      type="button"
      :disabled="disabled"
      aria-label="上一步"
      @click="$emit('back')"
    >
      <i class="el-icon-back"></i>
    </button>
    <button
      class="bar-circle"
      type="button"
      :disabled="disabled"
      aria-label="新会话"
      @click="$emit(page === 'home' ? 'home' : 'logout')"
    >
      <i class="el-icon-house"></i>
    </button>
    <div v-if="showUserBar" class="user-bar">
      <span class="user-avatar"><i class="el-icon-user"></i></span>
      <strong class="user-name">{{ patient.name }}</strong>
      <span v-if="patient.phone" class="user-phone">{{ patient.phone }}</span>
      <button class="user-change" type="button" :disabled="disabled" @click="$emit('change')">
        <i class="el-icon-edit"></i>变更
      </button>
      <button class="user-logout" type="button" :disabled="disabled" @click="$emit('logout')">
        退出登录
      </button>
    </div>
  </footer>
</template>

<script>
export default {
  name: 'BottomBar',
  props: {
    disabled: { type: Boolean, default: false },
    patient: { type: Object, required: true },
    page: { type: String, required: true },
  },
  computed: {
    showUserBar() {
      // 初始首页与身份核验阶段不展示账号个人信息。
      return ['applications', 'form', 'review', 'result'].includes(this.page)
    },
  },
}
</script>
