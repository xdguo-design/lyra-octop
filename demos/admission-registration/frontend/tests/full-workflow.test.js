import { mount, createLocalVue } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import ElementUI from 'element-ui'
import App from '../src/App.vue'
import regions from '../../contracts/regions.mock.json'
import { buildRegionOptions } from '../src/model/formConfig.js'
import { loadValidation } from '../src/model/validationLoader.js'

const { api, recorder } = vi.hoisted(() => ({
  api: {
    regions: vi.fn(),
    verify: vi.fn(),
    applications: vi.fn(),
    selectApplication: vi.fn(),
    getSession: vi.fn(),
    saveTurn: vi.fn(),
    confirmReview: vi.fn(),
    validate: vi.fn(),
    submit: vi.fn(),
    result: vi.fn(),
    extract: vi.fn(),
    intent: vi.fn(),
    confirmCandidate: vi.fn(),
    platform: vi.fn(),
    upload: vi.fn(),
    tts: vi.fn(),
  },
  recorder: {
    options: null,
    start: vi.fn(),
    stop: vi.fn(),
    cleanup: vi.fn(),
  },
}))

vi.mock('../src/api/admission.js', () => ({
  admissionApi: api,
  extractCandidates: api.extract,
  platformJson: api.platform,
  platformTts: api.tts,
}))

vi.mock('../src/api/platform.js', () => ({
  classifyAdmissionIntent: api.intent,
  classifyAdmissionCandidateConfirmation: api.confirmCandidate,
  platformJson: api.platform,
  platformUpload: api.upload,
  platformTts: api.tts,
}))

vi.mock('../src/utils/voiceRecorder.js', () => ({
  VoiceRecorder: vi.fn().mockImplementation((options) => {
    recorder.options = options
    return {
      start: recorder.start,
      stop: recorder.stop,
      cleanup: recorder.cleanup,
    }
  }),
  canUseMicrophone: vi.fn(() => true),
  MIC_UNSUPPORTED_MESSAGE: '当前环境无法使用麦克风',
}))

vi.mock('../src/utils/audioToWav.js', () => ({
  audioToWav: vi.fn(async (blob) => new Blob([blob], { type: 'audio/wav' })),
}))

const localVue = createLocalVue()
localVue.use(ElementUI)

function validFields() {
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

function mountApp() {
  const wrapper = mount(App, { localVue })
  wrapper.vm.speak = vi.fn()
  return wrapper
}

async function settle(wrapper) {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve()
    await wrapper.vm.$nextTick()
  }
}

async function releaseHomeRecording(wrapper) {
  // 按住时长不足 600ms 会被判为误触取消，测试里补足按住时长。
  // 挂载树不在 document 里，冒泡不到 window 上的手势监听，直接在 window 派发松开。
  wrapper.vm.holdStartedAt -= 5000
  window.dispatchEvent(new MouseEvent('pointerup'))
  await settle(wrapper)
}

async function startHomeRecording(wrapper) {
  await wrapper.find('.mic-button').trigger('pointerdown')
  await settle(wrapper)
}

// 旧“点两次麦克风开始/结束”的等价迁移：按住录音，松手结束并打开对话弹窗。
async function holdMicAndRelease(wrapper) {
  await wrapper.find('.mic-button').trigger('pointerdown')
  await settle(wrapper)
  await releaseHomeRecording(wrapper)
}

async function toggleIdentityRecording(wrapper) {
  if (!wrapper.vm.recording) {
    await wrapper.find('.mic-button').trigger('pointerdown')
    await settle(wrapper)
    return
  }
  wrapper.vm.holdStartedAt -= 5000
  window.dispatchEvent(new MouseEvent('pointerup'))
  await settle(wrapper)
}

async function startAdmission(wrapper) {
  await wrapper.findAll('.prompt-button').at(3).trigger('click')
  expect(wrapper.vm.page).toBe('identity')
  expect(wrapper.find('.mascot-stage').exists()).toBe(true)
  expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(true)
  expect(wrapper.find('.reader-card').exists()).toBe(true)
  expect(wrapper.vm.transcript).toBe('')
  expect(wrapper.vm.aiNotice).toBe('')
}

async function enterForm(wrapper, fields = validFields()) {
  api.verify.mockResolvedValue({
    identityToken: 'identity-demo-token',
    fields,
  })
  api.applications.mockResolvedValue({ items: [application()] })
  api.selectApplication.mockResolvedValue({
    application: application(),
    sessionId: 'session-demo-001',
  })
  await startAdmission(wrapper)
  await wrapper.find('.reader-trigger').trigger('click')
  await settle(wrapper)
  expect(wrapper.vm.page).toBe('applications')
  expect(wrapper.vm.selectedApplicationId).toBe(application().id)
  expect(wrapper.find('.application-select').exists()).toBe(false)
  await wrapper.find('.application-continue').trigger('click')
  await loadValidation()
  await settle(wrapper)
  expect(wrapper.vm.page).toBe('form')
  wrapper.vm.conversationVisible = false
  // Existing scenarios exercise follow-up behavior after the initial combined question.
  wrapper.vm.initialPatientInfoRequestPending = false
}

function application() {
  return {
    id: 'APP-DEMO-001',
    patientName: '演**者',
    department: '心内科',
    plannedAdmissionAt: '2026-10-22 09:00',
    doctor: '王医生',
    orderedAt: '2026-10-19 15:30',
    type: '普通住院',
    diagnosis: '冠心病待查',
    ward: '心内科一区',
    status: '有效',
  }
}

async function nextFormPage(wrapper) {
  await wrapper.find('.confirm-submit').trigger('click')
  await wrapper.vm.$nextTick()
}

async function previousFormPage(wrapper) {
  await wrapper.find('.page-arrow[aria-label="上一页"]').trigger('click')
  await wrapper.vm.$nextTick()
}

async function submitSecondPage(wrapper) {
  await wrapper.find('.confirm-submit').trigger('click')
  await settle(wrapper)
  if (wrapper.vm.page === 'review') {
    await wrapper.find('.review-submit').trigger('click')
    await settle(wrapper)
  }
}

async function clickDialogButton(label) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const button = Array.from(document.body.querySelectorAll('.el-dialog__footer .el-button')).find(
    (item) => item.textContent.trim() === label
  )
  expect(button, `dialog button "${label}"`).toBeTruthy()
  button.click()
}

