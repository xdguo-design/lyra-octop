import { mount, createLocalVue } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ElementUI from 'element-ui'
import App from '../src/App.vue'

const { api } = vi.hoisted(() => ({
  api: {
    verify: vi.fn(),
    validate: vi.fn(),
    confirmReview: vi.fn(),
    submit: vi.fn(),
    result: vi.fn(),
    extract: vi.fn(),
    platform: vi.fn(),
    tts: vi.fn(),
  },
}))

vi.mock('../src/api/admission.js', () => ({
  admissionApi: api,
  extractCandidates: api.extract,
  platformJson: api.platform,
  platformTts: api.tts,
}))

const localVue = createLocalVue()
localVue.use(ElementUI)

function readyFields() {
  return {
    name: '演示患者',
    idNumber: 'DEMO-ID-0001',
    phone: '13800138000',
    nationality: '中国',
    ethnicity: '汉族',
    nativeRegion: [],
    residentRegion: [],
    addressDetail: '',
    employerName: '',
    employerAddress: '',
    marriage: '未婚',
    occupation: '职工',
    emergencyContact: '王小明',
    relationship: '子女',
  }
}

describe('admission page workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()
  })

  it('keeps the screenshot shortcut copy and two-page field split', () => {
    const wrapper = mount(App, { localVue })

    expect(wrapper.vm.shortcuts).toEqual([
      '直接说科室名称或不舒服症状挂号',
      '帮我打印检查检验报告单',
      '我要报告解读',
      '可以说帮我入院登记',
    ])
    expect(wrapper.vm.groups.map((group) => group.fields.map((field) => field.key))).toEqual([
      [
        'name',
        'idNumber',
        'phone',
        'nationality',
        'ethnicity',
        'nativeRegion',
        'residentRegion',
        'addressDetail',
      ],
      [
        'employerName',
        'employerAddress',
        'marriage',
        'occupation',
        'emergencyContact',
        'relationship',
      ],
    ])
    expect(wrapper.text()).not.toContain('模拟情景')
    expect(wrapper.text()).not.toContain('听我说')
    wrapper.destroy()
  })

  it('opens identity verification as a separate page from the admission shortcut', async () => {
    const wrapper = mount(App, { localVue })
    wrapper.vm.speak = vi.fn()
    wrapper.find('.page-content').element.scrollTop = 240

    await wrapper.findAll('.prompt-button').at(3).trigger('click')

    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.find('.mascot-stage').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'VoiceStage' }).exists()).toBe(true)
    expect(wrapper.find('.bottom-bar').exists()).toBe(true)
    expect(wrapper.find('.reader-card').exists()).toBe(true)
    expect(wrapper.vm.transcript).toBe('')
    expect(wrapper.vm.aiNotice).toBe('')
    expect(wrapper.find('.page-content').element.scrollTop).toBe(0)
    expect(wrapper.find('.self-mode').exists()).toBe(false)
    expect(wrapper.find('.page-content .reader-card').exists()).toBe(true)
    expect(wrapper.find('.page-shell > .bottom-bar').exists()).toBe(true)
    expect(wrapper.find('.entered-label').text()).toBe(
      '您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。'
    )
    expect(wrapper.vm.speak).toHaveBeenCalledWith(
      '您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。'
    )

    const identityCard = wrapper.findComponent({ name: 'IdentityCard' })
    expect(identityCard.find('.reader-trigger').text()).toBe('模拟刷卡')
    expect(identityCard.find('.reader-terminal-image').exists()).toBe(true)
    expect(identityCard.find('.reader-terminal-image').attributes('alt')).toBe(
      '读卡终端和证件放置位置'
    )
    await identityCard.find('.reader-trigger').trigger('click')
    expect(identityCard.emitted('verify')).toHaveLength(1)
    wrapper.destroy()
  })

  it('shows only current page content while retaining voice controls where needed', async () => {
    const wrapper = mount(App, { localVue })

    expect(wrapper.find('.mascot-stage').exists()).toBe(true)
    expect(wrapper.find('.self-mode').exists()).toBe(true)
    expect(wrapper.find('.user-bar').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'VoiceStage' }).exists()).toBe(true)

    wrapper.vm.page = 'identity'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.reader-card').exists()).toBe(true)
    expect(wrapper.find('.mascot-stage').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'VoiceStage' }).exists()).toBe(true)

    wrapper.vm.page = 'form'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mascot-stage').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'VoiceStage' }).exists()).toBe(true)

    expect(wrapper.find('.self-mode').exists()).toBe(false)
    expect(wrapper.find('.mic-button').exists()).toBe(true)
    expect(wrapper.find('.user-bar').exists()).toBe(true)
    expect(wrapper.find('.user-name').text()).toBe('')
    expect(wrapper.find('.user-phone').exists()).toBe(false)
    wrapper.vm.step = 2
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.self-mode').exists()).toBe(false)

    wrapper.vm.page = 'result'
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'ResultPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'VoiceStage' }).exists()).toBe(false)
    expect(wrapper.find('.bottom-bar').exists()).toBe(true)
    expect(wrapper.find('.user-bar').exists()).toBe(true)

    wrapper.vm.reset()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mascot-stage').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'VoiceStage' }).exists()).toBe(true)
    expect(wrapper.find('.self-mode').exists()).toBe(true)
    wrapper.destroy()
  })

  it('opens the home conversation dialog with AI history and text and voice inputs', async () => {
    const wrapper = mount(App, { localVue })
    const classify = vi.spyOn(wrapper.vm, 'classifyHomeIntent').mockResolvedValue()

    await wrapper.find('.manual-entry-button').trigger('click')

    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.exists()).toBe(true)
    expect(dialog.classes()).toContain('conversation-dialog-backdrop')
    expect(dialog.find('.conversation-dialog__messages').exists()).toBe(true)
    expect(dialog.find('.conversation-dialog__mobile-input').exists()).toBe(true)
    expect(dialog.find('.conversation-dialog__voice').text()).toContain('语音输入')

    await dialog.find('.conversation-dialog__mode').trigger('click')
    expect(dialog.find('.conversation-dialog__mobile-voice').text()).toContain('开始录音')
    await dialog.find('.conversation-dialog__mode').trigger('click')
    await dialog.find('.conversation-dialog__mobile-input input').setValue('我要办理入院登记')
    await dialog.find('.conversation-dialog__mobile-input').trigger('submit')

    expect(classify).toHaveBeenCalledWith('我要办理入院登记', wrapper.vm.generation)
    wrapper.destroy()
  })

  it('overwrites profile values with AI candidates and preserves manually edited conflicts', async () => {
    const wrapper = mount(App, { localVue, attachTo: document.body })
    wrapper.vm.page = 'form'
    wrapper.vm.identityToken = 'demo-token'
    wrapper.vm.fields = {
      ...readyFields(),
      phone: '13900139000',
      nativeRegion: ['110000', '110100', '110105'],
      residentRegion: ['110000', '110100', '110105'],
    }
    api.extract.mockResolvedValue({
      fields: {
        phone: '13800138000',
        addressDetail: '北京市朝阳区建国路1号',
        relationship: '朋友',
        nativeRegion: ['210000', '210100', '210103'],
        residentRegion: ['210000', '210100', '210103'],
      },
    })

    await wrapper.vm.applyAi(
      '手机号13800138000，地址北京市朝阳区建国路1号，关系朋友',
      wrapper.vm.generation
    )

    expect(wrapper.vm.fields.phone).toBe('13800138000')
    expect(wrapper.vm.pendingCandidates.phone).toBeUndefined()
    expect(wrapper.vm.fields.addressDetail).toBe('北京市朝阳区建国路1号')
    expect(wrapper.vm.fields.relationship).toBe('子女')
    expect(wrapper.vm.fields.nativeRegion).toEqual(['210000', '210100', '210103'])
    expect(wrapper.vm.fields.residentRegion).toEqual(['210000', '210100', '210103'])

    wrapper.vm.fields.phone = '13900139000'
    wrapper.vm.sources.phone = 'manual'
    await wrapper.vm.applyAi('手机号13800138000', wrapper.vm.generation)
    expect(wrapper.vm.fields.phone).toBe('13900139000')
    expect(wrapper.vm.pendingCandidates.phone).toBe('13800138000')
    await wrapper.vm.$nextTick()
    wrapper.vm.resolveCandidate(true)
    expect(wrapper.vm.fields.phone).toBe('13800138000')
    expect(wrapper.vm.candidateDialogKey).toBe('')

    wrapper.vm.fields.phone = ''
    wrapper.vm.sources.phone = 'manual'
    await wrapper.vm.applyAi('手机号13800138000', wrapper.vm.generation)
    expect(wrapper.vm.fields.phone).toBe('')
    expect(wrapper.vm.pendingCandidates.phone).toBe('13800138000')
    expect(wrapper.vm.candidateDialogKey).toBe('phone')
    await wrapper.vm.$nextTick()
    wrapper.destroy()
  })

  it('shows a specific notice when the AI provider rate limits a request', async () => {
    const wrapper = mount(App, { localVue })
    wrapper.vm.page = 'form'
    wrapper.vm.identityToken = 'demo-token'
    wrapper.vm.transcript = '联系电话13800138000'
    const error = new Error('rate limited')
    error.status = 429
    error.body = {
      detail: {
        code: 'AI_RATE_LIMITED',
        message: 'AI 服务请求过于频繁，请稍后重试；转写内容已保留。',
      },
    }
    api.extract.mockRejectedValue(error)

    await wrapper.vm.applyAi(wrapper.vm.transcript, wrapper.vm.generation)

    expect(wrapper.vm.aiNotice).toBe('AI 服务请求过于频繁，请稍后重试；转写内容已保留。')
    expect(wrapper.vm.transcript).toBe('联系电话13800138000')
    wrapper.destroy()
  })

  it('prevents duplicate submit clicks while the first request is pending', async () => {
    const wrapper = mount(App, { localVue })
    wrapper.vm.page = 'form'
    wrapper.vm.step = 2
    wrapper.vm.identityToken = 'demo-token'
    wrapper.vm.fields = readyFields()
    wrapper.vm.sessionId = 'session-demo-001'
    wrapper.vm.activeApplication = {
      id: 'APP-DEMO-001',
      department: '心内科',
      plannedAdmissionAt: '2026-10-22 09:00',
    }
    api.validate.mockResolvedValue({ valid: true, errors: {} })
    api.confirmReview.mockResolvedValue({ reviewRevision: 1 })
    let completeSubmit
    api.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeSubmit = resolve
        })
    )
    await wrapper.vm.$nextTick()

    await wrapper.find('.confirm-submit').trigger('click')
    await wrapper.vm.$nextTick()
    const submit = wrapper.find('.review-submit')
    await submit.trigger('click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(submit.attributes('disabled')).toBe('disabled')
    await submit.trigger('click')

    expect(api.submit).toHaveBeenCalledTimes(1)
    completeSubmit({ status: 'success', mock: true })
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.page).toBe('result')
    wrapper.destroy()
  })
})
