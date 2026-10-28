import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../context/AgentContext", () => ({
  useAgent: () => ({
    activeAgentId: "agent-1",
    activeAgent: { agent_id: "agent-1", is_owner: true },
  }),
}));
vi.mock("../../../hooks/useCardTableView", () => ({
  useCardTableView: () => ({
    isMobile: false,
    viewMode: "table",
    setViewMode: vi.fn(),
    showCardView: false,
  }),
}));
vi.mock("./useCronJobs", () => ({
  useCronJobs: () => ({
    jobs: [],
    loading: false,
    listRefreshing: false,
    listStale: false,
    cronTimezone: "UTC",
    createJob: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
    toggleEnabled: vi.fn(),
    executeNow: vi.fn(),
    jobToFormValues: vi.fn(),
    refetchJobs: vi.fn(),
  }),
}));
vi.mock("./useTaskExamples", () => ({ useTaskExamples: () => [] }));
vi.mock("../../../layouts/PageShell", () => ({
  default: ({
    actions,
    children,
    title,
  }: {
    actions?: React.ReactNode;
    children: React.ReactNode;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <div>{actions}</div>
      {children}
    </main>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import CronJobsPage from ".";

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe("CronJobsPage navigation", () => {
  it("offers a separate link to the global Agent runs page", () => {
    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <Routes>
          <Route path="/tasks" element={<CronJobsPage />} />
          <Route path="/runs" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "cronJobs.allAgentRuns" }),
    );
    expect(screen.getByTestId("current-path")).toHaveTextContent("/runs");
  });
});
