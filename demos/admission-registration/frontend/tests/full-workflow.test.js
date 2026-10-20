import { mount, createLocalVue } from "@vue/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ElementUI from "element-ui";
import App from "../src/App.vue";

const { api, recorder } = vi.hoisted(() => ({
  api: {
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
}));

vi.mock("../src/api/admission.js", () => ({
  admissionApi: api,
  extractCandidates: api.extract,
  platformJson: api.platform,
  platformTts: api.tts,
}));

vi.mock("../src/api/platform.js", () => ({
  classifyAdmissionIntent: api.intent,
  classifyAdmissionCandidateConfirmation: api.confirmCandidate,
  platformJson: api.platform,
  platformUpload: api.upload,
  platformTts: api.tts,
}));

vi.mock("../src/utils/voiceRecorder.js", () => ({
  VoiceRecorder: vi.fn().mockImplementation((options) => {
    recorder.options = options;
    return {
      start: recorder.start,
      stop: recorder.stop,
      cleanup: recorder.cleanup,
    };
  }),
}));

vi.mock("../src/utils/audioToWav.js", () => ({
  audioToWav: vi.fn(async (blob) => new Blob([blob], { type: "audio/wav" })),
}));

const localVue = createLocalVue();
localVue.use(ElementUI);

function validFields() {
  return {
    name: "演示患者",
    idNumber: "DEMO-ID-0001",
    phone: "13800138000",
    nationality: "中国",
    ethnicity: "汉族",
    nativeRegion: [],
    residentRegion: [],
    addressDetail: "",
    employerName: "",
    employerAddress: "",
    marriage: "未婚",
    occupation: "职工",
    emergencyContact: "王小明",
    relationship: "子女",
  };
}

function mountApp() {
  const wrapper = mount(App, { localVue });
  wrapper.vm.speak = vi.fn();
  return wrapper;
}

async function settle(wrapper) {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
    await wrapper.vm.$nextTick();
  }
}

async function toggleHomeRecording(wrapper) {
  const dialog = wrapper.findComponent({ name: "ConversationDialog" });
  await dialog.find(".conversation-dialog__mobile-voice").trigger("click");
  await settle(wrapper);
}

async function startHomeRecording(wrapper) {
  await wrapper.find(".mic-button").trigger("click");
  await settle(wrapper);
  await toggleHomeRecording(wrapper);
}

async function startAdmission(wrapper) {
  await wrapper.findAll(".prompt-button").at(3).trigger("click");
  expect(wrapper.vm.page).toBe("identity");
  expect(wrapper.find(".mascot-stage").exists()).toBe(false);
  expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
    false,
  );
  expect(wrapper.find(".reader-card").exists()).toBe(true);
  expect(wrapper.vm.transcript).toBe("");
  expect(wrapper.vm.aiNotice).toBe("");
}

async function enterForm(wrapper, fields = validFields()) {
  api.verify.mockResolvedValue({
    identityToken: "identity-demo-token",
    fields,
  });
  api.applications.mockResolvedValue({ items: [application()] });
  api.selectApplication.mockResolvedValue({
    application: application(),
    sessionId: "session-demo-001",
  });
  await startAdmission(wrapper);
  await wrapper.find(".reader-trigger").trigger("click");
  await settle(wrapper);
  expect(wrapper.vm.page).toBe("applications");
  await wrapper.find(".application-select").trigger("click");
  await wrapper.find(".application-continue").trigger("click");
  await settle(wrapper);
  expect(wrapper.vm.page).toBe("form");
}

function application() {
  return {
    id: "APP-DEMO-001",
    patientName: "演**者",
    department: "心内科",
    plannedAdmissionAt: "2026-10-22 09:00",
    doctor: "王医生",
    orderedAt: "2026-10-19 15:30",
    type: "普通住院",
    diagnosis: "冠心病待查",
    ward: "心内科一区",
    status: "有效",
  };
}

async function nextFormPage(wrapper) {
  await wrapper.find('.page-arrow[aria-label="下一页"]').trigger("click");
  await wrapper.vm.$nextTick();
}

async function previousFormPage(wrapper) {
  await wrapper.find('.page-arrow[aria-label="上一页"]').trigger("click");
  await wrapper.vm.$nextTick();
}

async function submitSecondPage(wrapper) {
  await wrapper.find(".confirm-submit").trigger("click");
  await settle(wrapper);
  if (wrapper.vm.page === "review") {
    await wrapper.find(".review-submit").trigger("click");
    await settle(wrapper);
  }
}

async function clickDialogButton(label) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const button = Array.from(
    document.body.querySelectorAll(".el-dialog__footer .el-button"),
  ).find((item) => item.textContent.trim() === label);
  expect(button, `dialog button "${label}"`).toBeTruthy();
  button.click();
}

