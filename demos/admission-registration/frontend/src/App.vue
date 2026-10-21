<template>
  <main
    class="page-shell"
    :class="{
      'page-shell--home': page === 'home',
      'page-shell--conversation': conversationVisible && page === 'home',
      'page-shell--flow': entered,
      'page-shell--test-input':
        testInputEnabled ||
        (conversationVisible && conversationInputMode === 'text'),
    }"
    @click="handleActivity"
    @keydown="handleActivity"
  >
    <header class="topbar">
      <div class="brand-block">
        <strong class="brand-name">Neusoft</strong>
        <span class="brand-subtitle">东软智慧医疗 · 智慧医院 AI 助手</span>
      </div>
      <span class="screen-time">{{ screenTime }}</span>
      <button
        class="help-button"
        type="button"
        aria-label="帮助"
        @click="selfModeHint"
      >
        <i class="el-icon-question"></i><span>帮助</span>
      </button>
    </header>

    <div class="page-content">
      <section
        v-if="page === 'home' || page === 'identity'"
        class="mascot-stage"
        aria-live="polite"
      >
        <div class="mascot-shortcut">入院登记</div>
        <img class="mascot-image" :src="nurseBot" alt="智能导诊助手" />
        <div class="mascot-shortcut">办理指引</div>
        <div class="assistant-greeting">您好，我是您的智能导诊助手</div>
      </section>

      <ConversationCard
        v-if="page === 'home' || page === 'identity'"
        :shortcuts="shortcuts"
        @select="handleShortcut"
      />
      <section v-if="page === 'home'" class="home-guidance">
        <strong>智能导诊</strong>
        <p class="conversation-message conversation-message--assistant">
          您好，我可以帮助您完成住院登记。请描述您的需求，或点击下方麦克风开始对话。
        </p>
      </section>
      <div
        v-if="page === 'home' && !conversationVisible"
        class="conversation-message-row home-guide-reply"
      >
        <p class="conversation-message conversation-message--assistant">
          您好，请告诉我您需要办理什么。
        </p>
        <button
          class="conversation-message__speaker"
          type="button"
          aria-label="播放提示"
          @click="playAssistantMessage('您好，请告诉我您需要办理什么。')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9v6h4l5 4V5L7 9H3z" />
            <path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11" />
          </svg>
        </button>
      </div>

      <WorkflowHistory
        v-if="workflowHistory.length"
        :entries="workflowHistory"
        :field-keywords="fieldKeywords"
        :voice-active="recording || recognizing || startingVoice"
        @speak-message="playAssistantMessage"
      />
      <section
        v-if="entered"
        class="admission-scene"
        :class="{ 'admission-scene--identity': page === 'identity' }"
      >
        <div v-if="page !== 'identity'" class="scene-mascot" aria-hidden="true">
          <span>入院登记</span>
          <img :src="nurseBot" alt="" />
          <span>信息填写</span>
        </div>
        <div v-if="page === 'identity'" class="entered-label">
          您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。
        </div>
        <IdentityCard
          v-if="page === 'identity'"
          :verifying="verifying"
          :form-error="formError"
          @verify="verifyIdentity"
          @close="cancelFlow"
          @speak="playAssistantMessage(identityCardPrompt)"
        />
        <ApplicationList
          v-else-if="page === 'applications'"
          :items="applications"
          :selected-id="selectedApplicationId"
          :loading="loadingApplications"
          :selecting="selectingApplication"
          :error="applicationError"
          :ai-conversation="conversationVisible"
          @select="
            selectedApplicationId = $event;
            touch();
          "
          @continue="continueWithApplication"
          @back="goBack"
        />
        <AdmissionForm
          v-else-if="page === 'form'"
          :step="step"
          :continuous="conversationVisible"
          :groups="groups"
          :fields="fields"
          :field-errors="fieldErrors"
          :sources="sources"
          :submitting="submitting"
          :region-options="regionOptions"
          @change="onFieldChange"
          @save-edits="flushManualChanges"
          @next="nextPage"
          @back="onFormBack"
        />
        <ReviewPanel
          v-else-if="page === 'review' && activeApplication"
          :application="activeApplication"
          :groups="groups"
          :fields="fields"
          :field-errors="fieldErrors"
          :region-options="regionOptions"
          :value-label="reviewValueLabel"
          :submitting="submitting"
          @change="onFieldChange"
          @save-edits="flushManualChanges"
          @submit="submit"
        />
        <ResultPanel
          v-else-if="page === 'result'"
          :result="result"
          :checking-result="checkingResult"
          @check="checkResult"
          @retry="retryReview"
          @finish="finish"
        />
      </section>
      <ConversationDialog
        :home="page === 'home'"
        :inline="page !== 'home'"
        :allow-close="page !== 'form' && page !== 'review'"
        :visible="conversationVisible"
        :identity="page === 'identity'"
        :identity-prompt="identityCardPrompt"
        :application-confirmation="applicationConfirmationReady"
        :application-selecting="selectingApplication"
        :question="page === 'form' ? nextConversationQuestion : ''"
        :follow-up="patientInfoFollowUp"
        :required-progress="patientInfoProgress"
        :choices="page === 'form' ? nextConversationChoices : []"
        :saving="
          savingConversationChoice || submitting || processingConversation
        "
        :can-submit="page === 'review' && !!activeApplication"
        :messages="activeDialogMessages"
        :review-summary="page === 'review' ? reviewSummary : []"
        :field-keywords="fieldKeywords"
        :auto-speak-assistant="autoSpeakAssistant"
        :sound-detected="soundDetected"
        :silence-countdown="silenceCountdown"
        :volume-level="volumeLevel"
        :thinking="aiThinking"
        :recording="recording"
        :recognizing="recognizing"
        :starting-voice="startingVoice"
        :transcript="transcript"
        :ai-notice="aiNotice"
        :voice-error="voiceError"
        @close="closeConversation"
        @toggle-auto-speak="toggleAutoSpeak"
        @submit-registration="submitConversationInput('确认提交')"
        @select-option="selectConversationOption"
        @toggle-record="recording ? stopRecording() : startRecording()"
        @speak-message="playAssistantMessage"
        @confirm-application="continueWithApplication"
      />
      <button
        v-if="page === 'home' && conversationVisible"
        class="exit-guide"
        type="button"
        @click="closeConversation"
      >
        <i class="el-icon-document" aria-hidden="true"></i>
        <span>退出智能登记</span>
      </button>
    </div>

    <VoiceStage
      v-if="page !== 'result' || (result && result.status === 'unknown')"
      :disabled="submitting"
      :show-self-mode="page === 'home'"
      :home-activity="homeActivity"
      :show-feedback="
        page !== 'home' && page !== 'form' && !conversationVisible
      "
      :show-manual-entry="page !== 'identity'"
      :text-mode="
        conversationVisible &&
        conversationInputMode === 'text' &&
        page !== 'identity'
      "
      :voice-draft="voiceDraft"
      :transcript="transcript"
      :ai-thinking="aiThinking"
      :ai-notice="aiNotice"
      :voice-error="voiceError"
      :recording="recording"
      :recognizing="recognizing"
      :sound-detected="soundDetected"
      :silence-countdown="silenceCountdown"
      :volume-level="volumeLevel"
      @countdown-change="homeCountdown = $event"
      @hold-start="beginVoiceHold"
      @manual-input="openManualInput"
      @voice-input="conversationInputMode = 'voice'"
      @send="sendPillInput"
      @self-mode="selfModeHint"
    />

    <BottomBar
      v-if="page !== 'home' || !conversationVisible"
      :page="page"
      :countdown="page === 'home' ? homeCountdown : sessionRemaining"
      :patient-name="fields.name"
      :phone="fields.phone"
      :disabled="submitting"
      @back="goBack"
      @home="page === 'home' ? closeConversation() : cancelFlow()"
      @logout="cancelFlow"
    />

    <VoiceHoldOverlay
      :visible="holdActive && recording"
      :cancel="holdCancelZone"
      :sound-detected="soundDetected"
      :volume-level="volumeLevel"
    />
    <div
      v-if="guidanceVisible"
      class="guide-overlay"
      @click.self="guidanceVisible = false"
    >
      <div class="guide-spotlight" aria-hidden="true"></div>
      <section
        class="guide-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
      >
        <span class="guide-step">办理指引 · 1 / 1</span>
        <h2 id="guide-title">从这里开始办理</h2>
        <p>按住下方麦克风描述需求，也可以点击“我要办理住院登记”直接开始。</p>
        <button type="button" @click="guidanceVisible = false">我知道了</button>
      </section>
    </div>
    <audio
      ref="audioPlayer"
      hidden
      @ended="finishAssistantSpeech"
      @error="finishAssistantSpeech"
    ></audio>

    <el-dialog
      :title="
        inferredDetailCandidate
          ? '是否采用识别出的详细地址？'
          : '是否修改这项信息？'
      "
      :visible="!!candidateDialogKey"
      width="420px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      append-to-body
    >
      <template v-if="candidateConfirmation">
        <p>
          <strong>{{ candidateConfirmation.label }}</strong>
        </p>
        <p>当前内容：{{ maskText(candidateConfirmation.currentValue) }}</p>
        <p>识别内容：{{ maskText(candidateConfirmation.candidateValue) }}</p>
        <p>您可以点击选择，或点击下方麦克风说出您的决定。</p>
      </template>
      <el-button
        class="candidate-confirmation-mic"
        type="primary"
        :disabled="aiThinking || recognizing"
        aria-label="按住说话，松开后发送"
        @pointerdown.native="beginVoiceHold($event)"
        @contextmenu.native.prevent
      >
        <i class="el-icon-microphone"></i>
        {{ recording ? "松开发送" : "按住说话" }}
      </el-button>
      <p v-if="recording || recognizing" class="candidate-confirmation-status">
        {{
          recording
            ? silenceCountdown
              ? `静音倒计时 ${silenceCountdown} 秒，继续说话会重新计时`
              : "正在录音，停顿 3 秒后自动结束"
            : "正在识别语音…"
        }}
      </p>
      <p v-else-if="aiThinking" class="candidate-confirmation-status">
        正在判断您的选择…
      </p>
      <p
        v-else-if="aiNotice"
        class="candidate-confirmation-status"
        role="status"
      >
        {{ aiNotice }}
      </p>
      <span slot="footer">
        <el-button
          :disabled="startingVoice || recording || recognizing"
          @click="resolveCandidate(false)"
          >{{ inferredDetailCandidate ? "不采用" : "保留当前内容" }}</el-button
        >
        <el-button
          type="primary"
          :disabled="startingVoice || recording || recognizing"
          @click="resolveCandidate(true)"
          >{{
            inferredDetailCandidate ? "采用识别内容" : "修改为识别内容"
          }}</el-button
        >
      </span>
    </el-dialog>

    <el-dialog
      title="确认退出本次入院登记吗？"
      :visible.sync="cancelVisible"
      width="min(92vw, 340px)"
      append-to-body
    >
      <p>退出后，本次填写的信息将不会提交。</p>
      <span slot="footer"
        ><el-button @click="cancelVisible = false">继续办理</el-button
        ><el-button type="primary" @click="reset">确认退出</el-button></span
      >
    </el-dialog>
    <el-dialog
      title="是否继续办理？"
      :visible.sync="idleVisible"
      width="min(92vw, 340px)"
      :close-on-click-modal="false"
      :show-close="false"
      append-to-body
    >
      <p>为保护个人信息，{{ idleRemaining }} 秒后将清除当前页面内容。</p>
      <span slot="footer"
        ><el-button type="primary" @click="continueSession"
          >继续办理</el-button
        ></span
      >
    </el-dialog>
  </main>
