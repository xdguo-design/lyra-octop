<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createAgentFallback,
  PatientAppointmentAssistant,
} from "./assistant.mjs";
import { createPatientAppointmentApi } from "./ehrAppointmentApi.mjs";

const api = createPatientAppointmentApi({
  baseUrl: import.meta.env.VITE_EHR_API_BASE_URL,
});
const assistant = new PatientAppointmentAssistant({
  agentFallback: createAgentFallback({
    endpoint: import.meta.env.VITE_PATIENT_AGENT_URL,
  }),
});

const dates = Array.from({ length: 7 }, (_, index) => {
  const date = new Date();
  date.setDate(date.getDate() + index + 1);
  return date;
});
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
const dateLabel = (date) =>
  `${date.getMonth() + 1}月${date.getDate()}日 ${
    "日一二三四五六"[date.getDay()]
  }`;

const page = ref("home");
const slots = ref([]);
const appointments = ref([]);
const selectedDepartment = ref("");
const selectedDoctor = ref("");
const selectedDate = ref(dateKey(dates[0]));
const selectedSlotId = ref("");
const loading = ref(false);
const saving = ref(false);
const apiError = ref("");
const modal = ref(null);
const bookingIdempotencyKey = ref("");
const bookingKeySlotId = ref("");
const toast = ref("");
const assistantOpen = ref(false);
const assistantInput = ref("");
const assistantBusy = ref(false);
const assistantMessages = ref([
  {
    role: "assistant",
    text: "您好，我可以帮您了解预约流程和门诊信息，也可以带您去选择号源。",
    source: "welcome",
  },
]);
let toastTimer;

const departments = computed(() => {
  const byCode = new Map(
    slots.value.map((slot) => [slot.department.code, slot.department]),
  );
  return [...byCode.values()];
});
const doctorOptions = computed(() => {
  const byCode = new Map(
    slots.value
      .filter(
        (slot) =>
          !selectedDepartment.value ||
          slot.department.code === selectedDepartment.value,
      )
      .map((slot) => [slot.clinician.code, slot.clinician]),
  );
  return [...byCode.values()];
});
const visibleSlots = computed(() =>
  slots.value
    .filter(
      (slot) =>
        slot.visitDate === selectedDate.value &&
        (!selectedDepartment.value ||
          slot.department.code === selectedDepartment.value) &&
        (!selectedDoctor.value || slot.clinician.code === selectedDoctor.value),
    )
    .sort((left, right) =>
      `${left.period}${left.clinician.name}`.localeCompare(
        `${right.period}${right.clinician.name}`,
        "zh-CN",
      ),
    ),
);
const selectedSlot = computed(() =>
  visibleSlots.value.find((slot) => slot.id === selectedSlotId.value),
);
const upcoming = computed(() =>
  appointments.value.find((appointment) => appointment.status === "booked"),
);
const apiStatus = computed(() =>
  apiError.value
    ? "接口未连接"
    : loading.value
    ? "正在连接 EHR"
    : "EHR 应用接口",
);

function dateText(value) {
  const date = new Date(`${value}T12:00:00`);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function periodText(period) {
  if (period === "AM") return "上午时段";
  if (period === "PM") return "下午时段";
  return period;
}

function statusText(status) {
  return (
    {
      booked: "已预约",
      "in-progress": "就诊中",
      completed: "已完成",
      cancelled: "已取消",
    }[status] || "状态未知"
  );
}

async function refreshData() {
  loading.value = true;
  apiError.value = "";
  try {
    const [slotRows, appointmentRows] = await Promise.all([
      api.slots({
        fromDate: dateKey(dates[0]),
        toDate: dateKey(dates[dates.length - 1]),
      }),
      api.appointments(),
    ]);
    slots.value = slotRows;
    appointments.value = appointmentRows;
    if (
      !departments.value.some((item) => item.code === selectedDepartment.value)
    ) {
      selectedDepartment.value = departments.value[0]?.code || "";
    }
    if (
      !doctorOptions.value.some((item) => item.code === selectedDoctor.value)
    ) {
      selectedDoctor.value = doctorOptions.value[0]?.code || "";
    }
    if (!visibleSlots.value.some((slot) => slot.id === selectedSlotId.value)) {
      selectedSlotId.value = "";
    }
  } catch (error) {
    slots.value = [];
    appointments.value = [];
    selectedSlotId.value = "";
    apiError.value = error.message || "EHR 患者预约接口暂不可用";
  } finally {
    loading.value = false;
  }
}

function chooseDepartment() {
  selectedDoctor.value = doctorOptions.value[0]?.code || "";
  selectedSlotId.value = "";
}

watch([selectedDate, selectedDepartment, selectedDoctor], () => {
  selectedSlotId.value = "";
});

function notify(message) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2800);
}

