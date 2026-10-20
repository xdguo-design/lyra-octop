function readArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('录音数据读取失败。'))
    reader.readAsArrayBuffer(blob)
  })
}

export async function audioToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) throw new Error('浏览器无法转换录音格式，请手动填写。')

  const context = new AudioContextClass()
  try {
    const decoded = await context.decodeAudioData(await readArrayBuffer(blob))
    const samples = new Float32Array(decoded.length)
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel)
      for (let frame = 0; frame < decoded.length; frame += 1)
        samples[frame] += data[frame] / decoded.numberOfChannels
    }

    const output = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(output)
    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1)
        view.setUint8(offset + index, value.charCodeAt(index))
    }
    writeString(0, 'RIFF')
    view.setUint32(4, output.byteLength - 8, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, decoded.sampleRate, true)
    view.setUint32(28, decoded.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    for (let frame = 0; frame < samples.length; frame += 1) {
      const sample = Math.max(-1, Math.min(1, samples[frame]))
      view.setInt16(44 + frame * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    }
    return new Blob([output], { type: 'audio/wav' })
  } finally {
    try {
      await context.close()
    } catch {
      // Closing an already interrupted browser audio context is harmless.
    }
  }
}
