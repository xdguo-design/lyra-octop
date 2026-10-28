// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "ehrWorkbenchPage.deliveryCenter": "门诊收费交付中心",
        "ehrWorkbenchPage.openRunningProject": "打开运行项目",
        "ehrWorkbenchPage.codeWorkspace": "代码工作区",
      })[key] || key,
  }),
}));

import AgentPanel from "./AgentPanel";

describe("EHR delivery center", () => {
  it("shows the runnable project and maps PRDs to code", () => {
    render(<AgentPanel />);

    expect(screen.getByText("门诊收费交付中心")).toBeTruthy();
    expect(screen.getByRole("link", { name: /打开运行项目/ })).toHaveAttribute(
      "href",
      "/charging/chargeworkbench",
    );
    expect(screen.getByRole("link", { name: "代码工作区" })).toHaveAttribute(
      "href",
      "/workbench",
    );
    expect(screen.getAllByText(/PRD-001|SPEC-/)).toHaveLength(5);

    fireEvent.click(screen.getByText("门诊收费产品需求"));
    const item = screen.getByText("门诊收费产品需求").closest("details");
    expect(item).not.toBeNull();
    expect(
      within(item as HTMLElement).getByText(/PRD-门诊收费-重梳理草案\.md/),
    ).toBeTruthy();
    expect(
      within(item as HTMLElement).getByRole("link", {
        name: /ChargeWorkbenchPage\.vue/,
      }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/ehr-platform/blob/main/frontend/"),
    );
  });

  it("removes internal and private-repository links for public visitors", () => {
    render(<AgentPanel publicMode />);

    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByText("门诊收费产品需求"));
    expect(
      screen.getAllByText("ChargeWorkbenchPage.vue").length,
    ).toBeGreaterThan(0);
  });
});
