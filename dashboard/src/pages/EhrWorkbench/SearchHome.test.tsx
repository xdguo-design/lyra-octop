// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ search: vi.fn(), publicSearch: vi.fn() }));

vi.mock("@/api/modules/ehr", () => ({
  ehrApi: { search: mocks.search },
  publicEhrApi: { search: mocks.publicSearch },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "ehrWorkbenchPage.homeTitle": "EHR 知识工作站",
        "ehrWorkbenchPage.searchDescription": "按来源分区检索",
        "ehrWorkbenchPage.searchPlaceholder": "搜索内容",
        "ehrWorkbenchPage.searchButton": "搜索",
        "ehrWorkbenchPage.searchScope": "搜索范围",
        "ehrWorkbenchPage.scopeMedical": "医疗数据",
        "ehrWorkbenchPage.scopeDocuments": "已索引文档",
        "ehrWorkbenchPage.scopeCode": "代码",
        "ehrWorkbenchPage.scopeAll": "全部来源",
        "ehrWorkbenchPage.moreEntries": "更多入口",
        "ehrWorkbenchPage.docsEntry": "PRD 文档",
        "ehrWorkbenchPage.hisLoginEntry": "启动 / 登录 HIS",
        "ehrWorkbenchPage.codeEntry": "ehr-platform 源码",
        "ehrWorkbenchPage.drugEntry": "药品查询",
        "ehrWorkbenchPage.resultSource": "来源：",
      })[key] || key,
  }),
}));

import SearchHome from "./SearchHome";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SearchHome", () => {
  it("shows the PRD, HIS login, and code workspace as secondary links", () => {
    mocks.search.mockResolvedValue({ query: "", total: 0, results: [] });
    const onOpenDrugQuery = vi.fn();
    render(
      <MemoryRouter>
        <SearchHome onOpenDrugQuery={onOpenDrugQuery} />
      </MemoryRouter>,
    );

    const nav = within(screen.getByRole("navigation", { name: "更多入口" }));
    expect(nav.getAllByRole("link")).toHaveLength(3);
    expect(nav.getByRole("link", { name: "PRD 文档" })).toHaveAttribute(
      "href",
      "/ehr/prd",
    );
    expect(nav.getByRole("link", { name: "启动 / 登录 HIS" })).toHaveAttribute(
      "href",
      "http://localhost:5190/login",
    );
    expect(
      nav.getByRole("link", { name: "ehr-platform 源码" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/xdguo-design/ehr-platform/tree/main",
    );
    fireEvent.click(nav.getByRole("button", { name: "药品查询" }));
    expect(onOpenDrugQuery).toHaveBeenCalledOnce();
  });

  it("defaults to clinical data and switches to indexed documents", async () => {
    mocks.search.mockResolvedValue({ query: "", total: 0, results: [] });
    render(
      <MemoryRouter>
        <SearchHome />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("搜索内容"), {
      target: { value: "阿司匹林禁忌症" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    await waitFor(() => {
      expect(mocks.search).toHaveBeenLastCalledWith("阿司匹林禁忌症", {
        types: [
          "drug",
          "clinic_item",
          "diagnosis",
          "knowledge",
          "frequency",
          "usage",
        ],
        top_k: 12,
      });
    });

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("已索引文档"));
    await waitFor(() => {
      expect(mocks.search).toHaveBeenLastCalledWith("阿司匹林禁忌症", {
        type: "doc",
        top_k: 12,
      });
    });
  });

  it("keeps anonymous visitors in medical search and hides platform links", async () => {
    mocks.publicSearch.mockResolvedValue({ query: "", total: 0, results: [] });
    render(<SearchHome publicMode />);

    expect(screen.queryByRole("navigation", { name: "更多入口" })).toBeNull();
    expect(screen.getByRole("combobox")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("搜索内容"), {
      target: { value: "阿司匹林禁忌症" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    await waitFor(() => {
      expect(mocks.publicSearch).toHaveBeenCalledWith("阿司匹林禁忌症", 12);
    });
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
