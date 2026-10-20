<template>
  <main
    class="page-shell"
    :class="{ 'page-shell--home': page === 'home' }"
    @click="touch"
    @keydown="touch"
  >
    <header class="topbar">
      <div class="brand-block">
        <strong class="brand-name">Neusoft</strong>
        <span class="brand-subtitle">东软智慧医疗 · 智慧医院 AI 助手</span>
      </div>
      <span class="screen-time">{{ screenTime }}</span>
      <button class="help-button" type="button" @click="selfModeHint">
        <i class="el-icon-question"></i><span>帮助</span>
      </button>
    </header>

    <div class="page-content">
      <section v-if="page === 'home'" class="mascot-stage" aria-live="polite">
        <div class="mascot-shortcut">挂号</div>
        <img class="mascot-image" :src="nurseBot" alt="智能导诊助手" />
        <div class="mascot-shortcut">打印</div>
        <div class="assistant-greeting">您好，我是您的智能导诊助手</div>
      </section>

      <ConversationCard
        v-if="page === 'home'"
        :shortcuts="shortcuts"
        @select="handleShortcut"
      />

      <section
        v-if="entered"
        class="admission-scene"
        :class="{ 'admission-scene--identity': page === 'identity' }"
      >
        <div v-if="page === 'identity'" class="entered-label">
          您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。
        </div>
        <IdentityCard
          v-if="page === 'identity'"
          :verifying="verifying"
          :remaining-seconds="sessionRemaining"
          :form-error="formError"
          @verify="verifyIdentity"
          @close="cancelFlow"
          @speak="speak(voiceHint)"
        />
        <ApplicationList
          v-else-if="page === 'applications'"
          :items="applications"
          :selected-id="selectedApplicationId"
          :loading="loadingApplications"
          :selecting="selectingApplication"
          :error="applicationError"
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
          :remaining-seconds="sessionRemaining"
          :groups="groups"
          :fields="fields"
          :field-errors="fieldErrors"
          :sources="sources"
          :submitting="submitting"
          :region-options="regionOptions"
          @change="onFieldChange"
          @next="nextPage"
          @back="onFormBack"
        />
        <ReviewPanel
          v-else-if="page === 'review' && activeApplication"
          :application="activeApplication"
          :groups="groups"
          :fields="fields"
          :value-label="reviewValueLabel"
          :submitting="submitting"
          @edit="editReviewStep"
          @back="editReviewStep(groups.length)"
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
    </div>

    <VoiceStage
      v-if="page !== 'result' || (result && result.status === 'unknown')"
      :disabled="submitting"
      :show-self-mode="page === 'home'"
      :show-feedback="page !== 'home' && page !== 'form'"
      :transcript="transcript"
      :ai-thinking="aiThinking"
      :ai-notice="aiNotice"
      :voice-error="voiceError"
      :recording="recording"
      :recognizing="recognizing"
      :starting-voice="startingVoice"
      :sound-detected="soundDetected"
      :volume-level="volumeLevel"
      @toggle-record="
        page === 'home'
          ? openHomeVoiceInput()
          : recording
          ? stopRecording()
          : startRecording()
      "
      @manual-input="openManualInput"
      @self-mode="selfModeHint"
    />

    <ConversationDialog
      :home="page !== 'form'"
      :visible="conversationVisible"
      :initial-input-mode="conversationInputMode"
      :question="page === 'form' ? nextConversationQuestion : ''"
      :choices="page === 'form' ? nextConversationChoices : []"
      :saving="savingConversationChoice || submitting || processingConversation"
      :messages="
        page === 'home'
          ? homeConversationMessages
          : page === 'form' || page === 'review'
          ? conversationMessages
          : manualConversationMessages
      "
      :thinking="aiThinking"
      :recording="recording"
      :recognizing="recognizing"
      :starting-voice="startingVoice"
      :transcript="transcript"
      :ai-notice="aiNotice"
      :voice-error="voiceError"
      @close="conversationVisible = false"
      @send="submitConversationInput"
      @select-option="selectConversationOption"
      @toggle-record="recording ? stopRecording() : startRecording()"
    />

    <BottomBar
      :patient="patient"
      :page="page"
      :disabled="submitting"
      @back="goBack"
      @home="reset"
      @logout="cancelFlow"
      @change="changeLogin"
    />
    <div class="serial-line">{{ demoUser.serial }}　{{ demoUser.version }}</div>
    <audio ref="audioPlayer" hidden @ended="releaseAudio"></audio>

    <el-dialog
      title="是否修改这项信息？"
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
        :disabled="aiThinking || recognizing || startingVoice"
        @click="recording ? stopRecording() : startRecording()"
      >
        <i
          :class="recording ? 'el-icon-video-pause' : 'el-icon-microphone'"
        ></i>
        {{ recording ? "结束录音" : "语音确认" }}
      </el-button>
      <p v-if="recording || recognizing" class="candidate-confirmation-status">
        {{ recording ? "正在录音，请说完后点击结束" : "正在识别语音…" }}
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
          >保留当前内容</el-button
        >
        <el-button
          type="primary"
          :disabled="startingVoice || recording || recognizing"
          @click="resolveCandidate(true)"
          >修改为识别内容</el-button
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
import nurseBot from "./assets/nurse-bot.png";
import AdmissionForm from "./components/AdmissionForm.vue";
import ApplicationList from "./components/ApplicationList.vue";
import BottomBar from "./components/BottomBar.vue";
import ConversationCard from "./components/ConversationCard.vue";
import ConversationDialog from "./components/ConversationDialog.vue";
import IdentityCard from "./components/IdentityCard.vue";
import KeypadDialog from "./components/KeypadDialog.vue";
import ResultPanel from "./components/ResultPanel.vue";
import ReviewPanel from "./components/ReviewPanel.vue";
import VoiceStage from "./components/VoiceStage.vue";
import { admissionApi } from "./api/admission.js";
import voiceFlow from "./logic/voiceFlow.js";
import {
  COMPLETE_REPLY,
  DEMO_USER,
  FIELD_GROUPS,
  FIELD_REASK,
  SHORTCUTS,
  VOICE_HINT,
  buildRegionOptions,
  emptyFields,
  enumFieldOptions,
  fieldQuestion,
} from "./model/formConfig.js";
import { regions, validateFields } from "./model/validation.js";
import { abortAfter } from "./utils/async.js";
import { maskName, maskId, maskPhone, maskText } from "./utils/mask.js";

