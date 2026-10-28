export interface TodoSyncContext {
  isTeamRoom: boolean;
  sourceAgentId?: string | null;
  teamHostAgentId?: string | null;
  teamMemberIds?: readonly string[];
  sourceAgentName?: string | null;
}

export interface TodoSyncItem {
  content: string;
  status: string;
}

function isMemberOwnedTodo(context: TodoSyncContext): boolean {
  const sourceAgentId = context.sourceAgentId?.trim();
  const hostAgentId = context.teamHostAgentId?.trim();
  return Boolean(
    context.isTeamRoom &&
      sourceAgentId &&
      hostAgentId &&
      sourceAgentId !== hostAgentId &&
      (context.teamMemberIds ?? []).includes(sourceAgentId),
  );
}

/**
 * In a team room, member-owned plans are targeted to their owning member.
 * The host's orchestration remains un-targeted so it can coordinate the team.
 * In a one-to-one chat, preserve the user's existing target selection.
 */
export function todoSyncTargetAgents(
  context: TodoSyncContext,
): string[] | undefined {
  if (!context.isTeamRoom) return undefined;
  if (isMemberOwnedTodo(context)) {
    return [context.sourceAgentId!.trim()];
  }
  return [];
}

export function buildTodoSyncPrompt(
  items: readonly TodoSyncItem[],
  context: TodoSyncContext,
): string {
  const sourceAgentId = context.sourceAgentId?.trim();
  const sourceAgentName =
    context.sourceAgentName?.trim() || sourceAgentId || "";
  let scopeInstruction: string;

  if (isMemberOwnedTodo(context)) {
    scopeInstruction = [
      `这份清单属于团队成员 Agent「${sourceAgentName}」（ID: ${sourceAgentId}）的独立执行清单，不是团队主计划。`,
      "请通过 ask_agent 将最新清单定向交给该成员，要求该成员调用 write_todos 更新自己的清单，并从第一项未完成任务继续执行。",
      "只更新该成员自己的任务；不得覆盖团队主计划或其他成员的清单。若发现依赖或范围冲突，应先报告主 Agent，不要静默改写其他任务。",
    ].join("\n");
  } else if (context.isTeamRoom) {
    scopeInstruction = [
      "这是团队主 Agent 的总体任务计划。请通过 ask_agent 协调成员执行，并在分派任务时明确负责人和依赖关系。",
      "不要把不同成员各自的 write_todos 清单合并成一份并相互覆盖；成员清单仍归各自成员维护。",
    ].join("\n");
  } else {
    scopeInstruction =
      "请将下面清单作为当前会话的权威 Todo 清单，先调用 write_todos 同步清单，再从第一项未完成任务继续执行。";
  }

  return [
    "用户在对话中的 Todo 面板修改了任务清单。",
    scopeInstruction,
    "每项任务只有在实际执行并完成验证后才能标记 completed；遇到失败或阻塞时必须说明原因，不得虚报完成。",
    "",
    ...items.map(
      (item, index) => `${index + 1}. [${item.status}] ${item.content}`,
    ),
  ].join("\n");
}
