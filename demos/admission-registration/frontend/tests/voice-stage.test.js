import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VoiceStage from '../src/components/VoiceStage.vue'

describe('VoiceStage', () => {
  it('distinguishes recording silence from detected speech with a level-driven waveform', async () => {
    const wrapper = mount(VoiceStage, {
      propsData: { recording: true, soundDetected: false, volumeLevel: 0 },
    })

    expect(wrapper.find('.voice-state').text()).toContain('等待您说话')
    expect(wrapper.find('.voice-waveform').attributes('aria-label')).toBe('正在听，等待您说话')
    const quietHeights = wrapper
      .findAll('.voice-waveform__bar')
      .wrappers.map((bar) => bar.attributes('style'))

    await wrapper.setProps({ soundDetected: true, volumeLevel: 0.65 })

    expect(wrapper.find('.voice-state').text()).toContain('检测到声音')
    expect(wrapper.find('.voice-waveform').attributes('aria-label')).toBe('正在收音')
    const activeHeights = wrapper
      .findAll('.voice-waveform__bar')
      .wrappers.map((bar) => bar.attributes('style'))
    expect(activeHeights).not.toEqual(quietHeights)
    expect(wrapper.findAll('.voice-waveform__bar')).toHaveLength(24)
  })

  it('shows no live waveform while idle or while recognizing', async () => {
    const wrapper = mount(VoiceStage)
    expect(wrapper.find('.voice-waveform').exists()).toBe(false)

    await wrapper.setProps({ recording: true, recognizing: true, soundDetected: true })

    expect(wrapper.find('.voice-state').text()).toContain('识别')
    expect(wrapper.find('.voice-waveform').exists()).toBe(false)
  })

  it('offers manual entry from the voice control and emits the request', async () => {
    const wrapper = mount(VoiceStage)

    await wrapper.find('.manual-entry-button').trigger('click')

    expect(wrapper.emitted('manual-input')).toHaveLength(1)
  })
})
