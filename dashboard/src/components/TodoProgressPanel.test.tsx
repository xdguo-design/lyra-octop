import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TodoListItem } from "../utils/parseWriteTodos";
import { TodoProgressPanel } from "./TodoProgressPanel";

const initialItems: TodoListItem[] = [
  { id: "1", content: "检查现有 API", status: "completed" },
  { id: "2", content: "补充回归测试", status: "pending" },
];

describe("TodoProgressPanel editing", () => {
  it("lets the user edit tasks and send the updated plan to the Agent", () => {
    const onSyncTodos = vi.fn();
    render(
      <TodoProgressPanel items={initialItems} onSyncTodos={onSyncTodos} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    fireEvent.change(screen.getByRole("textbox", { name: "第1项任务" }), {
      target: { value: "检查现有 API 和权限" },
    });
    fireEvent.click(screen.getByRole("button", { name: "同步给 Agent" }));
    expect(onSyncTodos).toHaveBeenCalledWith([
      { id: "1", content: "检查现有 API 和权限", status: "completed" },
      { id: "2", content: "补充回归测试", status: "pending" },
    ]);
  });

  it("allows adding a task before syncing", () => {
    const onSyncTodos = vi.fn();
    render(
      <TodoProgressPanel items={initialItems} onSyncTodos={onSyncTodos} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
    fireEvent.change(screen.getByRole("textbox", { name: "第3项任务" }), {
      target: { value: "运行前端测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "同步给 Agent" }));
    expect(onSyncTodos).toHaveBeenCalledWith([
      { id: "1", content: "检查现有 API", status: "completed" },
      { id: "2", content: "补充回归测试", status: "pending" },
      { id: "3", content: "运行前端测试", status: "pending" },
    ]);
  });

  it("keeps task order when a user moves a task", () => {
    const onSyncTodos = vi.fn();
    render(
      <TodoProgressPanel items={initialItems} onSyncTodos={onSyncTodos} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    fireEvent.click(screen.getByRole("button", { name: "下移第1项" }));
    fireEvent.click(screen.getByRole("button", { name: "同步给 Agent" }));

    expect(onSyncTodos).toHaveBeenCalledWith([
      { id: "1", content: "补充回归测试", status: "pending" },
      { id: "2", content: "检查现有 API", status: "completed" },
    ]);
  });

  it("prevents syncing while the Agent is still working", () => {
    render(
      <TodoProgressPanel
        items={initialItems}
        onSyncTodos={vi.fn()}
        isAgentBusy
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    expect(screen.getByRole("button", { name: "Agent 执行中" })).toBeDisabled();
    expect(
      screen.getByText("Agent 执行中仍可编辑；完成后再同步。"),
    ).toBeInTheDocument();
  });

  it("keeps the owning Agent when syncing a member task list", () => {
    const onSyncTodos = vi.fn();
    render(
      <TodoProgressPanel
        items={initialItems}
        ownerAgentId="frontend-agent"
        ownerLabel="前端 Agent"
        onSyncTodos={onSyncTodos}
      />,
    );

    expect(screen.getByText(/前端 Agent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    fireEvent.click(screen.getByRole("button", { name: /Sync to|同步给/ }));
    expect(onSyncTodos).toHaveBeenCalledWith(initialItems, "frontend-agent");
  });

  it("blocks syncing a draft after the Agent updates the task list", () => {
    const onSyncTodos = vi.fn();
    const { rerender } = render(
      <TodoProgressPanel items={initialItems} onSyncTodos={onSyncTodos} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    const updatedItems: TodoListItem[] = [
      { id: "1", content: "检查现有 API 和权限", status: "completed" },
      { id: "2", content: "补充回归测试", status: "in_progress" },
    ];
    rerender(
      <TodoProgressPanel items={updatedItems} onSyncTodos={onSyncTodos} />,
    );

    expect(
      screen.getByText(
        /任务清单在编辑期间已更新|task list changed while you were editing/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Send to Agent|同步给 Agent/ }),
    ).toBeDisabled();
    expect(onSyncTodos).not.toHaveBeenCalled();
  });
});
