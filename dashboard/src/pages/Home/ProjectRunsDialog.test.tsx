import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Run } from "../../api/modules/runs";
import type { WorkbenchProject } from "../../api/modules/workbench";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  steps: vi.fn(),
  events: vi.fn(),
  children: vi.fn(),
  artifacts: vi.fn(),
  projectArtifacts: vi.fn(),
}));

vi.mock("../../api/modules/runs", () => ({ runsApi: mocks }));
const download = vi.hoisted(() => vi.fn());
vi.mock("../../components/AuthFileDownloadLink", () => ({
  downloadAuthFile: download,
}));

import ProjectRunsDialog from "./ProjectRunsDialog";

function CurrentPath() {
  return <span data-testid="current-path">{useLocation().pathname}</span>;
}

const project: WorkbenchProject = {
  project_id: "project-1",
  name: "Project 1",
  icon: "folder",
  parent_id: null,
  code_enabled: false,
  knowledge_base_ids: [],
  created_at: 0,
  updated_at: 0,
};

const run: Run = {
  run_id: "run-1",
  project_id: "project-1",
  agent_id: "agent-1",
  agent_version_id: null,
  thread_id: "thread-1",
  project_context_snapshot: {
    project_id: "project-1",
    instructions_revision: 3,
    instructions: "private project instructions",
    knowledge_base_ids: ["kb-1"],
  },
  source_file_revisions: [
    {
      file_id: "file-1",
      revision_id: "revision-1",
      thread_id: "thread-1",
      content_hash: "sha256-1",
      media_type: "text/plain",
      byte_size: 12,
    },
  ],
  capability_scope_snapshot: [],
  status: "created",
  created_at: 0,
  updated_at: 0,
  started_at: null,
  finished_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  download.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([run]);
  mocks.steps.mockResolvedValue([]);
  mocks.children.mockResolvedValue([]);
  mocks.projectArtifacts.mockResolvedValue([]);
  mocks.artifacts.mockResolvedValue([
    {
      artifact_id: "artifact-1",
      run_id: "run-1",
      project_id: "project-1",
      agent_id: "agent-1",
      thread_id: "thread-1",
      file_id: "file-1",
      revision_id: "revision-2",
      display_name: "result.md",
      content_hash: "hash",
      media_type: "text/markdown",
      byte_size: 12,
      origin_kind: "generated",
      created_at: 1,
      content_url: "/api/files/file-1/revisions/revision-2/content",
    },
  ]);
  mocks.events.mockResolvedValue([
    {
      event_id: "event-1",
      run_id: "run-1",
      step_id: null,
      sequence: 1,
      type: "run.created",
      payload: { error_code: "team_member_failed" },
      created_at: 0,
    },
  ]);
});

describe("ProjectRunsDialog", () => {
  it("shows persisted status and loads the selected run's steps and events", async () => {
    mocks.projectArtifacts.mockResolvedValue([
      {
        artifact_id: "revision-2",
        run_id: "run-1",
        project_id: "project-1",
        agent_id: "agent-1",
        thread_id: "thread-1",
        file_id: "file-1",
        revision_id: "revision-2",
        display_name: "result.md",
        content_hash: "hash",
        media_type: "text/markdown",
        byte_size: 12,
        origin_kind: "generated",
        created_at: 1,
        content_url: "/api/files/file-1/revisions/revision-2/content",
      },
    ]);
    render(
      <MemoryRouter>
        <ProjectRunsDialog project={project} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("workbench.home.projects.runStatus.created"),
    ).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith("project-1");
    expect(mocks.projectArtifacts).toHaveBeenCalledWith("project-1");
    expect(await screen.findByText("result.md")).toBeInTheDocument();
    expect(
      screen.getByText("workbench.home.projects.projectArtifacts"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "workbench.home.projects.viewRunDetails",
      }),
    );

    await waitFor(() => expect(mocks.steps).toHaveBeenCalledWith("run-1"));
    expect(mocks.children).toHaveBeenCalledWith("run-1");
    expect(mocks.artifacts).toHaveBeenCalledWith("run-1");
    expect(await screen.findByText(/run\.created/)).toBeInTheDocument();
    expect(await screen.findByText(/team_member_failed/)).toBeInTheDocument();
    expect(await screen.findAllByText("result.md")).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "workbench.home.projects.downloadRunArtifact",
      })[0],
    );
    expect(download).toHaveBeenCalledWith(
      "/api/files/file-1/revisions/revision-2/content",
      { filename: "result.md" },
    );
    expect(
      screen.getByText("workbench.home.projects.runSteps"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workbench.home.projects.runContextTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText(/sha256-1/)).toBeInTheDocument();
    expect(
      screen.queryByText("private project instructions"),
    ).not.toBeInTheDocument();
  });

  it("shows persisted Team dispatch child Runs", async () => {
    mocks.children.mockResolvedValue([
      {
        run_id: "child-run-1",
        agent_id: "member-agent",
        status: "running",
        created_at: 1,
        updated_at: 1,
        started_at: 1,
        finished_at: null,
      },
    ]);
    render(
      <MemoryRouter>
        <ProjectRunsDialog project={project} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workbench.home.projects.viewRunDetails",
      }),
    );

    expect(await screen.findByText(/member-agent/)).toBeInTheDocument();
    expect(
      screen.getByText("workbench.home.projects.teamRuns"),
    ).toBeInTheDocument();
  });

  it("opens the bound chat when a run is waiting for approval", async () => {
    mocks.list.mockResolvedValue([{ ...run, status: "waiting_approval" }]);
    render(
      <MemoryRouter>
        <>
          <ProjectRunsDialog project={project} onClose={vi.fn()} />
          <CurrentPath />
        </>
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workbench.home.projects.viewRunDetails",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workbench.home.projects.openRunApproval",
      }),
    );
    expect(await screen.findByTestId("current-path")).toHaveTextContent(
      "/chat/agent-1/thread-1",
    );
  });
});
