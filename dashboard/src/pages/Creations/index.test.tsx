// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import zh from "../../locales/zh.json";

const mocks = vi.hoisted(() => {
  const translations: Record<string, unknown> = {};
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (current, part) =>
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined,
        translations,
      );
    return typeof value === "string"
      ? value.replace(/{{(\w+)}}/g, (match, name: string) =>
          name in (options ?? {}) ? String(options?.[name]) : match,
        )
      : key;
  };
  return { request: vi.fn(), translations, t };
});
vi.mock("../../api/request", () => ({ request: mocks.request }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

import CreationsPage from "./index";

beforeEach(() => {
  Object.assign(mocks.translations, {
    creationsPage: zh.creationsPage,
    common: zh.common,
  });
  window.localStorage.clear();
  mocks.request.mockReset();
  const agents = [
    {
      agent_id: "team-primary",
      name: "主Agent",
      kind: "team",
      state: "running",
      bridge: false,
    },
    {
      agent_id: "worker",
      name: "小通",
      kind: "expert",
      state: "running",
      bridge: false,
    },
  ];
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/agents"
        ? agents
        : { folders: [], items: [], card_folders: {} },
    ),
  );
});

afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/creations"]}>
      <CreationsPage />
    </MemoryRouter>,
  );
}

describe("CreationsPage", () => {
  it("lists built-in apps and live agents from the space", async () => {
    renderPage();
    expect(screen.getByText("星球乐园")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("主Agent")).toBeTruthy());
    expect(screen.getByText("小通")).toBeTruthy();
    expect(screen.getByText("编排智能体 · 运行中")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "全部" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "代理" })).toBeTruthy();
  });

  it("opens an app in-page and returns", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "打开 星球乐园" }));
    const frame = screen.getByTitle("星球乐园 · 作品") as HTMLIFrameElement;
    expect(frame.src).toContain(":8130/");
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    expect(screen.queryByTitle("星球乐园 · 作品")).toBeNull();
  });

  it("filters by keyword across apps and agents", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("主Agent")).toBeTruthy());
    const search = screen.getByRole("textbox", { name: "搜索创作内容" });
    fireEvent.change(search, { target: { value: "主Agent" } });
    expect(screen.queryByText("星球乐园")).toBeNull();
    expect(screen.getByText("主Agent")).toBeTruthy();
  });

  it("stars a creation and persists it", () => {
    renderPage();
    const planetCard = screen
      .getByText("星球乐园")
      .closest(".cr-card") as HTMLElement;
    fireEvent.click(within(planetCard).getByRole("button", { name: "收藏" }));
    expect(window.localStorage.getItem("octop:creations:starred")).toContain(
      "planet",
    );
    expect(
      within(planetCard).getByRole("button", { name: "取消收藏" }),
    ).toBeTruthy();
  });

  it("opens Manus creations in a new tab", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderPage();
    expect(screen.getByText("门诊电子病历模板工作台")).toBeTruthy();
    const manusCard = screen
      .getByText("门诊电子病历模板工作台")
      .closest(".cr-card") as HTMLElement;
    fireEvent.click(
      within(manusCard).getByRole("button", { name: "打开作品" }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://clinicemr-7tb6c7b9.manus.space/",
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      within(manusCard).queryByRole("button", { name: "在新任务中编辑" }),
    ).toBeNull();
    openSpy.mockRestore();
  });

  it("creates a planned platform through the account API", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "新建平台" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "学习平台" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/creations/items",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
