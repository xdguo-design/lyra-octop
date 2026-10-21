// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  getSharedProject: vi.fn(),
  getSharedThreadHistory: vi.fn(),
}));

vi.mock("../api/modules/workbench", () => ({
  workbenchApi: {
    getSharedProject: mocks.getSharedProject,
    getSharedThreadHistory: mocks.getSharedThreadHistory,
  },
}));

import SharedProjectPage from "./SharedProject";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("shared project page", () => {
  it("shows the shared project and selected conversation without edit controls", async () => {
    mocks.getSharedProject.mockResolvedValue({
      project: {
        project_id: "p1",
        name: "演示项目",
        icon: "📁",
        parent_id: null,
      },
      projects: [
        { project_id: "p1", name: "演示项目", icon: "📁", parent_id: null },
      ],
      folders: [],
      threads: [
        {
          thread_id: "t1",
          project_id: "p1",
          folder_id: null,
          title: "欢迎任务",
        },
      ],
      expires_at: 2_000_000_000,
      timezone: "Asia/Shanghai",
    });
    mocks.getSharedThreadHistory.mockResolvedValue({
      messages: [
        { role: "user", content: "你好", created_at: 100 },
        { role: "assistant", content: "欢迎查看", created_at: 101 },
      ],
      has_more: false,
      next_offset: 2,
      history_status: "ready",
    });

    render(
      <MemoryRouter initialEntries={["/share/secret"]}>
        <Routes>
          <Route path="/share/:token" element={<SharedProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("演示项目")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("欢迎任务"));
    expect(await screen.findByText("欢迎查看")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(mocks.getSharedProject).toHaveBeenCalledWith("secret");
    expect(mocks.getSharedThreadHistory).toHaveBeenCalledWith(
      "secret",
      "t1",
      100,
      0,
    );
  });

  it("shows an unavailable notice for expired or revoked links", async () => {
    mocks.getSharedProject.mockRejectedValue(new Error("not found"));
    render(
      <MemoryRouter initialEntries={["/share/expired"]}>
        <Routes>
          <Route path="/share/:token" element={<SharedProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
