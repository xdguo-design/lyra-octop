<template>
  <div
    v-if="message.role === 'assistant'"
    class="conversation-message-row"
    :class="{
      'conversation-message-row--application': message.application,
      'conversation-message-row--patient-info': message.patientInfo,
    }"
  >
    <section
      v-if="message.application"
      class="application-message"
      aria-label="待确认的本人入院申请单"
    >
      <header class="application-message__header">
        <strong>本人入院申请单</strong>
        <span class="application-message__status">{{
          message.application.status
        }}</span>
      </header>
      <p>已查询到一份有效申请单，请核对以下信息</p>
      <dl>
        <div v-for="field in applicationFields" :key="field.label">
          <dt>{{ field.label }}</dt>
          <dd>{{ maskText(field.value) }}</dd>
        </div>
      </dl>
      <span class="application-message__action">待您确认后继续办理</span>
    </section>
    <div
      v-else
      class="conversation-message conversation-message--assistant"
      :class="{
        'conversation-message--patient-info': message.patientInfo,
        'conversation-message--titled': headerTitle,
      }"
    >
      <header v-if="headerTitle" class="conversation-message__header">
        <strong>{{ headerTitle }}</strong>
        <div v-if="message.patientInfo" class="conversation-message__header-actions">
          <span>必填（{{ requiredProgress.completed }}/{{ requiredProgress.total }}）</span>
          <button
            class="conversation-message__speaker"
            type="button"
            aria-label="播放此回复"
            :disabled="disabled"
            @click="$emit('speak', message.text)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 9v6h4l5 4V5L7 9H3z" />
              <path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11" />
            </svg>
          </button>
        </div>
      </header>
      <p class="conversation-message__body">
        <span v-if="message.modelName" class="conversation-message__model">
          模型名称：{{ message.modelName }}
        </span>
        <template v-for="(segment, index) in segments">
          <strong
            v-if="sectionHeadings.includes(segment)"
            :key="index"
            class="conversation-message__section-title"
            >{{ segment }}</strong
          >
          <strong
            v-else-if="fieldKeywords.includes(segment)"
            :key="index"
            class="conversation-message__field-label"
            >{{ segment }}</strong
          >
          <span v-else :key="index">{{ maskText(segment) }}</span>
        </template>
      </p>
    </div>
    <button
      v-if="!message.patientInfo"
      class="conversation-message__speaker"
      type="button"
      aria-label="播放此回复"
      :disabled="disabled"
      @click="$emit('speak', message.text)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9v6h4l5 4V5L7 9H3z" />
        <path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11" />
      </svg>
    </button>
  </div>
  <p v-else class="conversation-message conversation-message--patient">
    {{ maskText(message.text) }}
  </p>
</template>

<script>
import { maskText } from "../utils/mask.js";

export default {
  name: "ConversationMessage",
  props: {
    message: { type: Object, required: true },
    fieldKeywords: { type: Array, default: () => [] },
    requiredProgress: {
      type: Object,
      default: () => ({ completed: 0, total: 0 }),
    },
    disabled: { type: Boolean, default: false },
  },
  computed: {
    headerTitle() {
      if (this.message.patientInfo) return "患者信息填写";
      return this.message.title || (this.message.modelName ? "AI 解析" : "");
    },
    applicationFields() {
      const { application } = this.message;
      return [
        { label: "申请单号", value: application.id },
        { label: "患者", value: application.patientName },
        { label: "入院科室", value: application.department },
        { label: "计划入院时间", value: application.plannedAdmissionAt },
        { label: "开单医生", value: application.doctor },
        { label: "住院类型", value: application.type },
        { label: "诊断", value: application.diagnosis },
        { label: "病区", value: application.ward },
      ];
    },
    sectionHeadings() {
      return [
        "【已回填，请核对】",
        "【需要补充】",
        "【待确认】",
        "【需要您决定】",
        "【校验提示】",
        "【请选择】",
      ];
    },
    segments() {
      const keywords = [
        ...new Set([...this.fieldKeywords, ...this.sectionHeadings]),
      ]
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
      if (!keywords.length) return [String(this.message.text || "")];
      const escaped = keywords.map((keyword) =>
        keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      return String(this.message.text || "")
        .split(new RegExp(`(${escaped.join("|")})`, "g"))
        .filter(Boolean);
    },
  },
  methods: { maskText },
};
</script>
