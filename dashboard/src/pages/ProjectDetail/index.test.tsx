import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../api/modules/workbench", () => ({ workbenchApi: mocks }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../layouts/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("../Home/ProjectContextDialog", () => ({ default: () => null }));
vi.mock("../Home/ProjectRunsDialog", () => ({ default: () => null }));
vi.mock("../Home/ProjectShareDialog", () => ({ default: () => null }));
vi.mock("../Home/ProjectCodeBrowser", () => ({
  default: () => <div>code browser</div>,
}));

import ProjectDetailPage from ".";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1"]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/home" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => mocks.get.mockReset());

describe("ProjectDetailPage", () => {
  it("shows only the selected project's folders and assignments", async () => {
    mocks.get.mockResolvedValue({
      projects: [
        {
          project_id: "p1",
          name: "Project A",
          icon: "📁",
          knowledge_base_ids: [],
          code_enabled: true,
        },
      ],
      folders: [
        { folder_id: "f1", project_id: "p1", name: "Folder A" },
        { folder_id: "f2", project_id: "p2", name: "Other" },
      ],
      assignments: [
        { thread_id: "thread-a", project_id: "p1", folder_id: null },
      ],
    });
    renderPage();
    expect(await screen.findByText("Project A")).toBeInTheDocument();
    expect(screen.getByText("Folder A")).toBeInTheDocument();
    expect(screen.getByText("thread-a")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "workbench.home.projects.viewCode" }),
    );
    expect(screen.getByText("code browser")).toBeInTheDocument();
  });

  it("offers retry on loading failure and returns to the workbench", async () => {
    mocks.get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ projects: [], folders: [], assignments: [] });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "common.retry" }),
    );
    expect(
      await screen.findByText("projectDetailsPage.notFound"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "projectDetailsPage.back" }),
    );
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("renders a project name as text", async () => {
    const name = '<img src=x onerror="alert(1)">';
    mocks.get.mockResolvedValue({
      projects: [
        { project_id: "p1", name, icon: "📁", knowledge_base_ids: [] },
      ],
      folders: [],
      assignments: [],
    });
    const { container } = renderPage();
    expect(await screen.findByText(name)).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});
