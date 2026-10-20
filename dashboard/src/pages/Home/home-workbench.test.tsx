// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { OctopThread } from "../../api/modules/octopThreads";
import { clipThreadTitle } from "../Chat/utils/threadTitle";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  history: vi.fn(),
  rename: vi.fn(),
  workbenchGet: vi.fn(),
  workbenchImport: vi.fn(),
  assignThread: vi.fn(),
  acpConfig: vi.fn(),
  sendMessage: vi.fn(),
  loadHistory: vi.fn(),
  cancelStream: vi.fn(),
  setSkin: vi.fn(),
}));

vi.mock("../../api/request", () => ({
  request: mocks.request,
  bridgeAgentHeaders: () => undefined,
}));
vi.mock("../../api/modules/octopThreads", () => ({
  CHAT_HISTORY_PAGE_SIZE: 25,
  octopThreadsApi: {
    list: mocks.list,
    create: mocks.create,
    history: mocks.history,
    rename: mocks.rename,
  },
}));
vi.mock("../../api/modules/workbench", () => ({
  workbenchApi: {
    get: mocks.workbenchGet,
    importLocalProjects: mocks.workbenchImport,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    assignThread: mocks.assignThread,
    listCode: vi.fn(),
    readCodeFile: vi.fn(),
  },
}));
vi.mock("../../api/modules/acp", () => ({
  acpApi: { getConfig: mocks.acpConfig },
}));
vi.mock("../../layouts/MainLayout", () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <div role="region" aria-label="功能模块">
      {embedded ? "统一内容区" : "旧后台内容区"}
    </div>
  ),
}));
vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    preference: "system",
    setPreference: vi.fn(),
    skin: null,
    setSkin: mocks.setSkin,
  }),
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
      return Promise.resolve({
        id: 1,
        username: "tester",
        display_name: "测试员",
        role: "admin",
      });
    }
    if (path === "/agents") {
      return Promise.resolve([
        {
          agent_id: "worker",
          name: "研究 Agent",
          kind: "expert",
          state: "running",
          bridge: false,
        },
        {
          agent_id: "team-primary",
          name: "主 Agent",
          kind: "team",
          state: "running",
          bridge: false,
          member_ids: ["worker"],
        },
      ]);
    }
    if (path === "/voice/active") {
      return Promise.resolve({
        stt: "browser",
        tts: "browser",
        stt_realtime: false,
      });
    }
    return Promise.reject(new Error("Unexpected request: " + path));
  });
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({
    thread_id: "thread-1",
    session_key: "session-1",
  });
  mocks.history.mockResolvedValue({ messages: [], has_more: false });
  mocks.rename.mockResolvedValue(undefined);
  mocks.workbenchGet.mockResolvedValue({
    projects: [],
    folders: [],
    assignments: [],
  });
  mocks.workbenchImport.mockResolvedValue(undefined);
  mocks.assignThread.mockImplementation(
    async (
      thread_id: string,
      project_id: string | null,
      folder_id: string | null,
    ) => ({
      thread_id,
      project_id,
      folder_id,
    }),
  );
  mocks.acpConfig.mockResolvedValue({ tool_enabled: true, runners: {} });
});

afterEach(() => {
  cleanup();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <HomePage />
    </MemoryRouter>,
  );
}

function openSettingsFromProfileMenu() {
  fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
}

