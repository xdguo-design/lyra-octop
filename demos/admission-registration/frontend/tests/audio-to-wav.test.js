import { afterEach, describe, expect, it, vi } from 'vitest'
import { audioToWav } from '../src/utils/audioToWav.js'

function readArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audioToWav', () => {
  it('converts browser audio into mono PCM16 WAV for the configured speech provider', async () => {
    const close = vi.fn()
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = vi.fn().mockResolvedValue({
          length: 2,
          numberOfChannels: 2,
          sampleRate: 16000,
          getChannelData: (channel) =>
            channel === 0 ? new Float32Array([-1, 0.5]) : new Float32Array([1, 0.5]),
        })

        close = close
      }
    )

    const wav = await audioToWav(new Blob(['browser recording'], { type: 'audio/webm' }))
    const bytes = new DataView(await readArrayBuffer(wav))

    expect(wav.type).toBe('audio/wav')
    expect(String.fromCharCode(...new Uint8Array(await readArrayBuffer(wav.slice(0, 4))))).toBe(
      'RIFF'
    )
    expect(bytes.getUint16(22, true)).toBe(1)
    expect(bytes.getUint32(24, true)).toBe(16000)
    expect(bytes.getUint16(34, true)).toBe(16)
    expect(bytes.getInt16(44, true)).toBe(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('fails clearly when this browser cannot decode recorded audio', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = vi.fn().mockRejectedValue(new Error('decode failed'))

        close = vi.fn()
      }
    )

    await expect(audioToWav(new Blob(['bad audio']))).rejects.toThrow('decode failed')
  })
})
