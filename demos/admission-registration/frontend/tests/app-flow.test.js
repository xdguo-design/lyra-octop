import { mount, createLocalVue } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ElementUI from "element-ui";
import App from "../src/App.vue";
import regions from "../../contracts/regions.mock.json";
import { buildRegionOptions } from "../src/model/formConfig.js";
import { loadValidation } from "../src/model/validationLoader.js";

const { api } = vi.hoisted(() => ({
  api: {
    regions: vi.fn(),
    verify: vi.fn(),
    validate: vi.fn(),
    confirmReview: vi.fn(),
    submit: vi.fn(),
    result: vi.fn(),
    extract: vi.fn(),
    platform: vi.fn(),
    tts: vi.fn(),
  },
}));

vi.mock("../src/api/admission.js", () => ({
  admissionApi: api,
  extractCandidates: api.extract,
  platformJson: api.platform,
  platformTts: api.tts,
}));

const localVue = createLocalVue();
localVue.use(ElementUI);

function readyFields() {
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

describe("admission page workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.regions.mockResolvedValue({ items: buildRegionOptions(regions) });
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
  });

  it("keeps the screenshot shortcut copy and two-page field split", () => {
    const wrapper = mount(App, { localVue });

    expect(wrapper.vm.shortcuts).toEqual([
      "住院登记需要准备什么材料",
      "如何填写紧急联系人",
      "住院登记的办理流程",
      "我要办理住院登记",
    ]);
    expect(
      wrapper.vm.groups.map((group) => group.fields.map((field) => field.key)),
    ).toEqual([
      [
        "name",
        "idNumber",
        "phone",
        "nationality",
        "ethnicity",
        "nativeRegion",
        "residentRegion",
        "addressDetail",
      ],
      [
        "employerName",
        "employerAddress",
        "marriage",
        "occupation",
        "emergencyContact",
        "relationship",
      ],
    ]);
    expect(wrapper.text()).not.toContain("模拟情景");
    expect(wrapper.text()).not.toContain("听我说");
    wrapper.destroy();
  });

  it("asks the host preview to close when backing out from the home page", () => {
    const postMessage = vi.spyOn(window.top, "postMessage");
    const wrapper = mount(App, { localVue });

    wrapper.vm.goBack();

    expect(postMessage).toHaveBeenCalledWith(
      { type: "octop:close-creation-preview" },
      window.location.origin,
    );
    expect(wrapper.vm.page).toBe("home");
    postMessage.mockRestore();
    wrapper.destroy();
  });

  it("opens identity verification as a separate page from the admission shortcut", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.speak = vi.fn();
    document.documentElement.scrollTop = 240;

    await wrapper.findAll(".prompt-button").at(3).trigger("click");

    expect(wrapper.vm.page).toBe("identity");
    expect(wrapper.find(".mascot-stage").exists()).toBe(true);
    expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "VoiceStage" }).exists()).toBe(true);
    expect(wrapper.find(".bottom-bar").exists()).toBe(true);
    expect(wrapper.find(".reader-card").exists()).toBe(true);
    expect(wrapper.vm.transcript).toBe("");
    expect(wrapper.vm.aiNotice).toBe("");
    expect(document.documentElement.scrollTop).toBe(0);
    expect(wrapper.find(".self-mode").exists()).toBe(false);
    expect(wrapper.find(".page-content .reader-card").exists()).toBe(true);
    expect(wrapper.find(".page-shell > .bottom-bar").exists()).toBe(true);
    expect(wrapper.find(".entered-label").text()).toBe(
      "您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。",
    );
    expect(wrapper.vm.speak).toHaveBeenCalledWith(
      "请将证件放置到读卡区，然后点击“模拟刷卡”。",
    );

    const identityCard = wrapper.findComponent({ name: "IdentityCard" });
    expect(identityCard.find(".reader-trigger").text()).toBe("模拟刷卡");
    expect(
      wrapper
        .findComponent({ name: "ConversationDialog" })
        .findAll('[aria-label="模拟刷卡"]'),
    ).toHaveLength(0);
    expect(identityCard.find(".reader-terminal-image").exists()).toBe(true);
    expect(identityCard.find(".reader-terminal-image").attributes("alt")).toBe(
      "自助机身份证识别区",
    );
    expect(identityCard.find(".reader-target-pulse").exists()).toBe(true);
    expect(identityCard.find(".reader-target-ring").exists()).toBe(false);
    expect(
      identityCard.find(".reader-card").find(".speak-hint").exists(),
    ).toBe(true);
    await identityCard.find(".reader-trigger").trigger("click");
    expect(identityCard.emitted("verify")).toHaveLength(1);
    wrapper.destroy();
  });

  it("closes the home conversation when the admission shortcut opens identity verification", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.speak = vi.fn();
    wrapper.vm.openConversation("text");
    wrapper.vm.appendConversationMessages(wrapper.vm.homeConversationMessages, {
      role: "assistant",
      text: "之前的导诊回复",
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".conversation-dialog-backdrop").exists()).toBe(true);

    await wrapper.findAll(".prompt-button").at(3).trigger("click");

    expect(wrapper.vm.page).toBe("identity");
    expect(wrapper.find(".reader-card").exists()).toBe(true);
    expect(wrapper.vm.conversationVisible).toBe(false);
    expect(wrapper.find(".conversation-dialog-backdrop").exists()).toBe(false);
    expect(
      wrapper.vm.dialogMessages.some(
        (message) => message.text === "之前的导诊回复",
      ),
    ).toBe(true);
    wrapper.destroy();
  });

  it("appends the identity scene below the home stage without a voice bar on home", async () => {
    const wrapper = mount(App, { localVue });

    expect(wrapper.find(".mascot-stage").exists()).toBe(true);
    // 首页底部改为输入条形态，不再有独立的自助模式按钮
    expect(wrapper.find(".self-mode").exists()).toBe(false);
    expect(wrapper.find(".user-bar").exists()).toBe(false);
    expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "VoiceStage" }).exists()).toBe(true);
    expect(wrapper.find(".home-guide-reply").text()).toContain(
      "您好，请告诉我您需要办理什么。",
    );
    expect(
      wrapper.find(".home-guidance .conversation-message--assistant").exists(),
    ).toBe(true);

    wrapper.vm.page = "identity";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".reader-card").exists()).toBe(true);
    // 单页面连续追加：首页舞台与快捷问句保留，身份场景接在其后
    expect(wrapper.find(".mascot-stage").exists()).toBe(true);
    expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "VoiceStage" }).exists()).toBe(true);

    wrapper.vm.page = "form";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".mascot-stage").exists()).toBe(false);
    expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
      false,
    );
    expect(wrapper.findComponent({ name: "VoiceStage" }).exists()).toBe(true);

    expect(wrapper.find(".self-mode").exists()).toBe(false);
    expect(wrapper.find(".mic-button").exists()).toBe(true);
    wrapper.vm.step = 2;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".self-mode").exists()).toBe(false);

    wrapper.vm.page = "result";
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: "ResultPanel" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "VoiceStage" }).exists()).toBe(false);
    expect(wrapper.find(".bottom-bar").exists()).toBe(true);

    wrapper.vm.reset();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".mascot-stage").exists()).toBe(true);
    expect(wrapper.findComponent({ name: "ConversationCard" }).exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "VoiceStage" }).exists()).toBe(true);
    expect(wrapper.find(".voice-pill").exists()).toBe(true);
    wrapper.destroy();
  });

  it("opens and dismisses the admission guide overlay from help on the home page", async () => {
    const wrapper = mount(App, { localVue });

    expect(wrapper.find(".guide-overlay").exists()).toBe(false);
    await wrapper.find(".help-button").trigger("click");
    expect(wrapper.find(".guide-overlay").exists()).toBe(true);
    expect(wrapper.find(".guide-spotlight").exists()).toBe(true);
    expect(wrapper.find(".guide-card").text()).toContain(
      "按住下方麦克风描述需求",
    );

    await wrapper.find(".guide-card button").trigger("click");
    expect(wrapper.find(".guide-overlay").exists()).toBe(false);
    wrapper.destroy();
  });

  it("opens the home conversation with a bottom text input that switches back to voice", async () => {
    const wrapper = mount(App, { localVue });
    const classify = vi
      .spyOn(wrapper.vm, "classifyHomeIntent")
      .mockResolvedValue();

    await wrapper.find(".manual-entry-button").trigger("click");
    expect(wrapper.classes()).toContain("page-shell--test-input");

    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.exists()).toBe(true);
    expect(dialog.classes()).toContain("conversation-dialog-backdrop");
    expect(dialog.find(".conversation-dialog__messages").exists()).toBe(true);
    expect(dialog.find(".conversation-message__speaker").exists()).toBe(true);
    expect(dialog.find(".conversation-dialog__mobile-input").exists()).toBe(
      false,
    );
    expect(wrapper.find(".voice-pill__hold").exists()).toBe(false);
    await wrapper.find(".voice-pill__input").setValue("我要办理入院登记");
    await wrapper.find(".voice-pill--text").trigger("submit");

    expect(classify).toHaveBeenCalledWith(
      "我要办理入院登记",
      wrapper.vm.generation,
    );
    await wrapper.find(".voice-pill__mode").trigger("click");
    expect(wrapper.find(".voice-pill__hold").exists()).toBe(true);
    wrapper.destroy();
  });

  it("keeps manual reply playback separate from automatic speech mode", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.speak = vi.fn();
    wrapper.vm.page = "identity";
    wrapper.vm.conversationVisible = true;
    await wrapper.vm.$nextTick();
    wrapper.vm.speak.mockClear();

    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(dialog.find(".conversation-dialog__desktop-input").exists()).toBe(
      false,
    );
    expect(dialog.find(".conversation-dialog__mobile-input").exists()).toBe(
      false,
    );
    expect(
      dialog.find(".conversation-message__speaker").attributes("aria-label"),
    ).toBe("播放此回复");
    await dialog.find(".conversation-message__speaker").trigger("click");
    expect(wrapper.vm.autoSpeakAssistant).toBe(false);
    expect(wrapper.vm.speak).toHaveBeenCalledWith(
      expect.stringContaining("请将证件放置到读卡区"),
    );
    expect(
      dialog.find(".conversation-autoplay").attributes("aria-pressed"),
    ).toBe("false");

    await dialog.find(".conversation-autoplay").trigger("click");
    expect(wrapper.vm.autoSpeakAssistant).toBe(true);

    await wrapper.vm.replyToConversation("继续办理", "请准备好您的证件。");
    expect(wrapper.vm.speak).toHaveBeenLastCalledWith("请准备好您的证件。");
    expect(wrapper.vm.speak).toHaveBeenCalledTimes(2);

    await dialog.find(".conversation-autoplay").trigger("click");
    expect(wrapper.vm.autoSpeakAssistant).toBe(false);
    expect(wrapper.vm.speak).toHaveBeenCalledTimes(2);
    await dialog.find(".conversation-message__speaker").trigger("click");
    expect(wrapper.vm.autoSpeakAssistant).toBe(false);
    expect(wrapper.vm.speak).toHaveBeenCalledTimes(3);

    wrapper.vm.page = "applications";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.speak).toHaveBeenCalledTimes(3);
    wrapper.destroy();
  });

  it("plays automatic replies in order and drops queued replies when switched off", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.speak = vi.fn().mockResolvedValue(true);
    wrapper.vm.toggleAutoSpeak();

    wrapper.vm.speakAssistantReply("已记录联系电话。");
    wrapper.vm.speakAssistantReply("请问您的职业是什么？");
    expect(wrapper.vm.speak.mock.calls).toEqual([["已记录联系电话。"]]);

    await wrapper.find("audio").trigger("ended");
    expect(wrapper.vm.speak.mock.calls).toEqual([
      ["已记录联系电话。"],
      ["请问您的职业是什么？"],
    ]);
    wrapper.vm.speakAssistantReply("请补充紧急联系人。");
    wrapper.vm.toggleAutoSpeak();
    await wrapper.find("audio").trigger("ended");
    wrapper.vm.toggleAutoSpeak();
    expect(wrapper.vm.speak).toHaveBeenCalledTimes(2);
    wrapper.destroy();
  });

  it("retains completed registration sections before the current stage on the same page", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.speak = vi.fn();
    wrapper.vm.page = "identity";
    await wrapper.vm.$nextTick();
    wrapper.vm.identityToken = "demo-token";
    wrapper.vm.fields = readyFields();
    wrapper.vm.page = "applications";
    await wrapper.vm.$nextTick();
    wrapper.vm.activeApplication = {
      id: "application-demo",
      patientName: "演示患者",
      department: "演示内科",
      plannedAdmissionAt: "2026-10-21",
    };
    wrapper.vm.page = "form";
    await wrapper.vm.$nextTick();
    wrapper.vm.step = 2;
    await wrapper.vm.$nextTick();
    expect(
      wrapper.findAll(".page-content .workflow-history article"),
    ).toHaveLength(4);
    expect(wrapper.find(".page-content .workflow-history").text()).toContain(
      "138****8000",
    );
    expect(
      wrapper.find(".page-content .workflow-history").text(),
    ).not.toContain("13800138000");
    expect(wrapper.find(".page-content .workflow-history").text()).toContain(
      "演示内科",
    );
    expect(wrapper.find(".workflow-history").element.nextElementSibling).toBe(
      wrapper.find(".admission-scene").element,
    );
    expect(wrapper.find(".form-countdown").exists()).toBe(false);
    expect(wrapper.find(".bottom-bar .home-countdown").text()).toBe(
      "倒计时 300 秒",
    );

    wrapper.vm.conversationVisible = true;
    await wrapper.vm.$nextTick();
    expect(
      wrapper.findAll(".page-content .workflow-history article"),
    ).toHaveLength(4);
    expect(wrapper.find(".page-content").isVisible()).toBe(true);
    wrapper.vm.page = "review";
    await wrapper.vm.$nextTick();
    wrapper.vm.result = { status: "success", receiptId: "demo-receipt" };
    wrapper.vm.page = "result";
    await wrapper.vm.$nextTick();
    expect(
      wrapper.findAll(".page-content .workflow-history article"),
    ).toHaveLength(6);
    expect(wrapper.find(".result-panel").text()).toContain("demo-receipt");
    expect(wrapper.find(".workflow-history").text()).toContain("信息核对");

    wrapper.vm.reset();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.workflowHistory).toEqual([]);
    expect(wrapper.text()).not.toContain("demo-receipt");
    wrapper.destroy();
  });

  it("leaves earlier messages before each newly appended stage and keeps new replies at the end", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.speak = vi.fn();
    wrapper.vm.conversationVisible = true;
    await wrapper.vm.$nextTick();
    wrapper.vm.appendConversationMessages(null, {
      role: "patient",
      text: "首页测试问题",
    });
    wrapper.vm.page = "identity";
    await wrapper.vm.$nextTick();
    wrapper.vm.appendConversationMessages(null, {
      role: "assistant",
      text: "核验阶段测试回复",
    });
    wrapper.vm.page = "applications";
    await wrapper.vm.$nextTick();
    wrapper.vm.activeApplication = {
      id: "demo-application",
      department: "演示内科",
    };
    wrapper.vm.page = "form";
    wrapper.vm.appendConversationMessages(null, {
      role: "assistant",
      text: "资料填写阶段新回复",
    });
    await wrapper.vm.$nextTick();

    const content = wrapper.find(".page-content");
    const history = content.find(".workflow-history");
    const stage = content.find(".admission-scene");
    const dialog = wrapper.findComponent({ name: "ConversationDialog" });
    expect(history.element.compareDocumentPosition(stage.element) & 4).toBe(4);
    expect(stage.element.compareDocumentPosition(dialog.element) & 4).toBe(4);
    expect(history.text().indexOf("首页测试问题")).toBeLessThan(
      history.text().indexOf("核验阶段测试回复"),
    );
    expect(history.findAll(".conversation-message--patient")).toHaveLength(1);
    expect(dialog.text()).not.toContain("首页测试问题");
    expect(dialog.text()).not.toContain("核验阶段测试回复");
    expect(dialog.text()).toContain("资料填写阶段新回复");
    expect(history.text()).not.toContain("资料填写阶段新回复");
    expect(
      wrapper.vm.dialogMessages.some(
        (message) => message.text === "首页测试问题",
      ),
    ).toBe(true);
    wrapper.vm.reset();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain("首页测试问题");
    expect(wrapper.text()).not.toContain("资料填写阶段新回复");
    wrapper.destroy();
  });

  it("formats one valid application for confirmation and leaves query errors as process notices", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.page = "applications";
    wrapper.vm.applications = [
      {
        id: "APP-DEMO-1",
        patientName: "演示患者",
        department: "心内科",
        plannedAdmissionAt: "2026-10-22 09:00",
        doctor: "王医生",
        type: "普通住院",
        diagnosis: "冠心病待查",
        ward: "心内科一区",
        status: "有效",
      },
    ];
    wrapper.vm.announceApplicationPage();
    expect(wrapper.vm.dialogMessages.at(-1).application).toMatchObject({
      id: "APP-DEMO-1",
      patientName: "演**者",
      status: "有效",
    });
    expect(wrapper.vm.dialogMessages.at(-1).text).toContain("请核对页面");

    wrapper.vm.applications.push({ id: "APP-DEMO-2", status: "有效" });
    wrapper.vm.applicationError = "检测到多份有效的入院申请单";
    wrapper.vm.announceApplicationPage();
    expect(wrapper.vm.dialogMessages.at(-1).application).toBeUndefined();
    expect(wrapper.vm.dialogMessages.at(-1).text).toContain("多份有效");
    wrapper.destroy();
  });

  it("overwrites profile values with AI candidates and preserves manually edited conflicts", async () => {
    const validation = await loadValidation();
    validation.setRegions([
      {
        value: "110000",
        label: "北京市",
        children: [
          {
            value: "110100",
            label: "北京市",
            children: [{ value: "110105", label: "朝阳区" }],
          },
        ],
      },
      {
        value: "210000",
        label: "辽宁省",
        children: [
          {
            value: "210100",
            label: "沈阳市",
            children: [{ value: "210103", label: "沈河区" }],
          },
        ],
      },
    ]);
    const wrapper = mount(App, { localVue, attachTo: document.body });
    wrapper.vm.page = "form";
    wrapper.vm.identityToken = "demo-token";
    wrapper.vm.fields = {
      ...readyFields(),
      phone: "13900139000",
      nativeRegion: ["110000", "110100", "110105"],
      residentRegion: ["110000", "110100", "110105"],
    };
    api.extract.mockResolvedValue({
      fields: {
        phone: "13800138000",
        addressDetail: "北京市朝阳区建国路1号",
        relationship: "朋友",
        nativeRegion: ["210000", "210100", "210103"],
        residentRegion: ["210000", "210100", "210103"],
      },
    });

    await wrapper.vm.applyAi(
      "手机号13800138000，地址北京市朝阳区建国路1号，关系朋友",
      wrapper.vm.generation,
    );

    expect(wrapper.vm.fields.phone).toBe("13800138000");
    expect(wrapper.vm.pendingCandidates.phone).toBeUndefined();
    expect(wrapper.vm.fields.addressDetail).toBe("北京市朝阳区建国路1号");
    expect(wrapper.vm.fields.relationship).toBe("子女");
    expect(wrapper.vm.fields.nativeRegion).toEqual([
      "210000",
      "210100",
      "210103",
    ]);
    expect(wrapper.vm.fields.residentRegion).toEqual([
      "210000",
      "210100",
      "210103",
    ]);

    wrapper.vm.fields.phone = "13900139000";
    wrapper.vm.sources.phone = "manual";
    await wrapper.vm.applyAi("手机号13800138000", wrapper.vm.generation);
    expect(wrapper.vm.fields.phone).toBe("13900139000");
    expect(wrapper.vm.pendingCandidates.phone).toBe("13800138000");
    await wrapper.vm.$nextTick();
    wrapper.vm.resolveCandidate(true);
    expect(wrapper.vm.fields.phone).toBe("13800138000");
    expect(wrapper.vm.candidateDialogKey).toBe("");

    wrapper.vm.fields.phone = "";
    wrapper.vm.sources.phone = "manual";
    await wrapper.vm.applyAi("手机号13800138000", wrapper.vm.generation);
    expect(wrapper.vm.fields.phone).toBe("");
    expect(wrapper.vm.pendingCandidates.phone).toBe("13800138000");
    expect(wrapper.vm.candidateDialogKey).toBe("phone");
    await wrapper.vm.$nextTick();
    wrapper.destroy();
  });

  it("shows a specific notice when the AI provider rate limits a request", async () => {
    const wrapper = mount(App, { localVue });
    wrapper.vm.page = "form";
    wrapper.vm.identityToken = "demo-token";
    wrapper.vm.transcript = "联系电话13800138000";
    const error = new Error("rate limited");
    error.status = 429;
    error.body = {
      detail: {
        code: "AI_RATE_LIMITED",
        message: "AI 服务请求过于频繁，请稍后重试；转写内容已保留。",
      },
    };
    api.extract.mockRejectedValue(error);

    await wrapper.vm.applyAi(wrapper.vm.transcript, wrapper.vm.generation);

    expect(wrapper.vm.aiNotice).toBe(
      "AI 服务请求过于频繁，请稍后重试；转写内容已保留。",
    );
    expect(wrapper.vm.transcript).toBe("联系电话13800138000");
    wrapper.destroy();
  });

  it("prevents duplicate submit clicks while the first request is pending", async () => {
    await loadValidation();
    const wrapper = mount(App, { localVue });
    wrapper.vm.page = "form";
    wrapper.vm.step = 2;
    wrapper.vm.identityToken = "demo-token";
    wrapper.vm.fields = readyFields();
    wrapper.vm.sessionId = "session-demo-001";
    wrapper.vm.activeApplication = {
      id: "APP-DEMO-001",
      department: "心内科",
      plannedAdmissionAt: "2026-10-22 09:00",
    };
    api.validate.mockResolvedValue({ valid: true, errors: {} });
    api.confirmReview.mockResolvedValue({ reviewRevision: 1 });
    let completeSubmit;
    api.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeSubmit = resolve;
        }),
    );
    await wrapper.vm.$nextTick();

    await wrapper.find(".confirm-submit").trigger("click");
    await wrapper.vm.$nextTick();
    const submit = wrapper.find(".review-submit");
    await submit.trigger("click");
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    expect(submit.attributes("disabled")).toBe("disabled");
    await submit.trigger("click");

    expect(api.submit).toHaveBeenCalledTimes(1);
    completeSubmit({ status: "success", mock: true });
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.page).toBe("result");
    wrapper.destroy();
  });
});