</template>

<script>
import nurseBot from "./assets/nurse-bot-transparent.png";
import AdmissionForm from "./components/AdmissionForm.vue";
import ApplicationList from "./components/ApplicationList.vue";
import BottomBar from "./components/BottomBar.vue";
import ConversationCard from "./components/ConversationCard.vue";
import ConversationDialog from "./components/ConversationDialog.vue";
import IdentityCard from "./components/IdentityCard.vue";
import KeypadDialog from "./components/KeypadDialog.vue";
import ResultPanel from "./components/ResultPanel.vue";
import ReviewPanel from "./components/ReviewPanel.vue";
import VoiceHoldOverlay from "./components/VoiceHoldOverlay.vue";
import VoiceStage from "./components/VoiceStage.vue";
import WorkflowHistory from "./components/WorkflowHistory.vue";
import { admissionApi } from "./api/admission.js";
import voiceFlow from "./logic/voiceFlow.js";
import {
  COMPLETE_REPLY,
  FIELD_GROUPS,
  FIELD_REASK,
  SHORTCUTS,
  emptyFields,
  enumFieldOptions,
  fieldQuestion,
} from "./model/formConfig.js";
import { loadValidation, validateFields } from "./model/validationLoader.js";
import { abortAfter } from "./utils/async.js";
import { maskName, maskId, maskPhone, maskText } from "./utils/mask.js";
import { makeUuid } from "./utils/uuid.js";

// 兜底选项挂起时仍允许口头触发的推进指令（与 nextConversationChoices 的推进项一致）。
const ADVANCE_CHOICES = ["继续下一页", "进入核对页", "暂不继续"];
const IDENTITY_CARD_PROMPT = "请将证件放置到读卡区，然后点击“模拟刷卡”。";