function showReview() {
  if (!selectedSlot.value || selectedSlot.value.state !== "available") return;
  if (bookingKeySlotId.value !== selectedSlot.value.id) {
    bookingKeySlotId.value = selectedSlot.value.id;
    bookingIdempotencyKey.value = crypto.randomUUID();
  }
  modal.value = { type: "review" };
}

async function confirmBooking() {
  if (!selectedSlot.value || saving.value) return;
  saving.value = true;
  try {
    const appointment = await api.book({
      slotId: selectedSlot.value.id,
      idempotencyKey: bookingIdempotencyKey.value,
    });
    modal.value = null;
    bookingIdempotencyKey.value = "";
    bookingKeySlotId.value = "";
    page.value = "appointments";
    notify(`预约已提交，编号 ${appointment.id}`);
    await refreshData();
  } catch (error) {
    if (error.status === 409) {
      bookingIdempotencyKey.value = "";
      bookingKeySlotId.value = "";
      await refreshData();
    }
    notify(error.message || "预约未完成，请刷新号源后重试");
  } finally {
    saving.value = false;
  }
}

async function confirmCancellation() {
  if (!modal.value?.appointment || saving.value) return;
  saving.value = true;
  try {
    const result = await api.cancel(modal.value.appointment.id);
    modal.value = null;
    notify(`预约状态：${statusText(result.status)}`);
    await refreshData();
  } catch (error) {
    notify(error.message || "取消未完成，请刷新后重试");
  } finally {
    saving.value = false;
  }
}

async function sendAssistantMessage(value = assistantInput.value) {
  const message = String(value).trim();
  if (!message || assistantBusy.value) return;
  assistantInput.value = "";
  assistantMessages.value.push({ role: "user", text: message });
  assistantBusy.value = true;
  try {
    const result = await assistant.reply(message);
    assistantMessages.value.push({ role: "assistant", ...result });
  } finally {
    assistantBusy.value = false;
  }
}

function runAssistantAction(action) {
  if (action === "booking" || action === "appointments") {
    page.value = action;
    assistantOpen.value = false;
  }
}

function assistantSourceLabel(source) {
  return (
    {
      cache: "缓存",
      faq: "常见问题",
      rule: "规则",
      agent: "AI 服务",
      clarify: "需要补充信息",
      unavailable: "AI 服务暂不可用",
    }[source] || ""
  );
}

onMounted(refreshData);
onBeforeUnmount(() => window.clearTimeout(toastTimer));
</script>

