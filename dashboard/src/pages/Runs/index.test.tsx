import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Run } from "../../api/modules/runs";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  steps: vi.fn(),
  events: vi.fn(),
  artifacts: vi.fn(),
  effects: vi.fn(),
  attachArtifact: vi.fn(),
  listThreadFiles: vi.fn(),
  downloadAuthFile: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../api/modules/runs", () => ({ runsApi: mocks }));
vi.mock("../../api/modules/files", () => ({
  listThreadFiles: mocks.listThreadFiles,
}));
vi.mock("../../components/AuthFileDownloadLink", () => ({
  downloadAuthFile: mocks.downloadAuthFile,
}));
vi.mock("../../hooks/useServerTimezone", () => ({
  useServerTimezone: () => "UTC",
}));
vi.mock("../../utils/antdMessage", () => ({
  message: { success: mocks.success, error: mocks.error },
}));
vi.mock("../../layouts/PageShell", () => ({
  default: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import RunsPage from ".";

const run: Run = {
  run_id: "run-1",
  project_id: "project-1",
  agent_id: "agent-1",
  agent_version_id: "version-1",
  thread_id: null,
  project_context_snapshot: null,
  source_file_revisions: [],
  capability_scope_snapshot: [
    {
      registration_id: "registration-1",
      app_key: "admission-registration",
      grant_id: "grant-1",
      expires_at: null,
      read_scopes: ["admission.patient.read"],
      write_scopes: ["admission.narrative.write"],
    },
  ],
  status: "created",
  created_at: 1,
  updated_at: 1,
  started_at: null,
  finished_at: null,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([run]);
  mocks.get.mockResolvedValue(run);
  mocks.cancel.mockResolvedValue({ ...run, status: "cancelled" });
  mocks.steps.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
  mocks.artifacts.mockResolvedValue([]);
  mocks.effects.mockResolvedValue([]);
  mocks.attachArtifact.mockResolvedValue({ artifact_id: "artifact-1" });
  mocks.listThreadFiles.mockResolvedValue([]);
  mocks.downloadAuthFile.mockResolvedValue(undefined);
});

describe("RunsPage", () => {
  it("lists persisted runs and opens their details", async () => {
    renderAt("/runs");

    expect(
      await screen.findByText("workbench.home.projects.runStatus.created"),
    ).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith(undefined, {
      status: undefined,
      limit: 20,
      offset: 0,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "runsPage.viewDetails" }),
    );
    await screen.findByRole("heading", { name: "runsPage.detailTitle" });
    expect(screen.getByText("version-1")).toBeInTheDocument();
    expect(screen.getByText(/admission-registration/)).toBeInTheDocument();
    expect(screen.getByText(/admission\.patient\.read/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("run-1"));
    expect(mocks.steps).toHaveBeenCalledWith("run-1");
    expect(mocks.events).toHaveBeenCalledWith("run-1");
    expect(mocks.artifacts).toHaveBeenCalledWith("run-1");
    expect(mocks.effects).toHaveBeenCalledWith("run-1");
  });

  it("shows attached artifacts with authenticated downloads", async () => {
    const threadedRun: Run = { ...run, thread_id: "thread-1" };
    mocks.get.mockResolvedValue(threadedRun);
    mocks.artifacts.mockResolvedValue([
      {
        artifact_id: "artifact-1",
        run_id: "run-1",
        project_id: "project-1",
        agent_id: "agent-1",
        thread_id: "thread-1",
        file_id: "file-1",
        revision_id: "revision-1",
        display_name: "result.txt",
        content_hash: "a".repeat(64),
        media_type: "text/plain",
        byte_size: 8,
        origin_kind: "generated",
        created_at: 1,
        content_url: "/api/files/result.txt",
      },
    ]);
    renderAt("/runs/run-1");

    expect(await screen.findByText("result.txt")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "runsPage.downloadArtifact" }),
    );
    await waitFor(() =>
      expect(mocks.downloadAuthFile).toHaveBeenCalledWith(
        "/api/files/result.txt",
        { filename: "result.txt" },
      ),
    );
    expect(mocks.listThreadFiles).toHaveBeenCalledWith("agent-1", "thread-1");
  });

  it("shows only the allowlisted failure code from run events", async () => {
    mocks.events.mockResolvedValue([
      {
        event_id: "event-1",
        run_id: "run-1",
        step_id: null,
        sequence: 1,
        type: "run.status_changed",
        payload: { error_code: "execution_failed" },
        created_at: 1,
      },
    ]);
    renderAt("/runs/run-1");

    expect(
      await screen.findByText("runsPage.errorCodes.execution_failed"),
    ).toBeInTheDocument();
  });

  it("shows unknown external effects as requiring reconciliation", async () => {
    mocks.effects.mockResolvedValue([
      {
        effect_id: "effect-1",
        scope: "admission.narrative.write",
        status: "unknown",
      },
    ]);
    renderAt("/runs/run-1");

    expect(
      await screen.findByText("admission.narrative.write"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("runsPage.unknownEffectNote"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("runsPage.effectStatus.unknown"),
    ).toBeInTheDocument();
  });

  it("shows direct cancellation for a run that has not started", async () => {
    mocks.get.mockResolvedValueOnce(run).mockResolvedValue({
      ...run,
      status: "cancelled",
    });
    renderAt("/runs/run-1");
    await screen.findByText("workbench.home.projects.runStatus.created");

    fireEvent.click(screen.getByRole("button", { name: "runsPage.cancelRun" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "common.confirm" }),
    );

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("run-1"));
    expect(
      await screen.findByText("workbench.home.projects.runStatus.cancelled"),
    ).toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledWith("runsPage.cancelled");
  });

  it("keeps a running cancellation request distinct from stopped", async () => {
    const runningRun: Run = { ...run, status: "running" };
    const requestedRun: Run = { ...runningRun, status: "cancel_requested" };
    mocks.get.mockResolvedValueOnce(runningRun).mockResolvedValue(requestedRun);
    mocks.cancel.mockResolvedValue(requestedRun);
    renderAt("/runs/run-1");
    await screen.findByText("workbench.home.projects.runStatus.running");

    fireEvent.click(screen.getByRole("button", { name: "runsPage.cancelRun" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "common.confirm" }),
    );

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("run-1"));
    expect(
      await screen.findByText(
        "workbench.home.projects.runStatus.cancel_requested",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("runsPage.cancelPendingNote"),
    ).toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledWith("runsPage.cancelRequested");
  });
});