export default {
  name: "AdmissionRegistrationApp",
  components: {
    AdmissionForm,
    ApplicationList,
    BottomBar,
    ConversationCard,
    ConversationDialog,
    IdentityCard,
    KeypadDialog,
    ResultPanel,
    ReviewPanel,
    VoiceHoldOverlay,
    VoiceStage,
    WorkflowHistory,
  },
  mixins: [voiceFlow],
  data() {
    return {
      nurseBot,
      testInputEnabled:
        new URLSearchParams(window.location.search).get("test-input") === "1",
      guidanceVisible: false,
      screenTime: "",
      homeCountdown: 380,
      homeActivity: 0,
      clockTimer: null,
      identityCardPrompt: IDENTITY_CARD_PROMPT,
      page: "home",
      step: 1,
      identityMethod: "id_card",
      identityScenario: "success",
      identityToken: "",
      sessionId: "",
      sessionRevision: 0,
      lastTurnId: null,
      manualPersistTimer: null,
      manualPendingFields: {},
      conversationWrite: Promise.resolve(),
      conversationVisible: false,
      conversationInputMode: "text",
      dialogMessages: [],
      dialogSessionId: "",
      // 追问引导追加消息后的 dialogMessages.length；见 "dialogMessages.length" watcher。
      announceAppendedTo: 0,
      lastGuidedStage: "",
      conversationMessages: [],
      initialPatientInfoRequestPending: false,
      homeConversationMessages: [],
      manualConversationMessages: [],
      autoSpeakAssistant: false,
      assistantSpeechQueue: [],
      assistantSpeechActive: false,
      assistantSpeechVersion: 0,
      savingConversationChoice: false,
      processingConversation: false,
      applications: [],
      selectedApplicationId: "",
      activeApplication: null,
      loadingApplications: false,
      selectingApplication: false,
      applicationError: "",
      fields: emptyFields(),
      shortcuts: SHORTCUTS,
      groups: FIELD_GROUPS,
      regionOptions: [],
      validationReady: false,
      fieldErrors: {},
      sources: {},
      formError: "",
      verifying: false,
      submitting: false,
      checkingResult: false,
      result: null,
      cancelVisible: false,
      idempotencyKey: "",
      mockScenario: "success",
      pendingCandidates: {},
      candidateDialogKey: "",
      fallbackChoiceKey: "",
      aiClarification: "",
      aiClarificationChoices: [],
      optionalFollowUpKey: "",
      optionalSkippedStep: 0,
      workflowHistory: [],
      historyCaptureEnabled: true,
    };
  },
  computed: {
    conversationTurnCount() {
      return this.conversationMessages.filter(
        (message) =>
          message.role === "patient" && message.action !== "manual_edit",
      ).length;
    },
    fieldKeywords() {
      return this.groups.flatMap((group) =>
        group.fields.map((field) => field.label),
      );
    },
    entered() {
      return this.page !== "home";
    },
    conversationStage() {
      return this.page === "form" ? `form:${this.step}` : this.page;
    },
    activeDialogMessages() {
      return this.dialogMessages.slice(
        this.workflowHistory.at(-1)?.messageEnd || 0,
      );
    },
    conversationBusy() {
      return (
        this.aiThinking ||
        this.recognizing ||
        this.processingConversation ||
        this.savingConversationChoice
      );
    },
    reviewSummary() {
      const application = this.activeApplication;
      return [
        {
          title: "入院申请单",
          fields: [
            { label: "申请单号", value: application?.id || "未提供" },
            { label: "患者", value: application?.patientName || "未提供" },
            { label: "入院科室", value: application?.department || "未提供" },
            {
              label: "计划入院时间",
              value: application?.plannedAdmissionAt || "未提供",
            },
            { label: "诊断", value: application?.diagnosis || "未提供" },
          ],
        },
        ...this.groups.map((group) => ({
          title: group.title,
          fields: group.fields.map((field) => ({
            label: field.label,
            value: this.reviewValueLabel(field.key),
          })),
        })),
      ];
    },
    candidateConfirmation() {
      const key = this.candidateDialogKey;
      const field = this.groups
        .flatMap((group) => group.fields)
        .find((item) => item.key === key);
      if (!field || !this.pendingCandidates[key]) return null;
      return {
        key,
        label: field.label,
        currentValue: this.candidateValueLabel(key, this.fields[key]),
        candidateValue: this.candidateValueLabel(
          key,
          this.pendingCandidates[key],
        ),
        currentSnapshot: JSON.stringify(this.fields[key]),
        candidateSnapshot: JSON.stringify(this.pendingCandidates[key]),
      };
    },
    inferredDetailCandidate() {
      return (
        this.candidateDialogKey === "addressDetail" &&
        !this.fields.addressDetail
      );
    },
    nextConversationField() {
      return this.conversationFields.find(
        (item) => item.required && !item.readonly && !this.fields[item.key],
      );
    },
    initialPatientInfoRequest() {
      return (
        this.page === "form" &&
        this.step === 1 &&
        this.initialPatientInfoRequestPending
      );
    },
    patientInfoProgress() {
      const required = this.groups
        .flatMap((group) => group.fields)
        .filter((field) => field.required && !field.readonly);
      const errors = this.validationReady
        ? validateFields(
            this.fields,
            required.map((field) => field.key),
          )
        : {};
      return {
        completed: required.filter(
          (field) => !!this.fields[field.key] && !errors[field.key],
        ).length,
        total: required.length,
      };
    },
    patientInfoFollowUp() {
      if (
        this.page !== "form" ||
        this.initialPatientInfoRequest ||
        this.candidateDialogKey ||
        this.aiClarification
      )
        return null;
      const required = this.conversationFields.filter(
        (field) => field.required && !field.readonly,
      );
      const missing = required.filter((field) => !this.fields[field.key]);
      const field = this.fallbackChoiceKey
        ? this.conversationFields.find(
            (item) => item.key === this.fallbackChoiceKey,
          )
        : missing[0];
      if (
        !field &&
        (!this.emptyOptionalFields.length ||
          this.optionalSkippedStep === this.step)
      )
        return null;
      return {
        title: this.fallbackChoiceKey
          ? "请确认登记信息"
          : field
          ? "补充必填信息"
          : "补充选填信息",
        question: field ? fieldQuestion(field) : this.nextConversationQuestion,
        missing: (field ? missing : this.emptyOptionalFields).map(
          (item) => item.label,
        ),
        completed: required.length - missing.length,
        total: required.length,
      };
    },
    conversationFields() {
      return this.conversationVisible
        ? this.groups.flatMap((group) => group.fields)
        : this.groups[this.step - 1]?.fields || [];
    },
    conversationAdvance() {
      return this.conversationVisible || this.step === this.groups.length
        ? "进入核对页"
        : "继续下一页";
    },
    emptyOptionalFields() {
      return this.conversationFields.filter(
        (item) =>
          !item.required && !item.readonly && !this.fields[item.key]?.length,
      );
    },
    optionalSupplementChoice() {
      return this.emptyOptionalFields.length === 1
        ? `补充${this.emptyOptionalFields[0].label}`
        : "继续补充";
    },
    nextConversationQuestion() {
      if (this.initialPatientInfoRequest) {
        const fields = this.groups.flatMap((group) => group.fields);
        const labels = (items) => items.map((field) => field.label).join("、");
        return `接下来填写患者信息。\n已从身份档案带入：${labels(
          fields.filter((field) => field.readonly),
        )}，请核对，无需重复填写。\n必填信息：${labels(
          fields.filter((field) => field.required && !field.readonly),
        )}。\n选填信息：${labels(
          fields.filter((field) => !field.required && !field.readonly),
        )}，可以跳过。\n您可以一次告诉我多项，也可以分几次回答。所有患者信息都在这段对话中完成，最后统一核对。`;
      }
      if (this.aiClarification) return "";
      // 兜底选项挂起时 aiNotice 已说明「请直接选择某字段」，此时再追问必填项
      // 会和下方那组选项对不上（问婚姻、选项却是职业），所以不再追问。
      if (this.fallbackChoiceKey) return "";
      const fields = this.conversationFields.filter(
        (item) => item.required && !item.readonly && !this.fields[item.key],
      );
      const field = this.nextConversationField;
      if (!field) {
        const remaining = this.emptyOptionalFields;
        if (remaining.length) {
          const advance = this.conversationAdvance;
          if (this.optionalSkippedStep === this.step)
            return `本页剩余选填项已跳过。是否${advance}？`;
          const followUp = remaining.find(
            (item) => item.key === this.optionalFollowUpKey,
          );
          if (followUp)
            return `请告诉我您的${followUp.label}。您也可以一次补充其他选填内容；如需跳过，请说“${advance}”。`;
          const completed = this.conversationFields
            .filter(
              (item) =>
                !item.required &&
                !item.readonly &&
                this.fields[item.key]?.length,
            )
            .map((item) => item.label);
          return `${completed.length ? `已记录${completed.join("、")}。` : ""}${
            this.conversationVisible ? "登记资料" : "本页"
          }还有选填内容未填写：${remaining
            .map((item) => item.label)
            .join("、")}。您可以一次补充多项；要${
            this.optionalSupplementChoice
          }，还是${advance}？`;
        }
        if (this.conversationAdvance === "继续下一页") {
          return "本页信息已填写完成。是否继续下一页？";
        }
        return "患者信息已填写完成。请进入核对页统一核对，确认后再提交。";
      }
      if (fields.length > 1)
        return `还需要补充以下必填信息：${fields
          .map((item) => item.label)
          .join("、")}。您可以一次回答多项。`;
      return this.aiNotice === FIELD_REASK[field.key]
        ? ""
        : fieldQuestion(field);
    },
    nextConversationChoices() {
      if (this.candidateDialogKey) return [];
      if (this.aiClarificationChoices.length)
        return this.aiClarificationChoices;
      if (this.fallbackChoiceKey)
        return enumFieldOptions(this.fallbackChoiceKey);
      if (!this.nextConversationField) {
        if (this.emptyOptionalFields.length) {
          const advance = this.conversationAdvance;
          return this.optionalSkippedStep === this.step
            ? [advance, "暂不继续"]
            : this.optionalFollowUpKey
            ? [advance]
            : [this.optionalSupplementChoice, advance];
        }
        return [this.conversationAdvance, "暂不继续"];
      }
      return enumFieldOptions(this.nextConversationField.key);
    },
    applicationConfirmationReady() {
      return Boolean(
        this.page === "applications" &&
          this.conversationVisible &&
          !this.loadingApplications &&
          !this.applicationError &&
          this.selectedApplicationId &&
          this.applications.some(
            (item) =>
              item.id === this.selectedApplicationId && item.status === "有效",
          ),
      );
    },
  },
  watch: {
    conversationVisible(value) {
      if (value) {
        this.announceConversationPage();
        this.announceConversationQuestion();
      }
    },
    conversationStage(next, previous) {
      if (this.historyCaptureEnabled && previous && next !== previous) {
        const [page, step] = previous.split(":");
        this.appendWorkflowHistory(page, Number(step) || 1);
      }
      this.announceConversationPage();
    },
    nextConversationQuestion() {
      this.announceConversationQuestion();
    },
    conversationBusy() {
      this.announceConversationQuestion();
    },
    // 只有真实对话轮次（用户说话/助手回复）把页面钉回底部；追问引导的追加
    // 与表单里的布局变化（电话键盘输入使追问区高度增减）都不能触发整页滚动，
    // 否则首末位数字输入会跳到页面底部。
    "dialogMessages.length"() {
      if (this.dialogMessages.length === this.announceAppendedTo) return;
      this.scrollToPageBottom();
    },
  },
  mounted() {
    this.updateScreenTime();
    this.clockTimer = setInterval(this.updateScreenTime, 30000);
  },
  beforeDestroy() {
    clearInterval(this.clockTimer);
    clearTimeout(this.manualPersistTimer);
  },
  methods: {
    maskText,
    handleActivity() {
      this.touch();
      if (this.page === "home") this.homeActivity += 1;
    },
    scrollToPageBottom() {
      this.$nextTick(() => {
        if (
          this._isDestroyed ||
          (this.page === "home" && !this.conversationVisible)
        )
          return;
        const page = document.scrollingElement || document.documentElement;
        page.scrollTop = page.scrollHeight;
      });
    },
    appendWorkflowHistory(page, step) {
      const title =
        page === "home"
          ? "智能导诊"
          : page === "identity"
          ? "身份核验"
          : page === "applications"
          ? "本人入院申请单"
          : page === "form"
          ? this.conversationVisible
            ? "登记信息"
            : this.groups[step - 1]?.title || `登记信息（${step}）`
          : page === "review"
          ? "信息核对"
          : "登记结果";
      let fields = [];
      let text = "";
      if (page === "home") {
        text = "已进入入院登记办理流程。";
      } else if (page === "identity") {
        text = this.identityToken ? "身份核验已完成。" : "身份核验步骤。";
      } else if (page === "applications") {
        const application =
          this.activeApplication ||
          this.applications.find(
            (item) => item.id === this.selectedApplicationId,
          );
        text = this.activeApplication
          ? "已确认本人有效入院申请单。"
          : "申请单查询记录，尚未确认。";
        fields = application
          ? [
              { label: "申请单号", value: application.id },
              { label: "患者", value: maskName(application.patientName || "") },
              { label: "入院科室", value: application.department },
              { label: "计划入院时间", value: application.plannedAdmissionAt },
            ]
          : [];
      } else if (page === "form") {
        const shownFields = this.conversationVisible
          ? this.groups.flatMap((group) => group.fields)
          : this.groups[step - 1]?.fields || [];
        fields = shownFields.map((field) => ({
          label: field.label,
          value: this.reviewValueLabel(field.key),
        }));
      } else if (page === "review") {
        fields = this.reviewSummary.flatMap((section) =>
          section.fields.map((field) => ({
            label: `${section.title} · ${field.label}`,
            value: field.label === "患者" ? maskName(field.value) : field.value,
          })),
        );
      } else if (page === "result") {
        text =
          {
            success: "模拟登记完成",
            failed: "模拟登记未完成",
            already_registered: "发现已有登记记录",
            unknown: "登记结果待确认",
          }[this.result?.status] || "登记结果待确认";
        if (this.result?.receiptId)
          fields = [{ label: "模拟回执号", value: this.result.receiptId }];
      }
      const messageStart = this.workflowHistory.at(-1)?.messageEnd || 0;
      // 同一轮更新可能已追加下一阶段提示，只归档已离开的阶段消息。
      const nextMessage = this.dialogMessages.findIndex(
        (message, index) =>
          index >= messageStart && message.stage === this.conversationStage,
      );
      const messageEnd =
        nextMessage < 0 ? this.dialogMessages.length : nextMessage;
      const messages = this.dialogMessages.slice(messageStart, messageEnd);
      this.workflowHistory.push({
        page,
        title,
        text,
        fields,
        messages,
        requiredProgress: this.patientInfoProgress,
        messageEnd,
      });
    },
    updateScreenTime() {
      const now = new Date();
      const weekdays = [
        "星期日",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
      ];
      const date = `${now.getFullYear()}年${
        now.getMonth() + 1
      }月${now.getDate()}日`;
      const time = now.toLocaleTimeString("zh-CN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      this.screenTime = `${date} ${weekdays[now.getDay()]} ${time}`;
    },
    begin() {
      this.page = "identity";
      this.formError = "";
      this.transcript = "";
      this.aiNotice = "";
      this.voiceError = "";
      this.touch();
      this.scrollToPageBottom();
      if (!this.conversationVisible)
        this.playAssistantMessage(IDENTITY_CARD_PROMPT);
    },
    handleShortcut(index) {
      if (this.page !== "home") return;
      this.aiRequest?.abort();
      this.candidateRequestVersion += 1;
      this.aiRequest = null;
      this.aiThinking = false;
      if (index !== this.shortcuts.length - 1) {
        this.openConversation("text");
        this.submitConversationInput(this.shortcuts[index]);
        return;
      }
      this.conversationVisible = false;
      this.transcript = this.shortcuts[index];
      this.voiceError = "";
      this.appendConversationMessages(this.homeConversationMessages, {
        role: "patient",
        text: this.transcript,
      });
      this.handleHomeIntent("begin_admission");
    },
    toggleAutoSpeak() {
      this.autoSpeakAssistant = !this.autoSpeakAssistant;
      if (!this.autoSpeakAssistant) this.stopAssistantSpeech();
    },
    playAssistantMessage(text) {
      this.stopAssistantSpeech();
      this.speak(text);
    },
    stopAssistantSpeech() {
      this.assistantSpeechVersion += 1;
      this.assistantSpeechQueue = [];
      this.assistantSpeechActive = false;
      this.ttsRequest?.abort();
      this.ttsRequest = null;
      this.releaseAudio();
    },
    speakAssistantReply(text) {
      if (!this.autoSpeakAssistant || !text) return;
      this.assistantSpeechQueue.push(text);
      this.playNextAssistantReply();
    },
    playNextAssistantReply() {
      if (
        !this.autoSpeakAssistant ||
        this.assistantSpeechActive ||
        !this.assistantSpeechQueue.length
      )
        return;
      this.assistantSpeechActive = true;
      const version = ++this.assistantSpeechVersion;
      Promise.resolve(this.speak(this.assistantSpeechQueue.shift())).then(
        (played) => {
          if (played === false && version === this.assistantSpeechVersion)
            this.finishAssistantSpeech();
        },
      );
    },
    finishAssistantSpeech() {
      this.releaseAudio();
      this.assistantSpeechActive = false;
      this.playNextAssistantReply();
    },
    handleHomeIntent(intent) {
      if (this.page !== "home") return;
      if (intent === "begin_admission") this.begin();
      else if (intent === "greeting")
        this.aiNotice =
          "您好，我可以帮您办理入院登记。您可以说“我要办理入院”。";
      else if (intent === "answer_question") this.aiNotice = "";
      else if (intent === "unsupported")
        this.aiNotice = "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。";
      else this.aiNotice = "我没能确定您的需求，请说说您想办理什么。";
    },
    openManualInput() {
      if (this.submitting) return;
      this.openConversation("text");
    },
    sendPillInput(text) {
      const utterance = String(text || "").trim();
      if (!utterance || this.submitting) return;
      // 底部输入条直接发送：先把对话区打开，再按同一套对话流程处理
      if (!this.conversationVisible) this.openConversation("text");
      this.submitConversationInput(utterance);
    },
    openConversation(inputMode) {
      this.conversationInputMode = inputMode;
      this.conversationVisible = true;
      this.announceConversationPage();
    },
    appendConversationMessages(target, ...messages) {
      for (const message of messages) {
        if (
          message.role === "assistant" &&
          this.page === "form" &&
          !this.initialPatientInfoRequest &&
          !this.nextConversationField &&
          message.text === this.nextConversationQuestion
        )
          message.title = "内容确认";
      }
      if (target) target.push(...messages);
      // 业务持久化分阶段，显示记录按实际发生顺序跨页追加。
      this.dialogMessages.push(
        ...messages.map((message) => ({
          ...message,
          stage: this.conversationStage,
        })),
      );
    },
    announceConversationPage() {
      if (
        !this.conversationVisible ||
        this.lastGuidedStage === this.conversationStage
      )
        return;
      let text;
      if (this.page === "home") {
        if (!this.dialogMessages.length)
          text = "您好，请告诉我您需要办理什么。";
      } else if (this.page === "identity") {
        text = `当前已进入身份核验页面。${IDENTITY_CARD_PROMPT}`;
      } else if (this.page === "applications") {
        text = this.loadingApplications
          ? "当前已进入本人入院申请单页面，正在查询您的有效申请单，请稍候。"
          : this.applicationPageMessage();
      } else if (this.page === "form") {
        text = this.conversationVisible
          ? this.nextConversationQuestion
          : `当前已进入${
              this.step === 1 ? "基本信息（1/2）" : "补充信息（2/2）"
            }页面，请核对并补充本页资料。${this.nextConversationQuestion}`;
      } else if (this.page === "review") {
        text =
          "当前已进入信息核对页面。以下是本次入院登记信息，请逐项核对。确认无误请说“确认提交”；需要修改时，请说出项目和新内容，例如“职业改为学生”。确认后将提交本次模拟登记。";
      } else if (this.page === "result") {
        text = `当前已进入登记结果页面。${
          ["success", "already_registered"].includes(this.result?.status)
            ? "本次模拟登记已完成，请查看本页结果，完成后返回首页。"
            : this.result?.status === "unknown"
            ? "登记结果暂未确认，您可以说“查询办理结果”，请勿重复提交。"
            : "本次登记未成功，请查看本页原因并按提示处理。"
        }`;
      }
      this.lastGuidedStage = this.conversationStage;
      if (!text) return;
      this.appendConversationMessages(
        null,
        this.page === "applications" && !this.loadingApplications
          ? this.applicationDialogueMessage(text)
          : {
              role: "assistant",
              text,
              ...(this.initialPatientInfoRequest ? { patientInfo: true } : {}),
            },
      );
      this.speakAssistantReply(text);
    },
    announceConversationQuestion() {
      if (
        !this.conversationVisible ||
        this.page !== "form" ||
        this.conversationBusy
      )
        return;
      const text = this.nextConversationQuestion;
      const last = this.dialogMessages[this.dialogMessages.length - 1];
      if (text && !(last?.role === "assistant" && last.text.endsWith(text))) {
        // 引导话术更新不触发钉底：手动改字段（如电话键盘输入首位/删除末位）
        // 会改写追问并追加本消息，若随之钉底会把正在填写的表单拽到页面底部。
        this.announceAppendedTo = this.dialogMessages.length + 1;
        this.appendConversationMessages(null, { role: "assistant", text });
        this.speakAssistantReply(text);
      }
    },
    closeConversation() {
      if (this.verifying) {
        this.generation += 1;
        this.identityRequest?.abort();
        this.verifying = false;
      }
      this.conversationVisible = false;
    },
    async submitConversationInput(text) {
      const utterance = text.trim();
      if (
        !utterance ||
        this.processingConversation ||
        this.aiThinking ||
        this.submitting ||
        this.savingConversationChoice
      )
        return;
      const generation = this.generation;
      this.processingConversation = true;
      try {
        this.voiceDraft = "";
        this.transcript = utterance;
        this.voiceError = "";
        this.touch();
        const answer = utterance.replace(/[\s，。！？、,.!?；;：:]/g, "");
        if (this.candidateDialogKey) {
          if (
            this.inferredDetailCandidate &&
            ["下一页", "继续下一页", "进入核对页"].includes(answer)
          ) {
            const saved = await this.resolveCandidate(false);
            if (saved)
              await this.selectConversationOption(this.conversationAdvance);
          } else {
            this.aiNotice = "请先在确认框中选择，或使用框内麦克风确认。";
          }
          return;
        }
        if (
          this.page !== "home" &&
          [
            "取消",
            "取消办理",
            "取消登记",
            "返回首页",
            "回首页",
            "取消办理回首页",
          ].includes(answer)
        ) {
          this.cancelFlow();
          await this.replyToConversation(
            utterance,
            "确认退出本次入院登记吗？退出后，本次填写的信息将不会提交。",
          );
          return;
        }
        if (this.page === "home") {
          await this.classifyHomeIntent(utterance, this.generation);
        } else if (
          this.page === "review" &&
          this.identityToken &&
          this.sessionId
        ) {
          if (
            ["确认提交", "确认提交入院登记", "信息没问题确认提交"].includes(
              answer,
            )
          ) {
            await this.submit(utterance);
          } else if (answer.includes("提交")) {
            await this.replyToConversation(
              utterance,
              "本次尚未提交。请核对信息，确定无误后说“确认提交”或点击提交按钮。",
            );
          } else if (
            /(改成|改为|修改|更正)/.test(utterance) &&
            !/(不改|别改|不要|不用)/.test(utterance)
          ) {
            const requestedFields = this.groups
              .flatMap((item) => item.fields)
              .filter(
                (field) =>
                  !field.readonly &&
                  (utterance.includes(field.label) ||
                    (field.key === "phone" && /电话|手机号/.test(utterance)) ||
                    (field.key === "emergencyContact" &&
                      utterance.includes("联系人") &&
                      !utterance.includes("关系"))),
              );
            const group = this.groups.find((item) =>
              item.fields.some((field) => requestedFields.includes(field)),
            );
            if (!group) {
              await this.replyToConversation(
                utterance,
                "请说明需要修改哪项登记信息；身份档案信息请联系人工窗口处理。",
              );
              return;
            }
            // 在核对页已经展示的值需要患者明确确认后才能被新候选替换。
            this.markReviewedFields();
            this.editReviewStep(group.step);
            await this.applyAi(
              utterance,
              this.generation,
              requestedFields.map((field) => field.key),
            );
          } else {
            await this.replyToConversation(
              utterance,
              "请核对登记信息。您可以说“确认提交”，或说明需要修改的项目。",
            );
          }
        } else if (this.page === "form" && this.identityToken) {
          if (
            [
              "你的问题",
              "回答什么",
              "回答什么问题",
              "下一步问什么",
              "下一步要回答什么",
              "接下来问什么",
              "你要问什么",
            ].includes(answer)
          ) {
            const field = this.nextConversationField;
            const response = field
              ? this.nextConversationQuestion ||
                FIELD_REASK[field.key] ||
                fieldQuestion(field)
              : this.nextConversationQuestion;
            if (response) await this.replyToConversation(utterance, response);
            return;
          }
          if (answer.includes("提交")) {
            await this.replyToConversation(
              utterance,
              "请先补全资料并进入信息核对页，核对后再确认提交。",
            );
            return;
          }
          if (!this.nextConversationField && this.emptyOptionalFields.length) {
            const advance = this.conversationAdvance;
            if (["下一页", "继续下一页", "进入核对页"].includes(answer)) {
              await this.selectConversationOption(advance);
              return;
            }
            if (
              [
                "跳过",
                "跳过选填项",
                "不填",
                "不填了",
                "都不填",
                "选填项不填",
                "不需要补充",
                "暂不补充",
                "先不填",
              ].includes(answer)
            ) {
              await this.skipOptionalFields(utterance);
              return;
            }
            if ([this.optionalSupplementChoice, "继续补充"].includes(answer)) {
              await this.selectConversationOption(
                this.optionalSupplementChoice,
              );
              return;
            }
            if (answer === "暂不继续") {
              await this.selectConversationOption(answer);
              return;
            }
          } else if (
            !this.nextConversationField &&
            this.nextConversationChoices.length
          ) {
            const affirmative = [
              "继续",
              "继续下一页",
              "下一页",
              "跳过",
              "好",
              "好的",
              "可以",
              "是",
              "确认",
              "进入核对页",
            ];
            const negative = [
              "暂不继续",
              "暂不",
              "稍后",
              "先不",
              "不继续",
              "否",
            ];
            if (affirmative.includes(answer)) {
              await this.selectConversationOption(
                this.nextConversationChoices[0],
              );
              return;
            }
            if (negative.includes(answer)) {
              await this.selectConversationOption(
                this.nextConversationChoices[1],
              );
              return;
            }
          }
          const asksToChange = /(改成|改为|修改|更正|换成)/.test(utterance);
          const requestedDictionaryFields = asksToChange
            ? this.conversationFields
                .filter(
                  (field) =>
                    enumFieldOptions(field.key).length > 0 &&
                    (utterance.includes(field.label) ||
                      (field.key === "relationship" &&
                        utterance.includes("关系"))),
                )
                .map((field) => field.key)
            : [];
          await this.applyAi(
            utterance,
            this.generation,
            null,
            requestedDictionaryFields,
          );
        } else if (this.page === "result") {
          if (
            ["查询办理结果", "查询结果", "查询登记结果"].includes(answer) &&
            this.result?.status === "unknown"
          ) {
            await this.checkResult();
            if (generation !== this.generation) return;
            await this.replyToConversation(
              utterance,
              this.result?.status === "unknown"
                ? "暂时无法确认登记结果，请稍后查询或联系现场工作人员。"
                : this.result?.status === "success"
                ? "模拟登记已完成，请以页面结果为准。"
                : "已查询到登记结果，请查看页面提示。",
            );
          } else {
            await this.replyToConversation(
              utterance,
              "请以页面显示的登记结果为准；结果待确认时可以说“查询办理结果”。",
            );
          }
        } else {
          await this.replyToConversation(
            utterance,
            this.page === "applications"
              ? "已确认您的身份，请核对本人有效入院申请单并继续。"
              : "请先使用身份证、社保卡或电子医保凭证确认身份，再为您办理入院登记。",
          );
        }
        this.touch();
      } finally {
        if (generation === this.generation) this.processingConversation = false;
      }
    },
    async replyToConversation(utterance, response) {
      this.aiNotice = response;
      if (
        ["form", "review"].includes(this.page) &&
        this.sessionId &&
        this.identityToken
      ) {
        await this.persistConversation({
          utterance,
          response,
          action: "manual_turn",
        });
      } else {
        this.appendConversationMessages(
          this.manualConversationMessages,
          { role: "patient", text: utterance },
          { role: "assistant", text: response },
        );
        this.speakAssistantReply(response);
      }
    },
    fieldLabel(key) {
      return (
        this.groups
          .flatMap((group) => group.fields)
          .find((field) => field.key === key)?.label || "登记信息"
      );
    },
    markReviewedFields() {
      for (const field of this.groups.flatMap((group) => group.fields)) {
        if (!field.readonly && this.fields[field.key])
          this.$set(this.sources, field.key, "manual");
      }
    },
    selfModeHint() {
      if (this.page === "home") this.guidanceVisible = true;
      else this.$message.info("当前为自助模式演示。");
    },
    candidateValueLabel(key, value) {
      if (!Array.isArray(value)) return String(value || "未填写");
      let options = this.regionOptions;
      const labels = [];
      for (const code of value) {
        const region = options.find((item) => item.value === code);
        if (!region) return "地址候选无法识别";
        labels.push(region.label);
        options = region.children || [];
      }
      return labels.length ? labels.join(" / ") : "未填写";
    },
    candidateConfirmationMatches(context) {
      return (
        this.page === "form" &&
        this.candidateDialogKey === context.key &&
        this.pendingCandidates[context.key] !== undefined &&
        JSON.stringify(this.fields[context.key]) === context.currentSnapshot &&
        JSON.stringify(this.pendingCandidates[context.key]) ===
          context.candidateSnapshot
      );
    },
    async resolveCandidate(accept) {
      const key = this.candidateDialogKey;
      if (!key || !this.pendingCandidates[key]) return;
      const inferredDetail = this.inferredDetailCandidate;
      const proposedValue = this.pendingCandidates[key];
      const currentValue = this.fields[key];
      this.candidateConfirmationRequestVersion += 1;
      this.aiRequest?.abort();
      this.aiRequest = null;
      this.aiThinking = false;
      if (accept) this.applyPendingCandidate(key);
      else this.$delete(this.pendingCandidates, key);
      this.candidateDialogKey = Object.keys(this.pendingCandidates)[0] || "";
      this.aiNotice = this.candidateDialogKey ? "" : "已完成候选核对。";
      const saved = await this.persistConversation({
        utterance: inferredDetail
          ? accept
            ? "采用识别出的详细地址"
            : "不采用识别出的详细地址"
          : accept
          ? `确认修改${this.fieldLabel(key)}`
          : `保留${this.fieldLabel(key)}原信息`,
        response: inferredDetail
          ? accept
            ? `详细地址已更新为${this.reviewValueLabel(key)}，请核对。`
            : "已不采用识别出的详细地址。"
          : accept
          ? `${this.fieldLabel(key)}已更新为${this.reviewValueLabel(
              key,
            )}，请核对。`
          : `${this.fieldLabel(key)}保留为${this.reviewValueLabel(key)}。`,
        action: accept ? "candidate_accept" : "candidate_reject",
        fields: accept ? { [key]: proposedValue } : {},
        pendingProposal: {
          field: key,
          currentValue,
          proposedValue,
          decision: accept ? "accepted" : "rejected",
        },
      });
      if (saved && inferredDetail && !accept)
        this.announceConversationQuestion();
      this.touch();
      return saved;
    },
    goBack() {
      if (this.submitting) return;
      if (this.page === "home") {
        window.top.postMessage(
          { type: "octop:close-creation-preview" },
          window.location.origin,
        );
        return;
      }
      this.optionalFollowUpKey = "";
      this.optionalSkippedStep = 0;
      if (this.page === "form" && this.step > 1) this.step -= 1;
      else if (this.page === "applications") this.page = "identity";
      else if (this.page === "review") {
        this.page = "form";
        this.step = this.groups.length;
      } else this.cancelFlow();
      this.touch();
    },
    onFormBack() {
      if (this.submitting) return;
      this.optionalFollowUpKey = "";
      this.optionalSkippedStep = 0;
      if (this.step > 1) this.step -= 1;
      else this.cancelFlow();
      this.touch();
    },
    async verifyIdentity() {
      if (this.verifying) return;
      if (this.identityToken) {
        this.stopAssistantSpeech();
        this.workflowHistory = [];
        this.dialogMessages = [];
        this.lastGuidedStage = "";
        this.announceConversationPage();
      }
      const generation = ++this.generation;
      this.abortRequests();
      this.stopVoiceSession();
      this.identityToken = "";
      this.sessionId = "";
      this.fields = emptyFields();
      this.sources = {};
      this.pendingCandidates = {};
      this.candidateDialogKey = "";
      this.fallbackChoiceKey = "";
      this.optionalFollowUpKey = "";
      this.optionalSkippedStep = 0;
      this.touch();
      this.verifying = true;
      this.formError = "";
      const request = abortAfter(60000);
      this.identityRequest = request;
      try {
        const response = await admissionApi.verify(
          this.identityMethod,
          this.identityScenario,
          request.signal,
        );
        if (generation !== this.generation || this.page !== "identity") return;
        this.identityToken = response.identityToken;
        this.fields = { ...emptyFields(), ...response.fields };
        this.page = "applications";
        this.step = 1;
        this.loadingApplications = true;
        const applicationResponse = await admissionApi.applications(
          this.identityToken,
          request.signal,
        );
        if (generation !== this.generation || this.page !== "applications")
          return;
        this.applications = applicationResponse.items || [];
        const activeApplications = this.applications.filter(
          (application) => application.status === "有效",
        );
        this.selectedApplicationId =
          activeApplications.length === 1 ? activeApplications[0].id : "";
        this.applicationError =
          activeApplications.length > 1
            ? "检测到多份有效的入院申请单，请联系现场工作人员核实。"
            : "";
        if (this.conversationVisible) this.announceApplicationPage();
        this.touch();
      } catch (error) {
        if (generation !== this.generation) return;
        this.applicationError =
          error.message || "查询本人入院申请单失败，请重试。";
        if (this.page === "applications" && this.conversationVisible)
          this.announceApplicationPage();
        this.formError =
          error.status === 404
            ? "暂未查询到您的院内患者信息，请前往人工窗口协助办理入院登记。"
            : "请先使用身份证、社保卡或电子医保凭证确认身份，再为您办理入院登记。";
      } finally {
        request.done();
        if (this.identityRequest === request) this.identityRequest = null;
        if (generation === this.generation) {
          this.verifying = false;
          this.loadingApplications = false;
        }
      }
    },
    async continueWithApplication() {
      if (!this.selectedApplicationId || this.selectingApplication) return;
      const generation = this.generation;
      const identityToken = this.identityToken;
      this.selectingApplication = true;
      const request = abortAfter(10000);
      this.applicationRequest = request;
      try {
        const result = await admissionApi.selectApplication(
          this.identityToken,
          this.selectedApplicationId,
          request.signal,
        );
        if (
          generation !== this.generation ||
          identityToken !== this.identityToken ||
          this.page !== "applications"
        )
          return;
        this.activeApplication = result.application;
        this.sessionId = result.sessionId;
        this.sessionRevision = 0;
        this.lastTurnId = null;
        this.conversationWrite = Promise.resolve();
        this.conversationMessages = [];
        const saved = await admissionApi.getSession(
          this.sessionId,
          this.identityToken,
          request.signal,
        );
        if (
          generation !== this.generation ||
          identityToken !== this.identityToken ||
          this.page !== "applications"
        )
          return;
        this.sessionRevision = saved.revision;
        this.lastTurnId = saved.lastTurnId;
        this.conversationMessages = (saved.turns || []).flatMap((turn) => [
          { role: "patient", text: turn.utterance, action: turn.action },
          { role: "assistant", text: turn.response },
        ]);
        this.initialPatientInfoRequestPending = !(saved.turns || []).length;
        if (!this.conversationMessages.length) {
          // 场景 7：身份认证成功后的开场话术（12 号文档回复流程）。
          this.conversationMessages.push({
            role: "assistant",
            text: "已确认您的身份信息。请补充联系电话、婚姻状况、职业，以及紧急联系人姓名和与您的关系；还可以补充籍贯、现住地址和工作单位信息。姓名、身份证号、国籍和民族已从身份信息读取。",
          });
        }
        if (this.dialogSessionId !== this.sessionId) {
          this.dialogMessages.push(
            ...this.conversationMessages.map((message) => ({
              ...message,
              stage: this.conversationStage,
            })),
          );
          this.dialogSessionId = this.sessionId;
        }
        for (const [key, fact] of Object.entries(saved.facts || {})) {
          if (
            Object.hasOwn(this.fields, key) &&
            key !== "name" &&
            key !== "idNumber"
          ) {
            this.fields[key] = fact.value;
            this.sources[key] = fact.source;
          }
        }
        const [validation, regionResponse] = await Promise.all([
          loadValidation(),
          admissionApi.regions(request.signal),
        ]);
        if (
          generation !== this.generation ||
          identityToken !== this.identityToken ||
          this.page !== "applications"
        )
          return;
        this.regionOptions = regionResponse.items || [];
        validation.setRegions(this.regionOptions);
        this.validationReady = true;
        this.conversationVisible = true;
        this.page = "form";
        this.step = 1;
        this.aiNotice = "";
        this.transcript = "";
        this.voiceError = "";
        this.touch();
        this.scrollToPageBottom();
      } catch (error) {
        if (generation === this.generation)
          this.applicationError = error.message || "申请单已失效，请重新查询。";
      } finally {
        request.done();
        if (this.applicationRequest === request) this.applicationRequest = null;
        if (generation === this.generation) this.selectingApplication = false;
      }
    },
    applicationPageMessage() {
      const activeApplications = this.applications.filter(
        (item) => item.status === "有效",
      );
      if (this.applicationError) return `页面提示：${this.applicationError}`;
      if (!activeApplications.length)
        return "本人入院申请单页面未查询到有效申请单，请联系现场工作人员处理。";
      if (activeApplications.length > 1)
        return "本人入院申请单页面检测到多份有效申请单，暂时无法确定要办理哪一份，请联系现场工作人员处理。";

      const application = activeApplications[0];
      return [
        "本人入院申请单页面已查询到一份有效申请单：",
        `申请单号${application.id}，患者${
          maskName(String(application.patientName || "")) || "未提供"
        }，`,
        `入院科室${application.department || "未提供"}，计划入院时间${
          application.plannedAdmissionAt || "未提供"
        }，`,
        `开单医生${application.doctor || "未提供"}，住院类型${
          application.type || "未提供"
        }，`,
        `诊断${application.diagnosis || "未提供"}，病区${
          application.ward || "未提供"
        }，状态${application.status}。`,
        "请核对页面和以上信息，点击“确定申请单并继续”后进入资料填写。",
      ].join("");
    },
    announceApplicationPage() {
      const text = this.applicationPageMessage();
      this.appendConversationMessages(
        this.manualConversationMessages,
        this.applicationDialogueMessage(text),
      );
      this.speakAssistantReply(text);
    },
    applicationDialogueMessage(text) {
      const activeApplications = this.applications.filter(
        (item) => item.status === "有效",
      );
      const application =
        activeApplications.length === 1 && !this.applicationError
          ? activeApplications[0]
          : null;
      return {
        role: "assistant",
        text,
        ...(application
          ? {
              application: {
                id: application.id,
                patientName:
                  maskName(String(application.patientName || "")) || "未提供",
                department: application.department || "未提供",
                plannedAdmissionAt: application.plannedAdmissionAt || "未提供",
                doctor: application.doctor || "未提供",
                type: application.type || "未提供",
                diagnosis: application.diagnosis || "未提供",
                ward: application.ward || "未提供",
                status: application.status,
              },
            }
          : {}),
      };
    },
    editReviewStep(step) {
      if (this.submitting) return;
      this.step = step;
      this.page = "form";
      this.touch();
    },
    reviewValueLabel(key) {
      const value = this.fields[key];
      if (key === "name") return value ? maskName(value) : "未填写";
      if (key === "idNumber") return value ? maskId(value) : "未填写";
      if (key === "phone") return value ? maskPhone(value) : "未填写";
      if (key === "nativeRegion" || key === "residentRegion") {
        return this.candidateValueLabel(key, value);
      }
      return value || "未填写";
    },
    async persistConversation({
      turnId: requestedTurnId = "",
      utterance,
      response,
      action,
      modelName = "",
      fields = {},
      pendingProposal = null,
      showInConversation = true,
    }) {
      if (!this.sessionId || !this.identityToken || !utterance) return;
      const sessionId = this.sessionId;
      const identityToken = this.identityToken;
      const generation = this.generation;
      const turnId = requestedTurnId || `turn-${makeUuid()}`;
      let stored = false;
      const write = async () => {
        if (
          sessionId !== this.sessionId ||
          identityToken !== this.identityToken ||
          generation !== this.generation
        )
          return;
        const saved = await admissionApi.saveTurn(sessionId, {
          identityToken,
          expectedRevision: this.sessionRevision,
          turnId,
          previousTurnId: this.lastTurnId,
          utterance: utterance.slice(0, 2000),
          response: (response || "").slice(0, 4000),
          action,
          fields,
          pendingProposal,
        });
        if (
          sessionId !== this.sessionId ||
          identityToken !== this.identityToken ||
          generation !== this.generation
        )
          return;
        this.sessionRevision = saved.revision;
        this.lastTurnId = saved.lastTurnId;
        if (showInConversation) {
          this.appendConversationMessages(
            this.conversationMessages,
            { role: "patient", text: utterance.slice(0, 2000), action },
            {
              role: "assistant",
              text: (response || "").slice(0, 4000),
              ...(modelName ? { modelName } : {}),
            },
          );
          this.speakAssistantReply((response || "").slice(0, 4000));
        }
        this.initialPatientInfoRequestPending = false;
        stored = true;
      };
      this.conversationWrite = this.conversationWrite
        .then(write)
        .catch((error) => {
          if (
            this.page !== "home" &&
            sessionId === this.sessionId &&
            generation === this.generation
          ) {
            this.aiNotice =
              error.status === 409
                ? "会话已在其他窗口更新，请重新核对当前信息。"
                : error.status === 429
                ? "本次登记已达到20轮对话上限，您仍可直接修改表单并核对信息。"
                : "本轮对话未能保存，请保留转写并稍后重试。";
          }
        });
      await this.conversationWrite;
      return stored;
    },
    validatePageAdvance() {
      if (
        this.submitting ||
        this.aiThinking ||
        Object.keys(this.pendingCandidates).length
      )
        return false;
      this.touch();
      const fields = this.conversationFields;
      const keys = fields.map((field) => field.key);
      this.fieldErrors = validateFields(this.fields, keys);
      const firstError = fields.find((field) => this.fieldErrors[field.key]);
      if (firstError) {
        this.$nextTick(() => document.getElementById(firstError.key)?.focus());
        return false;
      }
      if (this.step === this.groups.length) {
        const errors = validateFields(this.fields);
        this.fieldErrors = errors;
        if (Object.keys(errors).length) {
          const firstGroup = this.groups.find((item) =>
            item.fields.some((field) => errors[field.key]),
          );
          this.step = firstGroup?.step || 1;
          this.$message.warning("请先补全必填信息。");
          return false;
        }
      }
      return true;
    },
    nextPage() {
      if (!this.validatePageAdvance()) return false;
      this.optionalFollowUpKey = "";
      this.optionalSkippedStep = 0;
      if (!this.conversationVisible && this.step < this.groups.length)
        this.step += 1;
      else {
        this.page = "review";
        this.markReviewedFields();
        this.aiNotice = "";
      }
      return true;
    },
    async skipOptionalFields(utterance) {
      const advance = this.conversationAdvance;
      const response = `好的，剩余选填项暂不填写。是否${advance}？`;
      const saved = await this.persistConversation({
        utterance,
        response,
        action: "manual_turn",
      });
      if (saved) {
        this.optionalFollowUpKey = "";
        this.optionalSkippedStep = this.step;
        this.aiNotice = response;
      }
    },
    onFieldChange(key, { deferPersistence = false } = {}) {
      this.optionalSkippedStep = 0;
      this.aiClarification = "";
      this.aiClarificationChoices = [];
      if (key === this.optionalFollowUpKey) this.optionalFollowUpKey = "";
      if (key) {
        this.$set(this.sources, key, "manual");
        this.$delete(this.pendingCandidates, key);
        this.$delete(this.fieldErrors, key);
        // 号码键盘只限长度不限格式；号码位数补齐时立即按合同校验，不等“下一步”。
        if (key === "phone" && this.fields.phone?.length === 11) {
          const phoneError = validateFields(this.fields, ["phone"]).phone;
          if (phoneError) this.$set(this.fieldErrors, "phone", phoneError);
        }
        if (this.candidateDialogKey === key) {
          this.candidateConfirmationRequestVersion += 1;
          this.candidateDialogKey =
            Object.keys(this.pendingCandidates)[0] || "";
        }
        if (this.sessionId) {
          this.$set(this.manualPendingFields, key, this.fields[key]);
          clearTimeout(this.manualPersistTimer);
          this.manualPersistTimer = deferPersistence
            ? null
            : setTimeout(this.flushManualChanges, 600);
        }
      }
      this.touch();
    },
    async selectConversationOption(value) {
      if (this.aiClarificationChoices.includes(value)) {
        this.aiClarificationChoices = [];
        this.transcript = value;
        await this.applyAi(value, this.generation);
        return;
      }
      const fallbackKey = this.fallbackChoiceKey;
      const supplementChoice =
        !fallbackKey &&
        this.emptyOptionalFields.length > 0 &&
        this.optionalSkippedStep !== this.step &&
        value === this.optionalSupplementChoice;
      // 明确跳过选填项或处理兜底选项时共用分页校验和保存路径。
      const advanceChoice =
        (Boolean(fallbackKey) || this.emptyOptionalFields.length > 0) &&
        ADVANCE_CHOICES.includes(value);
      const stayOnOptionalPage =
        this.emptyOptionalFields.length > 0 && value === "暂不继续";
      if (
        this.page !== "form" ||
        this.aiThinking ||
        this.recording ||
        this.recognizing ||
        this.savingConversationChoice ||
        (!advanceChoice &&
          !stayOnOptionalPage &&
          !supplementChoice &&
          !this.nextConversationChoices.includes(value))
      )
        return;
      const field =
        advanceChoice || supplementChoice
          ? null
          : fallbackKey
          ? this.groups
              .flatMap((group) => group.fields)
              .find((item) => item.key === fallbackKey)
          : this.nextConversationField;
      this.savingConversationChoice = true;
      try {
        await this.conversationWrite;
        if (!(await this.flushManualChanges())) return;
        if (
          this.page !== "form" ||
          this.fallbackChoiceKey !== fallbackKey ||
          (!advanceChoice &&
            !stayOnOptionalPage &&
            !supplementChoice &&
            !this.nextConversationChoices.includes(value))
        )
          return;
        if (supplementChoice) {
          const optionalField = this.emptyOptionalFields[0];
          if (!optionalField) return;
          const advance = this.conversationAdvance;
          const response = `请告诉我您的${optionalField.label}。您也可以一次补充其他选填内容；如需跳过，请说“${advance}”。`;
          this.transcript = value;
          const saved = await this.persistConversation({
            utterance: value,
            response,
            action: "manual_turn",
          });
          if (saved) {
            this.optionalFollowUpKey = optionalField.key;
            this.aiNotice = response;
          }
          return;
        }
        if (!field) {
          const advance = value !== "暂不继续";
          const response = advance
            ? this.conversationAdvance === "继续下一页"
              ? "好的，开始填写下一页。"
              : "好的，进入最终核对。"
            : "好的，您可以继续核对或补充本页内容。";
          this.transcript = value;
          this.fallbackChoiceKey = "";
          if (advance && !this.validatePageAdvance()) return;
          const saved = await this.persistConversation({
            utterance: value,
            response,
            action: "manual_turn",
          });
          if (saved && !advance) {
            this.optionalFollowUpKey = "";
            this.optionalSkippedStep = 0;
          }
          if (saved && advance && this.page === "form") {
            if (this.nextPage() && this.page === "form")
              this.aiNotice = response;
          } else if (saved) this.aiNotice = response;
          return;
        }
        if (
          this.page !== "form" ||
          (!advanceChoice &&
            !fallbackKey &&
            this.nextConversationField?.key !== field.key)
        )
          return;
        this.$set(this.fields, field.key, value);
        this.onFieldChange(field.key);
        this.transcript = value;
        // 先清兜底挂起态再链话术：nextConversationQuestion 在兜底未清时会返回空，
        // 让最后一步点选后的回复错误退化成 COMPLETE_REPLY。
        this.fallbackChoiceKey = "";
        // 场景 9/12/14/17：确认一项后按回复流程链到下一项的固定话术。
        const response = this.chainedFieldReply(field.key);
        this.aiNotice = response;
        await this.flushManualChanges({ utterance: value, response });
      } finally {
        this.savingConversationChoice = false;
      }
    },
    chainedFieldReply(filledKey) {
      const summary = `${this.fieldLabel(filledKey)}：${this.reviewValueLabel(
        filledKey,
      )}`;
      const next = this.conversationFields.find(
        (item) => item.required && !item.readonly && !this.fields[item.key],
      );
      if (!next)
        return `已记录${summary}。${
          this.nextConversationQuestion || COMPLETE_REPLY
        }`;
      const question = fieldQuestion(next);
      return `已记录${summary}。${question}`;
    },
    async submit(utterance) {
      if (
        this.submitting ||
        this.page !== "review" ||
        !this.identityToken ||
        !this.sessionId ||
        !this.activeApplication
      )
        return;
      if (Object.keys(this.pendingCandidates).length) {
        this.$message.warning("请先确认或拒绝待修改信息。");
        return;
      }
      this.fieldErrors = validateFields(this.fields);
      if (Object.keys(this.fieldErrors).length) {
        this.editReviewStep(
          this.groups.find((group) =>
            group.fields.some((field) => this.fieldErrors[field.key]),
          )?.step || 1,
        );
        this.aiNotice = "请先补全并核对登记信息，再确认提交。";
        return;
      }
      this.submitting = true;
      this.result = null;
      // 场景 20：提交中固定话术。
      this.aiNotice = "正在为您提交入院登记信息，请稍候。";
      this.idempotencyKey ||= `demo-${makeUuid()}`;
      const request = abortAfter(15000);
      try {
        await this.conversationWrite;
        if (!(await this.flushManualChanges())) return;
        if (
          typeof utterance === "string" &&
          !(await this.persistConversation({
            utterance,
            response: "正在为您提交入院登记信息，请稍候。",
            action: "manual_turn",
          }))
        )
          return;
        const review = await admissionApi.confirmReview(
          this.sessionId,
          {
            identityToken: this.identityToken,
            expectedRevision: this.sessionRevision,
            fields: this.fields,
          },
          request.signal,
        );
        this.sessionRevision = review.reviewRevision;
        this.result = await admissionApi.submit(
          {
            identityToken: this.identityToken,
            applicationId: this.activeApplication && this.activeApplication.id,
            sessionId: this.sessionId,
            reviewRevision: review.reviewRevision,
            idempotencyKey: this.idempotencyKey,
            mockScenario: this.mockScenario,
            fields: this.fields,
          },
          request.signal,
        );
      } catch (error) {
        if (error.status === 422) {
          this.fieldErrors = error.body?.detail?.errors || {};
          const firstGroup = this.groups.find((group) =>
            group.fields.some((field) => this.fieldErrors[field.key]),
          );
          this.page = "form";
          this.step = firstGroup?.step || 1;
          this.$message.warning("服务端校验未通过，请检查标出的字段。");
          this.submitting = false;
          return;
        }
        this.result = {
          status: error.status && error.status < 500 ? "failed" : "unknown",
          message:
            error.name === "AbortError"
              ? "请求超时，登记结果待确认。"
              : error.message,
        };
      } finally {
        request.done();
        this.submitting = false;
        if (this.result) {
          this.page = "result";
          this.transcript = "";
          this.aiNotice = "";
          if (["success", "already_registered"].includes(this.result.status)) {
            this.identityToken = "";
            this.sessionId = "";
            this.sessionRevision = 0;
            this.lastTurnId = null;
            this.fields = emptyFields();
            this.sources = {};
            this.applications = [];
            this.selectedApplicationId = "";
            this.activeApplication = null;
            this.conversationMessages = [];
            this.homeConversationMessages = [];
            this.manualConversationMessages = [];
            this.manualPendingFields = {};
            this.pendingCandidates = {};
            this.candidateDialogKey = "";
            this.idempotencyKey = "";
          }
        }
      }
    },
    async flushManualChanges({ utterance, response } = {}) {
      clearTimeout(this.manualPersistTimer);
      this.manualPersistTimer = null;
      const fields = { ...this.manualPendingFields };
      this.manualPendingFields = {};
      if (!Object.keys(fields).length) return true;
      const generation = this.generation;
      const saved = await this.persistConversation({
        utterance:
          utterance ||
          `手动修改 ${Object.keys(fields)
            .map((key) => this.fieldLabel(key))
            .join("、")}`,
        response: response || "已将修改保存到本次办理会话。",
        action: "manual_edit",
        fields,
        showInConversation: false,
      });
      if (!saved && generation === this.generation)
        this.manualPendingFields = { ...fields, ...this.manualPendingFields };
      return saved;
    },
    async checkResult() {
      if (
        this.checkingResult ||
        this.page !== "result" ||
        this.result?.status !== "unknown" ||
        !this.identityToken ||
        !this.idempotencyKey
      )
        return;
      this.checkingResult = true;
      const generation = this.generation;
      const request = abortAfter(5000);
      this.resultRequest = request;
      try {
        const result = await admissionApi.result(
          this.identityToken,
          this.idempotencyKey,
          request.signal,
        );
        if (generation !== this.generation || this.page !== "result") return;
        if (result.status !== "unknown") this.result = result;
        else this.$message.info("暂未查到确定结果，请联系现场工作人员。");
      } catch (error) {
        if (generation !== this.generation) return;
        this.$message.warning(
          error.name === "AbortError"
            ? "查询超时，请稍后重试。"
            : error.message || "暂时无法查询登记结果。",
        );
      } finally {
        request.done();
        if (this.resultRequest === request) this.resultRequest = null;
        if (generation === this.generation) this.checkingResult = false;
      }
    },
    finish() {
      this.reset();
    },
    retryReview() {
      this.idempotencyKey = "";
      this.page = "form";
      this.step = this.groups.length;
      this.touch();
    },
    cancelFlow() {
      if (this.submitting) return;
      this.cancelVisible = true;
    },
    reset() {
      if (this.submitting) return;
      this.historyCaptureEnabled = false;
      this.generation += 1;
      this.abortRequests();
      this.stopVoiceSession();
      this.stopAssistantSpeech();
      this.page = "home";
      this.step = 1;
      this.workflowHistory = [];
      this.$nextTick(() => {
        this.historyCaptureEnabled = true;
      });
      this.identityToken = "";
      this.verifying = false;
      this.selectingApplication = false;
      this.loadingApplications = false;
      this.checkingResult = false;
      this.savingConversationChoice = false;
      clearTimeout(this.manualPersistTimer);
      this.manualPersistTimer = null;
      this.manualPendingFields = {};
      this.sessionId = "";
      this.conversationVisible = false;
      this.dialogMessages = [];
      this.dialogSessionId = "";
      this.lastGuidedStage = "";
      this.autoSpeakAssistant = false;
      this.conversationMessages = [];
      this.processingConversation = false;
      this.homeConversationMessages = [];
      this.manualConversationMessages = [];
      this.sessionRevision = 0;
      this.lastTurnId = null;
      this.conversationWrite = Promise.resolve();
      this.applications = [];
      this.selectedApplicationId = "";
      this.activeApplication = null;
      this.applicationError = "";
      this.fields = emptyFields();
      this.sources = {};
      this.fieldErrors = {};
      this.transcript = "";
      this.aiNotice = "";
      this.voiceError = "";
      this.formError = "";
      this.result = null;
      this.idempotencyKey = "";
      this.pendingCandidates = {};
      this.candidateDialogKey = "";
      this.fallbackChoiceKey = "";
      this.optionalFollowUpKey = "";
      this.optionalSkippedStep = 0;
      this.candidateConfirmationRequestVersion += 1;
      this.recordingConfirmationContext = null;
      this.mockScenario = "success";
      this.identityScenario = "success";
      this.cancelVisible = false;
      this.continueSession();
      this.$nextTick(() => {
        const page = document.scrollingElement || document.documentElement;
        page.scrollTop = 0;
        const content = this.$el?.querySelector?.(".page-content");
        if (content) content.scrollTop = 0;
      });
    },
  },
};
</script>
