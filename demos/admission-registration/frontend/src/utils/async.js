// 统一的“带超时自动中断”请求控制器：
// const req = abortAfter(15000)
// try { await fetch(url, { signal: req.signal }) } finally { req.done() }
export function abortAfter(ms) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    done: () => window.clearTimeout(timer),
  }
}
