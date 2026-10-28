import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectContext,
  WorkbenchProject,
} from "../../api/modules/workbench";

const mocks = vi.hoisted(() => ({
  getProjectContext: vi.fn(),
  updateProjectContext: vi.fn(),
}));

vi.mock("../../api/modules/workbench", () => ({
  workbenchApi: {
    getProjectContext: mocks.getProjectContext,
    updateProjectContext: mocks.updateProjectContext,
  },
}));

import ProjectContextDialog from "./ProjectContextDialog";

const project = (projectId: string): WorkbenchProject => ({
  project_id: projectId,
  name: projectId,
  icon: "folder",
  parent_id: null,
  code_enabled: false,
  knowledge_base_ids: [],
  created_at: 0,
  updated_at: 0,
});

const context = (projectId: string, revision: number): ProjectContext => ({
  project_id: projectId,
  instructions: `${projectId} instructions`,
  instructions_revision: revision,
  knowledge_base_ids: [],
  updated_at: 0,
});

beforeEach(() => vi.clearAllMocks());

describe("ProjectContextDialog", () => {
  it("ignores stale loads after switching projects and saves with the displayed revision", async () => {
    let resolveFirst!: (value: ProjectContext) => void;
    let resolveSecond!: (value: ProjectContext) => void;
    mocks.getProjectContext
      .mockImplementationOnce(
        () =>
          new Promise<ProjectContext>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ProjectContext>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    mocks.updateProjectContext.mockResolvedValue(undefined);

    const onClose = vi.fn();
    const view = render(
      <ProjectContextDialog project={project("first")} onClose={onClose} />,
    );
    view.rerender(
      <ProjectContextDialog project={project("second")} onClose={onClose} />,
    );

    resolveSecond(context("second", 7));
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).toHaveValue("second instructions"));
    resolveFirst(context("first", 2));
    await waitFor(() => expect(input).toHaveValue("second instructions"));

    fireEvent.change(input, { target: { value: "updated instructions" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(mocks.updateProjectContext).toHaveBeenCalledWith(
        "second",
        "updated instructions",
        7,
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
