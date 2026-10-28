import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  runs: vi.fn(),
  cancelRun: vi.fn(),
}));

vi.mock("../../../../api/modules/cronjob", () => ({
  octopCronApi: api,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

import { JobDetailDrawer } from "./JobDetailDrawer";
import type { CronJobSpecOutput } from "../../../../api/types";

const job = {
  id: "cron-1",
  name: "Nightly report",
  enabled: true,
  task_type: "text",
  text: "make report",
  schedule: { cron: "interval:60", timezone: "UTC" },
  meta: {},
} as unknown as CronJobSpecOutput;

describe("JobDetailDrawer run history", () => {
  beforeEach(() => {
    api.runs.mockReset();
    api.cancelRun.mockReset();
  });

  it("shows persisted run state and lets the owner cancel an active run", async () => {
    api.runs.mockResolvedValue([
      {
        run_id: "run-1",
        cron_id: "cron-1",
        agent_id: "agent-1",
        trigger_kind: "manual",
        status: "running",
        started_at: 1_800_000_000,
        finished_at: null,
        error: null,
      },
    ]);
    api.cancelRun.mockResolvedValue({ cancelled: true });
    render(
      <JobDetailDrawer
        open
        job={job}
        agentId="agent-1"
        timeZone="UTC"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("cronJobs.runStatus.running"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "cronJobs.cancelRun" }));
    await waitFor(() =>
      expect(api.cancelRun).toHaveBeenCalledWith("agent-1", "cron-1", "run-1"),
    );
    expect(
      await screen.findByText("cronJobs.runCancelled"),
    ).toBeInTheDocument();
  });
});
