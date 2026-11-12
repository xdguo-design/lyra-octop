import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentFallback,
  PatientAppointmentAssistant,
} from "../frontend/src/assistant.mjs";

test("deterministic booking FAQ answers are cached without calling the Agent", async () => {
  let calls = 0;
  const assistant = new PatientAppointmentAssistant({
    agentFallback: async () => {
      calls += 1;
      return "模型回答";
    },
  });

  assert.equal((await assistant.reply("怎么预约？")).source, "faq");
  assert.equal((await assistant.reply("怎么预约？")).source, "cache");
  assert.equal(calls, 0);
});

test("unverified clinic facts are sent to AI instead of invented local FAQs", async () => {
  const requests = [];
  const assistant = new PatientAppointmentAssistant();

  const agentAssistant = new PatientAppointmentAssistant({
    agentFallback: async (message) => {
      requests.push(message);
      return "请以医院 EHR 公布的信息为准";
    },
  });
  const result = await agentAssistant.reply("医院几点营业");
  assert.equal(result.source, "agent");
  assert.deepEqual(requests, ["医院几点营业"]);
  assert.equal(assistant.cache.size, 0);
});

test("booking and cancellation intents return navigation actions", async () => {
  const assistant = new PatientAppointmentAssistant();

  assert.equal((await assistant.reply("我要预约挂号")).action, "booking");
  assert.equal((await assistant.reply("取消预约")).action, "appointments");
});

test("only unmatched questions reach the configured AI service", async () => {
  const requests = [];
  const assistant = new PatientAppointmentAssistant({
    agentFallback: async (message) => {
      requests.push(message);
      return "已转 AI 服务处理";
    },
  });

  const result = await assistant.reply("我想问一个特殊情况");
  assert.equal(result.source, "agent");
  assert.deepEqual(requests, ["我想问一个特殊情况"]);
});

test("complex appointment questions reach the AI service", async () => {
  const requests = [];
  const assistant = new PatientAppointmentAssistant({
    agentFallback: async (message) => {
      requests.push(message);
      return "我来查询预约规则";
    },
  });

  const result = await assistant.reply("预约失败怎么办");
  assert.equal(result.source, "agent");
  assert.deepEqual(requests, ["预约失败怎么办"]);
});

test("agent failures return a safe local response", async () => {
  const assistant = new PatientAppointmentAssistant({
    agentFallback: async () => {
      throw new Error("upstream unavailable");
    },
  });

  const result = await assistant.reply("这个问题不在本地规则里");
  assert.equal(result.source, "unavailable");
  assert.match(result.text, /暂时不可用/);
});

test("the configured fallback uses the documented JSON API contract", async () => {
  let request;
  const fallback = createAgentFallback({
    endpoint: "/api/assistant/chat",
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, json: async () => ({ reply: "AI 回复" }) };
    },
  });

  assert.equal(await fallback("请帮我看看"), "AI 回复");
  assert.deepEqual(JSON.parse(request.body), { message: "请帮我看看" });
});

test("expired deterministic entries are not returned from cache", async () => {
  let now = 0;
  const assistant = new PatientAppointmentAssistant({ now: () => now });

  assert.equal((await assistant.reply("怎么预约")).source, "faq");
  now = 5 * 60 * 1000 + 1;
  assert.equal((await assistant.reply("怎么预约")).source, "faq");
});
