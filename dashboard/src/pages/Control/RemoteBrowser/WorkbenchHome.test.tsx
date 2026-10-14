import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkbenchHome from "./WorkbenchHome";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

function setup(overrides: Partial<Parameters<typeof WorkbenchHome>[0]> = {}) {
  const props = {
    envReady: true,
    starting: false,
    onSubmitTask: vi.fn(),
    onOpenPlanet: vi.fn(),
    onOpenTasks: vi.fn(),
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
    expect(
      screen.getByText("把复杂的工作，交给 AI 来处理"),
    ).toBeTruthy();
    // card titles appear both in the thumbnail chrome bar and below it
    expect(screen.getAllByText("星球乐园").length).toBeGreaterThan(0);
    expect(screen.getAllByText("儿童数学工作台").length).toBe(1);
    expect(screen.getAllByText("工作流").length).toBeGreaterThan(0);
    expect(screen.getAllByText("定时任务与自动化").length).toBe(1);
    expect(screen.getAllByText("更多工作台").length).toBeGreaterThan(0);
    expect(screen.getAllByText("敬请期待").length).toBeGreaterThan(0);
    // thumbnails are real page previews
    expect(document.querySelector('img[src="/workbench/thumbs/planet.png"]')).toBeTruthy();
    expect(document.querySelector('img[src="/workbench/thumbs/tasks.png"]')).toBeTruthy();
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
    const input = screen.getByPlaceholderText(
      "分配一个任务，或输入 / 查看工作台",
    );
    await user.type(input, "帮我看看今天的销售数据");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(props.onSubmitTask).toHaveBeenCalledTimes(1);
    expect(props.onSubmitTask).toHaveBeenCalledWith("帮我看看今天的销售数据");
    expect(input).toHaveProperty("value", "");
  });

  it("submits on Enter without clicking send", async () => {
    const user = userEvent.setup();
    const props = setup();
    const input = screen.getByPlaceholderText(
      "分配一个任务，或输入 / 查看工作台",
    );
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

  it("opens the tasks page from the workflow card", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /工作流/ }));
    expect(props.onOpenTasks).toHaveBeenCalledTimes(1);
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
