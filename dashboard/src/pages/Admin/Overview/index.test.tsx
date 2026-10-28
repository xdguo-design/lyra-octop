import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canAccessPath,
  routeNeedsPermission,
} from "../../../utils/permissions";
const mocks = vi.hoisted(() => ({ getSystemOverview: vi.fn() }));
vi.mock("../../../api/modules/systemOverview", () => mocks);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../layouts/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
import AdminOverviewPage from ".";

beforeEach(() => {
  mocks.getSystemOverview.mockReset().mockResolvedValue({
    ok: true,
    db: true,
    users_loaded: 2,
    agents_running: 3,
  });
});

describe("AdminOverviewPage", () => {
  it("restricts the overview to administrators", () => {
    expect(routeNeedsPermission("/admin/overview")).toBe(true);
    expect(
      canAccessPath(
        { role: "user", permissions: ["users"] },
        "/admin/overview",
      ),
    ).toBe(false);
    expect(canAccessPath({ role: "admin" }, "/admin/overview")).toBe(true);
  });

  it("navigates to existing administration pages", () => {
    render(
      <MemoryRouter initialEntries={["/admin/overview"]}>
        <Routes>
          <Route path="/admin/overview" element={<AdminOverviewPage />} />
          <Route path="/admin/users" element={<div>users page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const card = screen.getByText("nav.adminUsers").closest(".ant-card");
    expect(card).not.toBeNull();
    fireEvent.click(card!.querySelector("button")!);
    expect(screen.getByText("users page")).toBeInTheDocument();
  });

  it("shows a retry when the status request fails", async () => {
    mocks.getSystemOverview.mockRejectedValueOnce(new Error("offline"));
    render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "common.retry" }),
    );
    expect(
      await screen.findByText("adminOverviewPage.bound"),
    ).toBeInTheDocument();
  });
});