<template>
  <main class="phone-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">E</span>门诊患者服务</div>
      <span
        class="demo-chip"
        :class="{ 'api-connected': !apiError && !loading }"
        >{{ apiStatus }}</span
      >
    </header>

    <div v-if="page === 'home'" class="content">
      <div class="eyebrow">PATIENT SERVICE · EHR</div>
      <h1>安心预约，<br />就诊安排更清楚</h1>
      <p class="lead">号源与预约记录通过 EHR 应用接口实时读取和提交。</p>
      <section class="hero">
        <small>患者端 · 门诊预约</small>
        <strong>选择适合的科室与时段</strong>
        <p>提交时由 EHR 再次核验号源，预约状态以服务端返回为准。</p>
      </section>
      <div v-if="apiError" class="api-notice" role="status">
        <strong>EHR 患者预约接口暂不可用</strong>
        <p>{{ apiError }}</p>
        <button class="text-link" type="button" @click="refreshData">
          重新连接
        </button>
      </div>
      <div class="section-title">
        快捷服务 <span class="eyebrow">APPOINTMENT</span>
      </div>
      <button class="card appointment-card shortcut" @click="page = 'booking'">
        <span class="avatar">＋</span>
        <span class="card-copy"
          ><strong>预约挂号</strong>
          <p>查看 EHR 中可预约的科室、医生和时段</p></span
        >
        <span class="text-link">开始 →</span>
      </button>
      <div class="section-title">
        {{ upcoming ? "即将就诊" : "就诊安排" }}
        <button class="text-link" @click="page = 'appointments'">
          全部预约 →
        </button>
      </div>
      <div v-if="upcoming" class="card appointment-card">
        <span class="avatar">{{ upcoming.clinician.name[0] }}</span>
        <span class="card-copy">
          <strong
            >{{ upcoming.department.name }} ·
            {{ upcoming.clinician.name }}医生</strong
          >
          <p>
            {{ dateText(upcoming.visitDate) }} {{ periodText(upcoming.period) }}
          </p>
          <p>就诊人：本人</p>
        </span>
        <span class="status">{{ statusText(upcoming.status) }}</span>
      </div>
      <div v-else class="card empty">
        {{ loading ? "正在读取 EHR 预约记录…" : "暂无预约记录"
        }}<br />预约记录由 EHR 按当前患者会话返回。
      </div>
      <div class="notice">
        本页面不保存患者或预约数据。预约和取消操作直接提交到 EHR，患者身份由 EHR
        会话确认。
      </div>
    </div>

    <div v-else-if="page === 'booking'" class="content">
      <div class="eyebrow">BOOK AN APPOINTMENT</div>
      <h1>预约挂号</h1>
      <p class="lead">可预约时段来自 EHR；提交前会再次核验余号。</p>
      <div v-if="apiError" class="api-notice" role="status">
        <strong>EHR 患者预约接口暂不可用</strong>
        <p>{{ apiError }}</p>
        <button
          class="text-link"
          type="button"
          :disabled="loading"
          @click="refreshData"
        >
          重新连接
        </button>
      </div>
      <div class="field">
        <label for="department">选择科室</label>
        <div class="select-wrap">
          <select
            id="department"
            v-model="selectedDepartment"
            @change="chooseDepartment"
            :disabled="loading || !departments.length"
          >
            <option value="" disabled>请选择科室</option>
            <option
              v-for="item in departments"
              :key="item.code"
              :value="item.code"
            >
              {{ item.name }}
            </option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="doctor">接诊医生</label>
        <div class="select-wrap doctor-select">
          <select
            id="doctor"
            v-model="selectedDoctor"
            :disabled="loading || !doctorOptions.length"
          >
            <option value="" disabled>请选择医生</option>
            <option
              v-for="item in doctorOptions"
              :key="item.code"
              :value="item.code"
            >
              {{ item.name }}
            </option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>选择就诊日期</label>
        <div class="choice-grid">
          <button
            v-for="date in dates"
            :key="dateKey(date)"
            class="choice"
            :class="{ active: dateKey(date) === selectedDate }"
            @click="selectedDate = dateKey(date)"
          >
            {{ dateLabel(date) }}
          </button>
        </div>
      </div>
      <div class="field">
        <label
          >可预约时段 <span class="field-hint">· 余号由 EHR 返回</span></label
        >
        <div v-if="visibleSlots.length" class="choice-grid">
          <button
            v-for="slot in visibleSlots"
            :key="slot.id"
            class="choice"
            :class="{ active: slot.id === selectedSlotId }"
            :disabled="slot.state !== 'available'"
            @click="selectedSlotId = slot.id"
          >
            {{ periodText(slot.period) }}<br /><small>{{
              slot.state === "available"
                ? `余 ${slot.remaining} 号`
                : "暂无号源"
            }}</small>
          </button>
        </div>
        <div v-else class="card empty">
          {{
            apiError
              ? "等待 EHR 预约接口可用"
              : loading
              ? "正在查询号源…"
              : "该日期暂无可预约时段"
          }}
        </div>
      </div>
      <div class="field">
        <label>就诊人</label>
        <div class="card appointment-card">
          <span class="avatar">本人</span>
          <span class="card-copy"
            ><strong>当前登录患者</strong>
            <p>身份从 EHR 患者会话读取，不在页面输入患者编号。</p></span
          >
          <span class="status">EHR</span>
        </div>
      </div>
      <button
        class="button full"
        :disabled="!selectedSlot || saving || Boolean(apiError)"
        @click="showReview"
      >
        查看预约信息
      </button>
      <div class="notice">
        EHR 当前号源单位为医生 + 日期 +
        上午/下午半日时段；页面不虚构具体分钟号源。
      </div>
    </div>

    <div v-else class="content">
      <div class="eyebrow">MY VISITS</div>
      <h1>我的预约</h1>
      <p class="lead">记录由 EHR 根据当前患者会话返回。</p>
      <div class="section-title">
        预约记录 <span class="eyebrow">{{ appointments.length }} 条</span>
        <button
          class="text-link"
          type="button"
          :disabled="loading"
          @click="refreshData"
        >
          刷新
        </button>
      </div>
      <article
        v-for="appointment in appointments"
        :key="appointment.id"
        class="card booking-record"
      >
        <div class="appointment-card">
          <span class="avatar">{{ appointment.clinician.name[0] }}</span>
          <span class="card-copy">
            <strong
              >{{ appointment.department.name }} ·
              {{ appointment.clinician.name }}医生</strong
            >
            <p>
              {{ dateText(appointment.visitDate) }}
              {{ periodText(appointment.period) }}
            </p>
            <p>就诊人：本人</p>
          </span>
          <span
            class="status"
            :class="{ cancelled: appointment.status === 'cancelled' }"
            >{{ statusText(appointment.status) }}</span
          >
        </div>
        <div class="notice record-detail">预约编号：{{ appointment.id }}</div>
        <button
          v-if="appointment.status === 'booked'"
          class="button danger full"
          @click="modal = { type: 'cancel', appointment }"
        >
          取消预约
        </button>
      </article>
      <div v-if="!appointments.length" class="card empty">
        {{ loading ? "正在读取 EHR 预约记录…" : "暂无预约记录"
        }}<br />如接口不可用，请先确认 EHR 患者会话和患者预约接口。
      </div>
      <button class="button soft full" @click="page = 'booking'">
        继续预约
      </button>
      <div v-if="apiError" class="api-notice" role="status">
        <strong>EHR 患者预约接口暂不可用</strong>
        <p>{{ apiError }}</p>
      </div>
    </div>

    <nav class="tabbar" aria-label="主导航">
      <button
        class="tab"
        :class="{ active: page === 'home' }"
        @click="page = 'home'"
      >
        <span>⌂</span>首页
      </button>
      <button
        class="tab"
        :class="{ active: page === 'booking' }"
        @click="page = 'booking'"
      >
        <span>＋</span>预约
      </button>
      <button
        class="tab"
        :class="{ active: page === 'appointments' }"
        @click="page = 'appointments'"
      >
        <span>▤</span>我的预约
      </button>
    </nav>

    <button
      v-if="!assistantOpen"
      class="assistant-launch"
      type="button"
      aria-label="打开预约助手"
      @click="assistantOpen = true"
    >
      <span aria-hidden="true">✦</span>预约助手
    </button>

    <section
      v-if="assistantOpen"
      class="assistant-panel"
      aria-label="患者预约助手"
    >
      <header class="assistant-header">
        <div>
          <strong>患者预约助手</strong
          ><small>常见问题本地处理，复杂问题转 HIS AI 服务</small>
        </div>
        <button
          class="assistant-close"
          type="button"
          aria-label="关闭预约助手"
          @click="assistantOpen = false"
        >
          ×
        </button>
      </header>
      <div class="assistant-messages" aria-live="polite">
        <article
          v-for="(message, index) in assistantMessages"
          :key="index"
          class="assistant-message"
          :class="message.role"
        >
          <p>{{ message.text }}</p>
          <small v-if="message.source && message.source !== 'welcome'">{{
            assistantSourceLabel(message.source)
          }}</small>
          <button
            v-if="message.action"
            class="assistant-action"
            type="button"
            @click="runAssistantAction(message.action)"
          >
            {{ message.action === "booking" ? "去预约" : "查看我的预约" }} →
          </button>
        </article>
        <div v-if="assistantBusy" class="assistant-typing" role="status">
          正在处理…
        </div>
      </div>
      <div class="assistant-prompts">
        <button type="button" @click="sendAssistantMessage('怎么预约')">
          怎么预约
        </button>
        <button type="button" @click="sendAssistantMessage('门诊时间')">
          门诊时间
        </button>
        <button type="button" @click="sendAssistantMessage('取消预约')">
          取消预约
        </button>
      </div>
      <form class="assistant-compose" @submit.prevent="sendAssistantMessage()">
        <input
          v-model="assistantInput"
          aria-label="输入预约问题"
          placeholder="请输入您想了解的问题"
          maxlength="500"
          :disabled="assistantBusy"
        />
        <button
          type="submit"
          :disabled="assistantBusy || !assistantInput.trim()"
        >
          发送
        </button>
      </form>
    </section>

    <div
      v-if="modal"
      class="modal-backdrop"
      @click.self="!saving && (modal = null)"
    >
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div class="eyebrow">
          {{
            modal.type === "review" ? "PLEASE CONFIRM" : "CANCEL APPOINTMENT"
          }}
        </div>
        <h2 id="modal-title">
          {{ modal.type === "review" ? "确认预约信息" : "确定取消预约吗？" }}
        </h2>
        <p>
          {{
            modal.type === "review"
              ? "请核对号源。确认后将提交给 EHR，最终以 EHR 返回结果为准。"
              : "取消请求将提交给 EHR，并按其返回状态更新。"
          }}
        </p>
        <div v-if="modal.type === 'review' && selectedSlot" class="summary">
          {{ selectedSlot.department.name }} ·
          {{ selectedSlot.clinician.name }}医生<br />
          {{ dateText(selectedSlot.visitDate) }}
          {{ periodText(selectedSlot.period) }}<br />当前余号：{{
            selectedSlot.remaining
          }}
        </div>
        <div v-else-if="modal.type === 'cancel'" class="summary">
          {{ modal.appointment.department.name }} ·
          {{ modal.appointment.clinician.name }}医生<br />
          {{ dateText(modal.appointment.visitDate) }}
          {{ periodText(modal.appointment.period) }}<br />预约编号：{{
            modal.appointment.id
          }}
        </div>
        <div class="modal-actions">
          <button class="button soft" :disabled="saving" @click="modal = null">
            再看看
          </button>
          <button
            v-if="modal.type === 'review'"
            class="button"
            :disabled="saving || Boolean(apiError)"
            @click="confirmBooking"
          >
            {{ saving ? "提交中…" : "确认预约" }}
          </button>
          <button
            v-else
            class="button danger"
            :disabled="saving"
            @click="confirmCancellation"
          >
            {{ saving ? "提交中…" : "确认取消" }}
          </button>
        </div>
      </section>
    </div>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </main>
</template>
