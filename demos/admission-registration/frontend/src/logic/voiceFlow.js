import { extractCandidates } from "../api/admission.js";
import {
  classifyAdmissionCandidateConfirmation,
  classifyAdmissionIntent,
  platformJson,
  platformTts,
  platformUpload,
} from "../api/platform.js";
import { abortAfter } from "../utils/async.js";
import { createIdleGuard } from "../utils/idleGuard.js";
import { audioToWav } from "../utils/audioToWav.js";
import {
  VoiceRecorder,
  canUseMicrophone,
  MIC_UNSUPPORTED_MESSAGE,
} from "../utils/voiceRecorder.js";
import { FIELD_REASK, enumFieldOptions } from "../model/formConfig.js";
import {
  findRegionMismatch,
  validateFields,
} from "../model/validationLoader.js";
import { makeUuid } from "../utils/uuid.js";

const IDLE_TIMEOUT_MS = 300000;
const IDLE_GRACE_MS = 30000;
const RECORD_LIMIT_MS = 60000;
// 按住说话：短于该时长的按住视为误触，不进入识别。
const MIN_HOLD_MS = 600;
// 手指上滑超过该距离后松手，取消本次录音。
const CANCEL_SLIDE_PX = 80;
const TOO_SHORT_MESSAGE = "说话时间太短，请按住麦克风说话。";

function modelErrorMessage(error) {
  if (error.status === 401) {
    const detail = error.body?.detail;
    if (typeof detail === "string" && detail.includes("身份核验"))
      return "身份核验已失效，请重新核验；转写已保留。";
    return "平台登录已失效，请重新登录；转写已保留。";
  }
  if (error.body?.detail?.code === "ADMISSION_TURN_LIMIT")
    return "本次登记已达到20轮对话上限，您仍可直接修改表单并核对信息。";
  if (error.status === 429)
    return "AI 服务请求过于频繁，请稍后重试；转写内容已保留。";
  if (error.body?.detail?.code === "AI_CONTEXT_TOO_LONG")
    return "本轮内容过长，请缩短描述后重试；转写已保留。";
  if (error.name === "AbortError" || error.status === 503)
    return "模型请求超时或服务连接失败，转写已保留；请稍后重试或手动补充。";
  return "本轮信息解析失败，转写已保留；请检查网络后重试或手动补充。";
}

function explicitlyLabeledValue(text, key, value) {
  const labels =
    {
      phone: ["联系电话", "手机号", "电话"],
      addressDetail: ["详细地址", "家庭住址", "门牌号"],
      nativeRegion: ["籍贯", "出生地"],
      residentRegion: ["现住地址", "现住址", "居住地", "现住地区"],
      employerName: ["工作单位名称", "工作单位", "单位名称"],
      employerAddress: ["工作单位地址", "单位地址"],
      marriage: ["婚姻状况"],
      occupation: ["职业"],
      emergencyContact: ["紧急联系人", "联系人姓名"],
      relationship: ["与患者关系", "关系"],
    }[key] || [];
  return labels.some((label) => {
    const labelIndex = text.indexOf(label);
    const valueIndex = text.indexOf(value, labelIndex + label.length);
    return labelIndex >= 0 && valueIndex >= labelIndex + label.length;
  });
}

