// 患者敏感信息展示脱敏，仅供屏幕渲染；日志与请求不得使用脱敏值。
export function maskName(value) {
  return value.length < 2
    ? value
    : value.length === 2
    ? `${value[0]}*`
    : `${value[0]}${'*'.repeat(value.length - 2)}${value[value.length - 1]}`
}

export function maskId(value) {
  return value
    ? `${value.slice(0, 6)}${'*'.repeat(Math.max(0, value.length - 10))}${value.slice(-4)}`
    : ''
}

export function maskPhone(value) {
  return value ? `${value.slice(0, 3)}****${value.slice(-4)}` : ''
}

export function maskText(value) {
  return (value || '')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, maskId)
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, maskPhone)
}
