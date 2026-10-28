// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  publicHealth: vi.fn(),
  search: vi.fn(),
  qa: vi.fn(),
  graphSearch: vi.fn(),
  graphSubgraph: vi.fn(),
  skills: vi.fn(),
}));

vi.mock("@/api/modules/ehr", () => ({
  ehrApi: {
    health: mocks.health,
    search: mocks.search,
    qa: mocks.qa,
    graphSearch: mocks.graphSearch,
    graphSubgraph: mocks.graphSubgraph,
    skills: mocks.skills,
    graphNode: vi.fn(),
    graphPath: vi.fn(),
    runSkill: vi.fn(),
  },
  publicEhrApi: {
    health: mocks.publicHealth,
    search: vi.fn(),
  },
  resolveRagBaseUrl: () => "http://127.0.0.1:8600",
  setRagBaseUrl: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      ({
        "ehrWorkbenchPage.homeTitle": "EHR 知识工作站",
        "ehrWorkbenchPage.indexedCount": `已索引 ${options?.count ?? 0} 条`,
        "ehrWorkbenchPage.serviceUnavailable": "检索服务不可用",
        "ehrWorkbenchPage.serviceConnecting": "连接中",
        "ehrWorkbenchPage.openDelivery": "打开交付中心",
        "ehrWorkbenchPage.publicAvailable": "公开医学检索可用",
        "ehrWorkbenchPage.publicReadOnly": "访客只读",
      })[key] || key,
  }),
}));

import EhrWorkbenchPage from "./index";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockHealthy() {
  mocks.health.mockResolvedValue({ ok: true, docs: 7492, graph: true });
  mocks.graphSearch.mockResolvedValue({ nodes: [] });
  mocks.graphSubgraph.mockResolvedValue({ nodes: [], edges: [] });
  mocks.skills.mockResolvedValue({
    skills: [
      {
        name: "ehr_search",
        title: "EHR 知识库检索",
        description: "混合检索",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
  });
}

describe("EhrWorkbenchPage", () => {
  it("renders the search home as the landing view", async () => {
    mockHealthy();
    render(
      <MemoryRouter>
        <EhrWorkbenchPage />
      </MemoryRouter>,
    );
    // 首屏以工作站搜索标题为主，不重复绘制 Octop 侧栏。
    await waitFor(() => {
      expect(screen.getByText("EHR 知识工作站")).toBeTruthy();
    });
    // 健康状态（已索引条数）
    await waitFor(() => {
      expect(screen.getByText(/已索引 7492 条/)).toBeTruthy();
    });
    // 交付中心仅在用户打开时占用页面空间。
    expect(screen.getByRole("button", { name: "打开交付中心" })).toBeTruthy();
  });

  it("shows service-unreachable warning when health fails", async () => {
    mocks.health.mockRejectedValue(new Error("连接被拒绝"));
    mocks.graphSearch.mockResolvedValue({ nodes: [] });
    render(
      <MemoryRouter>
        <EhrWorkbenchPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/无法连接 EHR RAG 服务/)).toBeTruthy();
    });
    expect(screen.getByText("检索服务不可用")).toBeTruthy();
  });

  it("uses the anonymous health endpoint and hides retrieval settings", async () => {
    mocks.publicHealth.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <EhrWorkbenchPage publicMode />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("公开医学检索可用")).toBeTruthy();
    });
    expect(mocks.publicHealth).toHaveBeenCalledOnce();
    expect(mocks.health).not.toHaveBeenCalled();
    expect(screen.getByText("访客只读")).toBeTruthy();
    expect(
      screen.queryByLabelText("ehrWorkbenchPage.retrievalSettings"),
    ).toBeNull();
  });
});
