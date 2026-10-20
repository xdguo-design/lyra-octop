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
import { VoiceRecorder } from "../utils/voiceRecorder.js";
import { FIELD_REASK, enumFieldOptions } from "../model/formConfig.js";
import { validateFields } from "../model/validation.js";

const IDLE_TIMEOUT_MS = 300000;
const IDLE_GRACE_MS = 30000;
const RECORD_LIMIT_MS = 60000;

function modelErrorMessage(error) {
  if (error.status === 401)
    return "登录或身份核验已失效，请重新登录并核验；转写已保留。";
  if (error.status === 429)
    return "AI 服务请求过于频繁，请稍后重试；转写内容已保留。";
  if (error.body?.detail?.code === "AI_CONTEXT_TOO_LONG")
    return "本轮内容过长，请缩短描述后重试；转写已保留。";
  if (error.name === "AbortError" || error.status === 503)
    return "模型请求超时或服务连接失败，转写已保留；请稍后重试或手动补充。";
  return "本轮信息解析失败，转写已保留；请检查网络后重试或手动补充。";
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
      recording: false,
      volumeLevel: 0,
      soundDetected: false,
      startingVoice: false,
      recognizing: false,
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
    this.releaseAudio();
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
      this.voiceRecorder?.cleanup();
      this.voiceRecorder = null;
      this.recording = false;
      this.recognizing = false;
      this.volumeLevel = 0;
      this.soundDetected = false;
    },
    async startRecording() {
      if (
        this.submitting ||
        this.processingConversation ||
        this.aiThinking ||
        this.startingVoice ||
        this.recording ||
        this.recognizing
      )
        return;
      if (this.page === "form") this.conversationVisible = true;
      this.startingVoice = true;
      this.voiceError = "";
      this.aiNotice = "";
      const startedGeneration = this.generation;
      const confirmationContext = this.candidateConfirmation
        ? { ...this.candidateConfirmation }
        : null;
      try {
        this.activeProbe = abortAfter(60000);
        await platformJson("/voice/active", {
          signal: this.activeProbe.signal,
        });
        const recorder = new VoiceRecorder({
          maxDuration: RECORD_LIMIT_MS,
          onLevel: ({ level, soundDetected }) => {
            if (startedGeneration !== this.generation) return;
            this.volumeLevel = level;
            this.soundDetected = soundDetected;
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
          (confirmationContext &&
            !this.candidateConfirmationMatches(confirmationContext)) ||
          (!confirmationContext && this.candidateDialogKey)
        ) {
          recorder.cleanup();
          return;
        }
        this.voiceRecorder = recorder;
        this.recordingPage = this.page;
        this.recordingConfirmationContext = confirmationContext;
        this.ttsRequest?.abort();
        this.ttsRequest = null;
        this.releaseAudio();
        this.recording = true;
        this.recognizing = false;
        this.volumeLevel = 0;
        this.soundDetected = false;
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
        this.recognizing = false;
        if (
          capturePage === this.page &&
          capturedGeneration === this.generation
        ) {
          if (confirmationContext) {
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
      this.homeConversationMessages.push({ role: "patient", text });
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
        this.homeConversationMessages.push({
          role: "assistant",
          text: reply,
        });
      } catch (error) {
        if (
          generation === this.generation &&
          requestVersion === this.candidateRequestVersion &&
          this.page === "home"
        ) {
          this.aiNotice = modelErrorMessage(error);
          this.homeConversationMessages.push({
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
      this.aiRequest?.abort();
      const requestVersion = ++this.candidateRequestVersion;
      this.aiRequest = abortAfter(35000);
      this.aiThinking = true;
      this.aiNotice = "";
      this.fallbackChoiceKey = "";
      try {
        if (!(await this.flushManualChanges())) return;
        if (generation !== this.generation || this.page !== "form") return;
        const response = await extractCandidates(
          text,
          this.step,
          this.identityToken,
          this.sessionId,
          this.aiRequest.signal,
        );
        if (requestVersion !== this.candidateRequestVersion) return;
        const { fields: candidates = {} } = response;
        if (generation !== this.generation || this.page !== "form") return;
        let applied = 0;
        let conflicts = 0;
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
          if (validateFields({ ...this.fields, [key]: value }, [key])[key])
            continue;
          recognizedKeys.add(key);
          const changed =
            JSON.stringify(this.fields[key]) !== JSON.stringify(value);
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
        const pendingField = this.nextConversationField;
        const reask =
          !applied && !conflicts && pendingField
            ? FIELD_REASK[pendingField.key]
            : "";
        // 指名修改字典字段却抽不出候选时，不再要求重说，直接在对话里给标准选项让患者点选。
        const fallbackKey =
          !conflicts && fallbackKeys
            ? fallbackKeys.find(
                (key) =>
                  enumFieldOptions(key).length && !recognizedKeys.has(key),
              ) || ""
            : "";
        this.fallbackChoiceKey = fallbackKey;
        this.aiNotice = conflicts
          ? "识别内容与现有信息不同，请选择是否修改。"
          : fallbackKey
          ? `没能自动识别您说的内容，请直接在下方选择${this.fieldLabel(
              fallbackKey,
            )}。`
          : applied
          ? "已回填您提供的信息，请核对。"
          : reask || "未发现可安全回填的字段；您可以直接编辑表单。";
        if (conflicts && !this.candidateDialogKey)
          this.candidateDialogKey =
            Object.keys(this.pendingCandidates)[0] || "";
        await this.persistConversation?.({
          utterance: text,
          response: this.aiNotice,
          action: "voice_turn",
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
      } catch (error) {
        if (
          generation === this.generation &&
          requestVersion === this.candidateRequestVersion
        ) {
          this.aiNotice = modelErrorMessage(error);
          await this.persistConversation?.({
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
        if (generation !== this.generation) {
          URL.revokeObjectURL(url);
          return;
        }
        const player = this.$refs.audioPlayer;
        player.src = url;
        this.audioUrl = url;
        await player.play();
      } catch (error) {
        // 不用全局 toast：会盖住顶部品牌与日期时间，改为在语音区内联提示。
        if (generation === this.generation) {
          this.voiceError = error.message || "语音播报暂不可用。";
        }
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