describe('complete admission workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const method of Object.values(api)) method.mockReset()
    recorder.options = null
    recorder.start.mockResolvedValue(undefined)
    recorder.stop.mockImplementation(() => {})
    recorder.cleanup.mockImplementation(() => {})
    api.applications.mockResolvedValue({ items: [application()] })
    api.regions.mockResolvedValue({ items: buildRegionOptions(regions) })
    api.selectApplication.mockResolvedValue({
      application: application(),
      sessionId: 'session-demo-001',
    })
    api.getSession.mockResolvedValue({
      revision: 0,
      lastTurnId: null,
      facts: {},
      turns: [],
    })
    api.saveTurn.mockImplementation(async (_sessionId, payload) => ({
      revision: payload.expectedRevision + 1,
      lastTurnId: payload.turnId,
    }))
    api.confirmReview.mockImplementation(async (_sessionId, payload) => ({
      reviewRevision: payload.expectedRevision + 1,
    }))
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()
  })

  it('asks for all patient information together when a new session starts', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.initialPatientInfoRequestPending = true

    expect(wrapper.vm.nextConversationQuestion).toContain('联系电话、婚姻状况、职业')
    expect(wrapper.vm.nextConversationQuestion).toContain('紧急联系人姓名、与患者关系')
    expect(wrapper.vm.nextConversationQuestion).toContain('必填信息：')
    expect(wrapper.vm.nextConversationQuestion).toContain('选填信息：')
    expect(wrapper.vm.nextConversationQuestion).toContain('已从身份档案带入：')
    expect(wrapper.vm.nextConversationQuestion).toContain('可以分几次回答')
    wrapper.vm.conversationVisible = true
    wrapper.vm.lastGuidedStage = ''
    wrapper.vm.announceConversationPage()
    await settle(wrapper)
    const header = () =>
      wrapper.find('.conversation-message--patient-info .conversation-message__header')
    expect(header().text()).toContain('患者信息填写')
    expect(header().text()).toContain('必填（5/5）')
    expect(header().find('button[aria-label="播放此回复"]').exists()).toBe(true)
    expect(
      wrapper.findAll('.conversation-message-row--patient-info > .conversation-message__speaker').length
    ).toBe(0)
    wrapper.vm.fields.phone = ''
    await settle(wrapper)
    expect(header().text()).toContain('必填（4/5）')
    wrapper.vm.fields.phone = '1234567890'
    await settle(wrapper)
    expect(header().text()).toContain('必填（4/5）')
    wrapper.vm.fields.phone = '13800138000'
    await settle(wrapper)
    expect(header().text()).toContain('必填（5/5）')
    Object.assign(wrapper.vm.fields, {
      phone: '',
      marriage: '',
      occupation: '',
      emergencyContact: '',
      relationship: '',
    })
    await settle(wrapper)
    expect(header().text()).toContain('必填（0/5）')
    expect(header().find('button[aria-label="播放此回复"]').exists()).toBe(true)
    wrapper.destroy()
  })

  it('asks only for missing patient details in a follow-up card and updates its progress', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      phone: '',
      marriage: '',
      occupation: '',
      emergencyContact: '',
      relationship: '',
    })
    wrapper.vm.initialPatientInfoRequestPending = true
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    expect(wrapper.find('.conversation-follow-up').exists()).toBe(false)

    api.extract.mockResolvedValueOnce({ fields: { phone: '13800138000' } })
    await wrapper.vm.submitConversationInput('联系电话13800138000')
    await settle(wrapper)
    let card = wrapper.find('.conversation-follow-up')
    expect(card.find('.conversation-follow-up__header').text()).toContain('必填信息 1/5')
    expect(card.find('.conversation-follow-up__missing').text()).toContain(
      '婚姻状况、职业、紧急联系人姓名、与患者关系'
    )
    expect(card.find('.conversation-follow-up__missing').text()).not.toContain('联系电话')
    expect(card.find('.conversation-follow-up__question').text()).toContain('您的婚姻状况')
    expect(
      card.findAll('.conversation-dialog__choices button').wrappers.map((item) => item.text())
    ).toEqual(['未婚', '已婚', '离异', '丧偶'])

    await card
      .findAll('button')
      .wrappers.find((item) => item.text() === '已婚')
      .trigger('click')
    await settle(wrapper)
    card = wrapper.find('.conversation-follow-up')
    expect(card.find('.conversation-follow-up__header').text()).toContain('必填信息 2/5')
    expect(card.find('.conversation-follow-up__missing').text()).not.toContain('婚姻状况')
    expect(card.find('.conversation-follow-up__question').text()).toBe('请问您的职业是什么？')
    expect(wrapper.vm.fields.phone).toBe('13800138000')

    Object.assign(wrapper.vm.fields, {
      occupation: '职工',
      emergencyContact: '演示联系人',
      relationship: '配偶',
    })
    await settle(wrapper)
    expect(wrapper.find('.conversation-follow-up__header').text()).toContain('补充选填信息')
    expect(wrapper.find('.conversation-follow-up__header').text()).toContain('必填信息 5/5')
    wrapper.vm.announceConversationQuestion()
    await settle(wrapper)
    expect(
      wrapper.findAll('.conversation-message__header').wrappers.map((item) => item.text())
    ).toContain('内容确认')
    await wrapper.vm.persistConversation({
      utterance: '接下来怎么做',
      response: wrapper.vm.nextConversationQuestion,
      action: 'manual_turn',
    })
    expect(wrapper.vm.conversationMessages.at(-1).title).toBe('内容确认')
    await wrapper.vm.submitConversationInput('跳过')
    await settle(wrapper)
    expect(wrapper.find('.conversation-follow-up').exists()).toBe(false)
    expect(wrapper.vm.page).toBe('form')
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.vm.page = 'review'
    await settle(wrapper)
    expect(wrapper.vm.patientInfoFollowUp).toBe(null)
    wrapper.destroy()
  })

  it('appends conversation turns in the same page flow immediately above the voice input', async () => {
    const wrapper = mountApp()
    wrapper.vm.workflowHistory.push({
      title: '身份核验',
      text: '已完成',
      fields: [],
    })
    wrapper.vm.dialogMessages.push(
      { role: 'patient', text: '测试问题' },
      { role: 'assistant', text: '测试回复' }
    )
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    const pageContent = wrapper.find('.page-content')
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    const voiceStage = wrapper.find('.voice-stage')
    expect(pageContent.find('.workflow-history').exists()).toBe(true)
    expect(pageContent.element.contains(dialog.element)).toBe(true)
    const history = pageContent.find('.workflow-history')
    const exitGuide = pageContent.find('.exit-guide')
    expect(history.element.nextElementSibling).toBe(dialog.element)
    expect(dialog.element.nextElementSibling).toBe(exitGuide.element)
    expect(dialog.find('.conversation-message--patient').text()).toContain('测试问题')
    expect(dialog.find('.conversation-message--assistant').text()).toContain('测试回复')
    expect(pageContent.element.nextElementSibling).toBe(voiceStage.element)
    expect(wrapper.find('.serial-line').exists()).toBe(false)
    expect(exitGuide.text()).toBe('退出智能登记')
    expect(wrapper.find('.bar-exit').exists()).toBe(false)
    await exitGuide.trigger('click')
    expect(wrapper.find('.exit-guide').exists()).toBe(false)
    expect(wrapper.find('.bar-exit').exists()).toBe(true)
    wrapper.destroy()
  })

  it('shows a voice error once when the conversation dialog is open', async () => {
    const wrapper = mountApp()
    wrapper.vm.page = 'applications'
    wrapper.vm.conversationVisible = true
    wrapper.vm.voiceError = '说话时间太短，请按住麦克风说话。'
    await settle(wrapper)

    expect(wrapper.findAll('.voice-error, .conversation-dialog__error')).toHaveLength(1)
    wrapper.destroy()
  })

  it('follows conversation turns but ignores delayed page growth', async () => {
    const page = document.scrollingElement || document.documentElement
    const height = vi.spyOn(page, 'scrollHeight', 'get').mockReturnValue(1800)
    const wrapper = mountApp()
    try {
      page.scrollTop = 0
      wrapper.vm.openManualInput()
      await settle(wrapper)
      expect(page.scrollTop).toBe(1800)

      page.scrollTop = 120
      height.mockReturnValue(2400)
      wrapper.vm.appendConversationMessages(null, {
        role: 'assistant',
        text: '新的回复',
      })
      await settle(wrapper)
      expect(page.scrollTop).toBe(2400)

      height.mockReturnValue(2800)
      await settle(wrapper)
      expect(page.scrollTop).toBe(2400)

      wrapper.vm.reset()
      await settle(wrapper)
      expect(page.scrollTop).toBe(0)
    } finally {
      wrapper.destroy()
      height.mockRestore()
      page.scrollTop = 0
    }
  })

  it('keeps the full manual form and AI conversation together on one page', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      phone: '',
      marriage: '',
      occupation: '',
    })
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.find('[role="region"]').exists()).toBe(true)
    expect(dialog.find('[aria-modal]').exists()).toBe(false)
    expect(wrapper.find('.page-content').attributes('style') || '').not.toContain('display: none')
    expect(wrapper.find('#phone').exists()).toBe(true)
    expect(wrapper.find('#marriage').exists()).toBe(true)
    expect(wrapper.find('#emergencyContact').exists()).toBe(true)
    api.extract.mockResolvedValueOnce({
      fields: { phone: '13800138000', marriage: '未婚' },
    })
    await wrapper.vm.submitConversationInput('联系电话13800138000，婚姻状况未婚')
    await settle(wrapper)
    expect(api.extract.mock.calls[0][1]).toBe(0)
    expect(wrapper.vm.fields.phone).toBe('13800138000')
    expect(wrapper.vm.fields.marriage).toBe('未婚')
    expect(wrapper.vm.nextConversationField.key).toBe('occupation')
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.dialogMessages.some((message) => message.text.includes('13800138000'))).toBe(
      true
    )
    expect(dialog.find('[aria-label="收起对话"]').exists()).toBe(false)
    await wrapper.find('#emergencyContact').setValue('测试联系人')
    expect(wrapper.vm.fields.phone).toBe('13800138000')
    expect(wrapper.vm.fields.marriage).toBe('未婚')
    expect(wrapper.vm.fields.emergencyContact).toBe('测试联系人')
    expect(wrapper.vm.conversationVisible).toBe(true)
    wrapper.destroy()
  })

  it('does not enter review while another patient group still has missing required information', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), emergencyContact: '' })
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    expect(wrapper.vm.nextPage()).toBe(false)
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.fieldErrors.emergencyContact).toBeTruthy()
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    [401, '已失效'],
    [429, '请求过于频繁'],
    [503, '服务连接失败'],
  ])('distinguishes HTTP %s from an unrecognized home utterance', async (status, expected) => {
    const wrapper = mountApp()
    api.intent.mockRejectedValueOnce(Object.assign(new Error('internal error'), { status }))
    await wrapper.vm.submitConversationInput('你好')
    expect(wrapper.vm.aiNotice).toContain(expected)
    expect(wrapper.vm.aiNotice).not.toContain('没能确定您的需求')
    expect(wrapper.vm.transcript).toBe('你好')
    wrapper.destroy()
  })

  it('does not advance when saving pending manual changes fails', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.employerName = '测试单位'
    wrapper.vm.onFieldChange('employerName')
    api.saveTurn.mockRejectedValueOnce(Object.assign(new Error('stale revision'), { status: 409 }))
    await wrapper.vm.selectConversationOption('继续下一页')
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.manualPendingFields.employerName).toBe('测试单位')
    expect(wrapper.vm.aiNotice).toContain('会话已在其他窗口更新')
    wrapper.destroy()
  })

  it('waits for an in-flight manual save before binding the final review revision', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await wrapper.vm.conversationWrite
    api.saveTurn.mockClear()
    wrapper.vm.page = 'review'
    wrapper.vm.fields.employerName = '测试单位'
    wrapper.vm.onFieldChange('employerName')
    let finishSave
    api.saveTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        })
    )
    const save = wrapper.vm.flushManualChanges()
    await vi.waitFor(() => expect(api.saveTurn).toHaveBeenCalledOnce())
    api.submit.mockResolvedValueOnce({ status: 'success' })
    const submission = wrapper.vm.submit()
    await settle(wrapper)
    expect(api.confirmReview).not.toHaveBeenCalled()
    finishSave({ revision: 1, lastTurnId: 'manual-save' })
    await Promise.all([save, submission])
    expect(api.confirmReview).toHaveBeenCalledWith(
      'session-demo-001',
      expect.objectContaining({ expectedRevision: 1 }),
      expect.anything()
    )
    wrapper.destroy()
  })

  it('discards saved dialogue arriving after a reset', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    let finishSave
    api.saveTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        })
    )
    const pending = wrapper.vm.persistConversation({
      utterance: '测试问题',
      response: '测试回复',
      action: 'manual_turn',
    })
    await vi.waitFor(() => expect(api.saveTurn).toHaveBeenCalledOnce())
    wrapper.vm.reset()
    finishSave({ revision: 8, lastTurnId: 'old-turn' })
    await pending
    expect(wrapper.vm.sessionRevision).toBe(0)
    expect(wrapper.vm.lastTurnId).toBe(null)
    expect(wrapper.vm.conversationMessages).toEqual([])
    wrapper.destroy()
  })

  it('ignores identity verification that completes after returning home', async () => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    let finishVerify
    api.verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishVerify = resolve
        })
    )
    const pending = wrapper.vm.verifyIdentity()
    wrapper.vm.reset()
    finishVerify({ identityToken: 'old-identity', fields: validFields() })
    await pending
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.identityToken).toBe('')
    expect(wrapper.vm.fields.phone).toBe('')
    wrapper.destroy()
  })

  it('ignores a result query that finishes after returning home', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'result'
    wrapper.vm.result = { status: 'unknown' }
    wrapper.vm.idempotencyKey = 'original-key'
    let finishQuery
    api.result.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuery = resolve
        })
    )
    const pending = wrapper.vm.checkResult()
    wrapper.vm.reset()
    finishQuery({ status: 'success' })
    await pending
    expect(wrapper.vm.result).toBe(null)
    expect(wrapper.vm.page).toBe('home')
    wrapper.destroy()
  })

  it('routes ASR continue through the same page validation as text input', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.nativeRegion = ['210000', '210100', '210103']
    wrapper.vm.fields.residentRegion = ['110000', '110105']
    wrapper.vm.fields.addressDetail = '望京街道1号'
    api.upload.mockResolvedValueOnce({ text: '继续下一页' })
    wrapper.vm.recordingPage = 'form'
    await wrapper.vm.handleRecordingComplete(new Blob(['audio']), false, wrapper.vm.generation)
    expect(wrapper.vm.step).toBe(2)
    expect(api.extract).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('lets the patient correct recognized speech before submitting from review', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    wrapper.vm.recordingPage = 'review'
    await wrapper.vm.$nextTick()
    api.upload.mockResolvedValueOnce({ text: '确认提交' })

    await wrapper.vm.handleRecordingComplete(new Blob(['audio']), false, wrapper.vm.generation)

    expect(wrapper.vm.page).toBe('review')
    expect(wrapper.vm.conversationVisible).toBe(true)
    wrapper.vm.conversationInputMode = 'text'
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.voice-pill__input')
    expect(input.element.value).toBe('确认提交')
    expect(api.submit).not.toHaveBeenCalled()

    await input.setValue('不要提交')
    await wrapper.find('.voice-pill--text').trigger('submit')
    await settle(wrapper)

    expect(api.confirmReview).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    expect(wrapper.vm.page).toBe('review')
    wrapper.destroy()
  })

  it('clears application-stage dialogue notices when moving into the form', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'applications'
    await wrapper.vm.submitConversationInput('下一步做什么')
    expect(wrapper.vm.aiNotice).toContain('请核对')
    await wrapper.vm.continueWithApplication()
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.aiNotice).toBe('')
    expect(wrapper.vm.transcript).toBe('')
    wrapper.destroy()
  })

  it('opens cancellation confirmation from dialogue and retains the form', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await wrapper.vm.submitConversationInput('取消办理，回首页')
    expect(wrapper.vm.cancelVisible).toBe(true)
    expect(wrapper.vm.fields.phone).toBe(validFields().phone)
    expect(api.extract).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('does not treat a negated submit or a generic acknowledgement as final consent', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    for (const text of ['好的', '还没确认', '不要提交', '确认提交但先修改职业']) {
      await wrapper.vm.submitConversationInput(text)
      expect(wrapper.vm.page).toBe('review')
      expect(wrapper.vm.aiNotice).not.toContain('请先完成身份核验')
    }
    expect(api.submit).not.toHaveBeenCalled()
    expect(api.extract).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('submits only explicit consent from review through the existing reviewed API', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    wrapper.vm.conversationVisible = true
    wrapper.vm.transcript = '确认提交。'
    await wrapper.vm.$nextTick()
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.find('.conversation-dialog__submit').text()).toContain('确认并提交入院登记')
    api.submit.mockResolvedValueOnce({
      status: 'success',
      receiptId: 'SYNTHETIC-001',
    })
    await dialog.find('.conversation-dialog__submit button').trigger('click')
    await settle(wrapper)
    expect(api.confirmReview).toHaveBeenCalledOnce()
    expect(api.submit).toHaveBeenCalledOnce()
    expect(wrapper.vm.page).toBe('result')
    expect(wrapper.vm.conversationVisible).toBe(true)
    expect(wrapper.vm.transcript).toBe('')
    expect(wrapper.vm.aiNotice).toBe('')
    wrapper.destroy()
  })

  it('blocks direct submission before the final review page', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await wrapper.vm.submit()
    expect(api.submit).not.toHaveBeenCalled()
    expect(api.confirmReview).not.toHaveBeenCalled()
    expect(wrapper.vm.page).toBe('form')
    wrapper.destroy()
  })

  it('treats review edits as confirmed-value conflicts and preserves unrelated fields', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    api.extract.mockResolvedValueOnce({
      fields: { occupation: '学生', relationship: '非亲属' },
    })
    await wrapper.vm.submitConversationInput('职业改成学生')
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.step).toBe(2)
    expect(wrapper.vm.fields.occupation).toBe('职工')
    expect(wrapper.vm.pendingCandidates.occupation).toBe('学生')
    expect(wrapper.vm.pendingCandidates.relationship).toBeUndefined()
    expect(wrapper.vm.fields.relationship).toBe('子女')
    expect(wrapper.vm.fields.phone).toBe(validFields().phone)
    await wrapper.vm.resolveCandidate(true)
    expect(wrapper.vm.fields.occupation).toBe('学生')
    expect(wrapper.vm.sources.occupation).toBe('manual')
    wrapper.destroy()
  })

  it('offers dictionary choices in the dialog when a review edit cannot be extracted', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({ fields: {} })
    await wrapper.vm.submitConversationInput('职业改成护士')
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.fields.occupation).toBe('职工')
    expect(wrapper.vm.fallbackChoiceKey).toBe('occupation')
    expect(wrapper.vm.aiNotice).toContain('职业')
    const labels = wrapper
      .findAll('.conversation-dialog__choices button')
      .wrappers.map((button) => button.text())
    expect(labels).toEqual(['职工', '农民', '退休', '无业', '学生', '其他'])
    await wrapper.vm.selectConversationOption('学生')
    expect(wrapper.vm.fields.occupation).toBe('学生')
    expect(wrapper.vm.sources.occupation).toBe('manual')
    expect(wrapper.vm.fallbackChoiceKey).toBe('')
    expect(wrapper.vm.aiNotice).toBe(
      '已记录职业：学生。登记资料还有选填内容未填写：籍贯地址、现住地址、详细地址、工作单位名称、工作单位地址。您可以一次补充多项；要继续补充，还是进入核对页？'
    )
    wrapper.destroy()
  })

  it('offers relationship choices when a daughter relation is not extracted', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), relationship: '' })
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({ fields: {} })

    await wrapper.vm.submitConversationInput('她是我的女儿')

    expect(wrapper.vm.fields.relationship).toBe('')
    expect(
      wrapper
        .findAll('.conversation-dialog__choices button')
        .wrappers.map((button) => button.text())
    ).toEqual([
      '配偶',
      '子女',
      '父母',
      '祖父母/外祖父母',
      '孙辈/外孙辈',
      '兄弟姐妹',
      '其他亲属',
      '非亲属',
    ])

    await wrapper.vm.selectConversationOption('子女')

    expect(wrapper.vm.fields.relationship).toBe('子女')
    expect(wrapper.vm.sources.relationship).toBe('manual')
    wrapper.destroy()
  })

  it('offers occupation choices for a short form edit the model cannot extract', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({ fields: {} })

    await wrapper.vm.submitConversationInput('职业改成护士')

    expect(wrapper.vm.fields.occupation).toBe('职工')
    expect(wrapper.vm.fallbackChoiceKey).toBe('occupation')
    expect(
      wrapper
        .findAll('.conversation-dialog__choices button')
        .wrappers.map((button) => button.text())
    ).toEqual(['职工', '农民', '退休', '无业', '学生', '其他'])

    await wrapper.vm.selectConversationOption('其他')

    expect(wrapper.vm.fields.occupation).toBe('其他')
    expect(wrapper.vm.sources.occupation).toBe('manual')
    expect(wrapper.vm.fallbackChoiceKey).toBe('')
    wrapper.destroy()
  })

  it('keeps reliable fields while offering choices for an uncertain occupation', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({ fields: { employerName: '演示医院' } })

    await wrapper.vm.submitConversationInput('职业改成护士，工作单位是演示医院')

    expect(wrapper.vm.fields.employerName).toBe('演示医院')
    expect(wrapper.vm.fields.occupation).toBe('职工')
    expect(wrapper.vm.fallbackChoiceKey).toBe('occupation')
    expect(wrapper.vm.aiNotice).toContain('请从下方选项中选择')
    wrapper.destroy()
  })

  it('does not reapply a previous field answer while asking for the emergency contact', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      employerName: '',
      occupation: '',
      emergencyContact: '',
    })
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    const repeatedAnswer = {
      fields: { employerName: '我的工作单位', occupation: '职工' },
    }
    api.extract.mockResolvedValue(repeatedAnswer)

    await wrapper.vm.submitConversationInput('我的工作单位，职业是职工。')
    expect(wrapper.vm.fields.occupation).toBe('职工')
    expect(wrapper.vm.fields.employerName).toBe('')
    expect(wrapper.vm.nextConversationField.key).toBe('emergencyContact')

    await wrapper.vm.submitConversationInput('我的工作单位，职业是职工。')

    expect(wrapper.vm.fields.employerName).toBe('')
    expect(wrapper.vm.fields.emergencyContact).toBe('')
    expect(wrapper.vm.aiNotice).toContain('紧急联系人')
    wrapper.destroy()
  })

  it('keeps advance commands working while fallback choices are pending', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    api.extract.mockResolvedValueOnce({ fields: {} })
    await wrapper.vm.submitConversationInput('职业改成护士')
    expect(wrapper.vm.fallbackChoiceKey).toBe('occupation')
    await wrapper.vm.selectConversationOption('进入核对页')
    expect(wrapper.vm.page).toBe('review')
    expect(wrapper.vm.fields.occupation).toBe('职工')
    expect(wrapper.vm.fallbackChoiceKey).toBe('')
    wrapper.destroy()
  })

  it('does not flag an equal region array as a conflicting new value', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.nativeRegion = ['210000', '210100', '210103']
    wrapper.vm.sources.nativeRegion = 'manual'
    api.extract.mockResolvedValueOnce({
      fields: { nativeRegion: ['210000', '210100', '210103'] },
    })
    await wrapper.vm.applyAi('籍贯辽宁省沈阳市沈河区', wrapper.vm.generation)
    expect(wrapper.vm.pendingCandidates.nativeRegion).toBeUndefined()
    expect(wrapper.vm.candidateDialogKey).toBe('')
    wrapper.destroy()
  })

  it('adds the active phone field as AI context while keeping the displayed reply masked', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), phone: '' })
    expect(wrapper.vm.nextConversationField.key).toBe('phone')
    wrapper.vm.openConversation('text')
    await settle(wrapper)
    api.extract.mockResolvedValueOnce({
      fields: { phone: '13900001111' },
      modelName: 'Qwen Display',
    })

    await wrapper.vm.submitConversationInput('13900001111')

    expect(api.extract.mock.calls[0][0]).toBe('联系电话13900001111')
    expect(wrapper.vm.fields.phone).toBe('13900001111')
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('139****1111')
    expect(dialog.text()).not.toContain('13900001111')
    expect(dialog.text()).toContain('模型名称：Qwen Display')
    expect(dialog.text()).toContain('【已回填，请核对】\n• 联系电话：139****1111')
    wrapper.destroy()
  })

  it.each([
    ['平台登录已失效，请重新登录', '平台登录已失效'],
    ['身份核验已失效，请重新核验', '身份核验已失效'],
  ])('identifies the source of an extraction 401', async (detail, expected) => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    api.extract.mockRejectedValueOnce({ status: 401, body: { detail } })

    await wrapper.vm.applyAi('联系电话13800138000', wrapper.vm.generation)

    expect(wrapper.vm.aiNotice).toContain(expected)
    expect(wrapper.vm.aiNotice).not.toContain('登录并核验')
    wrapper.destroy()
  })

  it('reverts candidates when conversation saving fails', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    api.extract.mockResolvedValueOnce({ fields: { phone: '13900139000' } })
    api.saveTurn.mockRejectedValueOnce({ status: 401 })

    await wrapper.vm.applyAi('联系电话13900139000', wrapper.vm.generation)

    expect(wrapper.vm.fields.phone).toBe(validFields().phone)
    expect(wrapper.vm.aiNotice).toContain('候选信息已撤回')
    expect(wrapper.vm.aiNotice).toContain('本轮对话未能保存')
    expect(wrapper.vm.aiNotice).not.toContain('解析失败')
    wrapper.destroy()
  })

  it('masks identity and phone displays while retaining submission values', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.idNumber = '110101199001011234'
    expect(wrapper.vm.reviewValueLabel('idNumber')).toBe('110101********1234')
    expect(wrapper.vm.reviewValueLabel('phone')).toBe('138****8000')
    expect(wrapper.vm.fields.phone).toBe(validFields().phone)
    wrapper.destroy()
  })

  it('uses the same empty-value label for region and other review fields', async () => {
    const wrapper = mountApp()
    wrapper.vm.fields.nativeRegion = []
    wrapper.vm.fields.residentRegion = []
    wrapper.vm.fields.employerName = ''

    expect(wrapper.vm.reviewValueLabel('nativeRegion')).toBe('未填写')
    expect(wrapper.vm.reviewValueLabel('residentRegion')).toBe('未填写')
    expect(wrapper.vm.reviewValueLabel('employerName')).toBe('未填写')
    wrapper.destroy()
  })

  it('shows a live, masked registration summary and clear confirmation instructions in review chat', async () => {
    const wrapper = mountApp()
    wrapper.vm.fields = {
      ...validFields(),
      idNumber: '110101199001011234',
    }
    wrapper.vm.activeApplication = application()
    wrapper.vm.page = 'review'
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('以下是本次入院登记信息，请逐项核对')
    expect(dialog.text()).toContain('确认无误请说“确认提交”')
    expect(dialog.text()).toContain('职业改为学生')
    expect(dialog.text()).toContain('确认后将提交本次模拟登记')
    expect(dialog.text()).toContain('APP-DEMO-001')
    expect(dialog.text()).toContain('心内科')
    expect(dialog.text()).toContain('110101********1234')
    expect(dialog.text()).toContain('138****8000')
    expect(dialog.text()).not.toContain('110101199001011234')
    expect(dialog.text()).not.toContain('13800138000')
    expect(api.saveTurn).not.toHaveBeenCalled()

    wrapper.vm.fields.phone = '13900139000'
    await settle(wrapper)
    expect(dialog.text()).toContain('139****9000')
    expect(dialog.text()).not.toContain('138****8000')
    wrapper.destroy()
  })

  it('edits review information on the same page and refreshes the summary immediately', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    const review = wrapper.findComponent({ name: 'ReviewPanel' })
    await review.findAll('.review-group-heading .el-button').at(1).trigger('click')
    const employerInput = review.findAll('.review-group').at(1).find('.review-fields input')
    await employerInput.setValue('新单位')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('review')
    expect(wrapper.vm.fields.employerName).toBe('新单位')
    expect(wrapper.vm.reviewValueLabel('employerName')).toBe('新单位')
    expect(wrapper.findComponent({ name: 'ConversationDialog' }).text()).toContain('新单位')
    await review.findAll('.review-group-heading .el-button').at(1).trigger('click')
    expect(review.find('.review-fields input').exists()).toBe(false)
    expect(review.text()).toContain('新单位')
    await review.findAll('.review-group-heading .el-button').at(0).trigger('click')
    await review.find('.review-phone-editor .phone-display').trigger('click')
    expect(review.find('.review-phone-editor .phone-display').text()).toBe('13800138000')
    review.findComponent({ name: 'KeypadDialog' }).vm.$emit('update:visible', false)
    await wrapper.vm.$nextTick()
    expect(review.find('.review-phone-editor .phone-display').text()).toBe('138****8000')
    wrapper.destroy()
  })

  it('persists manual edits without adding them to the AI conversation', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await wrapper.vm.conversationWrite
    api.saveTurn.mockClear()
    const conversationLength = wrapper.vm.conversationMessages.length
    const dialogLength = wrapper.vm.dialogMessages.length
    wrapper.vm.fields.employerName = '测试单位'
    wrapper.vm.onFieldChange('employerName')
    await wrapper.vm.flushManualChanges()
    expect(api.saveTurn).toHaveBeenCalledOnce()
    expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
      action: 'manual_edit',
      utterance: '手动修改 工作单位名称',
      fields: { employerName: '测试单位' },
    })
    expect(wrapper.vm.conversationMessages).toHaveLength(conversationLength)
    expect(wrapper.vm.dialogMessages).toHaveLength(dialogLength)
    wrapper.destroy()
  })

  it('saves keypad phone edits once when the keypad closes', async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    await enterForm(wrapper)
    await wrapper.vm.conversationWrite
    api.saveTurn.mockClear()
    wrapper.vm.fields.phone = ''
    await wrapper.vm.$nextTick()

    const form = wrapper.findComponent({ name: 'AdmissionForm' })
    await form.find('.keypad-trigger').trigger('click')
    const keypad = form.findComponent({ name: 'KeypadDialog' })
    await keypad.vm.tap('1')
    await vi.advanceTimersByTimeAsync(601)
    await keypad.vm.tap('3')
    await vi.advanceTimersByTimeAsync(601)

    expect(api.saveTurn).not.toHaveBeenCalled()
    keypad.vm.close()
    await settle(wrapper)

    expect(form.vm.keypadVisible).toBe(false)
    await wrapper.vm.conversationWrite
    expect(api.saveTurn).toHaveBeenCalledOnce()
    expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
      action: 'manual_edit',
      fields: { phone: '13' },
    })
    wrapper.destroy()
    vi.useRealTimers()
  })

  it('emphasizes every configured field label in assistant questions only', async () => {
    const wrapper = mountApp()
    wrapper.vm.page = 'form'
    wrapper.vm.conversationVisible = true
    wrapper.vm.appendConversationMessages(
      null,
      {
        role: 'assistant',
        text: '请告诉我您的紧急联系人姓名，以及联系电话。',
      },
      { role: 'patient', text: '联系电话13800138000' }
    )
    await settle(wrapper)

    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(
      dialog
        .findAll('.conversation-message--assistant')
        .wrappers.find((message) => message.text().includes('紧急联系人姓名'))
        .findAll('.conversation-message__field-label')
        .wrappers.map((label) => label.text())
    ).toEqual(['紧急联系人姓名', '联系电话'])
    expect(
      dialog.findAll('.conversation-message--patient .conversation-message__field-label')
    ).toHaveLength(0)
    expect(dialog.findAll('.conversation-message--patient').at(-1).text()).toContain('138****8000')
    wrapper.destroy()
  })

  it.each(['applications', 'result'])(
    'clears patient data after inactivity on %s',
    async (page) => {
      vi.useFakeTimers()
      const wrapper = mountApp()
      wrapper.vm.fields = validFields()
      wrapper.vm.page = page
      await vi.advanceTimersByTimeAsync(330000)
      expect(wrapper.vm.page).toBe('home')
      expect(wrapper.vm.fields.phone).toBe('')
      wrapper.destroy()
    }
  )

  it('locks navigation and editing while final submission is pending', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'review'
    let finishSubmission
    api.submit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSubmission = resolve
        })
    )
    const pending = wrapper.vm.submit()
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledOnce())
    wrapper.vm.editReviewStep(1)
    wrapper.vm.goBack()
    expect(wrapper.vm.page).toBe('review')
    finishSubmission({ status: 'success' })
    await pending
    wrapper.destroy()
  })

  it('queries an uncertain result from dialogue without issuing a new submission', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.page = 'result'
    wrapper.vm.result = { status: 'unknown' }
    wrapper.vm.idempotencyKey = 'original-key'
    api.result.mockResolvedValueOnce({ status: 'success' })
    await wrapper.vm.submitConversationInput('查询办理结果')
    expect(api.result).toHaveBeenCalledWith(
      'identity-demo-token',
      'original-key',
      expect.anything()
    )
    expect(api.submit).not.toHaveBeenCalled()
    expect(wrapper.vm.result.status).toBe('success')
    wrapper.destroy()
  })

  it('hides the account bar on home and routes the admission button to identity', async () => {
    const wrapper = mountApp()

    expect(wrapper.findAll('.prompt-button')).toHaveLength(4)
    expect(wrapper.find('.user-bar').exists()).toBe(false)
    await wrapper.findAll('.prompt-button').at(3).trigger('click')

    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.transcript).toBe('')
    expect(wrapper.vm.aiNotice).toBe('')
    expect(wrapper.find('.user-bar').exists()).toBe(false)
    wrapper.destroy()
  })

  it('automatically selects the sole valid patient application before opening the form', async () => {
    const wrapper = mountApp()
    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValue({ items: [application()] })

    await startAdmission(wrapper)
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('applications')
    expect(wrapper.vm.selectedApplicationId).toBe(application().id)
    expect(wrapper.find('.application-card').text()).toContain('心内科')
    expect(wrapper.findAll('.application-details > div')).toHaveLength(10)
    expect(wrapper.find('.application-card-top').exists()).toBe(false)
    expect(wrapper.find('.application-select').exists()).toBe(false)
    expect(wrapper.find('.application-card').text()).toContain('2026-10-22 09:00')
    expect(wrapper.find('.form-panel').exists()).toBe(false)
    wrapper.destroy()
  })

  it('keeps the application page open in AI dialogue until its confirmation button is clicked', async () => {
    await loadValidation()
    const wrapper = mountApp()
    wrapper.vm.page = 'identity'
    wrapper.vm.conversationVisible = true
    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValue({ items: [application()] })

    await wrapper.vm.verifyIdentity()

    expect(wrapper.vm.page).toBe('applications')
    expect(wrapper.vm.conversationVisible).toBe(true)
    expect(wrapper.find('.application-panel').exists()).toBe(true)
    expect(wrapper.find('.application-continue').exists()).toBe(false)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('申请单号APP-DEMO-001')
    expect(dialog.text()).toContain('患者演**者')
    expect(dialog.find('.conversation-dialog__application-confirm').exists()).toBe(true)

    await dialog.find('.conversation-dialog__application-confirm').trigger('click')
    await settle(wrapper)

    expect(api.selectApplication).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.conversationVisible).toBe(true)
    expect(wrapper.vm.fields.name).toBe('演示患者')
    wrapper.destroy()
  })

  it('starts voice input after confirming the application', async () => {
    const wrapper = mountApp()
    api.verify.mockResolvedValue({ identityToken: 'identity-demo-token', fields: validFields() })
    await startAdmission(wrapper)
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)
    expect(wrapper.vm.page).toBe('applications')

    await wrapper.find('.application-continue').trigger('click')
    await loadValidation()
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.find('.voice-pill--mic').exists()).toBe(true)
    expect(wrapper.find('.voice-pill--text').exists()).toBe(false)
    wrapper.destroy()
  })

  it('does not offer AI confirmation when no unique valid application exists', async () => {
    const wrapper = mountApp()
    wrapper.vm.page = 'identity'
    wrapper.vm.conversationVisible = true
    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValue({
      items: [application(), { ...application(), id: 'APP-DEMO-002' }],
    })

    await wrapper.vm.verifyIdentity()

    expect(wrapper.vm.page).toBe('applications')
    expect(wrapper.vm.selectedApplicationId).toBe('')
    expect(
      wrapper
        .findComponent({ name: 'ConversationDialog' })
        .find('.conversation-dialog__application-confirm')
        .exists()
    ).toBe(false)
    expect(wrapper.findComponent({ name: 'ConversationDialog' }).text()).toContain(
      '多份有效的入院申请单'
    )
    wrapper.destroy()
  })

  it('keeps the AI application page and explains when no valid application is found', async () => {
    const wrapper = mountApp()
    wrapper.vm.page = 'identity'
    wrapper.vm.conversationVisible = true
    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValue({ items: [] })

    await wrapper.vm.verifyIdentity()

    expect(wrapper.vm.page).toBe('applications')
    expect(wrapper.vm.conversationVisible).toBe(true)
    expect(wrapper.findComponent({ name: 'ConversationDialog' }).text()).toContain(
      '未查询到有效申请单'
    )
    expect(
      wrapper
        .findComponent({ name: 'ConversationDialog' })
        .find('.conversation-dialog__application-confirm')
        .exists()
    ).toBe(false)
    wrapper.destroy()
  })

  it('does not auto-select when multiple valid applications are returned', async () => {
    const wrapper = mountApp()
    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValue({
      items: [application(), { ...application(), id: 'APP-DEMO-002' }],
    })

    await startAdmission(wrapper)
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)

    expect(wrapper.vm.selectedApplicationId).toBe('')
    expect(wrapper.vm.applicationError).toContain('多份有效')
    expect(wrapper.find('.application-continue').attributes('disabled')).toBe('disabled')
    wrapper.destroy()
  })

  it('shows a separate review page before sending the final registration', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await nextFormPage(wrapper)
    wrapper.vm.transcript = '进入核对页'
    await wrapper.find('.confirm-submit').trigger('click')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('review')
    expect(wrapper.vm.aiNotice).toBe('')
    expect(wrapper.find('.transcript-status').exists()).toBe(false)
    expect(api.submit).not.toHaveBeenCalled()
    expect(wrapper.find('.review-panel').text()).toContain('APP-DEMO-001')
    api.submit.mockResolvedValueOnce({
      status: 'success',
      receiptId: 'SIM-0001',
    })
    await wrapper.find('.review-submit').trigger('click')
    await settle(wrapper)
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.page).toBe('result')
    wrapper.destroy()
  })

  it('passes measured microphone level into the live voice control', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })

    await startHomeRecording(wrapper)
    recorder.options.onLevel({ level: 0.42, soundDetected: true })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.volumeLevel).toBe(0.42)
    expect(wrapper.vm.soundDetected).toBe(true)
    // 按住期间弹窗尚未打开，波形展示在语音栏与全屏按住遮罩上。
    expect(wrapper.find('.voice-waveform').attributes('aria-label')).toBe('正在收音')
    expect(wrapper.find('.voice-hold-overlay').exists()).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(false)
    wrapper.destroy()
  })

  it('leaves recording for recognition when the recorder reports the speech has ended', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })

    await startHomeRecording(wrapper)
    expect(wrapper.vm.recording).toBe(true)

    // 录音器判定用户已经说完（静音超时），通知宿主切到识别状态。
    recorder.options.onSilenceStop()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.recording).toBe(false)
    expect(wrapper.vm.recognizing).toBe(true)
    expect(wrapper.vm.volumeLevel).toBe(0)
    expect(wrapper.vm.soundDetected).toBe(false)
    expect(wrapper.vm.holdActive).toBe(false)
    // 静音自动结束时弹窗随之打开，让识别结果与回复有处可看。
    expect(wrapper.vm.conversationVisible).toBe(true)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.find('.conversation-dialog__recording-feedback').text()).toContain('正在识别语音')
    wrapper.destroy()
  })

  it('sends manual home input through the same intent classifier', async () => {
    const wrapper = mountApp()
    api.intent.mockResolvedValueOnce({
      intent: 'begin_admission',
      reply: '请先完成身份核验。',
    })

    await wrapper.find('.manual-entry-button').trigger('click')
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    await wrapper.find('.voice-pill__input').setValue('请帮我办理住院')
    await wrapper.find('.voice-pill--text').trigger('submit')
    await settle(wrapper)

    expect(api.intent).toHaveBeenCalledWith('请帮我办理住院', expect.any(AbortSignal))
    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.conversationVisible).toBe(true)
    expect(wrapper.find('.page-content').text()).toContain('请帮我办理住院')
    expect(dialog.text()).toContain('请将证件放置到读卡区')
    wrapper.destroy()
  })

  it('preserves the same dialogue and appends guidance throughout the admission pages', async () => {
    const wrapper = mountApp()
    api.intent.mockResolvedValueOnce({
      intent: 'begin_admission',
      reply: '请先完成身份核验。',
    })
    api.verify.mockResolvedValueOnce({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    await wrapper.find('.manual-entry-button').trigger('click')
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    const messages = () =>
      wrapper
        .findAll(
          '.workflow-history .conversation-message, .conversation-dialog .conversation-message'
        )
        .wrappers.map((item) => item.text())
    let previous = messages()
    const retained = (guidance) => {
      expect(wrapper.vm.conversationVisible).toBe(true)
      const current = messages()
      expect(current.slice(0, previous.length)).toEqual(previous)
      expect(dialog.text()).toContain(guidance)
      previous = current
    }

    await wrapper.vm.submitConversationInput('请帮我办理住院')
    await settle(wrapper)
    retained('身份核验')
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)
    retained('本人入院申请单')
    await dialog.find('.conversation-dialog__application-confirm').trigger('click')
    await loadValidation()
    await settle(wrapper)
    retained('患者信息')
    wrapper.vm.nextPage()
    await settle(wrapper)
    retained('信息核对')
    api.submit.mockResolvedValueOnce({
      status: 'success',
      receiptId: 'SIM-RETAINED',
    })
    await wrapper.vm.submit()
    await settle(wrapper)
    retained('登记结果')
    wrapper.vm.finish()
    await settle(wrapper)
    expect(wrapper.vm.conversationVisible).toBe(false)
    wrapper.destroy()
  })

  it('keeps the home voice conversation open for identity verification', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '我要办理入院登记' })
    api.intent.mockResolvedValueOnce({
      intent: 'begin_admission',
      reply: '请先完成身份核验。',
    })

    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)

    // 松开发送后立即进入 AI 对话，识别请求不应让用户留在首页等待。
    expect(wrapper.vm.conversationVisible).toBe(true)
    expect(wrapper.vm.recognizing).toBe(true)
    expect(wrapper.findComponent({ name: 'ConversationDialog' }).text()).toContain('正在识别语音')

    await recorder.options.onComplete(new Blob(['voice']), false)
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.conversationVisible).toBe(true)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('请将证件放置到读卡区，然后点击“模拟刷卡”。')

    api.verify.mockResolvedValueOnce({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValueOnce({ items: [application()] })
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)

    expect(api.verify).toHaveBeenCalledOnce()
    expect(wrapper.vm.page).toBe('applications')
    expect(wrapper.vm.conversationVisible).toBe(true)
    wrapper.destroy()
  })

  it('cancels a pending identity verification when its conversation closes', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '我要办理入院登记' })
    api.intent.mockResolvedValueOnce({
      intent: 'begin_admission',
      reply: '请先完成身份核验。',
    })
    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)
    await settle(wrapper)

    let resolveVerification
    let verificationSignal
    api.verify.mockImplementationOnce((_method, _scenario, signal) => {
      verificationSignal = signal
      return new Promise((resolve) => {
        resolveVerification = resolve
      })
    })
    api.applications.mockResolvedValueOnce({ items: [application()] })
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)
    expect(wrapper.find('.reader-trigger').attributes('disabled')).toBe('disabled')

    await dialog.find('[aria-label="收起对话"]').trigger('click')
    expect(verificationSignal.aborted).toBe(true)
    resolveVerification({
      identityToken: 'stale-token',
      fields: validFields(),
    })
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.conversationVisible).toBe(false)
    expect(api.applications).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('answers page workflow questions without starting identity verification', async () => {
    const wrapper = mountApp()
    api.intent.mockResolvedValueOnce({
      intent: 'answer_question',
      reply: '先模拟身份核验，再确认申请单并填写资料。',
    })

    await wrapper.find('.manual-entry-button').trigger('click')
    await wrapper.find('.voice-pill__input').setValue('入院登记怎么办理？')
    await wrapper.find('.voice-pill--text').trigger('submit')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.aiNotice).toBe('先模拟身份核验，再确认申请单并填写资料。')
    expect(wrapper.vm.homeConversationMessages.at(-1)).toEqual({
      role: 'assistant',
      text: '先模拟身份核验，再确认申请单并填写资料。',
    })
    wrapper.destroy()
  })

  it('records directly from the held home mic and opens the dialog after release', async () => {
    const wrapper = mountApp()

    await wrapper.find('.mic-button').trigger('pointerdown')
    await settle(wrapper)

    // 按住即录，弹窗在按住期间保持关闭，由全屏遮罩展示状态。
    expect(api.platform).not.toHaveBeenCalled()
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(wrapper.vm.recording).toBe(true)
    expect(wrapper.vm.holdActive).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(false)

    await releaseHomeRecording(wrapper)

    expect(wrapper.vm.recording).toBe(false)
    expect(wrapper.vm.recognizing).toBe(true)
    expect(wrapper.vm.holdActive).toBe(false)
    expect(wrapper.vm.conversationVisible).toBe(true)
    wrapper.destroy()
  })

  it('answers admission questions from the home shortcuts in the same conversation', async () => {
    const wrapper = mountApp()
    api.intent.mockResolvedValueOnce({
      intent: 'answer_question',
      reply: '请提供紧急联系人姓名及与患者关系。',
    })
    await wrapper.findAll('.prompt-button').at(1).trigger('click')
    await settle(wrapper)
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.transcript).toBe('如何填写紧急联系人')
    expect(wrapper.vm.conversationVisible).toBe(true)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('如何填写紧急联系人')
    expect(dialog.text()).toContain('请提供紧急联系人姓名及与患者关系。')
    wrapper.destroy()
  })

  it.each([
    '我要入院登记。',
    '我要住院登记。',
    '我要办理入院。',
    '我要入院。',
    '办理住院。',
    '请帮我办个住院手续。',
    '我想办一下住院的事',
  ])('asks AI to classify the admission synonym %s', async (text) => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text })
    api.intent.mockResolvedValueOnce({
      intent: 'begin_admission',
      reply: '请先完成身份核验。',
    })

    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)

    expect(api.intent).toHaveBeenCalledWith(text, expect.any(AbortSignal))
    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.transcript).toBe('')
    expect(wrapper.vm.aiNotice).toBe('')
    wrapper.destroy()
  })

  it('does not start admission for a negated registration request', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '我不想住院登记。' })
    api.intent.mockResolvedValueOnce({
      intent: 'unknown',
      reply: '明白，您暂时不想办理。',
    })

    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)

    expect(api.intent).toHaveBeenCalledWith('我不想住院登记。', expect.any(AbortSignal))
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.aiNotice).toBe('我没能确定您的需求，请说说您想办理什么。')
    wrapper.destroy()
  })

  it('answers an unrecognized weather request with the fixed scope reply', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '今天天气怎么样' })
    api.intent.mockResolvedValueOnce({
      intent: 'unknown',
      reply: '您是想办理入院登记吗？',
    })

    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)

    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.aiNotice).toBe('我没能确定您的需求，请说说您想办理什么。')
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('今天天气怎么样')
    expect(dialog.text()).toContain('我没能确定您的需求，请说说您想办理什么。')
    expect(wrapper.find('.transcript-bubble').exists()).toBe(false)
    expect(wrapper.find('.transcript-status').exists()).toBe(false)
    wrapper.destroy()
  })

  it('explains that an understood report request is unavailable on this page', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '帮我做报告解读' })
    api.intent.mockResolvedValueOnce({
      intent: 'unsupported',
      reply: '本演示目前仅支持入院登记。',
    })

    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)

    expect(api.intent).toHaveBeenCalledWith('帮我做报告解读', expect.any(AbortSignal))
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.transcript).toBe('帮我做报告解读')
    expect(wrapper.vm.aiNotice).toBe('抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。')
    wrapper.destroy()
  })

  it('discards a late home intent after the user resets the session', async () => {
    const wrapper = mountApp()
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '我想办一下住院的事' })
    let resolveIntent
    api.intent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveIntent = resolve
      })
    )

    await startHomeRecording(wrapper)
    await releaseHomeRecording(wrapper)
    const completion = recorder.options.onComplete(new Blob(['voice']), false)
    await vi.waitFor(() => expect(api.intent).toHaveBeenCalledOnce())
    wrapper.vm.reset()
    resolveIntent({ intent: 'begin_admission', reply: '请先完成身份核验。' })
    await completion

    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.transcript).toBe('')
    wrapper.destroy()
  })

  it('shows and refreshes the current local date and time in the header', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 19, 10, 12, 0))
    const wrapper = mountApp()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.screen-time').text()).toBe('2026年10月19日 星期一 上午10:12')

    await vi.advanceTimersByTimeAsync(60000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.screen-time').text()).toBe('2026年10月19日 星期一 上午10:13')
    wrapper.destroy()
  })

  it('walks from home through identity, both form pages, success, and back home', async () => {
    const wrapper = mountApp()
    api.submit.mockResolvedValue({
      status: 'success',
      receiptId: 'DEMO-RECEIPT-1',
    })

    await enterForm(wrapper)
    expect(wrapper.vm.fields.name).toBe('演示患者')
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.find('.entered-label').exists()).toBe(false)
    expect(wrapper.find('.form-title').text()).toBe('入院信息 1/2')

    await nextFormPage(wrapper)
    expect(wrapper.vm.step).toBe(2)
    await previousFormPage(wrapper)
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.fields.phone).toBe('13800138000')
    wrapper.vm.fields.phone = '13900139000'
    await wrapper.vm.$nextTick()

    await nextFormPage(wrapper)
    await submitSecondPage(wrapper)
    await settle(wrapper)
    expect(api.submit).toHaveBeenCalledOnce()
    expect(wrapper.vm.page).toBe('result')
    expect(wrapper.find('.receipt').text()).toContain('DEMO-RECEIPT-1')

    await wrapper.find('.secondary-action').trigger('click')
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.find('.user-bar').exists()).toBe(false)
    expect(wrapper.find('.mascot-stage').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ConversationCard' }).exists()).toBe(true)
    expect(wrapper.vm.identityToken).toBe('')
    wrapper.destroy()
  })

  it('flags an invalid phone immediately once the 11-digit keypad entry completes', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)

    // 号码键盘只限长度不限格式；位数补齐时就地校验，不等“下一步”。
    wrapper.vm.fields.phone = '123'
    wrapper.vm.onFieldChange('phone')
    expect(wrapper.vm.fieldErrors.phone).toBeUndefined()

    wrapper.vm.fields.phone = '12345678963'
    wrapper.vm.onFieldChange('phone')
    expect(wrapper.vm.fieldErrors.phone).toBe('请输入有效的11位手机号码')

    wrapper.vm.fields.phone = '13800138000'
    wrapper.vm.onFieldChange('phone')
    expect(wrapper.vm.fieldErrors.phone).toBeUndefined()
    wrapper.destroy()
  })

  it('blocks invalid required fields on each form page and continues after correction', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), phone: '' })

    await nextFormPage(wrapper)
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.fieldErrors.phone).toBeTruthy()
    expect(wrapper.find('#phone').element.closest('.field-row').classList).toContain(
      'field-row--invalid'
    )
    expect(api.submit).not.toHaveBeenCalled()

    wrapper.vm.fields.phone = '13800138000'
    wrapper.vm.onFieldChange('phone')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#phone').element.closest('.field-row').classList).not.toContain(
      'field-row--invalid'
    )
    await nextFormPage(wrapper)
    expect(wrapper.vm.step).toBe(2)

    wrapper.vm.fields.marriage = ''
    await submitSecondPage(wrapper)
    expect(wrapper.vm.step).toBe(2)
    expect(wrapper.vm.fieldErrors.marriage).toBeTruthy()
    expect(wrapper.find('#marriage').element.closest('.field-row').classList).toContain(
      'field-row--invalid'
    )
    expect(api.submit).not.toHaveBeenCalled()

    wrapper.vm.fields.marriage = '未婚'
    api.submit.mockResolvedValue({ status: 'success' })
    await submitSecondPage(wrapper)
    expect(wrapper.vm.page).toBe('result')
    wrapper.destroy()
  })

  it('enters a phone number with the on-screen keypad and handles delete and clear', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    expect(wrapper.find('.phone-display').text()).toBe('138****8000')
    wrapper.vm.fields.phone = ''
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    await wrapper.vm.$nextTick()
    await wrapper.find('.keypad-trigger').trigger('click')
    expect(wrapper.findComponent({ name: 'KeypadDialog' }).props('visible')).toBe(true)
    const page = document.scrollingElement || document.documentElement
    page.scrollTop = 300

    const clickKey = async (label) => {
      const key = wrapper
        .findComponent({ name: 'KeypadDialog' })
        .findAll('.keypad-grid .el-button')
        .wrappers.find((button) => button.text().trim() === label)
      expect(key, `keypad button "${label}"`).toBeTruthy()
      await key.trigger('click')
      await wrapper.vm.$nextTick()
    }
    await clickKey('1')
    expect(page.scrollTop).toBe(300)
    await clickKey('3')
    await clickKey('8')
    expect(wrapper.vm.fields.phone).toBe('138')
    expect(wrapper.find('.phone-display').text()).toBe('138')
    await clickKey('⌫')
    expect(wrapper.vm.fields.phone).toBe('13')
    await clickKey('X')
    expect(wrapper.vm.fields.phone).toBe('')

    wrapper.vm.fields.phone = '13800138000'
    await wrapper.vm.$nextTick()
    await clickKey('9')
    expect(wrapper.vm.fields.phone).toBe('13800138000')
    expect(wrapper.find('.phone-display').text()).toBe('13800138000')
    wrapper.findComponent({ name: 'KeypadDialog' }).vm.$emit('update:visible', false)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.phone-display').text()).toBe('138****8000')
    wrapper.destroy()
  })

  it('keeps the keypad open when the opening click reaches the document listener', async () => {
    // 真实浏览器里“打开键盘的那次点击”会继续冒泡到 document；只有把触发按钮
    // 也算作内部区域，键盘才不会刚打开就被同一次点击关掉。
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), phone: '' })
    await wrapper.find('.keypad-trigger').trigger('click')
    const dialog = wrapper.findComponent({ name: 'KeypadDialog' })
    expect(dialog.props('visible')).toBe(true)
    expect(dialog.props('anchor')).toBe(wrapper.find('.keypad-trigger').element)

    dialog.vm.onOutsideClick({
      target: wrapper.find('.keypad-trigger').element,
    })
    expect(dialog.props('visible')).toBe(true)

    dialog.vm.onOutsideClick({ target: document.body })
    await wrapper.vm.$nextTick()
    expect(dialog.props('visible')).toBe(false)
    wrapper.destroy()
  })

  it.each([
    [
      'service failure',
      new Error('mock service unavailable'),
      '请先使用身份证、社保卡或电子医保凭证确认身份，再为您办理入院登记。',
    ],
    [
      'verification timeout',
      Object.assign(new Error(), { name: 'AbortError' }),
      '请先使用身份证、社保卡或电子医保凭证确认身份，再为您办理入院登记。',
    ],
    [
      'patient profile not found',
      Object.assign(new Error(), { status: 404 }),
      '暂未查询到您的院内患者信息，请前往人工窗口协助办理入院登记。',
    ],
  ])('keeps identity screen and offers a retry after %s', async (_name, error, message) => {
    const wrapper = mountApp()
    api.verify.mockRejectedValueOnce(error)
    await startAdmission(wrapper)
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.verifying).toBe(false)
    expect(wrapper.find('.error-text').text()).toContain(message)

    api.verify.mockResolvedValueOnce({
      identityToken: 'retry-token',
      fields: validFields(),
    })
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)
    expect(wrapper.vm.page).toBe('applications')
    wrapper.destroy()
  })

  it('ignores duplicate identity verification while the first request is pending', async () => {
    const wrapper = mountApp()
    let resolveVerify
    api.verify.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVerify = resolve
      })
    )
    await startAdmission(wrapper)

    const trigger = wrapper.find('.reader-trigger')
    await trigger.trigger('click')
    await trigger.trigger('click')
    expect(api.verify).toHaveBeenCalledOnce()
    expect(wrapper.vm.verifying).toBe(true)
    expect(trigger.attributes('disabled')).toBe('disabled')

    resolveVerify({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    await settle(wrapper)
    expect(wrapper.vm.page).toBe('applications')
    wrapper.destroy()
  })

  it('records identity speech from the held mic and recognizes after release', async () => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '我的联系电话是13800138000' })

    await wrapper.find('.mic-button').trigger('pointerdown')
    await settle(wrapper)

    expect(wrapper.vm.recording).toBe(true)
    expect(wrapper.vm.holdActive).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(false)

    await releaseHomeRecording(wrapper)

    expect(wrapper.vm.recognizing).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(true)

    await recorder.options.onComplete(new Blob(['voice']), false)
    expect(api.upload).toHaveBeenCalledOnce()
    const uploadedAudio = api.upload.mock.calls[0][1].get('audio')
    expect(uploadedAudio.type).toBe('audio/wav')
    expect(uploadedAudio.name).toBe('admission-audio.wav')
    expect(wrapper.vm.transcript).toBe('我的联系电话是13800138000')
    expect(api.extract).not.toHaveBeenCalled()
    expect(wrapper.vm.recognizing).toBe(false)
    wrapper.destroy()
  })

  it('opens application voice input in the same conversation dialog', async () => {
    const wrapper = mountApp()
    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    api.applications.mockResolvedValue({ items: [application()] })
    await startAdmission(wrapper)
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)
    api.platform.mockResolvedValueOnce({ active: true })

    await wrapper.find('.mic-button').trigger('pointerdown')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('applications')
    expect(wrapper.vm.recording).toBe(true)
    expect(wrapper.vm.holdActive).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(false)

    await releaseHomeRecording(wrapper)

    expect(wrapper.vm.recognizing).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(true)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.find('.conversation-dialog').exists()).toBe(true)
    wrapper.destroy()
  })

  it('keeps the final speech result and warns when the recording limit is reached', async () => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '联系电话13800138000' })

    await toggleIdentityRecording(wrapper)
    await toggleIdentityRecording(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), true)

    expect(wrapper.vm.transcript).toBe('联系电话13800138000')
    expect(wrapper.vm.voiceError).toContain('60秒上限')
    wrapper.destroy()
  })

  it('does not start multiple recorders while microphone permission is pending', async () => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    let resolveStart
    recorder.start.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStart = resolve
      })
    )

    await wrapper.find('.mic-button').trigger('pointerdown')
    await settle(wrapper)
    expect(wrapper.vm.holdActive).toBe(true)
    // 麦克风权限请求仍在等待时，重复按下不应启动第二次录音。
    await wrapper.find('.mic-button').trigger('pointerdown')
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(api.platform).not.toHaveBeenCalled()
    expect(wrapper.vm.startingVoice).toBe(true)

    resolveStart()
    await settle(wrapper)
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(wrapper.vm.recording).toBe(true)

    await releaseHomeRecording(wrapper)
    expect(wrapper.vm.recording).toBe(false)
    wrapper.destroy()
  })

  it.each([
    ['empty recording', new Blob([]), null, '没有录到语音'],
    ['empty transcript', new Blob(['voice']), { text: '  ' }, '没有识别到语音内容'],
    [
      'speech service error',
      new Blob(['voice']),
      new Error('speech service unavailable'),
      'speech service unavailable',
    ],
  ])('shows recovery guidance for %s', async (_scenario, blob, uploadResult, expectedError) => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    api.platform.mockResolvedValueOnce({ active: true })
    if (uploadResult instanceof Error) api.upload.mockRejectedValueOnce(uploadResult)
    else if (uploadResult) api.upload.mockResolvedValueOnce(uploadResult)

    await toggleIdentityRecording(wrapper)
    await toggleIdentityRecording(wrapper)
    await recorder.options.onComplete(blob, false)

    expect(wrapper.vm.voiceError).toContain(expectedError)
    expect(wrapper.vm.recognizing).toBe(false)
    wrapper.destroy()
  })

  it('discards a speech result that finishes after the session resets', async () => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    api.platform.mockResolvedValueOnce({ active: true })
    let resolveUpload
    api.upload.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpload = resolve
      })
    )
    await toggleIdentityRecording(wrapper)
    await toggleIdentityRecording(wrapper)

    const completion = recorder.options.onComplete(new Blob(['voice']), false)
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledOnce())
    wrapper.vm.reset()
    resolveUpload({ text: '不应留存的语音内容' })
    await completion
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.transcript).toBe('')
    wrapper.destroy()
  })

  it('uses a form-page transcript to fill valid AI candidates', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), phone: '' })
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({
      text: '联系电话13800138000，联系人王小明',
    })
    api.extract.mockResolvedValueOnce({ fields: { phone: '13900139000' } })
    await holdMicAndRelease(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)
    await settle(wrapper)

    expect(wrapper.vm.transcript).toContain('联系电话')
    expect(api.extract).toHaveBeenCalledWith(
      '联系电话13800138000，联系人王小明',
      0,
      'identity-demo-token',
      'session-demo-001',
      expect.any(String),
      expect.any(AbortSignal)
    )
    expect(wrapper.vm.fields.phone).toBe('13900139000')
    expect(wrapper.vm.sources.phone).toBe('ai')
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('联系电话138****8000，联系人王小明')
    expect(dialog.text()).toContain('【已回填，请核对】\n• 联系电话：139****9000')
    expect(wrapper.find('.transcript-bubble').exists()).toBe(false)
    expect(wrapper.find('.transcript-status').exists()).toBe(false)
    expect(api.saveTurn).toHaveBeenCalledOnce()
    expect(api.saveTurn.mock.calls[0][0]).toBe('session-demo-001')
    expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
      utterance: '联系电话13800138000，联系人王小明',
      fields: { phone: '13900139000' },
      previousTurnId: null,
    })
    expect(wrapper.vm.sessionRevision).toBe(1)
    wrapper.destroy()
  })

  it('explains an invalid phone format and preserves the field for correction', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), phone: '' })
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({
      fields: {},
    })

    await wrapper.vm.submitConversationInput('1234567890')

    expect(wrapper.vm.aiNotice).toContain('联系电话格式不正确')
    expect(wrapper.vm.aiNotice).toContain('11位有效手机号码')
    expect(wrapper.vm.fields.phone).toBe('')
    expect(api.extract.mock.calls[0][0]).toBe('联系电话1234567890')
    wrapper.destroy()
  })

  it('explains an unsupported occupation and offers only configured choices', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), occupation: '' })
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({
      fields: {},
    })

    await wrapper.vm.submitConversationInput('护士')

    expect(wrapper.vm.aiNotice).toContain('职业不在可选项中')
    expect(wrapper.vm.aiNotice).toContain('职工、农民、退休、无业、学生、其他')
    expect(wrapper.vm.fallbackChoiceKey).toBe('occupation')
    expect(
      wrapper
        .findAll('.conversation-dialog__choices button')
        .wrappers.map((button) => button.text())
    ).toEqual(['职工', '农民', '退休', '无业', '学生', '其他'])
    expect(wrapper.vm.fields.occupation).toBe('')
    expect(api.extract.mock.calls[0][0]).toBe('职业护士')
    wrapper.destroy()
  })

  it('explains conflicting enum values and asks the patient to choose one', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({
      fields: {},
      errors: { marriage: '本次描述包含多个选项，请明确选择一项' },
    })

    await wrapper.vm.submitConversationInput('婚姻状况未婚又已婚')

    expect(wrapper.vm.aiNotice).toContain('婚姻状况包含相互冲突的多个值')
    expect(wrapper.vm.fallbackChoiceKey).toBe('marriage')
    expect(
      wrapper
        .findAll('.conversation-dialog__choices button')
        .wrappers.map((button) => button.text())
    ).toEqual(['未婚', '已婚', '离异', '丧偶'])
    expect(wrapper.vm.fields.marriage).toBe('未婚')
    wrapper.destroy()
  })

  it('replaces internal no-candidate language with a clear request for the missing information', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.conversationVisible = true
    api.extract.mockResolvedValueOnce({ fields: {} })

    await wrapper.vm.submitConversationInput('帮我看看')

    expect(wrapper.vm.aiNotice).toContain('我没能从这句话里识别出要填写的信息')
    expect(wrapper.vm.aiNotice).toContain('请说出信息名称和内容')
    expect(wrapper.vm.aiNotice).not.toContain('安全回填')
    wrapper.destroy()
  })

  it('opens the patient dialogue from voice or text and shows the next missing-field question', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), phone: '' })
    await holdMicAndRelease(wrapper)
    expect(wrapper.findComponent({ name: 'ConversationDialog' }).exists()).toBe(true)
    expect(wrapper.find('.conversation-dialog').text()).toContain('请告诉我您的联系电话')
    expect(wrapper.find('.conversation-dialog__input').exists()).toBe(false)
    expect(wrapper.find('.voice-pill__hold').exists()).toBe(true)
    expect(wrapper.vm.conversationVisible).toBe(true)
    wrapper.destroy()
  })

  it.each([
    [
      'marriage',
      '未婚',
      ['未婚', '已婚', '离异', '丧偶'],
      ['marriage', 'occupation', 'emergencyContact', 'relationship'],
      '还需要补充以下必填信息：婚姻状况、职业、紧急联系人姓名、与患者关系。',
      '还需要补充以下必填信息：职业、紧急联系人姓名、与患者关系。',
    ],
    [
      'occupation',
      '学生',
      ['职工', '农民', '退休', '无业', '学生', '其他'],
      ['occupation', 'emergencyContact', 'relationship'],
      '还需要补充以下必填信息：职业、紧急联系人姓名、与患者关系。',
      '还需要补充以下必填信息：紧急联系人姓名、与患者关系。',
    ],
    [
      'relationship',
      '子女',
      ['配偶', '子女', '父母', '祖父母/外祖父母', '孙辈/外孙辈', '兄弟姐妹', '其他亲属', '非亲属'],
      ['relationship'],
      '您与该联系人的关系是什么？',
      '已记录与患者关系：子女。登记资料还有选填内容未填写：籍贯地址、现住地址、详细地址、工作单位名称、工作单位地址。您可以一次补充多项；要继续补充，还是进入核对页？',
    ],
  ])(
    'offers the form choices for %s and applies a selected value',
    async (key, value, options, blankKeys, question, chainedReply) => {
      const wrapper = mountApp()
      await enterForm(wrapper, {
        ...validFields(),
        ...Object.fromEntries(blankKeys.map((blank) => [blank, ''])),
      })
      wrapper.vm.step = 2
      wrapper.vm.conversationVisible = true
      await settle(wrapper)

      const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
      expect(dialog.text()).toContain(question)
      expect(
        dialog
          .findAll('.conversation-dialog__choices button')
          .wrappers.map((button) => button.text())
      ).toEqual(options)

      await dialog
        .findAll('.conversation-dialog__choices button')
        .wrappers.find((button) => button.text() === value)
        .trigger('click')
      await settle(wrapper)

      expect(wrapper.vm.fields[key]).toBe(value)
      expect(wrapper.vm.sources[key]).toBe('manual')
      expect(api.extract).not.toHaveBeenCalled()
      expect(api.saveTurn).toHaveBeenCalledOnce()
      expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
        action: 'manual_edit',
        utterance: value,
        fields: { [key]: value },
      })
      expect(dialog.text()).toContain(chainedReply)
      wrapper.destroy()
    }
  )

  it('continues asking all patient information without a page transition', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, { ...validFields(), marriage: '' })
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('您的婚姻状况是未婚、已婚、离异还是丧偶？')
    expect(dialog.text()).not.toContain('继续下一页')
    await wrapper.vm.selectConversationOption('未婚')
    await settle(wrapper)
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.fields.marriage).toBe('未婚')
    expect(wrapper.vm.nextConversationQuestion).toContain(
      '籍贯地址、现住地址、详细地址、工作单位名称、工作单位地址'
    )
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('repeats only the current page decision when asked before advancing', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.nativeRegion = ['210000', '210100', '210103']
    wrapper.vm.fields.residentRegion = ['110000', '110105']
    wrapper.vm.fields.addressDetail = '望京街道1号'
    Object.assign(wrapper.vm.fields, {
      nativeRegion: ['210000', '210100', '210103'],
      residentRegion: ['110000', '110105'],
      addressDetail: '示例路1号',
      employerName: '示例单位',
      employerAddress: '示例路2号',
    })
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    expect(wrapper.vm.nextConversationQuestion).toBe(
      '患者信息已填写完成。请进入核对页统一核对，确认后再提交。'
    )
    await wrapper.vm.submitConversationInput('你的问题')

    expect(api.extract).not.toHaveBeenCalled()
    expect(wrapper.vm.dialogMessages.at(-1)).toMatchObject({
      role: 'assistant',
      text: '患者信息已填写完成。请进入核对页统一核对，确认后再提交。',
    })
    expect(wrapper.vm.step).toBe(1)
    wrapper.destroy()
  })

  it('asks for optional page fields before the continue confirmation', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.employerName = '示例单位'
    wrapper.vm.fields.employerAddress = '示例路1号'
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('登记资料还有选填内容未填写：籍贯地址、现住地址、详细地址。')
    expect(dialog.text()).toContain('您可以一次补充多项；要继续补充，还是进入核对页？')
    expect(
      dialog.findAll('.conversation-dialog__choices button').wrappers.map((button) => button.text())
    ).toEqual(['继续补充', '进入核对页'])

    api.extract.mockResolvedValueOnce({
      fields: { nativeRegion: ['210000', '210100', '210103'] },
    })
    await wrapper.vm.submitConversationInput('我的籍贯沈阳市沈河区')
    await settle(wrapper)
    expect(wrapper.vm.fields.nativeRegion).toEqual(['210000', '210100', '210103'])
    expect(dialog.text()).toContain('登记资料还有选填内容未填写：现住地址、详细地址。')

    api.extract.mockResolvedValueOnce({
      fields: {
        residentRegion: ['110000', '110105'],
        addressDetail: '望京街道1号',
      },
    })
    await wrapper.vm.submitConversationInput('现住北京市朝阳区，详细地址望京街道1号')
    await settle(wrapper)
    expect(wrapper.vm.fields.residentRegion).toEqual(['110000', '110105'])
    expect(wrapper.vm.fields.addressDetail).toBe('望京街道1号')
    expect(dialog.text()).toContain('患者信息已填写完成。请进入核对页统一核对，确认后再提交。')
    wrapper.destroy()
  })

  it('accepts all optional page fields from one utterance before showing advance choices', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.employerName = '示例单位'
    wrapper.vm.fields.employerAddress = '示例路1号'
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    api.extract.mockResolvedValueOnce({
      fields: {
        nativeRegion: ['210000', '210100', '210103'],
        residentRegion: ['110000', '110105'],
        addressDetail: '望京街道1号',
      },
    })

    await wrapper.vm.submitConversationInput(
      '籍贯辽宁省沈阳市沈河区，现住北京市朝阳区，详细地址望京街道1号'
    )
    await settle(wrapper)

    expect(wrapper.vm.fields.nativeRegion).toEqual(['210000', '210100', '210103'])
    expect(wrapper.vm.fields.residentRegion).toEqual(['110000', '110105'])
    expect(wrapper.vm.fields.addressDetail).toBe('望京街道1号')
    expect(wrapper.vm.emptyOptionalFields).toHaveLength(0)
    expect(wrapper.vm.nextConversationChoices).toEqual(['进入核对页', '暂不继续'])
    wrapper.destroy()
  })

  it('splits a labeled detailed address into current region and detail', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    api.extract.mockResolvedValueOnce({
      fields: {
        nativeRegion: ['210000', '210100', '210103'],
        residentRegion: ['210000', '210100', '210103'],
        addressDetail: '佳兆业中心',
      },
    })

    await wrapper.vm.submitConversationInput(
      '我的电话是13412348888，籍贯是辽宁省沈阳市沈河区，详细地址是辽宁省沈阳市沈河区佳兆业中心'
    )
    await settle(wrapper)

    expect(wrapper.vm.fields.nativeRegion).toEqual(['210000', '210100', '210103'])
    expect(wrapper.vm.fields.residentRegion).toEqual(['210000', '210100', '210103'])
    expect(wrapper.vm.fields.addressDetail).toBe('佳兆业中心')
    wrapper.destroy()
  })

  it('splits a standalone full address without guessing birthplace', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    api.extract.mockResolvedValueOnce({
      fields: {
        residentRegion: ['210000', '210100', '210104'],
        addressDetail: '黎明广场',
      },
    })

    await wrapper.vm.submitConversationInput('辽宁省沈阳市大东区黎明广场')
    await settle(wrapper)

    expect(wrapper.vm.fields.nativeRegion).toEqual([])
    expect(wrapper.vm.fields.residentRegion).toEqual(['210000', '210100', '210104'])
    expect(wrapper.vm.fields.addressDetail).toBe('黎明广场')
    wrapper.destroy()
  })

  it('explains province-city and city-district mismatches without changing the address', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.conversationVisible = true
    await settle(wrapper)
    const originalRegion = [...wrapper.vm.fields.nativeRegion]
    api.extract.mockResolvedValueOnce({ fields: {} })

    await wrapper.vm.submitConversationInput('籍贯山东省沈阳市沈河区')
    await settle(wrapper)

    expect(wrapper.vm.aiNotice).toContain('山东省与沈阳市不匹配')
    expect(wrapper.vm.aiNotice).toContain('沈阳市属于辽宁省')
    expect(wrapper.vm.fields.nativeRegion).toEqual(originalRegion)
    expect(api.extract).not.toHaveBeenCalled()

    await wrapper.vm.submitConversationInput('籍贯辽宁省大连市沈河区')
    await settle(wrapper)

    expect(wrapper.vm.aiNotice).toContain('大连市与沈河区不匹配')
    expect(wrapper.vm.aiNotice).toContain('沈河区属于沈阳市')
    expect(wrapper.vm.fields.nativeRegion).toEqual(originalRegion)
    expect(api.extract).not.toHaveBeenCalled()

    await wrapper.vm.submitConversationInput('现住地址辽宁省沈阳市朝阳区')
    await settle(wrapper)

    expect(wrapper.vm.aiNotice).toContain('沈阳市与朝阳区不匹配')
    expect(wrapper.vm.aiNotice).toContain('我没有修改表单')
    expect(wrapper.vm.fields.residentRegion).toEqual([])
    expect(api.extract).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('asks for page confirmation after skipping optional fields', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    await wrapper.vm.submitConversationInput('跳过')
    await settle(wrapper)

    expect(api.extract).not.toHaveBeenCalled()
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.nextConversationQuestion).toContain('选填项已跳过。是否进入核对页？')
    await wrapper.vm.submitConversationInput('下一页')
    expect(wrapper.vm.page).toBe('review')
    expect(wrapper.vm.step).toBe(1)
    wrapper.destroy()
  })

  it('asks for optional employer details after page two required fields are complete', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      nativeRegion: ['210000', '210100', '210103'],
      residentRegion: ['110000', '110105'],
      addressDetail: '望京街道1号',
    })
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    const supplementQuestion = '登记资料还有选填内容未填写：工作单位名称、工作单位地址。'
    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain(supplementQuestion)
    expect(
      dialog.findAll('.conversation-dialog__choices button').wrappers.map((button) => button.text())
    ).toEqual(['继续补充', '进入核对页'])
    api.extract.mockResolvedValueOnce({ fields: { employerName: '示例单位' } })
    await wrapper.vm.submitConversationInput('工作单位是示例单位')
    await settle(wrapper)
    expect(wrapper.vm.fields.employerName).toBe('示例单位')
    const latestAssistant = wrapper.vm.dialogMessages
      .filter((message) => message.role === 'assistant')
      .at(-1)
    expect(latestAssistant.text).toContain('登记资料还有选填内容未填写：工作单位地址。')

    api.extract.mockResolvedValueOnce({
      fields: { employerAddress: '示例路1号' },
    })
    await wrapper.vm.submitConversationInput('工作单位地址是示例路1号')
    await settle(wrapper)
    expect(wrapper.vm.fields.employerAddress).toBe('示例路1号')
    expect(wrapper.findComponent({ name: 'ConversationDialog' }).text()).toContain(
      '患者信息已填写完成。请进入核对页统一核对，确认后再提交。'
    )
    wrapper.destroy()
  })

  it('treats spoken skip on the last page as entering review without submission', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      nativeRegion: ['210000', '210100', '210103'],
      residentRegion: ['110000', '110105'],
      addressDetail: '望京街道1号',
      employerName: '示例单位',
      employerAddress: '示例路1号',
    })
    wrapper.vm.step = 2
    wrapper.vm.conversationVisible = true

    await wrapper.vm.submitConversationInput('跳过')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('review')
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('does not report success or save a continuation when page validation fails', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.phone = 'invalid'
    wrapper.vm.conversationVisible = true
    const saveCount = api.saveTurn.mock.calls.length

    await wrapper.vm.selectConversationOption('继续下一页')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.step).toBe(1)
    expect(api.saveTurn).toHaveBeenCalledTimes(saveCount)
    expect(wrapper.vm.aiNotice).not.toContain('开始填写下一页')
    wrapper.destroy()
  })

  it('stays on the page and shows a save error when continuation cannot be saved', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.nativeRegion = ['210000', '210100', '210103']
    wrapper.vm.fields.residentRegion = ['110000', '110105']
    wrapper.vm.fields.addressDetail = '望京街道1号'
    wrapper.vm.conversationVisible = true
    api.saveTurn.mockRejectedValueOnce({ status: 409 })

    await wrapper.vm.selectConversationOption('继续下一页')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.aiNotice).toContain('会话已在其他窗口更新')
    expect(wrapper.vm.aiNotice).not.toContain('开始填写下一页')
    wrapper.destroy()
  })

  it('uses an explicit text confirmation to advance without sending it to AI extraction', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.nativeRegion = ['210000', '210100', '210103']
    wrapper.vm.fields.residentRegion = ['110000', '110105']
    wrapper.vm.fields.addressDetail = '望京街道1号'
    Object.assign(wrapper.vm.fields, {
      nativeRegion: ['210000', '210100', '210103'],
      residentRegion: ['110000', '110105'],
      addressDetail: '示例路1号',
      employerName: '示例单位',
      employerAddress: '示例路2号',
    })
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    await wrapper.vm.submitConversationInput('继续下一页')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('review')
    expect(wrapper.vm.step).toBe(1)
    expect(api.extract).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('asks before entering the review page and does not submit on confirmation', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.step = 2
    wrapper.vm.fields.employerName = '示例单位'
    wrapper.vm.fields.employerAddress = '示例地址'
    Object.assign(wrapper.vm.fields, {
      nativeRegion: ['210000', '210100', '210103'],
      residentRegion: ['110000', '110105'],
      addressDetail: '示例路1号',
      employerName: '示例单位',
      employerAddress: '示例路2号',
    })
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    const dialog = wrapper.findComponent({ name: 'ConversationDialog' })
    expect(dialog.text()).toContain('患者信息已填写完成。请进入核对页统一核对，确认后再提交。')
    expect(
      dialog.findAll('.conversation-dialog__choices button').wrappers.map((button) => button.text())
    ).toEqual(['进入核对页', '暂不继续'])

    await dialog
      .findAll('.conversation-dialog__choices button')
      .wrappers.find((button) => button.text() === '进入核对页')
      .trigger('click')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('review')
    expect(api.confirmReview).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('keeps the current page when the patient chooses not to continue', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.fields.nativeRegion = ['210000', '210100', '210103']
    wrapper.vm.fields.residentRegion = ['110000', '110105']
    wrapper.vm.fields.addressDetail = '望京街道1号'
    wrapper.vm.conversationVisible = true
    await settle(wrapper)

    await wrapper.vm.submitConversationInput('暂不继续')
    await settle(wrapper)

    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.step).toBe(1)
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('confirms a conflicting candidate by voice without extracting it again', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      addressDetail: '沈阳市教作业中心',
    })
    wrapper.vm.sources.addressDetail = 'manual'
    api.platform.mockResolvedValue({ active: true })
    api.upload
      .mockResolvedValueOnce({ text: '地址是佳兆业中心，你写错了' })
      .mockResolvedValueOnce({ text: '好的，修改为佳兆业中心' })
    api.extract.mockResolvedValueOnce({
      fields: { addressDetail: '佳兆业中心' },
    })
    api.confirmCandidate.mockResolvedValueOnce({
      decision: 'accept_candidate',
    })
    await holdMicAndRelease(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)
    await settle(wrapper)

    expect(document.body.textContent).toContain('沈阳市教作业中心')
    expect(document.body.textContent).toContain('佳兆业中心')
    expect(wrapper.find('.candidate-confirmation-mic').exists()).toBe(true)
    await wrapper.find('.candidate-confirmation-mic').trigger('pointerdown')
    await settle(wrapper)
    wrapper.vm.holdStartedAt -= 5000
    window.dispatchEvent(new MouseEvent('pointerup'))
    await recorder.options.onComplete(new Blob(['voice']), false)
    await settle(wrapper)

    expect(api.extract).toHaveBeenCalledOnce()
    expect(api.confirmCandidate).toHaveBeenCalledWith(
      '好的，修改为佳兆业中心',
      'addressDetail',
      '沈阳市教作业中心',
      '佳兆业中心',
      expect.any(AbortSignal)
    )
    expect(wrapper.vm.fields.addressDetail).toBe('佳兆业中心')
    expect(wrapper.vm.candidateDialogKey).toBe('')
    wrapper.destroy()
  })

  it('keeps a conflict open when the voice confirmation is unclear', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      addressDetail: '沈阳市教作业中心',
    })
    wrapper.vm.sources.addressDetail = 'manual'
    api.platform.mockResolvedValue({ active: true })
    api.upload
      .mockResolvedValueOnce({ text: '地址是佳兆业中心，你写错了' })
      .mockResolvedValueOnce({ text: '我不太确定' })
    api.extract.mockResolvedValueOnce({
      fields: { addressDetail: '佳兆业中心' },
    })
    api.confirmCandidate.mockResolvedValueOnce({ decision: 'unknown' })

    for (let i = 0; i < 2; i += 1) {
      const holdTarget = i === 0 ? '.mic-button' : '.candidate-confirmation-mic'
      await wrapper.find(holdTarget).trigger('pointerdown')
      await settle(wrapper)
      wrapper.vm.holdStartedAt -= 5000
      window.dispatchEvent(new MouseEvent('pointerup'))
      await recorder.options.onComplete(new Blob(['voice']), false)
      await settle(wrapper)
    }

    expect(wrapper.vm.fields.addressDetail).toBe('沈阳市教作业中心')
    expect(wrapper.vm.pendingCandidates.addressDetail).toBe('佳兆业中心')
    expect(wrapper.vm.candidateDialogKey).toBe('addressDetail')
    expect(document.body.textContent).toContain('没能判断您的选择')

    await clickDialogButton('保留当前内容')
    expect(wrapper.vm.fields.addressDetail).toBe('沈阳市教作业中心')
    expect(wrapper.vm.pendingCandidates.addressDetail).toBeUndefined()
    expect(wrapper.vm.candidateDialogKey).toBe('')
    wrapper.destroy()
  })

  it('discards a late voice decision after the conflict was resolved by clicking', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper, {
      ...validFields(),
      addressDetail: '沈阳市教作业中心',
    })
    wrapper.vm.$set(wrapper.vm.pendingCandidates, 'addressDetail', '佳兆业中心')
    wrapper.vm.candidateDialogKey = 'addressDetail'
    let finishClassification
    api.confirmCandidate.mockImplementationOnce(
      () => new Promise((resolve) => (finishClassification = resolve))
    )

    const context = { ...wrapper.vm.candidateConfirmation }
    const classification = wrapper.vm.classifyCandidateConfirmation(
      '确认修改',
      wrapper.vm.generation,
      context
    )
    await vi.waitFor(() => expect(api.confirmCandidate).toHaveBeenCalledOnce())
    wrapper.vm.resolveCandidate(false)
    finishClassification({ decision: 'accept_candidate' })
    await classification

    expect(wrapper.vm.fields.addressDetail).toBe('沈阳市教作业中心')
    expect(wrapper.vm.pendingCandidates.addressDetail).toBeUndefined()
    expect(wrapper.vm.candidateDialogKey).toBe('')
    wrapper.destroy()
  })

  it('shows region candidates as readable names and applies their original codes', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    wrapper.vm.candidateDialogKey = 'nativeRegion'
    wrapper.vm.$set(wrapper.vm.pendingCandidates, 'nativeRegion', ['210000', '210100', '210103'])
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('辽宁省 / 沈阳市 / 沈河区')
    expect(document.body.textContent).not.toContain('210000')
    await clickDialogButton('修改为识别内容')
    expect(wrapper.vm.fields.nativeRegion).toEqual(['210000', '210100', '210103'])
    wrapper.destroy()
  })

  it.each([
    ['voice service unavailable', '服务暂不可用'],
    ['microphone permission denied', '麦克风权限被拒绝'],
  ])('shows a recoverable error when %s', async (message, errorText) => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    if (message === 'voice service unavailable') {
      api.platform.mockRejectedValueOnce(new Error(errorText))
      await wrapper.vm.startRecording()
      await settle(wrapper)
    } else {
      recorder.start.mockRejectedValueOnce(new Error(errorText))
      await toggleIdentityRecording(wrapper)
    }

    expect(wrapper.vm.recording).toBe(false)
    expect(wrapper.vm.voiceError).toBe(errorText)
    wrapper.destroy()
  })

  it('keeps the transcript when candidate extraction is unavailable', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    api.platform.mockResolvedValueOnce({ active: true })
    api.upload.mockResolvedValueOnce({ text: '联系电话13800138000' })
    api.extract.mockRejectedValueOnce(new Error('model unavailable'))
    await holdMicAndRelease(wrapper)
    await recorder.options.onComplete(new Blob(['voice']), false)
    await settle(wrapper)

    expect(wrapper.vm.transcript).toBe('联系电话13800138000')
    expect(wrapper.vm.aiNotice).toContain('转写已保留')
    expect(wrapper.vm.fields.phone).toBe('13800138000')
    wrapper.destroy()
  })

  it('plays and releases an explicitly requested voice prompt', async () => {
    const wrapper = mount(App, { localVue })
    api.tts.mockResolvedValueOnce('blob:voice-prompt')
    URL.revokeObjectURL = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)

    await wrapper.vm.speak('请将证件放置到读卡区。')
    expect(api.tts).toHaveBeenCalledWith('请将证件放置到读卡区。', expect.any(AbortSignal))
    expect(wrapper.find('audio').element.getAttribute('src')).toBe('blob:voice-prompt')

    wrapper.vm.releaseAudio()
    expect(wrapper.find('audio').element.getAttribute('src')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-prompt')
    expect(wrapper.vm.audioUrl).toBe('')
    wrapper.destroy()
  })

  it('does not play a late TTS response after automatic speech is disabled', async () => {
    const wrapper = mount(App, { localVue })
    let resolveSpeech
    api.tts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        })
    )
    URL.revokeObjectURL = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    wrapper.vm.autoSpeakAssistant = true

    const playback = wrapper.vm.speak('请问您的职业是什么？')
    wrapper.vm.toggleAutoSpeak()
    resolveSpeech('blob:late-voice')
    await playback

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-voice')
    expect(wrapper.find('audio').element.getAttribute('src')).toBeNull()
    wrapper.destroy()
  })

  it('shows a recoverable message when voice prompt playback is unavailable', async () => {
    const wrapper = mount(App, { localVue })
    api.tts.mockRejectedValueOnce(new Error('TTS unavailable'))

    await wrapper.vm.speak('请将证件放置到读卡区。')

    // 提示内联在语音区，不用会盖住顶部品牌与日期的全局 toast。
    expect(wrapper.vm.voiceError).toBe('TTS unavailable')
    expect(wrapper.vm.ttsRequest).toBeNull()
    wrapper.destroy()
  })

  it('supports canceling or confirming the exit prompt on the identity page', async () => {
    const wrapper = mountApp()
    await startAdmission(wrapper)
    await wrapper.find('.reader-close').trigger('click')
    expect(wrapper.vm.cancelVisible).toBe(true)

    await clickDialogButton('继续办理')
    expect(wrapper.vm.page).toBe('identity')
    expect(wrapper.vm.cancelVisible).toBe(false)

    await wrapper.find('.reader-close').trigger('click')
    await clickDialogButton('确认退出')
    expect(wrapper.vm.page).toBe('home')
    expect(wrapper.vm.identityToken).toBe('')
    wrapper.destroy()
  })

  it.each([
    [422, 'form', '服务端字段错误', 1],
    [409, 'result', 'failed', 2],
    [503, 'result', 'unknown', 2],
  ])(
    'handles submit response %s with the correct recovery path',
    async (status, page, result, step) => {
      const wrapper = mountApp()
      await enterForm(wrapper)
      await nextFormPage(wrapper)
      api.submit.mockRejectedValueOnce(
        Object.assign(new Error('submit failed'), {
          status,
          body: { detail: { errors: { phone: '服务端字段错误' } } },
        })
      )
      await submitSecondPage(wrapper)

      expect(wrapper.vm.page).toBe(page)
      expect(wrapper.vm.step).toBe(step)
      if (page === 'form') expect(wrapper.vm.fieldErrors.phone).toBe('服务端字段错误')
      else expect(wrapper.vm.result.status).toBe(result)
      wrapper.destroy()
    }
  )

  it('queries an unknown submission and finishes after the result is confirmed', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await nextFormPage(wrapper)
    api.submit.mockRejectedValueOnce(Object.assign(new Error('network lost'), { status: 503 }))
    await submitSecondPage(wrapper)
    expect(wrapper.vm.result.status).toBe('unknown')

    api.result.mockResolvedValueOnce({
      status: 'success',
      receiptId: 'RECOVERED-1',
    })
    await wrapper.find('.primary-action').trigger('click')
    await settle(wrapper)
    expect(api.result).toHaveBeenCalledOnce()
    expect(wrapper.vm.result.status).toBe('success')
    expect(wrapper.find('.receipt').text()).toContain('RECOVERED-1')

    await wrapper.find('.secondary-action').trigger('click')
    expect(wrapper.vm.page).toBe('home')
    wrapper.destroy()
  })

  it.each([
    ['still unknown', { status: 'unknown' }, 'unknown'],
    ['lookup unavailable', new Error('lookup unavailable'), 'unknown'],
  ])('keeps the result pending when %s', async (_case, lookup, resultStatus) => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await nextFormPage(wrapper)
    api.submit.mockRejectedValueOnce(Object.assign(new Error('network lost'), { status: 503 }))
    await submitSecondPage(wrapper)
    api.result.mockImplementationOnce(() =>
      lookup instanceof Error ? Promise.reject(lookup) : Promise.resolve(lookup)
    )

    await wrapper.find('.primary-action').trigger('click')
    await settle(wrapper)
    expect(wrapper.vm.page).toBe('result')
    expect(wrapper.vm.result.status).toBe(resultStatus)
    expect(wrapper.vm.checkingResult).toBe(false)
    wrapper.destroy()
  })

  it('returns a failed submission to the last form page for retry', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await nextFormPage(wrapper)
    api.submit.mockRejectedValueOnce(Object.assign(new Error('declined'), { status: 409 }))
    await submitSecondPage(wrapper)
    const originalKey = wrapper.vm.idempotencyKey
    expect(wrapper.vm.result.status).toBe('failed')

    await wrapper.find('.primary-action').trigger('click')
    expect(wrapper.vm.page).toBe('form')
    expect(wrapper.vm.step).toBe(2)
    expect(wrapper.vm.idempotencyKey).toBe('')
    expect(wrapper.vm.fields.phone).toBe('13800138000')

    api.submit.mockResolvedValueOnce({ status: 'success' })
    await submitSecondPage(wrapper)
    expect(wrapper.vm.page).toBe('result')
    expect(wrapper.vm.idempotencyKey).not.toBe(originalKey)
    wrapper.destroy()
  })

  it('returns home after an already-registered result without offering a retry', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await nextFormPage(wrapper)
    api.submit.mockResolvedValueOnce({ status: 'already_registered' })
    await submitSecondPage(wrapper)

    expect(wrapper.find('.result-panel h2').text()).toBe('发现已有登记记录')
    expect(wrapper.find('.primary-action').exists()).toBe(false)
    await wrapper.find('.secondary-action').trigger('click')
    expect(wrapper.vm.page).toBe('home')
    wrapper.destroy()
  })

  it('clears patient data from the page after a completed mock submission', async () => {
    const wrapper = mountApp()
    await enterForm(wrapper)
    await nextFormPage(wrapper)
    api.submit.mockResolvedValueOnce({
      status: 'success',
      receiptId: 'SIM-001',
    })

    await submitSecondPage(wrapper)

    expect(wrapper.vm.page).toBe('result')
    expect(wrapper.vm.result.receiptId).toBe('SIM-001')
    expect(wrapper.vm.identityToken).toBe('')
    expect(wrapper.vm.sessionId).toBe('')
    expect(wrapper.vm.fields.phone).toBe('')
    expect(wrapper.vm.fields.marriage).toBe('')
    expect(wrapper.vm.fields.occupation).toBe('')
    expect(wrapper.vm.fields.emergencyContact).toBe('')
    expect(wrapper.vm.fields.relationship).toBe('')
    wrapper.destroy()
  })

  it('keeps the home countdown paused until the user interacts', async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    try {
      await vi.advanceTimersByTimeAsync(5000)
      expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 380 秒')

      await wrapper.find('.page-shell').trigger('click')
      await vi.advanceTimersByTimeAsync(1000)
      expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 379 秒')

      await wrapper.find('.page-shell').trigger('click')
      expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 380 秒')
    } finally {
      wrapper.destroy()
      vi.useRealTimers()
    }
  })

  it('counts down on identity and the continuous form, then opens review', async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    await startAdmission(wrapper)
    expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 300 秒')

    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 297 秒')

    api.verify.mockResolvedValue({
      identityToken: 'identity-demo-token',
      fields: validFields(),
    })
    await wrapper.find('.reader-trigger').trigger('click')
    await settle(wrapper)
    await wrapper.find('.application-continue').trigger('click')
    await settle(wrapper)
    expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 300 秒')
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 298 秒')

    wrapper.vm.fields.phone = '13800138000'
    wrapper.vm.onFieldChange('phone')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 300 秒')

    await nextFormPage(wrapper)
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.page).toBe('review')
    wrapper.destroy()
  })

  it(
    'offers the idle warning, resumes the session, then expires to home',
    { timeout: 20000 },
    async () => {
      vi.useFakeTimers()
      const wrapper = mountApp()
      wrapper.vm.page = 'form'

      await vi.advanceTimersByTimeAsync(299000)
      expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 1 秒')
      await vi.advanceTimersByTimeAsync(1000)
      expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 0 秒')
      expect(wrapper.vm.idleVisible).toBe(true)
      expect(wrapper.vm.idleRemaining).toBe(30)

      wrapper.vm.continueSession()
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.idleVisible).toBe(false)
      expect(wrapper.find('.bottom-bar .home-countdown').text()).toBe('倒计时 300 秒')
      await vi.advanceTimersByTimeAsync(330000)
      expect(wrapper.vm.page).toBe('home')
      expect(wrapper.vm.fields.phone).toBe('')
      wrapper.destroy()
    }
  )
})
