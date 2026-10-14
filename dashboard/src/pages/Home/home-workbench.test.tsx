// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  sendMessage: vi.fn(),
  loadHistory: vi.fn(),
  cancelStream: vi.fn(),
}));

vi.mock("../../api/request", () => ({ request: mocks.request }));
vi.mock("../../api/modules/octopThreads", () => ({
  octopThreadsApi: { list: mocks.list, create: mocks.create },
}));
vi.mock("../Chat/hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    isStreaming: false,
    historyLoading: false,
    historyError: false,
    sendMessage: mocks.sendMessage,
    cancelStream: mocks.cancelStream,
    loadHistory: mocks.loadHistory,
  }),
}));

import HomePage from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.request.mockImplementation((path: string) => {
    if (path === "/auth/me") {
      return Promise.resolve({ id: 1, username: "tester", display_name: "测试员", role: "admin" });
    }
    if (path === "/agents") {
      return Promise.resolve([
        {
          agent_id: "worker", name: "研究 Agent", kind: "expert",
          state: "running", bridge: false,
        },
        {
          agent_id: "team-primary", name: "主 Agent", kind: "team",
          state: "running", bridge: false, member_ids: ["worker"],
        },
      ]);
    }
    return Promise.reject(new Error("Unexpected request: " + path));
  });
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ thread_id: "thread-1", session_key: "session-1" });
});

afterEach(() => {
  cleanup();
});

function renderHome() {
  return render(<MemoryRouter initialEntries={["/home"]}><HomePage /></MemoryRouter>);
}

describe("LYRA workbench page integration", () => {
  it("has navigation, main chat entry, actual team info and existing platform entry", async () => {
    renderHome();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "工作区模式" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "给主 Agent 发消息" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("研究 Agent")).toBeTruthy();
      expect(screen.getByText("1/1 已启动")).toBeTruthy();
    });
    expect(screen.getByRole("complementary", { name: "主 Agent 和内置平台" })).toBeTruthy();
  });

  it("keeps first message in the workbench and sends only to the team host", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("1/1 已启动")).toBeTruthy();
    });
    const field = screen.getByRole("textbox", { name: "给主 Agent 发消息" });
    fireEvent.change(field, { target: { value: "请制定项目计划" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter", charCode: 13 });
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith("team-primary");
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        "请制定项目计划", "session-1", "team-primary", undefined, "thread-1",
      );
    });
    expect(screen.getByRole("region", { name: "主 Agent 对话" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "给主 Agent 发消息" })).toBeTruthy();
  });

  it("opens the existing Star Planet workbench maximized and returns to LYRA", async () => {
    renderHome();
    const modes = screen.getByRole("group", { name: "工作区模式" });
    fireEvent.click(within(modes).getByRole("button", { name: "内置平台" }));
    const frame = screen.getByTitle("星球乐园 · 独立工作台") as HTMLIFrameElement;
    expect(frame.src).toContain(":8130/");
    expect(screen.getByText(/已开发的独立工作台/)).toBeTruthy();
    expect(screen.queryByText("平台 Agent")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /返回工作台/ }));
    expect(screen.getByRole("textbox", { name: "给主 Agent 发消息" })).toBeTruthy();
  });
});
