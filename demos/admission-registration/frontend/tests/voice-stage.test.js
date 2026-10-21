import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import VoiceStage from "../src/components/VoiceStage.vue";
import ConversationDialog from "../src/components/ConversationDialog.vue";
import ConversationMessage from "../src/components/ConversationMessage.vue";

describe("VoiceStage", () => {
  it("starts the home countdown after activity and resets it on further activity", async () => {
    vi.useFakeTimers();
    const wrapper = mount(VoiceStage, { propsData: { showSelfMode: true } });
    try {
      expect(wrapper.emitted("countdown-change").at(-1)).toEqual([380]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(wrapper.emitted("countdown-change").at(-1)).toEqual([380]);
      await wrapper.setProps({ homeActivity: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(wrapper.emitted("countdown-change").at(-1)).toEqual([379]);
      await wrapper.setProps({ homeActivity: 2 });
      expect(wrapper.emitted("countdown-change").at(-1)).toEqual([380]);
      await vi.advanceTimersByTimeAsync(380000);
      expect(wrapper.emitted("countdown-change").at(-1)).toEqual([0]);
      expect(vi.getTimerCount()).toBe(0);

      await wrapper.setProps({ showSelfMode: false });
      await wrapper.setProps({ showSelfMode: true });
      expect(wrapper.emitted("countdown-change").at(-1)).toEqual([380]);
      wrapper.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (!wrapper.vm._isDestroyed) wrapper.destroy();
      vi.useRealTimers();
    }
  });

  it("distinguishes recording silence from detected speech with a level-driven waveform", async () => {
    const wrapper = mount(VoiceStage, {
      propsData: { recording: true, soundDetected: false, volumeLevel: 0 },
    });

    expect(wrapper.find(".voice-state").text()).toContain("等待您说话");
    expect(wrapper.find(".voice-waveform").attributes("aria-label")).toBe(
      "正在听，等待您说话",
    );
    const quietHeights = wrapper
      .findAll(".voice-waveform__bar")
      .wrappers.map((bar) => bar.attributes("style"));

    await wrapper.setProps({ soundDetected: true, volumeLevel: 0.65 });

    expect(wrapper.find(".voice-state").text()).toContain("检测到声音");
    expect(wrapper.find(".voice-waveform").attributes("aria-label")).toBe(
      "正在收音",
    );
    const activeHeights = wrapper
      .findAll(".voice-waveform__bar")
      .wrappers.map((bar) => bar.attributes("style"));
    expect(activeHeights).not.toEqual(quietHeights);
    expect(wrapper.findAll(".voice-waveform__bar")).toHaveLength(24);

    await wrapper.setProps({ soundDetected: false, silenceCountdown: 3 });
    expect(wrapper.find(".voice-state").text()).toContain("静音倒计时 3 秒");
    await wrapper.setProps({ soundDetected: true, silenceCountdown: null });
    expect(wrapper.find(".voice-state").text()).toContain(
      "停顿 3 秒后自动结束",
    );
  });

  it("shows no live waveform while idle or while recognizing", async () => {
    const wrapper = mount(VoiceStage);
    expect(wrapper.find(".voice-waveform").exists()).toBe(false);

    await wrapper.setProps({
      recording: true,
      recognizing: true,
      soundDetected: true,
    });

    expect(wrapper.find(".voice-state").text()).toContain("识别");
    expect(wrapper.find(".voice-waveform").exists()).toBe(false);
  });

  it("opens text input from the switch and blocks switching during recording or recognition", async () => {
    const wrapper = mount(VoiceStage, { propsData: { showSelfMode: true } });
    const entry = wrapper.find(".voice-pill__manual");

    expect(entry.isVisible()).toBe(true);
    await entry.trigger("click");
    expect(wrapper.emitted("manual-input")).toHaveLength(1);
    for (const props of [
      { recording: true },
      { recording: false, recognizing: true },
      { recognizing: false, disabled: true },
    ]) {
      await wrapper.setProps(props);
      await entry.trigger("click");
      expect(wrapper.emitted("manual-input")).toHaveLength(1);
    }
    wrapper.destroy();
  });

  it("replaces the microphone with text input and switches back to voice", async () => {
    const wrapper = mount(VoiceStage, {
      propsData: { textMode: true, voiceDraft: "已识别内容" },
    });
    expect(wrapper.find(".voice-pill__hold").exists()).toBe(false);
    expect(wrapper.find(".voice-pill__input").element.value).toBe("已识别内容");
    await wrapper.setProps({ voiceDraft: "请帮我办理住院" });
    expect(wrapper.find(".voice-pill__input").element.value).toBe(
      "请帮我办理住院",
    );
    await wrapper.find(".voice-pill--text").trigger("submit");
    expect(wrapper.emitted("send")).toEqual([["请帮我办理住院"]]);
    expect(wrapper.find(".voice-pill__input").element.value).toBe("");
    await wrapper.find(".voice-pill__mode").trigger("click");
    expect(wrapper.emitted("voice-input")).toHaveLength(1);
    await wrapper.setProps({ textMode: false });
    expect(wrapper.find(".voice-pill__hold").exists()).toBe(true);
    wrapper.destroy();
  });

  it("keeps the compact microphone and text switch when entering registration", async () => {
    const wrapper = mount(VoiceStage, { propsData: { showSelfMode: true } });

    await wrapper.setProps({ showSelfMode: false });

    expect(wrapper.find(".voice-pill__hold").exists()).toBe(true);
    expect(wrapper.find(".voice-pill__hint").text()).toBe(
      "按住说话，松开后发送",
    );
    expect(wrapper.find(".manual-entry-button").isVisible()).toBe(true);
    wrapper.destroy();
  });

  it("offers manual entry from the voice control and emits the request", async () => {
    const wrapper = mount(VoiceStage);

    await wrapper.find(".manual-entry-button").trigger("click");

    expect(wrapper.emitted("manual-input")).toHaveLength(1);
  });
});

describe("ConversationDialog recording feedback", () => {
  it.each([
    [{ modelName: "glm-test" }, "AI 解析"],
    [{ title: "内容确认" }, "内容确认"],
  ])(
    "adds the requested message heading without changing speech",
    async (metadata, title) => {
      const text = "请核对本轮信息。";
      const wrapper = mount(ConversationMessage, {
        propsData: { message: { role: "assistant", text, ...metadata } },
      });
      expect(wrapper.find(".conversation-message__header").text()).toBe(title);
      expect(wrapper.find(".conversation-message__header span").exists()).toBe(
        false,
      );
      expect(wrapper.find(".conversation-message__body").text()).toContain(
        text,
      );
      await wrapper.find(".conversation-message__speaker").trigger("click");
      expect(wrapper.emitted("speak")[0]).toEqual([text]);
      wrapper.destroy();
    },
  );

  it("separates recognition results and validation hints into labeled sections", () => {
    const wrapper = mount(ConversationMessage, {
      propsData: {
        message: {
          role: "assistant",
          text: "【已回填，请核对】\n• 联系电话：134****5555\n\n【校验提示】\n• 职业不在可选项中",
        },
        fieldKeywords: ["联系电话", "职业"],
      },
    });

    expect(
      wrapper
        .findAll(".conversation-message__section-title")
        .wrappers.map((title) => title.text()),
    ).toEqual(["【已回填，请核对】", "【校验提示】"]);
    expect(wrapper.findAll(".conversation-message__field-label")).toHaveLength(
      2,
    );
    wrapper.destroy();
  });

  it("renders a queried valid application as labeled fields awaiting patient confirmation", () => {
    const wrapper = mount(ConversationMessage, {
      propsData: {
        message: {
          role: "assistant",
          text: "完整播报内容",
          application: {
            id: "APP-DEMO-1",
            patientName: "演**者",
            department: "心内科",
            plannedAdmissionAt: "2026-10-22 09:00",
            doctor: "王医生",
            type: "普通住院",
            diagnosis: "冠心病待查",
            ward: "心内科一区",
            status: "有效",
          },
        },
      },
    });
    expect(wrapper.find(".application-message__header").text()).toContain(
      "本人入院申请单",
    );
    expect(wrapper.find(".application-message__status").text()).toBe("有效");
    expect(wrapper.findAll(".application-message dl > div")).toHaveLength(8);
    expect(wrapper.text()).toContain("待您确认后继续办理");
    expect(wrapper.text()).not.toContain("完整播报内容");
    wrapper.destroy();
  });

  it("keeps inline messages and speech controls without the old robot panel", async () => {
    const wrapper = mount(ConversationDialog, {
      propsData: {
        visible: true,
        inline: true,
        messages: [{ role: "assistant", text: "请核对申请单。" }],
      },
      stubs: ["el-input", "el-button"],
    });
    expect(wrapper.find(".conversation-assistant").exists()).toBe(false);
    expect(wrapper.find(".conversation-font-controls").exists()).toBe(false);
    expect(wrapper.find(".conversation-dialog__heading").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("手动填写");
    expect(wrapper.find(".conversation-message--assistant").text()).toBe(
      "请核对申请单。",
    );
    await wrapper.find(".conversation-autoplay").trigger("click");
    expect(wrapper.emitted("toggle-auto-speak")).toHaveLength(1);
    wrapper.destroy();
  });

  it("does not repeat a completed phone turn after the next question is appended", async () => {
    const phone = "13412348813";
    const reply = "已回填您提供的信息，请核对。";
    const messages = [
      { role: "patient", text: phone },
      { role: "assistant", text: reply },
      {
        role: "assistant",
        text: "本页还有选填内容未填写：籍贯地址、现住地址、详细地址。",
      },
    ];
    const wrapper = mount(ConversationDialog, {
      propsData: {
        visible: true,
        messages,
        transcript: phone,
        aiNotice: reply,
      },
      stubs: ["el-input", "el-button"],
    });

    expect(wrapper.findAll(".conversation-message--patient")).toHaveLength(1);
    expect(wrapper.findAll(".conversation-message--assistant")).toHaveLength(2);
    expect(wrapper.find(".conversation-dialog__status").exists()).toBe(false);

    await wrapper.setProps({
      transcript: "现住北京市朝阳区",
      aiNotice: "",
      thinking: true,
    });
    expect(wrapper.findAll(".conversation-message--patient")).toHaveLength(2);
    wrapper.destroy();
  });

  it("emphasizes the contact phone label in assistant messages", () => {
    const wrapper = mount(ConversationDialog, {
      propsData: {
        visible: true,
        messages: [
          {
            role: "assistant",
            text: "请告诉我您的联系电话，我会先核对号码格式。",
          },
        ],
        fieldKeywords: ["联系电话", "紧急联系人姓名"],
      },
      stubs: ["el-input", "el-button"],
    });

    const label = wrapper.find(".conversation-message__field-label");
    expect(label.text()).toBe("联系电话");
    expect(label.element.tagName).toBe("STRONG");
    wrapper.destroy();
  });

  it("shows real volume changes and a stop action without adding a dialog input row", async () => {
    const wrapper = mount(ConversationDialog, {
      propsData: { visible: true, recording: true },
      stubs: ["el-input", "el-button"],
    });
    expect(
      wrapper.find(".conversation-dialog__recording-feedback").text(),
    ).toContain("等待声音输入");
    expect(wrapper.find(".conversation-dialog__mobile-input").exists()).toBe(
      false,
    );
    const quietHeights = wrapper
      .findAll(".voice-waveform__bar")
      .wrappers.map((bar) => bar.attributes("style"));

    await wrapper.setProps({ soundDetected: true, volumeLevel: 0.7 });
    expect(wrapper.find(".voice-waveform").attributes("aria-label")).toBe(
      "正在收音",
    );
    expect(
      wrapper.find(".conversation-dialog__recording-feedback").text(),
    ).toContain("已检测到声音");
    expect(
      wrapper
        .findAll(".voice-waveform__bar")
        .wrappers.map((bar) => bar.attributes("style")),
    ).not.toEqual(quietHeights);
    await wrapper.setProps({ soundDetected: false, silenceCountdown: 2 });
    expect(
      wrapper.find(".conversation-dialog__recording-feedback").text(),
    ).toContain("静音倒计时 2 秒");
    await wrapper.find(".conversation-dialog__stop-recording").trigger("click");
    expect(wrapper.emitted("toggle-record")).toHaveLength(1);

    await wrapper.setProps({ recognizing: true });
    expect(wrapper.find(".voice-waveform").exists()).toBe(false);
    expect(wrapper.find(".conversation-dialog__stop-recording").exists()).toBe(
      false,
    );
    expect(
      wrapper.find(".conversation-dialog__recording-feedback").text(),
    ).toContain("录音已结束，正在识别");
    await wrapper.setProps({ recording: false, recognizing: false });
    expect(
      wrapper.find(".conversation-dialog__recording-feedback").exists(),
    ).toBe(false);
    expect(wrapper.find(".conversation-dialog__mobile-input").exists()).toBe(
      false,
    );
    wrapper.destroy();
  });
});