describe("complete admission workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of Object.values(api)) method.mockReset();
    recorder.options = null;
    recorder.start.mockResolvedValue(undefined);
    recorder.stop.mockImplementation(() => {});
    recorder.cleanup.mockImplementation(() => {});
    api.applications.mockResolvedValue({ items: [application()] });
    api.selectApplication.mockResolvedValue({
      application: application(),
      sessionId: "session-demo-001",
    });
    api.getSession.mockResolvedValue({
      revision: 0,
      lastTurnId: null,
      facts: {},
      turns: [],
    });
    api.saveTurn.mockImplementation(async (_sessionId, payload) => ({
      revision: payload.expectedRevision + 1,
      lastTurnId: payload.turnId,
    }));
    api.confirmReview.mockImplementation(async (_sessionId, payload) => ({
      reviewRevision: payload.expectedRevision + 1,
    }));
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [401, "已失效"],
    [429, "请求过于频繁"],
    [503, "服务连接失败"],
  ])(
    "distinguishes HTTP %s from an unrecognized home utterance",
    async (status, expected) => {
      const wrapper = mountApp();
      api.intent.mockRejectedValueOnce(
        Object.assign(new Error("internal error"), { status }),
      );
      await wrapper.vm.submitConversationInput("你好");
      expect(wrapper.vm.aiNotice).toContain(expected);
      expect(wrapper.vm.aiNotice).not.toContain("没能确定您的需求");
      expect(wrapper.vm.transcript).toBe("你好");
      wrapper.destroy();
    },
  );

  it("does not advance when saving pending manual changes fails", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.fields.employerName = "测试单位";
    wrapper.vm.onFieldChange("employerName");
    api.saveTurn.mockRejectedValueOnce(
      Object.assign(new Error("stale revision"), { status: 409 }),
    );
    await wrapper.vm.selectConversationOption("继续下一页");
    expect(wrapper.vm.step).toBe(1);
    expect(wrapper.vm.manualPendingFields.employerName).toBe("测试单位");
    expect(wrapper.vm.aiNotice).toContain("会话已在其他窗口更新");
    wrapper.destroy();
  });

  it("waits for an in-flight manual save before binding the final review revision", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    wrapper.vm.fields.employerName = "测试单位";
    wrapper.vm.onFieldChange("employerName");
    let finishSave;
    api.saveTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const save = wrapper.vm.flushManualChanges();
    await vi.waitFor(() => expect(api.saveTurn).toHaveBeenCalledOnce());
    api.submit.mockResolvedValueOnce({ status: "success" });
    const submission = wrapper.vm.submit();
    await settle(wrapper);
    expect(api.confirmReview).not.toHaveBeenCalled();
    finishSave({ revision: 1, lastTurnId: "manual-save" });
    await Promise.all([save, submission]);
    expect(api.confirmReview).toHaveBeenCalledWith(
      "session-demo-001",
      expect.objectContaining({ expectedRevision: 1 }),
      expect.anything(),
    );
    wrapper.destroy();
  });

  it("discards saved dialogue arriving after a reset", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    let finishSave;
    api.saveTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const pending = wrapper.vm.persistConversation({
      utterance: "测试问题",
      response: "测试回复",
      action: "manual_turn",
    });
    await vi.waitFor(() => expect(api.saveTurn).toHaveBeenCalledOnce());
    wrapper.vm.reset();
    finishSave({ revision: 8, lastTurnId: "old-turn" });
    await pending;
    expect(wrapper.vm.sessionRevision).toBe(0);
    expect(wrapper.vm.lastTurnId).toBe(null);
    expect(wrapper.vm.conversationMessages).toEqual([]);
    wrapper.destroy();
  });

  it("ignores identity verification that completes after returning home", async () => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    let finishVerify;
    api.verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishVerify = resolve;
        }),
    );
    const pending = wrapper.vm.verifyIdentity();
    wrapper.vm.reset();
    finishVerify({ identityToken: "old-identity", fields: validFields() });
    await pending;
    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.identityToken).toBe("");
    expect(wrapper.vm.fields.phone).toBe("");
    wrapper.destroy();
  });

  it("ignores a result query that finishes after returning home", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "result";
    wrapper.vm.result = { status: "unknown" };
    wrapper.vm.idempotencyKey = "original-key";
    let finishQuery;
    api.result.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuery = resolve;
        }),
    );
    const pending = wrapper.vm.checkResult();
    wrapper.vm.reset();
    finishQuery({ status: "success" });
    await pending;
    expect(wrapper.vm.result).toBe(null);
    expect(wrapper.vm.page).toBe("home");
    wrapper.destroy();
  });

  it("routes ASR continue through the same page validation as text input", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    api.upload.mockResolvedValueOnce({ text: "继续下一页" });
    wrapper.vm.recordingPage = "form";
    await wrapper.vm.handleRecordingComplete(
      new Blob(["audio"]),
      false,
      wrapper.vm.generation,
    );
    expect(wrapper.vm.step).toBe(2);
    expect(api.extract).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it("clears application-stage dialogue notices when moving into the form", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "applications";
    await wrapper.vm.submitConversationInput("下一步做什么");
    expect(wrapper.vm.aiNotice).toContain("请先选择");
    await wrapper.vm.continueWithApplication();
    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.aiNotice).toBe("");
    expect(wrapper.vm.transcript).toBe("");
    wrapper.destroy();
  });

  it("opens cancellation confirmation from dialogue and retains the form", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await wrapper.vm.submitConversationInput("取消办理，回首页");
    expect(wrapper.vm.cancelVisible).toBe(true);
    expect(wrapper.vm.fields.phone).toBe(validFields().phone);
    expect(api.extract).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it("does not treat a negated submit or a generic acknowledgement as final consent", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    for (const text of [
      "好的",
      "还没确认",
      "不要提交",
      "确认提交但先修改职业",
    ]) {
      await wrapper.vm.submitConversationInput(text);
      expect(wrapper.vm.page).toBe("review");
      expect(wrapper.vm.aiNotice).not.toContain("请先完成身份核验");
    }
    expect(api.submit).not.toHaveBeenCalled();
    expect(api.extract).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it("submits only explicit consent from review through the existing reviewed API", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    wrapper.vm.conversationVisible = true;
    wrapper.vm.transcript = "确认提交。";
    api.submit.mockResolvedValueOnce({
      status: "success",
      receiptId: "SYNTHETIC-001",
    });
    await wrapper.vm.submitConversationInput("确认提交。");
    expect(api.confirmReview).toHaveBeenCalledOnce();
    expect(api.submit).toHaveBeenCalledOnce();
    expect(wrapper.vm.page).toBe("result");
    expect(wrapper.vm.conversationVisible).toBe(false);
    expect(wrapper.vm.transcript).toBe("");
    expect(wrapper.vm.aiNotice).toBe("");
    wrapper.destroy();
  });

  it("blocks direct submission before the final review page", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await wrapper.vm.submit();
    expect(api.submit).not.toHaveBeenCalled();
    expect(api.confirmReview).not.toHaveBeenCalled();
    expect(wrapper.vm.page).toBe("form");
    wrapper.destroy();
  });

  it("treats review edits as confirmed-value conflicts and preserves unrelated fields", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    api.extract.mockResolvedValueOnce({
      fields: { occupation: "学生", relationship: "非亲属" },
    });
    await wrapper.vm.submitConversationInput("职业改成学生");
    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.step).toBe(2);
    expect(wrapper.vm.fields.occupation).toBe("职工");
    expect(wrapper.vm.pendingCandidates.occupation).toBe("学生");
    expect(wrapper.vm.pendingCandidates.relationship).toBeUndefined();
    expect(wrapper.vm.fields.relationship).toBe("子女");
    expect(wrapper.vm.fields.phone).toBe(validFields().phone);
    await wrapper.vm.resolveCandidate(true);
    expect(wrapper.vm.fields.occupation).toBe("学生");
    expect(wrapper.vm.sources.occupation).toBe("manual");
    wrapper.destroy();
  });

  it("offers dictionary choices in the dialog when a review edit cannot be extracted", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    wrapper.vm.conversationVisible = true;
    api.extract.mockResolvedValueOnce({ fields: {} });
    await wrapper.vm.submitConversationInput("职业改成护士");
    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.fields.occupation).toBe("职工");
    expect(wrapper.vm.fallbackChoiceKey).toBe("occupation");
    expect(wrapper.vm.aiNotice).toContain("职业");
    const labels = wrapper
      .findAll(".conversation-dialog__choices button")
      .wrappers.map((button) => button.text());
    expect(labels).toEqual(["职工", "农民", "退休", "无业", "学生", "其他"]);
    await wrapper.vm.selectConversationOption("学生");
    expect(wrapper.vm.fields.occupation).toBe("学生");
    expect(wrapper.vm.sources.occupation).toBe("manual");
    expect(wrapper.vm.fallbackChoiceKey).toBe("");
    expect(wrapper.vm.aiNotice).toBe(
      "您的入院登记信息已填写完成，请核对后确认提交。",
    );
    wrapper.destroy();
  });

  it("offers relationship choices when a daughter relation is not extracted", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, { ...validFields(), relationship: "" });
    wrapper.vm.step = 2;
    wrapper.vm.conversationVisible = true;
    api.extract.mockResolvedValueOnce({ fields: {} });

    await wrapper.vm.submitConversationInput("她是我的女儿");

    expect(wrapper.vm.fields.relationship).toBe("");
    expect(
      wrapper
        .findAll(".conversation-dialog__choices button")
        .wrappers.map((button) => button.text()),
    ).toEqual([
      "配偶",
      "子女",
      "父母",
      "祖父母/外祖父母",
      "孙辈/外孙辈",
      "兄弟姐妹",
      "其他亲属",
      "非亲属",
    ]);

    await wrapper.vm.selectConversationOption("子女");

    expect(wrapper.vm.fields.relationship).toBe("子女");
    expect(wrapper.vm.sources.relationship).toBe("manual");
    wrapper.destroy();
  });

  it("offers occupation choices for a short form edit the model cannot extract", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.step = 2;
    wrapper.vm.conversationVisible = true;
    api.extract.mockResolvedValueOnce({ fields: {} });

    await wrapper.vm.submitConversationInput("职业改成护士");

    expect(wrapper.vm.fields.occupation).toBe("职工");
    expect(wrapper.vm.fallbackChoiceKey).toBe("occupation");
    expect(
      wrapper
        .findAll(".conversation-dialog__choices button")
        .wrappers.map((button) => button.text()),
    ).toEqual(["职工", "农民", "退休", "无业", "学生", "其他"]);

    await wrapper.vm.selectConversationOption("其他");

    expect(wrapper.vm.fields.occupation).toBe("其他");
    expect(wrapper.vm.sources.occupation).toBe("manual");
    expect(wrapper.vm.fallbackChoiceKey).toBe("");
    wrapper.destroy();
  });

  it("keeps reliable fields while offering choices for an uncertain occupation", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.step = 2;
    wrapper.vm.conversationVisible = true;
    api.extract.mockResolvedValueOnce({ fields: { employerName: "演示医院" } });

    await wrapper.vm.submitConversationInput(
      "职业改成护士，工作单位是演示医院",
    );

    expect(wrapper.vm.fields.employerName).toBe("演示医院");
    expect(wrapper.vm.fields.occupation).toBe("职工");
    expect(wrapper.vm.fallbackChoiceKey).toBe("occupation");
    expect(wrapper.vm.aiNotice).toContain("选择职业");
    wrapper.destroy();
  });

  it("keeps advance commands working while fallback choices are pending", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    api.extract.mockResolvedValueOnce({ fields: {} });
    await wrapper.vm.submitConversationInput("职业改成护士");
    expect(wrapper.vm.fallbackChoiceKey).toBe("occupation");
    await wrapper.vm.selectConversationOption("进入核对页");
    expect(wrapper.vm.page).toBe("review");
    expect(wrapper.vm.fields.occupation).toBe("职工");
    expect(wrapper.vm.fallbackChoiceKey).toBe("");
    wrapper.destroy();
  });

  it("does not flag an equal region array as a conflicting new value", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.fields.nativeRegion = ["210000", "210100", "210103"];
    wrapper.vm.sources.nativeRegion = "manual";
    api.extract.mockResolvedValueOnce({
      fields: { nativeRegion: ["210000", "210100", "210103"] },
    });
    await wrapper.vm.applyAi("籍贯辽宁省沈阳市沈河区", wrapper.vm.generation);
    expect(wrapper.vm.pendingCandidates.nativeRegion).toBeUndefined();
    expect(wrapper.vm.candidateDialogKey).toBe("");
    wrapper.destroy();
  });

  it("masks identity and phone displays while retaining submission values", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.fields.idNumber = "110101199001011234";
    expect(wrapper.vm.patient.phone).toBe("138****8000");
    expect(wrapper.vm.reviewValueLabel("idNumber")).toBe("110101********1234");
    expect(wrapper.vm.reviewValueLabel("phone")).toBe("138****8000");
    expect(wrapper.vm.fields.phone).toBe(validFields().phone);
    wrapper.destroy();
  });

  it("renders field labels rather than internal keys in generated dialogue events", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.fields.employerName = "测试单位";
    wrapper.vm.onFieldChange("employerName");
    await wrapper.vm.flushManualChanges();
    const lastInput = wrapper.vm.conversationMessages.at(-2).text;
    expect(lastInput).toContain("工作单位名称");
    expect(lastInput).not.toContain("employerName");
    wrapper.destroy();
  });

  it.each(["applications", "result"])(
    "clears patient data after inactivity on %s",
    async (page) => {
      vi.useFakeTimers();
      const wrapper = mountApp();
      wrapper.vm.fields = validFields();
      wrapper.vm.page = page;
      await vi.advanceTimersByTimeAsync(330000);
      expect(wrapper.vm.page).toBe("home");
      expect(wrapper.vm.fields.phone).toBe("");
      wrapper.destroy();
    },
  );

  it("locks navigation and editing while final submission is pending", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "review";
    let finishSubmission;
    api.submit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSubmission = resolve;
        }),
    );
    const pending = wrapper.vm.submit();
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    wrapper.vm.editReviewStep(1);
    wrapper.vm.goBack();
    expect(wrapper.vm.page).toBe("review");
    finishSubmission({ status: "success" });
    await pending;
    wrapper.destroy();
  });

  it("queries an uncertain result from dialogue without issuing a new submission", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.page = "result";
    wrapper.vm.result = { status: "unknown" };
    wrapper.vm.idempotencyKey = "original-key";
    api.result.mockResolvedValueOnce({ status: "success" });
    await wrapper.vm.submitConversationInput("查询办理结果");
    expect(api.result).toHaveBeenCalledWith(
      "identity-demo-token",
      "original-key",
      expect.anything(),
    );
    expect(api.submit).not.toHaveBeenCalled();
    expect(wrapper.vm.result.status).toBe("success");
    wrapper.destroy();
  });

  it("hides the account bar on home and routes the admission button to identity", async () => {
    const wrapper = mountApp();

    expect(wrapper.findAll(".prompt-button")).toHaveLength(4);
    expect(wrapper.find(".user-bar").exists()).toBe(false);
    await wrapper.findAll(".prompt-button").at(3).trigger("click");

    expect(wrapper.vm.page).toBe("identity");
    expect(wrapper.vm.transcript).toBe("");
    expect(wrapper.vm.aiNotice).toBe("");
    expect(wrapper.find(".user-bar").exists()).toBe(false);
    wrapper.destroy();
  });

  it("requires selecting a verified patient admission application before opening the form", async () => {
    const wrapper = mountApp();
    api.verify.mockResolvedValue({
      identityToken: "identity-demo-token",
      fields: validFields(),
    });
    api.applications.mockResolvedValue({ items: [application()] });

    await startAdmission(wrapper);
    await wrapper.find(".reader-trigger").trigger("click");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("applications");
    expect(wrapper.find(".application-card").text()).toContain("心内科");
    expect(wrapper.find(".application-card").text()).toContain(
      "2026-10-22 09:00",
    );
    expect(wrapper.find(".form-panel").exists()).toBe(false);
    wrapper.destroy();
  });

  it("shows a separate review page before sending the final registration", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await nextFormPage(wrapper);
    await wrapper.find(".confirm-submit").trigger("click");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("review");
    expect(api.submit).not.toHaveBeenCalled();
    expect(wrapper.find(".review-panel").text()).toContain("APP-DEMO-001");
    api.submit.mockResolvedValueOnce({
      status: "success",
      receiptId: "SIM-0001",
    });
    await wrapper.find(".review-submit").trigger("click");
    await settle(wrapper);
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.page).toBe("result");
    wrapper.destroy();
  });

  it("passes measured microphone level into the live voice control", async () => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });

    await startHomeRecording(wrapper);
    recorder.options.onLevel({ level: 0.42, soundDetected: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.volumeLevel).toBe(0.42);
    expect(wrapper.vm.soundDetected).toBe(true);
    expect(wrapper.find(".voice-waveform").attributes("aria-label")).toBe(
      "正在收音",
    );
    wrapper.destroy();
  });

  it("sends manual home input through the same intent classifier", async () => {
    const wrapper = mountApp();
    api.intent.mockResolvedValueOnce({
      intent: "begin_admission",
      reply: "请先完成身份核验。",
    });

    await wrapper.find(".manual-entry-button").trigger("click");
    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    await dialog
      .find(".conversation-dialog__mobile-input input")
      .setValue("请帮我办理住院");
    await dialog.find(".conversation-dialog__mobile-input").trigger("submit");
    await settle(wrapper);

    expect(api.intent).toHaveBeenCalledWith(
      "请帮我办理住院",
      expect.any(AbortSignal),
    );
    expect(wrapper.vm.page).toBe("identity");
    wrapper.destroy();
  });

  it("answers page workflow questions without starting identity verification", async () => {
    const wrapper = mountApp();
    api.intent.mockResolvedValueOnce({
      intent: "answer_question",
      reply: "先模拟身份核验，再确认申请单并填写资料。",
    });

    await wrapper.find(".manual-entry-button").trigger("click");
    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    await dialog
      .find(".conversation-dialog__mobile-input input")
      .setValue("入院登记怎么办理？");
    await dialog.find(".conversation-dialog__mobile-input").trigger("submit");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.aiNotice).toBe(
      "先模拟身份核验，再确认申请单并填写资料。",
    );
    expect(wrapper.vm.homeConversationMessages.at(-1)).toEqual({
      role: "assistant",
      text: "先模拟身份核验，再确认申请单并填写资料。",
    });
    wrapper.destroy();
  });

  it("opens home voice input in the conversation dialog before recording starts", async () => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);

    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.exists()).toBe(true);
    expect(wrapper.vm.conversationVisible).toBe(true);
    expect(dialog.find(".conversation-dialog__mobile-voice").text()).toContain(
      "开始录音",
    );
    expect(api.platform).not.toHaveBeenCalled();
    expect(recorder.start).not.toHaveBeenCalled();

    await dialog.find(".conversation-dialog__mobile-voice").trigger("click");
    await settle(wrapper);

    expect(api.platform).toHaveBeenCalledOnce();
    expect(recorder.start).toHaveBeenCalledOnce();
    expect(wrapper.vm.recording).toBe(true);
    wrapper.destroy();
  });

  it("explains that a non-admission shortcut is unavailable on this page", async () => {
    const wrapper = mountApp();

    await wrapper.findAll(".prompt-button").at(1).trigger("click");

    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.transcript).toBe("帮我打印检查检验报告单");
    expect(wrapper.vm.aiNotice).toBe(
      "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。",
    );
    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(wrapper.vm.conversationVisible).toBe(true);
    expect(dialog.text()).toContain("帮我打印检查检验报告单");
    expect(dialog.text()).toContain(
      "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。",
    );
    expect(wrapper.find(".transcript-bubble").exists()).toBe(false);
    expect(wrapper.find(".transcript-status").exists()).toBe(false);
    expect(wrapper.find(".user-bar").exists()).toBe(false);
    wrapper.destroy();
  });

  it.each([
    "我要入院登记。",
    "我要住院登记。",
    "我要办理入院。",
    "我要入院。",
    "办理住院。",
    "请帮我办个住院手续。",
    "我想办一下住院的事",
  ])("asks AI to classify the admission synonym %s", async (text) => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text });
    api.intent.mockResolvedValueOnce({
      intent: "begin_admission",
      reply: "请先完成身份核验。",
    });

    await startHomeRecording(wrapper);
    await toggleHomeRecording(wrapper);
    await recorder.options.onComplete(new Blob(["voice"]), false);

    expect(api.intent).toHaveBeenCalledWith(text, expect.any(AbortSignal));
    expect(wrapper.vm.page).toBe("identity");
    expect(wrapper.vm.transcript).toBe("");
    expect(wrapper.vm.aiNotice).toBe("");
    wrapper.destroy();
  });

  it("does not start admission for a negated registration request", async () => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "我不想住院登记。" });
    api.intent.mockResolvedValueOnce({
      intent: "unknown",
      reply: "明白，您暂时不想办理。",
    });

    await startHomeRecording(wrapper);
    await toggleHomeRecording(wrapper);
    await recorder.options.onComplete(new Blob(["voice"]), false);

    expect(api.intent).toHaveBeenCalledWith(
      "我不想住院登记。",
      expect.any(AbortSignal),
    );
    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.aiNotice).toBe(
      "我没能确定您的需求，请说说您想办理什么。",
    );
    wrapper.destroy();
  });

  it("answers an unrecognized weather request with the fixed scope reply", async () => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "今天天气怎么样" });
    api.intent.mockResolvedValueOnce({
      intent: "unknown",
      reply: "您是想办理入院登记吗？",
    });

    await startHomeRecording(wrapper);
    await toggleHomeRecording(wrapper);
    await recorder.options.onComplete(new Blob(["voice"]), false);

    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.aiNotice).toBe(
      "我没能确定您的需求，请说说您想办理什么。",
    );
    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.text()).toContain("今天天气怎么样");
    expect(dialog.text()).toContain("我没能确定您的需求，请说说您想办理什么。");
    expect(wrapper.find(".transcript-bubble").exists()).toBe(false);
    expect(wrapper.find(".transcript-status").exists()).toBe(false);
    wrapper.destroy();
  });

  it("explains that an understood report request is unavailable on this page", async () => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "帮我做报告解读" });
    api.intent.mockResolvedValueOnce({
      intent: "unsupported",
      reply: "本演示目前仅支持入院登记。",
    });

    await startHomeRecording(wrapper);
    await toggleHomeRecording(wrapper);
    await recorder.options.onComplete(new Blob(["voice"]), false);

    expect(api.intent).toHaveBeenCalledWith(
      "帮我做报告解读",
      expect.any(AbortSignal),
    );
    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.transcript).toBe("帮我做报告解读");
    expect(wrapper.vm.aiNotice).toBe(
      "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。",
    );
    wrapper.destroy();
  });

  it("discards a late home intent after the user resets the session", async () => {
    const wrapper = mountApp();
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "我想办一下住院的事" });
    let resolveIntent;
    api.intent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveIntent = resolve;
      }),
    );

    await startHomeRecording(wrapper);
    await toggleHomeRecording(wrapper);
    const completion = recorder.options.onComplete(new Blob(["voice"]), false);
    await vi.waitFor(() => expect(api.intent).toHaveBeenCalledOnce());
    wrapper.vm.reset();
    resolveIntent({ intent: "begin_admission", reply: "请先完成身份核验。" });
    await completion;

    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.transcript).toBe("");
    wrapper.destroy();
  });

  it("shows and refreshes the current local date and time in the header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 12, 0));
    const wrapper = mountApp();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".screen-time").text()).toBe(
      "2026年10月19日 星期一 上午10:12",
    );

    await vi.advanceTimersByTimeAsync(60000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".screen-time").text()).toBe(
      "2026年10月19日 星期一 上午10:13",
    );
    wrapper.destroy();
  });

  it("walks from home through identity, both form pages, success, and back home", async () => {
    const wrapper = mountApp();
    api.submit.mockResolvedValue({
      status: "success",
      receiptId: "DEMO-RECEIPT-1",
    });

    await enterForm(wrapper);
    expect(wrapper.vm.fields.name).toBe("演示患者");
    expect(wrapper.find(".user-name").text()).toBe("演**者");
    expect(wrapper.find(".user-phone").text()).toBe("138****8000");
    expect(wrapper.vm.step).toBe(1);
    expect(wrapper.find(".entered-label").exists()).toBe(false);
    expect(wrapper.find(".form-title").text()).toBe("以下为您的入院登记信息");

    await nextFormPage(wrapper);
    expect(wrapper.vm.step).toBe(2);
    await previousFormPage(wrapper);
    expect(wrapper.vm.step).toBe(1);
    expect(wrapper.vm.fields.phone).toBe("13800138000");
    wrapper.vm.fields.phone = "13900139000";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".user-phone").text()).toBe("139****9000");

    await nextFormPage(wrapper);
    await submitSecondPage(wrapper);
    await settle(wrapper);
    expect(api.submit).toHaveBeenCalledOnce();
    expect(wrapper.vm.page).toBe("result");
    expect(wrapper.find(".receipt").text()).toContain("DEMO-RECEIPT-1");

    await wrapper.find(".secondary-action").trigger("click");
    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.find(".user-bar").exists()).toBe(false);
    expect(wrapper.find(".mascot-stage").exists()).toBe(true);
    expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
      true,
    );
    expect(wrapper.vm.identityToken).toBe("");
    wrapper.destroy();
  });

  it("blocks invalid required fields on each form page and continues after correction", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, { ...validFields(), phone: "" });

    await nextFormPage(wrapper);
    expect(wrapper.vm.step).toBe(1);
    expect(wrapper.vm.fieldErrors.phone).toBeTruthy();
    expect(
      wrapper.find("#phone").element.closest(".field-row").classList,
    ).toContain("field-row--invalid");
    expect(api.submit).not.toHaveBeenCalled();

    wrapper.vm.fields.phone = "13800138000";
    wrapper.vm.onFieldChange("phone");
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find("#phone").element.closest(".field-row").classList,
    ).not.toContain("field-row--invalid");
    await nextFormPage(wrapper);
    expect(wrapper.vm.step).toBe(2);

    wrapper.vm.fields.marriage = "";
    await submitSecondPage(wrapper);
    expect(wrapper.vm.step).toBe(2);
    expect(wrapper.vm.fieldErrors.marriage).toBeTruthy();
    expect(
      wrapper.find("#marriage").element.closest(".field-row").classList,
    ).toContain("field-row--invalid");
    expect(api.submit).not.toHaveBeenCalled();

    wrapper.vm.fields.marriage = "未婚";
    api.submit.mockResolvedValue({ status: "success" });
    await submitSecondPage(wrapper);
    expect(wrapper.vm.page).toBe("result");
    wrapper.destroy();
  });

  it("enters a phone number with the on-screen keypad and handles delete and clear", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    expect(wrapper.find(".phone-display").text()).toBe("138****8000");
    wrapper.vm.fields.phone = "";
    await wrapper.vm.$nextTick();
    await wrapper.find(".keypad-trigger").trigger("click");
    expect(
      wrapper.findComponent({ name: "KeypadDialog" }).props("visible"),
    ).toBe(true);

    const clickKey = async (label) => {
      const key = wrapper
        .findComponent({ name: "KeypadDialog" })
        .findAll(".keypad-grid .el-button")
        .wrappers.find((button) => button.text().trim() === label);
      expect(key, `keypad button "${label}"`).toBeTruthy();
      await key.trigger("click");
      await wrapper.vm.$nextTick();
    };
    await clickKey("1");
    await clickKey("3");
    await clickKey("8");
    expect(wrapper.vm.fields.phone).toBe("138");
    await clickKey("⌫");
    expect(wrapper.vm.fields.phone).toBe("13");
    await clickKey("X");
    expect(wrapper.vm.fields.phone).toBe("");

    wrapper.vm.fields.phone = "13800138000";
    await wrapper.vm.$nextTick();
    await clickKey("9");
    expect(wrapper.vm.fields.phone).toBe("13800138000");
    wrapper.destroy();
  });

  it("keeps the keypad open when the opening click reaches the document listener", async () => {
    // 真实浏览器里“打开键盘的那次点击”会继续冒泡到 document；只有把触发按钮
    // 也算作内部区域，键盘才不会刚打开就被同一次点击关掉。
    const wrapper = mountApp();
    await enterForm(wrapper, { ...validFields(), phone: "" });
    await wrapper.find(".keypad-trigger").trigger("click");
    const dialog = wrapper.findComponent({ name: "KeypadDialog" });
    expect(dialog.props("visible")).toBe(true);
    expect(dialog.props("anchor")).toBe(
      wrapper.find(".keypad-trigger").element,
    );

    dialog.vm.onOutsideClick({
      target: wrapper.find(".keypad-trigger").element,
    });
    expect(dialog.props("visible")).toBe(true);

    dialog.vm.onOutsideClick({ target: document.body });
    await wrapper.vm.$nextTick();
    expect(dialog.props("visible")).toBe(false);
    wrapper.destroy();
  });

  it.each([
    [
      "service failure",
      new Error("mock service unavailable"),
      "请先使用身份证、社保卡或电子医保凭证确认身份，再为您办理入院登记。",
    ],
    [
      "verification timeout",
      Object.assign(new Error(), { name: "AbortError" }),
      "请先使用身份证、社保卡或电子医保凭证确认身份，再为您办理入院登记。",
    ],
    [
      "patient profile not found",
      Object.assign(new Error(), { status: 404 }),
      "暂未查询到您的院内患者信息，请前往人工窗口协助办理入院登记。",
    ],
  ])(
    "keeps identity screen and offers a retry after %s",
    async (_name, error, message) => {
      const wrapper = mountApp();
      api.verify.mockRejectedValueOnce(error);
      await startAdmission(wrapper);
      await wrapper.find(".reader-trigger").trigger("click");
      await settle(wrapper);

      expect(wrapper.vm.page).toBe("identity");
      expect(wrapper.vm.verifying).toBe(false);
      expect(wrapper.find(".error-text").text()).toContain(message);

      api.verify.mockResolvedValueOnce({
        identityToken: "retry-token",
        fields: validFields(),
      });
      await wrapper.find(".reader-trigger").trigger("click");
      await settle(wrapper);
      expect(wrapper.vm.page).toBe("applications");
      wrapper.destroy();
    },
  );

  it("ignores duplicate identity verification while the first request is pending", async () => {
    const wrapper = mountApp();
    let resolveVerify;
    api.verify.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVerify = resolve;
      }),
    );
    await startAdmission(wrapper);

    const trigger = wrapper.find(".reader-trigger");
    await trigger.trigger("click");
    await trigger.trigger("click");
    expect(api.verify).toHaveBeenCalledOnce();
    expect(wrapper.vm.verifying).toBe(true);
    expect(trigger.attributes("disabled")).toBe("disabled");

    resolveVerify({
      identityToken: "identity-demo-token",
      fields: validFields(),
    });
    await settle(wrapper);
    expect(wrapper.vm.page).toBe("applications");
    wrapper.destroy();
  });

  it("records and transcribes on identity without sending identity-page speech to AI", async () => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "我的联系电话是13800138000" });

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    expect(wrapper.vm.recording).toBe(true);
    await wrapper.find(".mic-button").trigger("click");
    expect(wrapper.vm.recognizing).toBe(true);

    await recorder.options.onComplete(new Blob(["voice"]), false);
    expect(api.upload).toHaveBeenCalledOnce();
    const uploadedAudio = api.upload.mock.calls[0][1].get("audio");
    expect(uploadedAudio.type).toBe("audio/wav");
    expect(uploadedAudio.name).toBe("admission-audio.wav");
    expect(wrapper.vm.transcript).toBe("我的联系电话是13800138000");
    expect(api.extract).not.toHaveBeenCalled();
    expect(wrapper.vm.recognizing).toBe(false);
    wrapper.destroy();
  });

  it("keeps the final speech result and warns when the recording limit is reached", async () => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "联系电话13800138000" });

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    await wrapper.find(".mic-button").trigger("click");
    await recorder.options.onComplete(new Blob(["voice"]), true);

    expect(wrapper.vm.transcript).toBe("联系电话13800138000");
    expect(wrapper.vm.voiceError).toContain("60秒上限");
    wrapper.destroy();
  });

  it("does not start multiple recorders while the voice service check is pending", async () => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    let resolveProbe;
    api.platform.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const mic = wrapper.find(".mic-button");
    await mic.trigger("click");
    await mic.trigger("click");
    expect(api.platform).toHaveBeenCalledOnce();
    expect(wrapper.vm.startingVoice).toBe(true);

    resolveProbe({ active: true });
    await settle(wrapper);
    expect(recorder.start).toHaveBeenCalledOnce();
    expect(wrapper.vm.recording).toBe(true);
    wrapper.destroy();
  });

  it.each([
    ["empty recording", new Blob([]), null, "没有录到语音"],
    [
      "empty transcript",
      new Blob(["voice"]),
      { text: "  " },
      "没有识别到语音内容",
    ],
    [
      "speech service error",
      new Blob(["voice"]),
      new Error("speech service unavailable"),
      "speech service unavailable",
    ],
  ])(
    "shows recovery guidance for %s",
    async (_scenario, blob, uploadResult, expectedError) => {
      const wrapper = mountApp();
      await startAdmission(wrapper);
      api.platform.mockResolvedValueOnce({ active: true });
      if (uploadResult instanceof Error)
        api.upload.mockRejectedValueOnce(uploadResult);
      else if (uploadResult) api.upload.mockResolvedValueOnce(uploadResult);

      await wrapper.find(".mic-button").trigger("click");
      await settle(wrapper);
      await wrapper.find(".mic-button").trigger("click");
      await recorder.options.onComplete(blob, false);

      expect(wrapper.vm.voiceError).toContain(expectedError);
      expect(wrapper.vm.recognizing).toBe(false);
      wrapper.destroy();
    },
  );

  it("discards a speech result that finishes after the session resets", async () => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    api.platform.mockResolvedValueOnce({ active: true });
    let resolveUpload;
    api.upload.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    await wrapper.find(".mic-button").trigger("click");

    const completion = recorder.options.onComplete(new Blob(["voice"]), false);
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
    wrapper.vm.reset();
    resolveUpload({ text: "不应留存的语音内容" });
    await completion;
    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.transcript).toBe("");
    wrapper.destroy();
  });

  it("uses a form-page transcript to fill valid AI candidates", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, { ...validFields(), phone: "" });
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({
      text: "联系电话13800138000，联系人王小明",
    });
    api.extract.mockResolvedValueOnce({ fields: { phone: "13900139000" } });

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    await wrapper.find(".mic-button").trigger("click");
    await recorder.options.onComplete(new Blob(["voice"]), false);
    await settle(wrapper);

    expect(wrapper.vm.transcript).toContain("联系电话");
    expect(api.extract).toHaveBeenCalledWith(
      "联系电话13800138000，联系人王小明",
      1,
      "identity-demo-token",
      "session-demo-001",
      expect.any(AbortSignal),
    );
    expect(wrapper.vm.fields.phone).toBe("13900139000");
    expect(wrapper.vm.sources.phone).toBe("ai");
    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.text()).toContain("联系电话138****8000，联系人王小明");
    expect(dialog.text()).toContain("已回填");
    expect(wrapper.find(".transcript-bubble").exists()).toBe(false);
    expect(wrapper.find(".transcript-status").exists()).toBe(false);
    expect(api.saveTurn).toHaveBeenCalledOnce();
    expect(api.saveTurn.mock.calls[0][0]).toBe("session-demo-001");
    expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
      utterance: "联系电话13800138000，联系人王小明",
      fields: { phone: "13900139000" },
      previousTurnId: null,
    });
    expect(wrapper.vm.sessionRevision).toBe(1);
    wrapper.destroy();
  });

  it("opens the patient dialogue from voice or text and shows the next missing-field question", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, { ...validFields(), phone: "" });

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);

    expect(wrapper.findComponent({ name: "ConversationDialog" }).exists()).toBe(
      true,
    );
    expect(wrapper.find(".conversation-dialog").text()).toContain(
      "请告诉我您的联系电话",
    );
    expect(wrapper.find(".conversation-dialog__input").exists()).toBe(true);
    expect(wrapper.vm.conversationVisible).toBe(true);
    wrapper.destroy();
  });

  it.each([
    [
      "marriage",
      "未婚",
      ["未婚", "已婚", "离异", "丧偶"],
      ["marriage", "occupation", "emergencyContact", "relationship"],
      "您的婚姻状况是未婚、已婚、离异还是丧偶？",
      "好的，请问您的职业是什么？",
    ],
    [
      "occupation",
      "学生",
      ["职工", "农民", "退休", "无业", "学生", "其他"],
      ["occupation", "emergencyContact", "relationship"],
      "请问您的职业是什么？",
      "请告诉我您的紧急联系人姓名。",
    ],
    [
      "relationship",
      "子女",
      [
        "配偶",
        "子女",
        "父母",
        "祖父母/外祖父母",
        "孙辈/外孙辈",
        "兄弟姐妹",
        "其他亲属",
        "非亲属",
      ],
      ["relationship"],
      "您与该联系人的关系是什么？",
      "您的入院登记信息已填写完成，请核对后确认提交。",
    ],
  ])(
    "offers the form choices for %s and applies a selected value",
    async (key, value, options, blankKeys, question, chainedReply) => {
      const wrapper = mountApp();
      await enterForm(wrapper, {
        ...validFields(),
        ...Object.fromEntries(blankKeys.map((blank) => [blank, ""])),
      });
      wrapper.vm.step = 2;
      wrapper.vm.conversationVisible = true;
      await settle(wrapper);

      const dialog = wrapper.findComponent({ name: "ConversationDialog" });
      expect(dialog.text()).toContain(question);
      expect(
        dialog
          .findAll(".conversation-dialog__choices button")
          .wrappers.map((button) => button.text()),
      ).toEqual(options);

      await dialog
        .findAll(".conversation-dialog__choices button")
        .wrappers.find((button) => button.text() === value)
        .trigger("click");
      await settle(wrapper);

      expect(wrapper.vm.fields[key]).toBe(value);
      expect(wrapper.vm.sources[key]).toBe("manual");
      expect(api.extract).not.toHaveBeenCalled();
      expect(api.saveTurn).toHaveBeenCalledOnce();
      expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
        action: "manual_edit",
        utterance: value,
        fields: { [key]: value },
      });
      expect(dialog.text()).toContain(chainedReply);
      wrapper.destroy();
    },
  );

  it("asks before advancing from a completed page and moves to the next page on confirmation", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.conversationVisible = true;
    await settle(wrapper);

    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.text()).toContain(
      "本页必填信息已填写完整，是否继续填写下一页？",
    );
    expect(
      dialog
        .findAll(".conversation-dialog__choices button")
        .wrappers.map((button) => button.text()),
    ).toEqual(["继续下一页", "暂不继续"]);

    await dialog
      .findAll(".conversation-dialog__choices button")
      .wrappers.find((button) => button.text() === "继续下一页")
      .trigger("click");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.step).toBe(2);
    expect(api.confirmReview).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    expect(api.saveTurn.mock.calls[0][1]).toMatchObject({
      action: "manual_turn",
      utterance: "继续下一页",
    });
    wrapper.destroy();
  });

  it("uses an explicit text confirmation to advance without sending it to AI extraction", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.conversationVisible = true;
    await settle(wrapper);

    await wrapper.vm.submitConversationInput("好的。");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.step).toBe(2);
    expect(api.extract).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it("asks before entering the review page and does not submit on confirmation", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.step = 2;
    wrapper.vm.conversationVisible = true;
    await settle(wrapper);

    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.text()).toContain(
      "您的入院登记信息已填写完成，请核对后确认提交。",
    );
    expect(
      dialog
        .findAll(".conversation-dialog__choices button")
        .wrappers.map((button) => button.text()),
    ).toEqual(["进入核对页", "暂不继续"]);

    await dialog
      .findAll(".conversation-dialog__choices button")
      .wrappers.find((button) => button.text() === "进入核对页")
      .trigger("click");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("review");
    expect(api.confirmReview).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it("keeps the current page when the patient chooses not to continue", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.conversationVisible = true;
    await settle(wrapper);

    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    await dialog
      .findAll(".conversation-dialog__choices button")
      .wrappers.find((button) => button.text() === "暂不继续")
      .trigger("click");
    await settle(wrapper);

    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.step).toBe(1);
    expect(api.submit).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it("confirms a conflicting candidate by voice without extracting it again", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, {
      ...validFields(),
      addressDetail: "沈阳市教作业中心",
    });
    wrapper.vm.sources.addressDetail = "manual";
    api.platform.mockResolvedValue({ active: true });
    api.upload
      .mockResolvedValueOnce({ text: "地址是佳兆业中心，你写错了" })
      .mockResolvedValueOnce({ text: "好的，修改为佳兆业中心" });
    api.extract.mockResolvedValueOnce({
      fields: { addressDetail: "佳兆业中心" },
    });
    api.confirmCandidate.mockResolvedValueOnce({
      decision: "accept_candidate",
    });

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    await wrapper.find(".mic-button").trigger("click");
    await recorder.options.onComplete(new Blob(["voice"]), false);
    await settle(wrapper);

    expect(document.body.textContent).toContain("沈阳市教作业中心");
    expect(document.body.textContent).toContain("佳兆业中心");
    expect(wrapper.find(".candidate-confirmation-mic").exists()).toBe(true);

    await wrapper.find(".candidate-confirmation-mic").trigger("click");
    await settle(wrapper);
    await wrapper.find(".candidate-confirmation-mic").trigger("click");
    await recorder.options.onComplete(new Blob(["voice"]), false);
    await settle(wrapper);

    expect(api.extract).toHaveBeenCalledOnce();
    expect(api.confirmCandidate).toHaveBeenCalledWith(
      "好的，修改为佳兆业中心",
      "addressDetail",
      "沈阳市教作业中心",
      "佳兆业中心",
      expect.any(AbortSignal),
    );
    expect(wrapper.vm.fields.addressDetail).toBe("佳兆业中心");
    expect(wrapper.vm.candidateDialogKey).toBe("");
    wrapper.destroy();
  });

  it("keeps a conflict open when the voice confirmation is unclear", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, {
      ...validFields(),
      addressDetail: "沈阳市教作业中心",
    });
    wrapper.vm.sources.addressDetail = "manual";
    api.platform.mockResolvedValue({ active: true });
    api.upload
      .mockResolvedValueOnce({ text: "地址是佳兆业中心，你写错了" })
      .mockResolvedValueOnce({ text: "我不太确定" });
    api.extract.mockResolvedValueOnce({
      fields: { addressDetail: "佳兆业中心" },
    });
    api.confirmCandidate.mockResolvedValueOnce({ decision: "unknown" });

    for (let i = 0; i < 2; i += 1) {
      await wrapper
        .find(i === 0 ? ".mic-button" : ".candidate-confirmation-mic")
        .trigger("click");
      await settle(wrapper);
      await wrapper
        .find(i === 0 ? ".mic-button" : ".candidate-confirmation-mic")
        .trigger("click");
      await recorder.options.onComplete(new Blob(["voice"]), false);
      await settle(wrapper);
    }

    expect(wrapper.vm.fields.addressDetail).toBe("沈阳市教作业中心");
    expect(wrapper.vm.pendingCandidates.addressDetail).toBe("佳兆业中心");
    expect(wrapper.vm.candidateDialogKey).toBe("addressDetail");
    expect(document.body.textContent).toContain("没能判断您的选择");

    await clickDialogButton("保留当前内容");
    expect(wrapper.vm.fields.addressDetail).toBe("沈阳市教作业中心");
    expect(wrapper.vm.pendingCandidates.addressDetail).toBeUndefined();
    expect(wrapper.vm.candidateDialogKey).toBe("");
    wrapper.destroy();
  });

  it("discards a late voice decision after the conflict was resolved by clicking", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper, {
      ...validFields(),
      addressDetail: "沈阳市教作业中心",
    });
    wrapper.vm.$set(
      wrapper.vm.pendingCandidates,
      "addressDetail",
      "佳兆业中心",
    );
    wrapper.vm.candidateDialogKey = "addressDetail";
    let finishClassification;
    api.confirmCandidate.mockImplementationOnce(
      () => new Promise((resolve) => (finishClassification = resolve)),
    );

    const context = { ...wrapper.vm.candidateConfirmation };
    const classification = wrapper.vm.classifyCandidateConfirmation(
      "确认修改",
      wrapper.vm.generation,
      context,
    );
    await vi.waitFor(() => expect(api.confirmCandidate).toHaveBeenCalledOnce());
    wrapper.vm.resolveCandidate(false);
    finishClassification({ decision: "accept_candidate" });
    await classification;

    expect(wrapper.vm.fields.addressDetail).toBe("沈阳市教作业中心");
    expect(wrapper.vm.pendingCandidates.addressDetail).toBeUndefined();
    expect(wrapper.vm.candidateDialogKey).toBe("");
    wrapper.destroy();
  });

  it("shows region candidates as readable names and applies their original codes", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    wrapper.vm.candidateDialogKey = "nativeRegion";
    wrapper.vm.$set(wrapper.vm.pendingCandidates, "nativeRegion", [
      "210000",
      "210100",
      "210103",
    ]);
    await wrapper.vm.$nextTick();

    expect(document.body.textContent).toContain("辽宁省 / 沈阳市 / 沈河区");
    expect(document.body.textContent).not.toContain("210000");
    await clickDialogButton("修改为识别内容");
    expect(wrapper.vm.fields.nativeRegion).toEqual([
      "210000",
      "210100",
      "210103",
    ]);
    wrapper.destroy();
  });

  it.each([
    ["voice service unavailable", "服务暂不可用"],
    ["microphone permission denied", "麦克风权限被拒绝"],
  ])("shows a recoverable error when %s", async (message, errorText) => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    if (message === "voice service unavailable")
      api.platform.mockRejectedValueOnce(new Error(errorText));
    else recorder.start.mockRejectedValueOnce(new Error(errorText));

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    expect(wrapper.vm.recording).toBe(false);
    expect(wrapper.vm.voiceError).toBe(errorText);
    wrapper.destroy();
  });

  it("keeps the transcript when candidate extraction is unavailable", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    api.platform.mockResolvedValueOnce({ active: true });
    api.upload.mockResolvedValueOnce({ text: "联系电话13800138000" });
    api.extract.mockRejectedValueOnce(new Error("model unavailable"));

    await wrapper.find(".mic-button").trigger("click");
    await settle(wrapper);
    await wrapper.find(".mic-button").trigger("click");
    await recorder.options.onComplete(new Blob(["voice"]), false);
    await settle(wrapper);

    expect(wrapper.vm.transcript).toBe("联系电话13800138000");
    expect(wrapper.vm.aiNotice).toContain("转写已保留");
    expect(wrapper.vm.fields.phone).toBe("13800138000");
    wrapper.destroy();
  });

  it("plays and releases an explicitly requested voice prompt", async () => {
    const wrapper = mount(App, { localVue });
    api.tts.mockResolvedValueOnce("blob:voice-prompt");
    URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    await wrapper.vm.speak("请将证件放置到读卡区。");
    expect(api.tts).toHaveBeenCalledWith(
      "请将证件放置到读卡区。",
      expect.any(AbortSignal),
    );
    expect(wrapper.find("audio").element.getAttribute("src")).toBe(
      "blob:voice-prompt",
    );

    wrapper.vm.releaseAudio();
    expect(wrapper.find("audio").element.getAttribute("src")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-prompt");
    expect(wrapper.vm.audioUrl).toBe("");
    wrapper.destroy();
  });

  it("shows a recoverable message when voice prompt playback is unavailable", async () => {
    const wrapper = mount(App, { localVue });
    api.tts.mockRejectedValueOnce(new Error("TTS unavailable"));

    await wrapper.vm.speak("请将证件放置到读卡区。");

    // 提示内联在语音区，不用会盖住顶部品牌与日期的全局 toast。
    expect(wrapper.vm.voiceError).toBe("TTS unavailable");
    expect(wrapper.vm.ttsRequest).toBeNull();
    wrapper.destroy();
  });

  it("supports canceling or confirming the exit prompt on the identity page", async () => {
    const wrapper = mountApp();
    await startAdmission(wrapper);
    await wrapper.find(".reader-close").trigger("click");
    expect(wrapper.vm.cancelVisible).toBe(true);

    await clickDialogButton("继续办理");
    expect(wrapper.vm.page).toBe("identity");
    expect(wrapper.vm.cancelVisible).toBe(false);

    await wrapper.find(".reader-close").trigger("click");
    await clickDialogButton("确认退出");
    expect(wrapper.vm.page).toBe("home");
    expect(wrapper.vm.identityToken).toBe("");
    wrapper.destroy();
  });

  it.each([
    [422, "form", "服务端字段错误", 1],
    [409, "result", "failed", 2],
    [503, "result", "unknown", 2],
  ])(
    "handles submit response %s with the correct recovery path",
    async (status, page, result, step) => {
      const wrapper = mountApp();
      await enterForm(wrapper);
      await nextFormPage(wrapper);
      api.submit.mockRejectedValueOnce(
        Object.assign(new Error("submit failed"), {
          status,
          body: { detail: { errors: { phone: "服务端字段错误" } } },
        }),
      );
      await submitSecondPage(wrapper);

      expect(wrapper.vm.page).toBe(page);
      expect(wrapper.vm.step).toBe(step);
      if (page === "form")
        expect(wrapper.vm.fieldErrors.phone).toBe("服务端字段错误");
      else expect(wrapper.vm.result.status).toBe(result);
      wrapper.destroy();
    },
  );

  it("queries an unknown submission and finishes after the result is confirmed", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await nextFormPage(wrapper);
    api.submit.mockRejectedValueOnce(
      Object.assign(new Error("network lost"), { status: 503 }),
    );
    await submitSecondPage(wrapper);
    expect(wrapper.vm.result.status).toBe("unknown");

    api.result.mockResolvedValueOnce({
      status: "success",
      receiptId: "RECOVERED-1",
    });
    await wrapper.find(".primary-action").trigger("click");
    await settle(wrapper);
    expect(api.result).toHaveBeenCalledOnce();
    expect(wrapper.vm.result.status).toBe("success");
    expect(wrapper.find(".receipt").text()).toContain("RECOVERED-1");

    await wrapper.find(".secondary-action").trigger("click");
    expect(wrapper.vm.page).toBe("home");
    wrapper.destroy();
  });

  it.each([
    ["still unknown", { status: "unknown" }, "unknown"],
    ["lookup unavailable", new Error("lookup unavailable"), "unknown"],
  ])(
    "keeps the result pending when %s",
    async (_case, lookup, resultStatus) => {
      const wrapper = mountApp();
      await enterForm(wrapper);
      await nextFormPage(wrapper);
      api.submit.mockRejectedValueOnce(
        Object.assign(new Error("network lost"), { status: 503 }),
      );
      await submitSecondPage(wrapper);
      api.result.mockImplementationOnce(() =>
        lookup instanceof Error
          ? Promise.reject(lookup)
          : Promise.resolve(lookup),
      );

      await wrapper.find(".primary-action").trigger("click");
      await settle(wrapper);
      expect(wrapper.vm.page).toBe("result");
      expect(wrapper.vm.result.status).toBe(resultStatus);
      expect(wrapper.vm.checkingResult).toBe(false);
      wrapper.destroy();
    },
  );

  it("returns a failed submission to the last form page for retry", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await nextFormPage(wrapper);
    api.submit.mockRejectedValueOnce(
      Object.assign(new Error("declined"), { status: 409 }),
    );
    await submitSecondPage(wrapper);
    const originalKey = wrapper.vm.idempotencyKey;
    expect(wrapper.vm.result.status).toBe("failed");

    await wrapper.find(".primary-action").trigger("click");
    expect(wrapper.vm.page).toBe("form");
    expect(wrapper.vm.step).toBe(2);
    expect(wrapper.vm.idempotencyKey).toBe("");
    expect(wrapper.vm.fields.phone).toBe("13800138000");

    api.submit.mockResolvedValueOnce({ status: "success" });
    await submitSecondPage(wrapper);
    expect(wrapper.vm.page).toBe("result");
    expect(wrapper.vm.idempotencyKey).not.toBe(originalKey);
    wrapper.destroy();
  });

  it("returns home after an already-registered result without offering a retry", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await nextFormPage(wrapper);
    api.submit.mockResolvedValueOnce({ status: "already_registered" });
    await submitSecondPage(wrapper);

    expect(wrapper.find(".result-panel h2").text()).toBe("发现已有登记记录");
    expect(wrapper.find(".primary-action").exists()).toBe(false);
    await wrapper.find(".secondary-action").trigger("click");
    expect(wrapper.vm.page).toBe("home");
    wrapper.destroy();
  });

  it("clears patient data from the page after a completed mock submission", async () => {
    const wrapper = mountApp();
    await enterForm(wrapper);
    await nextFormPage(wrapper);
    api.submit.mockResolvedValueOnce({
      status: "success",
      receiptId: "SIM-001",
    });

    await submitSecondPage(wrapper);

    expect(wrapper.vm.page).toBe("result");
    expect(wrapper.vm.result.receiptId).toBe("SIM-001");
    expect(wrapper.vm.identityToken).toBe("");
    expect(wrapper.vm.sessionId).toBe("");
    expect(wrapper.vm.fields.phone).toBe("");
    expect(wrapper.vm.fields.marriage).toBe("");
    expect(wrapper.vm.fields.occupation).toBe("");
    expect(wrapper.vm.fields.emergencyContact).toBe("");
    expect(wrapper.vm.fields.relationship).toBe("");
    wrapper.destroy();
  });

  it("counts down on identity and both form pages and resets after activity", async () => {
    vi.useFakeTimers();
    const wrapper = mountApp();
    await startAdmission(wrapper);
    expect(wrapper.find(".reader-countdown").text()).toBe("倒计时300s");

    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find(".reader-countdown").text()).toBe("倒计时297s");

    api.verify.mockResolvedValue({
      identityToken: "identity-demo-token",
      fields: validFields(),
    });
    await wrapper.find(".reader-trigger").trigger("click");
    await settle(wrapper);
    await wrapper.find(".application-select").trigger("click");
    await wrapper.find(".application-continue").trigger("click");
    await settle(wrapper);
    expect(wrapper.find(".form-countdown").text()).toBe("倒计时300s");
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.find(".form-countdown").text()).toBe("倒计时298s");

    wrapper.vm.fields.phone = "13800138000";
    wrapper.vm.onFieldChange("phone");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".form-countdown").text()).toBe("倒计时300s");

    await nextFormPage(wrapper);
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.vm.step).toBe(2);
    expect(wrapper.find(".form-countdown").text()).toBe("倒计时299s");
    wrapper.destroy();
  });

  it(
    "offers the idle warning, resumes the session, then expires to home",
    { timeout: 20000 },
    async () => {
      vi.useFakeTimers();
      const wrapper = mountApp();
      wrapper.vm.page = "form";

      await vi.advanceTimersByTimeAsync(299000);
      expect(wrapper.find(".form-countdown").text()).toBe("倒计时1s");
      await vi.advanceTimersByTimeAsync(1000);
      expect(wrapper.find(".form-countdown").text()).toBe("倒计时0s");
      expect(wrapper.vm.idleVisible).toBe(true);
      expect(wrapper.vm.idleRemaining).toBe(30);

      wrapper.vm.continueSession();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.idleVisible).toBe(false);
      expect(wrapper.find(".form-countdown").text()).toBe("倒计时300s");
      await vi.advanceTimersByTimeAsync(330000);
      expect(wrapper.vm.page).toBe("home");
      expect(wrapper.vm.fields.phone).toBe("");
      wrapper.destroy();
    },
  );
});
