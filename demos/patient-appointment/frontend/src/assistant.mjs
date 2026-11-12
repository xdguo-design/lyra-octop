const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 64;

const FAQS = [
  {
    id: "booking-process",
    answer:
      "预约时可选择科室、医生、日期和时段；确认前请核对信息。此页面目前只演示流程，不会写入真实 HIS。",
    action: "booking",
    phrases: ["怎么预约", "预约流程", "如何挂号"],
  },
  {
    id: "cancellation-navigation",
    answer:
      "可以在“我的预约”查看记录。是否可取消由 EHR 根据当前预约状态和医院规则判断。",
    action: "appointments",
    phrases: ["预约能退吗", "取消预约规则"],
  },
];

const RULES = [
  {
    id: "cancel-appointment",
    test: (text) => /取消预约|取消挂号|退号/.test(text),
    result: {
      text: "可以在“我的预约”查看记录。是否可取消由 EHR 根据当前预约状态和医院规则判断。",
      action: "appointments",
    },
  },
  {
    id: "open-appointments",
    test: (text) => /我的预约|预约记录|查预约/.test(text),
    result: { text: "我带您查看预约记录。", action: "appointments" },
  },
];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replaceAll("挂号", "预约")
    .replaceAll("预约预约", "预约")
    .replaceAll("退号", "取消预约");
}

function retrieveFaq(text) {
  for (const faq of FAQS) {
    for (const phrase of faq.phrases) {
      const candidate = normalize(phrase);
      if (text.includes(candidate)) return faq;
    }
  }
  return null;
}

function findExactFaq(text) {
  return FAQS.find((faq) =>
    faq.phrases.some((phrase) => normalize(phrase) === text),
  );
}

function faqResult(faq) {
  return { text: faq.answer, ...(faq.action ? { action: faq.action } : {}) };
}

export function createAgentFallback({
  endpoint,
  fetchImpl = fetch,
  timeoutMs = 15000,
}) {
  if (!endpoint) return undefined;
  return async (message) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`assistant request failed: ${response.status}`);
      const payload = await response.json();
      if (typeof payload.reply !== "string" || !payload.reply.trim()) {
        throw new Error("assistant response is missing reply");
      }
      return payload.reply.trim();
    } finally {
      clearTimeout(timer);
    }
  };
}

export class PatientAppointmentAssistant {
  constructor({ agentFallback, now = Date.now } = {}) {
    this.agentFallback = agentFallback;
    this.now = now;
    this.cache = new Map();
  }

  async reply(input) {
    const text = normalize(input);
    if (!text)
      return {
        source: "rule",
        text: "请描述您想了解的问题，或选择下方的快捷问题。",
      };

    const exactFaq = findExactFaq(text);
    if (exactFaq) return this.#cached(exactFaq.id, faqResult(exactFaq), "faq");

    const rule = RULES.find((item) => item.test(text));
    if (rule) return this.#cached(rule.id, rule.result, "rule");

    const faq = retrieveFaq(text);
    if (faq) return this.#cached(faq.id, faqResult(faq), "faq");

    if (/^(?:我想|我要|帮我|请帮我)?预约(?:就诊)?$/.test(text)) {
      return this.#cached(
        "start-booking",
        { text: "可以先选择科室、医生和时段。", action: "booking" },
        "rule",
      );
    }

    if (this.agentFallback) {
      try {
        const answer = await this.agentFallback(String(input).trim());
        if (answer) return { source: "agent", text: answer };
      } catch {
        return {
          source: "unavailable",
          text: "智能助手暂时不可用。您可以使用预约页面选择科室和时段，或稍后再试。",
        };
      }
    }
    return {
      source: "clarify",
      text: "我还不能确定您的意思。您可以问预约流程，或直接选择科室和时段。门诊时间、材料要求等医院规则以 EHR 返回信息为准。",
    };
  }

  #cached(key, result, source) {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cached.result, source: "cache" };
    }
    if (cached) this.cache.delete(key);
    this.cache.set(key, { result, expiresAt: this.now() + CACHE_TTL_MS });
    if (this.cache.size > CACHE_MAX)
      this.cache.delete(this.cache.keys().next().value);
    return { ...result, source };
  }
}
