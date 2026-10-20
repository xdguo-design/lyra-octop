<template>
  <div v-show="visible" class="keypad-panel">
    <div class="keypad-grid">
      <el-button v-for="digit in keys" :key="digit" @click="tap(digit)">{{ digit }}</el-button>
    </div>
  </div>
</template>

<script>
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'X', '0', '⌫']

export default {
  name: 'KeypadDialog',
  props: {
    visible: { type: Boolean, default: false },
    value: { type: String, default: '' },
    // 触发键盘的按钮。真实浏览器里“打开键盘的那次点击”会继续冒泡到 document，
    // 若不把按钮算作内部区域，这次点击会立刻把刚打开的键盘关掉。
    anchor: { type: Object, default: null },
  },
  data() {
    return { keys: KEYS }
  },
  watch: {
    visible(value) {
      if (value) this.$nextTick(() => document.addEventListener('click', this.onOutsideClick))
      else document.removeEventListener('click', this.onOutsideClick)
    },
  },
  beforeDestroy() {
    document.removeEventListener('click', this.onOutsideClick)
  },
  methods: {
    tap(digit) {
      if (digit === 'X') this.$emit('input', '')
      else if (digit === '⌫') this.$emit('input', this.value.slice(0, -1))
      else if (/^\d$/.test(digit) && this.value.length < 11) this.$emit('input', this.value + digit)
    },
    close() {
      this.$emit('update:visible', false)
    },
    onOutsideClick(event) {
      const target = event.target
      if (this.$el.contains(target)) return
      if (this.anchor && this.anchor.contains(target)) return
      this.close()
    },
  },
}
</script>
