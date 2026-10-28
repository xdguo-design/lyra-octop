// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("@/api/modules/ehr", () => ({ ehrApi: { search: mocks.search } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "ehrWorkbenchPage.drugEntry": "药品查询",
        "ehrWorkbenchPage.drugQueryError": "药品知识检索服务不可用",
        "ehrWorkbenchPage.drugQueryLabel": "药品关键词",
        "ehrWorkbenchPage.searchButton": "搜索",
        "ehrWorkbenchPage.resetButton": "重置",
        "ehrWorkbenchPage.drugQueryDisclaimer": "仅查询药品知识资料",
      })[key] || key,
  }),
}));

import DrugQueryView from "./DrugQueryView";

describe("DrugQueryView", () => {
  it("queries the drug index directly and reports service failures", async () => {
    mocks.search.mockRejectedValueOnce(new Error("unavailable"));
    render(<DrugQueryView />);

    fireEvent.change(screen.getByLabelText("药品关键词"), {
      target: { value: "阿司匹林" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    expect(await screen.findByText("药品知识检索服务不可用")).toBeTruthy();
    expect(mocks.search).toHaveBeenCalledWith("阿司匹林", {
      type: "drug",
      top_k: 12,
    });
  });
});
