// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
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
  resolveRagBaseUrl: () => "http://127.0.0.1:8600",
  setRagBaseUrl: vi.fn(),
}));

import EhrWorkbenchPage from "./index";

afterEach(cleanup);

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
    render(<EhrWorkbenchPage />);
    // 侧栏品牌 + 搜索首页标题
    expect(screen.getByText("EHR 工作台")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("EHR 医疗知识检索")).toBeTruthy();
    });
    // 健康状态（已索引条数）
    await waitFor(() => {
      expect(screen.getByText(/已索引 7492 条/)).toBeTruthy();
    });
    // 助手面板
    expect(screen.getByText("EHR 知识助手")).toBeTruthy();
  });

  it("shows service-unreachable warning when health fails", async () => {
    mocks.health.mockRejectedValue(new Error("连接被拒绝"));
    mocks.graphSearch.mockResolvedValue({ nodes: [] });
    render(<EhrWorkbenchPage />);
    await waitFor(() => {
      expect(screen.getByText(/无法连接 EHR RAG 服务/)).toBeTruthy();
    });
    expect(screen.getByText("服务不可达")).toBeTruthy();
  });
});
