import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkbenchHome from "./WorkbenchHome";

vi.mock("react-i18next", async () => {
  const { default: zh } = await import("../../../locales/zh.json");
  return {
    useTranslation: () => ({
      t: (key: string, fallback?: string) => {
        const value = key
          .split(".")
          .reduce<unknown>(
            (current, part) =>
              current && typeof current === "object"
                ? (current as Record<string, unknown>)[part]
                : undefined,
            zh,
          );
        return typeof value === "string" ? value : fallback ?? key;
      },
    }),
  };
});

function setup(overrides: Partial<Parameters<typeof WorkbenchHome>[0]> = {}) {
  const props = {
    envReady: true,
    starting: false,
    onSubmitTask: vi.fn(),
    onOpenPlanet: vi.fn(),
    onStartBrowser: vi.fn(),
    ...overrides,
  };
  render(<WorkbenchHome {...props} />);
  return props;
}

describe("WorkbenchHome", () => {
  it("renders the hero, ask box and workbench cards", () => {
    setup();
    expect(screen.getByText("AI 工作台")).toBeTruthy();
    expect(screen.getByText("把复杂的工作，交给 AI 来处理")).toBeTruthy();
    // card titles appear both in the thumbnail chrome bar and below it
    expect(screen.getAllByText("星球乐园").length).toBeGreaterThan(0);
    expect(screen.getAllByText("儿童数学工作台").length).toBe(1);
    expect(screen.getAllByText("工作流").length).toBeGreaterThan(0);
    expect(screen.getAllByText("定时任务与自动化").length).toBe(1);
    expect(screen.getAllByText("制作小程序").length).toBeGreaterThan(0);
    expect(screen.getAllByText("创建 PPT").length).toBeGreaterThan(0);
    // thumbnails are real page previews
    expect(
      document.querySelector('img[src="/workbench/thumbs/planet.png"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('img[src="/workbench/thumbs/tasks.png"]'),
    ).toBeTruthy();
  });

  it("keeps the send button disabled until a task is typed", async () => {
    const user = userEvent.setup();
    setup();
    const send = screen.getByRole("button", { name: "发送" });
    expect(send).toHaveProperty("disabled", true);
    await user.type(
      screen.getByPlaceholderText("分配一个任务，或输入 / 查看工作台"),
      "帮我看看今天的销售数据",
    );
    expect(send).toHaveProperty("disabled", false);
  });

  it("submits the task to the agent chat and clears the input", async () => {
    const user = userEvent.setup();
    const props = setup();
    const input =
      screen.getByPlaceholderText("分配一个任务，或输入 / 查看工作台");
    await user.type(input, "帮我看看今天的销售数据");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(props.onSubmitTask).toHaveBeenCalledTimes(1);
    expect(props.onSubmitTask).toHaveBeenCalledWith("帮我看看今天的销售数据");
    expect(input).toHaveProperty("value", "");
  });

  it("submits on Enter without clicking send", async () => {
    const user = userEvent.setup();
    const props = setup();
    const input =
      screen.getByPlaceholderText("分配一个任务，或输入 / 查看工作台");
    await user.type(input, "打开腾讯云首页{Enter}");
    expect(props.onSubmitTask).toHaveBeenCalledWith("打开腾讯云首页");
  });

  it("opens the planet panel from the planet card", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /星球乐园/ }));
    expect(props.onOpenPlanet).toHaveBeenCalledTimes(1);
    expect(props.onSubmitTask).not.toHaveBeenCalled();
  });

  it("dispatches a guided cron creation chat from the workflow card", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /工作流/ }));
    expect(props.onSubmitTask).toHaveBeenCalledTimes(1);
    expect(props.onSubmitTask).toHaveBeenCalledWith(
      expect.stringContaining("帮我创建一个定时任务"),
    );
    expect(props.onSubmitTask).toHaveBeenCalledWith(
      expect.stringContaining("cronjob_create"),
    );
  });

  it("offers mini program tasks and sends the selected prompt", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /制作小程序/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /商城小程序/ }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /预约报名/ }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /互动游戏/ }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: /产品介绍 PPT/ }),
    ).toBeNull();

    await user.click(
      within(dialog).getByRole("button", { name: /商城小程序/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onSubmitTask).toHaveBeenCalledTimes(1);
    expect(props.onSubmitTask).toHaveBeenCalledWith(
      expect.stringContaining("小程序"),
    );
  });

  it("offers presentation tasks and sends the selected prompt", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /创建 PPT/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /产品介绍 PPT/ }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /工作汇报 PPT/ }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /方案提案 PPT/ }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: /商城小程序/ }),
    ).toBeNull();

    await user.click(
      within(dialog).getByRole("button", { name: /产品介绍 PPT/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onSubmitTask).toHaveBeenCalledTimes(1);
    expect(props.onSubmitTask).toHaveBeenCalledWith(
      expect.stringContaining("PPT"),
    );
  });

  it("closes the creation task selector without dispatching a task", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /制作小程序/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /取\s*消/,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onSubmitTask).not.toHaveBeenCalled();
  });

  it("starts the browser from the bottom link", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByText("直接启动浏览器，操控网页"));
    expect(props.onStartBrowser).toHaveBeenCalledTimes(1);
  });

  it("shows the install hint when the browser env is not ready", () => {
    setup({ envReady: false });
    expect(screen.getByText("先安装浏览器环境，再操控网页")).toBeTruthy();
  });
});
