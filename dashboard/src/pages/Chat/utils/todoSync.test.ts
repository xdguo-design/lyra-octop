import { describe, expect, it } from "vitest";
import {
  buildTodoSyncPrompt,
  todoSyncTargetAgents,
  type TodoSyncContext,
} from "./todoSync";

const memberContext: TodoSyncContext = {
  isTeamRoom: true,
  sourceAgentId: "frontend-agent",
  sourceAgentName: "前端 Agent",
  teamHostAgentId: "team-host",
  teamMemberIds: ["frontend-agent", "qa-agent"],
};

describe("multi-agent Todo synchronization", () => {
  it("targets edits to the member that owns the task list", () => {
    expect(todoSyncTargetAgents(memberContext)).toEqual(["frontend-agent"]);
  });

  it("instructs the host to update only the owning member's list", () => {
    const prompt = buildTodoSyncPrompt(
      [{ content: "补充前端测试", status: "pending" }],
      memberContext,
    );

    expect(prompt).toContain("前端 Agent");
    expect(prompt).toContain("ask_agent");
    expect(prompt).toContain("write_todos");
    expect(prompt).toContain("不得覆盖团队主计划或其他成员的清单");
    expect(prompt).toContain("1. [pending] 补充前端测试");
  });

  it("keeps team-level orchestration untargeted", () => {
    const context: TodoSyncContext = {
      isTeamRoom: true,
      sourceAgentId: "team-host",
      teamHostAgentId: "team-host",
      teamMemberIds: ["frontend-agent", "qa-agent"],
    };

    expect(todoSyncTargetAgents(context)).toEqual([]);
    expect(buildTodoSyncPrompt([], context)).toContain(
      "团队主 Agent 的总体任务计划",
    );
  });

  it("preserves the current target selection in a one-to-one chat", () => {
    expect(
      todoSyncTargetAgents({
        isTeamRoom: false,
        sourceAgentId: "solo-agent",
        teamHostAgentId: "solo-agent",
      }),
    ).toBeUndefined();
  });
});
