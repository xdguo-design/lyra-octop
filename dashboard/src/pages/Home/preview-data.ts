import type { OctopAgent } from "../../context/AgentContext";
import type { ChatMessage } from "../Chat/hooks/sseHelpers";

/**
 * Public cloud PREVIEW data.
 * Never reaches an API endpoint and does not represent a real agent run.
 * Only bundled into VITE_LYRA_PREVIEW=1 builds.
 */
export const previewUser = {
  id: 0,
  username: "visitor",
  role: "demo",
  display_name: "测试访客",
};

export const previewAgents = [
  {
    agent_id: "demo-host",
    name: "主 Agent（演示）",
    state: "running",
    kind: "team",
    member_ids: ["demo-research", "demo-data", "demo-writer"],
    bridge: false,
  },
  { agent_id: "demo-research", name: "调研 Agent", state: "running", kind: "expert", bridge: false },
  { agent_id: "demo-data", name: "数据 Agent", state: "running", kind: "expert", bridge: false },
  { agent_id: "demo-writer", name: "写作 Agent", state: "stopped", kind: "expert", bridge: false },
] as OctopAgent[];

export function previewTurn(prompt: string, stamp = Date.now()): ChatMessage[] {
  return [
    { id: "demo-u-" + stamp, role: "user", content: prompt, timestamp: stamp },
    {
      id: "demo-a-" + stamp,
      role: "assistant",
      content:
        "**这是界面演示回复，不是真实 Agent 执行结果。**\\n\\n" +
        "在接入私有云后，主 Agent 会根据你的任务调用专业成员，工作台只呈现最终聊天内容；执行日志可以在高级对话查看。\\n\\n" +
        "现在可以继续输入消息、切换工作区或体验页面在不同屏幕宽度下的布局。",
      timestamp: stamp + 1,
    },
  ];
}
