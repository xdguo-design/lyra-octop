import { describe, expect, it } from "vitest";
import type { OctopAgent } from "../../context/AgentContext";
import type { ChatMessage } from "../Chat/hooks/sseHelpers";
import {
  canDelegate,
  resolvePrivatePlatformUrl,
  selectPrimaryAgent,
  visibleConversationMessages,
} from "./workbench-model";

const agent = (patch: Record<string, unknown>): OctopAgent =>
  ({ agent_id: "agent", name: "助手", state: "running", kind: "expert", ...patch }) as OctopAgent;
const msg = (patch: Partial<ChatMessage>): ChatMessage =>
  ({ id: "m", role: "assistant", content: "hello", timestamp: 1, ...patch }) as ChatMessage;

describe("private workbench", () => {
  it("routes all messages to a running team coordinator instead of a worker", () => {
    const worker = agent({ agent_id: "worker" });
    const stoppedTeam = agent({
      agent_id: "stopped", name: "team", kind: "team", member_ids: ["worker"], state: "stopped",
    });
    const team = agent({
      agent_id: "host", name: "主控", kind: "team", member_ids: ["worker"],
    });
    expect(selectPrimaryAgent([worker, stoppedTeam, team])?.agent_id).toBe("host");
    expect(canDelegate(team)).toBe(true);
    expect(canDelegate(worker)).toBe(false);
  });

  it("does not falsely advertise delegation for an empty or missing team", () => {
    expect(canDelegate(agent({ kind: "team", member_ids: [] }))).toBe(false);
    expect(selectPrimaryAgent([])).toBeNull();
  });

  it("renders only user/host chat messages, not worker or tool traces", () => {
    const items = [
      msg({ id: "1", role: "user", content: "帮我做个项目" }),
      msg({ id: "2", role: "assistant", speakerAgentId: "worker", content: "worker result" }),
      msg({ id: "3", role: "tool", content: "tool log" }),
      msg({ id: "4", role: "assistant", content: "主控汇总", teamWrapup: true }),
      msg({ id: "5", role: "assistant", content: "approval", hitlData: { action_requests: [] } }),
    ];
    expect(visibleConversationMessages(items, "host").map((m) => m.id)).toEqual(["1", "4"]);
  });

  it("rejects script URLs, credentials and public or remote-hosted platforms", () => {
    expect(resolvePrivatePlatformUrl("javascript:alert(1)", "nas.local")).toBeNull();
    expect(resolvePrivatePlatformUrl("https://a:b@nas.local/", "nas.local")).toBeNull();
    expect(resolvePrivatePlatformUrl("https://external.example/", "nas.local")).toBeNull();
    expect(resolvePrivatePlatformUrl("http://nas.local:8130/app#x", "nas.local"))
      .toBe("http://nas.local:8130/app");
    expect(resolvePrivatePlatformUrl("http://nas.local:8130/", "nas.local", "https:"))
      .toBeNull();
    expect(resolvePrivatePlatformUrl("https://nas.local:8130/", "nas.local", "https:"))
      .toBe("https://nas.local:8130/");
  });
});
