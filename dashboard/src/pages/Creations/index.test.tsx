// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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
  mocks.request.mockImplementation(() =>
    Promise.resolve({ folders: [], items: [], card_folders: {} }),
  );
});

afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/creations"]}>
      <CreationsPage />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe("CreationsPage", () => {
  it("opens the standalone speech recognition page", async () => {
    renderPage();
    const card = await screen
      .findByText("语音识别")
      .then((node) => node.closest(".cr-card") as HTMLElement);

    fireEvent.click(
      within(card).getByRole("button", { name: "打开 语音识别" }),
    );

    expect(screen.getByTestId("current-path").textContent).toBe(
      "/speech-recognition",
    );
  });

  it("lists the admission demo as an applet and opens its platform route", async () => {
    renderPage();
    const card = await screen
      .findByText("住院登记 Demo")
      .then((node) => node.closest(".cr-card") as HTMLElement);

    expect(
      within(card).getByText(
        "AI 自助住院登记演示，体验身份识别、信息补充、语音交互与登记确认流程。",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "应用 / 小程序" }));
    expect(screen.getByText("住院登记 Demo")).toBeTruthy();
    fireEvent.click(
      within(card).getByRole("button", { name: "打开 住院登记 Demo" }),
    );

    expect(screen.getByTestId("current-path").textContent).toBe(
      "/admission-demo",
    );
    expect(screen.queryByTitle("住院登记 Demo · 作品")).toBeNull();
  });

  it("opens the Vue admission-registration app in the same-origin preview", async () => {
    renderPage();
    const card = await screen
      .findByText("智能入院登记")
      .then((node) => node.closest(".cr-card") as HTMLElement);

    expect(
      within(card).getByText(
        "Vue 原型演示：模拟身份核验、资料填写、语音交互与入院登记。",
      ),
    ).toBeTruthy();
    expect(card.querySelector(".cr-thumb img")).toHaveAttribute(
      "src",
      "/admission-registration-home-cover.jpg",
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "打开 智能入院登记" }),
    );

    const preview = screen.getByTitle(
      "智能入院登记 · 作品",
    ) as HTMLIFrameElement;
    expect(preview.getAttribute("src")).toBe(
      "/admission-registration/index.html",
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "octop:close-creation-preview" },
        }),
      );
    });
    expect(screen.queryByTitle("智能入院登记 · 作品")).toBeNull();
  });

  it("embeds the configured local project preview and returns to Creations", async () => {
    const itemId = "project-1";
    const previewUrl = "http://127.0.0.1:8090/";
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.request.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/agents") return Promise.resolve([]);
      if (path === "/creations") {
        return Promise.resolve({
          folders: [],
          items: [
            {
              item_id: itemId,
              kind: "service",
              name: "数据转换平台",
              description: "",
              url: "https://github.com/xdguo-design/data-upload-product",
              folder_id: null,
              created_at: 1,
              updated_at: 1,
              thumbnail_url: null,
            },
          ],
          card_folders: {},
          card_meta: {},
        });
      }
      if (
        path.endsWith(`/creations/items/${itemId}/launch`) &&
        options?.method === "POST"
      ) {
        return Promise.resolve({
          status: "running",
          url: previewUrl,
          logs: null,
          thumbnail_url: null,
        });
      }
      if (
        path.endsWith(`/creations/items/${itemId}/launch`) &&
        options?.method === "DELETE"
      ) {
        return Promise.resolve({
          status: "stopped",
          url: null,
          logs: null,
          thumbnail_url: null,
        });
      }
      if (path.endsWith(`/creations/items/${itemId}/launch`)) {
        return Promise.resolve({
          status: "stopped",
          url: null,
          logs: null,
          thumbnail_url: null,
        });
      }
      return Promise.resolve({
        folders: [],
        items: [],
        card_folders: {},
        card_meta: {},
      });
    });
    renderPage();
    const card = await screen
      .findByText("数据转换平台")
      .then((node) => node.closest(".cr-card") as HTMLElement);
    expect(card.querySelector(".cr-thumb img")).toHaveAttribute(
      "src",
      "/workbench/thumbs/data-upload-product.png",
    );
    fireEvent.click(within(card).getByRole("button", { name: "启动预览" }));
    fireEvent.click(
      await within(card).findByRole("button", { name: "打开预览" }),
    );
    const frame = screen.getByTitle("数据转换平台 · 作品") as HTMLIFrameElement;
    expect(frame.src).toBe(previewUrl);
    expect(openSpy).not.toHaveBeenCalled();
    expect(
      within(card).getByRole("link", {
        name: /github.com\/xdguo-design\/data-upload-product/,
      }),
    ).toHaveAttribute(
      "href",
      "https://github.com/xdguo-design/data-upload-product",
    );

    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    expect(screen.queryByTitle("数据转换平台 · 作品")).toBeNull();

    fireEvent.click(card.querySelector(".cr-name-action") as HTMLButtonElement);
    expect(screen.getByTitle("数据转换平台 · 作品")).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    fireEvent.click(card.querySelector(".cr-thumb") as HTMLButtonElement);
    expect(screen.getByTitle("数据转换平台 · 作品")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "停止预览" }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        `/creations/items/${itemId}/launch`,
        { method: "DELETE" },
      ),
    );
    openSpy.mockRestore();
  });

  it("lists creations without loading agents", async () => {
    renderPage();
    expect(await screen.findByText("星球乐园")).toBeTruthy();
    expect(screen.queryByText("主Agent")).toBeNull();
    expect(screen.queryByText("小通")).toBeNull();
    expect(screen.getByRole("tab", { name: "全部" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "代理" })).toBeNull();
    expect(mocks.request).not.toHaveBeenCalledWith("/agents");
  });

  it("hides IP addresses from creation cards", async () => {
    renderPage();
    expect(await screen.findByText("星球乐园")).toBeTruthy();
    expect(screen.queryByText("127.0.0.1:8130")).toBeNull();
  });

  it("opens an app in-page and returns", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "打开 星球乐园" }));
    const frame = screen.getByTitle("星球乐园 · 作品") as HTMLIFrameElement;
    expect(frame.src).toContain(":8130/");
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    expect(screen.queryByTitle("星球乐园 · 作品")).toBeNull();
  });

  it("filters creations by keyword", async () => {
    renderPage();
    const search = screen.getByRole("textbox", { name: "搜索创作内容" });
    fireEvent.change(search, { target: { value: "星球乐园" } });
    expect(screen.getByText("星球乐园")).toBeTruthy();
    expect(screen.queryByText("freellm")).toBeNull();
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

  it("rejects an embedded-credential URL before creating a service", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "登记网站/服务" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "私有服务" },
    });
    fireEvent.change(screen.getByLabelText("网站/服务链接"), {
      target: { value: "https://user:password@example.test/app" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findAllByText("链接不能包含用户名或密码，请移除后再保存"),
    ).not.toHaveLength(0);
    expect(
      mocks.request.mock.calls.some(([path]) => path === "/creations/items"),
    ).toBe(false);
  });

  it("rejects an embedded-credential URL before updating a service", async () => {
    mocks.request.mockImplementation((path: string) => {
      if (path === "/creations") {
        return Promise.resolve({
          folders: [],
          items: [
            {
              item_id: "service-1",
              kind: "service",
              name: "私有服务",
              description: "",
              url: "https://example.test/app",
              folder_id: null,
              created_at: 1,
              updated_at: 1,
              thumbnail_url: null,
            },
          ],
          card_folders: {},
          card_meta: {},
        });
      }
      return Promise.resolve({});
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "编辑 私有服务" }),
    );
    fireEvent.change(screen.getByLabelText("网站/服务链接"), {
      target: { value: "https://user:password@example.test/app" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findAllByText("链接不能包含用户名或密码，请移除后再保存"),
    ).not.toHaveLength(0);
    expect(
      mocks.request.mock.calls.some(
        ([path, options]) =>
          path === "/creations/items/service-1" && options?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("saves a GitHub project when the repository URL ends in .git", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "添加 GitHub 项目" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "数据转换平台" },
    });
    fireEvent.change(screen.getByLabelText("GitHub 仓库链接"), {
      target: {
        value: "https://github.com/xdguo-design/data-upload-product.git",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/creations/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            kind: "service",
            name: "数据转换平台",
            description: "",
            url: "https://github.com/xdguo-design/data-upload-product.git",
            folder_id: null,
          }),
        }),
      ),
    );
  });
});