// 兜底选项挂起时仍允许口头触发的推进指令（与 nextConversationChoices 的推进项一致）。
const ADVANCE_CHOICES = ["继续下一页", "进入核对页", "暂不继续"];

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
    VoiceStage,
  },
  mixins: [voiceFlow],
  data() {
    return {
      nurseBot,
      screenTime: "",
      clockTimer: null,
      voiceHint: VOICE_HINT,
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
      conversationMessages: [],
      homeConversationMessages: [],
      manualConversationMessages: [],
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
      demoUser: DEMO_USER,
      regionOptions: buildRegionOptions(regions),
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
      reviewReentry: false,
    };
  },
  computed: {
    entered() {
      return this.page !== "home";
    },
    patient() {
      return {
        name: this.fields.name ? maskName(this.fields.name) : "",
        phone: maskPhone(this.fields.phone),
      };
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
    nextConversationField() {
      return (this.groups[this.step - 1]?.fields || []).find(
        (item) => item.required && !item.readonly && !this.fields[item.key],
      );
    },
    nextConversationQuestion() {
      // 兜底选项挂起时 aiNotice 已说明「请直接选择某字段」，此时再追问必填项
      // 会和下方那组选项对不上（问婚姻、选项却是职业），所以不再追问。
      if (this.fallbackChoiceKey) return "";
      const field = this.nextConversationField;
      if (!field) {
        return this.step < this.groups.length
          ? "本页必填信息已填写完整，是否继续填写下一页？"
          : COMPLETE_REPLY;
      }
      return this.aiNotice === FIELD_REASK[field.key]
        ? ""
        : fieldQuestion(field);
    },
    nextConversationChoices() {
      if (this.candidateDialogKey) return [];
      if (this.fallbackChoiceKey)
        return enumFieldOptions(this.fallbackChoiceKey);
      if (!this.nextConversationField) {
        return [
          this.step < this.groups.length ? "继续下一页" : "进入核对页",
          "暂不继续",
        ];
      }
      return enumFieldOptions(this.nextConversationField.key);
    },
  },
  mounted() {
    this.updateScreenTime();
    this.clockTimer = setInterval(this.updateScreenTime, 30000);
  },
  beforeDestroy() {
    clearInterval(this.clockTimer);
  },
  methods: {
    maskText,
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
      this.conversationVisible = false;
      this.manualConversationMessages = [];
      this.formError = "";
      this.transcript = "";
      this.aiNotice = "";
      this.voiceError = "";
      this.touch();
      this.$nextTick(() => {
        this.$el.querySelector(".page-content").scrollTop = 0;
      });
      this.speak(VOICE_HINT);
    },
    handleShortcut(index) {
      if (this.page !== "home") return;
      this.aiRequest?.abort();
      this.candidateRequestVersion += 1;
      this.aiRequest = null;
      this.aiThinking = false;
      this.transcript = this.shortcuts[index];
      this.voiceError = "";
      this.conversationInputMode = "text";
      this.conversationVisible = true;
      this.homeConversationMessages.push({
        role: "patient",
        text: this.transcript,
      });
      this.handleHomeIntent(
        index === this.shortcuts.length - 1 ? "begin_admission" : "unsupported",
      );
      if (this.page === "home" && this.aiNotice) {
        this.homeConversationMessages.push({
          role: "assistant",
          text: this.aiNotice,
        });
      }
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
      this.conversationInputMode = "text";
      this.conversationVisible = true;
    },
    openHomeVoiceInput() {
      this.conversationInputMode = "voice";
      this.conversationVisible = true;
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
        this.transcript = utterance;
        this.voiceError = "";
        this.touch();
        const answer = utterance.replace(/[\s，。！？、,.!?；;：:]/g, "");
        if (this.candidateDialogKey) {
          this.aiNotice = "请先在修改确认框中选择，或使用框内麦克风确认。";
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
          if (answer.includes("提交")) {
            await this.replyToConversation(
              utterance,
              "请先补全资料并进入信息核对页，核对后再确认提交。",
            );
            return;
          }
          if (
            !this.nextConversationField &&
            this.nextConversationChoices.length
          ) {
            const affirmative = [
              "继续",
              "继续下一页",
              "下一页",
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
            ? (this.groups[this.step - 1]?.fields || [])
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
              ? "已确认您的身份，请先选择并确认本人的有效入院申请单。"
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
        this.manualConversationMessages.push(
          { role: "patient", text: utterance },
          { role: "assistant", text: response },
        );
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
      this.$message.info("当前为自助模式演示。");
    },
    candidateValueLabel(key, value) {
      if (!Array.isArray(value)) return String(value || "（未填写）");
      let options = this.regionOptions;
      const labels = [];
      for (const code of value) {
        const region = options.find((item) => item.value === code);
        if (!region) return "地址候选无法识别";
        labels.push(region.label);
        options = region.children || [];
      }
      return labels.length ? labels.join(" / ") : "（未填写）";
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
      await this.persistConversation({
        utterance: accept
          ? `确认修改${this.fieldLabel(key)}`
          : `保留${this.fieldLabel(key)}原信息`,
        response: accept ? "已确认并替换该项信息。" : "已保留原有信息。",
        action: accept ? "candidate_accept" : "candidate_reject",
        fields: accept ? { [key]: proposedValue } : {},
        pendingProposal: {
          field: key,
          currentValue,
          proposedValue,
          decision: accept ? "accepted" : "rejected",
        },
      });
      this.touch();
    },
    changeLogin() {
      this.$message.info("演示环境暂不支持变更登录信息。");
    },
    goBack() {
      if (this.submitting) return;
      if (this.page === "form" && this.step > 1) this.step -= 1;
      else if (this.page === "applications") this.page = "identity";
      else if (this.page === "review") {
        this.page = "form";
        this.step = this.groups.length;
        this.reviewReentry = true;
      } else if (this.page !== "home") this.cancelFlow();
      else this.$message.info("已经是首页。");
      this.touch();
    },
    onFormBack() {
      if (this.submitting) return;
      if (this.step > 1) this.step -= 1;
      else this.cancelFlow();
      this.touch();
    },
    async verifyIdentity() {
      if (this.verifying) return;
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
        this.applicationError = "";
        this.touch();
      } catch (error) {
        if (generation !== this.generation) return;
        this.applicationError =
          error.message || "查询本人入院申请单失败，请重试。";
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
          { role: "patient", text: turn.utterance },
          { role: "assistant", text: turn.response },
        ]);
        if (!this.conversationMessages.length) {
          // 场景 7：身份认证成功后的开场话术（12 号文档回复流程）。
          this.conversationMessages.push({
            role: "assistant",
            text: "已确认您的身份信息。接下来请补充入院登记所需资料。",
          });
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
        this.page = "form";
        this.step = 1;
        this.aiNotice = "";
        this.transcript = "";
        this.voiceError = "";
        this.touch();
      } catch (error) {
        if (generation === this.generation)
          this.applicationError = error.message || "申请单已失效，请重新查询。";
      } finally {
        request.done();
        if (this.applicationRequest === request) this.applicationRequest = null;
        if (generation === this.generation) this.selectingApplication = false;
      }
    },
    editReviewStep(step) {
      if (this.submitting) return;
      this.step = step;
      this.page = "form";
      this.reviewReentry = true;
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
      utterance,
      response,
      action,
      fields = {},
      pendingProposal = null,
    }) {
      if (!this.sessionId || !this.identityToken || !utterance) return;
      const sessionId = this.sessionId;
      const identityToken = this.identityToken;
      const generation = this.generation;
      const turnId = `turn-${crypto.randomUUID()}`;
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
        this.conversationMessages.push(
          { role: "patient", text: utterance.slice(0, 2000) },
          { role: "assistant", text: (response || "").slice(0, 4000) },
        );
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
                : "本轮对话未能保存，请保留转写并稍后重试。";
          }
        });
      await this.conversationWrite;
      return stored;
    },
    nextPage() {
      if (
        this.submitting ||
        this.aiThinking ||
        Object.keys(this.pendingCandidates).length
      )
        return;
      this.touch();
      const group = this.groups[this.step - 1];
      const keys = group.fields.map((field) => field.key);
      this.fieldErrors = validateFields(this.fields, keys);
      const firstError = group.fields.find(
        (field) => this.fieldErrors[field.key],
      );
      if (firstError) {
        this.$nextTick(() => document.getElementById(firstError.key)?.focus());
        return;
      }
      if (this.step < this.groups.length) this.step += 1;
      else {
        const errors = validateFields(this.fields);
        this.fieldErrors = errors;
        if (Object.keys(errors).length) {
          const firstGroup = this.groups.find((item) =>
            item.fields.some((field) => errors[field.key]),
          );
          this.step = firstGroup?.step || 1;
          this.$message.warning("请先补全必填信息。");
          return;
        }
        this.page = "review";
        this.markReviewedFields();
        // 场景 19/21：首次进入核对展示确认提示，修改后再次进入提示已更新。
        this.aiNotice = this.reviewReentry
          ? "已为您更新相关信息，请再次确认。"
          : "以下为您的入院登记信息，请确认是否正确。";
        this.reviewReentry = false;
      }
    },
    onFieldChange(key) {
      if (key) {
        this.$set(this.sources, key, "manual");
        this.$delete(this.pendingCandidates, key);
        this.$delete(this.fieldErrors, key);
        if (this.candidateDialogKey === key) {
          this.candidateConfirmationRequestVersion += 1;
          this.candidateDialogKey =
            Object.keys(this.pendingCandidates)[0] || "";
        }
        if (this.sessionId) {
          this.$set(this.manualPendingFields, key, this.fields[key]);
          clearTimeout(this.manualPersistTimer);
          this.manualPersistTimer = setTimeout(this.flushManualChanges, 600);
        }
      }
      this.touch();
    },
    async selectConversationOption(value) {
      const fallbackKey = this.fallbackChoiceKey;
      // 兜底选项挂起时仍放行“继续下一页/进入核对页/暂不继续”，避免患者被选项卡住。
      const advanceChoice =
        Boolean(fallbackKey) && ADVANCE_CHOICES.includes(value);
      if (
        this.page !== "form" ||
        this.aiThinking ||
        this.recording ||
        this.recognizing ||
        this.savingConversationChoice ||
        (!advanceChoice && !this.nextConversationChoices.includes(value))
      )
        return;
      const field = advanceChoice
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
          (!advanceChoice && !this.nextConversationChoices.includes(value))
        )
          return;
        if (!field) {
          const advance = value !== "暂不继续";
          const response = advance
            ? this.step < this.groups.length
              ? "好的，开始填写下一页。"
              : "好的，进入最终核对。"
            : "好的，您可以继续核对或补充本页内容。";
          this.transcript = value;
          this.aiNotice = response;
          this.fallbackChoiceKey = "";
          const saved = await this.persistConversation({
            utterance: value,
            response,
            action: "manual_turn",
          });
          if (saved && advance && this.page === "form") this.nextPage();
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
        // 场景 9/12/14/17：确认一项后按回复流程链到下一项的固定话术。
        const response = this.chainedFieldReply(field.key);
        this.aiNotice = response;
        this.fallbackChoiceKey = "";
        await this.flushManualChanges({ utterance: value, response });
      } finally {
        this.savingConversationChoice = false;
      }
    },
    chainedFieldReply(filledKey) {
      const next = (this.groups[this.step - 1]?.fields || []).find(
        (item) => item.required && !item.readonly && !this.fields[item.key],
      );
      if (!next) return COMPLETE_REPLY;
      const question = fieldQuestion(next);
      return filledKey === "marriage" ? `好的，${question}` : question;
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
      this.idempotencyKey ||= `demo-${crypto.randomUUID()}`;
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
          this.conversationVisible = false;
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
      this.generation += 1;
      this.abortRequests();
      this.stopVoiceSession();
      this.releaseAudio();
      this.page = "home";
      this.step = 1;
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
      this.reviewReentry = false;
      this.candidateConfirmationRequestVersion += 1;
      this.recordingConfirmationContext = null;
      this.mockScenario = "success";
      this.identityScenario = "success";
      this.cancelVisible = false;
      this.continueSession();
      this.$nextTick(() => {
        this.$el.querySelector(".page-content").scrollTop = 0;
      });
    },
  },
};
</script>
