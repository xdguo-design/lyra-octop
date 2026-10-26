// 自助终端空闲守护：无操作达到 timeoutMs 后进入 graceMs 宽限倒计时，
// 期间通过 onTick(剩余秒数) 驱动界面提示，倒计时归零触发 onExpire 清理会话。
export function createIdleGuard({ timeoutMs, graceMs, shouldRun, onCountdown, onTick, onExpire }) {
  let lastActive = Date.now()
  let warned = false
  let deadline = 0
  let timer = null

  const tick = () => {
    if (!shouldRun()) return
    const now = Date.now()
    onCountdown(warned ? 0 : Math.max(0, Math.ceil((lastActive + timeoutMs - now) / 1000)))
    if (!warned && now - lastActive >= timeoutMs) {
      warned = true
      deadline = now + graceMs
    }
    if (warned) {
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
      onTick(remaining)
      if (!remaining) {
        warned = false
        onExpire()
      }
    }
  }

  return {
    touch() {
      lastActive = Date.now()
      if (!warned) onCountdown(Math.ceil(timeoutMs / 1000))
    },
    resume() {
      warned = false
      lastActive = Date.now()
      onCountdown(Math.ceil(timeoutMs / 1000))
    },
    start() {
      if (!timer) timer = window.setInterval(tick, 1000)
    },
    stop() {
      window.clearInterval(timer)
      timer = null
    },
  }
}
