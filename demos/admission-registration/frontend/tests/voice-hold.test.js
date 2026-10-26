import { mount, createLocalVue } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ElementUI from "element-ui";
import App from "../src/App.vue";
import VoiceHoldOverlay from "../src/components/VoiceHoldOverlay.vue";
import VoiceStage from "../src/components/VoiceStage.vue";
import regions from "../../contracts/regions.mock.json";
import { buildRegionOptions } from "../src/model/formConfig.js";

const { api, recorder, microphone } = vi.hoisted(() => ({
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
  microphone: { available: true },
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
  canUseMicrophone: vi.fn(() => microphone.available),
  MIC_UNSUPPORTED_MESSAGE:
    "当前页面未开启麦克风接口（需 HTTPS 或 127.0.0.1/localhost 打开），无法录音，请改用「手动输入」。",
}));

const localVue = createLocalVue();
localVue.use(ElementUI);

function mountApp() {
  // 挂到 document 上，pointer 事件才能按真实路径冒泡到 window。
  const wrapper = mount(App, { localVue, attachTo: document.body });
  wrapper.vm.speak = vi.fn();
  return wrapper;
}

async function settle(wrapper) {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
    await wrapper.vm.$nextTick();
  }
}

// jsdom 没有可用的 PointerEvent 构造器，用带任意 type 的 MouseEvent 模拟指针手势。
function firePointer(selector, type, extra = {}) {
  document
    .querySelector(selector)
    .dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, ...extra }),
    );
}

async function startHold(wrapper) {
  firePointer(".mic-button", "pointerdown", { clientY: 400 });
  await settle(wrapper);
}

describe("VoiceHoldOverlay", () => {
  it("renders nothing while idle and switches copy in the cancel zone", async () => {
    const wrapper = mount(VoiceHoldOverlay);
    expect(wrapper.find(".voice-hold-overlay").exists()).toBe(false);

    await wrapper.setProps({
      visible: true,
      soundDetected: true,
      volumeLevel: 0.5,
    });
    expect(wrapper.text()).toContain("松开 发送");
    expect(wrapper.text()).toContain("上滑取消");
    expect(wrapper.findAll(".voice-waveform__bar")).toHaveLength(24);
    expect(
      wrapper.find(".voice-hold-overlay__orb .el-icon-microphone").exists(),
    ).toBe(true);
    expect(wrapper.find(".voice-hold-overlay__listening").text()).toBe(
      "正在倾听…",
    );

    await wrapper.setProps({ cancel: true });
    expect(wrapper.text()).toContain("松开取消");
    expect(wrapper.text()).toContain("松开手指，取消本次录音");
    expect(wrapper.find(".voice-hold-overlay__wave--cancel").exists()).toBe(
      true,
    );
    wrapper.destroy();
  });
});

describe("VoiceStage hold mic", () => {
  it("prompts press-and-hold and reports the press to the host", async () => {
    const wrapper = mount(VoiceStage);
    expect(wrapper.find(".voice-pill__hint").text()).toBe(
      "按住说话，松开后发送",
    );

    wrapper
      .find(".mic-button")
      .element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("hold-start")).toHaveLength(1);
    expect(wrapper.emitted("hold-start")[0][0]).toBeInstanceOf(Event);
    wrapper.destroy();
  });
});

describe("app hold-to-talk flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    microphone.available = true;
    api.regions.mockResolvedValue({ items: buildRegionOptions(regions) });
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
  });

  it("shows the overlay while holding and sends after release", async () => {
    const wrapper = mountApp();

    await startHold(wrapper);

    expect(wrapper.vm.recording).toBe(true);
    expect(wrapper.vm.holdActive).toBe(true);
    expect(api.platform).not.toHaveBeenCalledWith(
      "/voice/active",
      expect.anything(),
    );
    expect(wrapper.find(".voice-hold-overlay").text()).toContain("松开 发送");

    wrapper.vm.holdStartedAt -= 5000;
    firePointer(".mic-button", "pointerup");
    await settle(wrapper);

    expect(wrapper.vm.holdActive).toBe(false);
    expect(wrapper.vm.recording).toBe(false);
    expect(wrapper.vm.recognizing).toBe(true);
    expect(wrapper.find(".voice-hold-overlay").exists()).toBe(false);
    wrapper.destroy();
  });

  it("starts a hold immediately after switching text input back to voice", async () => {
    const wrapper = mountApp();

    await wrapper.find(".voice-pill__manual").trigger("click");
    expect(wrapper.find(".voice-pill__input").exists()).toBe(true);
    await wrapper.find(".voice-pill__mode").trigger("click");
    expect(wrapper.find(".mic-button").exists()).toBe(true);

    await startHold(wrapper);

    expect(wrapper.vm.recording).toBe(true);
    expect(wrapper.vm.holdActive).toBe(true);
    wrapper.destroy();
  });

  it("shows the insecure-page microphone error on the home voice control", async () => {
    microphone.available = false;
    const wrapper = mountApp();

    firePointer(".mic-button", "pointerdown");
    await settle(wrapper);

    expect(wrapper.vm.voiceError).toContain("需 HTTPS");
    expect(wrapper.find(".voice-pill__error").text()).toContain("需 HTTPS");
    expect(wrapper.vm.recording).toBe(false);
    wrapper.destroy();
  });

  it("switches the overlay to cancel and discards the take when the finger slides up", async () => {
    const wrapper = mountApp();

    await startHold(wrapper);

    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 300 }));
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.holdCancelZone).toBe(true);
    expect(wrapper.find(".voice-hold-overlay").text()).toContain("松开取消");

    window.dispatchEvent(new MouseEvent("pointerup", { clientY: 300 }));
    await settle(wrapper);

    expect(wrapper.vm.holdActive).toBe(false);
    expect(wrapper.vm.recording).toBe(false);
    expect(wrapper.vm.recognizing).toBe(false);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(recorder.cleanup).toHaveBeenCalled();
    expect(wrapper.vm.conversationVisible).toBe(false);
    expect(wrapper.vm.aiNotice).toBe("已取消本次录音。");
    wrapper.destroy();
  });

  it("treats a very short press as a mis-tap and keeps the composer idle", async () => {
    const wrapper = mountApp();

    await startHold(wrapper);
    expect(wrapper.vm.recording).toBe(true);

    // 刚录上就松手：按住时长归零，直接判定误触。
    wrapper.vm.holdStartedAt = Date.now();
    firePointer(".mic-button", "pointerup");
    await settle(wrapper);

    expect(wrapper.vm.recording).toBe(false);
    expect(wrapper.vm.recognizing).toBe(false);
    expect(wrapper.vm.voiceError).toBe("说话时间太短，请按住麦克风说话。");
    wrapper.destroy();
  });
});
