import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BottomBar from '../src/components/BottomBar.vue'

describe('reference bottom navigation', () => {
  it('uses the current patient with masked identity and retains the countdown', () => {
    const wrapper = mount(BottomBar, {
      propsData: { page: 'form', patientName: '测试患者', phone: '13800138000', countdown: 299 },
    })
    expect(wrapper.text()).toContain('测**者')
    expect(wrapper.text()).toContain('138****8000')
    expect(wrapper.text()).not.toContain('13800138000')
    expect(wrapper.find('.home-countdown').text()).toBe('倒计时 299 秒')
    wrapper.destroy()
  })

  it('does not invent a signed-in patient and hides the result countdown', () => {
    const wrapper = mount(BottomBar, { propsData: { page: 'result' } })
    expect(wrapper.text()).toContain('未核验身份')
    expect(wrapper.find('.home-countdown').exists()).toBe(false)
    wrapper.destroy()
  })

  it('reports navigation separately and blocks every action during submission', async () => {
    const wrapper = mount(BottomBar, { propsData: { page: 'form' } })
    for (const [label, event] of [
      ['返回上一步', 'back'],
      ['返回首页', 'home'],
      ['退出办理', 'logout'],
    ]) {
      const button = wrapper.find(`[aria-label="${label}"]`)
      await button.trigger('click')
      expect(wrapper.emitted(event)).toHaveLength(1)
      await wrapper.setProps({ disabled: true })
      await button.trigger('click')
      expect(wrapper.emitted(event)).toHaveLength(1)
      await wrapper.setProps({ disabled: false })
    }
    wrapper.destroy()
  })
})
