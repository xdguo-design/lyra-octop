// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  chat: vi.fn(),
  chatStream: vi.fn(),
  chatLog: vi.fn(),
  job: vi.fn(),
  runtime: vi.fn(),
  download: vi.fn(),
  active: {
    agent_id: "expert-1",
    name: "创作专家",
    default_model: "provider/model",
    state: "running",
    is_owner: true,
    config: {},
  },
}));
vi.mock("../../api/modules/presentations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  presentationsApi: mocks,
}));
vi.mock("../../context/AgentContext", () => ({
  useAgent: () => ({
    agents: [mocks.active],
    activeAgent: mocks.active,
    activeAgentId: "expert-1",
    setActiveAgent: vi.fn(),
    loading: false,
  }),
}));
vi.mock("../../hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import PresentationStudio from "./index";

const deck = {
  deck_id: "deck1",
  agent_id: "expert-1",
  owner_user_id: 1,
  title: "真实项目提案",
  brief: "介绍实际项目",
  audience: "团队",
  style: "paper",
  page_count: 2,
  revision: 4,
  status: "idle",
  error: null,
  export_path: null,
  updated_at: 1792800000,
  slides: [
    { slide_id: "p1", title: "问题", body: "当前问题", notes: "", svg: null },
    { slide_id: "p2", title: "方案", body: "解决方案", notes: "", svg: null },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([structuredClone(deck)]);
  mocks.get.mockResolvedValue(structuredClone(deck));
  mocks.chatLog.mockResolvedValue({
    messages: [
      { role: "user", text: "做一份提案", action: null, at: 1 },
      { role: "assistant", text: "好的，开始制作", action: "create", at: 2 },
    ],
  });
  mocks.runtime.mockResolvedValue({
    installed: true,
    version: "6.7.3",
    commit: "abc",
  });
  vi.stubGlobal(
    "matchMedia",
    () =>
      ({
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = () =>
  render(
    <MemoryRouter>
      <PresentationStudio />
    </MemoryRouter>,
  );

it("loads the persisted deck with its transcript and disables export until pages exist", async () => {
  open();
  await screen.findAllByText("问题");
  expect(mocks.list).toHaveBeenCalledWith("expert-1");
  expect(mocks.chatLog).toHaveBeenCalledWith("expert-1", "deck1");
  expect(screen.getByText("做一份提案")).toBeTruthy();
  expect(screen.getByText("好的，开始制作")).toBeTruthy();
  expect(screen.getByText("pptStudio.actions.create")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "pptStudio.export" }),
  ).toBeDisabled();
});

it("shows the conversation empty state and creates through chat", async () => {
  mocks.list.mockResolvedValue([]);
  mocks.chatLog.mockResolvedValueOnce({ messages: [] });
  mocks.chatStream.mockImplementation(async (_agent, _body, onDelta) => {
    onDelta?.("好的");
    return {
      reply: "好的",
      action: "create",
      deck: { ...structuredClone(deck), status: "generating" },
    };
  });
  open();
  const suggestion = await screen.findByText("pptStudio.suggestCreateA");
  fireEvent.click(suggestion);
  await waitFor(() =>
    expect(mocks.chatStream).toHaveBeenCalledWith(
      "expert-1",
      { message: "pptStudio.suggestCreateA" },
      expect.any(Function),
    ),
  );
  expect(await screen.findByText("好的")).toBeTruthy();
});

it("restores the persisted conversation before the first deck exists", async () => {
  mocks.list.mockResolvedValue([]);
  mocks.chatLog.mockResolvedValueOnce({
    messages: [
      { role: "user", text: "先讨论目标", action: null, at: 1 },
      { role: "assistant", text: "受众是谁？", action: "none", at: 2 },
    ],
  });
  open();
  expect(await screen.findByText("先讨论目标")).toBeTruthy();
  expect(screen.getByText("受众是谁？")).toBeTruthy();
  expect(mocks.chatLog).toHaveBeenCalledWith("expert-1");
});

it("sends the active deck id and applies the returned action", async () => {
  mocks.chatStream.mockImplementation(async (_agent, _body, onDelta) => {
    onDelta?.("开始整份制作");
    return {
      reply: "开始整份制作",
      action: "compose",
      deck: { ...structuredClone(deck), status: "generating" },
    };
  });
  open();
  await screen.findAllByText("问题");
  fireEvent.change(screen.getByLabelText("pptStudio.chatPlaceholder"), {
    target: { value: "重新做整份" },
  });
  fireEvent.click(screen.getByRole("button", { name: "pptStudio.send" }));
  await waitFor(() =>
    expect(mocks.chatStream).toHaveBeenCalledWith(
      "expert-1",
      { deck_id: "deck1", message: "重新做整份" },
      expect.any(Function),
    ),
  );
  expect(await screen.findByText("开始整份制作")).toBeTruthy();
  expect(screen.getByText("pptStudio.actions.compose")).toBeTruthy();
});

it("appends a completion note when the running job settles", async () => {
  mocks.get.mockResolvedValueOnce({
    ...structuredClone(deck),
    status: "generating",
  });
  vi.useFakeTimers();
  try {
    open();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getAllByText("问题").length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
  } finally {
    vi.useRealTimers();
  }
  expect(screen.getByText("pptStudio.jobDone")).toBeTruthy();
});

it("surfaces a job failure from the settled deck", async () => {
  mocks.get.mockResolvedValueOnce({
    ...structuredClone(deck),
    status: "generating",
  });
  mocks.get.mockResolvedValueOnce({
    ...structuredClone(deck),
    status: "failed",
    error: "模型超时",
  });
  vi.useFakeTimers();
  try {
    open();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
  } finally {
    vi.useRealTimers();
  }
  expect(screen.getByText("pptStudio.jobFailed")).toBeTruthy();
});