// 语音录入 → 平台 STT → AI 候选回填 → 平台 TTS 播报，以及自助终端空闲清理。
// 通过 mixin 合入 App：候选与转写仍保存在宿主 data 上，供页面与测试直接访问。
export default {
  data() {
    return {
      voiceError: "",
      aiNotice: "",
      aiThinking: false,
      transcript: "",
      voiceDraft: "",
      recording: false,
      volumeLevel: 0,
      soundDetected: false,
      silenceCountdown: null,
      startingVoice: false,
      recognizing: false,
      holdActive: false,
      holdCancelZone: false,
      generation: 0,
      idleVisible: false,
      idleRemaining: 30,
      sessionRemaining: IDLE_TIMEOUT_MS / 1000,
      candidateRequestVersion: 0,
      candidateConfirmationRequestVersion: 0,
      recordingConfirmationContext: null,
    };
  },
  created() {
    // 手势过程中的临时值无需响应式。
    this.holdStartY = null;
    this.holdAbort = false;
    this.holdStartedAt = 0;
    this.idleGuard = createIdleGuard({
      timeoutMs: IDLE_TIMEOUT_MS,
      graceMs: IDLE_GRACE_MS,
      shouldRun: () => this.page !== "home" && !this.submitting,
      onCountdown: (remaining) => {
        this.sessionRemaining = remaining;
      },
      onTick: (remaining) => {
        this.idleVisible = true;
        this.idleRemaining = remaining;
      },
      onExpire: () => this.reset(),
    });
  },
  mounted() {
    this.idleGuard.start();
  },
  beforeDestroy() {
    this.idleGuard.stop();
    this.generation += 1;
    this.abortRequests();
    this.stopVoiceSession();
    this.stopAssistantSpeech();
  },
  methods: {
    touch() {
      this.idleGuard.touch();
    },
    continueSession() {
      this.idleGuard.resume();
      this.idleVisible = false;
      this.idleRemaining = 30;
    },
    abortRequests() {
      this.candidateRequestVersion += 1;
      this.startingVoice = false;
      this.activeProbe?.abort();
      this.aiRequest?.abort();
      this.ttsRequest?.abort();
      this.identityRequest?.abort();
      this.applicationRequest?.abort();
      this.resultRequest?.abort();
      this.activeProbe = this.aiRequest = this.ttsRequest = null;
    },
    stopVoiceSession() {
      this.detachHoldListeners();
      this.holdActive = false;
      this.holdCancelZone = false;
      this.holdStartY = null;
      this.voiceRecorder?.cleanup();
      this.voiceRecorder = null;
      this.recording = false;
      this.recognizing = false;
      this.volumeLevel = 0;
      this.soundDetected = false;
      this.silenceCountdown = null;
    },
    // —— 按住说话（微信式手势）——
    // 入口按钮只上报按下；移动/松开统一挂 window，这样即便按钮在按住期间
    // 被隐藏（如弹窗打开、输入行切换），也不会丢失结束事件。
    beginVoiceHold(event) {
      if (
        this.submitting ||
        this.processingConversation ||
        this.aiThinking ||
        this.startingVoice ||
        this.recording ||
        this.recognizing
      )
        return;
      // 不安全上下文（局域网 IP / 非 HTTPS）下浏览器不给麦克风，提前讲清楚。
      if (!canUseMicrophone()) {
        this.voiceError = MIC_UNSUPPORTED_MESSAGE;
        this.touch();
        return;
      }
      this.holdStartY =
        typeof event?.clientY === "number" ? event.clientY : null;
      this.holdActive = true;
      this.holdCancelZone = false;
      this.holdAbort = false;
      this.holdStartedAt = 0;
      this.attachHoldListeners();
      // 先在 pointerdown 的用户手势里请求麦克风；网络预检会让浏览器丢失授权激活。
      this.startRecording(true);
    },
    attachHoldListeners() {
      window.addEventListener("pointermove", this.onHoldPointerMove);
      window.addEventListener("pointerup", this.onHoldPointerUp);
      window.addEventListener("pointercancel", this.onHoldPointerUp);
    },
    detachHoldListeners() {
      window.removeEventListener("pointermove", this.onHoldPointerMove);
      window.removeEventListener("pointerup", this.onHoldPointerUp);
      window.removeEventListener("pointercancel", this.onHoldPointerUp);
    },
    onHoldPointerMove(event) {
      if (
        !this.holdActive ||
        this.holdStartY === null ||
        typeof event.clientY !== "number"
      )
        return;
      this.holdCancelZone = this.holdStartY - event.clientY >= CANCEL_SLIDE_PX;
    },
    onHoldPointerUp() {
      this.endVoiceHold();
    },
    endVoiceHold() {
      if (!this.holdActive) return;
      const cancel = this.holdCancelZone;
      this.detachHoldListeners();
      this.holdActive = false;
      this.holdCancelZone = false;
      this.holdStartY = null;
      if (this.startingVoice) {
        // 录音还没真正开始（探测/授权中）：直接丢弃，避免松手后出现无主录音。
        this.holdAbort = true;
        if (!cancel) this.voiceError = TOO_SHORT_MESSAGE;
        this.touch();
        return;
      }
      if (!this.recording) return;
      if (cancel) {
        this.stopVoiceSession();
        this.aiNotice = "已取消本次录音。";
        this.touch();
        return;
      }
      if (Date.now() - this.holdStartedAt < MIN_HOLD_MS) {
        this.stopVoiceSession();
        this.voiceError = TOO_SHORT_MESSAGE;
        this.touch();
        return;
      }
      // 结果与回复仍展示在对话弹窗里：松手时再打开，保证按住期间入口按钮不移位。
      if (!this.conversationVisible) this.openConversation("voice");
      this.stopRecording();
    },
    async startRecording(fromHold = false) {
      if (
        this.submitting ||
        this.processingConversation ||
        this.aiThinking ||
        this.startingVoice ||
        this.recording ||
        this.recognizing
      )
        return;
      // 不安全上下文（局域网 IP / 非 HTTPS）下浏览器不给麦克风，提前讲清楚，
      // 也不必再打一次 /voice/active。
      if (!canUseMicrophone()) {
        this.voiceError = MIC_UNSUPPORTED_MESSAGE;
        this.touch();
        return;
      }
      // 按住说话时弹窗延迟到松手再打开，避免入口按钮在按住期间移位或隐藏。
      if (this.page === "form" && !this.holdActive)
        this.conversationVisible = true;
      this.startingVoice = true;
      this.voiceError = "";
      this.aiNotice = "";
      const startedGeneration = this.generation;
      const confirmationContext = this.candidateConfirmation
        ? { ...this.candidateConfirmation }
        : null;
      try {
        if (!fromHold) {
          this.activeProbe = abortAfter(60000);
          await platformJson("/voice/active", {
            signal: this.activeProbe.signal,
          });
        }
        const recorder = new VoiceRecorder({
          maxDuration: RECORD_LIMIT_MS,
          onLevel: ({ level, soundDetected, silenceCountdown }) => {
            if (startedGeneration !== this.generation) return;
            this.volumeLevel = level;
            this.soundDetected = soundDetected;
            this.silenceCountdown = silenceCountdown;
          },
          // 说完静音后录音器自动收尾，这里先把界面切到"正在识别"，避免继续显示录音中。
          // 若处于按住状态（手指未松开），同步收起按住遮罩并打开对话弹窗展示结果。
          onSilenceStop: () => {
            if (startedGeneration !== this.generation) return;
            const wasHeld = this.holdActive;
            this.detachHoldListeners();
            this.holdActive = false;
            this.holdCancelZone = false;
            this.recording = false;
            this.recognizing = true;
            this.volumeLevel = 0;
            this.soundDetected = false;
            this.silenceCountdown = null;
            if (wasHeld && !this.conversationVisible)
              this.openConversation("voice");
          },
          onComplete: (blob, limitHit) =>
            this.handleRecordingComplete(blob, limitHit, startedGeneration),
          onError: (error) => {
            this.recording = false;
            this.recognizing = false;
            if (startedGeneration === this.generation)
              this.voiceError =
                error.message || "无法使用麦克风，请检查设备权限。";
            this.touch();
          },
        });
        await recorder.start();
        if (
          startedGeneration !== this.generation ||
          this.holdAbort ||
          (confirmationContext &&
            !this.candidateConfirmationMatches(confirmationContext)) ||
          (!confirmationContext && this.candidateDialogKey)
        ) {
          recorder.cleanup();
          this.holdAbort = false;
          return;
        }
        this.voiceRecorder = recorder;
        this.recordingPage = this.page;
        this.recordingConfirmationContext = confirmationContext;
        this.stopAssistantSpeech();
        this.recording = true;
        this.recognizing = false;
        this.volumeLevel = 0;
        this.soundDetected = false;
        this.silenceCountdown = null;
        this.holdStartedAt = Date.now();
        this.touch();
      } catch (error) {
        if (startedGeneration === this.generation)
          this.voiceError = error.message || "无法使用麦克风，请检查设备权限。";
        this.stopVoiceSession();
      } finally {
        if (startedGeneration === this.generation) this.startingVoice = false;
      }
    },
    stopRecording() {
      if (!this.recording) return;
      this.recording = false;
      this.recognizing = true;
      this.silenceCountdown = null;
      this.voiceRecorder?.stop();
    },
    async handleRecordingComplete(blob, limitHit, capturedGeneration) {
      const capturePage = this.recordingPage;
      const confirmationContext = this.recordingConfirmationContext;
      this.recordingConfirmationContext = null;
      this.recognizing = true;
      try {
        if (limitHit) this.voiceError = "单次录音已达到60秒上限。";
        if (!blob.size) throw new Error("没有录到语音，请重试。");
        const wav = await audioToWav(blob);
        if (capturedGeneration !== this.generation) return;
        const form = new FormData();
        form.append("audio", wav, "admission-audio.wav");
        form.append("language", "zh-CN");
        const request = abortAfter(30000);
        let response;
        try {
          response = await platformUpload("/voice/stt", form, request.signal);
        } finally {
          request.done();
        }
        const text =
          typeof response.text === "string" ? response.text.trim() : "";
        if (!text)
          throw new Error("没有识别到语音内容，请说得清楚一些后重试。");
        if (capturedGeneration !== this.generation) return;
        this.transcript = text;
        this.recording = false;
        this.recognizing = false;
        if (
          capturePage === this.page &&
          capturedGeneration === this.generation
        ) {
          if (capturePage === "review") {
            this.voiceDraft = text;
            this.openConversation("text");
          } else if (
            this.inferredDetailCandidate &&
            ["下一页", "继续下一页", "进入核对页"].includes(
              text.replace(/[\s，。！？,.!?]/g, ""),
            )
          ) {
            await this.submitConversationInput(text);
          } else if (confirmationContext) {
            if (this.candidateConfirmationMatches(confirmationContext))
              await this.classifyCandidateConfirmation(
                text,
                capturedGeneration,
                confirmationContext,
              );
          } else if (this.candidateDialogKey) {
            this.aiNotice = "请在确认弹窗中选择，或使用弹窗内麦克风确认。";
          } else await this.submitConversationInput(text);
        }
      } catch (error) {
        if (capturedGeneration === this.generation)
          this.voiceError = error.message || "语音识别失败，请手动填写。";
      } finally {
        if (capturedGeneration === this.generation) {
          this.recording = false;
          this.recognizing = false;
          this.volumeLevel = 0;
          this.soundDetected = false;
          if (limitHit && !this.voiceError)
            this.voiceError = "单次录音已达到60秒上限。";
          this.touch();
        }
      }
    },
    async classifyHomeIntent(text, generation) {
      this.aiRequest?.abort();
      const requestVersion = ++this.candidateRequestVersion;
      // 平台侧意图等待为 30s（推理模型经 Agent+Skill 常超 15s），前端放宽到 32s。
      this.aiRequest = abortAfter(32000);
      this.aiThinking = true;
      this.aiNotice = "";
      this.appendConversationMessages(this.homeConversationMessages, {
        role: "patient",
        text,
      });
      try {
        const response = await classifyAdmissionIntent(
          text,
          this.aiRequest.signal,
        );
        if (
          requestVersion !== this.candidateRequestVersion ||
          generation !== this.generation ||
          this.page !== "home"
        )
          return;
        this.handleHomeIntent(response.intent);
        const reply = this.aiNotice || response.reply;
        if (this.page === "home") this.aiNotice = reply;
        this.appendConversationMessages(this.homeConversationMessages, {
          role: "assistant",
          text: reply,
        });
        this.speakAssistantReply(reply);
      } catch (error) {
        if (
          generation === this.generation &&
          requestVersion === this.candidateRequestVersion &&
          this.page === "home"
        ) {
          this.aiNotice = modelErrorMessage(error);
          this.appendConversationMessages(this.homeConversationMessages, {
            role: "assistant",
            text: this.aiNotice,
          });
        }
      } finally {
        if (this.candidateRequestVersion === requestVersion) {
          this.aiThinking = false;
          this.aiRequest?.done();
          this.aiRequest = null;
        }
      }
    },
    async applyAi(
      text,
      generation,
      allowedKeys = null,
      fallbackKeys = allowedKeys,
    ) {
      const turnId = `turn-${makeUuid()}`;
      const initialInformationRequest = this.initialPatientInfoRequest;
      this.aiRequest?.abort();
      const requestVersion = ++this.candidateRequestVersion;
      this.aiRequest = abortAfter(35000);
      this.aiThinking = true;
      this.aiNotice = "";
      this.fallbackChoiceKey = "";
      this.aiClarification = "";
      this.aiClarificationChoices = [];
      try {
        if (!(await this.flushManualChanges())) return;
        if (generation !== this.generation || this.page !== "form") return;
        const regionMismatch = await findRegionMismatch(text);
        if (regionMismatch) {
          const { parent, child, actualParent } = regionMismatch;
          this.aiNotice = `您提供的地址中，${parent.label}与${child.label}不匹配：${child.label}属于${actualParent.label}。请确认正确地址后再修改；我没有修改表单。`;
          await this.persistConversation?.({
            turnId,
            utterance: text,
            response: this.aiNotice,
            action: "voice_turn",
          });
          return;
        }
        const telephoneReply =
          this.nextConversationField?.key === "phone" &&
          text.match(/^\s*(1[3-9]\d{9})[。.,，]?\s*$/);
        const optionalField = this.emptyOptionalFields.find(
          (field) => field.key === this.optionalFollowUpKey,
        );
        const pendingField = initialInformationRequest
          ? null
          : this.nextConversationField;
        const directDetailAnswer =
          this.optionalFollowUpKey === "addressDetail" ||
          (this.emptyOptionalFields.length === 1 &&
            this.emptyOptionalFields[0].key === "addressDetail");
        const hasFieldLabel = this.conversationFields.some((field) =>
          text.includes(field.label),
        );
        const extractionText = telephoneReply
          ? `联系电话${telephoneReply[1]}`
          : pendingField && !hasFieldLabel
          ? `${pendingField.label}${text}`
          : optionalField && !hasFieldLabel
          ? `${optionalField.label}${text}`
          : text;
        const response = await extractCandidates(
          extractionText,
          initialInformationRequest || this.conversationVisible ? 0 : this.step,
          this.identityToken,
          this.sessionId,
          turnId,
          this.aiRequest.signal,
        );
        if (requestVersion !== this.candidateRequestVersion) return;
        const {
          fields: extracted = {},
          errors: candidateErrors = {},
          modelName,
          clarification,
          clarificationChoices = [],
        } = response;
        const candidates = extracted;
        if (generation !== this.generation || this.page !== "form") return;
        const validationErrors = { ...candidateErrors };
        const phoneAnswer = text
          .replace(
            /^(?:联系电话|手机号|手机号码|电话号码|电话)\s*[:：是为]?\s*/,
            "",
          )
          .trim();
        if (
          pendingField?.key === "phone" &&
          !candidates.phone &&
          /^[\d\s-]+$/.test(phoneAnswer) &&
          !/^1[3-9]\d{9}$/.test(phoneAnswer.replace(/[\s-]/g, ""))
        )
          validationErrors.phone = "请输入有效的11位手机号码";
        if (
          pendingField &&
          enumFieldOptions(pendingField.key).length &&
          !candidates[pendingField.key]
        ) {
          const options = enumFieldOptions(pendingField.key);
          const aliases =
            pendingField.key === "relationship" ? ["女儿", "儿子"] : [];
          const labelPattern = new RegExp(
            "^(?:" +
              this.fieldLabel(pendingField.key) +
              "|与患者关系|关系)\\s*[:：是为]?\\s*",
          );
          const answer = text.replace(labelPattern, "").trim();
          if (
            answer &&
            answer.length <= 30 &&
            !/[或还是不确定可能也许]/.test(answer) &&
            !options.includes(answer) &&
            !aliases.includes(answer)
          )
            validationErrors[pendingField.key] = "请选择提供的选项";
        }
        let applied = 0;
        let conflicts = 0;
        let inferredDetail = false;
        const recognizedKeys = new Set();
        const persistedFields = {};
        const mapping = {
          phone: "phone",
          addressDetail: "addressDetail",
          nativeRegion: "nativeRegion",
          residentRegion: "residentRegion",
          employerName: "employerName",
          employerAddress: "employerAddress",
          marriage: "marriage",
          occupation: "occupation",
          emergencyContact: "emergencyContact",
          relationship: "relationship",
        };
        for (const [key, value] of Object.entries(candidates)) {
          if (allowedKeys && !allowedKeys.includes(key)) continue;
          const filled = Array.isArray(value)
            ? value.length > 0 &&
              value.every((item) => typeof item === "string" && item)
            : typeof value === "string" && !!value.trim();
          if (!mapping[key] || !filled) continue;
          if (
            !initialInformationRequest &&
            pendingField &&
            key !== pendingField.key &&
            !explicitlyLabeledValue(text, key, value)
          )
            continue;
          if (validateFields({ ...this.fields, [key]: value }, [key])[key])
            continue;
          recognizedKeys.add(key);
          const changed =
            JSON.stringify(this.fields[key]) !== JSON.stringify(value);
          if (
            key === "addressDetail" &&
            !this.fields.addressDetail &&
            !directDetailAnswer &&
            !candidates.residentRegion &&
            !explicitlyLabeledValue(text, key, value)
          ) {
            this.$set(this.pendingCandidates, key, value);
            inferredDetail = true;
            continue;
          }
          if (this.sources[key] === "manual") {
            if (changed) {
              this.$set(this.pendingCandidates, key, value);
              conflicts += 1;
            }
            continue;
          }
          this.$delete(this.pendingCandidates, key);
          if (changed) {
            this.fields[key] = value;
            this.sources[key] = "ai";
            persistedFields[key] = value;
            applied += 1;
          }
        }
        if (applied) {
          this.optionalSkippedStep = 0;
          if (
            this.optionalFollowUpKey &&
            this.fields[this.optionalFollowUpKey]?.length
          )
            this.optionalFollowUpKey = "";
        }
        const reask =
          !applied && !conflicts && pendingField
            ? FIELD_REASK[pendingField.key]
            : "";
        // 指名修改字典字段却抽不出候选时，不再要求重说，直接在对话里给标准选项让患者点选。
        const fallbackKey =
          !conflicts && !inferredDetail
            ? Object.keys(validationErrors).find(
                (key) => enumFieldOptions(key).length,
              ) ||
              (fallbackKeys
                ? fallbackKeys.find(
                    (key) =>
                      enumFieldOptions(key).length && !recognizedKeys.has(key),
                  )
                : "")
            : "";
        this.fallbackChoiceKey = fallbackKey;
        const appliedSummary = Object.keys(persistedFields)
          .map(
            (key) => `• ${this.fieldLabel(key)}：${this.reviewValueLabel(key)}`,
          )
          .join("\n");
        const errorSummary = Object.entries(validationErrors)
          .map(([key, error]) => {
            const label = this.fieldLabel(key);
            const options = enumFieldOptions(key);
            if (options.length && error.includes("多个选项"))
              return `${label}包含相互冲突的多个值，请从${options.join(
                "、",
              )}中确认一项。`;
            if (options.length)
              return `${label}不在可选项中，请从${options.join("、")}中选择。`;
            if (key === "phone" && error.includes("一个"))
              return `${label}识别到多个号码，请一次只提供一个11位手机号。`;
            if (key === "phone")
              return `${label}格式不正确，应为11位有效手机号码，请重新输入。`;
            return `${label}不符合要求：${error}。`;
          })
          .map((notice) => `• ${notice}`)
          .join("\n");
        const notices = [];
        if (applied) notices.push(`【已回填，请核对】\n${appliedSummary}`);
        if (typeof clarification === "string" && clarification.trim())
          notices.push(`【需要补充】\n${clarification.trim()}`);
        if (inferredDetail)
          notices.push(
            "【待确认】\n• 我还识别到详细地址，请确认是否采用；未确认前不会计为已填写。",
          );
        if (conflicts)
          notices.push(
            "【需要您决定】\n• 识别内容与现有信息不同，请选择是否修改。",
          );
        if (errorSummary) notices.push(`【校验提示】\n${errorSummary}`);
        else if (fallbackKey)
          notices.push(
            `【请选择】\n• 我没能确认您的${this.fieldLabel(
              fallbackKey,
            )}，请从下方选项中选择。`,
          );
        const unclearNotice = pendingField
          ? `我没听清您填写的${this.fieldLabel(
              pendingField.key,
            )}，请重新说一下，或直接在表单中修改。`
          : "我没能从这句话里识别出要填写的信息，请说出信息名称和内容，或直接编辑表单。";
        this.aiNotice = notices.length
          ? notices.join("\n\n")
          : reask || unclearNotice;
        this.aiClarification =
          typeof clarification === "string" ? clarification.trim() : "";
        this.aiClarificationChoices =
          typeof clarification === "string" && clarification.trim()
            ? clarificationChoices.filter(
                (choice) => typeof choice === "string" && choice.trim(),
              )
            : [];
        if ((conflicts || inferredDetail) && !this.candidateDialogKey)
          this.candidateDialogKey =
            Object.keys(this.pendingCandidates)[0] || "";
        const saved = await this.persistConversation?.({
          turnId,
          utterance: text,
          response: this.aiNotice,
          action: "voice_turn",
          modelName,
          fields: persistedFields,
          pendingProposal: Object.keys(this.pendingCandidates).length
            ? Object.fromEntries(
                Object.entries(this.pendingCandidates).map(([key, value]) => [
                  key,
                  { currentValue: this.fields[key], proposedValue: value },
                ]),
              )
            : null,
        });
        if (
          applied &&
          saved === false &&
          generation === this.generation &&
          requestVersion === this.candidateRequestVersion
        )
          this.aiNotice =
            "候选信息已回填，但本轮对话未能保存；转写已保留，请稍后重试。";
      } catch (error) {
        if (
          generation === this.generation &&
          requestVersion === this.candidateRequestVersion
        ) {
          this.aiNotice = modelErrorMessage(error);
          await this.persistConversation?.({
            turnId,
            utterance: text,
            response: this.aiNotice,
            action: "voice_turn",
          });
        }
      } finally {
        if (this.candidateRequestVersion === requestVersion) {
          this.aiThinking = false;
          this.aiRequest?.done();
          this.aiRequest = null;
        }
      }
    },
    applyPendingCandidate(key) {
      const candidate = this.pendingCandidates[key];
      const error = validateFields({ ...this.fields, [key]: candidate }, [key])[
        key
      ];
      if (error) {
        this.$message.warning(error);
        return;
      }
      this.$set(this.fields, key, candidate);
      this.$set(this.sources, key, "manual");
      this.$delete(this.pendingCandidates, key);
      this.touch();
    },
    async classifyCandidateConfirmation(text, generation, context) {
      this.aiRequest?.abort();
      const requestVersion = ++this.candidateConfirmationRequestVersion;
      const request = abortAfter(32000);
      this.aiRequest = request;
      this.aiThinking = true;
      this.aiNotice = "";
      try {
        const response = await classifyAdmissionCandidateConfirmation(
          text,
          context.key,
          context.currentValue,
          context.candidateValue,
          request.signal,
        );
        if (
          generation !== this.generation ||
          requestVersion !== this.candidateConfirmationRequestVersion ||
          this.page !== "form" ||
          !this.candidateConfirmationMatches(context)
        )
          return;
        if (response.decision === "accept_candidate")
          this.resolveCandidate(true);
        else if (response.decision === "keep_current")
          this.resolveCandidate(false);
        else this.aiNotice = "没能判断您的选择，请点击选项或重新说出决定。";
      } catch (error) {
        if (
          generation === this.generation &&
          requestVersion === this.candidateConfirmationRequestVersion &&
          this.candidateConfirmationMatches(context)
        )
          this.aiNotice =
            error.status === 429
              ? "AI 请求触发限流，请稍后重试或点击选项。"
              : "语音确认暂不可用，请点击选项或重试语音。";
      } finally {
        if (this.aiRequest === request) {
          this.aiThinking = false;
          this.aiRequest = null;
        }
        request.done();
      }
    },
    async speak(text) {
      const generation = this.generation;
      this.ttsRequest?.abort();
      const request = abortAfter(15000);
      this.ttsRequest = request;
      try {
        this.releaseAudio();
        const url = await platformTts(text, request.signal);
        if (
          generation !== this.generation ||
          request.signal.aborted ||
          this.ttsRequest !== request
        ) {
          URL.revokeObjectURL(url);
          return false;
        }
        const player = this.$refs.audioPlayer;
        player.src = url;
        this.audioUrl = url;
        await player.play();
        return true;
      } catch (error) {
        // 不用全局 toast：会盖住顶部品牌与日期时间，改为在语音区内联提示。
        if (generation === this.generation && !request.signal.aborted) {
          this.voiceError = error.message || "语音播报暂不可用。";
        }
        return false;
      } finally {
        request.done();
        if (this.ttsRequest === request) this.ttsRequest = null;
      }
    },
    releaseAudio() {
      const player = this.$refs.audioPlayer;
      if (player) {
        player.pause();
        player.removeAttribute("src");
        player.load();
      }
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = "";
    },
  },
};