describe("LYRA workbench page integration", () => {
  it("starts the trusted project from Home, embeds it, and can stop it", async () => {
    const itemId = "project-1";
    mocks.request.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/auth/me") {
        return Promise.resolve({ id: 1, username: "admin", role: "admin" });
      }
      if (path === "/agents") return Promise.resolve([]);
      if (path === "/voice/active") return Promise.resolve({});
      if (path === "/creations") {
        return Promise.resolve({
          folders: [],
          items: [
            {
              item_id: itemId,
              kind: "service",
              name: "数据转换平台",
              description: "",
              url: "https://github.com/xdguo-design/data-upload-product",
              folder_id: null,
              created_at: 1,
              updated_at: 1,
              thumbnail_url: "/api/creations/items/project-1/thumbnail",
            },
          ],
          card_folders: {},
          card_meta: {},
        });
      }
      if (
        path.endsWith(`/creations/items/${itemId}/launch`) &&
        options?.method === "POST"
      ) {
        return Promise.resolve({
          status: "running",
          url: "http://127.0.0.1:8090/",
          logs: null,
          thumbnail_url: "/api/creations/items/project-1/thumbnail",
        });
      }
      if (
        path.endsWith(`/creations/items/${itemId}/launch`) &&
        !options?.method
      ) {
        return Promise.resolve({
          status: "stopped",
          url: null,
          logs: null,
          thumbnail_url: null,
        });
      }
      if (
        path.endsWith(`/creations/items/${itemId}/launch`) &&
        options?.method === "DELETE"
      ) {
        return Promise.resolve({
          status: "stopped",
          url: null,
          logs: null,
          thumbnail_url: null,
        });
      }
      return Promise.reject(new Error("Unexpected request: " + path));
    });
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: /内置平台/ }));
    const project = await screen.findByRole("button", { name: /数据转换平台/ });
    fireEvent.click(project);
    await waitFor(() => {
      const frame = screen.getByTitle("数据转换平台") as HTMLIFrameElement;
      expect(frame.src).toBe("http://127.0.0.1:8090/");
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workbench.home.platforms.stop",
      }),
    );
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        `/creations/items/${itemId}/launch`,
        { method: "DELETE" },
      ),
    );
  });

  it("keeps the home composer without welcome content", async () => {
    renderHome();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "工作区模式" })).toBeTruthy();
    const composer = screen.getByRole("textbox", { name: "给主 Agent 发消息" });
    expect(composer).toBeTruthy();
    expect(composer.closest(".wb-composer-wrap")?.className).toContain(
      "wb-composer-empty",
    );
    expect(screen.queryByRole("heading", { name: /你的想法/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /和主 Agent 聊聊/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /进入内置平台/ })).toBeNull();
    expect(screen.queryByText("平台能力")).toBeNull();
    expect(screen.queryByRole("button", { name: /文档与知识库/ })).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "主 Agent 和内置平台" }),
    ).toBeNull();
  });

  it("applies the matching global skin when a theme card is selected", async () => {
    renderHome();
    openSettingsFromProfileMenu();
    const themeCard = await waitFor(() => {
      const card = document.querySelector<HTMLButtonElement>(
        ".wb-set-gallery-card:not(.is-coming-soon)",
      );
      expect(card).toBeTruthy();
      return card!;
    });
    fireEvent.click(themeCard);
    expect(mocks.setSkin).toHaveBeenCalledWith("cloud");
  });

  it("keeps first message in the workbench and sends only to the team host", async () => {
    renderHome();
    const field = screen.getByRole("textbox", { name: "给主 Agent 发消息" });
    await waitFor(() =>
      expect((field as HTMLTextAreaElement).disabled).toBe(false),
    );
    fireEvent.change(field, { target: { value: "请制定项目计划" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter", charCode: 13 });
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith("team-primary");
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        "请制定项目计划",
        "session-1",
        "team-primary",
        undefined,
        "thread-1",
        null,
      );
    });
    expect(screen.getByRole("region", { name: "主 Agent 对话" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "给主 Agent 发消息" }),
    ).toBeTruthy();
  });

  it("keeps the first-question title when the initial thread list resolves late", async () => {
    let resolveThreadList!: (rows: OctopThread[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveThreadList = resolve;
        }),
    );
    renderHome();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    const field = screen.getByRole("textbox", { name: "给主 Agent 发消息" });
    await waitFor(() =>
      expect((field as HTMLTextAreaElement).disabled).toBe(false),
    );

    const prompt = "请帮我整理这个项目的功能模块并总结开发计划".repeat(2);
    fireEvent.change(field, { target: { value: prompt } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter", charCode: 13 });
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    const expectedTitle = clipThreadTitle(prompt);
    await screen.findByText(expectedTitle);

    resolveThreadList([
      {
        thread_id: "thread-1",
        session_key: "session-1",
        channel_type: "dashboard",
        title: null,
        last_active: 1,
        created_at: 1,
      },
    ]);
    await waitFor(() => expect(screen.getByText(expectedTitle)).toBeTruthy());
    expect(screen.queryByText("新的对话")).toBeNull();
  });

  it("recovers a blank title from the first question across history pages", async () => {
    mocks.list.mockResolvedValueOnce([
      {
        thread_id: "thread-old",
        session_key: "session-old",
        channel_type: "dashboard",
        title: null,
        last_active: 2,
        created_at: 1,
      },
    ]);
    mocks.history
      .mockResolvedValueOnce({
        messages: [{ role: "user", content: "最近的问题" }],
        has_more: true,
        limit: 25,
      })
      .mockResolvedValueOnce({
        messages: [
          { role: "user", content: "最早的问题：梳理项目背景" },
          { role: "assistant", content: "收到" },
        ],
        has_more: false,
        limit: 25,
      });

    renderHome();
    const row = await screen.findByRole("button", { name: /新的对话/ });
    fireEvent.click(row);

    await waitFor(() =>
      expect(mocks.loadHistory).toHaveBeenCalledWith("thread-old"),
    );
    await waitFor(() => expect(mocks.history).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.rename).toHaveBeenCalledWith(
        "team-primary",
        "thread-old",
        "最早的问题：梳理项目背景",
      ),
    );
    expect(mocks.history).toHaveBeenNthCalledWith(
      1,
      "team-primary",
      "thread-old",
      {
        limit: 25,
        offset: 0,
      },
    );
    expect(mocks.history).toHaveBeenNthCalledWith(
      2,
      "team-primary",
      "thread-old",
      {
        limit: 25,
        offset: 25,
      },
    );
    await screen.findByText("最早的问题：梳理项目背景");
  });

  it("creates a new task inside the selected project", async () => {
    mocks.workbenchGet.mockResolvedValueOnce({
      projects: [
        {
          project_id: "planet",
          name: "星球",
          icon: "🌍",
          parent_id: null,
          code_enabled: false,
          created_at: 1,
          updated_at: 1,
        },
      ],
      folders: [],
      assignments: [],
    });
    renderHome();
    await waitFor(() => expect(mocks.workbenchGet).toHaveBeenCalled());
    await screen.findByText("星球");
    const projectRow = screen
      .getByText("星球")
      .closest(".wb-project-row") as HTMLElement;
    fireEvent.click(
      within(projectRow).getByRole("button", {
        name: "workbench.home.projects.projectActionsNamed",
      }),
    );
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "workbench.home.projects.newTask",
      }),
    );
    const field = screen.getByRole("textbox", { name: "给主 Agent 发消息" });
    fireEvent.change(field, { target: { value: "整理星球代码" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter", charCode: 13 });
    await waitFor(() => {
      expect(mocks.assignThread).toHaveBeenCalledWith(
        "thread-1",
        "planet",
        null,
      );
      expect(mocks.sendMessage).toHaveBeenCalled();
    });
  });

  it("hangs an assigned task under both its project and the recent list", async () => {
    mocks.list.mockResolvedValueOnce([
      {
        thread_id: "thread-hello",
        title: "你好",
        channel_type: "web",
        session_key: "s-hello",
        last_active: 1,
        created_at: 1,
      },
    ]);
    mocks.workbenchGet.mockResolvedValueOnce({
      projects: [
        {
          project_id: "planet",
          name: "星球",
          icon: "📁",
          parent_id: null,
          code_enabled: false,
          created_at: 1,
          updated_at: 1,
        },
      ],
      folders: [],
      assignments: [
        { thread_id: "thread-hello", project_id: "planet", folder_id: null },
      ],
    });
    renderHome();
    await screen.findByText("星球");
    const group = screen
      .getByText("星球")
      .closest(".wb-project-group") as HTMLElement;
    await within(group).findByText("你好");
    const list = document.querySelector(".wb-task-list") as HTMLElement;
    expect(within(list).getByText("你好")).toBeTruthy();
  });

  it("nests child projects and filters the recent list by subtree", async () => {
    mocks.list.mockResolvedValueOnce([
      {
        thread_id: "thread-hello",
        title: "你好",
        channel_type: "web",
        session_key: "s-hello",
        last_active: 2,
        created_at: 2,
      },
    ]);
    mocks.workbenchGet.mockResolvedValueOnce({
      projects: [
        {
          project_id: "planet",
          name: "星球",
          icon: "📁",
          parent_id: null,
          code_enabled: false,
          created_at: 1,
          updated_at: 1,
        },
        {
          project_id: "planet26",
          name: "星球26.10",
          icon: "⚔️",
          parent_id: "planet",
          code_enabled: false,
          created_at: 1,
          updated_at: 1,
        },
      ],
      folders: [],
      assignments: [
        { thread_id: "thread-hello", project_id: "planet26", folder_id: null },
      ],
    });
    renderHome();
    await screen.findByText("星球26.10");
    const parentGroup = screen
      .getByText("星球")
      .closest(".wb-project-group") as HTMLElement;
    expect(within(parentGroup).getByText("星球26.10")).toBeTruthy();
    expect(within(parentGroup).getByText("你好")).toBeTruthy();
    fireEvent.click(within(parentGroup).getByText("星球"));
    const list = document.querySelector(".wb-task-list") as HTMLElement;
    expect(within(list).getByText("你好")).toBeTruthy();
  });

  it("keeps ACP runners out of the chat agent selector", async () => {
    mocks.acpConfig.mockResolvedValueOnce({
      tool_enabled: true,
      runners: { "Z-Code": { enabled: true }, Disabled: { enabled: false } },
    });
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "选择对话 Agent" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Z-Code")).toBeNull();
    expect(within(menu).getByText("研究 Agent")).toBeTruthy();
  });

  it("opens the built-in platform shell with the planet iframe and returns", () => {
    renderHome();
    const modes = screen.getByRole("group", { name: "工作区模式" });
    fireEvent.click(within(modes).getByRole("button", { name: "内置平台" }));
    const frame = document.querySelector(
      ".wb-platform-frame",
    ) as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    expect(frame.src).toContain(":8130/");
    fireEvent.click(screen.getByRole("button", { name: /返回工作台/ }));
    expect(
      screen.getByRole("textbox", { name: "给主 Agent 发消息" }),
    ).toBeTruthy();
  });
  it("opens settings as a modal rather than a sidebar subtree", () => {
    renderHome();
    openSettingsFromProfileMenu();
    const dialog = screen.getByRole("dialog");
    // 功能类入口只住在侧栏「更多」；设置弹窗只留账户与系统。
    expect(
      within(dialog).getByRole("button", { name: /个性与记忆/ }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /高级设置/ }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: /模型与算力/ }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: /ACP 协作/ }),
    ).toBeNull();
  });

  it("opens and closes a single mobile navigation", () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    expect(screen.getByRole("button", { name: "关闭导航" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
    expect(screen.queryByRole("button", { name: "关闭导航" })).toBeNull();
  });

  it("collapses and expands the sidebar from the brand button on home", () => {
    renderHome();
    const brand = screen.getByRole("button", { name: "收起侧边栏" });
    const root = brand.closest(".wb-root") as HTMLElement;
    expect(root.className).not.toContain("wb-side-collapsed");
    fireEvent.click(brand);
    expect(root.className).toContain("wb-side-collapsed");
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(root.className).not.toContain("wb-side-collapsed");
    expect(screen.getByRole("button", { name: "收起侧边栏" })).toBeTruthy();
  });

  it.each([
    ["Agent", "Agent"],
    ["创作", "创作"],
    ["自动化", "自动化"],
  ])("keeps the exact same LYRA shell for %s navigation", (button, title) => {
    renderHome();
    const nav = screen.getByRole("navigation", { name: "主导航" });
    fireEvent.click(within(nav).getByRole("button", { name: button }));
    expect(screen.getByRole("navigation", { name: "主导航" })).toBe(nav);
    expect(screen.getByRole("region", { name: "功能模块" }).textContent).toBe(
      "统一内容区",
    );
    expect(screen.getByRole("main", { name: title + "页面" })).toBeTruthy();
    expect(
      within(nav)
        .getByRole("button", { name: button })
        .getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "LYRA SPACE" }));
    expect(
      screen.getByRole("textbox", { name: "给主 Agent 发消息" }),
    ).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBe(nav);
  });

  it("keeps LYRA shell after entering a settings page and returns through new task", () => {
    renderHome();
    openSettingsFromProfileMenu();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /个性与记忆/ }));
    expect(screen.getByRole("region", { name: "功能模块" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    expect(
      screen.getByRole("textbox", { name: "给主 Agent 发消息" }),
    ).toBeTruthy();
  });

  it("ignores a stale thread creation after new task is clicked", async () => {
    let finish:
      | ((value: { thread_id: string; session_key: string }) => void)
      | undefined;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderHome();
    const field = screen.getByRole("textbox", { name: "给主 Agent 发消息" });
    await waitFor(() =>
      expect((field as HTMLTextAreaElement).disabled).toBe(false),
    );
    fireEvent.change(field, { target: { value: "旧的任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    finish?.({ thread_id: "stale-thread", session_key: "stale-session" });
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "主 Agent 对话" })).toBeNull();
  });
});
